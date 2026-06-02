/**
 * logicalCohomology.ts — logic-based H⁰/H¹ for AGEM (the consistency complex).
 *
 * The geometric CellularSheaf cannot detect logical contradiction (see
 * docs/emergent-bonds-and-stateless-reconstruction.md §14): projections of real
 * embeddings saturate the coboundary rank, so its H¹ is always 0 regardless of
 * content. This module computes a DIFFERENT, genuinely logic-based object — the
 * homology of the CONSISTENCY COMPLEX — and is meant to AUGMENT the geometric
 * sheaf (which still provides H⁰ connectivity), not replace it.
 *
 * Construction:
 *   - vertices  = blocks that are INTERNALLY consistent (self-consistent).
 *   - edge {i,j}      present iff blocks i,j are JOINTLY consistent.
 *   - triangle {i,j,k} present iff blocks i,j,k are JOINTLY consistent.
 * Every "consistent?" decision is a satisfiability check delegated to the
 * mcp-logic server (Prover9/Mace4) — no geometry, no embeddings.
 *
 * Invariants:
 *   - H⁰ = connected components of the pairwise-consistency graph.
 *   - H¹ = cycles of pairwise-consistent blocks NOT filled by joint consistency
 *          = positions consistent in every pair but impossible all together.
 *          This is the genuine obstruction that pairwise checking cannot find
 *          (the blind-men-and-the-elephant vs. genuine-frustration distinction).
 *
 * Verified end-to-end against real Prover9/Mace4 verdicts: the minimal triple
 * {p(a), p(a)->q(a), ~q(a)} (pairwise consistent, jointly inconsistent) yields
 * H¹ = 1; three independent facts yield H¹ = 0. See docs §15.
 */

export interface LogicalBlock {
  /** Block name (use the concept-community label). */
  name: string;
  /** Core claims as well-formed first-order-logic strings (one formula each). */
  propositions: string[];
}

export interface LogicalCohomologyResult {
  h0: number;
  h1: number;
  hasObstruction: boolean;
  vertices: string[];
  /** Blocks dropped because their own propositions were self-contradictory. */
  internallyInconsistent: string[];
  consistentPairs: [string, string][];
  /** Pairwise-consistent triples that are NOT jointly consistent — the H¹ cause. */
  frustratedTriples: [string, string, string][];
  rankD1: number;
  rankD2: number;
  /** mcp-logic calls that errored (parse failures etc.) — surfaced, not hidden. */
  checkFailures: string[];
}

/** A satisfiability oracle: true = consistent, false = contradictory.
 * `null` means the check could not be completed (parse error / real timeout). */
export type SatOracle = (
  formulas: string[],
) => Promise<{ consistent: boolean | null; note?: string }>;

// ---------------------------------------------------------------------------
// mcp-logic satisfiability oracle
// ---------------------------------------------------------------------------

/**
 * Build a SatOracle backed by the mcp-logic server.
 *
 * Satisfiability of a formula set S is tested with find_counterexample:
 * premises = S, conclusion = "$F". A model where S holds and falsehood is false
 * exists iff S is satisfiable, so result="model_found" ⇒ consistent and
 * result="no_model_found" ⇒ contradictory.
 *
 * NOTE: mcp-logic was fixed at the source (see mcp-logic/ regression tests) so
 * that (a) a clean Mace4 exhaustion is reported as "no_model_found" rather than
 * a false "timeout", and (b) "~" negation is normalized to "-" server-side. So
 * this oracle no longer needs to parse raw output for those quirks — it trusts
 * the structured result fields.
 *
 * @param executeTool - mcpManager.executeTool bound function.
 */
export function makeMcpLogicOracle(
  executeTool: (server: string, tool: string, args: any) => Promise<string>,
): SatOracle {
  return async (formulas: string[]) => {
    try {
      const raw = await executeTool("mcp-logic", "find_counterexample", {
        premises: formulas,
        conclusion: "$F",
      });
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { result: "", complete_output: raw };
      }
      const result = String(parsed.result ?? "");

      if (result === "model_found") return { consistent: true };
      if (result === "no_model_found")
        return { consistent: false, note: "no model up to domain bound" };
      if (result === "error")
        return {
          consistent: null,
          note: `mcp-logic syntax error: ${parsed.reason ?? parsed.error ?? "invalid input"}`,
        };
      // Genuine timeout or unexpected result — report as undetermined.
      return { consistent: null, note: `mcp-logic result='${result}'` };
    } catch (e: any) {
      return { consistent: null, note: `mcp-logic call failed: ${e?.message}` };
    }
  };
}

// ---------------------------------------------------------------------------
// Homology of the consistency complex
// ---------------------------------------------------------------------------

