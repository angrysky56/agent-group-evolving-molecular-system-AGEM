/**
 * Chat API Routes.
 *
 * Handles chat completions with SSE streaming, integrating
 * the LLM provider and session persistence.
 */

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { ChatMessage, ChatRequest } from "../../../shared/types.js";
import { createProvider } from "../services/llm.js";
import { sessionStore } from "../services/session-store.js";

export const chatRouter = Router();

/**
 * POST /chat/completions
 *
 * Stream a chat completion via SSE.
 * Accepts a message and optional session_id, model, and provider.
 * Streams token, thinking, and usage events back to the client.
 */
chatRouter.post("/completions", async (req, res) => {
  const body = req.body as ChatRequest;
  const { message, model, provider: providerType } = body;
  let sessionId = body.session_id;

  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  /** Helper to send an SSE event. */
  const sendEvent = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Resolve or create session
    if (!sessionId) {
      const session = sessionStore.create({ model, provider: providerType });
      sessionId = session.id;
    }

    sendEvent("session", { session_id: sessionId });

    // Persist user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    sessionStore.addMessage(sessionId, userMessage);

    // Build message history for LLM context
    const session = sessionStore.get(sessionId);
    const historyMessages = (session?.messages ?? [userMessage]).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Get API key from request headers (for OpenRouter)
    const apiKey =
      req.headers["authorization"]?.toString().replace("Bearer ", "") ??
      req.headers["x-openrouter-key"]?.toString();

    // Create provider and stream
    const llmProvider = createProvider(providerType);
    let fullContent = "";
    let thinking = "";

    const result = await llmProvider.chat({
      messages: historyMessages,
      model,
      onToken: (token) => {
        fullContent += token;
        sendEvent("token", { content: token });
      },
      onThinking: (chunk) => {
        thinking += chunk;
        sendEvent("thinking", { content: chunk });
      },
      ...(apiKey ? { apiKey } : {}),
    });

    // Send usage
    sendEvent("usage", result.usage);

    // Persist assistant message
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: "assistant",
      content: result.content,
      timestamp: Date.now(),
      metadata: {
        model,
        provider: providerType,
        tokens_used: result.usage.total_tokens,
        thinking: result.thinking,
      },
    };
    sessionStore.addMessage(sessionId, assistantMessage);

    // Signal completion
    sendEvent("done", { session_id: sessionId });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    sendEvent("error", { message: errorMessage });
  } finally {
    res.end();
  }
});

/**
 * GET /chat/history/:sessionId
 *
 * Get the message history for a specific session.
 */
chatRouter.get("/history/:sessionId", (req, res) => {
  const session = sessionStore.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session.messages);
});
