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

async function json<T>(url: string, init?: RequestInit): Promise<T> {
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
  return res.json() as Promise<T>;
}

/* ─── Sessions ─── */

export async function listSessions(): Promise<ChatSession[]> {
  return json(`${BASE}/sessions`);
}

export async function getSession(id: string): Promise<ChatSession> {
  return json(`${BASE}/sessions/${id}`);
}

export async function createSession(
  data: CreateSessionRequest = {}
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
  apiKey?: string
): AbortController {
  const controller = new AbortController();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload) as SSEEvent;
            switch (event.type) {
              case "token":
                callbacks.onToken(event.content ?? "");
                break;
              case "thinking":
                callbacks.onThinking?.(event.content ?? "");
                break;
              case "artifact":
                callbacks.onArtifact?.(
                  event.metadata as Record<string, unknown>
                );
                break;
              case "done":
                if (event.metadata?.message) {
                  callbacks.onDone(event.metadata.message as ChatMessage);
                }
                break;
              case "error":
                callbacks.onError(event.content ?? "Unknown error");
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
  config: Partial<SystemConfig>
): Promise<SystemConfig> {
  return json(`${BASE}/system/config`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function listModels(provider?: string): Promise<ModelInfo[]> {
  const params = provider ? `?provider=${provider}` : "";
  return json(`${BASE}/system/models${params}`);
}

export async function getStatus(): Promise<{
  status: string;
  uptime: number;
  provider: string;
}> {
  return json(`${BASE}/system/status`);
}

/* ─── Knowledge Base ─── */

export async function listKnowledge(
  dir?: string
): Promise<KnowledgeFile[]> {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : "";
  return json(`${BASE}/knowledge${params}`);
}

export async function readKnowledge(filePath: string): Promise<string> {
  const res = await fetch(
    `${BASE}/knowledge/${encodeURIComponent(filePath)}`
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = (await res.json()) as { content: string };
  return data.content;
}
