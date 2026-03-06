/**
 * Knowledge Base Routes.
 *
 * File listing and content retrieval from the knowledge base.
 */

import { Router } from "express";
import { knowledgeBase } from "../services/knowledge-base.js";

export const knowledgeRouter = Router();

/** GET / — List all knowledge base contents (recursive). */
knowledgeRouter.get("/", (_req, res) => {
  const entries = knowledgeBase.list();
  res.json(entries);
});

/** GET /read?path=... — Read a specific file. */
knowledgeRouter.get("/read", (req, res) => {
  const filePath = req.query.path as string | undefined;
  if (!filePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }

  const content = knowledgeBase.read(filePath);
  if (content === null) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  res.json({ path: filePath, content });
});

/** POST / — Write/save content to the knowledge base. */
knowledgeRouter.post("/", (req, res) => {
  const { path: filePath, content } = req.body as {
    path?: string;
    content?: string;
  };

  if (!filePath || !content) {
    res.status(400).json({ error: "path and content are required" });
    return;
  }

  const success = knowledgeBase.write(filePath, content);
  if (success) {
    res.status(201).json({ status: "saved", path: filePath });
  } else {
    res.status(500).json({ error: "Failed to save file" });
  }
});
