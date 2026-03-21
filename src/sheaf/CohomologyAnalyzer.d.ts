/**
 * CohomologyAnalyzer.ts
 *
 * SVD-based computation of sheaf cohomology H^0 and H^1.
 *
 * Computes:
 *   H^0 = ker(B)  = global sections (consensus dimension)
 *   H^1 = C^1 / im(B)  = obstruction classes (disagreement that cannot be resolved)
 *
 * Uses SVD of the coboundary operator B (NOT eigendecomposition of L_sheaf = B^T B).
 *
 * Why SVD of B, not eigendecomposition of L_sheaf:
 *   L_sheaf = B^T B is numerically ill-conditioned at its zero eigenvalues.
 *   SVD of B directly gives:
 *     ker(B)  = right singular vectors with singular value 0  (= H^0)
 *     coker(B) = left singular vectors with singular value 0   (representatives of H^1)
 *   The rank of B is read directly from singular values above tolerance,
 *   giving dim(H^0) = N_0 - rank(B) and dim(H^1) = N_1 - rank(B).
 *
 * Library boundary:
 *   mathjs:    matrix assembly and coboundary extraction (Waves 1-2)
 *   ml-matrix: SVD computation only (Wave 3, this file)
 *   Interop:   B.toArray() converts math.Matrix -> number[][]
 *
 * Performance note (document):
 *   // Full SVD of B is O(N_0 * N_1 * min(N_0, N_1)).
 *   // For N_0, N_1 < 200 this is acceptable (<10ms). For larger sheaves,
 *   // consider iterative methods (Lanczos) or randomized SVD.
 *   // See ROADMAP.md Phase 6 (P2 enhancements) for optimization path.
 *
 * Tolerance note (document):
 *   // Tolerance formula: max(singular_values) * max(N0, N1) * Number.EPSILON
 *   // Source: MATLAB rank() default. See 01-RESEARCH.md Section 5.3.
 *   // For sheaves with integer restriction map entries (common in tests),
 *   // this tolerance correctly separates structural zero singular values
 *   // from numerical noise. For learned restriction maps with irrational
 *   // entries, recalibration may be necessary -- pass explicit tolerance.
 */
import { EventEmitter } from "events";
import type { CohomologyResult } from "../types/index.js";
import { CellularSheaf } from "./CellularSheaf.js";
/**
 * computeCohomology — compute H^0 and H^1 of a cellular sheaf via SVD of B.
 *
 * Algorithm:
 *   1. Get B = sheaf.getCoboundaryMatrix() (N_1 x N_0 coboundary operator).
 *   2. Convert to 2D array via B.toArray().
 *   3. Create ml-matrix Matrix.
 *   4. Compute SVD: B = U S V^T with autoTranspose=true.
 *   5. Extract singular values (sorted descending by SVD convention).
 *   6. Compute tolerance:
 *      - If tolerance param provided: use it.
 *      - Otherwise: tol = max(S) * max(N_0, N_1) * Number.EPSILON  [MATLAB rank() default]
 *   7. Compute rank = count(singular values > tol).
 *   8. h0Dimension = N_0 - rank  (= dim ker(B))
 *   9. h1Dimension = N_1 - rank  (= dim coker(B) = dim C^1 / im(B))
 *  10. H^0 basis: columns [rank, N_0) of V (right singular vectors for zero singular values).
 *  11. H^1 basis: columns [rank, min(N_1, U.columns)) of U (left singular vectors for zero singular values).
 *  12. Return CohomologyResult.
 *
 * @param sheaf - The CellularSheaf to analyze.
 * @param tolerance - Optional explicit tolerance. If omitted, uses calibrated formula.
 * @returns CohomologyResult with h0Dimension, h1Dimension, hasObstruction, h1Basis, tolerance, coboundaryRank.
 */
export declare function computeCohomology(sheaf: CellularSheaf, tolerance?: number): CohomologyResult;
/**
 * CohomologyAnalyzer — analyzes sheaf cohomology and emits typed events.
 *
 * Extends EventEmitter for Phase 5 forward-compatibility:
 *   - 'sheaf:h1-obstruction-detected' when H^1 > 0
 *   - 'sheaf:consensus-reached' when H^1 = 0
 *
 * The Phase 5 EventBus will subscribe to these events without requiring
 * any rewiring of sheaf internals.
 *
 * Event payload types are strongly typed via the SheafH1ObstructionEvent
 * and SheafConsensusReachedEvent interfaces in src/types/Events.ts.
 */
export declare class CohomologyAnalyzer extends EventEmitter {
    /**
     * analyze — compute cohomology and emit the appropriate event.
     *
     * @param sheaf - The CellularSheaf to analyze.
     * @param iteration - Current consensus iteration (for event payload; defaults to 0).
     * @returns CohomologyResult (same as computeCohomology).
     */
    analyze(sheaf: CellularSheaf, iteration?: number): CohomologyResult;
    /**
     * findAffectedVertices — identify vertices involved in the H^1 obstruction.
     *
     * For Phase 1: returns all vertex IDs.
     * Phase 5 can refine this to identify the specific obstruction cycle
     * by projecting the H^1 basis vectors onto the per-vertex stalk blocks.
     */
    private findAffectedVertices;
}
//# sourceMappingURL=CohomologyAnalyzer.d.ts.map