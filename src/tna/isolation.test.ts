/**
 * isolation.test.ts
 *
 * T20: Module isolation test — verifies zero cross-component imports.
 *
 * Phase 3 Success Criterion 5 (ROADMAP): The TNA module (src/tna/) must have zero
 * imports from any other AGEM component module (lcm, sheaf, soc, orchestrator).
 *
 * This test statically scans all non-test TypeScript files in src/tna/ and
 * verifies that no production file imports from a sibling component module.
 * Test files (.test.ts) are excluded because tests may import test utilities
 * from anywhere — only production source files are checked.
 *
 * Additionally verifies:
 * - T20b: Production files do not import from test helper files
 * - T21: All TNA tests pass with synthetic text input only (no external data)
 *
 * Architecture invariant:
 *   Only the orchestrator (Phase 5) is allowed to import from multiple modules.
 *   Cross-imports between sheaf/, lcm/, tna/, soc/ are strictly forbidden
 *   to maintain testability, composability, and clean phase boundaries.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

// ---------------------------------------------------------------------------
// Utility: collect all non-test .ts files under a directory recursively.
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
// T20: tna module has zero imports from lcm, sheaf, soc, orchestrator
// ---------------------------------------------------------------------------

describe("Module isolation", () => {
  it("T20: src/tna/ production files have zero imports from lcm, sheaf, soc, orchestrator", () => {
    const tnaDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(tnaDir);

    // Forbidden import path patterns: any path component that is one of these module names.
    const forbidden = ["/lcm/", "/sheaf/", "/soc/", "/orchestrator/"];

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");

      // Extract all import/export lines.
      const lines = content.split("\n");
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        for (const pattern of forbidden) {
          if (line.includes(pattern)) {
            violations.push(
              `VIOLATION in ${file.replace(tnaDir, "src/tna")}: ${line.trim()}`,
            );
          }
        }
      }
    }

    // Report all violations at once for easy debugging.
    if (violations.length > 0) {
      throw new Error(
        `Module isolation violation — tna imports from forbidden modules:\n` +
          violations.join("\n"),
      );
    }

    // Confirm that the scan actually ran (there should be at least some files).
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // T20b: src/tna/ production files do not import from test helper files
  // ---------------------------------------------------------------------------

  it("T20b: src/tna/ production files do not import from test helper files", () => {
    const tnaDir = resolve(__dirname, ".");
    const tsFiles = getAllTsSourceFiles(tnaDir);

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/),
      );

      for (const line of importLines) {
        // Check if production file is importing FROM a test file
        if (line.includes(".test.js") || line.includes(".test.ts")) {
          violations.push(
            `VIOLATION in ${file.replace(tnaDir, "src/tna")}: production file imports test file: ${line.trim()}`,
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
  // T21: all TNA tests pass with synthetic text input only
  // ---------------------------------------------------------------------------

  it("T21: all TNA tests use synthetic text input (no external data dependencies)", () => {
    const tnaDir = resolve(__dirname, ".");
    const testDir = tnaDir;
    const testFiles = readdirSync(testDir).filter(
      (f) => f.endsWith(".test.ts") && f !== "isolation.test.ts",
    );

    const violations: string[] = [];

    for (const testFile of testFiles) {
      const fullPath = join(testDir, testFile);
      const content = readFileSync(fullPath, "utf-8");

      // Check for external data loading patterns.
      // Forbidden patterns:
      //   - readFileSync pointing to external files
      //   - fetch() calls
      //   - import from external data paths
      //   - require() of external modules
      // Allowed:
      //   - Inline string literals
      //   - Array.from() synthetic data
      //   - Math.random() or other synthetic generation

      const forbiddenPatterns = [
        /readFileSync\s*\(\s*['"`]/,
        /fs\.read/,
        /fetch\s*\(/,
        /http\.get/,
        /https\.get/,
        /axios/,
        /require\s*\(\s*['"`].*\.json['"`]\)/,
      ];

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
        `Test data violation — TNA tests depend on external data:\n` +
          violations.join("\n"),
      );
    }

    // Confirm that we found and checked at least some test files.
    expect(testFiles.length).toBeGreaterThan(0);
  });
});
