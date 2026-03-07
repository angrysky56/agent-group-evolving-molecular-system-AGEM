/**
 * flatSheafFactory.ts
 *
 * Test helper: builds flat sheaves (identity restriction maps) for various topologies.
 *
 * A flat sheaf has all restriction maps equal to identity matrices.
 * For trees: H^1 = 0 always.
 * For graphs with cycles: H^1 = d * (|E| - |V| + 1), where d = stalkDim.
 *
 * This factory is the FLAT half of the mandatory dual-config test.
 * The non-flat counterpart is threeCycleFactory (task w1-t7).
 */

import { CellularSheaf } from "../CellularSheaf.js";
import type {
  VertexId,
  EdgeId,
  SheafVertex,
  SheafEdge,
} from "../../types/index.js";

/**
 * Build an identity matrix of given dimension as a row-major Float64Array.
 * Entry at row r, col c = (r === c) ? 1 : 0.
 */
function identityMatrix(dim: number): Float64Array {
  const m = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    m[i * dim + i] = 1.0;
  }
  return m;
}

/**
 * Build a vertex ID string from an integer index.
 */
function vid(i: number): VertexId {
  return `v${i}` as VertexId;
}

/**
 * Build an edge ID string from source and target indices.
 */
function eid(src: number, tgt: number): EdgeId {
  return `e${src}${tgt}` as EdgeId;
}

/**
 * Build a single SheafVertex with the given index and stalk dimension.
 */
function buildVertex(i: number, stalkDim: number): SheafVertex {
  return {
    id: vid(i),
    stalkSpace: { dim: stalkDim, label: `v${i}` },
  };
}

/**
 * Build a SheafEdge with identity restriction maps.
 *
 * Both source and target restrictions are identity maps: R^stalkDim → R^stalkDim.
 */
function buildFlatEdge(
  srcIdx: number,
  tgtIdx: number,
  stalkDim: number,
): SheafEdge {
  const sourceId = vid(srcIdx);
  const targetId = vid(tgtIdx);
  const edgeId = eid(srcIdx, tgtIdx);
  const identity = identityMatrix(stalkDim);

  return {
    id: edgeId,
    sourceVertex: sourceId,
    targetVertex: targetId,
    stalkSpace: { dim: stalkDim, label: `e${srcIdx}${tgtIdx}` },
    sourceRestriction: {
      sourceVertexId: sourceId,
      edgeId: edgeId,
      sourceDim: stalkDim,
      targetDim: stalkDim,
      entries: new Float64Array(identity), // copy
    },
    targetRestriction: {
      sourceVertexId: targetId,
      edgeId: edgeId,
      sourceDim: stalkDim,
      targetDim: stalkDim,
      entries: new Float64Array(identity), // copy
    },
  };
}

/**
 * buildFlatSheaf — create a CellularSheaf with identity restriction maps.
 *
 * @param numVertices - Number of vertices (>= 2 for path/complete; exactly 3 for triangle).
 * @param stalkDim - Stalk dimension at each vertex and edge.
 * @param topology - Graph topology: 'path' (default), 'triangle', or 'complete'.
 *
 * Topologies:
 * - 'path': v0-v1-v2-...-v(n-1). Total edges = numVertices - 1.
 * - 'triangle': requires numVertices = 3. Edges: v0-v1, v1-v2, v2-v0. Total edges = 3.
 * - 'complete': all pairs (i, j) with i < j. Total edges = n*(n-1)/2.
 */
export function buildFlatSheaf(
  numVertices: number,
  stalkDim: number,
  topology: "path" | "triangle" | "complete" = "path",
): CellularSheaf {
  if (numVertices < 1) {
    throw new Error("buildFlatSheaf: numVertices must be >= 1");
  }
  if (stalkDim < 1) {
    throw new Error("buildFlatSheaf: stalkDim must be >= 1");
  }

  // Build vertices.
  const vertices: SheafVertex[] = [];
  for (let i = 0; i < numVertices; i++) {
    vertices.push(buildVertex(i, stalkDim));
  }

  // Build edges based on topology.
  const edges: SheafEdge[] = [];

  switch (topology) {
    case "path": {
      for (let i = 0; i < numVertices - 1; i++) {
        edges.push(buildFlatEdge(i, i + 1, stalkDim));
      }
      break;
    }

    case "triangle": {
      if (numVertices !== 3) {
        throw new Error(
          `buildFlatSheaf: 'triangle' topology requires numVertices = 3, got ${numVertices}`,
        );
      }
      edges.push(buildFlatEdge(0, 1, stalkDim));
      edges.push(buildFlatEdge(1, 2, stalkDim));
      edges.push(buildFlatEdge(2, 0, stalkDim));
      break;
    }

    case "complete": {
      for (let i = 0; i < numVertices; i++) {
        for (let j = i + 1; j < numVertices; j++) {
          edges.push(buildFlatEdge(i, j, stalkDim));
        }
      }
      break;
    }
  }

  return new CellularSheaf(vertices, edges);
}
