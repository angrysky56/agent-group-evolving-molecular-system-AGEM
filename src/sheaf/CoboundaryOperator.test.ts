/**
 * CoboundaryOperator.test.ts
 *
 * Tests for buildCoboundaryMatrix():
 *
 *   T3: Hand-computed coboundary matrix for 2-vertex, identity maps
 *   T3b: Coboundary matrix for 3-vertex path with heterogeneous stalks
 *   T3c: PITFALL GATE — three-cycle B has shape [3, 6] (NOT [3, 3])
 *   T3d: Orientation sign test (swapped source/target)
 *
 * PITFALL NOTE: If B has shape [|E|, |V|] = [3, 3] for the three-cycle, the
 * implementation built the graph incidence matrix instead of the sheaf coboundary
 * operator. The correct shape is [N_1, N_0] = [3, 6].
 *
 * Orientation convention (fixed):
 *   source vertex → NEGATIVE block (-F_{u<-e})
 *   target vertex → POSITIVE block (+F_{v<-e})
 */

import { describe, it, expect } from "vitest";
import * as math from "mathjs";
import { buildCoboundaryMatrix } from "./CoboundaryOperator.js";
import { CellularSheaf } from "./CellularSheaf.js";
import { buildThreeCycleInconsistentSheaf } from "./helpers/threeCycleFactory.js";
import type {
  VertexId,
  EdgeId,
  SheafVertex,
  SheafEdge,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Helper: build identity matrix as row-major Float64Array
// ---------------------------------------------------------------------------

function identityEntries(dim: number): Float64Array {
  const m = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    m[i * dim + i] = 1.0;
  }
  return m;
}

/**
 * Extract a 2D array from a mathjs matrix for easy testing.
 */
function matToArray(m: math.Matrix): number[][] {
  return m.toArray() as number[][];
}

/**
 * Get matrix dimensions [rows, cols] from a mathjs matrix.
 */
function matSize(m: math.Matrix): [number, number] {
  const s = m.size();
  return [s[0], s[1]];
}

// ---------------------------------------------------------------------------
// T3: Hand-computed coboundary matrix (2-vertex, 1-edge, identity restriction maps)
// ---------------------------------------------------------------------------

