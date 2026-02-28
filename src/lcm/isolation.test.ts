/**
 * isolation.test.ts
 *
 * T14: Module isolation test — verifies zero cross-component imports in src/lcm/.
 *
 * Phase 2 Success Criterion 5: The lcm module (src/lcm/) must have zero
 * imports from any other AGEM component module (sheaf, tna, soc, orchestrator).
 *
 * This test statically scans all non-test TypeScript files in src/lcm/ and
 * verifies that no production file imports from a sibling component module.
 * Test files (.test.ts) are excluded because tests may import test utilities
 * from anywhere — only production source files are checked.
 *
 * Additionally verifies (T14b) that no LCM source file (except interfaces.ts)
 * imports directly from @huggingface/transformers, guarding against the
 * "embedding cold start in tests" pitfall (STATE.md Pitfall 4).
 *
 * Architecture invariant:
 *   Only the orchestrator (Phase 5) is allowed to import from multiple modules.
 *   Cross-imports between sheaf/, lcm/, tna/, soc/ are strictly forbidden
 *   to maintain testability, composability, and clean phase boundaries.
 *   Enforced here statically and documented in .planning/STATE.md.
 *
 * Mirrors the isolation test pattern from src/sheaf/isolation.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Utility: collect all non-test .ts files under a directory (non-recursive,
// since src/lcm/ helpers/ subdirectory should also be scanned).
// ---------------------------------------------------------------------------

function getAllTsSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      files.push(...getAllTsSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// T14: lcm module has zero imports from sheaf, tna, soc, orchestrator
// ---------------------------------------------------------------------------

describe('Module isolation', () => {
  it('T14: src/lcm/ production files have zero imports from sheaf, tna, soc, orchestrator', () => {
    const lcmDir = resolve(__dirname, '.');
    const tsFiles = getAllTsSourceFiles(lcmDir);

    // Forbidden import path patterns: any import referencing a sibling module.
    const forbidden = ['/sheaf/', '/tna/', '/soc/', '/orchestrator/'];

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Extract all import/export from lines.
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/)
      );

      for (const line of importLines) {
        for (const pattern of forbidden) {
          if (line.includes(pattern)) {
            const relPath = file.replace(lcmDir, 'src/lcm');
            violations.push(
              `VIOLATION in ${relPath}: ${line.trim()}`
            );
          }
        }
      }
    }

    // Report all violations at once for easy debugging.
    if (violations.length > 0) {
      throw new Error(
        `LCM module isolation violation — lcm imports from forbidden modules:\n` +
          violations.join('\n')
      );
    }

    // Confirm the scan actually ran (there should be multiple source files).
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // T14b: No LCM source file (except interfaces.ts) imports @huggingface/transformers
  // ---------------------------------------------------------------------------

  it('T14b: LCM source files (except interfaces.ts) do not import @huggingface/transformers directly', () => {
    const lcmDir = resolve(__dirname, '.');
    const tsFiles = getAllTsSourceFiles(lcmDir);

    // interfaces.ts is the only file allowed to mention the embedder package
    // (for documentation purposes). All others must use IEmbedder injection.
    const forbiddenPackage = '@huggingface/transformers';

    const violations: string[] = [];

    for (const file of tsFiles) {
      // Allow interfaces.ts to reference @huggingface/transformers in comments/docs.
      if (file.endsWith('interfaces.ts')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Find actual import statements (not comments) referencing the forbidden package.
      const importLines = lines.filter((line) => {
        const trimmed = line.trimStart();
        // Must be an import statement (not a comment)
        return (
          (trimmed.startsWith('import ') || trimmed.startsWith('export ')) &&
          line.includes(forbiddenPackage)
        );
      });

      for (const line of importLines) {
        const relPath = file.replace(lcmDir, 'src/lcm');
        violations.push(
          `VIOLATION in ${relPath} imports directly from ${forbiddenPackage}: ${line.trim()}`
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `LCM embedding isolation violation — direct @huggingface/transformers imports:\n` +
          violations.join('\n')
      );
    }

    // Confirm the scan actually ran.
    expect(tsFiles.length).toBeGreaterThan(0);
  });
});
