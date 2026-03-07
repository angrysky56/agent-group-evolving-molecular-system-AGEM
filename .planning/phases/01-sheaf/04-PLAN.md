---
wave: 3
title: "Cohomology Analysis: SVD, H^1 Detection, Tolerance Calibration, Event Emission, Isolation"
depends_on:
  - 02-PLAN.md # Wave 1: types, CellularSheaf, test helpers
  - 03-PLAN.md # Wave 2: coboundary operator, Sheaf Laplacian, ADMM stub
files_modified:
  - src/sheaf/CohomologyAnalyzer.ts # SVD-based H^0/H^1 computation + event emission
  - src/sheaf/CohomologyAnalyzer.test.ts # T7, T8, tolerance tests
  - src/sheaf/NumericalTolerance.test.ts # Tolerance calibration validation
  - src/sheaf/isolation.test.ts # T9: zero cross-module imports
  - src/sheaf/index.ts # Public barrel export for the sheaf module
autonomous: true
commits:
  - "feat(sheaf): implement CohomologyAnalyzer with SVD-based H^1 detection and calibrated tolerance"
  - "feat(sheaf): add event emission, isolation test, and public module exports"
---

# Wave 3: Cohomology Analysis

## Purpose

Implement the crown jewel of Phase 1: the `CohomologyAnalyzer` that uses SVD of the coboundary operator `B` to compute `H^0` (global sections) and `H^1` (obstructions), with numerically calibrated rank tolerance. This wave also adds event emission for Phase 5 forward-compatibility and the module isolation test that enforces zero cross-component coupling.

After this wave completes, ALL five Phase 1 success criteria from ROADMAP.md must be satisfied:

1. Laplacian correctness (verified in Wave 2, re-confirmed here)
2. Non-trivial H^1 detection (the 3-cycle test, T7)
3. Flat vs. non-flat dual test configurations (both pass in the same run)
4. Numerical tolerance calibration documented and validated
5. Component isolation (zero imports from other modules)

## Why SVD of B, Not Eigendecomposition of L_sheaf

From 01-RESEARCH.md Section 3.4:

- `L_sheaf = B^T B` is numerically ill-conditioned at its zero eigenvalues.
- SVD of `B` directly gives: `ker(B)` = right singular vectors with singular value 0 (that is `H^0`), and `coker(B) = C^1 / im(B)` = left singular vectors with zero singular value (related to `H^1`).
- The rank of `B` is directly read from singular values above threshold, which determines both `dim(H^0) = N_0 - rank(B)` and `dim(H^1) = N_1 - rank(B)`.
- `ml-matrix@6.12.1` provides `SingularValueDecomposition` with access to U, S, V matrices. `mathjs` does not provide standalone SVD.

The boundary between `mathjs` and `ml-matrix` is precisely here: `mathjs` handles all matrix assembly and arithmetic (Waves 1-2); `ml-matrix` handles SVD (Wave 3 only). Conversion happens through standard 2D JavaScript arrays.

---

