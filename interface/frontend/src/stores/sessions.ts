/**
 * AGEM Interface — Session Store.
 *
 * Manages the list of chat sessions.
 */

import { create } from "zustand";
import type { ChatSession } from "@shared/types";

export interface SessionState {
  sessions: ChatSession[];
  isLoading: boolean;

  setSessions: (sessions: ChatSession[]) => void;
  addSession: (session: ChatSession) => void;
  removeSession: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  isLoading: false,

  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),
  setIsLoading: (isLoading) => set({ isLoading }),
}));
