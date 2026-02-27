/**
 * CoboundaryOperator.ts
 *
 * Assembles the coboundary operator B for a CellularSheaf.
 *
 * The coboundary operator delta^0 : C^0 -> C^1 maps the product of vertex stalks
 * to the product of edge stalks. It encodes the consistency conditions: a section
 * x in C^0 is a global section if and only if B * x = 0.
 *
 * Shape: B is an N_1 x N_0 matrix, where:
 *   N_0 = c0Dimension = sum of vertex stalk dims
 *   N_1 = c1Dimension = sum of edge stalk dims
 *
 * CRITICAL: This is NOT the graph incidence matrix.
 *   - Graph incidence matrix: scalar entries (+1, -1, 0), shape |E| x |V|.
 *   - Coboundary operator: matrix-valued blocks, shape N_1 x N_0.
 *   If your B has shape |E| x |V|, the implementation is WRONG.
 *
 * Orientation convention (fixed, must be consistent everywhere):
 *   - Source vertex contributes the NEGATIVE block: -F_{u<-e}
 *   - Target vertex contributes the POSITIVE block: +F_{v<-e}
 *
 * Block placement for each edge e with source u and target v:
 *   - Row offset: eRow = edgeOffset(e)
 *   - Source col: srcCol = vertexOffset(u)
 *   - Target col: tgtCol = vertexOffset(v)
 *   - B[eRow : eRow+eDim, srcCol : srcCol+srcDim] = -F_{u<-e}
 *   - B[eRow : eRow+eDim, tgtCol : tgtCol+tgtDim] = +F_{v<-e}
 */

import * as math from 'mathjs';
import { CellularSheaf } from './CellularSheaf.js';

/**
 * buildCoboundaryMatrix — assemble the coboundary operator B from a CellularSheaf.
 *
 * @param sheaf - The CellularSheaf to build B from.
 * @returns A math.Matrix of shape [N_1, N_0] (c1Dimension x c0Dimension).
 *
 * Implementation: Build a 2D array row by row, then convert to math.matrix().
 * This avoids mathjs indexing quirks and is straightforward to verify.
 */
export function buildCoboundaryMatrix(sheaf: CellularSheaf): math.Matrix {
  const N1 = sheaf.c1Dimension;
  const N0 = sheaf.c0Dimension;

  // Initialize B as a 2D array of zeros.
  // B[row][col] — N1 rows, N0 cols.
  const B: number[][] = [];
  for (let r = 0; r < N1; r++) {
    B.push(new Array<number>(N0).fill(0));
  }

  // Iterate over edges and place restriction map blocks.
  for (const edgeId of sheaf.getEdgeIds()) {
    const edge = sheaf.getEdge(edgeId);
    const eRow = sheaf.getEdgeOffset(edgeId);
    const eDim = edge.stalkSpace.dim;

    // Source vertex block: -F_{sourceVertex <- edge}
    const srcVertexId = edge.sourceVertex;
    const srcVertex = sheaf.getVertex(srcVertexId);
    const srcDim = srcVertex.stalkSpace.dim;
    const srcCol = sheaf.getVertexOffset(srcVertexId);
    const srcEntries = edge.sourceRestriction.entries; // row-major, shape eDim x srcDim

    for (let r = 0; r < eDim; r++) {
      for (let c = 0; c < srcDim; c++) {
        // entries[r * srcDim + c] = row r, col c of the restriction map matrix
        B[eRow + r][srcCol + c] = -srcEntries[r * srcDim + c];
      }
    }

    // Target vertex block: +F_{targetVertex <- edge}
    const tgtVertexId = edge.targetVertex;
    const tgtVertex = sheaf.getVertex(tgtVertexId);
    const tgtDim = tgtVertex.stalkSpace.dim;
    const tgtCol = sheaf.getVertexOffset(tgtVertexId);
    const tgtEntries = edge.targetRestriction.entries; // row-major, shape eDim x tgtDim

    for (let r = 0; r < eDim; r++) {
      for (let c = 0; c < tgtDim; c++) {
        B[eRow + r][tgtCol + c] = tgtEntries[r * tgtDim + c];
      }
    }
  }

  return math.matrix(B);
}