<task id="w3-t1" title="Implement computeCohomology() using SVD of the coboundary operator">
  <description>
    Create `src/sheaf/CohomologyAnalyzer.ts` with a standalone function and an EventEmitter-based class.

    **Standalone function (the mathematical core):**

    ```typescript
    import { Matrix as MlMatrix, SingularValueDecomposition } from 'ml-matrix';
    import * as math from 'mathjs';

    export function computeCohomology(
      sheaf: CellularSheaf,
      tolerance?: number
    ): CohomologyResult { ... }
    ```

    Algorithm (from 01-RESEARCH.md Section 3.4):

    1. Get `B = sheaf.getCoboundaryMatrix()` as a mathjs Matrix.
    2. Convert to 2D number array: `const bArray = math.toArray(B) as number[][]`.
    3. Create ml-matrix Matrix: `const mlB = new MlMatrix(bArray)`.
    4. Compute SVD: `const svd = new SingularValueDecomposition(mlB, { autoTranspose: true })`.
    5. Extract singular values: `svd.diagonal` (sorted descending).
    6. Compute tolerance:
       - If `tolerance` parameter is provided, use it.
       - Otherwise: `tol = max(singularValues) * max(N_0, N_1) * 2.22e-16`.
       - `2.22e-16` is `Number.EPSILON` (machine epsilon for float64).
       - This is the MATLAB `rank()` default formula.
    7. Compute rank: count of singular values > tol.
    8. `h0Dimension = N_0 - rank`.
    9. `h1Dimension = N_1 - rank`.
    10. Extract H^0 basis: columns `rank` through `N_0 - 1` of `svd.V` (right singular vectors for zero singular values = ker(B)).
    11. Extract H^1 basis: columns `rank` through `min(N_1, U.columns) - 1` of `svd.U` (left singular vectors for zero singular values = representatives of H^1).
    12. Return `CohomologyResult` with all computed fields.

    **PERFORMANCE NOTE (document as comment in code):**
    ```
    // Full SVD of B is O(N_0 * N_1 * min(N_0, N_1)).
    // For N_0, N_1 < 200 this is acceptable (<10ms). For larger sheaves,
    // consider iterative methods (Lanczos) or randomized SVD.
    // See ROADMAP.md Phase 6 (P2 enhancements) for optimization path.
    ```

    **TOLERANCE NOTE (document as comment in code):**
    ```
    // Tolerance formula: max(singular_values) * max(N_0, N_1) * Number.EPSILON
    // Source: MATLAB rank() default. See 01-RESEARCH.md Section 5.3.
    // For sheaves with integer restriction map entries (common in tests),
    // this tolerance correctly separates structural zero singular values
    // from numerical noise. For learned restriction maps with irrational
    // entries, recalibration may be necessary -- pass explicit tolerance.
    ```

  </description>
  <acceptance>
    - `computeCohomology(flatPathSheaf)` returns h0Dimension = stalkDim, h1Dimension = 0.
    - `computeCohomology(threeCycleSheaf)` returns h1Dimension = 1, hasObstruction = true.
    - The `tolerance` field in the result contains the actual tolerance used.
    - The `coboundaryRank` field equals `N_0 - h0Dimension` and `N_1 - h1Dimension`.
    - Both performance and tolerance comments are present in the source code.
    - ml-matrix is imported; mathjs is used only for matrix-to-array conversion.
  </acceptance>
</task>

<task id="w3-t2" title="Implement CohomologyAnalyzer class with event emission">
  <description>
    In the same `src/sheaf/CohomologyAnalyzer.ts` file, add the `CohomologyAnalyzer` class:

    ```typescript
    import { EventEmitter } from 'events';
    import type {
      SheafH1ObstructionEvent,
      SheafConsensusReachedEvent,
      CohomologyResult,
    } from '../types/index.js';

    export class CohomologyAnalyzer extends EventEmitter {
      analyze(sheaf: CellularSheaf, iteration: number = 0): CohomologyResult {
        const result = computeCohomology(sheaf);

        if (result.hasObstruction) {
          const event: SheafH1ObstructionEvent = {
            type: 'sheaf:h1-obstruction-detected',
            iteration,
            h1Dimension: result.h1Dimension,
            h1Basis: result.h1Basis,
            affectedVertices: this.findAffectedVertices(result, sheaf),
          };
          this.emit('sheaf:h1-obstruction-detected', event);
        } else {
          const event: SheafConsensusReachedEvent = {
            type: 'sheaf:consensus-reached',
            iteration,
            h0Dimension: result.h0Dimension,
            dirichletEnergy: 0, // TODO: compute from ADMMSolver in future
          };
          this.emit('sheaf:consensus-reached', event);
        }

        return result;
      }

      private findAffectedVertices(result: CohomologyResult, sheaf: CellularSheaf): VertexId[] {
        // For Phase 1: return all vertex IDs.
        // Phase 5 can refine this to identify the specific obstruction cycle.
        return sheaf.getVertexIds();
      }
    }
    ```

    Why `EventEmitter` in Phase 1:
    - The Phase 5 `EventBus` will subscribe to these events.
    - By emitting typed events now, the Phase 5 integration only needs to subscribe -- no rewiring of sheaf internals.
    - The strongly-typed `SheafEvent` union type ensures the Phase 5 event handler receives a known payload shape.

  </description>
  <acceptance>
    - `CohomologyAnalyzer` extends `EventEmitter`.
    - `analyze()` returns a `CohomologyResult`.
    - When `hasObstruction = true`, the `'sheaf:h1-obstruction-detected'` event is emitted with the correct payload shape.
    - When `hasObstruction = false`, the `'sheaf:consensus-reached'` event is emitted.
    - `affectedVertices` is populated (even if it returns all vertices in Phase 1).
  </acceptance>
