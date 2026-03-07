---
wave: 2
title: "Laplacian Implementation: Coboundary Operator, Sheaf Laplacian, ADMM Stub"
depends_on:
  - 02-PLAN.md # Wave 1 must be complete (types, CellularSheaf, test helpers)
files_modified:
  - src/sheaf/CellularSheaf.ts # Add Laplacian and coboundary methods
  - src/sheaf/CoboundaryOperator.ts # Standalone coboundary matrix assembly
  - src/sheaf/SheafLaplacian.ts # L_sheaf = B^T B computation + eigenspectrum
  - src/sheaf/ADMMSolver.ts # Interface + gradient descent stub
  - src/sheaf/CoboundaryOperator.test.ts # T3: hand-computed verification
  - src/sheaf/SheafLaplacian.test.ts # T4, T5, T6: PSD, null space, flat dims
  - src/sheaf/ADMMInterface.test.ts # T10: forward-compat interface tests
autonomous: true
commits:
  - "feat(sheaf): implement coboundary operator B and Sheaf Laplacian L_sheaf = B^T B"
  - "feat(sheaf): add ADMM solver interface with gradient descent stub"
---

# Wave 2: Laplacian Implementation

## Purpose

Implement the mathematical core of the sheaf module: the coboundary operator `B`, the Sheaf Laplacian `L_sheaf = B^T B`, and a forward-compatible ADMM solver stub. This wave is the most mathematically dangerous step in the entire project. The primary risk is substituting the standard graph Laplacian `L_graph = D - A` for the Sheaf Laplacian -- a substitution that compiles, runs, and produces plausible-looking results, but is mathematically wrong.

## Critical Pitfall Gate: Commit 3

**This wave corresponds to Commit 3 in the 5-commit sequence from 01-RESEARCH.md Section 10. Commit 3 has a MANDATORY safety gate:**

> Commit 3 must contain BOTH the flat sheaf test AND the 3-cycle inconsistency test helper. If only the flat sheaf test exists after this commit, CI cannot distinguish correct from incorrect implementation.

The flat sheaf test (T6) verifies that `dim(H^0) = stalkDim` for identity restriction maps. This test ALSO passes for `L_graph = D - A` when stalkDim = 1, making it insufficient as a sole correctness check. The 3-cycle test (tested fully in Wave 3) requires the non-flat factory from Wave 1 to already exist, and this wave must include at least one test that exercises the non-flat coboundary matrix assembly.

**Gate enforcement:** Task w2-t5 includes a mandatory test that computes `B` for the three-cycle inconsistency sheaf and verifies its dimensions are 3x6 (not 3x3, which would indicate a graph incidence matrix was built instead of a sheaf coboundary operator). This dimensional check catches the most common substitution error.

---

<task id="w2-t1" title="Implement coboundary operator B assembly (CoboundaryOperator.ts)">
  <description>
    Create `src/sheaf/CoboundaryOperator.ts` as a standalone module that assembles the coboundary matrix `B` from a `CellularSheaf`.

    The coboundary operator `delta_0 : C^0 -> C^1` is assembled as follows (from 01-RESEARCH.md Section 3.3):

    1. `B` is an `N_1 x N_0` matrix (N_1 = c1Dimension, N_0 = c0Dimension).
    2. Initialize `B` as a dense zero matrix using `math.zeros(N1, N0)`.
    3. For each edge `e` with source vertex `u` and target vertex `v`:
       - Compute row offset `eRow = edgeOffsets.get(e.id)`.
       - Compute column offsets `srcCol = vertexOffsets.get(u)`, `tgtCol = vertexOffsets.get(v)`.
       - Place `-F_{u<-e}` in the block at rows `[eRow, eRow+eDim)`, cols `[srcCol, srcCol+srcDim)`.
       - Place `+F_{v<-e}` in the block at rows `[eRow, eRow+eDim)`, cols `[tgtCol, tgtCol+tgtDim)`.
    4. Restriction map entries are row-major `Float64Array`. Reshape into the block using `entries[i * sourceDim + j]` for row `i`, column `j`.

    Export: `buildCoboundaryMatrix(sheaf: CellularSheaf): math.Matrix`

    Orientation convention: source vertex contributes the NEGATIVE block, target vertex contributes the POSITIVE block. This is fixed by the `SheafEdge.sourceVertex` / `SheafEdge.targetVertex` fields and must be consistent everywhere.

    Implementation note: Use `math.subset()` with `math.index()` to place blocks into the matrix. Alternative: build a 2D array row by row and convert to `math.matrix()` at the end. The second approach is simpler and avoids mathjs indexing quirks.

    CRITICAL: This is NOT the incidence matrix. The incidence matrix has scalar entries (+1, -1, 0). The coboundary operator has matrix-valued blocks. The shape of `B` is `N_1 x N_0` (not `|E| x |V|`). If `B` has shape `|E| x |V|`, the implementation is wrong.

  </description>
  <acceptance>
    - `buildCoboundaryMatrix()` returns a `math.Matrix` of shape `[N_1, N_0]`.
    - For the 2-vertex, 1-edge flat sheaf with 2D stalks and identity restriction maps:
      B = [[-1, 0, 1, 0], [0, -1, 0, 1]] (shape 2x4, NOT shape 1x2).
    - The function uses mathjs matrix operations only (no ml-matrix at this stage).
    - No mutation of the input `CellularSheaf`.
  </acceptance>
