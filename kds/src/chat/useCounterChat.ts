import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHAT_SOCKET_EVENTS,
  CounterMessageDirection,
  CounterMessageKind,
  type CounterChatThreadDto,
  type CounterMessageDto,
  type CounterOrderTagDto,
  type Uuid,
} from '@menuboard/shared';
import {
  fetchOrderTags,
  fetchThread,
  markChatRead,
  sendMessage,
  translateMessage,
} from '../api/chat';
import {
  emitChatTyping,
  onSocketEvent,
  subscribeChat,
  unsubscribeChat,
} from '../socket';
import { useChatSounds } from './useChatSounds';

export interface CounterChatApi {
  messages: CounterMessageDto[];
  isPending: boolean;
  error: unknown;
  /** Messages from the office this counter has not read. */
  unreadCount: number;
  /** Order ids carrying a message, with what is unread on each — drives the card badge. */
  tagsByOrder: Map<Uuid, CounterOrderTagDto>;
  /** The office is typing right now. */
  officeTyping: boolean;
  /** A bell that has been rung and not yet dismissed. */
  ringing: CounterMessageDto | null;
  dismissRing: () => void;
  /** Send, optionally about a particular order — what a dragged card attaches. */
  send: (body: string, orderId?: Uuid | null) => void;
  isSending: boolean;
  sendFailed: boolean;
  markRead: () => void;
  setTyping: (typing: boolean) => void;
  /** Auto-translate every arriving message into Hindi. Remembered on the device. */
  autoTranslate: boolean;
  setAutoTranslate: (on: boolean) => void;
  /** Message ids whose translation is being fetched right now. */
  translating: Set<Uuid>;
  /** Hands the audio context its required user gesture. */
  unlockSound: () => void;
}

/** How long the office's typing bubble survives without a refresh, if the "stopped" is lost. */
const TYPING_TIMEOUT_MS = 4_000;

const AUTO_TRANSLATE_KEY = 'menuboard.kds.chat.autoTranslate';

/** The gap between rings. Roughly the cadence of a desk phone. */
const BELL_REPEAT_MS = 2_600;

/**
 * How many times an unanswered bell sounds before it gives up.
 *
 * Three, and then it is a missed call: it stays in the thread and in the unread count, but it
 * stops making noise. A bell that rang until somebody came back would, on an unattended
 * counter, simply become a siren nobody could switch off — and the one thing worse than
 * missing the office is a board the room has learned to ignore.
 *
 * The office can also cut it short from its end at any point (`CHAT_BELL_END`), the way a
 * caller who gives up stops the phone mid-ring.
 */
const BELL_RINGS = 3;

/**
 * How long the green handset stays offered after the ringing has stopped.
 *
 * The sound gives up after two rings; the *bar* does not go with it. Two rings is about five
 * seconds, and a counter person who stepped to the pass and heard it would come back to find
 * nothing on screen — a call that rang and then denied it ever happened. So it stays put,
 * silently, long enough to be walked back to, and then retires into the thread as the missed
 * call it is.
 */
const BELL_GRACE_MS = 30_000;

/**
 * This counter's side of the office conversation.
 *
 * History comes over REST and every live change over the socket, with the socket writing
 * straight into the React Query cache rather than triggering a refetch: the payload of a chat
 * event *is* the message, so asking the server for what just arrived would be a round trip for
 * something already in hand.
 */
