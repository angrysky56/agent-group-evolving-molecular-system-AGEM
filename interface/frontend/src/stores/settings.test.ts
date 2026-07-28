import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("../api", () => api);

import { useSettingsStore } from "./settings";

describe("settings startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      provider: "ollama",
      embeddingProvider: "ollama",
      chatModel: "llama3.2",
      embeddingModel: "nomic-embed-text",
      apiKey: "browser-key",
      availableModels: [],
      modelsLoading: false,
      initialized: false,
    });
  });

  it("hydrates from the server before fetching the configured provider models", async () => {
    api.getConfig.mockResolvedValue({
      provider: "openrouter",
      embedding_provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      embedding_model: "nvidia/nemotron-3-embed-1b:free",
      openrouter_max_tokens: 32_768,
      anthropic_max_tokens: 8_192,
    });
    api.listModels.mockResolvedValue([
      {
        id: "deepseek/deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        provider: "openrouter",
        type: "chat",
      },
    ]);

    await useSettingsStore.getState().initializeFromServer();

    expect(api.listModels).toHaveBeenCalledWith("openrouter", "browser-key");
    expect(useSettingsStore.getState()).toMatchObject({
      provider: "openrouter",
      embeddingProvider: "openrouter",
      chatModel: "deepseek/deepseek-v4-flash",
      embeddingModel: "nvidia/nemotron-3-embed-1b:free",
      initialized: true,
      modelsLoading: false,
    });
    expect(useSettingsStore.getState().availableModels).toHaveLength(1);
  });

  it("keeps the server provider authoritative when model discovery fails", async () => {
    api.getConfig.mockResolvedValue({
      provider: "openrouter",
      embedding_provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      embedding_model: "nvidia/nemotron-3-embed-1b:free",
      openrouter_max_tokens: 32_768,
      anthropic_max_tokens: 8_192,
    });
    api.listModels.mockRejectedValue(new Error("model endpoint unavailable"));

    await useSettingsStore.getState().initializeFromServer();

    expect(useSettingsStore.getState()).toMatchObject({
      provider: "openrouter",
      embeddingProvider: "openrouter",
      chatModel: "deepseek/deepseek-v4-flash",
      embeddingModel: "nvidia/nemotron-3-embed-1b:free",
      initialized: true,
      modelsLoading: false,
    });
  });
});
