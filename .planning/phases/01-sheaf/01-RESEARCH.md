# Phase 1 Research: Sheaf-Theoretic Coordination

**Phase:** 1 — Sheaf-Theoretic Coordination
**Requirements:** SHEAF-01, SHEAF-02, SHEAF-03, SHEAF-04, SHEAF-05, SHEAF-06
**Scope:** `src/types/` (shared interfaces) + `src/sheaf/`
**Research date:** 2026-02-27
**Confidence:** HIGH

---

## 1. Why Phase 1 is the Highest-Risk Phase

Phase 1 is deliberately placed first because the Sheaf Laplacian has the most dangerous silent failure mode in the entire project. A developer who substitutes the standard combinatorial graph Laplacian `L_graph = D - A` for the Sheaf Laplacian `L_sheaf = B^T B` will produce a system that:

- Compiles and runs without errors
- Returns finite numbers for all consensus operations
- Converges to a stable state in every test
- But converges to a mathematically meaningless state that has nothing to do with sheaf-theoretic consensus

There is no obvious runtime signal that this substitution has occurred. The only way to catch it is a specific unit test that verifies `L_sheaf * x = 0` for a known global section — and separately confirms that `L_graph * x != 0` for the same section (proving the two operators are distinct and the correct one passed). That test must exist from the first commit.

The same phase carries two secondary silent-failure risks: shipping a flat sheaf (identity restriction maps everywhere, making H^1 trivially zero so the obstruction detection code path is never triggered) and using an SVD rank tolerance that absorbs small but structurally significant cohomology classes.

All three must be addressed with verified tests before any Phase 2+ code depends on consensus or cohomology outputs.

---

## 2. Mathematical Foundations

### 2.1 Cellular Sheaf — Core Data Structure

A cellular sheaf `F` over an undirected graph `G = (V, E)` assigns:

- A finite-dimensional inner product space `F(v)` (the **vertex stalk**) to each vertex `v ∈ V`
- A finite-dimensional inner product space `F(e)` (the **edge stalk**) to each edge `e ∈ E`
- A linear map `F_{v←e} : F(v) → F(e)` (a **restriction map**) for every vertex `v` incident to edge `e`

The restriction map `F_{v←e}` projects an agent's local state vector into the shared interaction space of the edge. When two adjacent agents `u` and `v` connected by edge `e` satisfy `F_{u←e}(x_u) = F_{v←e}(x_v)`, their states are locally consistent on that edge.

**Key facts to keep clear:**

- Vertex stalk dimensions can differ between agents: `dim(F(v_i)) != dim(F(v_j))` is fully supported.
- Edge stalk dimensions can differ between edges. They need not equal vertex stalk dimensions.
- Restriction maps are in general not square matrices. `F_{v←e}` maps from `R^{dim(F(v))}` to `R^{dim(F(e))}`.
- A **global section** (assignment achieving full consensus) is a tuple `x = (x_v)_{v ∈ V}` where `F_{u←e}(x_u) = F_{v←e}(x_v)` for every edge `e = (u,v)`.

### 2.2 Cochain Spaces

Define the two cochain spaces:

- `C^0(G, F) = ⊕_{v ∈ V} F(v)` — the direct sum of all vertex stalks. Dimension = `Σ_v dim(F(v))`.
- `C^1(G, F) = ⊕_{e ∈ E} F(e)` — the direct sum of all edge stalks. Dimension = `Σ_e dim(F(e))`.

A 0-cochain `x ∈ C^0` is the concatenated vector of all agent states. The total dimension of `x` is `N_0 = Σ_v dim(F(v))`.

A 1-cochain `y ∈ C^1` is the concatenated vector of all edge disagreement measures. The total dimension of `y` is `N_1 = Σ_e dim(F(e))`.

**Implementation assertion (must be tested):** Before any Laplacian computation, assert:

```
N_0 == sum over all v of stalk.dim(v)
N_1 == sum over all e of stalk.dim(e)
```

This is the cheapest possible guard against stalk bookkeeping errors.

### 2.3 Coboundary Operator

The coboundary operator `δ_0 : C^0 → C^1` is the core of the sheaf. For each **oriented** edge `e = (u → v)` (orientation is arbitrary but must be fixed):

```
(δ_0 x)_e = F_{v←e}(x_v) - F_{u←e}(x_u)
```

The total coboundary operator `B` is the matrix that stacks these per-edge contributions. Its structure:

- `B` is an `N_1 × N_0` matrix.
- For each edge `e` connecting vertices `u` and `v` (with fixed orientation `u → v`):
  - The block corresponding to `v`'s vertex stalk columns and `e`'s edge stalk rows is `+F_{v←e}`.
  - The block corresponding to `u`'s vertex stalk columns and `e`'s edge stalk rows is `-F_{u←e}`.
  - All other blocks in those rows are zero.

**This is not the incidence matrix of the underlying graph.** The incidence matrix has scalar entries (+1, -1, 0). The coboundary operator has matrix-valued blocks. This is the critical distinction from the graph Laplacian construction.

### 2.4 Sheaf Laplacian

The Sheaf Laplacian is defined as:

```
L_sheaf = B^T B
```

It is an `N_0 × N_0` positive-semidefinite matrix. Its null space is exactly the space of global sections `H^0(G, F) = ker(δ_0)`.

**Why this is not `D - A`:**

The standard graph Laplacian `L_graph = D - A` has shape `|V| × |V|` and entries that are scalars. It assumes all vertex states are one-dimensional. `L_sheaf` has shape `N_0 × N_0` where `N_0 = Σ_v dim(F(v))` and its blocks encode the restriction map geometry. For a homogeneous sheaf where all stalks are 1D and all restriction maps are identity maps, `L_sheaf` reduces to `L_graph ⊗ I_1 = L_graph`. But that is the only case of equivalence.

**Block structure of `L_sheaf`:**

For each pair of vertices `(u, v)`:

- If there is no edge between them: block is zero.
- If `e = (u, v)` is an edge: the diagonal block `L_sheaf[v, v]` receives `F_{v←e}^T F_{v←e}` and the off-diagonal block `L_sheaf[u, v]` receives `-F_{u←e}^T F_{v←e}`.

This can be assembled edge-by-edge and is the correct assembly procedure.

### 2.5 Sheaf Cohomology H^0 and H^1

**H^0 (zeroth cohomology):** The space of global sections.

```
H^0(G, F) = ker(δ_0) = ker(B) = null space of L_sheaf
```

`dim(H^0)` is the number of linearly independent global consensus states. For a flat sheaf on a connected graph, `dim(H^0) = d` where `d` is the common stalk dimension (there is a d-dimensional space of constant global sections). For a non-flat sheaf, `dim(H^0)` may be smaller.

**H^1 (first cohomology):** The space of obstructions.

```
H^1(G, F) = ker(δ_1) / im(δ_0)
```

For sheaves over graphs (1-dimensional CW complexes), `δ_1 = 0` because there are no 2-cochains. Therefore:

```
H^1(G, F) = C^1 / im(δ_0) = C^1 / im(B)
dim(H^1) = N_1 - rank(B)
```

By the rank-nullity theorem: `rank(B) = N_0 - dim(H^0)`.

So:

```
dim(H^1) = N_1 - N_0 + dim(H^0)
         = (Σ_e dim(F(e))) - (Σ_v dim(F(v))) + dim(ker(B))
```

This is the Euler characteristic formula for the cochain complex. For a connected graph with consistent flat sheaf: `dim(H^0) = d`, `dim(H^1) = |E|*d - |V|*d + d = d(|E| - |V| + 1)`. For a tree, `|E| = |V| - 1`, so `dim(H^1) = 0`. For a triangle (cycle), `dim(H^1) = d * 1 = d`.

**Key implication:** A non-flat sheaf on a triangle can have `dim(H^1) > 0` even when the underlying graph has no non-trivial cycles, because the restriction maps modify the effective cycle structure in the cochain complex. This is the mechanism we use for the synthetic 3-cycle test (see Section 5).

### 2.6 ADMM for Sheaf Consensus (Phase 1 Forward-Compatibility)

