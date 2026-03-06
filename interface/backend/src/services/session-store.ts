/**
 * Session Store Service.
 *
 * Persists chat sessions as JSON files under the knowledge base directory.
 * Each session gets its own file: `knowledge_base/sessions/{session_id}.json`
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  ChatMessage,
  ChatSession,
  CreateSessionRequest,
  LLMProviderType,
} from "../../../shared/types.js";
import { settings } from "../config.js";

/* ─── Internal Session File Shape ─── */

interface SessionFile {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  model?: string;
  provider?: LLMProviderType;
  messages: ChatMessage[];
}

/* ─── Session Store ─── */

class SessionStore {
  #sessionsDir: string;

  constructor() {
    this.#sessionsDir = resolve(
      settings.all.KNOWLEDGE_BASE_PATH,
      "sessions"
    );
    this.#ensureDir();
  }

  /** Ensure the sessions directory exists. */
  #ensureDir(): void {
    if (!existsSync(this.#sessionsDir)) {
      mkdirSync(this.#sessionsDir, { recursive: true });
    }
  }

  /** Get file path for a session. */
  #filePath(sessionId: string): string {
    return join(this.#sessionsDir, `${sessionId}.json`);
  }

  /** Read a session file from disk. */
  #readSession(sessionId: string): SessionFile | null {
    const path = this.#filePath(sessionId);
    if (!existsSync(path)) return null;

    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as SessionFile;
    } catch (error) {
      console.error(`[Sessions] Failed to read ${sessionId}:`, error);
      return null;
    }
  }

  /** Write a session file to disk. */
  #writeSession(session: SessionFile): void {
    this.#ensureDir();
    const path = this.#filePath(session.id);
    writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
  }

  /** Create a new session. */
  create(request?: CreateSessionRequest): ChatSession {
    const now = new Date().toISOString();
    const session: SessionFile = {
      id: uuidv4(),
      title: request?.title ?? `Session ${new Date().toLocaleDateString()}`,
      created_at: now,
      updated_at: now,
      model: request?.model,
      provider: request?.provider,
      messages: [],
    };

    this.#writeSession(session);
    return this.#toSummary(session);
  }

  /** List all sessions (summaries only, no messages). */
  list(): ChatSession[] {
    this.#ensureDir();

    try {
      const files = readdirSync(this.#sessionsDir).filter((f) =>
        f.endsWith(".json")
      );

      return files
        .map((f) => {
          const id = f.replace(".json", "");
          const session = this.#readSession(id);
          return session ? this.#toSummary(session) : null;
        })
        .filter((s): s is ChatSession => s !== null)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
    } catch (error) {
      console.error("[Sessions] Failed to list sessions:", error);
      return [];
    }
  }

  /** Get a session with full message history. */
  get(sessionId: string): ChatSession | null {
    const session = this.#readSession(sessionId);
    if (!session) return null;

    return {
      ...this.#toSummary(session),
      messages: session.messages,
    };
  }

  /** Add a message to a session. */
  addMessage(sessionId: string, message: ChatMessage): void {
    let session = this.#readSession(sessionId);

    if (!session) {
      // Auto-create if session doesn't exist
      const created = this.create({ title: `Session ${sessionId.slice(0, 8)}` });
      session = this.#readSession(created.id);
      if (!session) return;
      // Re-assign the provided sessionId
      session.id = sessionId;
    }

    session.messages.push(message);
    session.updated_at = new Date().toISOString();

    // Auto-title from first user message if still default
    if (
      session.title.startsWith("Session ") &&
      message.role === "user" &&
      session.messages.filter((m) => m.role === "user").length === 1
    ) {
      session.title = message.content.slice(0, 80).trim();
      if (message.content.length > 80) session.title += "…";
    }

    this.#writeSession(session);
  }

  /** Delete a session. */
  delete(sessionId: string): boolean {
    const path = this.#filePath(sessionId);
    if (!existsSync(path)) return false;

    try {
      unlinkSync(path);
      return true;
    } catch (error) {
      console.error(`[Sessions] Failed to delete ${sessionId}:`, error);
      return false;
    }
  }

  /** Convert a session file to its summary representation. */
  #toSummary(session: SessionFile): ChatSession {
    return {
      id: session.id,
      title: session.title,
      created_at: session.created_at,
      updated_at: session.updated_at,
      message_count: session.messages.length,
      model: session.model,
      provider: session.provider,
    };
  }
}

/** Singleton session store. */
export const sessionStore = new SessionStore();
