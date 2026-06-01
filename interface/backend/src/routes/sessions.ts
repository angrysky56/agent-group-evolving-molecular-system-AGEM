/**
 * Session Management Routes.
 *
 * CRUD operations for chat sessions.
 */

import { Router } from "express";
import type { CreateSessionRequest } from "../../../shared/types.js";
import { sessionStore } from "../services/session-store.js";
import { deleteEngineState } from "../services/state/index.js";

export const sessionsRouter = Router();

/** GET / — List all sessions (summaries). */
sessionsRouter.get("/", (_req, res) => {
  const sessions = sessionStore.list();
  res.json(sessions);
});

/** POST / — Create a new session. */
sessionsRouter.post("/", (req, res) => {
  const body = req.body as CreateSessionRequest;
  const session = sessionStore.create(body);
  res.status(201).json(session);
});

/** GET /:id — Get a session with full message history. */
sessionsRouter.get("/:id", (req, res) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

// Helper to neutralize user-provided inputs to prevent log forgery/injection
function sanitizeLog(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\r\n]/g, "_");
}

/** DELETE /:id — Delete a session. */
sessionsRouter.delete("/:id", async (req, res) => {
  const deleted = sessionStore.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  // Delete the AGEM engine state too
  try {
    await deleteEngineState(req.params.id);
    console.log(
      `[Sessions] Deleted engine state for session: ${sanitizeLog(req.params.id)}`,
    );
  } catch (err: any) {
    console.error(
      `[Sessions] Failed to delete engine state for ${sanitizeLog(req.params.id)}:`,
      err,
    );
  }
  res.json({ status: "deleted" });
});