</task>

<task id="w3-t3" title="Write cohomology tests: T7 (3-cycle H^1=1) and T8 (event fires)">
  <description>
    Create `src/sheaf/CohomologyAnalyzer.test.ts` with:

    **T7: 3-cycle inconsistency produces dim(H^1) = 1**
    ```typescript
    it('3-cycle with incompatible projection restriction maps has dim(H^1) = 1', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      const result = computeCohomology(sheaf);
      expect(result.h1Dimension).toBe(1);
      expect(result.hasObstruction).toBe(true);
      expect(result.h0Dimension).toBe(4);  // N_0 - rank(B) = 6 - 2 = 4
      expect(result.coboundaryRank).toBe(2);
    });
    ```

    Note on h0Dimension: The research document states rank(B) = 2 for this configuration. With N_0 = 6, that gives h0Dimension = 4. This means there are 4 linearly independent vectors in ker(B). This is mathematically correct: the three-cycle with 1D edge stalks and 2D vertex stalks has a 4-dimensional space of "trivially consistent" vectors (vectors that map to zero under all restriction maps). The important thing is that dim(H^1) = 1 (one obstruction class).

    **T7b: Flat sheaf on path has dim(H^1) = 0**
    ```typescript
    it('flat 3-vertex path sheaf: dim(H^1) = 0', () => {
      const sheaf = buildFlatSheaf(3, 2, 'path');
      const result = computeCohomology(sheaf);
      expect(result.h1Dimension).toBe(0);
      expect(result.hasObstruction).toBe(false);
      expect(result.h0Dimension).toBe(2);  // stalkDim for flat on connected graph
    });
    ```

    **T7c: Flat sheaf on triangle has dim(H^1) = 2**
    ```typescript
    it('flat 3-vertex triangle sheaf: dim(H^1) = 2', () => {
      const sheaf = buildFlatSheaf(3, 2, 'triangle');
      const result = computeCohomology(sheaf);
      expect(result.h1Dimension).toBe(2); // d * (|E| - |V| + 1) = 2 * (3 - 3 + 1) = 2
      expect(result.hasObstruction).toBe(true);
      expect(result.h0Dimension).toBe(2);
    });
    ```

    **T7d: Dual configuration test (BOTH flat and non-flat pass in the same test run)**
    ```typescript
    describe('Mandatory dual configuration (PITFALL GATE)', () => {
      it('flat sheaf: H^1 = 0 on path', () => { ... });
      it('non-flat sheaf: H^1 = 1 on 3-cycle', () => { ... });
      // These two tests MUST both exist and pass. If either is missing or failing,
      // the pitfall gate is violated and the implementation cannot be trusted.
    });
    ```

    **T8: H^1 event fires from CohomologyAnalyzer**
    ```typescript
    it('emits h1:non-trivial event when dim(H^1) > 0', () => {
      const analyzer = new CohomologyAnalyzer();
      const events: SheafH1ObstructionEvent[] = [];
      analyzer.on('sheaf:h1-obstruction-detected', (e) => events.push(e));

      analyzer.analyze(buildThreeCycleInconsistentSheaf(), 42);

      expect(events).toHaveLength(1);
      expect(events[0].h1Dimension).toBe(1);
      expect(events[0].type).toBe('sheaf:h1-obstruction-detected');
      expect(events[0].iteration).toBe(42);
      expect(events[0].affectedVertices).toContain('v0');
    });
    ```

    **T8b: Consensus event fires when H^1 = 0**
    ```typescript
    it('emits consensus-reached event when dim(H^1) = 0', () => {
      const analyzer = new CohomologyAnalyzer();
      const events: SheafConsensusReachedEvent[] = [];
      analyzer.on('sheaf:consensus-reached', (e) => events.push(e));

      analyzer.analyze(buildFlatSheaf(3, 2, 'path'), 7);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('sheaf:consensus-reached');
      expect(events[0].h0Dimension).toBe(2);
      expect(events[0].iteration).toBe(7);
    });
    ```

    **T8c: H^1 basis vectors are valid**
    ```typescript
    it('H^1 basis vectors have correct dimension (N_1 = c1Dimension)', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      const result = computeCohomology(sheaf);
      expect(result.h1Basis).toHaveLength(1); // dim(H^1) = 1
      expect(result.h1Basis[0]).toHaveLength(sheaf.c1Dimension); // 3
      // Basis vector should be unit length (normalized by SVD)
      const norm = Math.sqrt(Array.from(result.h1Basis[0]).reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });
    ```

  </description>
  <acceptance>
    - T7: h1Dimension = 1 for 3-cycle, h0Dimension = 4, coboundaryRank = 2.
    - T7b: h1Dimension = 0, h0Dimension = 2 for flat path.
    - T7c: h1Dimension = 2, h0Dimension = 2 for flat triangle.
    - T7d: BOTH flat and non-flat tests pass in the same vitest run.
    - T8: H1 obstruction event fires with correct payload.
    - T8b: Consensus event fires with correct payload.
    - T8c: H^1 basis vector has correct length and is unit-normalized.
    - All tests pass with `npx vitest run`.
  </acceptance>
