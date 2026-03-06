/**
 * LLM Provider Abstraction.
 *
 * Unified interface for Ollama (local) and OpenRouter (cloud) LLM providers.
 * Handles chat completions with streaming, model listing, and embeddings.
 */

import type { ModelInfo, LLMProviderType } from "../../../shared/types.js";
import { settings } from "../config.js";

/* ─── Provider Interface ─── */

/** Callback for streaming token chunks. */
export type StreamCallback = (chunk: string) => void;

/** Callback for streaming thinking/reasoning chunks. */
export type ThinkingCallback = (chunk: string) => void;

/** Options for a chat completion request. */
export interface ChatCompletionOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  onToken?: StreamCallback;
  onThinking?: ThinkingCallback;
  signal?: AbortSignal;
}

/** Result of a chat completion. */
export interface ChatCompletionResult {
  content: string;
  thinking?: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Abstract LLM provider interface. */
interface LLMProvider {
  readonly type: LLMProviderType;
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  listModels(): Promise<ModelInfo[]>;
}

/* ─── Ollama Provider ─── */

class OllamaProvider implements LLMProvider {
  readonly type: LLMProviderType = "ollama";
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const config = settings.getLLMConfig();
    const model = options.model ?? config.model;

    const response = await fetch(`${this.#baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Ollama chat failed: ${response.status} ${response.statusText}`
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama: No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };

          if (parsed.message?.content) {
            fullContent += parsed.message.content;
            options.onToken?.(parsed.message.content);
          }

          if (parsed.done) {
            promptTokens = parsed.prompt_eval_count ?? 0;
            completionTokens = parsed.eval_count ?? 0;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    return {
      content: fullContent,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.#baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = (await response.json()) as {
        models?: Array<{
          name: string;
          details?: { parameter_size?: string; family?: string };
        }>;
      };

      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        provider: "ollama" as const,
        context_length: 0, // Ollama doesn't expose this in /api/tags
        description: m.details?.parameter_size
          ? `${m.details.family ?? ""} ${m.details.parameter_size}`.trim()
          : undefined,
        type: m.name.toLowerCase().includes("embed") ? "embedding" as const : "chat" as const,
      }));
    } catch (error) {
      console.error("[LLM] Failed to list Ollama models:", error);
      return [];
    }
  }
}

/* ─── OpenRouter Provider ─── */

class OpenRouterProvider implements LLMProvider {
  readonly type: LLMProviderType = "openrouter";
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Get the API key, preferring runtime header over config. */
  #getApiKey(headerKey?: string): string {
    return headerKey ?? settings.getLLMConfig().api_key;
  }

  async chat(
    options: ChatCompletionOptions & { apiKey?: string }
  ): Promise<ChatCompletionResult> {
    const config = settings.getLLMConfig();
    const model = options.model ?? config.model;
    const apiKey = this.#getApiKey(options.apiKey);

    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://agem.local",
        "X-Title": "AGEM Molecular Agent System",
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`OpenRouter chat failed: ${response.status} — ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenRouter: No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let thinking = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            choices?: Array<{
              delta?: { content?: string; reasoning?: string };
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            options.onToken?.(delta.content);
          }
          if (delta?.reasoning) {
            thinking += delta.reasoning;
            options.onThinking?.(delta.reasoning);
          }
          if (parsed.usage) {
            usage = {
              prompt_tokens: parsed.usage.prompt_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
            };
          }
        } catch {
          // Skip malformed data
        }
      }
    }

    return {
      content: fullContent,
      thinking: thinking || undefined,
      usage,
    };
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    const key = this.#getApiKey(apiKey);

    try {
      const response = await fetch(`${this.#baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://agem.local",
        },
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          context_length: number;
          description?: string;
          pricing?: { prompt: string; completion: string };
        }>;
      };

      return (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        provider: "openrouter" as const,
        context_length: m.context_length,
        description: m.description,
        pricing: m.pricing,
        type: m.id.includes("embed") ? "embedding" as const : "chat" as const,
      }));
    } catch (error) {
      console.error("[LLM] Failed to list OpenRouter models:", error);
      return [];
    }
  }
}

/* ─── Factory ─── */

/** Create the appropriate LLM provider based on configuration. */
export function createProvider(type?: LLMProviderType): LLMProvider {
  const providerType = type ?? settings.getLLMConfig().provider;
  const config = settings.all;

  switch (providerType) {
    case "ollama":
      return new OllamaProvider(config.OLLAMA_BASE_URL);
    case "openrouter":
      return new OpenRouterProvider(config.OPENROUTER_BASE_URL);
    default:
      throw new Error(`Unknown LLM provider: ${providerType}`);
  }
}

/** Get the currently active provider. */
export function getActiveProvider(): LLMProvider {
  return createProvider();
}

export type { LLMProvider };