</task>

<task id="w2-t2" title="Implement Sheaf Laplacian L_sheaf = B^T B (SheafLaplacian.ts)">
  <description>
    Create `src/sheaf/SheafLaplacian.ts` that computes and caches the Sheaf Laplacian.

    Core computation:
    ```
    L_sheaf = transpose(B) * B
    ```

    Using mathjs: `math.multiply(math.transpose(B), B)`.

    Class design:

    ```typescript
    export class SheafLaplacian {
      private readonly sheaf: CellularSheaf;
      private cachedB: math.Matrix | null = null;
      private cachedL: math.Matrix | null = null;

      constructor(sheaf: CellularSheaf) { ... }

      /** Returns the coboundary operator B (N_1 x N_0 matrix). */
      getCoboundaryMatrix(): math.Matrix { ... }

      /** Returns the Sheaf Laplacian L_sheaf = B^T B (N_0 x N_0 matrix). */
      getSheafLaplacian(): math.Matrix { ... }

      /**
       * Returns eigenvalues of L_sheaf, sorted ascending.
       * Uses math.eigs() on the symmetric positive semidefinite L_sheaf.
       */
      getEigenspectrum(): SheafEigenspectrum { ... }

      /** Invalidate cached matrices (call after sheaf topology changes). */
      invalidateCache(): void { ... }
    }
    ```

    The eigenspectrum method returns a `SheafEigenspectrum` (defined in types/) with eigenvalues as `Float64Array`. The `computedAtIteration` field defaults to 0 in Phase 1 (will be set by the Orchestrator in Phase 5).

    Properties of L_sheaf that MUST be true (and will be tested):
    1. Shape is `N_0 x N_0`.
    2. Symmetric: `L_sheaf[i][j] = L_sheaf[j][i]` for all i,j.
    3. Positive semidefinite: all eigenvalues >= 0 (up to numerical tolerance).
    4. Null space dimension = dim(H^0) = number of independent global sections.
    5. For a flat sheaf on a connected graph: null space dimension = stalkDim.

  </description>
  <acceptance>
    - `getSheafLaplacian()` returns an `N_0 x N_0` math.Matrix.
    - L_sheaf is symmetric (max |L[i][j] - L[j][i]| < 1e-14).
    - All eigenvalues >= -1e-12 (positive semidefinite up to numerical noise).
    - `getEigenspectrum()` returns a Float64Array of length N_0.
    - Caching: calling `getSheafLaplacian()` twice returns the same matrix without recomputation.
    - `invalidateCache()` forces recomputation on next call.
  </acceptance>
</task>