</task>

<task id="w3-t4" title="Write numerical tolerance tests (tolerance calibration validation)">
  <description>
    Create `src/sheaf/NumericalTolerance.test.ts` with:

    **Tolerance formula documentation test**
    ```typescript
    it('default tolerance is max(S) * max(N0, N1) * Number.EPSILON', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      const result = computeCohomology(sheaf);
      // The tolerance field should reflect the calibrated formula, not a hardcoded value.
      // We can't predict the exact value, but it should be very small (order 1e-14 to 1e-13).
      expect(result.tolerance).toBeGreaterThan(0);
      expect(result.tolerance).toBeLessThan(1e-10);
    });
    ```

    **Tolerance sensitivity test (the pitfall from 01-RESEARCH.md Section 5.3)**

    This test demonstrates that the tolerance MATTERS. It constructs a near-degenerate sheaf where a loose tolerance gives wrong results:

    ```typescript
    it('calibrated tolerance correctly detects H^1 for standard 3-cycle', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      // With default (calibrated) tolerance:
      const resultCorrect = computeCohomology(sheaf);
      expect(resultCorrect.h1Dimension).toBe(1);
    });

    it('H^1 is robust across tolerance perturbation for standard 3-cycle', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      // The standard 3-cycle has well-separated singular values.
      // Even with a somewhat loose tolerance, H^1 should still be 1.
      const resultLoose = computeCohomology(sheaf, 1e-6);
      expect(resultLoose.h1Dimension).toBe(1);
      // But an absurdly loose tolerance could collapse everything:
      const resultAbsurd = computeCohomology(sheaf, 10.0);
      expect(resultAbsurd.h1Dimension).toBe(3); // Everything is "zero" -> rank = 0 -> H^1 = N1 - 0 = 3
    });
    ```

    **Singular value spectrum diagnostic test**
    ```typescript
    it('3-cycle singular values are well-separated from zero', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      const result = computeCohomology(sheaf);
      // With rank(B) = 2, there should be exactly 2 non-zero singular values
      // and the rest should be near-zero.
      // coboundaryRank tells us how many are above tolerance.
      expect(result.coboundaryRank).toBe(2);
    });
    ```

    **Override tolerance test**
    ```typescript
    it('explicit tolerance parameter overrides the calibrated default', () => {
      const sheaf = buildThreeCycleInconsistentSheaf();
      const result = computeCohomology(sheaf, 1e-3);
      expect(result.tolerance).toBe(1e-3); // The override should be reflected in the result
    });
    ```

    **Flat sheaf tolerance robustness**
    ```typescript
    it('flat sheaf H^1 = 0 is stable across reasonable tolerance range', () => {
      const sheaf = buildFlatSheaf(3, 2, 'path');
      // Default tolerance:
      expect(computeCohomology(sheaf).h1Dimension).toBe(0);
      // Tight tolerance:
      expect(computeCohomology(sheaf, 1e-15).h1Dimension).toBe(0);
      // Moderate tolerance:
      expect(computeCohomology(sheaf, 1e-8).h1Dimension).toBe(0);
    });
    ```

  </description>
  <acceptance>
    - Default tolerance is positive and less than 1e-10 for the 3-cycle test.
    - Calibrated tolerance produces h1Dimension = 1 for the 3-cycle.
    - Absurdly loose tolerance (10.0) produces h1Dimension = 3 (everything collapses).
    - Explicit tolerance parameter is reflected in the result's tolerance field.
    - Flat sheaf H^1 = 0 is stable across reasonable tolerance range.
    - coboundaryRank = 2 for the 3-cycle.
    - All tests pass with `npx vitest run`.
  </acceptance>
