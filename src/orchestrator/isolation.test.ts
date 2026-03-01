/**
 * isolation.test.ts
 *
 * Module isolation test for the AGEM system.
 *
 * Enforces the key architecture invariant:
 *   - Phase 1-4 modules (sheaf, lcm, tna, soc) have ZERO cross-imports
 *   - ONLY src/orchestrator/ComposeRootModule.ts imports from multiple modules
 *
 * Implementation: reads source files via Node.js fs module and uses regex
 * to detect import statements that violate module boundaries.
 *
 * Tests:
 *   T1: src/sheaf/ has zero imports from lcm, tna, soc, orchestrator
 *   T2: src/lcm/ has zero imports from sheaf, tna, soc, orchestrator
 *   T3: src/tna/ has zero imports from sheaf, lcm, soc, orchestrator
 *   T4: src/soc/ has zero imports from sheaf, lcm, tna, orchestrator
 *   T5: Only src/orchestrator/ComposeRootModule.ts imports from multiple modules
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

// ---------------------------------------------------------------------------
// Helper: get project root directory
// ---------------------------------------------------------------------------

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');

// ---------------------------------------------------------------------------
// Helper: recursively collect .ts files (exclude test files and .d.ts)
// ---------------------------------------------------------------------------

function collectTsFiles(dir: string, excludeTests: boolean = true): string[] {
  const results: string[] = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      results.push(...collectTsFiles(fullPath, excludeTests));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      // Exclude test files if requested
      if (excludeTests && entry.name.endsWith('.test.ts')) {
        continue;
      }
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helper: extract import paths from a TypeScript file
// ---------------------------------------------------------------------------

function extractImportPaths(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Strategy: extract all quoted strings that appear after 'from'
  // This handles both single-line and multi-line import statements.
  // Pattern: 'from' followed by whitespace and a quoted string.
  const fromImportRegex = /\bfrom\s+['"]([^'"]+)['"]/g;

  const imports: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = fromImportRegex.exec(content)) !== null) {
    imports.push(match[1]!);
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Helper: check if an import path references a specific module directory
// ---------------------------------------------------------------------------

function importsFromModule(importPath: string, moduleName: string): boolean {
  // Match patterns like:
  //   '../lcm/index.js'     → relative single-level
  //   '../../lcm/'          → relative two-level
  //   'src/lcm/'            → absolute from src
  // The import path starts with '../' or '../../' or similar.
  // We check if the resolved module name appears as a directory segment.

  // Split path into segments and check if any segment equals the module name
  const segments = importPath.split('/');
  return segments.some((segment) => segment === moduleName);
}

// ---------------------------------------------------------------------------
// Helper: find violation files
// ---------------------------------------------------------------------------

function findViolations(
  moduleDir: string,
  forbiddenModules: string[]
): Array<{ file: string; violatingImports: string[] }> {
  const files = collectTsFiles(moduleDir, true /* exclude test files */);
  const violations: Array<{ file: string; violatingImports: string[] }> = [];

  for (const file of files) {
    const imports = extractImportPaths(file);
    const violatingImports = imports.filter((imp) =>
      forbiddenModules.some((mod) => importsFromModule(imp, mod))
    );

    if (violatingImports.length > 0) {
      violations.push({ file: path.relative(PROJECT_ROOT, file), violatingImports });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Module Isolation (isolation.test.ts)', () => {

  describe('T1: src/sheaf/ isolation', () => {
    it('src/sheaf/ has zero imports from lcm, tna, soc, or orchestrator', () => {
      const sheafDir = path.join(SRC_ROOT, 'sheaf');
      const violations = findViolations(sheafDir, ['lcm', 'tna', 'soc', 'orchestrator']);

      if (violations.length > 0) {
        const message = violations
          .map(v => `  ${v.file}: ${v.violatingImports.join(', ')}`)
          .join('\n');
        expect.fail(`Sheaf module has forbidden cross-imports:\n${message}`);
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('T2: src/lcm/ isolation', () => {
    it('src/lcm/ has zero imports from sheaf, tna, soc, or orchestrator', () => {
      const lcmDir = path.join(SRC_ROOT, 'lcm');
      const violations = findViolations(lcmDir, ['sheaf', 'tna', 'soc', 'orchestrator']);

      if (violations.length > 0) {
        const message = violations
          .map(v => `  ${v.file}: ${v.violatingImports.join(', ')}`)
          .join('\n');
        expect.fail(`LCM module has forbidden cross-imports:\n${message}`);
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('T3: src/tna/ isolation', () => {
    it('src/tna/ has zero imports from sheaf, lcm, soc, or orchestrator', () => {
      const tnaDir = path.join(SRC_ROOT, 'tna');
      const violations = findViolations(tnaDir, ['sheaf', 'lcm', 'soc', 'orchestrator']);

      if (violations.length > 0) {
        const message = violations
          .map(v => `  ${v.file}: ${v.violatingImports.join(', ')}`)
          .join('\n');
        expect.fail(`TNA module has forbidden cross-imports:\n${message}`);
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('T4: src/soc/ isolation', () => {
    it('src/soc/ has zero imports from sheaf, lcm, tna, or orchestrator', () => {
      const socDir = path.join(SRC_ROOT, 'soc');
      const violations = findViolations(socDir, ['sheaf', 'lcm', 'tna', 'orchestrator']);

      if (violations.length > 0) {
        const message = violations
          .map(v => `  ${v.file}: ${v.violatingImports.join(', ')}`)
          .join('\n');
        expect.fail(`SOC module has forbidden cross-imports:\n${message}`);
      }

      expect(violations).toHaveLength(0);
    });
  });

  describe('T5: Only ComposeRootModule.ts has multi-module imports', () => {
    it('ComposeRootModule.ts imports from all four Phase 1-4 modules', () => {
      const composeRootPath = path.join(SRC_ROOT, 'orchestrator', 'ComposeRootModule.ts');

      expect(fs.existsSync(composeRootPath)).toBe(true);

      const imports = extractImportPaths(composeRootPath);

      // ComposeRootModule should import from all four modules
      const hasSheaf = imports.some((imp) => importsFromModule(imp, 'sheaf'));
      const hasLcm = imports.some((imp) => importsFromModule(imp, 'lcm'));
      const hasTna = imports.some((imp) => importsFromModule(imp, 'tna'));
      const hasSoc = imports.some((imp) => importsFromModule(imp, 'soc'));

      expect(hasSheaf).toBe(true);
      expect(hasLcm).toBe(true);
      expect(hasTna).toBe(true);
      expect(hasSoc).toBe(true);
    });

    it('other orchestrator files do NOT import from multiple Phase 1-4 modules', () => {
      const orchestratorDir = path.join(SRC_ROOT, 'orchestrator');
      const files = collectTsFiles(orchestratorDir, true);

      // Exclude ComposeRootModule.ts (it's the allowed exception)
      const nonRootFiles = files.filter(
        (f) => !f.endsWith('ComposeRootModule.ts')
      );

      for (const file of nonRootFiles) {
        const imports = extractImportPaths(file);

        const importedModules = ['sheaf', 'lcm', 'tna', 'soc'].filter((mod) =>
          imports.some((imp) => importsFromModule(imp, mod))
        );

        // Other orchestrator files may import from AT MOST ONE Phase 1-4 module
        // (ObstructionHandler imports from tna only — that's allowed)
        const relativeFile = path.relative(PROJECT_ROOT, file);
        if (importedModules.length > 1) {
          expect.fail(
            `${relativeFile} imports from multiple Phase 1-4 modules: ${importedModules.join(', ')}. ` +
            'Only ComposeRootModule.ts is allowed to import from multiple modules.'
          );
        }
      }

      expect(nonRootFiles.length).toBeGreaterThan(0); // Ensure we checked something
    });

    it('Phase 1-4 modules do not import from orchestrator', () => {
      const moduleDirectories = [
        path.join(SRC_ROOT, 'sheaf'),
        path.join(SRC_ROOT, 'lcm'),
        path.join(SRC_ROOT, 'tna'),
        path.join(SRC_ROOT, 'soc'),
      ];

      for (const moduleDir of moduleDirectories) {
        const violations = findViolations(moduleDir, ['orchestrator']);
        if (violations.length > 0) {
          const message = violations
            .map(v => `  ${v.file}: ${v.violatingImports.join(', ')}`)
            .join('\n');
          expect.fail(`Phase 1-4 modules import from orchestrator:\n${message}`);
        }
        expect(violations).toHaveLength(0);
      }
    });
  });
});
