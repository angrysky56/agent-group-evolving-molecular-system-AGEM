/**
 * CohomologyAnalyzer.test.ts
 *
 * Tests for computeCohomology() and CohomologyAnalyzer class.
 *
 * Wave 3 tests:
 *   T7:   Flat 1D triangle sheaf has dim(H^1) = 1 (non-trivial cohomology detection)
 *   T7b:  Flat 2D path sheaf has dim(H^1) = 0 (flat configuration)
 *   T7c:  Flat 2D triangle sheaf has dim(H^1) = 2 (one cycle, d=2)
 *   T7d:  Dual configuration gate: both flat (H^1=0) and non-flat (H^1=1) pass in same run
 *   T8:   sheaf:h1-obstruction-detected event fires with correct payload
 *   T8b:  sheaf:consensus-reached event fires with correct payload
 *   T8c:  H^1 basis vectors have correct dimension and are unit-normalized
 *
 * Note on T7 sheaf configuration:
 *   The canonical H^1=1 sheaf used here is a flat 1D-stalk triangle: 3 vertices with
 *   R^1 stalks, 3 edges with R^1 stalks, all restriction maps = identity (scalars = 1).
 *   This gives N_0=3, N_1=3, rank(B)=2 (graph incidence matrix of a triangle cycle),
 *   dim(H^0)=1, dim(H^1)=1. This is the minimal non-trivial H^1 example.
 *
 *   The threeCycleInconsistentSheaf (vertex stalks R^2, edge stalks R^1) has N_1=3,
 *   rank(B)=3 (full row rank), so h1=0. The coboundary rows are orthogonal 1x2 projections
 *   that are linearly independent. This sheaf is used in Wave 2 (T5b) to demonstrate that
 *   L_sheaf differs from L_graph tensor I_2 -- NOT for H^1 detection.
 */