</task>

<task id="w3-t5" title="Write module isolation test (T9)">
  <description>
    Create `src/sheaf/isolation.test.ts` with:

    **T9: sheaf module has zero imports from lcm, tna, soc, orchestrator**

    ```typescript
    import { readFileSync, readdirSync } from 'fs';
    import { join, resolve } from 'path';

    function getAllTsFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          files.push(...getAllTsFiles(fullPath));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    describe('Module isolation', () => {
      it('src/sheaf/ has zero imports from lcm, tna, soc, orchestrator', () => {
        const sheafDir = resolve(__dirname, '.');
        const tsFiles = getAllTsFiles(sheafDir);
        const forbidden = ['/lcm/', '/tna/', '/soc/', '/orchestrator/'];

        for (const file of tsFiles) {
          const content = readFileSync(file, 'utf-8');
          const importLines = content.split('\n').filter(line =>
            line.match(/^\s*(import|export)\s.*from\s/)
          );

          for (const line of importLines) {
            for (const pattern of forbidden) {
              expect(line).not.toContain(pattern);
            }
          }
        }
      });

      it('src/types/ has zero external package imports', () => {
        const typesDir = resolve(__dirname, '../types');
        const tsFiles = getAllTsFiles(typesDir);

        for (const file of tsFiles) {
          const content = readFileSync(file, 'utf-8');
          const importLines = content.split('\n').filter(line =>
            line.match(/^\s*import\s.*from\s+['"](?!\.)/)
          );
          // All imports in types/ must be relative (start with '.')
          expect(importLines).toHaveLength(0);
        }
      });
    });
    ```

    This test enforces Phase 1 Success Criterion 5: component isolation. It statically scans all non-test TypeScript files in `src/sheaf/` and verifies zero imports from any other component module. It also verifies that `src/types/` has zero external package imports.

    NOTE: Test files (`.test.ts`) are excluded from the scan because test files may import test utilities from anywhere. Only production source files are checked.

  </description>
  <acceptance>
    - The isolation test passes: zero forbidden imports in src/sheaf/ production files.
    - The types isolation test passes: zero external package imports in src/types/.
    - The test scans recursively (includes files in subdirectories like helpers/).
    - Test files themselves are excluded from the scan.
  </acceptance>
</task>

