/**
 * AGEM Interface — Typed API Client.
 *
 * REST + SSE client for communicating with the Express backend.
 * All types come from the shared contract in `@shared/types`.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatSession,
  CreateSessionRequest,
  KnowledgeFile,
  ModelInfo,
  SystemConfig,
  SSEEvent,
} from "@shared/types";

const BASE = "/api/v1";

/* ─── Generic Helpers ─── */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function json<T>(
  url: string,
  init?: RequestInit,
  retries = 3,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`API ${res.status}: ${body}`);
      }
      return (await res.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's a 4xx error, don't retry (client error)
      if (lastError.message.includes("API 4")) {
        throw lastError;
      }

      const backoff = Math.min(1000 * Math.pow(2, attempt), 5000);
      await delay(backoff);
    }
  }

  throw lastError || new Error("API request failed");
}

/* ─── Sessions ─── */

export async function listSessions(): Promise<ChatSession[]> {
  return json(`${BASE}/sessions`);
}

export async function getSession(id: string): Promise<ChatSession> {
  return json(`${BASE}/sessions/${id}`);
}

export async function createSession(
  data: CreateSessionRequest = {},
): Promise<ChatSession> {
  return json(`${BASE}/sessions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteSession(id: string): Promise<void> {
  await fetch(`${BASE}/sessions/${id}`, { method: "DELETE" });
}

/* ─── Chat (SSE Streaming) ─── */

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onThinking?: (text: string) => void;
  onArtifact?: (data: Record<string, unknown>) => void;
  onAgemState?: (data: Record<string, unknown>) => void;
  onToolResult?: (tool: string, elapsedMs: number, output: string) => void;
  onClearStream?: () => void;
  onDone: (message: ChatMessage) => void;
  onError: (error: string) => void;
}

/**
 * Send a chat message and stream the response via SSE.
 * Returns an AbortController so the caller can cancel the stream.
 */
export function streamChat(
  request: ChatRequest,
  callbacks: StreamCallbacks,
  apiKey?: string,
): AbortController {
  const controller = new AbortController();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }

  fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text();
        callbacks.onError(`API ${res.status}: ${body}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) {
            if (line === "") currentEvent = ""; // Reset event type on empty line
            continue;
          }

          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const data = JSON.parse(payload);
            const eventType = currentEvent || data.type;

            switch (eventType) {
              case "token":
                callbacks.onToken(data.content ?? "");
                break;
              case "thinking":
                callbacks.onThinking?.(data.content ?? "");
                break;
              case "artifact":
                callbacks.onArtifact?.(data);
                break;
              case "agem_state":
                callbacks.onAgemState?.(data);
                break;
              case "clear_stream":
                callbacks.onClearStream?.();
                break;
              case "tool_result":
                callbacks.onToolResult?.(
                  data.tool ?? "unknown",
                  data.elapsed_ms ?? 0,
                  data.output ?? "",
                );
                break;
              case "system":
                // Tool execution progress — could display but skip for now
                break;
              case "done":
                if (data.message) {
                  callbacks.onDone(data.message);
                }
                break;
              case "error":
                callbacks.onError(
                  data.message ?? data.content ?? "Unknown error",
                );
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    })
    .catch((err: Error) => {
      if (err.name !== "AbortError") {
        callbacks.onError(err.message);
      }
    });

  return controller;
}

/* ─── System ─── */

export async function getConfig(): Promise<SystemConfig> {
  return json(`${BASE}/system/config`);
}

export async function updateConfig(
  config: Partial<SystemConfig>,
): Promise<SystemConfig> {
  return json(`${BASE}/system/config`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function listModels(
  provider?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  const params = provider ? `?provider=${provider}` : "";
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }

  return json(`${BASE}/system/models${params}`, { headers });
}

export async function getStatus(): Promise<{
  status: string;
  uptime: number;
  provider: string;
}> {
  return json(`${BASE}/system/status`);
}

/* ─── Knowledge Base ─── */

export async function listKnowledge(dir?: string): Promise<KnowledgeFile[]> {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  return json(`${BASE}/knowledge${params}`);
}

export async function readKnowledge(filePath: string): Promise<string> {
  const res = await fetch(`${BASE}/knowledge/${encodeURIComponent(filePath)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = (await res.json()) as { content: string };
  return data.content;
}


/* ─── AGEM Engine State ─── */

export async function getAgemState(): Promise<any> {
  return json(`${BASE}/system/state`);
}

export async function getAgemSOC(): Promise<any> {
  return json(`${BASE}/system/soc`);
}
