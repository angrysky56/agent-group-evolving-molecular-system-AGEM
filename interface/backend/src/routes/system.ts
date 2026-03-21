/**
 * System Management Routes.
 *
 * Configuration, model listing, and health status endpoints.
 */

import { Router } from "express";
import { settings } from "../config.js";
import { createProvider } from "../services/llm.js";
import { agemBridge } from "../services/agem-bridge.js";
import type { LLMProviderType, SystemEvent } from "../../../shared/types.js";

export const systemRouter = Router();

const startTime = Date.now();

/** GET /config — Get current system configuration. */
systemRouter.get("/config", (_req, res) => {
  res.json(settings.toSystemConfig());
});

/** POST /config — Update system configuration. */
systemRouter.post("/config", (req, res) => {
  const updates = req.body as Record<string, unknown>;
  const success = settings.update(updates);

  if (success) {
    res.json({ status: "updated", config: settings.toSystemConfig() });
  } else {
    res.status(400).json({ error: "Failed to update configuration" });
  }
});

/** GET /models — List available models from the active provider. */
systemRouter.get("/models", async (req, res) => {
  const providerParam = req.query.provider as string | undefined;
  const apiKey =
    req.headers["authorization"]?.toString().replace("Bearer ", "") ??
    req.headers["x-openrouter-key"]?.toString() ??
    req.headers["x-api-key"]?.toString();

  try {
    const provider = createProvider(
      (providerParam as LLMProviderType) || undefined,
    );

    const models = await (
      provider as { listModels: (apiKey?: string) => Promise<unknown[]> }
    ).listModels(apiKey);
    res.json(models);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /status — Health check and system status. */
systemRouter.get("/status", (_req, res) => {
  const config = settings.getLLMConfig();

  res.json({
    status: "ok",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    provider: config.provider,
    model: config.model,
    agem_engine: true,
  });
});

/** GET /state — Get current AGEM engine state snapshot. */
systemRouter.get("/state", (_req, res) => {
  try {
    const state = agemBridge.getState();
    res.json(state);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/** GET /soc — Get current SOC metrics with history. */
systemRouter.get("/soc", (_req, res) => {
  try {
    res.json(agemBridge.getSOCMetrics());
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /events — Server-Sent Events stream for AGEM system events.
 *
 * Independent of chat completions SSE. Streams system events
 * (SOC metrics, phase transitions, regime changes, obstructions, etc.)
 * to the dashboard frontend in real-time.
 */
systemRouter.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Register this client for broadcasts
  agemBridge.addSSEClient(res);

  // Send current state immediately so frontend hydrates on reload
  try {
    const currentState = agemBridge.getState();
    if (currentState.iteration > 0) {
      const initEvent: SystemEvent = {
        id: "init-state",
        type: "agem:state-update",
        timestamp: Date.now(),
        iteration: currentState.iteration,
        severity: "info",
        summary: "Initial state on connect",
        data: { state: currentState },
      };
      res.write(`event: system_event\ndata: ${JSON.stringify(initEvent)}\n\n`);
    }
  } catch {
    // Engine may not be initialized yet
  }

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    agemBridge.removeSSEClient(res);
  });
});


/**
 * POST /embeddings — Get embeddings from the active provider.
 *
 * Body: { text: string, model?: string }
 * Returns: { embedding: number[], model: string, dimensions: number }
 */
systemRouter.post("/embeddings", async (req, res) => {
  const { text, model } = req.body as { text?: string; model?: string };

  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    let resolvedProvider = settings.getLLMConfig().provider;
    if (model) {
      if (model.startsWith("ollama:")) resolvedProvider = "ollama";
      else if (model.startsWith("openrouter:")) resolvedProvider = "openrouter";
      else if (model.startsWith("anthropic:")) resolvedProvider = "anthropic";
    }

    const provider = createProvider(resolvedProvider);
    const embedding = await provider.getEmbedding(text, model);

    if (!embedding || embedding.length === 0) {
      res.status(502).json({ error: "Embedding provider returned empty result" });
      return;
    }

    res.json({
      embedding,
      model: model ?? settings.getLLMConfig().embedding_model,
      dimensions: embedding.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: msg });
  }
});