<task id="w3-t6" title="Create src/sheaf/index.ts barrel export">
  <description>
    Create `src/sheaf/index.ts` that re-exports the public API of the sheaf module:

    ```typescript
    // Core sheaf data structure
    export { CellularSheaf } from './CellularSheaf.js';

    // Laplacian computation
    export { SheafLaplacian } from './SheafLaplacian.js';

    // Coboundary operator (used by ADMM in future phases)
    export { buildCoboundaryMatrix } from './CoboundaryOperator.js';

    // Cohomology analysis
    export { CohomologyAnalyzer, computeCohomology } from './CohomologyAnalyzer.js';

    // ADMM solver
    export { ADMMSolver } from './ADMMSolver.js';
    export type { ADMMStepResult, ConvergenceResult, ConsensusResult } from './ADMMSolver.js';

    // Test helper factories (re-exported for integration tests in Phase 5)
    export { buildFlatSheaf } from './helpers/flatSheafFactory.js';
    export { buildThreeCycleInconsistentSheaf } from './helpers/threeCycleFactory.js';
    ```

    This barrel export is the single entry point for any external consumer of the sheaf module. Phase 4 (SOC) will import eigenspectrum types from `src/types/` but will NOT import from `src/sheaf/` directly -- it receives eigenspectrum data through typed interfaces. Phase 5 (Orchestrator) will import from `src/sheaf/index.ts`.

  </description>
  <acceptance>
    - `import { CellularSheaf, CohomologyAnalyzer, computeCohomology, ADMMSolver } from '../sheaf/index.js'` resolves.
    - `import { buildFlatSheaf, buildThreeCycleInconsistentSheaf } from '../sheaf/index.js'` resolves.
    - `npx tsc --noEmit` passes.
  </acceptance>
</task>

<task id="w3-t7" title="Run full Phase 1 test suite and verify all success criteria">
  <description>
    Run the complete test suite across all Wave 1, Wave 2, and Wave 3 test files:

    ```bash
    npx vitest run
    ```

    All of the following must pass:

    **Success Criterion 1: Laplacian correctness**
    - T5: `L_sheaf * x = 0` for constant sections of flat sheaves.
    - T5b: L_sheaf for three-cycle differs from L_graph tensor I_d.

    **Success Criterion 2: Non-trivial H^1 detection**
    - T7: 3-cycle produces dim(H^1) = 1.
    - T8: `sheaf:h1-obstruction-detected` event fires.

    **Success Criterion 3: Flat vs. non-flat dual configurations**
    - T7d: Both flat (H^1=0) and non-flat (H^1=1) tests pass in the same run.

    **Success Criterion 4: Numerical tolerance calibration**
    - Tolerance formula is documented in code comments.
    - Tolerance sensitivity tests pass (calibrated vs. loose vs. absurd).
    - coboundaryRank = 2 for the 3-cycle.

    **Success Criterion 5: Component isolation**
    - T9: Zero imports from lcm/, tna/, soc/, orchestrator/ in sheaf production files.
    - Zero external package imports in types/ files.

    **Additional verification from 01-RESEARCH.md Section 12:**
    - SC6 ADMM forward-compat: getCoboundaryMatrix(), getSheafLaplacian(), getVertexOffset(), getEdgeOffset(), getEdgeDim(), getEdgeRestrictions() are all accessible (T10).
    - SC7 Eigenspectrum: getEigenspectrum() returns Float64Array, length N_0, sorted ascending, all >= -1e-12 (T6b).

    If ANY test fails, do not proceed. Fix the failure before marking Wave 3 as complete.

  </description>
  <acceptance>
    - `npx vitest run` exits 0 with all tests passing.
    - Test count: minimum 25 individual test cases across all files.
    - Zero skipped or pending tests.
    - All 5 success criteria from ROADMAP.md are satisfied.
    - All 7 success criteria from 01-RESEARCH.md Section 12 are satisfied.
    - Total test execution time < 30 seconds (Phase 1 sheaves are small).
  </acceptance>
</task>

---

## Verification Criteria

After Wave 3 is complete, ALL of the following must be true. This is the Phase 1 exit gate.

### ROADMAP.md Success Criteria (all 5 must pass)

1. **Laplacian correctness:** `L_sheaf * x = 0` for consistent sections. Substituting `D - A` breaks the discrimination test.
2. **Non-trivial cohomology detection:** 3-cycle sheaf produces `dim(H^1) = 1`. The `sheaf:h1-obstruction-detected` event fires.
3. **Flat vs. non-flat configurations:** Both flat (H^1=0 on path) and non-flat (H^1=1 on 3-cycle) pass in the same test run.
4. **Numerical tolerance calibration:** Tolerance formula `max(S) * max(N0,N1) * eps_machine` is in the code and documented. Sensitivity test validates it.
5. **Component isolation:** Zero imports from lcm/, tna/, soc/, orchestrator/ in any production file under src/sheaf/.

