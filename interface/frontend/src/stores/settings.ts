/**
 * AGEM Interface — Settings Store.
 *
 * Persists provider, model, and API key configuration to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LLMProviderType, ModelInfo } from "@shared/types";
import { listModels } from "../api";

export interface SettingsState {
  provider: LLMProviderType;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  ollamaUrl: string;
  availableModels: ModelInfo[];
  modelsLoading: boolean;

  setProvider: (provider: LLMProviderType) => void;
  setChatModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setOllamaUrl: (url: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  /** Fetch available models for the given (or current) provider. */
  fetchModels: (provider?: LLMProviderType, apiKey?: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      provider: "ollama",
      chatModel: "llama3.2",
      embeddingModel: "nomic-embed-text",
      apiKey: "",
      ollamaUrl: "http://localhost:11434",
      availableModels: [],
      modelsLoading: false,

      setProvider: (provider) => set({ provider }),
      setChatModel: (chatModel) => set({ chatModel }),
      setEmbeddingModel: (embeddingModel) => set({ embeddingModel }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setAvailableModels: (availableModels) => set({ availableModels }),

      fetchModels: async (provider?: LLMProviderType, apiKey?: string) => {
        const p = provider ?? get().provider;
        const key = apiKey ?? get().apiKey;
        set({ modelsLoading: true });
        try {
          const models = await listModels(p, key || undefined);
          set({ availableModels: models });
        } catch (err) {
          console.error("[settings] fetchModels failed:", err);
        } finally {
          set({ modelsLoading: false });
        }
      },
    }),
    {
      name: "agem-settings",
      // Don't persist transient loading state
      partialize: (s) => ({
        provider: s.provider,
        chatModel: s.chatModel,
        embeddingModel: s.embeddingModel,
        apiKey: s.apiKey,
        ollamaUrl: s.ollamaUrl,
        availableModels: s.availableModels,
      }),
    },
  ),
);
