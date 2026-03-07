/**
 * System Management Routes.
 *
 * Configuration, model listing, and health status endpoints.
 */

import { Router } from "express";
import { settings } from "../config.js";
import { createProvider } from "../services/llm.js";
import type { LLMProviderType } from "../../../shared/types.js";

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
    req.headers["x-openrouter-key"]?.toString();

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