### 01-RESEARCH.md Extended Criteria (SC6, SC7)

6. **ADMM forward-compat:** getCoboundaryMatrix(), getSheafLaplacian(), getVertexOffset(), getEdgeOffset(), getEdgeDim(), getEdgeRestrictions() are all publicly accessible and tested.
7. **Eigenspectrum output:** getEigenspectrum() returns SheafEigenspectrum with Float64Array eigenvalues, length N_0, sorted ascending, all >= -1e-12.

### Phase Gate

Phase 1 is COMPLETE when all 7 criteria above pass in a single `npx vitest run` invocation. At this point:

- Phase 2 (LCM) can continue (it only needs types/, which was available since Wave 1).
- Phase 3 (TNA) can begin planning (it depends on types/ only).
- Phase 4 (SOC) CANNOT begin until Phase 1 is complete (it consumes eigenspectrum from sheaf).
- Phase 5 (Orchestrator) CANNOT begin until Phases 1, 3, and 4 are complete.

## Must-Haves

- [ ] `computeCohomology()` uses SVD of B via ml-matrix (not eigendecomposition of L_sheaf)
- [ ] Tolerance formula: `max(S) * max(N0, N1) * Number.EPSILON` with documented source
- [ ] Tolerance is overridable via parameter (and the override is reflected in result.tolerance)
- [ ] dim(H^1) = 1 for the 3-cycle inconsistency sheaf (T7)
- [ ] dim(H^1) = 0 for flat sheaf on path (T7b)
- [ ] dim(H^1) = 2 for flat sheaf on triangle (T7c)
- [ ] BOTH flat and non-flat tests pass in the same test run (T7d -- dual configuration gate)
- [ ] `sheaf:h1-obstruction-detected` event fires with correct payload (T8)
- [ ] `sheaf:consensus-reached` event fires with correct payload (T8b)
- [ ] H^1 basis vectors have correct dimension and are unit-normalized (T8c)
- [ ] Absurdly loose tolerance (10.0) collapses all singular values -- proves tolerance matters
- [ ] Module isolation: zero cross-component imports (T9)
- [ ] Barrel export `src/sheaf/index.ts` exposes full public API
- [ ] All 5 ROADMAP.md success criteria pass
- [ ] All 7 extended criteria from 01-RESEARCH.md Section 12 pass
- [ ] Performance note comment exists in CohomologyAnalyzer.ts
- [ ] `npx vitest run` exits 0

## What This Wave Completes

This wave is the final wave of Phase 1. After completion:

- The sheaf module is fully functional with construction validation, Laplacian computation, cohomology analysis, event emission, and a consensus solver stub.
- All mathematical properties are verified by tests.
- The module is isolated from all other components.
- The ADMM interface is forward-compatible for future full implementation.
- The eigenspectrum output is ready for Phase 4 SOC consumption.
- The event interface is ready for Phase 5 Orchestrator subscription.

## Never-Allow List (Regression Guards)

These conditions must NEVER be true at any point after Wave 3 is complete:

1. **H^1 always zero:** If every test produces `h1Dimension = 0`, the non-flat test configuration is broken or missing. This is the #1 silent failure mode.
2. **B has shape `[|E|, |V|]`:** This means the graph incidence matrix was built instead of the sheaf coboundary operator.
3. **L_sheaf has shape `[|V|, |V|]`:** Same substitution error at the Laplacian level.
4. **Tolerance hardcoded to `1e-6`:** The tolerance must be calibrated from the singular value spectrum, not hardcoded.
5. **ml-matrix imported in CellularSheaf.ts or SheafLaplacian.ts:** ml-matrix is only for SVD in CohomologyAnalyzer.ts. Keep the boundary clean.
6. **Any import from src/lcm/, src/tna/, src/soc/, src/orchestrator/ in production sheaf files.**