export function useCounterChat(counterId: Uuid, panelOpen: boolean): CounterChatApi {
  const queryClient = useQueryClient();
  const sounds = useChatSounds();
  const [officeTyping, setOfficeTyping] = useState(false);
  const [ringing, setRinging] = useState<CounterMessageDto | null>(null);
  const typingTimer = useRef(0);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  /* The switch is the counter's, kept on the device like the language itself: whoever stands
     here decides whether they want the office translated, and that outlives one page load. */
  const [autoTranslate, setAutoTranslateState] = useState<boolean>(
    () => localStorage.getItem(AUTO_TRANSLATE_KEY) === '1',
  );
  const setAutoTranslate = useCallback((on: boolean): void => {
    localStorage.setItem(AUTO_TRANSLATE_KEY, on ? '1' : '0');
    setAutoTranslateState(on);
  }, []);
  const [translating, setTranslating] = useState<Set<Uuid>>(new Set());
  /** Ids already attempted, so one failure does not become a retry loop against the board. */
  const attemptedRef = useRef<Set<Uuid>>(new Set());

  const threadKey = useMemo(() => ['chat', 'thread', counterId], [counterId]);
  const tagsKey = useMemo(() => ['chat', 'tags', counterId], [counterId]);

  const thread = useQuery({
    queryKey: threadKey,
    queryFn: () => fetchThread(counterId),
    // The socket carries every change; this is the safety net for an event missed while the
    // screen was asleep, not the way messages arrive.
    refetchInterval: 120_000,
  });

  const tags = useQuery({
    queryKey: tagsKey,
    queryFn: () => fetchOrderTags(counterId),
    refetchInterval: 120_000,
  });

  const readMutation = useMutation({
    mutationFn: () => markChatRead(counterId),
    onSuccess: () => {
      queryClient.setQueryData<CounterChatThreadDto>(threadKey, (prev) =>
        prev === undefined ? prev : { ...prev, unreadCount: 0 },
      );
      void queryClient.invalidateQueries({ queryKey: tagsKey });
    },
  });

  const sendMutation = useMutation({
    mutationFn: ({ body, orderId }: { body: string; orderId: Uuid | null }) =>
      sendMessage(counterId, body, orderId),
    // The counter's own message arrives back over the socket like any other, so nothing is
    // appended here — doing both would show it twice.
    onSuccess: () => undefined,
  });

  /* Join the channel for as long as this board is on a counter. Separate from the board's own
     subscription: the two rooms are deliberately distinct. */
  useEffect(() => {
    subscribeChat(counterId);
    return () => unsubscribeChat();
  }, [counterId]);

  const readMutationRef = useRef(readMutation);
  readMutationRef.current = readMutation;

  /** Inserts or replaces by id — the Hindi rendering arrives later under the same id. */
  const upsert = useCallback(
    (message: CounterMessageDto): void => {
      queryClient.setQueryData<CounterChatThreadDto>(threadKey, (prev) => {
        if (prev === undefined) return prev;
        const index = prev.messages.findIndex((entry) => entry.id === message.id);
        const messages =
          index === -1
            ? [...prev.messages, message]
            : prev.messages.map((entry) => (entry.id === message.id ? message : entry));

        // Only a genuinely new message from the office counts against the badge — a message
        // replaced by its translation must not bump the count a second time.
        const isNewInbound =
          index === -1 && message.direction === CounterMessageDirection.TO_COUNTER;
        return {
          ...prev,
          messages,
          unreadCount: prev.unreadCount + (isNewInbound && !panelOpenRef.current ? 1 : 0),
        };
      });

      /* Arriving while the panel is open is *read*, and has to be said so on the server. The
         count above deliberately stays at zero in that case, which means the effect that
         normally reports a read has nothing to react to — so without this the server would
         keep the message unread and the order card's chat badge would stay lit until the
         next poll. */
      if (
        panelOpenRef.current &&
        message.direction === CounterMessageDirection.TO_COUNTER
      ) {
        readMutationRef.current.mutate();
      }

      if (message.orderId !== null) void queryClient.invalidateQueries({ queryKey: tagsKey });
    },
    [queryClient, threadKey, tagsKey],
  );

  const upsertRef = useRef(upsert);
  upsertRef.current = upsert;

  /* The ring itself: two chimes, then silence.
     
     This effect owns every ring — the socket handler only sets `ringing` — so there is exactly
     one place that decides when a bell makes noise, and no way for an arrival chime and a
     repeat to double up.

     The cleanup is what makes the two remaining rules true. It runs when `ringing` changes to
     anything else, so:
       - pressing the green handset (which clears `ringing`) cuts the sound mid-chime, rather
         than merely cancelling the ring after it;
       - a second bell arriving over an unanswered one silences the first before starting its
         own, so two overlapping rings can never stack up. */
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  useEffect(() => {
    if (ringing === null) return;
    let rung = 0;
    let timer = 0;

    const ring = (): void => {
      soundsRef.current.stop();
      soundsRef.current.play('bell');
      rung += 1;
      if (rung < BELL_RINGS) {
        timer = window.setTimeout(ring, BELL_REPEAT_MS);
        return;
      }
      // Rung out. The handset stays offered in silence for a moment longer, then the bell
      // retires into the thread and the unread count as the missed call it is.
      timer = window.setTimeout(() => setRinging(null), BELL_GRACE_MS);
    };

    ring();
    return () => {
      window.clearTimeout(timer);
      soundsRef.current.stop();
    };
  }, [ringing]);

  useEffect(() => {
    const offMessage = onSocketEvent(CHAT_SOCKET_EVENTS.CHAT_MESSAGE, (...args: unknown[]) => {
      const message = args[0] as CounterMessageDto;
      if (message?.counterId !== counterId) return;
      const known = queryClient
        .getQueryData<CounterChatThreadDto>(threadKey)
        ?.messages.some((entry) => entry.id === message.id);
      upsert(message);
      // Sound only for the office's first delivery of a message — never for this counter's own
      // words coming back, and never for a translation landing on one already read.
      if (known !== true && message.direction === CounterMessageDirection.TO_COUNTER) {
        sounds.play('message');
      }
    });

    const offBell = onSocketEvent(CHAT_SOCKET_EVENTS.CHAT_BELL, (...args: unknown[]) => {
      const message = args[0] as CounterMessageDto;
      if (message?.counterId !== counterId) return;
      upsert(message);
      // Setting this is the whole trigger — the ring effect above does the sounding, so a
      // chime here would make the first ring play twice.
      setRinging(message);
    });

    const offTyping = onSocketEvent(CHAT_SOCKET_EVENTS.CHAT_TYPING, (...args: unknown[]) => {
      const payload = args[0] as { counterId: Uuid; direction: CounterMessageDirection; typing: boolean };
      if (payload?.counterId !== counterId) return;
      if (payload.direction !== CounterMessageDirection.TO_COUNTER) return;
      window.clearTimeout(typingTimer.current);
      setOfficeTyping(payload.typing);
      if (payload.typing) {
        typingTimer.current = window.setTimeout(() => setOfficeTyping(false), TYPING_TIMEOUT_MS);
      }
    });

    /* The office hung up. The ring ends here and now — not after the current chime, and not
       after the grace period — because a caller putting the handset down is the one signal a
       ringing phone always obeys immediately. Clearing `ringing` runs the ring effect's
       cleanup, which silences whatever is mid-flight. */
    const offBellEnd = onSocketEvent(CHAT_SOCKET_EVENTS.CHAT_BELL_END, (...args: unknown[]) => {
      const payload = args[0] as { counterId: Uuid };
      if (payload?.counterId !== counterId) return;
      setRinging(null);
    });

    // The office emptied the thread; the wall must not keep showing what was cleared.
    const offCleared = onSocketEvent(CHAT_SOCKET_EVENTS.CHAT_CLEARED, (...args: unknown[]) => {
      const payload = args[0] as { counterId: Uuid };
      if (payload?.counterId !== counterId) return;
      queryClient.setQueryData<CounterChatThreadDto>(threadKey, (prev) =>
        prev === undefined ? prev : { ...prev, messages: [], unreadCount: 0 },
      );
      void queryClient.invalidateQueries({ queryKey: tagsKey });
      setRinging(null);
    });

    return () => {
      offMessage();
      offBell();
      offBellEnd();
      offTyping();
      offCleared();
      window.clearTimeout(typingTimer.current);
    };
  }, [counterId, queryClient, threadKey, tagsKey, upsert, sounds]);

  /* Fill in Hindi for anything the switch covers that arrived without it.

     The send-time attempt is best-effort and gives up quietly when the canteen has no
     internet, so this is the board asking again for the messages actually in front of it.
     One attempt per id, ever: a translator that is down must not turn into a retry loop
     from a screen that never reloads. Only the office's words — the counter wrote its own. */
  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  useEffect(() => {
    if (!autoTranslate) return;
    const pending = messages.filter(
      (message) =>
        message.direction === CounterMessageDirection.TO_COUNTER &&
        message.kind !== CounterMessageKind.BELL &&
        message.bodyHi === null &&
        message.body.trim() !== '' &&
        !attemptedRef.current.has(message.id),
    );
    if (pending.length === 0) return;

    for (const message of pending) attemptedRef.current.add(message.id);
    setTranslating((prev) => {
      const next = new Set(prev);
      for (const message of pending) next.add(message.id);
      return next;
    });

    let cancelled = false;
    void (async () => {
      for (const message of pending) {
        try {
          const translated = await translateMessage(counterId, message.id);
          if (cancelled) return;
          // The server also broadcasts this, but writing it here means the board that asked
          // sees it even if its own socket frame goes missing.
          upsertRef.current(translated);
        } catch {
          // Left in English, which is what `bodyHi: null` already means to the view.
        } finally {
          if (!cancelled) {
            setTranslating((prev) => {
              const next = new Set(prev);
              next.delete(message.id);
              return next;
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoTranslate, messages, counterId]);

  // Opening the panel is the counter saying it has read the thread.
  useEffect(() => {
    if (!panelOpen) return;
    if ((thread.data?.unreadCount ?? 0) === 0) return;
    readMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, thread.data?.unreadCount]);

  const tagsByOrder = useMemo(() => {
    const map = new Map<Uuid, CounterOrderTagDto>();
    for (const tag of tags.data ?? []) map.set(tag.orderId, tag);
    return map;
  }, [tags.data]);

  return {
    messages,
    isPending: thread.isPending,
    error: thread.error,
    unreadCount: thread.data?.unreadCount ?? 0,
    tagsByOrder,
    officeTyping,
    ringing,
    /* Silences first, then clears. The effect cleanup would silence it a frame later anyway,
       but "I pressed the button and it kept ringing for a moment" is exactly the impression
       a handset must never give. */
    dismissRing: () => {
      sounds.stop();
      setRinging(null);
    },
    send: (body: string, orderId: Uuid | null = null) => sendMutation.mutate({ body, orderId }),
    isSending: sendMutation.isPending,
    sendFailed: sendMutation.isError,
    markRead: () => readMutation.mutate(),
    setTyping: (typing: boolean) => emitChatTyping(counterId, typing),
    autoTranslate,
    setAutoTranslate,
    translating,
    unlockSound: sounds.unlock,
  };
}

/** A bell carries no body — the UI renders it as an event, not as a line of conversation. */
export function isBell(message: CounterMessageDto): boolean {
  return message.kind === CounterMessageKind.BELL;
}
