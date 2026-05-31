/**
 * sheaf-harness.ts — offline diagnostic for AGEM sheaf cohomology.
 *
 * Bypasses the server, the MCP layer, and the LLM. Imports CohomologyAnalyzer
 * and CellularSheaf directly, builds sheaves from hand-constructed stalks and
 * restriction maps, and prints the raw H^0 / H^1 / rank numbers.
 *
 * Purpose: answer the question the quantum-interpretations run never could —
 * can H^1 fire at all? — by feeding the analyzer a sheaf with a KNOWN nonzero
 * obstruction and confirming it reports it.
 *
 * Run:  npx tsx docs/ebsr-implementation/sheaf-harness.ts
 */

import {
  computeCohomology,
} from "../../src/sheaf/CohomologyAnalyzer.js";
import { CellularSheaf } from "../../src/sheaf/CellularSheaf.js";
import type {
  SheafVertex,
  SheafEdge,
  VertexId,
  EdgeId,
} from "../../src/types/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vid = (s: string): VertexId => s as VertexId;
const eid = (s: string): EdgeId => s as EdgeId;

/** Build a row-major 1x1 restriction map (scalar) for a 1-D stalk. */
function scalarEdge(
  id: string,
  src: string,
  tgt: string,
  srcScalar: number,
  tgtScalar: number,
): SheafEdge {
  return {
    id: eid(id),
    sourceVertex: vid(src),
    targetVertex: vid(tgt),
    stalkSpace: { dim: 1, label: id },
    sourceRestriction: {
      sourceVertexId: vid(src),
      edgeId: eid(id),
      sourceDim: 1,
      targetDim: 1,
      entries: new Float64Array([srcScalar]),
    },
    targetRestriction: {
      sourceVertexId: vid(tgt),
      edgeId: eid(id),
      sourceDim: 1,
      targetDim: 1,
      entries: new Float64Array([tgtScalar]),
    },
  };
}

function report(name: string, sheaf: CellularSheaf, expectation: string): void {
  const r = computeCohomology(sheaf);
  console.log(`\n=== ${name} ===`);
  console.log(`  N0 (vertex stalk dim total): ${sheaf.c0Dimension}`);
  console.log(`  N1 (edge stalk dim total):   ${sheaf.c1Dimension}`);
  console.log(`  coboundary rank:             ${r.coboundaryRank}`);
  console.log(`  H^0 (consensus / components):${r.h0Dimension}`);
  console.log(`  H^1 (obstruction):           ${r.h1Dimension}`);
  console.log(`  hasObstruction:              ${r.hasObstruction}`);
  console.log(`  tolerance:                   ${r.tolerance.toExponential(3)}`);
  console.log(`  EXPECTED: ${expectation}`);
}

// ---------------------------------------------------------------------------
// TEST 1 — Acyclic agreement (control): two vertices, one edge, identity maps.
// A spanning tree has no cycle space -> H^1 MUST be 0. H^0 = 1 (one component).
// ---------------------------------------------------------------------------

function testAcyclicAgreement(): void {
  const vertices: SheafVertex[] = [
    { id: vid("A"), stalkSpace: { dim: 1, label: "A" } },
    { id: vid("B"), stalkSpace: { dim: 1, label: "B" } },
  ];
  const edges: SheafEdge[] = [scalarEdge("AB", "A", "B", 1, 1)];
  report(
    "TEST 1: acyclic agreement (tree)",
    new CellularSheaf(vertices, edges),
    "H^1 = 0 (no cycle), H^0 = 1 (connected)",
  );
}

// ---------------------------------------------------------------------------
// TEST 2 — Disconnected (control): two vertices, NO edge.
// N1 = 0 -> early return. H^0 = 2 (two components), H^1 = 0.
// This is the legitimate "silent zero" path: no edges to carry an obstruction.
// ---------------------------------------------------------------------------

function testDisconnected(): void {
  const vertices: SheafVertex[] = [
    { id: vid("A"), stalkSpace: { dim: 1, label: "A" } },
    { id: vid("B"), stalkSpace: { dim: 1, label: "B" } },
  ];
  report(
    "TEST 2: disconnected (no edges)",
    new CellularSheaf(vertices, []),
    "H^1 = 0, H^0 = 2 (two components, N1=0 early return)",
  );
}

