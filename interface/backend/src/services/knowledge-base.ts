/**
 * Knowledge Base Service.
 *
 * File I/O service for the `knowledge_base/` folder.
 * Lists, reads, writes, and manages persistent artifacts
 * such as reports, analysis, and AGEM outputs.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { Artifact, KnowledgeFile } from "../../../shared/types.js";
import { settings } from "../config.js";

/* ─── Default Directory Structure ─── */

const DEFAULT_SUBDIRS = [
  "reports",
  "analysis",
  "outputs",
  "sessions",
] as const;

/* ─── Knowledge Base Service ─── */

class KnowledgeBaseService {
  #basePath: string;

  constructor() {
    this.#basePath = settings.all.KNOWLEDGE_BASE_PATH;
    this.#ensureStructure();
  }

  /** Create the knowledge base directory structure if it doesn't exist. */
  #ensureStructure(): void {
    if (!existsSync(this.#basePath)) {
      mkdirSync(this.#basePath, { recursive: true });
    }

    for (const dir of DEFAULT_SUBDIRS) {
      const dirPath = join(this.#basePath, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
    }

    // Create a README if it doesn't exist
    const readmePath = join(this.#basePath, "README.md");
    if (!existsSync(readmePath)) {
      writeFileSync(
        readmePath,
        [
          "# AGEM Knowledge Base",
          "",
          "This folder contains persistent outputs from the AGEM system.",
          "",
          "## Directories",
          "",
          "- **reports/** — Generated analysis reports",
          "- **analysis/** — Sheaf and TNA analysis outputs",
          "- **outputs/** — General outputs and artifacts",
          "- **sessions/** — Chat session history (JSON)",
          "",
        ].join("\n"),
        "utf-8"
      );
    }
  }

  /** List contents of the knowledge base recursively. */
  list(subPath = ""): KnowledgeFile[] {
    const targetPath = resolve(this.#basePath, subPath);

    if (!existsSync(targetPath)) return [];

    try {
      const entries = readdirSync(targetPath);

      return entries
        .filter((name) => !name.startsWith("."))
        .map((name): KnowledgeFile => {
          const fullPath = join(targetPath, name);
          const stat = statSync(fullPath);
          const relativePath = relative(this.#basePath, fullPath);

          if (stat.isDirectory()) {
            return {
              path: relativePath,
              name,
              type: "directory",
              modified: stat.mtime.toISOString(),
              children: this.list(relativePath),
            };
          }

          return {
            path: relativePath,
            name,
            type: "file",
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch (error) {
      console.error("[KnowledgeBase] Failed to list:", error);
      return [];
    }
  }

  /** Read a specific file from the knowledge base. */
  read(filePath: string): string | null {
    const fullPath = resolve(this.#basePath, filePath);

    // Security: ensure path stays within knowledge base
    if (!fullPath.startsWith(this.#basePath)) {
      console.error("[KnowledgeBase] Path traversal blocked:", filePath);
      return null;
    }

    if (!existsSync(fullPath)) return null;

    try {
      return readFileSync(fullPath, "utf-8");
    } catch (error) {
      console.error("[KnowledgeBase] Failed to read:", error);
      return null;
    }
  }

  /** Save an artifact to the knowledge base. */
  saveArtifact(artifact: Artifact): string {
    const dir = this.#resolveArtifactDir(artifact.type);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const filename = artifact.path
      ? basename(artifact.path)
      : `${artifact.type}_${Date.now()}.md`;

    const fullPath = join(dir, filename);
    writeFileSync(fullPath, artifact.content, "utf-8");

    return relative(this.#basePath, fullPath);
  }

  /** Write arbitrary content to a path in the knowledge base. */
  write(filePath: string, content: string): boolean {
    const fullPath = resolve(this.#basePath, filePath);

    // Security: ensure path stays within knowledge base
    if (!fullPath.startsWith(this.#basePath)) {
      console.error("[KnowledgeBase] Path traversal blocked:", filePath);
      return false;
    }

    try {
      const dir = resolve(fullPath, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, content, "utf-8");
      return true;
    } catch (error) {
      console.error("[KnowledgeBase] Failed to write:", error);
      return false;
    }
  }

  /** Resolve the target directory for an artifact type. */
  #resolveArtifactDir(type: Artifact["type"]): string {
    const dirMap: Record<Artifact["type"], string> = {
      report: "reports",
      analysis: "analysis",
      graph_snapshot: "outputs",
      agent_summary: "outputs",
      code: "outputs",
      markdown: "outputs",
    };

    return join(this.#basePath, dirMap[type] ?? "outputs");
  }
}

/** Singleton knowledge base service. */
export const knowledgeBase = new KnowledgeBaseService();
