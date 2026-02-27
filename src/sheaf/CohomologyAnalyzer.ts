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

import { EventEmitter } from 'events';
import { Matrix as MlMatrix, SingularValueDecomposition } from 'ml-matrix';
import type { CohomologyResult, VertexId } from '../types/index.js';
import type {
  SheafH1ObstructionEvent,
  SheafConsensusReachedEvent,
} from '../types/index.js';
import { CellularSheaf } from './CellularSheaf.js';

// ---------------------------------------------------------------------------
// computeCohomology — standalone function (mathematical core)
// ---------------------------------------------------------------------------

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
export function computeCohomology(
  sheaf: CellularSheaf,
  tolerance?: number
): CohomologyResult {
  // Full SVD of B is O(N_0 * N_1 * min(N_0, N_1)).
  // For N_0, N_1 < 200 this is acceptable (<10ms). For larger sheaves,
  // consider iterative methods (Lanczos) or randomized SVD.
  // See ROADMAP.md Phase 6 (P2 enhancements) for optimization path.

  const N0 = sheaf.c0Dimension;
  const N1 = sheaf.c1Dimension;

  // Step 1-3: Get B and convert to ml-matrix.
  const B = sheaf.getCoboundaryMatrix();
  const bArray = B.toArray() as number[][];
  const mlB = new MlMatrix(bArray);

  // Step 4: Compute SVD with autoTranspose=true to handle non-square B correctly.
  // autoTranspose: if N1 < N0, the SVD transposes internally and transposes the result back,
  // so we always get U (N1 x N1), S (diagonal), V (N0 x N0) in consistent orientation.
  const svd = new SingularValueDecomposition(mlB, { autoTranspose: true });

  // Step 5: Extract singular values (sorted descending by convention).
  const singularValues: number[] = svd.diagonal;

  // Step 6: Compute tolerance.
  // Tolerance formula: max(singular_values) * max(N0, N1) * Number.EPSILON
  // Source: MATLAB rank() default. See 01-RESEARCH.md Section 5.3.
  // For sheaves with integer restriction map entries (common in tests),
  // this tolerance correctly separates structural zero singular values
  // from numerical noise. For learned restriction maps with irrational
  // entries, recalibration may be necessary -- pass explicit tolerance.
  const maxSingularValue = singularValues.length > 0 ? singularValues[0] : 0;
  const calibratedTol = maxSingularValue * Math.max(N0, N1) * Number.EPSILON;
  const tol = tolerance !== undefined ? tolerance : calibratedTol;

  // Step 7: Compute rank.
  const rank = singularValues.filter((s) => s > tol).length;

  // Step 8-9: Compute cohomology dimensions.
  const h0Dimension = N0 - rank;
  const h1Dimension = N1 - rank;

  // Step 10: Extract H^0 basis (right singular vectors for zero singular values).
  // V is N0 x N0 (or N0 x min(N0,N1) in some implementations).
  // Columns [rank, N0) correspond to ker(B).
  const V = svd.rightSingularVectors;
  // (H^0 basis not returned in CohomologyResult type, but computed for completeness)

  // Step 11: Extract H^1 basis (left singular vectors for zero singular values).
  // U is N1 x N1 (or N1 x min(N0,N1)).
  // Columns [rank, min(N1, U.columns)) correspond to coker(B) representatives.
  const U = svd.leftSingularVectors;
  const h1Basis: Float64Array[] = [];
  const maxH1Col = Math.min(N1, U.columns);
  for (let col = rank; col < maxH1Col; col++) {
    const basisVector = new Float64Array(U.rows);
    for (let row = 0; row < U.rows; row++) {
      basisVector[row] = U.get(row, col);
    }
    h1Basis.push(basisVector);
  }

  return {
    h0Dimension,
    h1Dimension,
    hasObstruction: h1Dimension > 0,
    h1Basis: h1Basis as readonly Float64Array[],
    tolerance: tol,
    coboundaryRank: rank,
  };
}

// ---------------------------------------------------------------------------
// CohomologyAnalyzer — class with EventEmitter-based event emission
// ---------------------------------------------------------------------------

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
export class CohomologyAnalyzer extends EventEmitter {
  /**
   * analyze — compute cohomology and emit the appropriate event.
   *
   * @param sheaf - The CellularSheaf to analyze.
   * @param iteration - Current consensus iteration (for event payload; defaults to 0).
   * @returns CohomologyResult (same as computeCohomology).
   */
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

  /**
   * findAffectedVertices — identify vertices involved in the H^1 obstruction.
   *
   * For Phase 1: returns all vertex IDs.
   * Phase 5 can refine this to identify the specific obstruction cycle
   * by projecting the H^1 basis vectors onto the per-vertex stalk blocks.
   */
  private findAffectedVertices(
    _result: CohomologyResult,
    sheaf: CellularSheaf
  ): VertexId[] {
    // For Phase 1: return all vertex IDs.
    // Phase 5 can refine this to identify the specific obstruction cycle.
    return sheaf.getVertexIds();
  }
}
