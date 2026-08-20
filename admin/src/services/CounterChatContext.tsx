import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertSoundSlot,
  CHAT_SOCKET_EVENTS,
  CounterMessageDirection,
  type AlertSoundDto,
  type CounterChatSummaryDto,
  type CounterChatThreadDto,
  type CounterMessageDto,
  type Uuid,
} from '@menuboard/shared';
import { counterChatApi } from '../api/counterChat';
import { http, unwrap } from '../api/client';
import { ensureSocket } from './socket';

/* --------------------------------------------------------------------------- sounds */

type ChatTone = 'message' | 'bell';

const SLOT_FOR: Record<ChatTone, AlertSoundSlot> = {
  message: AlertSoundSlot.CHAT_MESSAGE,
  bell: AlertSoundSlot.CHAT_BELL,
};

/**
 * The uploaded notification sounds, or a synthesised stand-in. Same arrangement as the KDS
 * side: the file sits behind auth so it cannot be an `<audio src>`, and the office hears its
 * own uploaded sound rather than a hard-coded one.
 */
function useChatSounds(): { play: (tone: ChatTone) => void } {
  const elements = useRef<Partial<Record<ChatTone, HTMLAudioElement>>>({});
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await unwrap(
          http.get<{ success: true; data: AlertSoundDto[] }>('/alerts/sounds'),
        );
        for (const tone of ['message', 'bell'] as ChatTone[]) {
          const row = rows.find((entry) => entry.slot === SLOT_FOR[tone]);
          if (row === undefined || row.fileName === null) continue;
          const blob = await http.get<Blob>(`/alerts/sounds/${SLOT_FOR[tone]}/file`, {
            responseType: 'blob',
          });
          if (cancelled) return;
          const el = new Audio(URL.createObjectURL(blob.data));
          el.preload = 'auto';
          elements.current[tone] = el;
        }
      } catch {
        // A notification sound is never worth surfacing an error over.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const play = useCallback((tone: ChatTone): void => {
    const el = elements.current[tone];
    if (el !== undefined) {
      el.currentTime = 0;
      void el.play().catch(() => undefined);
      return;
    }
    try {
      ctxRef.current ??= new AudioContext();
      const ctx = ctxRef.current;
      const pattern: [number, number, number][] =
        tone === 'bell'
          ? [[1318, 0, 0.18], [1046, 0.2, 0.18], [1318, 0.42, 0.24]]
          : [[784, 0, 0.1], [1046, 0.09, 0.15]];
      for (const [frequency, offset, duration] of pattern) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone === 'bell' ? 'triangle' : 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + duration + 0.02);
      }
    } catch {
      // No audio context before a user gesture; silence is the correct outcome.
    }
  }, []);

  /* Memoised for the same reason as the KDS side: this object is a dependency of the
     socket-listener effect below, and a fresh literal each render would re-register the
     handlers on every render of the whole desktop. */
  return useMemo(() => ({ play }), [play]);
}

/* ---------------------------------------------------------------------------- state */

export interface CounterChatApi {
  /** Every counter with its last word — the widget's left-hand list. */
  summaries: CounterChatSummaryDto[];
  /** Total unread across every counter; the badge on the task bar. */
  totalUnread: number;
  /** Which counter's thread the widget is showing, if any. */
  activeCounterId: Uuid | null;
  /** Open a thread, or pass null to go back to the conversation list. */
  openCounter: (counterId: Uuid | null) => void;
  thread: CounterChatThreadDto | undefined;
  threadPending: boolean;
  send: (body: string, orderId: Uuid | null) => void;
  isSending: boolean;
  ringBell: () => void;
  isRinging: boolean;
  /** True while a ring this desktop placed is still going — the Hangup window. */
  onCall: boolean;
  hangUp: () => void;
  /** Empties the open thread on both sides. */
  clearThread: () => void;
  isClearing: boolean;
  /** The chat panel's own open/closed state, so the task bar button can toggle it. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** A counter is typing back right now. */
  counterTyping: boolean;
  /** The most recent arrival, for the toast. Cleared by `dismissToast`. */
  toast: CounterMessageDto | null;
  dismissToast: () => void;
}

const Ctx = createContext<CounterChatApi | null>(null);

/** How long the counter's typing bubble survives without a refresh. */
const TYPING_TIMEOUT_MS = 4_000;

