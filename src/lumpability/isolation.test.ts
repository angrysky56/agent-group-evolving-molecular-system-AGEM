/**
 * isolation.test.ts
 *
 * Module isolation test — verifies controlled cross-component imports in src/lumpability/.
 *
 * The lumpability module is allowed to import from:
 *   - src/lcm/interfaces (IEmbedder, ITokenCounter, SummaryNode, LCMEntry, EscalationLevel)
 *   - src/soc/entropy (embeddingEntropy, cosineSimilarity)
 *   - src/types/ (event type definitions)
 *   - node: built-in modules
 *
 * The lumpability module must NOT import from:
 *   - src/sheaf/ (sheaf coordination is done via MCP, not direct import)
 *   - src/tna/ (TNA integration is done via EventBus, not direct import)
 *   - src/orchestrator/ (orchestrator consumes lumpability, not the reverse)
 *
 * This ensures the lumpability module remains independently testable and
 * does not create circular dependencies with the orchestrator.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Utility: collect all non-test .ts files under a directory
// ---------------------------------------------------------------------------

function getAllTsSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...getAllTsSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Lumpability module isolation", () => {
  it("T-ISO-1: src/lumpability/ has zero imports from sheaf, tna, orchestrator", () => {
    const lumpDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(lumpDir);

    // Forbidden: direct imports from sheaf, tna, or orchestrator modules.
    // Allowed: lcm/ (interfaces), soc/ (entropy), types/ (events).
    const forbidden = ["/sheaf/", "/tna/", "/orchestrator/"];
    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        for (const pattern of forbidden) {
          if (line.includes(pattern)) {
            const relPath = file.replace(lumpDir, "src/lumpability");
            violations.push(`VIOLATION in ${relPath}: ${line.trim()}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Lumpability module isolation violation:\n` +
          violations.join("\n"),
      );
    }

    expect(tsFiles.length).toBeGreaterThan(0);
  });

  it("T-ISO-2: cross-module imports are limited to lcm/interfaces, soc/entropy, and types/", () => {
    const lumpDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(lumpDir);

    // Allowed cross-module import targets (substring matches)
    const allowed = [
      "../lcm/interfaces",
      "../soc/entropy",
      "../types/",
      "./",           // local imports within lumpability/
      "node:",        // node built-ins
    ];

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        // Extract the module specifier from the import statement
        const match = line.match(/from\s+["']([^"']+)["']/);
        if (!match) continue;
        const specifier = match[1]!;

        // Check if the specifier matches any allowed pattern
        const isAllowed = allowed.some((pattern) =>
          specifier.includes(pattern),
        );

        if (!isAllowed) {
          const relPath = file.replace(lumpDir, "src/lumpability");
          violations.push(
            `UNEXPECTED IMPORT in ${relPath}: "${specifier}" from ${line.trim()}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Lumpability module has unexpected imports:\n` +
          violations.join("\n"),
      );
    }

    expect(tsFiles.length).toBeGreaterThan(0);
  });
});