/** Rank of a real matrix (rows × cols) via Gaussian elimination with partial
 * pivoting. Mirrors numpy.linalg.matrix_rank for the small matrices here. */
function matrixRank(M: number[][], tol = 1e-9): number {
  const rows = M.length;
  if (rows === 0) return 0;
  const cols = M[0].length;
  if (cols === 0) return 0;
  const A = M.map((r) => r.slice());
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col++) {
    // pivot: largest magnitude in this column at/below `rank`
    let piv = rank;
    for (let r = rank + 1; r < rows; r++)
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < tol) continue;
    [A[rank], A[piv]] = [A[piv], A[rank]];
    const pv = A[rank][col];
    for (let r = 0; r < rows; r++) {
      if (r === rank) continue;
      const f = A[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c < cols; c++) A[r][c] -= f * A[rank][c];
    }
    rank++;
  }
  return rank;
}

const key2 = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Run the full pipeline: internal-consistency → pairwise → triple checks via the
 * SatOracle, then compute H⁰/H¹ of the resulting consistency complex.
 */
export async function computeLogicalCohomology(
  blocks: LogicalBlock[],
  sat: SatOracle,
): Promise<LogicalCohomologyResult> {
  const checkFailures: string[] = [];
  const internallyInconsistent: string[] = [];

  // 1) Internal consistency — "self-consistent tautologies" first.
  const vertices: string[] = [];
  const propsOf = new Map(blocks.map((b) => [b.name, b.propositions]));
  for (const b of blocks) {
    const r = await sat(b.propositions);
    if (r.consistent === true) vertices.push(b.name);
    else if (r.consistent === false) internallyInconsistent.push(b.name);
    else checkFailures.push(`internal(${b.name}): ${r.note ?? "unknown"}`);
  }

  // 2) Pairwise consistency → edges.
  const consistentPairs: [string, string][] = [];
  const pairSet = new Set<string>();
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const a = vertices[i], b = vertices[j];
      const r = await sat([...propsOf.get(a)!, ...propsOf.get(b)!]);
      if (r.consistent === true) {
        consistentPairs.push([a, b]);
        pairSet.add(key2(a, b));
      } else if (r.consistent === null) {
        checkFailures.push(`pair(${a},${b}): ${r.note ?? "unknown"}`);
      }
    }
  }

  // 3) Triple consistency → filled triangles. Only test 3-cliques in the
  //    pairwise graph (others cannot be jointly consistent — downward closure).
  const filledTriangles: [string, string, string][] = [];
  const frustratedTriples: [string, string, string][] = [];
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      for (let k = j + 1; k < vertices.length; k++) {
        const a = vertices[i], b = vertices[j], c = vertices[k];
        if (!pairSet.has(key2(a, b)) || !pairSet.has(key2(a, c)) ||
            !pairSet.has(key2(b, c))) continue; // not a 3-clique
        const r = await sat([
          ...propsOf.get(a)!, ...propsOf.get(b)!, ...propsOf.get(c)!,
        ]);
        if (r.consistent === true) filledTriangles.push([a, b, c]);
        else if (r.consistent === false) frustratedTriples.push([a, b, c]);
        else checkFailures.push(`triple(${a},${b},${c}): ${r.note ?? "unknown"}`);
      }

  // 4) Boundary matrices and homology.
  const vIdx = new Map(vertices.map((v, i) => [v, i]));
  const edges = consistentPairs.map(([a, b]) => (a < b ? [a, b] : [b, a]));
  const eIdx = new Map(edges.map((e, i) => [`${e[0]}|${e[1]}`, i]));

  const d1: number[][] = Array.from({ length: vertices.length }, () =>
    new Array(edges.length).fill(0));
  edges.forEach(([a, b], j) => {
    d1[vIdx.get(a)!][j] -= 1;
    d1[vIdx.get(b)!][j] += 1;
  });

  const d2: number[][] = Array.from({ length: edges.length }, () =>
    new Array(filledTriangles.length).fill(0));
  filledTriangles.forEach((t, j) => {
    const [a, b, c] = [...t].sort();
    d2[eIdx.get(`${b}|${c}`)!][j] += 1;
    d2[eIdx.get(`${a}|${c}`)!][j] -= 1;
    d2[eIdx.get(`${a}|${b}`)!][j] += 1;
  });

  const rankD1 = matrixRank(d1);
  const rankD2 = matrixRank(d2);
  const h0 = vertices.length - rankD1;
  const h1 = edges.length - rankD1 - rankD2;

  return {
    h0, h1, hasObstruction: h1 > 0,
    vertices, internallyInconsistent, consistentPairs, frustratedTriples,
    rankD1, rankD2, checkFailures,
  };
}
