/**
 * CellularSheaf.test.ts
 *
 * Unit tests for CellularSheaf construction validation and dimension bookkeeping.
 *
 * Tests:
 *   T1: Dimension assertions on construction (heterogeneous stalk dims)
 *   T2: Construction rejects incompatible restriction map dimensions (5 cases)
 *   T10-partial: Vertex offset cumulative sum
 *   Factory smoke tests: flatSheafFactory and threeCycleFactory
 *
 * Zero imports from src/lcm/, src/tna/, src/soc/, src/orchestrator/.
 */

import { describe, it, expect } from "vitest";
import { CellularSheaf } from "./CellularSheaf.js";
import { buildFlatSheaf } from "./helpers/flatSheafFactory.js";
import { buildThreeCycleInconsistentSheaf } from "./helpers/threeCycleFactory.js";
import type {
  VertexId,
  EdgeId,
  SheafVertex,
  SheafEdge,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Test helper: build a valid minimal sheaf with two vertices of arbitrary dims
// and one edge connecting them, with matching restriction maps.
// ---------------------------------------------------------------------------

function makeVertex(idStr: string, dim: number): SheafVertex {
  return {
    id: idStr as VertexId,
    stalkSpace: { dim, label: idStr },
  };
}

function makeEdge(
  idStr: string,
  srcId: string,
  tgtId: string,
  srcDim: number,
  tgtDim: number,
  edgeDim: number,
  srcEntries?: Float64Array,
  tgtEntries?: Float64Array,
): SheafEdge {
  const eid = idStr as EdgeId;
  const svid = srcId as VertexId;
  const tvid = tgtId as VertexId;

  // Default: correct-length zero entries.
  const defaultSrcEntries = srcEntries ?? new Float64Array(edgeDim * srcDim);
  const defaultTgtEntries = tgtEntries ?? new Float64Array(edgeDim * tgtDim);

  return {
    id: eid,
    sourceVertex: svid,
    targetVertex: tvid,
    stalkSpace: { dim: edgeDim, label: idStr },
    sourceRestriction: {
      sourceVertexId: svid,
      edgeId: eid,
      sourceDim: srcDim,
      targetDim: edgeDim,
      entries: defaultSrcEntries,
    },
    targetRestriction: {
      sourceVertexId: tvid,
      edgeId: eid,
      sourceDim: tgtDim,
      targetDim: edgeDim,
      entries: defaultTgtEntries,
    },
  };
}

// ---------------------------------------------------------------------------
// T1: Dimension assertions on construction
// ---------------------------------------------------------------------------

describe("T1: CellularSheaf dimension assertions on construction", () => {
  it("c0Dimension equals sum of vertex stalk dims (heterogeneous: 3 + 2 = 5)", () => {
    const v0 = makeVertex("v0", 3);
    const v1 = makeVertex("v1", 2);
    // Edge: v0 (dim=3) → v1 (dim=2), edge stalk dim=1.
    const e01 = makeEdge("e01", "v0", "v1", 3, 2, 1);

    const sheaf = new CellularSheaf([v0, v1], [e01]);
    expect(sheaf.c0Dimension).toBe(5); // 3 + 2
  });

  it("c1Dimension equals sum of edge stalk dims", () => {
    const v0 = makeVertex("v0", 3);
    const v1 = makeVertex("v1", 2);
    const v2 = makeVertex("v2", 4);
    // Two edges with stalk dims 1 and 2.
    const e01 = makeEdge("e01", "v0", "v1", 3, 2, 1);
    const e12 = makeEdge("e12", "v1", "v2", 2, 4, 2);

    const sheaf = new CellularSheaf([v0, v1, v2], [e01, e12]);
    expect(sheaf.c0Dimension).toBe(9); // 3 + 2 + 4
    expect(sheaf.c1Dimension).toBe(3); // 1 + 2
  });

  it("works with empty edge list (isolated vertices)", () => {
    const v0 = makeVertex("v0", 5);
    const v1 = makeVertex("v1", 3);
    const sheaf = new CellularSheaf([v0, v1], []);
    expect(sheaf.c0Dimension).toBe(8); // 5 + 3
    expect(sheaf.c1Dimension).toBe(0);
  });

  it("works with a single vertex and no edges", () => {
    const v0 = makeVertex("v0", 7);
    const sheaf = new CellularSheaf([v0], []);
    expect(sheaf.c0Dimension).toBe(7);
    expect(sheaf.c1Dimension).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T2: Construction rejects incompatible restriction map dimensions (5 cases)
// ---------------------------------------------------------------------------

describe("T2: CellularSheaf rejects incompatible restriction map dimensions", () => {
  it("T2.1: rejects when entries.length != targetDim * sourceDim", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);

    // Correct would be targetDim * sourceDim = 2 * 2 = 4. We supply 3 entries.
    const wrongEntries = new Float64Array(3); // should be 4
    const e01 = makeEdge("e01", "v0", "v1", 2, 2, 2, wrongEntries);

    expect(() => new CellularSheaf([v0, v1], [e01])).toThrow(
      /dimension mismatch/i,
    );
  });

  it("T2.2: rejects when sourceRestriction.sourceDim != vertex.stalkSpace.dim", () => {
    const v0 = makeVertex("v0", 3); // vertex dim = 3
    const v1 = makeVertex("v1", 2);

    // We build an edge where sourceRestriction claims sourceDim = 2 (wrong, should be 3).
    const eid = "e01" as EdgeId;
    const svid = "v0" as VertexId;
    const tvid = "v1" as VertexId;
    const wrongSourceDim = 2; // vertex is actually dim 3
    const edgeDim = 1;

    const badEdge: SheafEdge = {
      id: eid,
      sourceVertex: svid,
      targetVertex: tvid,
      stalkSpace: { dim: edgeDim },
      sourceRestriction: {
        sourceVertexId: svid,
        edgeId: eid,
        sourceDim: wrongSourceDim, // WRONG: vertex is dim 3
        targetDim: edgeDim,
        entries: new Float64Array(edgeDim * wrongSourceDim), // 1 * 2 = 2 entries
      },
      targetRestriction: {
        sourceVertexId: tvid,
        edgeId: eid,
        sourceDim: 2,
        targetDim: edgeDim,
        entries: new Float64Array(edgeDim * 2),
      },
    };

    expect(() => new CellularSheaf([v0, v1], [badEdge])).toThrow(
      /dimension mismatch/i,
    );
  });

  it("T2.3: rejects when sourceRestriction.targetDim != edge.stalkSpace.dim", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);

    // Edge stalk dim = 1. sourceRestriction claims targetDim = 2 (wrong).
    const eid = "e01" as EdgeId;
    const svid = "v0" as VertexId;
    const tvid = "v1" as VertexId;
    const edgeDim = 1;
    const wrongTargetDim = 2; // should be 1

    const badEdge: SheafEdge = {
      id: eid,
      sourceVertex: svid,
      targetVertex: tvid,
      stalkSpace: { dim: edgeDim }, // edge is 1-dimensional
      sourceRestriction: {
        sourceVertexId: svid,
        edgeId: eid,
        sourceDim: 2,
        targetDim: wrongTargetDim, // WRONG: edge is 1-dimensional
        entries: new Float64Array(wrongTargetDim * 2), // 2 * 2 = 4 entries
      },
      targetRestriction: {
        sourceVertexId: tvid,
        edgeId: eid,
        sourceDim: 2,
        targetDim: edgeDim,
        entries: new Float64Array(edgeDim * 2),
      },
    };

    expect(() => new CellularSheaf([v0, v1], [badEdge])).toThrow(
      /dimension mismatch/i,
    );
  });

  it("T2.4: rejects when edge references non-existent source vertex ID", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);

    // Edge references 'v99' which is not in the vertex list.
    const eid = "e01" as EdgeId;
    const badEdge: SheafEdge = {
      id: eid,
      sourceVertex: "v99" as VertexId, // non-existent
      targetVertex: "v1" as VertexId,
      stalkSpace: { dim: 1 },
      sourceRestriction: {
        sourceVertexId: "v99" as VertexId,
        edgeId: eid,
        sourceDim: 2,
        targetDim: 1,
        entries: new Float64Array(2),
      },
      targetRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: eid,
        sourceDim: 2,
        targetDim: 1,
        entries: new Float64Array(2),
      },
    };

    expect(() => new CellularSheaf([v0, v1], [badEdge])).toThrow();
  });

  it("T2.5: rejects when restriction map entry is NaN", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);

    const nanEntries = new Float64Array([1, NaN]); // 1×2 map with NaN
    const e01 = makeEdge("e01", "v0", "v1", 2, 2, 1, nanEntries);

    expect(() => new CellularSheaf([v0, v1], [e01])).toThrow(
      /dimension mismatch/i,
    );
  });

  it("T2.5b: rejects when restriction map entry is Infinity", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);

    const infEntries = new Float64Array([1, Infinity]); // 1×2 map with Infinity
    const e01 = makeEdge("e01", "v0", "v1", 2, 2, 1, infEntries);

    expect(() => new CellularSheaf([v0, v1], [e01])).toThrow(
      /dimension mismatch/i,
    );
  });
});