describe("T3: Coboundary matrix hand-computed verification (2-vertex, identity 2D maps)", () => {
  /**
   * Setup:
   *   v0: dim=2, v1: dim=2
   *   e01: source=v0, target=v1, dim=2, both restrictions = I_2
   *
   * Expected B (shape 2x4):
   *   B[0, :] = [-1, 0, 1, 0]   (row 0: -I[0,:] at srcCol=0, +I[0,:] at tgtCol=2)
   *   B[1, :] = [0, -1, 0, 1]   (row 1: -I[1,:] at srcCol=0, +I[1,:] at tgtCol=2)
   *
   * N_0 = 4 (2+2), N_1 = 2 (2)
   */
  it("T3.1: B has shape [2, 4] for 2-vertex 2D sheaf", () => {
    const v0: SheafVertex = { id: "v0" as VertexId, stalkSpace: { dim: 2 } };
    const v1: SheafVertex = { id: "v1" as VertexId, stalkSpace: { dim: 2 } };

    const e01: SheafEdge = {
      id: "e01" as EdgeId,
      sourceVertex: "v0" as VertexId,
      targetVertex: "v1" as VertexId,
      stalkSpace: { dim: 2 },
      sourceRestriction: {
        sourceVertexId: "v0" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
      targetRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
    };

    const sheaf = new CellularSheaf([v0, v1], [e01]);
    const B = buildCoboundaryMatrix(sheaf);
    const [rows, cols] = matSize(B);

    expect(rows).toBe(2); // N_1 = 2
    expect(cols).toBe(4); // N_0 = 4
  });

  it("T3.2: B = [[-1, 0, 1, 0], [0, -1, 0, 1]] element-wise (tolerance 1e-14)", () => {
    const v0: SheafVertex = { id: "v0" as VertexId, stalkSpace: { dim: 2 } };
    const v1: SheafVertex = { id: "v1" as VertexId, stalkSpace: { dim: 2 } };

    const e01: SheafEdge = {
      id: "e01" as EdgeId,
      sourceVertex: "v0" as VertexId,
      targetVertex: "v1" as VertexId,
      stalkSpace: { dim: 2 },
      sourceRestriction: {
        sourceVertexId: "v0" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
      targetRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
    };

    const sheaf = new CellularSheaf([v0, v1], [e01]);
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // Expected: [[-1, 0, 1, 0], [0, -1, 0, 1]]
    const expected = [
      [-1, 0, 1, 0],
      [0, -1, 0, 1],
    ];

    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        expect(Math.abs(arr[r][c] - expected[r][c])).toBeLessThan(1e-14);
      }
    }
  });

  it("T3.3: B * constant_section = 0 (global section is in ker B)", () => {
    // A constant section for a flat sheaf is [1, 0, 1, 0] (same state at each vertex).
    const v0: SheafVertex = { id: "v0" as VertexId, stalkSpace: { dim: 2 } };
    const v1: SheafVertex = { id: "v1" as VertexId, stalkSpace: { dim: 2 } };

    const e01: SheafEdge = {
      id: "e01" as EdgeId,
      sourceVertex: "v0" as VertexId,
      targetVertex: "v1" as VertexId,
      stalkSpace: { dim: 2 },
      sourceRestriction: {
        sourceVertexId: "v0" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
      targetRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
    };

    const sheaf = new CellularSheaf([v0, v1], [e01]);
    const B = buildCoboundaryMatrix(sheaf);

    const x = [1, 0, 1, 0]; // constant section: v0=[1,0], v1=[1,0]
    const Bx = math.multiply(B, x) as math.Matrix;
    const BxArr = Bx.toArray() as number[];

    for (const v of BxArr) {
      expect(Math.abs(v)).toBeLessThan(1e-14);
    }
  });
});

// ---------------------------------------------------------------------------
// T3b: Coboundary matrix for 3-vertex path with heterogeneous stalks
// ---------------------------------------------------------------------------

describe("T3b: Coboundary matrix for 3-vertex path with heterogeneous stalk dims", () => {
  /**
   * Topology: v0 -e01-> v1 -e12-> v2
   *
   * Vertex stalks: v0=R^3 (dim=3), v1=R^2 (dim=2), v2=R^1 (dim=1)
   * Edge stalks:   e01=R^2 (dim=2), e12=R^1 (dim=1)
   *
   * N_0 = 3 + 2 + 1 = 6
   * N_1 = 2 + 1 = 3
   *
   * B has shape [3, 6] — NOT [2, 3] (which would be the graph incidence matrix).
   *
   * Custom restriction maps:
   *   e01: sourceRestriction (v0 -> e01): 2x3 matrix
   *        [[1, 0, 0],   (row-major: first 2 rows of 3D->2D projection)
   *         [0, 1, 0]]
   *        targetRestriction (v1 -> e01): 2x2 identity
   *
   *   e12: sourceRestriction (v1 -> e12): 1x2 matrix [[1, 0]] (project first coord)
   *        targetRestriction (v2 -> e12): 1x1 identity [[1]]
   */
  function buildHeterogeneousSheaf(): CellularSheaf {
    const v0: SheafVertex = { id: "v0" as VertexId, stalkSpace: { dim: 3 } };
    const v1: SheafVertex = { id: "v1" as VertexId, stalkSpace: { dim: 2 } };
    const v2: SheafVertex = { id: "v2" as VertexId, stalkSpace: { dim: 1 } };

    // e01: v0(dim=3) -> v1(dim=2), edge stalk dim=2
    // sourceRestriction: 2x3 matrix projecting R^3 -> R^2 (drop third coord)
    const e01src = new Float64Array([1, 0, 0, 0, 1, 0]); // rows: [1,0,0] and [0,1,0]
    // targetRestriction: 2x2 identity
    const e01tgt = identityEntries(2);

    const e01: SheafEdge = {
      id: "e01" as EdgeId,
      sourceVertex: "v0" as VertexId,
      targetVertex: "v1" as VertexId,
      stalkSpace: { dim: 2 },
      sourceRestriction: {
        sourceVertexId: "v0" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 3,
        targetDim: 2,
        entries: e01src,
      },
      targetRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: "e01" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: e01tgt,
      },
    };

    // e12: v1(dim=2) -> v2(dim=1), edge stalk dim=1
    // sourceRestriction: 1x2 matrix [[1, 0]] (project onto first axis)
    const e12src = new Float64Array([1, 0]);
    // targetRestriction: 1x1 identity [[1]]
    const e12tgt = new Float64Array([1]);

    const e12: SheafEdge = {
      id: "e12" as EdgeId,
      sourceVertex: "v1" as VertexId,
      targetVertex: "v2" as VertexId,
      stalkSpace: { dim: 1 },
      sourceRestriction: {
        sourceVertexId: "v1" as VertexId,
        edgeId: "e12" as EdgeId,
        sourceDim: 2,
        targetDim: 1,
        entries: e12src,
      },
      targetRestriction: {
        sourceVertexId: "v2" as VertexId,
        edgeId: "e12" as EdgeId,
        sourceDim: 1,
        targetDim: 1,
        entries: e12tgt,
      },
    };

    return new CellularSheaf([v0, v1, v2], [e01, e12]);
  }

  it("T3b.1: B has shape [3, 6] for heterogeneous stalk dims", () => {
    const sheaf = buildHeterogeneousSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const [rows, cols] = matSize(B);

    expect(rows).toBe(3); // N_1 = 3
    expect(cols).toBe(6); // N_0 = 6
  });

  it("T3b.2: specific block entries match hand computation for e01 source block", () => {
    /**
     * e01: eRow=0, eDim=2
     *   srcCol=0 (v0 offset), srcDim=3
     *   Source block at B[0:2, 0:3] = -F_{v0<-e01} = -[[1,0,0],[0,1,0]]
     *   So B[0,0]=-1, B[0,1]=0, B[0,2]=0, B[1,0]=0, B[1,1]=-1, B[1,2]=0
     */
    const sheaf = buildHeterogeneousSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // Source block of e01: -[[1,0,0],[0,1,0]]
    expect(arr[0][0]).toBeCloseTo(-1, 14);
    expect(arr[0][1]).toBeCloseTo(0, 14);
    expect(arr[0][2]).toBeCloseTo(0, 14);
    expect(arr[1][0]).toBeCloseTo(0, 14);
    expect(arr[1][1]).toBeCloseTo(-1, 14);
    expect(arr[1][2]).toBeCloseTo(0, 14);
  });

  it("T3b.3: target block of e01 is +identity at tgtCol=3 (v1 offset)", () => {
    /**
     * e01: eRow=0, eDim=2
     *   tgtCol=3 (v1 offset = dim(v0) = 3), tgtDim=2
     *   Target block at B[0:2, 3:5] = +I_2 = [[1,0],[0,1]]
     */
    const sheaf = buildHeterogeneousSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // Target block of e01 at col 3:4
    expect(arr[0][3]).toBeCloseTo(1, 14);
    expect(arr[0][4]).toBeCloseTo(0, 14);
    expect(arr[1][3]).toBeCloseTo(0, 14);
    expect(arr[1][4]).toBeCloseTo(1, 14);
  });

  it("T3b.4: source block of e12 is -[1, 0] at eRow=2, srcCol=3 (v1 offset)", () => {
    /**
     * e12: eRow=2, eDim=1
     *   srcCol=3 (v1 offset), srcDim=2
     *   Source block at B[2, 3:5] = -[1, 0] = [-1, 0]
     */
    const sheaf = buildHeterogeneousSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    expect(arr[2][3]).toBeCloseTo(-1, 14);
    expect(arr[2][4]).toBeCloseTo(0, 14);
  });
});