<task id="w2-t3" title="Add Laplacian methods to CellularSheaf as convenience delegates">
  <description>
    Extend `src/sheaf/CellularSheaf.ts` (created in Wave 1) to include convenience methods that delegate to `SheafLaplacian`:

    ```typescript
    // Add to CellularSheaf class:
    private laplacianComputer: SheafLaplacian | null = null;

    private getLaplacianComputer(): SheafLaplacian {
      if (!this.laplacianComputer) {
        this.laplacianComputer = new SheafLaplacian(this);
      }
      return this.laplacianComputer;
    }

    getCoboundaryMatrix(): math.Matrix {
      return this.getLaplacianComputer().getCoboundaryMatrix();
    }

    getSheafLaplacian(): math.Matrix {
      return this.getLaplacianComputer().getSheafLaplacian();
    }

    getEigenspectrum(): SheafEigenspectrum {
      return this.getLaplacianComputer().getEigenspectrum();
    }
    ```

    This satisfies the ADMM forward-compatibility requirement: `getCoboundaryMatrix()`, `getSheafLaplacian()`, `getVertexOffset()`, `getEdgeOffset()`, and `getEdgeDim()` are all publicly accessible on `CellularSheaf`.

    Import `math` from `mathjs` in this file. This is the first mathjs import in the sheaf module.

  </description>
  <acceptance>
    - `sheaf.getCoboundaryMatrix()` returns the same matrix as `new SheafLaplacian(sheaf).getCoboundaryMatrix()`.
    - `sheaf.getSheafLaplacian()` returns the same matrix.
    - `sheaf.getEigenspectrum()` returns a valid `SheafEigenspectrum`.
    - The convenience methods are lazy-initialized (no computation until first call).
  </acceptance>
</task>

<task id="w2-t4" title="Implement ADMM solver interface with gradient descent stub">
  <description>
    Create `src/sheaf/ADMMSolver.ts` that defines the ADMM interface and provides a simple gradient descent implementation as a Phase 1 placeholder.

    Interface (from 01-RESEARCH.md Section 6.3):

    ```typescript
    export interface ADMMStepResult {
      readonly x: Float64Array;       // Updated C^0 vector
      readonly primalResidual: number; // ||Bx - z||
      readonly dualResidual: number;   // ||rho * B^T(z - z_prev)||
    }

    export interface ConvergenceResult {
      readonly converged: boolean;
      readonly primalResidual: number;
      readonly dualResidual: number;
      readonly iteration: number;
    }

    export interface ConsensusResult {
      readonly x: Float64Array;         // Final C^0 vector (all agent states)
      readonly converged: boolean;
      readonly iterations: number;
      readonly finalEnergy: number;     // Dirichlet energy = x^T L x
    }

    export class ADMMSolver {
      constructor(
        readonly sheaf: CellularSheaf,
        options?: { maxIterations?: number; tolerance?: number; rho?: number }
      );

      /** Run consensus to convergence. Returns the converged state vector. */
      solve(initialState: Float64Array): ConsensusResult;

      /** Compute the Dirichlet energy E(x) = x^T L_sheaf x. */
      computeDirichletEnergy(x: Float64Array): number;
    }
    ```

    Phase 1 implementation of `solve()`:
    - Use simple gradient descent on the Dirichlet energy: `x_{k+1} = x_k - alpha * L_sheaf * x_k`.
    - Step size `alpha = 0.5 / max_eigenvalue(L_sheaf)` (conservative safe step).
    - Convergence criterion: `||L_sheaf * x|| < tolerance` (Dirichlet energy gradient near zero).
    - Max iterations: default 1000.
    - This is NOT real ADMM. It is a placeholder that satisfies the same interface. Real ADMM implementation happens in a future phase when SHEAF-05 is fully addressed.

    Document the placeholder nature with a clear comment:
    ```typescript
    // PHASE 1 STUB: Uses gradient descent on Dirichlet energy.
    // Real ADMM with auxiliary variables z, u and per-edge updates
    // will replace this in a future phase (SHEAF-05 full implementation).
    ```

    The Dirichlet energy computation `x^T L x` uses `math.multiply()`.

  </description>
  <acceptance>
    - `ADMMSolver` constructs from a `CellularSheaf` without error.
    - `solve()` with an initial state near the global section converges to `||L*x|| < tolerance`.
    - `solve()` on a flat sheaf with random initial state converges to a constant section.
    - `computeDirichletEnergy()` returns 0 for a known global section of a flat sheaf.
    - `computeDirichletEnergy()` returns > 0 for a random non-section state.
    - The placeholder comment is present in the source code.
  </acceptance>
</task>