/**
 * How long the office holds the line before the call gives up on its own.
 *
 * Matched to the board's three rings (`BELL_RINGS` × `BELL_REPEAT_MS` in the KDS, plus a
 * beat): while this is running the button reads Hangup, and pressing it cuts the counter's
 * ringing at once instead of waiting out the remaining rings. The two ends are timed
 * independently on purpose — a desktop that lost its socket must still stop offering to hang
 * up a call that has long since finished.
 */
const CALL_WINDOW_MS = 3 * 2_600 + 400;

/**
 * The office's side of every counter conversation, held above the whole desktop.
 *
 * It lives in `AppShell` rather than in a page so the chat survives moving between modules —
 * the point of the widget is that a manager can be anywhere in the product and still be
 * reachable — and so an arriving message can raise a notification from any screen.
 */
export function CounterChatProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();
  const sounds = useChatSounds();
  const [open, setOpen] = useState(false);
  const [activeCounterId, setActiveCounterId] = useState<Uuid | null>(null);
  const [counterTyping, setCounterTyping] = useState(false);
  const [toast, setToast] = useState<CounterMessageDto | null>(null);
  const typingTimer = useRef(0);

  /* The open thread and whether the panel is showing it, as refs: the socket handler is
     registered once and must not be torn down and rebuilt on every keystroke or tab change. */
  const activeRef = useRef<Uuid | null>(null);
  activeRef.current = activeCounterId;
  const openRef = useRef(false);
  openRef.current = open;

  const summariesQuery = useQuery({
    queryKey: ['counter-chat', 'summaries'],
    queryFn: () => counterChatApi.summaries(),
    // The socket carries every change; this only catches one missed while the tab slept.
    refetchInterval: 120_000,
  });

  const threadKey = useMemo(
    () => ['counter-chat', 'thread', activeCounterId] as const,
    [activeCounterId],
  );

  const threadQuery = useQuery({
    queryKey: threadKey,
    queryFn: () => counterChatApi.thread(activeCounterId as Uuid),
    enabled: activeCounterId !== null,
  });

  const sendMutation = useMutation({
    mutationFn: ({ body, orderId }: { body: string; orderId: Uuid | null }) =>
      counterChatApi.send(activeCounterId as Uuid, body, orderId),
    // The message returns over the socket like any other, so nothing is appended here.
  });

  const [onCall, setOnCall] = useState(false);
  const callTimer = useRef(0);

  const bellMutation = useMutation({
    mutationFn: () => counterChatApi.ringBell(activeCounterId as Uuid),
    onSuccess: () => {
      setOnCall(true);
      window.clearTimeout(callTimer.current);
      callTimer.current = window.setTimeout(() => setOnCall(false), CALL_WINDOW_MS);
    },
  });

  const hangUpMutation = useMutation({
    mutationFn: () => counterChatApi.hangUp(activeCounterId as Uuid),
  });

  /* Hanging up is the office's own decision, so the button stops offering itself the moment it
     is pressed rather than when the server answers — the request only has to reach the counter,
     and a button that stayed lit while it travelled would invite a second press. */
  const hangUp = useCallback((): void => {
    window.clearTimeout(callTimer.current);
    setOnCall(false);
    hangUpMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A call belongs to the counter it was placed to; switching threads ends the offer.
  useEffect(() => {
    window.clearTimeout(callTimer.current);
    setOnCall(false);
  }, [activeCounterId]);

  useEffect(() => () => window.clearTimeout(callTimer.current), []);

  const clearMutation = useMutation({
    mutationFn: () => counterChatApi.clear(activeCounterId as Uuid),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['counter-chat'] });
    },
  });

  const readMutation = useMutation({
    mutationFn: (counterId: Uuid) => counterChatApi.markRead(counterId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['counter-chat', 'summaries'] });
    },
  });

  /* One subscription per counter, so the office hears every board at once rather than only
     the thread it happens to be looking at — that is the whole point of a desktop widget. */
  useEffect(() => {
    const socket = ensureSocket();
    if (socket === null) return;
    const counterIds = (summariesQuery.data ?? []).map((row) => row.counterId);
    for (const counterId of counterIds) {
      socket.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId });
    }
    // Re-announced on reconnect: socket.io drops room membership when the connection drops.
    const rejoin = (): void => {
      for (const counterId of counterIds) {
        socket.emit(CHAT_SOCKET_EVENTS.CHAT_SUBSCRIBE, { counterId });
      }
    };
    socket.on('connect', rejoin);
    return () => {
      socket.off('connect', rejoin);
    };
  }, [summariesQuery.data]);

  useEffect(() => {
    const socket = ensureSocket();
    if (socket === null) return;

    const onMessage = (message: CounterMessageDto): void => {
      // Replace-by-id: the Hindi rendering arrives later carrying the same id.
      queryClient.setQueryData<CounterChatThreadDto>(
        ['counter-chat', 'thread', message.counterId],
        (prev) => {
          if (prev === undefined) return prev;
          const index = prev.messages.findIndex((entry) => entry.id === message.id);
          return {
            ...prev,
            messages:
              index === -1
                ? [...prev.messages, message]
                : prev.messages.map((entry) => (entry.id === message.id ? message : entry)),
          };
        },
      );
      void queryClient.invalidateQueries({ queryKey: ['counter-chat', 'summaries'] });

      // Only a counter answering is an event for the office — never the office's own words,
      // and never a translation landing on something already seen.
      if (message.direction !== CounterMessageDirection.TO_ADMIN) return;
      const watchingThis = openRef.current && activeRef.current === message.counterId;
      if (watchingThis) {
        readMutation.mutate(message.counterId);
        return;
      }
      sounds.play('message');
      setToast(message);
    };

    const onTyping = (payload: {
      counterId: Uuid;
      direction: CounterMessageDirection;
      typing: boolean;
    }): void => {
      if (payload.direction !== CounterMessageDirection.TO_ADMIN) return;
      if (payload.counterId !== activeRef.current) return;
      window.clearTimeout(typingTimer.current);
      setCounterTyping(payload.typing);
      if (payload.typing) {
        typingTimer.current = window.setTimeout(() => setCounterTyping(false), TYPING_TIMEOUT_MS);
      }
    };

    const onCleared = (payload: { counterId: Uuid }): void => {
      queryClient.setQueryData<CounterChatThreadDto>(
        ['counter-chat', 'thread', payload.counterId],
        (prev) => (prev === undefined ? prev : { ...prev, messages: [], unreadCount: 0 }),
      );
      void queryClient.invalidateQueries({ queryKey: ['counter-chat', 'summaries'] });
    };

    socket.on(CHAT_SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
    socket.on(CHAT_SOCKET_EVENTS.CHAT_TYPING, onTyping);
    socket.on(CHAT_SOCKET_EVENTS.CHAT_CLEARED, onCleared);
    return () => {
      socket.off(CHAT_SOCKET_EVENTS.CHAT_MESSAGE, onMessage);
      socket.off(CHAT_SOCKET_EVENTS.CHAT_TYPING, onTyping);
      socket.off(CHAT_SOCKET_EVENTS.CHAT_CLEARED, onCleared);
      window.clearTimeout(typingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, sounds]);

  const openCounter = useCallback(
    (counterId: Uuid | null): void => {
      setActiveCounterId(counterId);
      setCounterTyping(false);
      if (counterId === null) return;
      setOpen(true);
      setToast(null);
      readMutation.mutate(counterId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* Memoised rather than defaulted inline: `?? []` mints a new array on every render, which
     would defeat the memo below and re-render every consumer of this context — including the
     task bar — on every keystroke anywhere in the desktop. */
  const summaries = useMemo(() => summariesQuery.data ?? [], [summariesQuery.data]);
  const value = useMemo<CounterChatApi>(
    () => ({
      summaries,
      totalUnread: summaries.reduce((sum, row) => sum + row.unreadCount, 0),
      activeCounterId,
      openCounter,
      thread: threadQuery.data,
      threadPending: threadQuery.isPending && activeCounterId !== null,
      send: (body, orderId) => sendMutation.mutate({ body, orderId }),
      isSending: sendMutation.isPending,
      ringBell: () => bellMutation.mutate(),
      isRinging: bellMutation.isPending,
      onCall,
      hangUp,
      clearThread: () => clearMutation.mutate(),
      isClearing: clearMutation.isPending,
      open,
      setOpen,
      counterTyping,
      toast,
      dismissToast: () => setToast(null),
    }),
    [
      summaries,
      activeCounterId,
      openCounter,
      threadQuery.data,
      threadQuery.isPending,
      sendMutation,
      bellMutation,
      clearMutation,
      onCall,
      hangUp,
      open,
      counterTyping,
      toast,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCounterChat(): CounterChatApi {
  const value = useContext(Ctx);
  if (value === null) throw new Error('useCounterChat used outside <CounterChatProvider>');
  return value;
}