// ---------------------------------------------------------------------------
// T10-partial: Vertex offset cumulative sum
// ---------------------------------------------------------------------------

describe("T10-partial: CellularSheaf vertex offset cumulative sums", () => {
  it("computes correct offsets for 3 vertices of dims 3, 2, 4", () => {
    const v0 = makeVertex("v0", 3);
    const v1 = makeVertex("v1", 2);
    const v2 = makeVertex("v2", 4);

    // Connect them in a path with matching restriction maps.
    const e01 = makeEdge("e01", "v0", "v1", 3, 2, 1);
    const e12 = makeEdge("e12", "v1", "v2", 2, 4, 1);

    const sheaf = new CellularSheaf([v0, v1, v2], [e01, e12]);

    expect(sheaf.getVertexOffset("v0" as VertexId)).toBe(0);
    expect(sheaf.getVertexOffset("v1" as VertexId)).toBe(3); // 0 + dim(v0) = 0 + 3
    expect(sheaf.getVertexOffset("v2" as VertexId)).toBe(5); // 3 + dim(v1) = 3 + 2
  });

  it("getVertexOffset for first vertex is always 0", () => {
    const v0 = makeVertex("v0", 100);
    const sheaf = new CellularSheaf([v0], []);
    expect(sheaf.getVertexOffset("v0" as VertexId)).toBe(0);
  });

  it("getEdgeIds returns edges in insertion order", () => {
    const v0 = makeVertex("v0", 2);
    const v1 = makeVertex("v1", 2);
    const v2 = makeVertex("v2", 2);

    const e01 = makeEdge("e01", "v0", "v1", 2, 2, 1);
    const e12 = makeEdge("e12", "v1", "v2", 2, 2, 1);

    const sheaf = new CellularSheaf([v0, v1, v2], [e01, e12]);
    expect(sheaf.getEdgeIds()).toEqual(["e01" as EdgeId, "e12" as EdgeId]);
  });
});