<task id="w2-t5" title="Write coboundary operator tests (T3) including non-flat dimensional check">
  <description>
    Create `src/sheaf/CoboundaryOperator.test.ts` with:

    **T3: Hand-computed coboundary matrix verification (2-vertex, identity maps)**

    From 01-RESEARCH.md Section 3.3:
    - Build a 2-vertex, 1-edge sheaf with 2D stalks and identity restriction maps.
    - B should be the 2x4 matrix: `[[-1, 0, 1, 0], [0, -1, 0, 1]]`.
    - Verify every entry of B matches the hand-computed value.
    - This is the single most important test for coboundary assembly correctness.

    **T3b: Coboundary matrix for 3-vertex path with heterogeneous stalks**
    - Vertex v0: dim=3, vertex v1: dim=2, vertex v2: dim=1.
    - Edge e01: dim=2, edge e12: dim=1.
    - Custom (non-identity) restriction maps.
    - Verify B has shape `[3, 6]` (N_1=3, N_0=6).
    - Verify specific block entries match hand computation.

    **T3c: Coboundary matrix for three-cycle inconsistency sheaf (PITFALL GATE)**
    - Use `buildThreeCycleInconsistentSheaf()` from Wave 1.
    - Verify B has shape `[3, 6]` (3 edges with 1D stalks, 3 vertices with 2D stalks).
    - THIS IS THE PITFALL GATE CHECK: if someone builds the graph incidence matrix instead, B would have shape `[3, 3]` (3 edges, 3 vertices). The shape `[3, 6]` proves the sheaf coboundary operator was built, not the graph incidence matrix.
    - Verify at least one off-diagonal block has a non-identity pattern (not all +1/-1 scalars).
    - Verify `B * x != 0` for a random x (the three-cycle has no global section, so ker(B) is smaller than C^0).

    **T3d: Orientation sign test**
    - Build the same 2-vertex sheaf but swap source and target.
    - Verify the B matrix has negated blocks compared to the original.
    - This confirms the orientation convention is consistent.

  </description>
  <acceptance>
    - T3: B = [[-1,0,1,0],[0,-1,0,1]] exactly (element-wise comparison with tolerance 1e-14).
    - T3b: B shape is [3, 6] for heterogeneous stalk dims.
    - T3c: B shape is [3, 6] for the three-cycle (NOT [3, 3]).
    - T3c: At least one block entry is not +1 or -1 (proves non-scalar restriction maps).
    - T3d: Swapping orientation negates the B matrix blocks correctly.
    - All tests pass with `npx vitest run`.
  </acceptance>
</task>

