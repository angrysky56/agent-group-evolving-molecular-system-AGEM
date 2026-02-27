/**
 * threeCycleFactory.ts
 *
 * Test helper: builds the canonical non-flat sheaf for H^1 testing.
 *
 * This is the exact three-cycle inconsistency configuration from the research
 * (01-RESEARCH.md Section 5.2). It is designed so that traveling around the
 * triangle accumulates non-trivial holonomy — each edge projects onto a DIFFERENT
 * axis of R^2, making it impossible for all three consistency conditions to be
 * satisfied simultaneously.
 *
 * Mathematical properties:
 *   N_0 = 6 (total vertex stalk dims: 3 vertices × R^2)
 *   N_1 = 3 (total edge stalk dims: 3 edges × R^1)
 *   rank(B) = 2 (coboundary operator rank, verified in Wave 2)
 *   dim(H^1) = N_1 - rank(B) = 3 - 2 = 1
 *   hasObstruction = true
 *
 * This factory is the NON-FLAT half of the mandatory dual-config test.
 * The flat counterpart is flatSheafFactory (task w1-t6).
 */

import { CellularSheaf } from '../CellularSheaf.js';
import type { VertexId, EdgeId, SheafVertex, SheafEdge } from '../../types/index.js';

/**
 * buildThreeCycleInconsistentSheaf — canonical H^1 test configuration.
 *
 * Graph: triangle with vertices v0, v1, v2 and edges e01, e12, e20.
 *
 * Vertex stalks: all R^2 (dim = 2).
 * Edge stalks: all R^1 (dim = 1).
 *
 * Restriction maps (1×2 row vectors stored as Float64Array of length 2):
 *   e01: F_{v0←e01} = [1, 0]   (project onto first axis)
 *        F_{v1←e01} = [0, 1]   (project onto second axis)
 *   e12: F_{v1←e12} = [1, 0]   (project onto first axis)
 *        F_{v2←e12} = [0, 1]   (project onto second axis)
 *   e20: F_{v2←e20} = [1, 0]   (project onto first axis)
 *        F_{v0←e20} = [0, 1]   (project onto second axis)
 *
 * The holonomy around the triangle is non-trivial: composing the three
 * projection/inclusion maps gives a non-identity automorphism of R^1,
 * which is the source of the H^1 obstruction.
 */
export function buildThreeCycleInconsistentSheaf(): CellularSheaf {
  // Vertex IDs.
  const v0 = 'v0' as VertexId;
  const v1 = 'v1' as VertexId;
  const v2 = 'v2' as VertexId;

  // Edge IDs.
  const e01 = 'e01' as EdgeId;
  const e12 = 'e12' as EdgeId;
  const e20 = 'e20' as EdgeId;

  // Vertices: all R^2.
  const vertices: SheafVertex[] = [
    { id: v0, stalkSpace: { dim: 2, label: 'v0' } },
    { id: v1, stalkSpace: { dim: 2, label: 'v1' } },
    { id: v2, stalkSpace: { dim: 2, label: 'v2' } },
  ];

  // Projection vectors.
  const proj1 = new Float64Array([1, 0]); // project onto first axis of R^2 → R^1
  const proj2 = new Float64Array([0, 1]); // project onto second axis of R^2 → R^1

  // Edge e01: v0 → v1, stalk R^1.
  // F_{v0←e01} = [1, 0], F_{v1←e01} = [0, 1]
  const edge01: SheafEdge = {
    id: e01,
    sourceVertex: v0,
    targetVertex: v1,
    stalkSpace: { dim: 1, label: 'e01' },
    sourceRestriction: {
      sourceVertexId: v0,
      edgeId: e01,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj1), // [1, 0]
    },
    targetRestriction: {
      sourceVertexId: v1,
      edgeId: e01,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj2), // [0, 1]
    },
  };

  // Edge e12: v1 → v2, stalk R^1.
  // F_{v1←e12} = [1, 0], F_{v2←e12} = [0, 1]
  const edge12: SheafEdge = {
    id: e12,
    sourceVertex: v1,
    targetVertex: v2,
    stalkSpace: { dim: 1, label: 'e12' },
    sourceRestriction: {
      sourceVertexId: v1,
      edgeId: e12,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj1), // [1, 0]
    },
    targetRestriction: {
      sourceVertexId: v2,
      edgeId: e12,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj2), // [0, 1]
    },
  };

  // Edge e20: v2 → v0, stalk R^1.
  // F_{v2←e20} = [1, 0], F_{v0←e20} = [0, 1]
  const edge20: SheafEdge = {
    id: e20,
    sourceVertex: v2,
    targetVertex: v0,
    stalkSpace: { dim: 1, label: 'e20' },
    sourceRestriction: {
      sourceVertexId: v2,
      edgeId: e20,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj1), // [1, 0]
    },
    targetRestriction: {
      sourceVertexId: v0,
      edgeId: e20,
      sourceDim: 2,
      targetDim: 1,
      entries: new Float64Array(proj2), // [0, 1]
    },
  };

  const edges: SheafEdge[] = [edge01, edge12, edge20];

  return new CellularSheaf(vertices, edges);
}