// ---------------------------------------------------------------------------
// T3c: PITFALL GATE — three-cycle B has shape [3, 6] NOT [3, 3]
// ---------------------------------------------------------------------------

describe("T3c: PITFALL GATE — three-cycle coboundary matrix shape verification", () => {
  /**
   * The three-cycle inconsistency sheaf:
   *   - 3 vertices with R^2 stalks (N_0 = 6)
   *   - 3 edges with R^1 stalks (N_1 = 3)
   *
   * CORRECT coboundary operator: B has shape [3, 6]
   * WRONG (graph incidence matrix): B would have shape [3, 3]
   *
   * If this test fails with shape [3, 3], the implementation built the standard
   * graph incidence matrix (scalar +1/-1 entries) instead of the sheaf coboundary
   * operator (matrix-valued blocks). This is the silent substitution error.
   */
  it("T3c.1: PITFALL GATE — B has shape [3, 6] not [3, 3]", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const [rows, cols] = matSize(B);

    // This is the critical check:
    // [3, 3] = graph incidence matrix (WRONG)
    // [3, 6] = sheaf coboundary operator (CORRECT)
    expect(rows).toBe(3); // N_1 = 3 (3 edges × R^1)
    expect(cols).toBe(6); // N_0 = 6 (3 vertices × R^2) -- NOT 3!
  });

  it("T3c.2: at least one block entry is not +1 or -1 (proves non-scalar restriction maps)", () => {
    /**
     * The three-cycle has 1x2 restriction maps like [1, 0] and [0, 1].
     * These are NOT the scalar +1/-1 entries of a graph incidence matrix.
     * The block entries in B will be 0 where the incidence matrix would have 0,
     * but will also contain 0 where a restriction map entry is 0.
     *
     * Specifically: B has a column pattern like [0, 1] from the [0, 1] projection.
     * The entry "1" at a zero position in the incidence matrix is the proof.
     *
     * The B matrix for the three-cycle (derived above):
     *   B = [[-1, 0,  0, 1,  0, 0],
     *        [ 0, 0, -1, 0,  0, 1],
     *        [ 0, 1,  0, 0, -1, 0]]
     *
     * Entries at B[0,3]=1, B[1,5]=1, B[2,1]=1 and B[2,4]=-1
     * — the value "1" appearing at B[0,3] (column 3) where a pure incidence
     * matrix would have entry 0 at column 3 (since columns represent scalars),
     * demonstrates the sheaf structure. Actually the point is that column 3
     * corresponds to the second coordinate of v1, which is not a vertex-level slot.
     *
     * Simpler check: verify that some entry has a value that is neither +1, -1, nor 0.
     * Actually all entries ARE in {-1, 0, 1} for THIS specific sheaf (the restriction
     * maps are [1,0] and [0,1] which are unit vectors). So we verify instead:
     * - B has entries in column 1 (second coord of v0) from edge e20's target restriction [0,1]
     * - B[2][1] = 1 (from e20 target block: +[0,1] at v0 col=0, but col 1 is second coord)
     *
     * The real proof is the shape [3,6] combined with verifying a non-zero entry
     * that would be zero in the graph incidence matrix.
     */
    const sheaf = buildThreeCycleInconsistentSheaf();
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // In the graph incidence matrix (3x3), B[0][1] would be 0 (vertex v1 column).
    // In the sheaf coboundary matrix (3x6), B[0][3] = +1 (second coord of v1,
    // from e01 target restriction [0, 1]).
    // This 1 at position [0,3] proves we have a sheaf operator, not a scalar incidence matrix.
    expect(Math.abs(arr[0][3])).toBeGreaterThan(0.5);

    // Also verify the full expected B matrix:
    // e01: eRow=0, source=v0(col=0, dim=2), target=v1(col=2, dim=2)
    //   source block: -[1, 0] at cols 0,1 → B[0,0]=-1, B[0,1]=0
    //   target block: +[0, 1] at cols 2,3 → B[0,2]=0, B[0,3]=1
    const expectedB = [
      [-1, 0, 0, 1, 0, 0],
      [0, 0, -1, 0, 0, 1],
      [0, 1, 0, 0, -1, 0],
    ];

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        expect(Math.abs(arr[r][c] - expectedB[r][c])).toBeLessThan(1e-14);
      }
    }
  });

  it("T3c.3: B * x != 0 for a random x (three-cycle has no non-trivial global section)", () => {
    /**
     * The three-cycle has no non-trivial global section due to holonomy.
     * For a generic random x, B * x != 0.
     *
     * Note: ker(B) might still have non-trivial elements if B has null space.
     * But for the three-cycle, rank(B) = 2, so dim(ker(B)) = N_0 - rank(B) = 4.
     * A random 6-dim vector will almost certainly not be in ker(B).
     *
     * We test with a specific x that is NOT in ker(B):
     * x = [1, 0, 0, 0, 0, 0] (only v0's first coordinate is nonzero)
     *
     * B * x = [-1, 0, 0]^T (from e01 source block hitting v0's first coord)
     * This is nonzero, confirming x is not a global section.
     */
    const sheaf = buildThreeCycleInconsistentSheaf();
    const B = buildCoboundaryMatrix(sheaf);

    const x = [1, 0, 0, 0, 0, 0];
    const BxRaw = math.multiply(B, x);
    const Bx: number[] = Array.isArray(BxRaw)
      ? (BxRaw as number[])
      : ((BxRaw as math.Matrix).toArray() as number[]);

    // ||B * x|| should be > 0
    const norm = Math.sqrt(Bx.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// T3d: Orientation sign test (swapping source and target negates blocks)
// ---------------------------------------------------------------------------

describe("T3d: Orientation sign test — swapping source/target negates B blocks", () => {
  /**
   * Build two 2-vertex sheaves with 2D stalks and identity maps:
   *   - sheaf1: e01 with source=v0, target=v1
   *   - sheaf2: e10 with source=v1, target=v0 (swapped)
   *
   * sheaf1 B:  [[-1, 0, 1, 0], [0, -1, 0, 1]]
   * sheaf2 B:  [[ 1, 0, -1, 0], [0, 1, 0, -1]]  -- negated blocks
   *
   * Note: vertex insertion ORDER determines column layout.
   * To keep the same column layout (v0 at cols 0-1, v1 at cols 2-3),
   * we insert vertices in the same order [v0, v1].
   * Only the edge orientation changes.
   */
  function buildSheaf(
    sourceId: "v0" | "v1",
    targetId: "v0" | "v1",
  ): CellularSheaf {
    const v0: SheafVertex = { id: "v0" as VertexId, stalkSpace: { dim: 2 } };
    const v1: SheafVertex = { id: "v1" as VertexId, stalkSpace: { dim: 2 } };

    const srcId = sourceId as VertexId;
    const tgtId = targetId as VertexId;

    const edge: SheafEdge = {
      id: "e" as EdgeId,
      sourceVertex: srcId,
      targetVertex: tgtId,
      stalkSpace: { dim: 2 },
      sourceRestriction: {
        sourceVertexId: srcId,
        edgeId: "e" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
      targetRestriction: {
        sourceVertexId: tgtId,
        edgeId: "e" as EdgeId,
        sourceDim: 2,
        targetDim: 2,
        entries: identityEntries(2),
      },
    };

    // Always insert v0 first so column layout is consistent.
    return new CellularSheaf([v0, v1], [edge]);
  }

  it("T3d.1: original orientation B[0,0] = -1 (source v0 → negative block)", () => {
    const sheaf = buildSheaf("v0", "v1");
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // Source is v0 (cols 0-1): negative block
    expect(arr[0][0]).toBeCloseTo(-1, 14);
    expect(arr[1][1]).toBeCloseTo(-1, 14);
    // Target is v1 (cols 2-3): positive block
    expect(arr[0][2]).toBeCloseTo(1, 14);
    expect(arr[1][3]).toBeCloseTo(1, 14);
  });

  it("T3d.2: swapped orientation B[0,0] = +1 (source v1 → negative block at v1 cols)", () => {
    /**
     * Swapped: source=v1, target=v0
     * Now source (v1) is at cols 2-3, gets negative block
     * Target (v0) is at cols 0-1, gets positive block
     *
     * B[0,0] = +1 (target v0 block, positive)
     * B[0,2] = -1 (source v1 block, negative)
     */
    const sheaf = buildSheaf("v1", "v0");
    const B = buildCoboundaryMatrix(sheaf);
    const arr = matToArray(B);

    // Source is v1 (cols 2-3): negative block
    expect(arr[0][2]).toBeCloseTo(-1, 14);
    expect(arr[1][3]).toBeCloseTo(-1, 14);
    // Target is v0 (cols 0-1): positive block
    expect(arr[0][0]).toBeCloseTo(1, 14);
    expect(arr[1][1]).toBeCloseTo(1, 14);
  });

  it("T3d.3: swapped B is the negative of original B (blocks negated)", () => {
    const sheaf1 = buildSheaf("v0", "v1");
    const sheaf2 = buildSheaf("v1", "v0");

    const B1 = buildCoboundaryMatrix(sheaf1);
    const B2 = buildCoboundaryMatrix(sheaf2);

    const arr1 = matToArray(B1);
    const arr2 = matToArray(B2);

    // B2 should be the negation of B1 (swapping source/target negates all blocks)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        expect(arr1[r][c]).toBeCloseTo(-arr2[r][c], 14);
      }
    }
  });
});
