/**
 * isolation.test.ts
 *
 * SOC module isolation tests — statically enforces architectural invariants.
 *
 * T-ISO-01: src/soc/ production files have zero imports from src/lcm/ or src/orchestrator/
 *   ROADMAP SC-5: "src/soc/ has zero imports from src/lcm/ or src/orchestrator/."
 *   Architecture invariant: Only the Phase 5 orchestrator is allowed to import from
 *   multiple core modules. Cross-imports between sheaf/, lcm/, tna/, soc/ are forbidden.
 *
 * T-ISO-02: src/soc/ production files do not import from test files
 *   Production code must not depend on test infrastructure.
 *
 * T-ISO-03: No hard-coded iteration 400 in production SOC files
 *   ROADMAP SC-4: "No hard-coded iteration number (e.g., 400) appears in the implementation."
 *   Phase transition detection must be dynamic (rolling correlation sign change),
 *   not triggered at a fixed constant.
 *
 * T-ISO-04: All SOC tests pass with synthetic data only (no external dependencies)
 *   No production files or tests load external data (readFileSync, fetch, http, transformers).
 *   All SOC inputs are inline synthetic data structures.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Utility: collect all non-test .ts files in a directory (non-recursive for src/soc/).
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
// T-ISO-01: SOC production files have zero imports from lcm or orchestrator
// ---------------------------------------------------------------------------

describe("SOC Module isolation", () => {
  it("T-ISO-01: src/soc/ production files have zero imports from src/lcm/ or src/orchestrator/ (ROADMAP SC-5)", () => {
    const socDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(socDir);

    // Forbidden import patterns — only inter-module imports are checked.
    // SOC is allowed to import from src/types/ (shared event types).
    const forbidden = ["/lcm/", "/orchestrator/", "/tna/", "/sheaf/"];

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");

      // Extract all import/export ... from lines.
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        for (const pattern of forbidden) {
          if (line.includes(pattern)) {
            violations.push(
              `VIOLATION in ${file.replace(socDir, "src/soc")}: ${line.trim()}`,
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Module isolation violation — src/soc/ imports from forbidden modules:\n` +
          violations.join("\n"),
      );
    }

    // Confirm the scan actually ran.
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // T-ISO-02: SOC production files do not import from test files
  // ---------------------------------------------------------------------------

  it("T-ISO-02: src/soc/ production files do not import from test helper files", () => {
    const socDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(socDir);

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        if (line.includes(".test.js") || line.includes(".test.ts")) {
          violations.push(
            `VIOLATION in ${file.replace(socDir, "src/soc")}: production file imports test file: ${line.trim()}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Isolation violation — production file imports test files:\n` +
          violations.join("\n"),
      );
    }
  });

  // ---------------------------------------------------------------------------
  // T-ISO-03: No hard-coded iteration 400 in production SOC files (ROADMAP SC-4)
  // ---------------------------------------------------------------------------

  it("T-ISO-03: No hard-coded iteration 400 in production SOC files (ROADMAP SC-4)", () => {
    const socDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(socDir);

    // Match the literal number 400 as a standalone value (word boundary).
    // We scan raw source lines and flag any non-comment line containing \b400\b.
    // The regex \b400\b matches "400" as a whole number (not part of "4000" or "0400").
    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, lineIndex) => {
        // Skip pure comment lines (lines starting with // or * after whitespace)
        const trimmed = line.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        ) {
          return;
        }

        // Also strip inline comments before checking
        const withoutInlineComment = line.replace(/\/\/.*$/, "");

        if (/\b400\b/.test(withoutInlineComment)) {
          violations.push(
            `VIOLATION in ${file.replace(socDir, "src/soc")} line ${lineIndex + 1}: ` +
              `hard-coded 400 found: ${line.trim()}`,
          );
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Hard-coded 400 violation — phase transition must be dynamic (ROADMAP SC-4):\n` +
          violations.join("\n"),
      );
    }

    // Confirm at least some files were scanned.
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // T-ISO-04: All SOC tests use synthetic data only (no external data dependencies)
  // ---------------------------------------------------------------------------

  it("T-ISO-04: All SOC tests pass with synthetic data only (no external data loading)", () => {
    const socDir = resolve(__dirname, ".");
    const testFiles = readdirSync(socDir).filter(
      (f) => f.endsWith(".test.ts") && f !== "isolation.test.ts",
    );

    const violations: string[] = [];

    const forbiddenPatterns = [
      /readFileSync\s*\(\s*['"`]/,
      /fs\.read/,
      /fetch\s*\(/,
      /http\.get/,
      /https\.get/,
      /axios/,
      /require\s*\(\s*['"`].*\.json['"`]\)/,
      /@huggingface\/transformers/,
    ];

    for (const testFile of testFiles) {
      const fullPath = join(socDir, testFile);
      const content = readFileSync(fullPath, "utf-8");

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          violations.push(
            `VIOLATION in ${testFile}: uses external data loading: ${pattern.source}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Test data violation — SOC tests depend on external data:\n` +
          violations.join("\n"),
      );
    }

    // Confirm that at least some test files were checked.
    expect(testFiles.length).toBeGreaterThan(0);
  });
});
