/**
 * isolation.test.ts
 *
 * T9: Module isolation test — verifies zero cross-component imports.
 *
 * Phase 1 Success Criterion 5: The sheaf module (src/sheaf/) must have zero
 * imports from any other AGEM component module (lcm, tna, soc, orchestrator).
 *
 * This test statically scans all non-test TypeScript files in src/sheaf/ and
 * verifies that no production file imports from a sibling component module.
 * Test files (.test.ts) are excluded because tests may import test utilities
 * from anywhere — only production source files are checked.
 *
 * Additionally verifies that src/types/ has zero external package imports,
 * since types/ is the dependency root that all other modules depend on.
 *
 * Architecture invariant:
 *   Only the orchestrator (Phase 5) is allowed to import from multiple modules.
 *   Cross-imports between sheaf/, lcm/, tna/, soc/ are strictly forbidden
 *   to maintain testability, composability, and clean phase boundaries.
 *   This is enforced here statically and documented in .planning/STATE.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Utility: collect all non-test .ts files under a directory recursively.
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
// T9: sheaf module has zero imports from lcm, tna, soc, orchestrator
// ---------------------------------------------------------------------------

describe('Module isolation', () => {
  it('T9: src/sheaf/ production files have zero imports from lcm, tna, soc, orchestrator', () => {
    const sheafDir = resolve(__dirname, '.');
    const tsFiles = getAllTsSourceFiles(sheafDir);

    // Forbidden import path patterns: any path component that is one of these module names.
    const forbidden = ['/lcm/', '/tna/', '/soc/', '/orchestrator/'];

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');

      // Extract all import/export lines.
      const lines = content.split('\n');
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/)
      );

      for (const line of importLines) {
        for (const pattern of forbidden) {
          if (line.includes(pattern)) {
            violations.push(
              `VIOLATION in ${file.replace(sheafDir, 'src/sheaf')}: ${line.trim()}`
            );
          }
        }
      }
    }

    // Report all violations at once for easy debugging.
    if (violations.length > 0) {
      throw new Error(
        `Module isolation violation — sheaf imports from forbidden modules:\n` +
          violations.join('\n')
      );
    }

    // Confirm that the scan actually ran (there should be at least some files).
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // types/ isolation: zero external package imports
  // ---------------------------------------------------------------------------

  it('src/types/ files have zero external package imports (pure TypeScript only)', () => {
    const typesDir = resolve(__dirname, '../types');
    const tsFiles = getAllTsSourceFiles(typesDir);

    const violations: string[] = [];

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Find all import statements that do NOT start with a relative path ('.').
      // External package imports start with bare module names (e.g., 'mathjs', 'ml-matrix').
      const externalImportLines = lines.filter((line) =>
        line.match(/^\s*import\s.*from\s+['"](?!\.)/)
      );

      for (const line of externalImportLines) {
        violations.push(
          `VIOLATION in ${file.replace(typesDir, 'src/types')}: ${line.trim()}`
        );
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Types isolation violation — src/types/ imports external packages:\n` +
          violations.join('\n')
      );
    }

    // Confirm types/ directory has at least some files.
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Additional: verify that production sheaf files do NOT import test utilities
  // ---------------------------------------------------------------------------

  it('src/sheaf/ production files do not import from test helper files', () => {
    const sheafDir = resolve(__dirname, '.');
    const tsFiles = getAllTsSourceFiles(sheafDir);

    const violations: string[] = [];
    const testFilePatterns = ['.test.js', '.test.ts', '/helpers/'];

    for (const file of tsFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const importLines = lines.filter((line) =>
        line.match(/^\s*(import|export)\s.*from\s/)
      );

      for (const line of importLines) {
        // Check if production file is importing FROM a test file (not helpers)
        if (line.includes('.test.js') || line.includes('.test.ts')) {
          violations.push(
            `VIOLATION in ${file.replace(sheafDir, 'src/sheaf')}: production file imports test file: ${line.trim()}`
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Isolation violation — production file imports test files:\n` +
          violations.join('\n')
      );
    }
  });
});
