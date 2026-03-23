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
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
  }>;
  model?: string;
  tools?: any[];
  apiKey?: string;
  onToken?: StreamCallback;
  onThinking?: ThinkingCallback;
  signal?: AbortSignal;
}

/** Result of a chat completion. */
export interface ChatCompletionResult {
  content: string;
  thinking?: string;
  tool_calls?: any[];
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
  listModels(apiKey?: string): Promise<ModelInfo[]>;
  getEmbedding(text: string, model?: string): Promise<number[]>;
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
    let model = options.model ?? config.model;
    if (model.startsWith("ollama:")) model = model.substring(7);

    const buildBody = (includeTools: boolean) => {
      const body: any = {
        model,
        messages: options.messages,
        stream: true,
        options: {
          num_ctx: 32000, // Larger context improves tool calling reliability
        },
      };
      if (includeTools && options.tools && options.tools.length > 0) {
        body.tools = options.tools;
      }
      return body;
    };

    const initialBody = buildBody(true);
    const fs = await import('fs');
    fs.writeFileSync('/tmp/ollama_req.json', JSON.stringify(initialBody, null, 2));

    let response = await fetch(`${this.#baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialBody),
      signal: options.signal,
    });

    // Handle models that don't support tools with a fallback retry
    if (response.status === 400) {
      const errorData = (await response.json().catch(() => ({}))) as any;
      if (
        errorData.error &&
        typeof errorData.error === "string" &&
        errorData.error.includes("does not support tools")
      ) {
        console.warn(
          `[LLM] Model '${model}' does not support tools. Retrying without tools.`,
        );

        response = await fetch(`${this.#baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(false)),
          signal: options.signal,
        });
      }
    }

    if (!response.ok) {
      throw new Error(
        `Ollama chat failed: ${response.status} ${response.statusText}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Ollama: No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let toolCalls: any[] | undefined = undefined;
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
            message?: { content?: string; tool_calls?: any[] };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };

          if (parsed.message?.content) {
            fullContent += parsed.message.content;
            options.onToken?.(parsed.message.content);
          }

          if (parsed.message?.tool_calls) {
            // Ollama native format: {function: {name, arguments: OBJECT}}
            // Normalize to add id/type but keep arguments as-is (chat.ts handles both)
            toolCalls = parsed.message.tool_calls.map((tc: any, i: number) => ({
              id: tc.id ?? `ollama_call_${Date.now()}_${i}`,
              type: tc.type ?? "function",
              function: {
                name: tc.function?.name ?? tc.name,
                arguments: tc.function?.arguments ?? {},
              },
            }));
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

    // Fallback: if model output tool calls as text, extract them
    if (!toolCalls && options.tools && options.tools.length > 0) {
      const extracted = this.#extractToolCallsFromContent(fullContent);
      if (extracted) {
        console.log(`[LLM] Extracted ${extracted.length} tool call(s) from content text for model '${model}'`);
        toolCalls = extracted;
        // Clear content since it was actually a tool call, not a response
        fullContent = "";
      }
    }

    return {
      content: fullContent,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  /**
   * Some Ollama models accept tools but output calls as JSON text
   * instead of using the structured tool_calls field. Detect and extract.
   */
  #extractToolCallsFromContent(content: string): any[] | undefined {
    if (!content) return undefined;
    const trimmed = content.trim();

    // Pattern 1: {"tool_name": "...", "input": {...}}  (nemotron style)
    // Pattern 2: {"name": "...", "arguments": {...}}
    // Pattern 3: ```json\n{...}\n```
    let jsonStr = trimmed;

    // Strip markdown code fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    // Only try parsing if it looks like JSON
    if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) return undefined;

    try {
      const parsed = JSON.parse(jsonStr);

      // Pattern 1: nemotron style
      if (parsed.tool_name && (parsed.input || parsed.parameters || parsed.arguments)) {
        return [{
          id: `call_${Date.now()}`,
          type: "function",
          function: {
            name: parsed.tool_name,
            arguments: JSON.stringify(parsed.input ?? parsed.parameters ?? parsed.arguments ?? {}),
          },
        }];
      }

      // Pattern 2: OpenAI-ish style
      if (parsed.name && (parsed.arguments || parsed.parameters)) {
        return [{
          id: `call_${Date.now()}`,
          type: "function",
          function: {
            name: parsed.name,
            arguments: JSON.stringify(parsed.arguments ?? parsed.parameters ?? {}),
          },
        }];
      }

      // Pattern 3: Array of tool calls
      if (Array.isArray(parsed)) {
        const calls = parsed
          .filter((t: any) => t.tool_name || t.name || t.function?.name)
          .map((t: any, i: number) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: t.tool_name ?? t.name ?? t.function?.name,
              arguments: JSON.stringify(
                t.input ?? t.arguments ?? t.parameters ?? t.function?.arguments ?? {},
              ),
            },
          }));
        if (calls.length > 0) return calls;
      }
    } catch {
      // Not valid JSON — that's fine, it's just text
    }

    return undefined;
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

      // Query each model's actual capabilities via /api/show
      const models: ModelInfo[] = [];
      for (const m of data.models ?? []) {
        const nameLower = m.name.toLowerCase();
        const isEmbedding =
          nameLower.includes("embed") ||
          nameLower.includes("nomic") ||
          nameLower.includes("bert");

        // Check capabilities from /api/show (fast local call)
        let supportsTools = false;
        let contextLength = 0;
        try {
          const showResp = await fetch(`${this.#baseUrl}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: m.name }),
          });
          if (showResp.ok) {
            const showData = (await showResp.json()) as {
              capabilities?: string[];
              model_info?: Record<string, unknown>;
            };
            supportsTools = showData.capabilities?.includes("tools") ?? false;
            // Extract context_length from model_info if available
            const infoKeys = Object.keys(showData.model_info ?? {});
            const ctxKey = infoKeys.find((k) => k.endsWith(".context_length"));
            if (ctxKey && showData.model_info) {
              contextLength = (showData.model_info[ctxKey] as number) ?? 0;
            }
          }
        } catch {
          // /api/show failed — leave defaults
        }

        models.push({
          id: m.name,
          name: m.name,
          provider: "ollama" as const,
          context_length: contextLength,
          description: m.details?.parameter_size
            ? `${m.details.family ?? ""} ${m.details.parameter_size}`.trim()
            : undefined,
          type: isEmbedding ? ("embedding" as const) : ("chat" as const),
          supports_tools: supportsTools,
        });
      }

      return models;
    } catch (error) {
      console.error("[LLM] Failed to list Ollama models:", error);
      return [];
    }
  }

  /** Get embeddings via Ollama /api/embeddings endpoint. */
  async getEmbedding(text: string, model?: string): Promise<number[]> {
    let embModel = model ?? settings.all.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text:latest";
    if (embModel.startsWith("ollama:")) embModel = embModel.substring(7);
    try {
      const response = await fetch(`${this.#baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embModel, prompt: text }),
      });
      if (!response.ok) {
        console.error(`[LLM] Ollama embedding failed: ${response.status}`);
        return [];
      }
      const data = (await response.json()) as { embedding?: number[] };
      return data.embedding ?? [];
    } catch (error) {
      console.error("[LLM] Ollama embedding error:", error);
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

  /** Get the API key, preferring runtime header over provider-specific config. */
  #getApiKey(headerKey?: string): string {
    return headerKey ?? settings.all.OPENROUTER_API_KEY;
  }

  async chat(
    options: ChatCompletionOptions & { apiKey?: string },
  ): Promise<ChatCompletionResult> {
    let model = options.model ?? settings.all.OPENROUTER_MODEL;
    if (model.startsWith("openrouter:")) model = model.substring(11);
    const apiKey = this.#getApiKey(options.apiKey);

    const bodyObj: any = {
      model,
      messages: options.messages,
      stream: true,
    };
    if (options.tools && options.tools.length > 0) {
      bodyObj.tools = options.tools;
    }

    const response = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://agem.local",
        "X-Title": "AGEM Molecular Agent System",
      },
      body: JSON.stringify(bodyObj),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `OpenRouter chat failed: ${response.status} — ${errorText}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenRouter: No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let thinking = "";
    let toolCallsMap: Record<number, any> = {};
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Read timeout: if no data arrives for 60s, abort the stream
    const READ_TIMEOUT_MS = 60_000;

    while (true) {
      const readPromise = reader.read();
      const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => {
          console.warn("[LLM] OpenRouter read timeout after 60s — aborting stream");
          reader.cancel().catch(() => {});
          resolve({ value: undefined, done: true });
        }, READ_TIMEOUT_MS),
      );

      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning?: string;
                tool_calls?: any[];
              };
            }>;
            usage?: any;
            error?: { message?: string; code?: number; type?: string };
          };

          // Handle OpenRouter error responses embedded in stream
          if (parsed.error) {
            const errMsg = parsed.error.message ?? "Unknown stream error";
            console.error(`[LLM] OpenRouter stream error: ${errMsg} (code: ${parsed.error.code})`);
            if (errMsg.includes("rate limit") || parsed.error.code === 429) {
              throw new Error(`OpenRouter rate limited: ${errMsg}`);
            }
            throw new Error(`OpenRouter stream error: ${errMsg}`);
          }

          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            options.onToken?.(delta.content);
          }
          if (delta?.reasoning) {
            thinking += delta.reasoning;
            options.onThinking?.(delta.reasoning);
          }
          if (delta?.tool_calls) {
            for (const call of delta.tool_calls) {
              const idx = call.index ?? 0;
              if (!toolCallsMap[idx])
                toolCallsMap[idx] = {
                  id: call.id,
                  type: call.type,
                  function: { name: "", arguments: "" },
                };
              if (call.id) toolCallsMap[idx].id = call.id;
              if (call.function?.name)
                toolCallsMap[idx].function.name += call.function.name;
              if (call.function?.arguments)
                toolCallsMap[idx].function.arguments += call.function.arguments;
            }
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

    let finalToolCalls = Object.values(toolCallsMap);
    if (finalToolCalls.length === 0) finalToolCalls = undefined as any;

    return {
      content: fullContent,
      thinking: thinking || undefined,
      tool_calls: finalToolCalls,
      usage,
    };
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    const key = this.#getApiKey(apiKey);
    const authHeaders = {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://agem.local",
    };

    try {
      const response = await fetch(`${this.#baseUrl}/models`, {
        headers: authHeaders,
      });
      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          name: string;
          context_length?: number;
          description?: string;
          pricing?: {
            prompt: string;
            completion: string;
          };
          supported_parameters?: string[];
          top_provider?: { context_length?: number };
        }>;
      };

      const models: ModelInfo[] = (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: "openrouter" as const,
        context_length: m.context_length ?? m.top_provider?.context_length ?? 0,
        description: m.description,
        type: m.id.toLowerCase().includes("embed")
          ? ("embedding" as const)
          : ("chat" as const),
        pricing: m.pricing,
        supports_tools: m.supported_parameters?.includes("tools") ?? false,
      }));

      // Fetch embedding models from separate endpoint (per graph-rlm pattern)
      try {
        const embResponse = await fetch(`${this.#baseUrl}/embeddings/models`, {
          headers: authHeaders,
        });
        if (embResponse.ok) {
          const embData = (await embResponse.json()) as {
            data?: Array<{ id: string; name?: string; context_length?: number; pricing?: any }>;
          };
          for (const em of embData.data ?? []) {
            // Skip if already in chat models list
            if (!models.some((m) => m.id === em.id)) {
              models.push({
                id: em.id,
                name: em.name ?? em.id,
                provider: "openrouter" as const,
                context_length: em.context_length ?? 0,
                type: "embedding" as const,
                pricing: em.pricing,
                supports_tools: false,
              });
            }
          }
        }
      } catch {
        // Embedding models endpoint may not be available
      }

      return models;
    } catch (error) {
      console.error("[LLM] Failed to list OpenRouter models:", error);
      return [];
    }
  }

  /** Get embeddings via OpenRouter /embeddings endpoint (OpenAI format). */
  async getEmbedding(text: string, model?: string): Promise<number[]> {
    let embModel = model ?? settings.all.OPENROUTER_EMBEDDING_MODEL ?? "google/gemini-embedding-001";
    if (embModel.startsWith("openrouter:")) embModel = embModel.substring(11);
    const key = this.#getApiKey();
    try {
      const response = await fetch(`${this.#baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "https://agem.local",
        },
        body: JSON.stringify({ model: embModel, input: text }),
      });
      if (!response.ok) {
        console.error(`[LLM] OpenRouter embedding failed: ${response.status}`);
        return [];
      }
      const data = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      return data.data?.[0]?.embedding ?? [];
    } catch (error) {
      console.error("[LLM] OpenRouter embedding error:", error);
      return [];
    }
  }
}

/* ─── Anthropic Provider ─── */

class AnthropicProvider implements LLMProvider {
  readonly type: LLMProviderType = "anthropic";
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Get the API key, preferring runtime header over provider-specific config. */
  #getApiKey(headerKey?: string): string {
    return headerKey ?? settings.all.ANTHROPIC_API_KEY;
  }

  async chat(
    options: ChatCompletionOptions & { apiKey?: string },
  ): Promise<ChatCompletionResult> {
    const config = settings.getLLMConfig();
    let model = options.model ?? config.model;
    if (model.startsWith("anthropic:")) model = model.substring(10);
    const apiKey = this.#getApiKey(options.apiKey);

    // Filter out system messages since Anthropic puts it in a top-level `system` field
    const systemMessage = options.messages.find((m) => m.role === "system");
    const otherMessages = options.messages.filter((m) => m.role !== "system");

    // Convert OpenAI style tool calls to Anthropic's style
    const tools = options.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    // Convert tool format in messages
    const anthropicMessages = otherMessages.map((m) => {
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant",
          content: m.tool_calls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input:
              typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments || "{}")
                : tc.function.arguments || {},
          })),
        };
      } else if (m.role === "tool" || m.tool_call_id) {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    const bodyObj: any = {
      model,
      messages: anthropicMessages,
      max_tokens: 8192,
      stream: true,
    };
    if (systemMessage) {
      bodyObj.system = systemMessage.content;
    }
    if (tools && tools.length > 0) {
      bodyObj.tools = tools;
    }

    const response = await fetch(`${this.#baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(bodyObj),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Anthropic chat failed: ${response.status} — ${errorText}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Anthropic: No response body reader available");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let toolCalls: any[] = [];
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
          const evt = JSON.parse(dataStr);
          if (evt.type === "message_start") {
            usage.prompt_tokens = evt.message.usage.input_tokens;
          } else if (
            evt.type === "content_block_delta" &&
            evt.delta.type === "text_delta"
          ) {
            fullContent += evt.delta.text;
            options.onToken?.(evt.delta.text);
          } else if (
            evt.type === "content_block_start" &&
            evt.content_block.type === "tool_use"
          ) {
            // Anthropic tool starts here...
            toolCalls[evt.index] = {
              id: evt.content_block.id,
              type: "function",
              function: {
                name: evt.content_block.name,
                arguments: "",
              },
            };
          } else if (
            evt.type === "content_block_delta" &&
            evt.delta.type === "input_json_delta"
          ) {
            toolCalls[evt.index].function.arguments += evt.delta.partial_json;
          } else if (evt.type === "message_delta") {
            usage.completion_tokens = evt.usage.output_tokens;
          }
        } catch {
          // Ignore incomplete/malformed chunks
        }
      }
    }

    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    let finalToolCalls = toolCalls.filter(Boolean);
    if (finalToolCalls.length === 0) finalToolCalls = undefined as any;

    return {
      content: fullContent,
      tool_calls: finalToolCalls,
      usage,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic API does not support dynamically listing models right now AFAIK.
    // Hardcode some modern models.
    return [
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        provider: "anthropic",
        context_length: 200000,
        type: "chat",
      },
      {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        provider: "anthropic",
        context_length: 200000,
        type: "chat",
      },
    ];
  }

  /** Anthropic doesn't have a public embedding API — return empty. */
  async getEmbedding(_text: string, _model?: string): Promise<number[]> {
    console.warn("[LLM] Anthropic does not provide an embedding API.");
    return [];
  }
}

/* ─── Factory ─── */

/** Create the appropriate LLM provider based on configuration. */
export function createProvider(type?: LLMProviderType): LLMProvider {
  const providerType = type ?? settings.getLLMConfig().provider;
  const allConfig = settings.all;

  // Use provider-specific config, not just the active provider's config
  switch (providerType) {
    case "ollama":
      return new OllamaProvider(
        allConfig.OLLAMA_BASE_URL || "http://localhost:11434",
      );
    case "openrouter":
      return new OpenRouterProvider(
        allConfig.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      );
    case "anthropic":
      return new AnthropicProvider(
        allConfig.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
      );
    default:
      throw new Error(`Unknown LLM provider: ${providerType}`);
  }
}

export function getActiveProvider(): LLMProvider {
  return createProvider();
}

export type { LLMProvider };
