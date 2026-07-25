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

/**
 * A minimal unsatisfiable subset (MUS): a set of blocks that cannot all be true
 * together, every proper subset of which CAN. Minimality is guaranteed by
 * construction — a set is only tested once all of its faces are known
 * consistent — so each one names an irreducible contradiction.
 */
export interface Frustration {
  blocks: string[];
  /** Number of blocks involved. 3 = classic frustrated triple. */
  arity: number;
}

export interface LogicalCohomologyResult {
  /**
   * THE headline result. True iff a minimal unsatisfiable subset was found.
   *
   * Use this, not `h1`. See the `h1` doc comment for why.
   */
  hasContradiction: boolean;
  /** Every minimal unsatisfiable subset found, at any arity. The real product. */
  frustrations: Frustration[];
  /**
   * Defects in the SUPPLIED FORMALIZATION. A `critical` entry means the
   * consistency verdict is an artifact of the encoding and says nothing about
   * the claims — see `resultIsVacuous`.
   */
  formalizationWarnings: FormalizationWarning[];
  /**
   * True when a critical formalization defect makes "no contradiction"
   * mathematically guaranteed regardless of content. Do not report a clean
   * bill of health when this is set.
   */
  resultIsVacuous: boolean;

  h0: number;
  /**
   * H¹ of the consistency complex. **Not a reliable contradiction detector.**
   *
   * H¹ > 0 does imply a frustration exists, but the converse fails badly, in
   * two distinct ways — both verified against this implementation:
   *
   *   1. Extra consistent blocks cancel it. With n ≥ 4 blocks, a single
   *      frustrated triple gives H¹ = 0, because the other filled triangles
   *      span the whole cycle space and the unfilled one becomes a boundary
   *      rather than a cycle. Measured: n=3 → H¹=1; n=4,5,6,8 → H¹=0, with the
   *      same genuine frustration present throughout.
   *   2. It only ever sees arity 3. A 4-block minimal unsatisfiable set has all
   *      of its triples satisfiable, so every triangle fills and H¹ = 0.
   *
   * Since real runs name blocks from concept communities and so almost always
   * have ≥ 4 blocks, H¹ is pinned at 0 in practice. It is retained as a
   * topological summary of the complex, not as the detector.
   */
  h1: number;
  /** Kept for compatibility. Equivalent to h1 > 0, with all the caveats above. */
  hasObstruction: boolean;
  /** Set when h1 is 0 but frustrations exist — explains the discrepancy. */
  h1Note?: string;

  vertices: string[];
  /** Blocks dropped because their own propositions were self-contradictory. */
  internallyInconsistent: string[];
  consistentPairs: [string, string][];
  /** Compatibility view of `frustrations` filtered to arity 3. */
  frustratedTriples: [string, string, string][];

  /** Highest arity actually searched. */
  searchedToArity: number;
  /** True if the search stopped at a cap rather than exhausting the lattice —
   * i.e. frustrations of higher arity have NOT been ruled out. */
  searchTruncated: boolean;
  /** Number of satisfiability checks performed. */
  checksPerformed: number;

  rankD1: number;
  rankD2: number;
  /** mcp-logic calls that errored (parse failures etc.) — surfaced, not hidden. */
  checkFailures: string[];
  /** Per-check audit trail for explainability: every satisfiability test run,
   * what it tested, and the verdict. The mcp-logic calls happen inside the
   * engine, so this is how they become inspectable rather than opaque. */
  checkLog: {
    kind: "internal" | "pair" | "triple" | "set";
    blocks: string[];
    formulas: string[];
    verdict: "consistent" | "contradictory" | "undetermined";
    note?: string;
  }[];
}

/**
 * A defect in the SUPPLIED FORMALIZATION, as opposed to a finding about the
 * claims. These matter because the satisfiability check is rigorous and the
 * translation from prose into logic is not: a thin or malformed encoding
 * yields a confident "no contradiction" that is an artifact of the encoding.
 */
export interface FormalizationWarning {
  code:
    | "negation_free"
    | "pseudo_negation"
    | "isolated_predicates"
    | "no_existential_witness";
  /** `critical` = the consistency result is vacuous and must not be reported. */
  severity: "critical" | "warning";
  message: string;
  detail?: string[];
}

