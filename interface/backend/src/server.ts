/**
 * AGEM Backend Server.
 *
 * Express application with CORS, SSE streaming, and API routing.
 * Entry point: `tsx watch src/server.ts` for development.
 */

import cors from "cors";
import express from "express";
import { settings } from "./config.js";
import { chatRouter } from "./routes/chat.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { sessionsRouter } from "./routes/sessions.js";
import { systemRouter } from "./routes/system.js";
import { skillRegistry } from "./services/skills.js";
import { mcpManager } from "./services/mcp.js";

const app = express();

/* ─── Middleware ─── */

app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-OpenRouter-Key", "X-Api-Key"],
  }),
);

app.use(express.json({ limit: "10mb" }));

/* ─── API Routes ─── */

const API_PREFIX = "/api/v1";

app.use(`${API_PREFIX}/chat`, chatRouter);
app.use(`${API_PREFIX}/sessions`, sessionsRouter);
app.use(`${API_PREFIX}/system`, systemRouter);
app.use(`${API_PREFIX}/knowledge`, knowledgeRouter);

/* ─── Root Health Check ─── */

app.get("/", (_req, res) => {
  res.json({
    message: "AGEM Backend is Running",
    docs: `${API_PREFIX}/system/status`,
    version: "0.1.0",
  });
});

/* ─── Error Handling ─── */

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[Server Error]", err.message);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  },
);

/* ─── Start Server ─── */

const { PORT, HOST } = settings.all;

const server = app.listen(PORT, HOST, () => {
  const config = settings.getLLMConfig();
  console.log(`
╔══════════════════════════════════════════════╗
║   AGEM Backend Server v0.1.0                ║
╠══════════════════════════════════════════════╣
║  → Server:    http://${HOST}:${PORT}              ║
║  → Provider:  ${config.provider.padEnd(30)}║
║  → Model:     ${config.model.padEnd(30).slice(0, 30)}║
║  → API Docs:  http://localhost:${PORT}/api/v1     ║
╚══════════════════════════════════════════════╝
  `);

  // Initialize Skills Registry
  skillRegistry.initialize().catch((err) => {
    console.error("[SkillRegistry] Failed to start:", err);
  });

  // Initialize MCP Manager
  mcpManager.initialize().catch((err) => {
    console.error("[MCPManager] Failed to start:", err);
  });
});

/* ─── Graceful Shutdown ─── */

async function shutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);
  try {
    await mcpManager.close();
  } catch {
    // Best-effort
  }
  server.close(() => {
    console.log("[Server] HTTP server closed. Goodbye!");
    process.exit(0);
  });
  // Force exit after 5 seconds if cleanup hangs
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;