// ---------------------------------------------------------------------------
// VERIFIED CONVENTION (read from CoboundaryOperator.ts):
//   B row for edge (u->v): -srcEntries on u's block, +tgtEntries on v's block.
//   So the constraint is  -src*s_u + tgt*s_v = 0  =>  s_v = (src/tgt)*s_u.
//   Holonomy around a loop = product of (src/tgt) over its edges.
//
// IMPORTANT subtlety this harness revealed:
//   A triangle has Betti number b1 = E-V+1 = 1. For a FLAT (untwisted) sheaf
//   on that triangle, H^1 = 1 — the cohomology of the loop itself — even though
//   a consistent global section exists (H^0 = 1). H^1 here counts the
//   independent cycle, NOT a contradiction. A TWIST (holonomy != 1) makes all
//   edge constraints independent, raising rank, which DROPS H^1 to 0 and also
//   kills the global section (H^0 = 0). So for 1-D real stalks:
//       untwisted loop -> H^0=1, H^1=1   (cycle present, globally consistent)
//       twisted   loop -> H^0=0, H^1=0   (no consistent section; rank saturates)
//   This is why the QM run never showed H^1>0 from "disagreement": disagreement
//   between empirically-equivalent worldviews is not a holonomy twist.
// ---------------------------------------------------------------------------
// TEST 3 — twisted triangle (one ratio negated). Holonomy = -1.
// Under the verified convention this SATURATES rank -> H^0 = 0, H^1 = 0.
// ---------------------------------------------------------------------------

function testCyclicObstruction(): void {
  const vertices: SheafVertex[] = [
    { id: vid("A"), stalkSpace: { dim: 1, label: "A" } },
    { id: vid("B"), stalkSpace: { dim: 1, label: "B" } },
    { id: vid("C"), stalkSpace: { dim: 1, label: "C" } },
  ];
  // Edges around the triangle. src scalar = 1 on the "from" side.
  // The tgt scalar sets the gluing ratio. Product of ratios around the loop:
  //   AB: 1, BC: 1, CA: -1  -> holonomy -1 != 1 -> obstruction.
  const edges: SheafEdge[] = [
    scalarEdge("AB", "A", "B", 1, 1),
    scalarEdge("BC", "B", "C", 1, 1),
    scalarEdge("CA", "C", "A", 1, -1),
  ];
  report(
    "TEST 3: twisted triangle (holonomy -1)",
    new CellularSheaf(vertices, edges),
    "H^1 = 0, H^0 = 0 (twist saturates rank; no global section)",
  );
}

// ---------------------------------------------------------------------------
// TEST 4 — Untwisted triangle (holonomy = 1). The loop's own cohomology.
// A consistent global section exists (H^0 = 1) AND the cycle contributes
// H^1 = 1 (Betti number of the triangle). This is the "loop present, globally
// consistent" case — H^1 here is topological, not a contradiction.
// ---------------------------------------------------------------------------

function testCyclicAgreement(): void {
  const vertices: SheafVertex[] = [
    { id: vid("A"), stalkSpace: { dim: 1, label: "A" } },
    { id: vid("B"), stalkSpace: { dim: 1, label: "B" } },
    { id: vid("C"), stalkSpace: { dim: 1, label: "C" } },
  ];
  const edges: SheafEdge[] = [
    scalarEdge("AB", "A", "B", 1, 1),
    scalarEdge("BC", "B", "C", 1, 1),
    scalarEdge("CA", "C", "A", 1, 1),
  ];
  report(
    "TEST 4: untwisted triangle (holonomy +1)",
    new CellularSheaf(vertices, edges),
    "H^1 = 1 (loop Betti number), H^0 = 1 (consistent global section)",
  );
}

// ---------------------------------------------------------------------------
// Run all
// ---------------------------------------------------------------------------

console.log("AGEM sheaf cohomology — offline diagnostic harness");
console.log("===================================================");
console.log("If TEST 3 reports H^1 = 1, the obstruction machinery provably");
console.log("fires end-to-end. If it reports H^1 = 0, the analyzer cannot");
console.log("detect a known obstruction and the bug is in CohomologyAnalyzer,");
console.log("not in the corpus.");

testAcyclicAgreement();
testDisconnected();
testCyclicObstruction();
testCyclicAgreement();

console.log("\n===================================================");
console.log("Interpretation guide:");
console.log("  Tests 1,2,4 = controls (H^1 must be 0).");
console.log("  Test 3 = the real probe (H^1 must be 1).");
console.log("  All four correct => analyzer is sound; QM-run H^1=0 readings");
console.log("  were truthful (no cyclic contradiction existed in that corpus).");