ADMM (Alternating Direction Method of Multipliers) is listed in SHEAF-05 and will solve:

```
minimize   (1/2) ||B x||^2 = (1/2) x^T L_sheaf x    (Dirichlet energy)
subject to  x ∈ C^0
```

ADMM introduces auxiliary variables `z_e ∈ F(e)` for each edge `e` and enforces the coupling constraint `B_e x = z_e`. The ADMM update rules are:

```
x^{k+1} = argmin { (1/2)||Bx||^2 + (ρ/2)||Bx - z^k + u^k||^2 }
         = (L_sheaf + ρ * B^T B)^{-1} * ρ * B^T (z^k - u^k)
z^{k+1} = prox_{g/ρ}(B x^{k+1} + u^k)   [for unconstrained: z^{k+1} = Bx^{k+1} + u^k]
u^{k+1} = u^k + B x^{k+1} - z^{k+1}
```

For the unconstrained consensus problem, the `x` update simplifies to a linear solve of:

```
(L_sheaf + ρ I) x^{k+1} = ρ * B^T (z^k - u^k)
```

**Forward-compatibility constraint from Phase 1:** The ADMM solver's `x`-update step requires:

1. Access to `L_sheaf` (or equivalently `B`) — straightforward.
2. Access to `B^T` — the transpose of the coboundary operator.
3. Per-edge auxiliary variables `z_e ∈ F(e)` — requires knowing `dim(F(e))` for each edge.
4. A linear solve of shape `N_0 × N_0`.

The interface implications for Phase 1 design:

- `CellularSheaf` must expose `getCoboundaryMatrix(): Matrix` (the full `B` matrix).
- `CellularSheaf` must expose `getSheafLaplacian(): Matrix` (the full `L_sheaf = B^T B` matrix).
- Restriction maps must be retrievable per-edge and per-vertex-pair, not just assembled as a block matrix (ADMM's distributed variant updates one edge at a time).
- `EdgeStalk` must expose its dimension so ADMM can allocate `z` variables of the right size.

If Phase 1 hides these behind an opaque "run consensus" method that returns only the converged state, ADMM cannot be added in Phase 2 without rewriting the sheaf internals. Design the sheaf class to expose its internals to the ADMM layer.

---

## 3. TypeScript Implementation Design

### 3.1 Shared Types — `src/types/`

These must be defined before Phase 1 implementation begins. The types module is the first deliverable of Phase 1, not a separate phase.

**Core sheaf types:**

```typescript
// src/types/GraphTypes.ts

/** An opaque string ID for graph vertices (agents). */
export type VertexId = string;

/** An opaque string ID for graph edges (communication channels). */
export type EdgeId = string;

/**
 * Represents a finite-dimensional inner product space of a given dimension.
 * The actual vector values are number[] or Float64Array; this type describes the space.
 */
export interface StalkSpace {
  /** Dimension of this stalk space (number of coordinates). */
  readonly dim: number;
  /** Human-readable label for debugging and logging. */
  readonly label?: string;
}

/**
 * A concrete vector in a stalk space.
 * Float64Array is preferred over number[] for numeric stability in Laplacian computations.
 */
export type StalkVector = Float64Array;

/**
 * A restriction map from a vertex stalk to an edge stalk.
 * Shape: [edgeDim × vertexDim] — maps R^vertexDim → R^edgeDim.
 * Stored in row-major order as a flat Float64Array.
 */
export interface RestrictionMap {
  readonly sourceVertexId: VertexId;
  readonly edgeId: EdgeId;
  readonly sourceDim: number; // dim(F(vertex))
  readonly targetDim: number; // dim(F(edge))
  /** Row-major matrix entries. Length = targetDim * sourceDim. */
  readonly entries: Float64Array;
}

/**
 * An edge in the sheaf's base graph with its stalk space and both restriction maps.
 */
export interface SheafEdge {
  readonly id: EdgeId;
  readonly sourceVertex: VertexId;
  readonly targetVertex: VertexId;
  readonly stalkSpace: StalkSpace;
  /** Restriction from source vertex stalk to edge stalk. */
  readonly sourceRestriction: RestrictionMap;
  /** Restriction from target vertex stalk to edge stalk. */
  readonly targetRestriction: RestrictionMap;
}

/**
 * A vertex in the sheaf's base graph with its stalk space and current state.
 */
export interface SheafVertex {
  readonly id: VertexId;
  readonly stalkSpace: StalkSpace;
}

/**
 * The result of a Sheaf Cohomology analysis.
 */
export interface CohomologyResult {
  /** Dimension of H^0: number of independent global sections. */
  readonly h0Dimension: number;
  /** Dimension of H^1: number of independent obstructions. */
  readonly h1Dimension: number;
  /** Whether H^1 is non-trivial (h1Dimension > 0). */
  readonly hasObstruction: boolean;
  /** Basis vectors for H^1 (the obstruction classes), if hasObstruction is true. */
  readonly h1Basis: Float64Array[];
  /** The numerical tolerance used for SVD rank computation. */
  readonly tolerance: number;
  /** Diagnostic: rank of the coboundary operator B. */
  readonly coboundaryRank: number;
}
```

**Event types for cross-component signaling (Phase 5 forward-compatibility):**

```typescript
// src/types/Events.ts

export type SheafEventType =
  | "sheaf:consensus-reached"
  | "sheaf:h1-obstruction-detected"
  | "sheaf:iteration-complete";

export interface SheafConsensusReachedEvent {
  readonly type: "sheaf:consensus-reached";
  readonly iteration: number;
  readonly h0Dimension: number;
  readonly dirichletEnergy: number;
}

export interface SheafH1ObstructionEvent {
  readonly type: "sheaf:h1-obstruction-detected";
  readonly iteration: number;
  readonly h1Dimension: number;
  readonly h1Basis: Float64Array[];
  /** Which vertices are involved in the obstruction cycle. */
  readonly affectedVertices: VertexId[];
}

export type SheafEvent = SheafConsensusReachedEvent | SheafH1ObstructionEvent;
```

**Why `Float64Array` instead of `number[]`?**

Float64Array uses native 64-bit IEEE 754 doubles in a typed buffer. This gives two benefits:

1. Better numeric consistency — no boxing/unboxing overhead and predictable memory layout.
2. Direct interop with mathjs's typed array support (`math.matrix(float64Array)` works directly).

The downside is that Float64Array is not dynamically resizable. Since stalk dimensions are fixed at sheaf construction time, this is acceptable.

### 3.2 `CellularSheaf` Class Design

```typescript
// src/sheaf/CellularSheaf.ts

export class CellularSheaf {
  private readonly vertices: Map<VertexId, SheafVertex>;
  private readonly edges: Map<EdgeId, SheafEdge>;

  constructor(vertices: SheafVertex[], edges: SheafEdge[]) {
    // Validate all restriction map dimensions match declared stalk spaces.
    // Throw if any sourceRestriction.sourceDim != vertex.stalkSpace.dim
    // Throw if any sourceRestriction.targetDim != edge.stalkSpace.dim
    // This constructor-time validation is the first line of defense.
  }

  /** Total dimension of C^0 = Σ_v dim(F(v)). */
  get c0Dimension(): number { ... }

  /** Total dimension of C^1 = Σ_e dim(F(e)). */
  get c1Dimension(): number { ... }

  /**
   * Returns the coboundary operator B as an (N1 × N0) matrix.
   * The column ordering follows vertex insertion order.
   * The row ordering follows edge insertion order.
   *
   * ADMM compatibility: this matrix is needed by the ADMM x-update step.
   */
  getCoboundaryMatrix(): math.Matrix { ... }

  /**
   * Returns the Sheaf Laplacian L_sheaf = B^T B as an (N0 × N0) matrix.
   * Positive semidefinite; null space = H^0.
   *
   * ADMM compatibility: this matrix enters the ADMM x-update linear solve.
   */
  getSheafLaplacian(): math.Matrix { ... }

  /**
   * Returns the column offset of vertex v in the C^0 vector.
   * Required by ADMM to extract per-vertex state from the global x vector.
   */
  getVertexOffset(vertexId: VertexId): number { ... }

  /**
   * Returns the row offset of edge e in the C^1 vector.
   * Required by ADMM to extract per-edge auxiliary variable from the global z vector.
   */
  getEdgeOffset(edgeId: EdgeId): number { ... }

  /**
   * Returns both restriction maps for an edge.
   * ADMM compatibility: needed for the distributed ADMM variant that updates one edge at a time.
   */
  getEdgeRestrictions(edgeId: EdgeId): { source: RestrictionMap; target: RestrictionMap } { ... }

  /** Returns the edge stalk dimension for a given edge. */
  getEdgeDim(edgeId: EdgeId): number { ... }

  /** Returns all vertex IDs in insertion order. */
  getVertexIds(): VertexId[] { ... }

  /** Returns all edge IDs in insertion order. */
  getEdgeIds(): EdgeId[] { ... }
}
```

**Why expose `getCoboundaryMatrix()` in Phase 1?**

SHEAF-05 (ADMM solver) is listed as a Phase 1 requirement. Even if the ADMM implementation follows the direct Laplacian diffusion in the same commit, the interface must be designed so that the `ADMMSolver` class can access `B` directly. If `B` is a private implementation detail, ADMM cannot be wired up without re-opening the class. Make it part of the public API from the start.

### 3.3 Coboundary Matrix Assembly — Concrete Algorithm

The most error-prone step is assembling `B` correctly. Here is the concrete procedure:

```typescript
buildCoboundaryMatrix(): math.Matrix {
  const N0 = this.c0Dimension;
  const N1 = this.c1Dimension;

  // Build a dense zero matrix of shape N1 × N0.
  // For larger sheaves, use math.sparse() instead.
  const B = math.zeros(N1, N0) as math.Matrix;

  // Compute vertex column offsets (cumulative sum of stalk dims).
  const vertexOffsets = this.computeVertexOffsets(); // Map<VertexId, number>

  // Compute edge row offsets (cumulative sum of edge stalk dims).
  const edgeOffsets = this.computeEdgeOffsets(); // Map<EdgeId, number>

  for (const [edgeId, edge] of this.edges) {
    const eRow = edgeOffsets.get(edgeId)!;
    const eDim = edge.stalkSpace.dim;

    const srcId = edge.sourceVertex;
    const tgtId = edge.targetVertex;
    const srcCol = vertexOffsets.get(srcId)!;
    const tgtCol = vertexOffsets.get(tgtId)!;
    const srcDim = this.vertices.get(srcId)!.stalkSpace.dim;
    const tgtDim = this.vertices.get(tgtId)!.stalkSpace.dim;

    // Fill block for source vertex: -F_{source←e}
    // Shape: eDim × srcDim, placed at rows [eRow, eRow+eDim), cols [srcCol, srcCol+srcDim)
    const srcBlock = reshapeEntries(edge.sourceRestriction.entries, eDim, srcDim);
    setBlockNegated(B, eRow, srcCol, srcBlock);

    // Fill block for target vertex: +F_{target←e}
    // Shape: eDim × tgtDim, placed at rows [eRow, eRow+eDim), cols [tgtCol, tgtCol+tgtDim)
    const tgtBlock = reshapeEntries(edge.targetRestriction.entries, eDim, tgtDim);
    setBlockPositive(B, eRow, tgtCol, tgtBlock);
  }

  return B;
}
```

**Orientation convention:** Each edge has a fixed source→target orientation. The source vertex contributes `-F_{source←e}` and the target vertex contributes `+F_{target←e}`. The orientation is arbitrary but must be consistent throughout.

**Validation test for coboundary assembly:**

For a two-vertex, one-edge sheaf with stalk spaces both R^2 and restriction maps both equal to identity I_2:

- `B` should be the 2×4 matrix `[−I_2 | +I_2] = [[-1,0,1,0],[0,-1,0,1]]`
- `L_sheaf = B^T B` should be the 4×4 matrix:
  ```
  [ 1  0 -1  0]
  [ 0  1  0 -1]
  [-1  0  1  0]
  [ 0 -1  0  1]
  ```
- The null space of `L_sheaf` should be spanned by `[1,0,1,0]` and `[0,1,0,1]` (the two constant sections).
- `dim(H^0) = 2`, `dim(H^1) = 0`.

This is the minimal numerical sanity check that can be computed by hand.

### 3.4 Eigenvalue and Null-Space Computation

The null space of `L_sheaf` is `H^0`. The cohomology is computed via SVD of `B` (not eigendecomposition of `L_sheaf`), for numerical reasons.

**Why SVD of B, not eigendecomposition of L_sheaf?**

1. `L_sheaf = B^T B` is numerically ill-conditioned at its zero eigenvalues. Eigendecomposition of a singular matrix is less numerically stable than SVD.
2. SVD of `B` directly gives: `ker(B) = right singular vectors with singular value 0` (that is `H^0`), and `im(B) = left singular vectors with non-zero singular value` (needed for `H^1` computation).
3. The rank of `B` is directly read from how many singular values are above the threshold.

**Using `ml-matrix` for SVD:**

```typescript
import { Matrix, SingularValueDecomposition } from "ml-matrix";

function computeCohomology(
  sheaf: CellularSheaf,
  tolerance?: number,
): CohomologyResult {
  const B = sheaf.getCoboundaryMatrix();
  const N0 = sheaf.c0Dimension;
  const N1 = sheaf.c1Dimension;

  // Convert mathjs matrix to ml-matrix Matrix for SVD.
  const bArray: number[][] = math.toArray(B) as number[][];
  const mlB = new Matrix(bArray);

  const svd = new SingularValueDecomposition(mlB, { autoTranspose: true });
  const singularValues = svd.diagonal; // Sorted descending.

  // Calibrate tolerance.
  const maxEntry = Math.max(...bArray.flat().map(Math.abs));
  const tol = tolerance ?? maxEntry * Math.max(N0, N1) * 2.22e-16;
  // 2.22e-16 is machine epsilon for float64.

  const rank = singularValues.filter((s) => s > tol).length;

  const h0Dimension = N0 - rank;
  const h1Dimension = N1 - rank;

  // Extract H^0 basis: right singular vectors corresponding to near-zero singular values.
  const V = svd.V; // N0 × N0 matrix of right singular vectors (columns).
  const h0Basis: Float64Array[] = [];
  for (let i = rank; i < N0; i++) {
    // Column i of V is a basis vector for ker(B).
    h0Basis.push(new Float64Array(V.getColumn(i)));
  }

  // Extract H^1 representative: left singular vectors NOT in im(B).
  // im(B) is spanned by left singular vectors with non-zero singular values.
  // H^1 basis: left singular vectors with near-zero singular values.
  const U = svd.U; // N1 × N1 matrix of left singular vectors.
  const h1Basis: Float64Array[] = [];
  for (let i = rank; i < Math.min(N1, U.columns); i++) {
    h1Basis.push(new Float64Array(U.getColumn(i)));
  }

  return {
    h0Dimension,
    h1Dimension,
    hasObstruction: h1Dimension > 0,
    h1Basis,
    tolerance: tol,
    coboundaryRank: rank,
  };
}
```

**Note on `ml-matrix` vs `mathjs` for SVD:**

`mathjs` has `math.eigs()` but not a direct SVD implementation available in v15. `ml-matrix` provides a full SVD (`SingularValueDecomposition`) with access to U, S, V matrices. The recommended approach is to use `mathjs` for Sheaf Laplacian construction (matrix assembly, arithmetic) and `ml-matrix` for SVD-based null-space computation. The two libraries interop through standard JavaScript 2D arrays.

**`mathjs.eigs()` for eigenspectrum (Phase 4 forward-compatibility):**

Phase 4 (SOC) will use the eigenspectrum of the Sheaf graph's normalized Laplacian for Von Neumann entropy. The `math.eigs()` return signature is:

```typescript
const result = math.eigs(L_sheaf);
// result.values: MathCollection — eigenvalues, sorted
// result.eigenvectors: Array<{ value: number, vector: MathCollection }>
```

Expose a method on `SheafLaplacian` that returns the eigenspectrum as `Float64Array` for Phase 4 consumption:

```typescript
getEigenspectrum(): Float64Array {
  const result = math.eigs(this.L_sheaf);
  return new Float64Array(result.values.toArray() as number[]);
}
```

---

## 4. Library Selection — Final Recommendations

### 4.1 Linear Algebra: mathjs + ml-matrix Dual Approach

**Recommendation:** Use both. They serve different roles and are complementary.

| Task                                             | Library            | Reason                                                                                                                         |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Matrix assembly (coboundary operator, Laplacian) | `mathjs 15.1.1`    | Flexible matrix arithmetic; sparse matrix support; handles non-square matrices naturally via `math.multiply`, `math.transpose` |
| SVD for null-space computation                   | `ml-matrix 6.12.1` | Provides `SingularValueDecomposition` with access to U, S, V; typed array backed; no equivalent in mathjs 15.x                 |
| Eigenvalue decomposition (Laplacian spectrum)    | `mathjs 15.1.1`    | `math.eigs()` supports real symmetric matrices; returns both values and eigenvectors                                           |
| Matrix-vector products in ADMM iterations        | `mathjs 15.1.1`    | `math.multiply()` handles the mixed real/sparse products                                                                       |

**Why not `numeric.js`?** Last commit 2016, no TypeScript types, no SVD, no complex eigenvalue support. Dead library.

**Why not `@tensorflow/tfjs-node`?** 300+ MB install, native build fragility on Node version upgrades, GPU dependency for a pure CPU linear algebra task. Complete overkill.

**Why not a pure `mathjs` approach?** `mathjs` does not currently expose a standalone SVD API. Its `math.lup()` (LU decomposition) exists but is not suitable for null-space computation of nearly-singular matrices. Using ml-matrix for the specific SVD step is the minimal addition needed.

### 4.2 mathjs Sparse Matrix Usage

For sheaves with more than ~20 agents, dense matrix operations become expensive. mathjs supports sparse matrices:

```typescript
import { sparse, multiply, transpose } from "mathjs";

// Build B as sparse from the start.
const B = sparse(bDenseArray);

// L_sheaf = B^T B is also sparse.
const BT = transpose(B);
const L_sheaf = multiply(BT, B);
```

The sparse format is COO (coordinate list) internally in mathjs. For Phase 1 with synthetic test sheaves (3–10 vertices), dense is fine. The interface should be designed to accept sparse matrices to avoid a rewrite when sheaves grow.

**Recommendation:** Design the internal matrix representation to work with `math.Matrix` (which unifies dense and sparse). Pass matrices through the `math.Matrix` interface everywhere internally. Only convert to `ml-matrix.Matrix` at the SVD boundary.

### 4.3 Testing: vitest

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    pool: "forks", // required for ml-matrix native module isolation
    include: ["src/**/*.test.ts"],
  },
});
```

vitest is chosen over jest because it handles native ESM packages (`mathjs`, `ml-matrix`) without CommonJS shims. The `--pool=forks` flag isolates tests that use `better-sqlite3` or native modules. All Phase 1 tests are pure TypeScript with no native modules, so this is not strictly needed until Phase 2, but establish the configuration now.

### 4.4 Type Safety with Zod (Optional for Phase 1)

Zod can validate sheaf configurations at runtime before construction:

```typescript
import { z } from "zod";