import { describe, it, expect } from "vitest";
import { computeCohomology, CohomologyAnalyzer } from "./CohomologyAnalyzer.js";
import { buildFlatSheaf } from "./helpers/flatSheafFactory.js";
import type {
  SheafH1ObstructionEvent,
  SheafConsensusReachedEvent,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// T7: Flat 1D triangle sheaf has dim(H^1) = 1
// ---------------------------------------------------------------------------

describe("T7: Non-trivial H^1 detection", () => {
  it("T7: flat 1D triangle sheaf has dim(H^1) = 1 (cycle produces obstruction)", () => {
    // Flat 1D triangle: 3 vertices x R^1, 3 edges x R^1, all identity restriction maps.
    // N_0 = 3, N_1 = 3, B = incidence matrix of triangle = rank 2.
    // dim(H^1) = N_1 - rank(B) = 3 - 2 = 1.
    // dim(H^0) = N_0 - rank(B) = 3 - 2 = 1.
    const sheaf = buildFlatSheaf(3, 1, "triangle");
    const result = computeCohomology(sheaf);

    expect(result.h1Dimension).toBe(1);
    expect(result.hasObstruction).toBe(true);
    expect(result.h0Dimension).toBe(1);
    expect(result.coboundaryRank).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // T7b: Flat 2D path sheaf has dim(H^1) = 0
  // ---------------------------------------------------------------------------

  it("T7b: flat 2D path sheaf has dim(H^1) = 0 (tree topology, no cycles)", () => {
    // Flat 2D path: 3 vertices x R^2, 2 edges x R^2, all identity restriction maps.
    // N_0 = 6, N_1 = 4, rank(B) = 4.
    // dim(H^1) = 4 - 4 = 0.
    // dim(H^0) = 6 - 4 = 2 (stalkDim for connected flat sheaf on a tree).
    const sheaf = buildFlatSheaf(3, 2, "path");
    const result = computeCohomology(sheaf);

    expect(result.h1Dimension).toBe(0);
    expect(result.hasObstruction).toBe(false);
    expect(result.h0Dimension).toBe(2); // stalkDim for flat connected tree sheaf
  });

  // ---------------------------------------------------------------------------
  // T7c: Flat 2D triangle sheaf has dim(H^1) = 2
  // ---------------------------------------------------------------------------

  it("T7c: flat 2D triangle sheaf has dim(H^1) = 2 (one cycle, d=2)", () => {
    // Flat 2D triangle: 3 vertices x R^2, 3 edges x R^2, all identity restriction maps.
    // N_0 = 6, N_1 = 6, rank(B) = 4.
    // dim(H^1) = 6 - 4 = 2 = d * (|E| - |V| + 1) = 2 * 1 = 2.
    // dim(H^0) = 6 - 4 = 2 = d for connected flat sheaf.
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const result = computeCohomology(sheaf);

    expect(result.h1Dimension).toBe(2);
    expect(result.hasObstruction).toBe(true);
    expect(result.h0Dimension).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T7d: Mandatory dual configuration (PITFALL GATE)
//
// Both a flat (H^1=0) and a non-flat/cyclic (H^1>0) test must pass in the SAME
// vitest run. If either is missing or failing, the pitfall gate is violated:
// the implementation cannot be trusted to detect obstructions.
// ---------------------------------------------------------------------------

describe("T7d: Mandatory dual configuration (PITFALL GATE)", () => {
  it("T7d-flat: flat 2D path sheaf has H^1 = 0", () => {
    // Flat sheaf on a tree (path) — no cycles, no obstructions.
    const sheaf = buildFlatSheaf(3, 2, "path");
    const result = computeCohomology(sheaf);

    expect(result.h1Dimension).toBe(0);
    expect(result.hasObstruction).toBe(false);
  });

  it("T7d-nontrivial: flat 1D triangle sheaf has H^1 = 1", () => {
    // Non-trivial configuration — triangle cycle produces obstruction.
    // This MUST pass in the same run as the flat test above.
    // If this test is missing, the obstruction code path has never been tested.
    const sheaf = buildFlatSheaf(3, 1, "triangle");
    const result = computeCohomology(sheaf);

    expect(result.h1Dimension).toBe(1);
    expect(result.hasObstruction).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T8: H^1 obstruction event fires from CohomologyAnalyzer
// ---------------------------------------------------------------------------

describe("T8: CohomologyAnalyzer event emission", () => {
  it("T8: emits sheaf:h1-obstruction-detected event when dim(H^1) > 0", () => {
    const analyzer = new CohomologyAnalyzer();
    const events: SheafH1ObstructionEvent[] = [];
    analyzer.on("sheaf:h1-obstruction-detected", (e: SheafH1ObstructionEvent) =>
      events.push(e),
    );

    const sheaf = buildFlatSheaf(3, 1, "triangle");
    analyzer.analyze(sheaf, 42);

    expect(events).toHaveLength(1);
    expect(events[0].h1Dimension).toBe(1);
    expect(events[0].type).toBe("sheaf:h1-obstruction-detected");
    expect(events[0].iteration).toBe(42);
    // affectedVertices should contain all vertex IDs (Phase 1 returns all vertices)
    expect(events[0].affectedVertices).toContain("v0");
    expect(events[0].affectedVertices).toContain("v1");
    expect(events[0].affectedVertices).toContain("v2");
  });

  // ---------------------------------------------------------------------------
  // T8b: Consensus event fires when H^1 = 0
  // ---------------------------------------------------------------------------

  it("T8b: emits sheaf:consensus-reached event when dim(H^1) = 0", () => {
    const analyzer = new CohomologyAnalyzer();
    const events: SheafConsensusReachedEvent[] = [];
    analyzer.on("sheaf:consensus-reached", (e: SheafConsensusReachedEvent) =>
      events.push(e),
    );

    const sheaf = buildFlatSheaf(3, 2, "path");
    analyzer.analyze(sheaf, 7);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sheaf:consensus-reached");
    expect(events[0].h0Dimension).toBe(2);
    expect(events[0].iteration).toBe(7);
  });

  // ---------------------------------------------------------------------------
  // T8c: H^1 basis vectors have correct dimension and are unit-normalized
  // ---------------------------------------------------------------------------

  it("T8c: H^1 basis vectors have correct length (N_1) and are unit-normalized", () => {
    const sheaf = buildFlatSheaf(3, 1, "triangle");
    const result = computeCohomology(sheaf);

    // dim(H^1) = 1 for the flat 1D triangle
    expect(result.h1Basis).toHaveLength(1);

    // Each H^1 basis vector should have length N_1 = c1Dimension = 3
    expect(result.h1Basis[0]).toHaveLength(sheaf.c1Dimension);
    expect(result.h1Basis[0].length).toBe(3);

    // SVD left singular vectors are unit-normalized by construction
    const norm = Math.sqrt(
      Array.from(result.h1Basis[0]).reduce((s, v) => s + v * v, 0),
    );
    expect(norm).toBeCloseTo(1.0, 5);
  });

  it("T8c-2d: flat 2D triangle has 2 H^1 basis vectors, each of length N_1=6", () => {
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const result = computeCohomology(sheaf);

    // dim(H^1) = 2 for flat 2D triangle
    expect(result.h1Basis).toHaveLength(2);

    // Each vector has length N_1 = c1Dimension = 6
    for (const basisVec of result.h1Basis) {
      expect(basisVec).toHaveLength(sheaf.c1Dimension);
      const norm = Math.sqrt(
        Array.from(basisVec).reduce((s, v) => s + v * v, 0),
      );
      expect(norm).toBeCloseTo(1.0, 5);
    }
  });

  it("T8d: CohomologyAnalyzer.analyze returns the same result as computeCohomology", () => {
    const analyzer = new CohomologyAnalyzer();
    const sheaf = buildFlatSheaf(3, 1, "triangle");

    const resultDirect = computeCohomology(sheaf);
    const resultAnalyze = analyzer.analyze(sheaf, 0);

    expect(resultAnalyze.h0Dimension).toBe(resultDirect.h0Dimension);
    expect(resultAnalyze.h1Dimension).toBe(resultDirect.h1Dimension);
    expect(resultAnalyze.hasObstruction).toBe(resultDirect.hasObstruction);
    expect(resultAnalyze.coboundaryRank).toBe(resultDirect.coboundaryRank);
  });
});

// ---------------------------------------------------------------------------
// T7e: Additional correctness checks
// ---------------------------------------------------------------------------

describe("T7e: Additional cohomology correctness", () => {
  it("rank-nullity: rank(B) + dim(H^0) = N_0 for flat 1D triangle", () => {
    const sheaf = buildFlatSheaf(3, 1, "triangle");
    const result = computeCohomology(sheaf);
    expect(result.coboundaryRank + result.h0Dimension).toBe(sheaf.c0Dimension);
  });

  it("rank-nullity: rank(B) + dim(H^1) = N_1 for flat 2D triangle", () => {
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const result = computeCohomology(sheaf);
    expect(result.coboundaryRank + result.h1Dimension).toBe(sheaf.c1Dimension);
  });

  it("empty h1Basis when hasObstruction = false", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const result = computeCohomology(sheaf);
    expect(result.h1Basis).toHaveLength(0);
  });

  it("Euler characteristic: dim(H^0) - dim(H^1) = chi_graph * stalkDim", () => {
    // Flat 2D triangle: chi_graph = V - E = 3 - 3 = 0, stalkDim = 2.
    // chi_sheaf = dim(H^0) - dim(H^1) = 2 - 2 = 0 = 0 * 2.
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const result = computeCohomology(sheaf);
    const chi = result.h0Dimension - result.h1Dimension;
    expect(chi).toBe(0); // chi_graph for triangle = 3 - 3 = 0
  });
});