// ---------------------------------------------------------------------------
// Factory smoke tests
// ---------------------------------------------------------------------------

describe("Factory smoke tests: flatSheafFactory", () => {
  it("buildFlatSheaf(2, 2) constructs without throwing", () => {
    const sheaf = buildFlatSheaf(2, 2);
    expect(sheaf).toBeInstanceOf(CellularSheaf);
    expect(sheaf.c0Dimension).toBe(4); // 2 vertices × dim 2
    expect(sheaf.c1Dimension).toBe(2); // 1 edge × dim 2
  });

  it('buildFlatSheaf(3, 2, "path") constructs without throwing', () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    expect(sheaf).toBeInstanceOf(CellularSheaf);
    expect(sheaf.c0Dimension).toBe(6); // 3 vertices × dim 2
    expect(sheaf.c1Dimension).toBe(4); // 2 edges × dim 2
    expect(sheaf.getEdgeIds()).toHaveLength(2);
  });

  it('buildFlatSheaf(3, 2, "triangle") constructs without throwing', () => {
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    expect(sheaf).toBeInstanceOf(CellularSheaf);
    expect(sheaf.c0Dimension).toBe(6); // 3 vertices × dim 2
    expect(sheaf.c1Dimension).toBe(6); // 3 edges × dim 2
    expect(sheaf.getEdgeIds()).toHaveLength(3);
  });

  it('buildFlatSheaf(4, 3, "complete") constructs without throwing', () => {
    const sheaf = buildFlatSheaf(4, 3, "complete");
    expect(sheaf).toBeInstanceOf(CellularSheaf);
    expect(sheaf.c0Dimension).toBe(12); // 4 vertices × dim 3
    expect(sheaf.c1Dimension).toBe(18); // 6 edges × dim 3
    expect(sheaf.getEdgeIds()).toHaveLength(6);
  });

  it("all restriction map entries in flatSheaf are identity (diagonal 1, off-diagonal 0)", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    for (const eid of sheaf.getEdgeIds()) {
      const { source, target } = sheaf.getEdgeRestrictions(eid);
      // For 2×2 identity: [1, 0, 0, 1]
      expect(Array.from(source.entries)).toEqual([1, 0, 0, 1]);
      expect(Array.from(target.entries)).toEqual([1, 0, 0, 1]);
    }
  });
});