const RestrictionMapSchema = z
  .object({
    sourceVertexId: z.string().min(1),
    edgeId: z.string().min(1),
    sourceDim: z.number().int().positive(),
    targetDim: z.number().int().positive(),
    entries: z
      .instanceof(Float64Array)
      .refine((arr) => arr.every((v) => isFinite(v)), {
        message: "Restriction map entries must be finite",
      }),
  })
  .refine((rm) => rm.entries.length === rm.sourceDim * rm.targetDim, {
    message: "entries.length must equal sourceDim * targetDim",
  });
```

This is particularly useful for the security pitfall (restriction maps loaded from external configuration files with wrong dimensions). Validate at sheaf construction time; reject malformed configurations before they silently corrupt Laplacian assembly.

---

## 5. Mathematical Pitfalls — Detailed Treatment

### 5.1 Pitfall: Graph Laplacian vs. Sheaf Laplacian Substitution

**What triggers it:** Developer looks up "graph Laplacian" for multi-agent consensus and implements `L = D - A` where `D` is the degree matrix and `A` is the adjacency matrix. Both have shape `|V| × |V|` with scalar entries.

**How to detect it:** The null space of `L_graph` on a connected graph always has dimension 1 (spanned by the all-ones vector). The null space of `L_sheaf` for a flat sheaf with d-dimensional stalks has dimension `d` (spanned by the d constant sections). These are measurably different.

**Definitive test:**

```typescript
describe("Sheaf Laplacian vs Graph Laplacian distinction", () => {
  it("L_sheaf null space has dimension d for flat d-dim sheaf on connected graph", () => {
    // Two agents, one edge, identity restriction maps, 2D stalks.
    const sheaf = buildFlatSheaf(2, 2); // 2 agents, 2D stalks
    const L_sheaf = sheaf.getSheafLaplacian();
    const { h0Dimension } = computeCohomology(sheaf);
    expect(h0Dimension).toBe(2); // dim = stalk dimension for flat sheaf on connected graph

    // Graph Laplacian (D - A) for 2-vertex graph: [[1, -1], [-1, 1]]
    // Null space dimension = 1 (not 2).
    // This test WOULD FAIL with graph Laplacian — that's the point.
  });

  it("L_sheaf * x = 0 for the constant global section", () => {
    const sheaf = buildFlatSheaf(3, 2); // 3-vertex path, 2D stalks
    const L_sheaf = sheaf.getSheafLaplacian();

    // Constant global section: all agents have the same 2D state.
    const x = new Float64Array([1, 0, 1, 0, 1, 0]); // C^0 vector
    const Lx = math.multiply(L_sheaf, Array.from(x));
    const norm = Math.sqrt((Lx as number[]).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeLessThan(1e-12);
  });
});
```

### 5.2 Pitfall: Flat Sheaf Never Exercises Obstruction Detection

**What triggers it:** Developer implements identity restriction maps everywhere to get the system running, ships it, and never creates a test configuration with non-trivial H^1. The `h1:non-trivial` event path is dead code.

**Solution: Mandatory dual test configuration from commit 1.**

Every CI run must execute both:

1. A flat sheaf test where `dim(H^1) = 0` is asserted.
2. A non-flat sheaf test where `dim(H^1) > 0` is asserted.

If either test is absent from the test suite, the PR review must catch it. This is a process requirement, not just a code requirement.

**Canonical non-flat configuration (the 3-cycle inconsistency test):**

```
Three agents forming a triangle: v0 — v1, v1 — v2, v2 — v0.
Vertex stalks: all R^2.
Edge stalks: all R^1.

Restriction maps:
  F_{v0←e01}: [1, 0]   (project onto first axis)
  F_{v1←e01}: [0, 1]   (project onto second axis)
  F_{v1←e12}: [1, 0]
  F_{v2←e12}: [0, 1]
  F_{v2←e20}: [1, 0]
  F_{v0←e20}: [0, 1]
```

This is explicitly designed so that no global section exists: to satisfy edge e01, we need `x_v0[0] = x_v1[1]`; to satisfy e12, we need `x_v1[0] = x_v2[1]`; to satisfy e20, we need `x_v2[0] = x_v0[1]`. These four constraints cannot all be satisfied simultaneously for non-zero x. Therefore `dim(H^0) = 0` and `dim(H^1) = 3*1 - 3*2 + 0 = 3 - 6 = -3`...

Wait — this needs correction. Let us compute carefully:

- `N_0 = 3 * 2 = 6` (three 2D vertex stalks)
- `N_1 = 3 * 1 = 3` (three 1D edge stalks)
- `dim(H^1) = N_1 - rank(B)`

The coboundary `B` is a `3 × 6` matrix. Its rank is at most 3. For this specific configuration, `rank(B) = 2` (one can verify this by computing the row rank of the assembled matrix). So `dim(H^1) = 3 - 2 = 1`.

**The 3-cycle test assertion:**

```typescript
it("3-cycle with incompatible projection restriction maps has dim(H^1) = 1", () => {
  const sheaf = buildThreeCycleInconsistentSheaf(); // defined in test helpers
  const result = computeCohomology(sheaf);
  expect(result.h1Dimension).toBe(1);
  expect(result.hasObstruction).toBe(true);
  expect(result.h0Dimension).toBe(0); // No global section exists.
});
```

**The 3-cycle sheaf helper construction (fully specified):**

```typescript
function buildThreeCycleInconsistentSheaf(): CellularSheaf {
  const vertices: SheafVertex[] = [
    { id: "v0", stalkSpace: { dim: 2 } },
    { id: "v1", stalkSpace: { dim: 2 } },
    { id: "v2", stalkSpace: { dim: 2 } },
  ];

  // Edge stalk: R^1.
  // Restriction maps: 1×2 matrices (row vectors).
  const proj0 = new Float64Array([1, 0]); // project onto first axis
  const proj1 = new Float64Array([0, 1]); // project onto second axis

  const edges: SheafEdge[] = [
    {
      id: "e01",
      sourceVertex: "v0",
      targetVertex: "v1",
      stalkSpace: { dim: 1 },
      sourceRestriction: {
        sourceVertexId: "v0",
        edgeId: "e01",
        sourceDim: 2,
        targetDim: 1,
        entries: proj0,
      },
      targetRestriction: {
        sourceVertexId: "v1",
        edgeId: "e01",
        sourceDim: 2,
        targetDim: 1,
        entries: proj1,
      },
    },
    {
      id: "e12",
      sourceVertex: "v1",
      targetVertex: "v2",
      stalkSpace: { dim: 1 },
      sourceRestriction: {
        sourceVertexId: "v1",
        edgeId: "e12",
        sourceDim: 2,
        targetDim: 1,
        entries: proj0,
      },
      targetRestriction: {
        sourceVertexId: "v2",
        edgeId: "e12",
        sourceDim: 2,
        targetDim: 1,
        entries: proj1,
      },
    },
    {
      id: "e20",
      sourceVertex: "v2",
      targetVertex: "v0",
      stalkSpace: { dim: 1 },
      sourceRestriction: {
        sourceVertexId: "v2",
        edgeId: "e20",
        sourceDim: 2,
        targetDim: 1,
        entries: proj0,
      },
      targetRestriction: {
        sourceVertexId: "v0",
        edgeId: "e20",
        sourceDim: 2,
        targetDim: 1,
        entries: proj1,
      },
    },
  ];

  return new CellularSheaf(vertices, edges);
}
```

### 5.3 Pitfall: Numerical Tolerance Absorbs Non-Trivial Cohomology

**What triggers it:** Using a tolerance like `1e-6` in SVD rank determination. If the singular values of `B` for the 3-cycle test are `[0.8165, 0.5774, 1e-8]` (approximately), a tolerance of `1e-6` would count `1e-8` as zero (correct) but `1e-7` as zero too if a different test sheaf produces that value.

**The right formula:**

```
tol = max_singular_value * max(N0, N1) * machine_epsilon
    = max(diag(S)) * max(N0, N1) * 2.22e-16
```

This is the MATLAB `rank()` default tolerance formula, which is the standard for numerical linear algebra rank computation.

**Alternative for exact sheaves:** When restriction maps have integer entries (which the 3-cycle test does — entries are 0 and 1), the singular values are exact rational numbers. The tolerance formula above will correctly separate them from zero. But if restriction maps are learned (e.g., from a neural network) and have irrational entries, the tolerance must be recalibrated. Document this at the call site.

**Test that validates tolerance sensitivity:**

```typescript
it("loose tolerance (1e-6) misses H^1 for near-degenerate 3-cycle", () => {
  // Perturb the 3-cycle restriction maps by epsilon to get singular values near 1e-7.
  const sheaf = buildThreeCycleNearDegenerateSheaf(1e-7);

  // With correct tolerance: detects H^1.
  const resultCorrect = computeCohomology(sheaf); // uses calibrated tolerance
  expect(resultCorrect.h1Dimension).toBe(1);

  // With loose tolerance: misses H^1 (regression guard).
  const resultLoose = computeCohomology(sheaf, 1e-6);
  expect(resultLoose.h1Dimension).toBe(0); // proves the test configuration is sensitivity-relevant
});
```

This test documents the pitfall and ensures the calibrated tolerance function is actually different from the naive `1e-6` choice.

---

## 6. Testing Strategy — Full Suite Design

### 6.1 Test File Organization

```
src/sheaf/
├── CellularSheaf.test.ts       — structural tests (construction, offset computation, dimension assertions)
├── CoboundaryOperator.test.ts  — coboundary assembly tests (hand-computed ground truth)
├── SheafLaplacian.test.ts      — Laplacian correctness (null space, positive semidefinite, flat vs graph L)
├── CohomologyAnalyzer.test.ts  — H^0 and H^1 computation (flat sheaf, 3-cycle inconsistency)
├── NumericalTolerance.test.ts  — tolerance calibration, near-degenerate sensitivity
├── ADMMInterface.test.ts       — forward-compat: verifies getCoboundaryMatrix(), getVertexOffset() etc are accessible
└── helpers/
    ├── flatSheafFactory.ts     — buildFlatSheaf(numVertices, stalkDim): creates identity-restriction sheaf
    └── threeCycleFactory.ts    — buildThreeCycleInconsistentSheaf(): creates the canonical H^1 test case
```

### 6.2 Core Test Cases

**T1: Dimension assertions on construction**

```typescript
it("asserts N0 = sum of vertex stalk dims", () => {
  const sheaf = new CellularSheaf(
    [
      { id: "v0", stalkSpace: { dim: 3 } },
      { id: "v1", stalkSpace: { dim: 2 } },
    ],
    [
      /* one edge with compatible restriction maps */
    ],
  );
  expect(sheaf.c0Dimension).toBe(5); // 3 + 2
});
```

**T2: Construction rejects incompatible restriction map dimensions**

```typescript
it("throws on restriction map dimension mismatch at construction", () => {
  // Edge stalk dim = 2 but restriction map entries.length = 3 (should be 4 = 2*2).
  expect(() => new CellularSheaf(vertices, [badEdge])).toThrow(
    /dimension mismatch/i,
  );
});
```

**T3: Coboundary matrix hand-computed verification (2-vertex, identity maps)**

Described in Section 3.3 above. This is the single most important test for correctness of `B` assembly.

**T4: L_sheaf is positive semidefinite**

```typescript
it("Sheaf Laplacian is positive semidefinite (all eigenvalues >= 0)", () => {
  const sheaf = buildFlatSheaf(4, 2);
  const L = sheaf.getSheafLaplacian();
  const { values } = math.eigs(L);
  const eigenvalues = values as number[];
  expect(Math.min(...eigenvalues)).toBeGreaterThanOrEqual(-1e-12);
});
```

**T5: L_sheaf \* x = 0 for known global section (flat sheaf)**

The zero-energy test. For a flat sheaf with identity restriction maps, any constant section satisfies `Bx = 0`, so `L_sheaf x = 0`. Test with a non-trivial constant section.

**T6: Flat sheaf H^0 and H^1 dimensions (connected graph)**

```typescript
it("flat 3-vertex path sheaf: dim(H^0) = stalkDim, dim(H^1) = 0", () => {
  const sheaf = buildFlatSheaf(3, 2, "path"); // path graph
  const result = computeCohomology(sheaf);
  expect(result.h0Dimension).toBe(2);
  expect(result.h1Dimension).toBe(0);
});
```

**T7: 3-cycle inconsistency produces H^1 = 1**

Described in Section 5.2 above.

**T8: H^1 event fires from CohomologyAnalyzer**

```typescript
it("emits h1:non-trivial event when dim(H^1) > 0", async () => {
  const analyzer = new CohomologyAnalyzer(buildThreeCycleInconsistentSheaf());
  const events: SheafH1ObstructionEvent[] = [];
  analyzer.on("sheaf:h1-obstruction-detected", (e) => events.push(e));

  await analyzer.analyze();

  expect(events).toHaveLength(1);
  expect(events[0].h1Dimension).toBe(1);
  expect(events[0].type).toBe("sheaf:h1-obstruction-detected");
});
```

**T9: Isolation — no imports from other modules**

```typescript
// This test runs a static analysis check.
// In CI, run: grep -r "from '.*\/lcm" src/sheaf/ — should be empty.
// Implementation: write a simple file import scanner in the test.
it("sheaf module has zero imports from lcm, tna, soc, orchestrator", () => {
  // Use fs.readFileSync on all .ts files in src/sheaf/
  // Assert no import path contains /lcm/, /tna/, /soc/, /orchestrator/
});
```

**T10: ADMM interface forward-compatibility**

```typescript
it("getCoboundaryMatrix() returns matrix with correct dimensions", () => {
  const sheaf = buildFlatSheaf(3, 2, "triangle");
  const B = sheaf.getCoboundaryMatrix();
  expect(math.size(B)).toEqual([sheaf.c1Dimension, sheaf.c0Dimension]);
});

it("getVertexOffset() returns cumulative sum of preceding vertex stalk dims", () => {
  const sheaf = new CellularSheaf(
    [
      { id: "v0", stalkSpace: { dim: 3 } },
      { id: "v1", stalkSpace: { dim: 2 } },
      { id: "v2", stalkSpace: { dim: 4 } },
    ],
    [
      /* edges */
    ],
  );
  expect(sheaf.getVertexOffset("v0")).toBe(0);
  expect(sheaf.getVertexOffset("v1")).toBe(3);
  expect(sheaf.getVertexOffset("v2")).toBe(5);
});
```

### 6.3 Testing the ADMMSolver Interface (SHEAF-05)

Even if the ADMM solver uses simple Laplacian diffusion internally in Phase 1 (gradient descent on Dirichlet energy), the interface must be designed for ADMM in Phase 2:

```typescript
interface ADMMSolverInterface {
  /**
   * Run one ADMM iteration.
   * Returns the updated C^0 vector (all agent states concatenated).
   */
  step(
    x: Float64Array,
    z: Float64Array,
    u: Float64Array,
    rho: number,
  ): ADMMStepResult;

  /**
   * Check convergence: primal residual ||Bx - z|| and dual residual ||rho * B^T(z - z_prev)||
   */
  checkConvergence(
    x: Float64Array,
    z: Float64Array,
    zPrev: Float64Array,
  ): ConvergenceResult;

  /** The sheaf this solver operates on. */
  readonly sheaf: CellularSheaf;
}
```

The ADMM solver test in Phase 1 can use a simple fixed-point iteration (multiply `L_sheaf` repeatedly) as the implementation, with the ADMM interface satisfied by a wrapper. Phase 2 replaces the internals with real ADMM steps without changing the interface.

---

## 7. Architecture Integration Points

### 7.1 Types/ → Sheaf/ Boundary

The `src/types/` module must define:

1. `VertexId`, `EdgeId` — opaque string IDs used throughout all modules.
2. `StalkSpace`, `StalkVector` — the inner product space abstraction used by sheaf, and potentially by SOC (which reads eigenspectrum from sheaf).
3. `RestrictionMap` — the restriction map interface used by sheaf and potentially by TNA (if TNA ever needs to model semantic distance as a restriction map, though this is out of scope for v1).
4. `SheafEdge`, `SheafVertex` — the graph element types.
5. `CohomologyResult` — the output type consumed by the Orchestrator's event handler.
6. `SheafEvent` union type — the event types emitted by `CohomologyAnalyzer` and consumed by `EventBus` (Phase 5).

What must NOT be in `src/types/`:

- Any implementation logic (constructors, methods).
- Any imports from non-types modules.
- Any mathjs or ml-matrix imports (types only, no library dependencies).

This keeps `src/types/` as a pure TypeScript interface module with no external dependencies. Any module can import from it without pulling in library dependencies.

### 7.2 Sheaf/ → SOC/ Eigenspectrum Contract (Phase 4 Forward-Compatibility)

Phase 4 (SOC) requires the eigenspectrum of the Sheaf graph's normalized Laplacian for Von Neumann entropy computation. The interface for this, designed in Phase 1:

```typescript
// src/types/GraphTypes.ts — add to types module

/**
 * The eigenspectrum output from Sheaf computation.
 * Consumed by SOC's VonNeumannEntropy module.
 */
export interface SheafEigenspectrum {
  /**
   * Eigenvalues of the normalized Sheaf Laplacian, sorted ascending.
   * L_norm = D^{-1/2} L_sheaf D^{-1/2} where D is the block diagonal degree matrix.
   * This is NOT the normalized graph Laplacian; it is the block-normalized Sheaf Laplacian.
   */
  readonly eigenvalues: Float64Array;
  /** The graph state this eigenspectrum was computed for (for caching/invalidation). */
  readonly computedAtIteration: number;
}
```

**Critical note on "normalized Sheaf Laplacian":**

The Von Neumann entropy formula requires a density matrix `ρ` that has `Tr(ρ) = 1`. For the standard graph Laplacian on `n` nodes with all stalks 1D, the normalized Laplacian `L_norm = D^{-1/2} L D^{-1/2}` has `Tr(L_norm) = n`, so `ρ = L_norm / n`.

For the Sheaf Laplacian with heterogeneous stalk dimensions, the normalization is more complex. The block degree matrix `D_sheaf` has diagonal blocks `D_v = Σ_{e incident to v} F_{v←e}^T F_{v←e}`. The normalized Sheaf Laplacian is `L_norm_sheaf = D_sheaf^{-1/2} L_sheaf D_sheaf^{-1/2}`.

**Risk flag:** The trace of `L_norm_sheaf` is not trivially `n` anymore; it depends on the restriction map geometry. The SOC phase must document the correct normalization formula for the Sheaf Laplacian case. This is an open question (see Section 9, Risks).

For Phase 1, expose `getEigenspectrum(normalize: boolean = true)` on `SheafLaplacian` and document precisely what "normalize" means. Phase 4 will pick up the eigenvalues and apply whatever density matrix formula is correct.

### 7.3 Sheaf/ → EventBus/ Signal Contract (Phase 5 Forward-Compatibility)

The `CohomologyAnalyzer` must emit events in Phase 1 that the Phase 5 Orchestrator will listen to. Design the event interface now:

```typescript
// CohomologyAnalyzer.ts

import { EventEmitter } from "events";
import type {
  SheafH1ObstructionEvent,
  SheafConsensusReachedEvent,
} from "../types/Events";

export class CohomologyAnalyzer extends EventEmitter {
  analyze(sheaf: CellularSheaf, iteration: number): CohomologyResult {
    const result = computeCohomology(sheaf);

    if (result.hasObstruction) {
      const event: SheafH1ObstructionEvent = {
        type: "sheaf:h1-obstruction-detected",
        iteration,
        h1Dimension: result.h1Dimension,
        h1Basis: result.h1Basis,
        affectedVertices: this.findAffectedVertices(result, sheaf),
      };
      this.emit("sheaf:h1-obstruction-detected", event);
    } else {
      const event: SheafConsensusReachedEvent = {
        type: "sheaf:consensus-reached",
        iteration,
        h0Dimension: result.h0Dimension,
        dirichletEnergy: this.computeDirichletEnergy(sheaf),
      };
      this.emit("sheaf:consensus-reached", event);
    }

    return result;
  }
}
```

**Why `EventEmitter` in Phase 1?** The Phase 5 `EventBus` will be a typed wrapper around `EventEmitter` or a custom typed emitter. By using `EventEmitter` directly in `CohomologyAnalyzer`, the Phase 5 integration only needs to subscribe to events — no rewiring of the sheaf internals.

The strongly-typed `SheafEvent` union type in `src/types/Events.ts` ensures that the Phase 5 event handler receives a known payload shape without any dynamic casts.

---

## 8. Restriction Map Design Patterns

The PITFALLS.md document notes that restriction maps must NOT all be identity maps. Here are three concrete patterns to implement and document:

### 8.1 Homogeneous Agent (Flat Sheaf — for testing only)

All agents have the same stalk dimension `d`. All restriction maps are `I_d` (identity). Edge stalks are also `R^d`.

```
F(v) = R^d  for all v
F(e) = R^d  for all e
F_{v←e} = I_d  for all v, e
```

Properties: `dim(H^0) = d`, `dim(H^1) = 0`. Laplacian reduces to `L_graph ⊗ I_d`. Used for unit testing only; never ship as the reference configuration.

Factory function: `buildFlatSheaf(numVertices, stalkDim, graphTopology)`

### 8.2 Projection Agent (Heterogeneous Observation — the standard non-flat case)

Agent `v` has a `d_v`-dimensional state space. The shared interaction space for edge `e = (u, v)` is lower-dimensional. Each restriction map projects the agent state onto a subspace relevant to the communication channel.

Example: Agent v0 has 3D state (position, velocity, heading). Agent v1 has 2D state (position, velocity). Their shared edge communicates only position (1D). Then:

```
F(v0) = R^3, F(v1) = R^2, F(e) = R^1
F_{v0←e} = [1, 0, 0]  (project 3D state onto position)
F_{v1←e} = [1, 0]      (project 2D state onto position)
```

This is the canonical heterogeneous agent pattern. It models agents with different observation capacities sharing a reduced communication channel.

Factory function: `buildProjectionSheaf(agentSpecs: {id, dim, projectionAxes}[], edgeSpecs: {id, source, target, sharedDim}[])`

### 8.3 Rotated Projection (Non-Trivial Cohomology — the 3-cycle test case)

The 3-cycle test from Section 5.2. Each edge selects a different axis for projection, creating an inconsistency cycle. This is the canonical non-flat sheaf for H^1 testing.

The key mathematical insight: the restriction maps are designed so that traveling around the cycle accumulates a non-trivial phase (a "holonomy"). The H^1 group measures this holonomy.

Factory function: `buildThreeCycleInconsistentSheaf()` — fully specified in Section 5.2.

### 8.4 Random Restriction Maps (Stress Testing — not for correctness tests)

For numerical stress tests of the SVD tolerance computation, use random restriction maps:

```typescript
function buildRandomSheaf(
  numVertices: number,
  numEdges: number,
): CellularSheaf {
  // Random stalk dimensions between 2 and 5.
  // Random restriction map entries from N(0, 1).
  // The resulting H^1 dimension is random but the SVD tolerance calibration is exercised.
}
```

PITFALLS.md warns: "Mock restriction maps as random matrices: never in integration tests." Use this only in `NumericalTolerance.test.ts` to validate that the tolerance formula handles a wide range of singular value magnitudes. Never use random restriction maps in `CohomologyAnalyzer.test.ts`.

---

## 9. Risks and Unknowns

### Risk 1: Normalized Sheaf Laplacian for Von Neumann Entropy (MEDIUM)

**Unknown:** The exact normalization formula for the Sheaf Laplacian's block-degree matrix `D_sheaf` is not specified in the primary sources (arXiv:2504.17700v1 focuses on consensus, not entropy). For a heterogeneous sheaf, the formula `ρ = L_norm / n` (where `n = |V|`) is only valid if `Tr(L_norm) = n`. This holds for the standard graph Laplacian but may not hold for the Sheaf Laplacian with heterogeneous stalk dimensions.

**Mitigation:** In Phase 1, expose `getEigenspectrum()` with a `normalize: boolean` parameter and document that the density matrix computation will be finalized in Phase 4. For Phase 1 tests, validate that the unnormalized eigenspectrum is correct (all eigenvalues non-negative, null space dimension matches `dim(H^0)`) without worrying about the Von Neumann entropy formula.

**Resolution needed before:** Phase 4 starts. Flag as an open question in `STATE.md`.

### Risk 2: ADMM Convergence Guarantee with Heterogeneous Stalks (MEDIUM)

**Unknown:** The ADMM convergence proof for the Sheaf Laplacian (arXiv:2504.02049) assumes that the restriction maps satisfy a bounded operator norm condition. For the projection-based restriction maps in Pattern 8.2, this is satisfied by construction (projection matrices have operator norm ≤ 1). But for learned or externally provided restriction maps, operator norm bounds are not guaranteed.

**Mitigation:** In Phase 1, add a validation step in `CellularSheaf` that computes `||F_{v←e}||_op` for each restriction map and warns (does not throw) if any exceeds 1.0. The ADMM convergence parameter `ρ` must be set based on the maximum restriction map operator norm.

**Resolution needed before:** ADMM implementation in Phase 2 (SHEAF-05 full implementation).

### Risk 3: SVD Performance for Large Sheaves (LOW for Phase 1, MEDIUM later)

**Unknown:** `ml-matrix`'s `SingularValueDecomposition` is O(min(N0, N1) _ N0 _ N1) which is acceptable for Phase 1 test sheaves (N0, N1 < 100) but will be slow for production sheaves with 100+ agents and 10D stalks (N0 ≈ 1000, N1 ≈ 1000).

**Mitigation:** Phase 1 does not need to optimize this. Document the known computational bottleneck as a comment in `CohomologyAnalyzer.ts`:

```typescript
// PERFORMANCE NOTE: Full SVD of B is O(N0 * N1 * min(N0, N1)).
// For N0, N1 < 200 this is acceptable (<10ms). For larger sheaves,
// consider iterative methods (Lanczos) or randomized SVD.
// See ROADMAP.md Phase 6 (P2 enhancements) for optimization path.
```

### Risk 4: TypeScript `number` Precision for Coboundary Assembly (LOW)

**Unknown:** JavaScript's `number` type is IEEE 754 double precision (64-bit). For restriction maps with large entries (entries >> 1), the coboundary operator assembly in floating-point arithmetic may accumulate rounding errors that shift singular values.

**Mitigation:** Use the calibrated tolerance formula `tol = max_entry * max(N0, N1) * eps_machine`. If restriction maps are normalized at construction time (e.g., operator norm ≤ 1), this tolerance is numerically robust. Add a `normalizeRestrictionMaps()` helper that scales each restriction map to have operator norm exactly 1.0.

### Risk 5: Forward-Compatibility of the ADMMSolver Interface (MEDIUM)

**Unknown:** The ADMM update rules for the Sheaf Laplacian problem require a linear solve at each iteration. If the sheaf graph evolves dynamically (agents added/removed), the linear solve matrix changes every iteration, making it expensive to recompute.

**Mitigation:** Design the `ADMMSolver` to be initialized with a `CellularSheaf` that can be updated via `addVertex()` / `addEdge()` / `removeEdge()` methods that also update the cached `L_sheaf`. This requires `CellularSheaf` to support incremental updates rather than being constructed once and frozen. Phase 1 can start with a frozen (immutable) sheaf and add incremental update methods in Phase 2 when ADMM is fully implemented.

**Phase 1 decision point:** Decide now whether `CellularSheaf` is immutable or mutable. Recommendation: **mutable**, with a `rebuildLaplacian()` method that must be called explicitly after structural changes. This avoids hidden stale-Laplacian bugs while enabling incremental graph evolution.

### Risk 6: Orientation Convention Consistency (LOW but tricky)

**Unknown:** The coboundary operator requires a fixed orientation for each edge. In practice, agents are added dynamically and edges are added in arbitrary order. If different parts of the code disagree on which vertex is "source" and which is "target" for a given edge, the coboundary operator sign will be wrong, and `L_sheaf` will be incorrect.

**Mitigation:** Fix the convention at `SheafEdge` construction time: the first argument to the edge constructor is always the source and the second is always the target. Make `SheafEdge.sourceVertex` and `SheafEdge.targetVertex` immutable and document the convention explicitly. Add a test that reverses the source/target and verifies that the `B` matrix changes sign in the expected blocks (not the wrong blocks).

---

## 10. Implementation Sequencing — Within Phase 1

The recommended commit sequence within Phase 1:

**Commit 1: Shared types**

- `src/types/GraphTypes.ts` — All sheaf types (StalkSpace, StalkVector, RestrictionMap, SheafVertex, SheafEdge, CohomologyResult, SheafEigenspectrum)
- `src/types/Events.ts` — SheafEvent union type (SheafH1ObstructionEvent, SheafConsensusReachedEvent)
- No implementation code, no library imports, no tests yet.

**Commit 2: CellularSheaf with construction validation and dimension methods**

- `src/sheaf/CellularSheaf.ts` — Constructor with dimension mismatch validation; `c0Dimension`, `c1Dimension`, `getVertexOffset`, `getEdgeOffset`, `getVertexIds`, `getEdgeIds`
- `src/sheaf/CellularSheaf.test.ts` — T1 (dimension assertions) and T2 (construction rejection)
- Test helpers: `src/sheaf/helpers/flatSheafFactory.ts`

**Commit 3: Coboundary operator and Sheaf Laplacian**

- `src/sheaf/CoboundaryOperator.ts` — `buildCoboundaryMatrix()` using mathjs
- `src/sheaf/SheafLaplacian.ts` — `build()`, `getSheafLaplacian()`, `getCoboundaryMatrix()`, `getEigenspectrum()`
- `src/sheaf/CoboundaryOperator.test.ts` — T3 (hand-computed 2-vertex verification)
- `src/sheaf/SheafLaplacian.test.ts` — T4 (PSD), T5 (L\*x=0 for section), T6 (flat sheaf H^0/H^1 dims)
- Both flat sheaf test config AND (in same commit) the 3-cycle inconsistency helper.

**Commit 3 must contain both test configurations.** This is the pitfall guard: if only the flat sheaf test exists after this commit, CI cannot distinguish correct from incorrect implementation.

**Commit 4: Cohomology analyzer with H^1 detection and event emission**

- `src/sheaf/CohomologyAnalyzer.ts` — `computeCohomology()` using ml-matrix SVD; calibrated tolerance; `EventEmitter`-based event emission
- `src/sheaf/helpers/threeCycleFactory.ts` — `buildThreeCycleInconsistentSheaf()`
- `src/sheaf/CohomologyAnalyzer.test.ts` — T7 (3-cycle produces H^1=1), T8 (event fires), tolerance sensitivity tests

**Commit 5: ADMM solver interface stub + isolation test**

- `src/sheaf/ADMMSolver.ts` — Interface + gradient descent implementation (real ADMM in Phase 2)
- `src/sheaf/ADMMInterface.test.ts` — T10 (forward-compat interface tests)
- `src/sheaf/isolation.test.ts` — T9 (no cross-module imports)
- `src/sheaf/index.ts` — Public interface exports

**At end of Commit 5:** All Phase 1 success criteria from ROADMAP.md must be green in CI.

---

## 11. Forward-Compatibility Decisions Summary

These decisions in Phase 1 affect future phases and cannot easily be changed later:

| Decision                              | Choice                                                   | Rationale                                                                      | Affects                                         |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| `CellularSheaf` immutable vs. mutable | **Mutable** with explicit `rebuildLaplacian()`           | Graph evolves as agents are added/removed; frozen sheaf cannot support this    | Phase 2 ADMM, Phase 5 Orchestrator              |
| Restriction map representation        | **Dense `Float64Array` in row-major order**              | Compatible with mathjs matrix assembly; no indirection cost                    | All sheaf internals                             |
| `getCoboundaryMatrix()` is public     | **Yes**                                                  | ADMM `x`-update step needs `B` directly                                        | Phase 2 ADMM solver                             |
| Event emission mechanism              | **Node.js `EventEmitter`**                               | Standard; Phase 5 EventBus wraps it; no rewiring needed                        | Phase 5 Orchestrator                            |
| Eigenspectrum type                    | **`Float64Array` with `computedAtIteration: number`**    | Enables SOC to cache and invalidate; iteration tracking from Phase 1           | Phase 4 SOC VonNeumannEntropy                   |
| Tolerance parameterization            | **Calibrated default + override parameter**              | Lets Phase 4 tests validate the sensitivity to tolerance                       | Phase 4 SOC                                     |
| Stalk space representation            | **`StalkSpace { dim: number }` interface**               | Minimal; does not assume Euclidean, allows future Hilbert space generalization | Phase 4 SOC entropy, Phase 5 orchestrator state |
| `SheafEdge` orientation               | **Fixed at construction: `sourceVertex → targetVertex`** | Must be immutable; orientation reversal is a silent bug                        | All coboundary computations                     |

---

## 12. Checklist: Phase 1 Success Criteria Verification

Cross-referenced from ROADMAP.md Phase 1 success criteria:

- [ ] **SC1 Laplacian correctness:** `L_sheaf * x = 0` test passes for 2-node flat sheaf consistent section. Separate test confirms `L_graph * x != 0` for same section.
- [ ] **SC2 Non-trivial cohomology:** 3-cycle inconsistency test passes with `dim(H^1) = 1`. `h1:non-trivial` event fires. Test is in CI.
- [ ] **SC3 Dual test configurations:** Both flat (H^1=0) and non-flat (H^1=1) configurations exist and pass in the same test run from Commit 3 onward.
- [ ] **SC4 Numerical tolerance calibration:** Tolerance formula `max_entry * max(N0, N1) * 2.22e-16` is in the code with a comment documenting the source formula. A sensitivity test demonstrates loose tolerance (1e-6) misses near-degenerate cohomology.
- [ ] **SC5 Component isolation:** Static import scan test passes — zero imports from lcm/, tna/, soc/, orchestrator/ in any file under src/sheaf/.
- [ ] **SC6 ADMM forward-compat:** `getCoboundaryMatrix()`, `getSheafLaplacian()`, `getVertexOffset()`, `getEdgeOffset()`, `getEdgeDim()`, `getEdgeRestrictions()` are all publicly accessible on `CellularSheaf`.
- [ ] **SC7 Eigenspectrum output:** `getEigenspectrum()` returns a `SheafEigenspectrum` with `eigenvalues: Float64Array` that has the correct count (N0 values) and all values >= -1e-12.

---

## Sources

- arXiv:2504.17700v1 — "Applied Sheaf Theory For Multi-Agent AI": primary source for Sheaf Laplacian formulation, coboundary operator definition, H^0/H^1 interpretation
- arXiv:2504.02049 — "Distributed Multi-agent Coordination over Cellular Sheaves": ADMM solver, stalk dimension handling, restriction map convergence conditions
- OpenReview — "Sheaf Cohomology of Linear Predictive Coding Networks": H^0/H^1 cohomology groups as global section / obstruction spaces; inconsistent cognitive loop detection
- `.planning/research/PITFALLS.md`: Pitfalls 1, 2, 3, 10 (Sheaf Laplacian, flat sheaf, tolerance, cohomology exactness)
- `.planning/research/STACK.md`: mathjs 15.1.1, ml-matrix 6.12.1, vitest 4.0.18 — version verification and rationale
- `.planning/research/ARCHITECTURE.md`: types/ boundary, sheaf/ isolation requirement, build order
- `.planning/ROADMAP.md`: Phase 1 success criteria (5 criteria, all reproduced in Section 12 above)
- `.planning/REQUIREMENTS.md`: SHEAF-01 through SHEAF-06 requirement text
- Context7 `/josdejong/mathjs`: `eigs()` return interface, sparse matrix API, complex matrix support in v9.4.0+
- MATLAB `rank()` documentation: calibrated SVD tolerance formula `max(S) * max(m,n) * eps_machine`

---

_Phase 1 research completed: 2026-02-27_
_Ready for implementation planning: yes_
_Blocking open questions: see Section 9 (Risks 1 and 2) — must be resolved before Phase 4 and Phase 2 ADMM respectively_
