/**
 * AGEM Interface — Chat Store.
 *
 * Manages messages, streaming state, and active session.
 */

import { create } from "zustand";
import type { ChatMessage, AgemStateSnapshot } from "@shared/types";

export interface ChatState {
  /** Messages in the active session */
  messages: ChatMessage[];
  /** Currently streaming assistant response text */
  streamingContent: string;
  /** Whether we're actively streaming */
  isStreaming: boolean;
  /** Active session ID */
  activeSessionId: string | null;
  /** Abort controller for cancelling streams */
  abortController: AbortController | null;
  /** Most recent AGEM state snapshot */
  agemState: AgemStateSnapshot | null;

  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setActiveSessionId: (id: string | null) => void;
  setAbortController: (controller: AbortController | null) => void;
  setAgemState: (state: AgemStateSnapshot | null) => void;
  clearChat: () => void;
  stopStreaming: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streamingContent: "",
  isStreaming: false,
  activeSessionId: null,
  abortController: null,
  agemState: null,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    })),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setAbortController: (abortController) => set({ abortController }),
  setAgemState: (agemState) => set({ agemState }),
  clearChat: () =>
    set({
      messages: [],
      streamingContent: "",
      isStreaming: false,
      activeSessionId: null,
      agemState: null,
    }),
  stopStreaming: () => {
    const { abortController } = get();
    abortController?.abort();
    set({
      isStreaming: false,
      abortController: null,
    });
  },
}));