describe("Factory smoke tests: threeCycleFactory", () => {
  it("buildThreeCycleInconsistentSheaf constructs without throwing", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    expect(sheaf).toBeInstanceOf(CellularSheaf);
  });

  it("c0Dimension = 6 (3 vertices × R^2)", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    expect(sheaf.c0Dimension).toBe(6);
  });

  it("c1Dimension = 3 (3 edges × R^1)", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    expect(sheaf.c1Dimension).toBe(3);
  });

  it("has exactly 3 vertices and 3 edges", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    expect(sheaf.getVertexIds()).toHaveLength(3);
    expect(sheaf.getEdgeIds()).toHaveLength(3);
  });

  it("restriction maps match research spec exactly", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();

    // e01: sourceRestriction [1,0], targetRestriction [0,1]
    const e01Restrictions = sheaf.getEdgeRestrictions("e01" as EdgeId);
    expect(Array.from(e01Restrictions.source.entries)).toEqual([1, 0]);
    expect(Array.from(e01Restrictions.target.entries)).toEqual([0, 1]);

    // e12: sourceRestriction [1,0], targetRestriction [0,1]
    const e12Restrictions = sheaf.getEdgeRestrictions("e12" as EdgeId);
    expect(Array.from(e12Restrictions.source.entries)).toEqual([1, 0]);
    expect(Array.from(e12Restrictions.target.entries)).toEqual([0, 1]);

    // e20: sourceRestriction [1,0], targetRestriction [0,1]
    const e20Restrictions = sheaf.getEdgeRestrictions("e20" as EdgeId);
    expect(Array.from(e20Restrictions.source.entries)).toEqual([1, 0]);
    expect(Array.from(e20Restrictions.target.entries)).toEqual([0, 1]);
  });

  it("all vertex stalk dims are 2 and all edge stalk dims are 1", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    for (const vid of sheaf.getVertexIds()) {
      expect(sheaf.getVertex(vid).stalkSpace.dim).toBe(2);
    }
    for (const eid of sheaf.getEdgeIds()) {
      expect(sheaf.getEdgeDim(eid)).toBe(1);
    }
  });
});
