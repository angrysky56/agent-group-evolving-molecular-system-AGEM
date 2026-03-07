/**
 * AGEM Interface — Settings Store.
 *
 * Persists provider, model, and API key configuration to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LLMProviderType, ModelInfo } from "@shared/types";

export interface SettingsState {
  provider: LLMProviderType;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  ollamaUrl: string;
  availableModels: ModelInfo[];

  setProvider: (provider: LLMProviderType) => void;
  setChatModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setOllamaUrl: (url: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: "ollama",
      chatModel: "llama3.2",
      embeddingModel: "nomic-embed-text",
      apiKey: "",
      ollamaUrl: "http://localhost:11434",
      availableModels: [],

      setProvider: (provider) => set({ provider }),
      setChatModel: (chatModel) => set({ chatModel }),
      setEmbeddingModel: (embeddingModel) => set({ embeddingModel }),
      setApiKey: (apiKey) => set({ apiKey }),
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setAvailableModels: (availableModels) => set({ availableModels }),
    }),
    {
      name: "agem-settings",
    },
  ),
);