<task id="w2-t6" title="Write Sheaf Laplacian tests (T4, T5, T6)">
  <description>
    Create `src/sheaf/SheafLaplacian.test.ts` with:

    **T4: Sheaf Laplacian is positive semidefinite**
    - Build a flat sheaf with 4 vertices, 2D stalks, complete graph topology.
    - Compute L_sheaf via `sheaf.getSheafLaplacian()`.
    - Compute eigenvalues via `math.eigs(L_sheaf)`.
    - Assert: all eigenvalues >= -1e-12 (numerical tolerance for PSD).
    - This test catches sign errors in the coboundary assembly.

    **T5: L_sheaf * x = 0 for known global section (flat sheaf)**
    - Build a flat sheaf with 3 vertices, 2D stalks, path topology.
    - Construct a constant section: `x = [1, 0, 1, 0, 1, 0]` (all agents have state [1, 0]).
    - Compute `L * x` using `math.multiply(L_sheaf, x_array)`.
    - Assert: `||L * x|| < 1e-12`.
    - SECOND SECTION: x = [0, 1, 0, 1, 0, 1] (all agents have state [0, 1]).
    - Assert: `||L * x|| < 1e-12` for the second section too.
    - This demonstrates that dim(H^0) >= 2 for the flat 2D sheaf (both constant sections are in the null space).

    **T5b: L_sheaf * x = 0 DISCRIMINATION test (Sheaf Laplacian vs Graph Laplacian)**
    - Build the same 3-vertex path flat sheaf with 2D stalks.
    - Construct the constant section x = [1, 0, 1, 0, 1, 0].
    - Compute L_sheaf * x (should be zero).
    - Compute L_graph * x_reduced where L_graph is the 3x3 standard graph Laplacian [[1,-1,0],[-1,2,-1],[0,-1,1]] and x_reduced = [1, 1, 1] (scalar per vertex).
    - Assert: L_sheaf * x = 0 BUT L_graph * x_reduced = 0 too (constant scalar section is also in graph Laplacian null space).
    - NOW use x = [1, 0, 1, 0, 1, 0] with the GRAPH Laplacian expanded to 6x6 via Kronecker product L_graph tensor I_2. This should ALSO give zero because for a flat sheaf, L_sheaf = L_graph tensor I_d.
    - The REAL discrimination test: use a NON-FLAT sheaf and show L_sheaf * x != L_graph_tensor_I * x for the same x. Use the three-cycle sheaf. Compute L_sheaf for the three-cycle. Compute L_graph tensor I_2 for the triangle graph. Assert they are DIFFERENT matrices.

    **T6: Flat sheaf H^0 and H^1 dimensions (via eigenvalue counting)**
    - Build a flat sheaf with 3 vertices, 2D stalks, path topology.
    - Compute eigenvalues of L_sheaf.
    - Count eigenvalues < 1e-10 (these are the null space = H^0).
    - Assert: count = 2 (stalkDim for flat sheaf on connected graph).
    - dim(H^1) = N_1 - (N_0 - dim(H^0)) = N_1 - N_0 + dim(H^0).
    - For 3-vertex path: N_1 = 2*2 = 4, N_0 = 3*2 = 6, dim(H^0) = 2.
    - dim(H^1) = 4 - 6 + 2 = 0. Assert this.
    - Second test: flat sheaf on triangle (3 vertices, 3 edges, 2D stalks).
    - N_1 = 3*2 = 6, N_0 = 3*2 = 6, dim(H^0) = 2.
    - dim(H^1) = 6 - 6 + 2 = 2. Assert this.
    - This verifies the Euler characteristic formula for flat sheaves on both trees and cycles.

    **T6b: Eigenspectrum output format**
    - Call `sheaf.getEigenspectrum()`.
    - Assert: returns `SheafEigenspectrum` with `eigenvalues` as `Float64Array`.
    - Assert: `eigenvalues.length = N_0`.
    - Assert: eigenvalues are sorted ascending.
    - Assert: all eigenvalues >= -1e-12.

  </description>
  <acceptance>
    - T4: All eigenvalues >= -1e-12.
    - T5: ||L * x|| < 1e-12 for both constant sections.
    - T5b: L_sheaf for three-cycle differs from L_graph tensor I_2.
    - T6: dim(H^0) = 2 for flat path; dim(H^1) = 0 for flat path; dim(H^1) = 2 for flat triangle.
    - T6b: Eigenspectrum is Float64Array, length N_0, sorted ascending, all non-negative.
    - All tests pass with `npx vitest run`.
  </acceptance>
</task>

<task id="w2-t7" title="Write ADMM interface forward-compatibility tests (T10)">
  <description>
    Create `src/sheaf/ADMMInterface.test.ts` with:

    **T10: ADMM interface methods are accessible on CellularSheaf**
    - `getCoboundaryMatrix()` returns matrix with shape `[c1Dimension, c0Dimension]`.
    - `getSheafLaplacian()` returns matrix with shape `[c0Dimension, c0Dimension]`.
    - `getVertexOffset()` returns correct cumulative sums.
    - `getEdgeOffset()` returns correct cumulative sums.
    - `getEdgeDim()` returns the correct edge stalk dimension.
    - `getEdgeRestrictions()` returns both restriction maps for a given edge.
    - `getVertexIds()` and `getEdgeIds()` return arrays in insertion order.

    **T10b: ADMMSolver basic convergence**
    - Construct `ADMMSolver` with a flat 3-vertex path sheaf.
    - Call `solve()` with a random initial state.
    - Assert: converged = true.
    - Assert: final state is a constant section (all vertex states equal, up to tolerance).
    - Assert: Dirichlet energy of final state < tolerance.

    **T10c: Dirichlet energy correctness**
    - Compute `computeDirichletEnergy(global_section)` for a known global section.
    - Assert: energy = 0 (up to tolerance).
    - Compute `computeDirichletEnergy(random_state)` for a random non-section.
    - Assert: energy > 0.

    These tests verify that the ADMM interface is complete enough for a future phase to replace the gradient descent internals with real ADMM without changing any test.

  </description>
  <acceptance>
    - All `getCoboundaryMatrix`, `getSheafLaplacian`, `getVertexOffset`, `getEdgeOffset`, `getEdgeDim`, `getEdgeRestrictions`, `getVertexIds`, `getEdgeIds` are callable and return correct types.
    - ADMMSolver converges on a flat sheaf.
    - Dirichlet energy = 0 for global section, > 0 for non-section.
    - All tests pass with `npx vitest run`.
  </acceptance>