/** Strip quantifier keywords and grab predicate / propositional symbols. */
function symbolsOf(formula: string): Set<string> {
  const out = new Set<string>();
  const withoutVars = formula.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
  for (const m of withoutVars.matchAll(/\b([a-z_][a-zA-Z0-9_]*)\s*\(/g)) {
    out.add(m[1]);
  }
  // Bare propositional atoms: identifiers not followed by "(" .
  for (const m of withoutVars.matchAll(/\b([a-z_][a-zA-Z0-9_]*)\b(?!\s*\()/g)) {
    if (!["all", "exists"].includes(m[1])) out.add(m[1]);
  }
  return out;
}

/** True if the formula uses a real negation operator (not the "->" arrow). */
function hasNegation(formula: string): boolean {
  return /~/.test(formula) || /-(?!>)/.test(formula);
}

/**
 * analyzeFormalization — catch encodings that cannot express a contradiction.
 *
 * Motivated by a real run: every block was submitted with negation expressed as
 * a NAME (`not_travel`, `not_distribution_bound`) rather than the `-` operator.
 * To a theorem prover `not_travel` and `travels` are unrelated symbols, so the
 * set was trivially satisfiable and the tool reported "no contradiction" about
 * a corpus containing a verified one.
 *
 * The `negation_free` check is not a heuristic. A first-order set containing no
 * negation is satisfiable by construction — interpret every predicate as true
 * everywhere and every atom, implication, conjunction and universal is
 * satisfied. So "consistent" carries exactly zero information about the claims.
 */
export function analyzeFormalization(
  blocks: LogicalBlock[],
): FormalizationWarning[] {
  const warnings: FormalizationWarning[] = [];
  const allFormulas = blocks.flatMap((b) => b.propositions);
  if (allFormulas.length === 0) return warnings;

  // 1) No negation anywhere ⇒ satisfiability is a theorem, not a finding.
  if (!allFormulas.some(hasNegation)) {
    warnings.push({
      code: "negation_free",
      severity: "critical",
      message:
        "No formula contains a negation. A negation-free first-order set is ALWAYS satisfiable " +
        "(interpret every predicate as true everywhere), so 'no contradiction' here is a property " +
        "of the encoding, not of the claims. Re-encode using the '-' operator — e.g. '-travels(x)' " +
        "rather than a predicate named 'not_travels'.",
    });
  }

  // 2) Negation smuggled into predicate names.
  const symbolsByBlock = blocks.map((b) => ({
    name: b.name,
    symbols: new Set(b.propositions.flatMap((p) => [...symbolsOf(p)])),
  }));
  const allSymbols = new Set(symbolsByBlock.flatMap((s) => [...s.symbols]));
  const pseudo: string[] = [];
  for (const sym of allSymbols) {
    const m = /^(not|non|no)_(.+)$/.exec(sym);
    if (!m) continue;
    const base = m[2];
    for (const other of allSymbols) {
      if (other === sym) continue;
      if (other === base || other.startsWith(base) || base.startsWith(other)) {
        pseudo.push(`${sym} vs ${other}`);
        break;
      }
    }
  }
  if (pseudo.length > 0) {
    warnings.push({
      code: "pseudo_negation",
      severity: "critical",
      message:
        "Negation appears to be encoded in predicate NAMES. These are unrelated symbols to the " +
        "prover — nothing connects them, so they can never contradict. Use the '-' operator.",
      detail: pseudo,
    });
  }

  /*
   * 3) Universals with no witness — satisfiable by the empty world.
   *
   * `all x (P(x) -> Q(x))` is true when nothing is a P. A submission made
   * entirely of universal conditionals, with no `exists` and no ground atom to
   * populate the domain, is therefore satisfied by interpreting every
   * predicate as empty — and "no contradiction" says nothing about the claims.
   *
   * This is not hypothetical. A live submission with correct negation, shared
   * predicates and genuinely interacting blocks returned a clean bill from the
   * empty model; re-submitting the SAME blocks with `exists x (capability(x))`
   * and `exists x (disposition(x))` added exposed two real frustrations, one
   * of them a flat pairwise contradiction. None of the other checks here fire
   * on that input, which is why this one exists.
   */
  const hasExistential = allFormulas.some((f) => /\bexists\b/.test(f));
  const hasUniversal = allFormulas.some((f) => /\ball\b/.test(f));
  // A ground atom — a predicate applied to something that is not a bound
  // variable — also forces a non-empty extension.
  const hasGroundAtom = allFormulas.some(
    (f) =>
      !/\b(all|exists)\b/.test(f) &&
      /[a-z_][a-zA-Z0-9_]*\s*\(/.test(f),
  );
  if (hasUniversal && !hasExistential && !hasGroundAtom) {
    warnings.push({
      code: "no_existential_witness",
      severity: "critical",
      message:
        "Every formula is universally quantified and nothing asserts that anything exists. " +
        "The empty interpretation — every predicate false everywhere — satisfies all of them, " +
        "so 'no contradiction' is a property of the encoding rather than of the claims. " +
        "Add a witness to each block whose subject matter is supposed to be non-empty, " +
        "e.g. 'exists x (capability(x))' alongside 'all x (capability(x) -> travels(x))'.",
    });
  }

  // 4) Blocks that share no vocabulary cannot interact logically.
  const isolated: string[] = [];
  for (const a of symbolsByBlock) {
    const overlaps = symbolsByBlock.some(
      (b) => b.name !== a.name && [...a.symbols].some((s) => b.symbols.has(s)),
    );
    if (!overlaps) isolated.push(a.name);
  }
  if (isolated.length > 0 && symbolsByBlock.length > 1) {
    warnings.push({
      code: "isolated_predicates",
      severity: "warning",
      message:
        "These blocks share no predicate symbols with any other block, so no contradiction " +
        "involving them is expressible. Either they are genuinely unrelated, or the same idea " +
        "was named differently in different blocks.",
      detail: isolated,
    });
  }

  return warnings;
}

export interface LogicalCohomologyOptions {
  /**
   * Highest subset size to test. 3 reproduces the old triples-only behaviour;
   * 4 catches Bell-shaped frustrations (any three assumptions compatible, all
   * four impossible). Cost is bounded by the clique pruning and by `maxChecks`.
   */
  maxArity?: number;
  /** Hard cap on satisfiability calls, since each is a Prover9/Mace4 run. */
  maxChecks?: number;
}

export const DEFAULT_COHOMOLOGY_OPTIONS: Required<LogicalCohomologyOptions> = {
  maxArity: 4,
  maxChecks: 400,
};

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

      if (result === "model_found") {
        /*
         * mcp-logic reports when the only model it found is the EMPTY WORLD —
         * every predicate false everywhere. A set of universally quantified
         * conditionals is satisfied vacuously there, so "consistent" carries
         * no information about the claims. That signal was being discarded.
         *
         * Observed live: a submission of pure `all x (P(x) -> Q(x))` blocks
         * with correct negation and shared predicates returned "no
         * contradiction" from the empty model; adding `exists x (P(x))`
         * witnesses to the same blocks exposed two real frustrations.
         */
        const vacuous =
          parsed?.model?.vacuity?.is_vacuous === true ||
          typeof parsed?.warning === "string";
        return vacuous
          ? { consistent: true, note: "VACUOUS: satisfied only by the empty world" }
          : { consistent: true };
      }
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
  options: LogicalCohomologyOptions = {},
): Promise<LogicalCohomologyResult> {
  const opts = { ...DEFAULT_COHOMOLOGY_OPTIONS, ...options };
  const checkFailures: string[] = [];
  const internallyInconsistent: string[] = [];
  const checkLog: LogicalCohomologyResult["checkLog"] = [];

  const verdictOf = (c: boolean | null) =>
    c === true ? "consistent" : c === false ? "contradictory" : "undetermined";

  // 1) Internal consistency — "self-consistent tautologies" first.
  const vertices: string[] = [];
  const propsOf = new Map(blocks.map((b) => [b.name, b.propositions]));
  for (const b of blocks) {
    const r = await sat(b.propositions);
    checkLog.push({
      kind: "internal", blocks: [b.name], formulas: b.propositions,
      verdict: verdictOf(r.consistent), note: r.note,
    });
    if (r.consistent === true) vertices.push(b.name);
    else if (r.consistent === false) internallyInconsistent.push(b.name);
    else checkFailures.push(`internal(${b.name}): ${r.note ?? "unknown"}`);
  }

  // 2) Layered search for MINIMAL unsatisfiable subsets, arity 2..maxArity.
  //
  //    A k-set is tested only once every one of its (k-1)-faces is known
  //    consistent. That single rule does three jobs at once:
  //      - it is the downward-closure prune (a set containing an inconsistent
  //        subset cannot be consistent, so testing it is wasted work);
  //      - it guarantees MINIMALITY of everything reported — if all proper
  //        subsets are consistent and the set is not, the set is a MUS;
  //      - it generalises the old pair→triangle clique test to any arity.
  //
  //    This is what actually detects contradictions. The homology below is a
  //    summary computed from the same data, and — see the `h1` docs — it is
  //    pinned to 0 for most realistic block counts, which is why it must not
  //    be the thing anyone reads.
  const consistentPairs: [string, string][] = [];
  const filledTriangles: [string, string, string][] = [];
  const frustrations: Frustration[] = [];

  const keyOf = (names: string[]) => [...names].sort().join("|");
  /** Sets of size k known consistent, keyed by sorted join. */
  let previousLevel: string[][] = vertices.map((v) => [v]);
  let consistentKeys = new Set<string>(previousLevel.map(keyOf));

  let checksPerformed = 0;
  let searchedToArity = 1;
  let budgetExhausted = false;

  for (let k = 2; k <= Math.max(2, opts.maxArity); k++) {
    const candidates: string[][] = [];
    const seen = new Set<string>();

    // Build k-candidates by extending each consistent (k-1)-set with a vertex
    // that sorts after its last member, then require every face to be present.
    for (const base of previousLevel) {
      for (const v of vertices) {
        if (base.includes(v)) continue;
        const cand = [...base, v].sort();
        const ck = keyOf(cand);
        if (seen.has(ck)) continue;
        seen.add(ck);
        const facesConsistent = cand.every((omit) =>
          consistentKeys.has(keyOf(cand.filter((x) => x !== omit))),
        );
        if (facesConsistent) candidates.push(cand);
      }
    }

    if (candidates.length === 0) break;
    if (checksPerformed + candidates.length > opts.maxChecks) {
      budgetExhausted = true;
      break;
    }

    const nextLevel: string[][] = [];
    const nextKeys = new Set<string>();
    for (const set of candidates) {
      const fs = set.flatMap((n) => propsOf.get(n)!);
      const r = await sat(fs);
      checksPerformed++;
      checkLog.push({
        kind: k === 2 ? "pair" : k === 3 ? "triple" : "set",
        blocks: set,
        formulas: fs,
        verdict: verdictOf(r.consistent),
        note: r.note,
      });

      if (r.consistent === true) {
        nextLevel.push(set);
        nextKeys.add(keyOf(set));
        if (k === 2) consistentPairs.push([set[0], set[1]]);
        if (k === 3) filledTriangles.push([set[0], set[1], set[2]]);
      } else if (r.consistent === false) {
        // Every proper subset was consistent, so this set is minimal.
        frustrations.push({ blocks: set, arity: k });
      } else {
        checkFailures.push(`set(${set.join(",")}): ${r.note ?? "unknown"}`);
      }
    }

    searchedToArity = k;
    previousLevel = nextLevel;
    for (const nk of nextKeys) consistentKeys.add(nk);
    if (nextLevel.length === 0) break;
  }

  const pairSet = new Set(consistentPairs.map(([a, b]) => key2(a, b)));
  void pairSet;
  const frustratedTriples = frustrations
    .filter((f) => f.arity === 3)
    .map((f) => f.blocks as [string, string, string]);

  // The search is exhaustive only if it was not cut short by either cap.
  const searchTruncated =
    budgetExhausted ||
    (searchedToArity < vertices.length && searchedToArity >= opts.maxArity);

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

  const hasContradiction = frustrations.length > 0;
  const formalizationWarnings = analyzeFormalization(blocks);

  /*
   * Runtime vacuity: the static check above catches "all universals, no
   * witness" from the text alone, but the prover can also report that the only
   * model it found was the empty world for subtler reasons. Promote that into
   * a formalization warning so a clean verdict built entirely on empty models
   * cannot be reported as a finding.
   */
  const vacuousChecks = checkLog.filter(
    (c) => c.verdict === "consistent" && (c.note ?? "").startsWith("VACUOUS"),
  );
  if (
    !hasContradiction &&
    vacuousChecks.length > 0 &&
    vacuousChecks.length === checkLog.filter((c) => c.verdict === "consistent").length
  ) {
    formalizationWarnings.push({
      code: "no_existential_witness",
      severity: "critical",
      message:
        `All ${vacuousChecks.length} satisfiability checks were satisfied ONLY by the empty world ` +
        "(every predicate false everywhere). The prover flagged each one as vacuous. " +
        "Nothing here was actually tested — assert existence for the entities your " +
        "conditionals quantify over and re-run.",
      detail: vacuousChecks.slice(0, 5).map((c) => c.blocks.join("+")),
    });
  }
  // A vacuous result is one where "consistent" was guaranteed by the encoding.
  // Finding a contradiction anyway means the encoding was expressive enough
  // after all, so vacuity only applies to a clean verdict.
  const resultIsVacuous =
    !hasContradiction &&
    formalizationWarnings.some((w) => w.severity === "critical");
  const h1Note =
    hasContradiction && h1 === 0
      ? `H1 is 0 but ${frustrations.length} minimal unsatisfiable subset(s) were found. ` +
        "This is expected, not a discrepancy: with 4 or more blocks the other filled " +
        "simplices span the cycle space and cancel the obstruction, and H1 cannot see " +
        "frustrations above arity 3 at all. Read `frustrations`, not `h1`."
      : undefined;

  return {
    hasContradiction,
    frustrations,
    formalizationWarnings,
    resultIsVacuous,
    h0, h1, hasObstruction: h1 > 0, h1Note,
    vertices, internallyInconsistent, consistentPairs, frustratedTriples,
    searchedToArity, searchTruncated, checksPerformed,
    rankD1, rankD2, checkFailures, checkLog,
  };
}
