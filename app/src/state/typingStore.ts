import { create } from 'zustand';

/**
 * Who is currently typing, per board.
 *
 * Presence only — never persisted. Each entry carries an expiry so a peer that goes offline
 * mid-sentence stops showing as typing instead of hanging there forever.
 */
const TYPING_TTL_MS = 6000;

interface TypingEntry {
  userId: string;
  expiresAt: number;
}

interface TypingState {
  byBoard: Record<string, TypingEntry[]>;
  setTyping: (boardId: string, userId: string, typing: boolean) => void;
  typistsFor: (boardId: string) => string[];
  clearBoard: (boardId: string) => void;
}

export const useTypingStore = create<TypingState>((set, get) => ({
  byBoard: {},

  setTyping: (boardId, userId, typing) => {
    set((state) => {
      const now = Date.now();
      const current = (state.byBoard[boardId] ?? []).filter(
        (entry) => entry.userId !== userId && entry.expiresAt > now,
      );
      const next = typing ? [...current, { userId, expiresAt: now + TYPING_TTL_MS }] : current;
      return { byBoard: { ...state.byBoard, [boardId]: next } };
    });
  },

  typistsFor: (boardId) => {
    const now = Date.now();
    return (get().byBoard[boardId] ?? [])
      .filter((entry) => entry.expiresAt > now)
      .map((entry) => entry.userId);
  },

  clearBoard: (boardId) => {
    set((state) => ({ byBoard: { ...state.byBoard, [boardId]: [] } }));
  },
}));
