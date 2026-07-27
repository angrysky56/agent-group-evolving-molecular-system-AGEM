/**
 * AGEM Interface — Settings Store.
 *
 * Persists provider, model, and API key configuration to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LLMProviderType, ModelInfo } from "@shared/types";
import { getConfig, listModels } from "../api";

export interface SettingsState {
  provider: LLMProviderType;
  embeddingProvider: LLMProviderType;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  ollamaUrl: string;
  availableModels: ModelInfo[];
  modelsLoading: boolean;

  setProvider: (provider: LLMProviderType) => void;
  setEmbeddingProvider: (provider: LLMProviderType) => void;
  setChatModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setOllamaUrl: (url: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  /** Fetch available models for the given (or current) provider. */
  fetchModels: (provider?: LLMProviderType, apiKey?: string) => Promise<void>;
  /**
   * Adopt the BACKEND's view of provider/model configuration.
   *
   * The server owns these — it reads and writes .env — but this store used to
   * persist its own defaults to localStorage and never ask. The panel could
   * therefore show "Ollama" as the active embedding provider while the server
   * was actually running OpenRouter, with nothing indicating a disagreement,
   * and the next click would write the stale local view back over .env.
   *
   * That is not cosmetic. Embedding models have different dimensions
   * (embeddinggemma 768, nemotron 2048), and cosine() returns -1 on a
   * dimension mismatch — so a stray revert does not degrade finding recall, it
   * silently switches it off completely.
   */
  hydrateFromServer: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      provider: "ollama",
      embeddingProvider: "ollama",
      chatModel: "llama3.2",
      embeddingModel: "nomic-embed-text",
      apiKey: "",
      ollamaUrl: "http://localhost:11434",
      availableModels: [],
      modelsLoading: false,

      setProvider: (provider) => set({ provider }),
      setEmbeddingProvider: (embeddingProvider) => set({ embeddingProvider }),
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

      hydrateFromServer: async () => {
        try {
          const config = await getConfig();
          set({
            provider: config.provider,
            embeddingProvider: config.embedding_provider ?? config.provider,
            chatModel: config.model,
            embeddingModel: config.embedding_model,
          });
        } catch (err) {
          console.error("[settings] hydrateFromServer failed:", err);
        }
      },
    }),
    {
      name: "agem-settings",
      /*
       * Persist ONLY what the browser owns.
       *
       * provider, embeddingProvider, chatModel and embeddingModel are the
       * server's — it holds them in .env — so caching them here just created a
       * second source of truth that drifted and then overwrote the first.
       * They are hydrated from GET /system/config on mount instead.
       *
       * apiKey and ollamaUrl stay: the key is never returned by the server
       * (only `has_api_key`), so dropping it would lose it on reload.
       */
      partialize: (s) => ({
        apiKey: s.apiKey,
        ollamaUrl: s.ollamaUrl,
      }),
    },
  ),
);
