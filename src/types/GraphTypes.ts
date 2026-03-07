/**
 * GraphTypes.ts
 *
 * Shared sheaf-theoretic type definitions for the AGEM project.
 * ZERO external imports — pure TypeScript interfaces only.
 *
 * These types are the dependency root for every phase:
 *   Phase 1 (Sheaf), Phase 2 (LCM), Phase 3 (TNA), Phase 4 (SOC), Phase 5 (Orchestrator).
 */

// ---------------------------------------------------------------------------
// Opaque ID types
// ---------------------------------------------------------------------------

/**
 * VertexId — opaque string type alias for agent node IDs.
 * Use string literals or uuid strings in practice.
 */
export type VertexId = string & { readonly __brand: "VertexId" };

/**
 * EdgeId — opaque string type alias for communication channel IDs.
 */
export type EdgeId = string & { readonly __brand: "EdgeId" };

// ---------------------------------------------------------------------------
// Stalk types
// ---------------------------------------------------------------------------

/**
 * StalkSpace — the vector space assigned to a vertex or edge in the sheaf.
 * `dim` is the dimension of the local stalk (e.g., R^d).
 */
export interface StalkSpace {
  readonly dim: number;
  readonly label?: string;
}

/**
 * StalkVector — a concrete vector in a stalk space (row-major Float64Array).
 * Length must equal the `dim` of the associated StalkSpace.
 */
export type StalkVector = Float64Array;

// ---------------------------------------------------------------------------
// Restriction maps
// ---------------------------------------------------------------------------

/**
 * RestrictionMap — a linear map from a vertex stalk to an edge stalk.
 *
 * Represents F_{v←e}: F(v) → F(e) in sheaf theory notation.
 *
 * Layout: `entries` is a row-major Float64Array of length `targetDim * sourceDim`.
 *   Entry at row r, col c = entries[r * sourceDim + c].
 *
 * Invariant: entries.length === targetDim * sourceDim.
 */
export interface RestrictionMap {
  readonly sourceVertexId: VertexId;
  readonly edgeId: EdgeId;
  readonly sourceDim: number;
  readonly targetDim: number;
  readonly entries: Float64Array;
}

// ---------------------------------------------------------------------------
// Graph topology types
// ---------------------------------------------------------------------------

/**
 * SheafVertex — a node in the sheaf base graph.
 * Carries the local stalk space assignment F(v).
 */
export interface SheafVertex {
  readonly id: VertexId;
  readonly stalkSpace: StalkSpace;
}

/**
 * SheafEdge — a directed edge in the sheaf base graph.
 * Carries the edge stalk space F(e) and two restriction maps:
 *   - sourceRestriction: F(sourceVertex) → F(e)
 *   - targetRestriction: F(targetVertex) → F(e)
 */
export interface SheafEdge {
  readonly id: EdgeId;
  readonly sourceVertex: VertexId;
  readonly targetVertex: VertexId;
  readonly stalkSpace: StalkSpace;
  readonly sourceRestriction: RestrictionMap;
  readonly targetRestriction: RestrictionMap;
}

// ---------------------------------------------------------------------------
// Cohomology result
// ---------------------------------------------------------------------------

/**
 * CohomologyResult — output of the Sheaf Laplacian analysis.
 *
 * - h0Dimension: dim(ker δ^0) = number of global sections (consensus dimension).
 * - h1Dimension: dim(H^1) = dim(coker δ^0) = obstruction dimension.
 * - hasObstruction: true if h1Dimension > 0.
 * - h1Basis: basis vectors for the H^1 obstruction space (in C^1 = ⊕ F(e)).
 * - tolerance: numerical tolerance used to determine rank (documented at use site).
 * - coboundaryRank: rank(δ^0) as computed by SVD.
 */
export interface CohomologyResult {
  readonly h0Dimension: number;
  readonly h1Dimension: number;
  readonly hasObstruction: boolean;
  readonly h1Basis: readonly Float64Array[];
  readonly tolerance: number;
  readonly coboundaryRank: number;
}

// ---------------------------------------------------------------------------
// Eigenspectrum (forward-compatibility for Phase 4 SOC Von Neumann entropy)
// ---------------------------------------------------------------------------

/**
 * SheafEigenspectrum — eigenvalues of the sheaf Laplacian at a given iteration.
 * Used by Phase 4 to compute Von Neumann entropy: S = -Σ λ_i log(λ_i).
 *
 * `eigenvalues` are sorted ascending (smallest first).
 */
export interface SheafEigenspectrum {
  readonly eigenvalues: Float64Array;
  readonly computedAtIteration: number;
}