</task>

---

## Verification Criteria

After Wave 2 is complete, the following must all be true:

1. `npx tsc --noEmit` passes with zero errors.
2. `npx vitest run` passes all tests in `CoboundaryOperator.test.ts`, `SheafLaplacian.test.ts`, and `ADMMInterface.test.ts`.
3. The coboundary matrix `B` has shape `[N_1, N_0]` -- NOT `[|E|, |V|]`.
4. `L_sheaf = B^T B` is positive semidefinite (all eigenvalues >= -1e-12).
5. `L_sheaf * x = 0` for constant sections of flat sheaves.
6. The three-cycle inconsistency sheaf produces a DIFFERENT Laplacian than `L_graph tensor I_d`.
7. dim(H^0) = stalkDim for flat sheaves on connected graphs (verified via eigenvalue counting).
8. ADMMSolver converges to a global section on flat sheaves.
9. All files in `src/sheaf/` have zero imports from `src/lcm/`, `src/tna/`, `src/soc/`, `src/orchestrator/`.

## Must-Haves

- [ ] Coboundary matrix B assembly places NEGATIVE source block and POSITIVE target block (orientation convention)
- [ ] B shape is `[N_1, N_0]` for all test configurations (not `[|E|, |V|]`)
- [ ] L_sheaf = B^T B computed via mathjs `multiply(transpose(B), B)`
- [ ] L_sheaf is symmetric and positive semidefinite (tested)
- [ ] L_sheaf \* x = 0 for constant sections of flat sheaves (T5)
- [ ] L_sheaf for three-cycle DIFFERS from L_graph tensor I_d (T5b -- discrimination test)
- [ ] dim(H^0) = 2 for flat 2D sheaf on connected graph, verified via eigenvalue counting (T6)
- [ ] Three-cycle inconsistency sheaf B has shape [3, 6] not [3, 3] (PITFALL GATE -- T3c)
- [ ] ADMMSolver interface exposes `solve()`, `computeDirichletEnergy()` with correct signatures
- [ ] getEigenspectrum() returns Float64Array, sorted ascending, all non-negative (T6b)
- [ ] All mathematical operations use mathjs (not ml-matrix) -- ml-matrix is reserved for SVD in Wave 3

## What This Wave Does NOT Include

- No SVD computation (Wave 3)
- No cohomology analysis beyond eigenvalue counting (Wave 3)
- No H^1 basis extraction (Wave 3)
- No event emission (Wave 3)
- No tolerance calibration (Wave 3)
- No isolation test (Wave 3)

## Risk Notes

### Silent Substitution Risk

The most dangerous code in this wave is the coboundary assembly in `w2-t1`. If a developer builds the graph incidence matrix (scalar +1/-1 entries, shape `|E| x |V|`) instead of the sheaf coboundary operator (matrix-valued blocks, shape `N_1 x N_0`), ALL flat sheaf tests with stalkDim=1 will still pass. The defenses are:

1. **T3c** -- the three-cycle B has shape `[3, 6]` not `[3, 3]`.
2. **T5b** -- the three-cycle L_sheaf differs from L_graph tensor I_d.
3. **T6** -- dim(H^0) = 2 for a 2D flat sheaf (graph Laplacian gives dim(H^0) = 1 regardless of stalkDim).

All three defenses must pass. If ANY of them is removed from the test suite, the substitution risk is re-introduced.

### Numerical Conditioning

The eigenvalue computation via `math.eigs()` on L_sheaf may produce small negative eigenvalues (e.g., -1e-15) due to floating-point arithmetic in the B^T B multiplication. The tolerance for PSD checking is set at -1e-12. If eigenvalues more negative than this appear, the coboundary assembly has a sign error -- do NOT increase the tolerance to paper over it. Fix the assembly.
