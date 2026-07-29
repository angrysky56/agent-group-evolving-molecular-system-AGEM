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

import type { PredicateAliasSuggestion } from "./predicate-aliases.js";

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
  /**
   * The minimal set of individual PROPOSITIONS responsible for the clash,
   * with the block each came from.
   *
   * Naming the blocks tells you *that* three positions cannot co-exist; it does
   * not tell you which of their claims does the damage. A block with five
   * formulas contributes all five to the report and only one or two to the
   * contradiction. This narrows it to the formulas that are actually load
   * bearing — every one of them is necessary, and dropping any restores
   * satisfiability.
   *
   * Absent when core extraction was disabled or ran out of budget.
   */
  core?: Array<{ block: string; formula: string }>;
  /**
   * Set when the core could not be fully minimised — the budget ran out, or a
   * satisfiability check came back undetermined and the formula was kept
   * rather than wrongly discarded. The listed core is then an over-approximation.
   */
  coreTruncated?: boolean;
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
  /** True only when every MUS has been ruled in or out. */
  frustrationsComplete: boolean;
  /** Explains why only a partial MUS set is available. */
  frustrationSearchNote?: string;
  /**
   * Defects in the SUPPLIED FORMALIZATION. A `critical` entry means the
   * consistency verdict is an artifact of the encoding and says nothing about
   * the claims — see `resultIsVacuous`.
   */
  formalizationWarnings: FormalizationWarning[];
  /** Deterministic syntax-only rewrites applied before validation/proving. */
  formalizationRepairs?: string[];
  /**
   * True when a critical formalization defect invalidates the overall verdict.
   * A found MUS remains evidence, but alias/arity defects can hide additional
   * MUSes; without a MUS, do not report a clean bill of health.
   */
  resultIsVacuous: boolean;
  /** True when static defects stopped the run before the first prover call. */
  preflightAborted: boolean;

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
  /** Connected components of the full non-logical symbol overlap graph. */
  signatureComponents: string[][];
  /** Audited aliases applied before this search. */
  predicateAliases: Record<string, string>;
  /** Similarity candidates that were reported but deliberately not applied. */
  predicateAliasSuggestions: PredicateAliasSuggestion[];
  /** Blocks dropped because their own propositions were self-contradictory. */
  internallyInconsistent: string[];
  /** Blocks not internally checked because the hard oracle-call budget ended. */
  uncheckedBlocks: string[];
  consistentPairs: [string, string][];
  /** Compatibility view of `frustrations` filtered to arity 3. */
  frustratedTriples: [string, string, string][];

  /** Highest arity actually searched. */
  searchedToArity: number;
  /** True if the search stopped at a cap rather than exhausting the lattice —
   * i.e. frustrations of higher arity have NOT been ruled out. */
  searchTruncated: boolean;
  /**
   * Set when the check budget stopped the search: the total `maxChecks` that
   * would have been needed to complete the next level. Re-running with at least
   * this budget answers the question the truncated run left open.
   */
  checksRequiredForNextLevel?: number;
  /**
   * Set whenever `searchTruncated` is true — says which cap stopped the search
   * and what to change. Mirrors `h1Note`: a bare boolean has repeatedly been
   * read as "the tool cannot go further" when it means "it was not asked to".
   */
  truncationNote?: string;
  /** Number of satisfiability checks performed. */
  checksPerformed: number;
  /** Positive certificate for the monotonicity shortcut. */
  fullSetCertificate?: { modelFound: true; domainSize?: number };
  /** True when a complete 2-skeleton lets us derive homology without matrices. */
  homologyDerivedAnalytically: boolean;

  rankD1: number;
  rankD2: number;
  /** mcp-logic calls that errored (parse failures etc.) — surfaced, not hidden. */
  checkFailures: string[];
  /** Per-check audit trail for explainability: every satisfiability test run,
   * what it tested, and the verdict. The mcp-logic calls happen inside the
   * engine, so this is how they become inspectable rather than opaque.
   *
   * This is the ENGINE-side log and it is complete. It is deliberately NOT
   * what goes into the model's context — see `summarizeCheckLog`. */
  checkLog: CheckLogEntry[];
}

/** One satisfiability test: what was tested, and what the prover said. */
export interface CheckLogEntry {
  kind: "internal" | "pair" | "triple" | "set" | "core-probe" | "core";
  blocks: string[];
  formulas: string[];
  verdict: "consistent" | "contradictory" | "undetermined";
  note?: string;
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
    | "no_existential_witness"
    | "inconsistent_arity"
    | "predicate_aliasing_suspected"
    | "disjoint_predicates";
  /** `critical` = the overall consistency/completeness verdict is invalid. */
  severity: "critical" | "warning";
  message: string;
  detail?: string[];
}

/** Keywords that look like a symbol applied to arguments but are not. */
const QUANTIFIER_WORDS: ReadonlySet<string> = new Set(["all", "exists"]);

/**
 * The predicates a block quantifies OVER, as opposed to those it predicates.
 *
 * In `all x (assignment(x) -> arbitrary(x))` the subject is `assignment` and
 * the property is `arbitrary`. Two blocks meet only if their subjects meet:
 * agreeing on a property name while quantifying over different subjects leaves
 * their models independent, so no contradiction can arise. Ground atoms have no
 * antecedent, so the atom's own symbol counts as its subject.
 */
function subjectSymbols(formulas: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const formula of formulas) {
    const implication = formula.indexOf("->");
    const head = implication >= 0 ? formula.slice(0, implication) : formula;
    /*
     * Strip the quantifier and its variable first. Without this, "all x (p(x)"
     * matches `x (` and captures the bound VARIABLE as a symbol — so every
     * quantified block appears to share `x` with every other and the check can
     * never fire. That is how this shipped broken the first time.
     */
    const bare = head.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
    for (const [, symbol] of bare.matchAll(/\b([a-z_][A-Za-z0-9_]*)\s*\(/g)) {
      if (!QUANTIFIER_WORDS.has(symbol)) out.add(symbol);
    }
  }
  return out;
}

/** Strip quantifier keywords and grab predicate / propositional symbols. */
function symbolsOf(formula: string): Set<string> {
  const out = new Set<string>();
  const withoutVars = formula.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
  for (const m of withoutVars.matchAll(/\b([a-z_][a-zA-Z0-9_]*)\s*\(/g)) {
    out.add(m[1]);
  }
  // When predicate applications are present, identifiers inside their
  // argument lists are variables/constants, not additional predicate symbols.
  if (out.size > 0) return out;
  // Bare propositional atoms: identifiers not followed by "(" .
  for (const m of withoutVars.matchAll(/\b([a-z_][a-zA-Z0-9_]*)\b(?!\s*\()/g)) {
    if (!["all", "exists"].includes(m[1])) out.add(m[1]);
  }
  return out;
}

function signatureComponentsOf(
  vertices: readonly string[],
  propsOf: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const signatures = new Map(
    vertices.map((name) => [
      name,
      new Set((propsOf.get(name) ?? []).flatMap((formula) => [...symbolsOf(formula)])),
    ]),
  );
  const remaining = new Set(vertices);
  const components: string[][] = [];
  for (const start of vertices) {
    if (!remaining.delete(start)) continue;
    const component = [start];
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentSymbols = signatures.get(current)!;
      for (const candidate of [...remaining]) {
        if (
          ![...currentSymbols].some((symbol) =>
            signatures.get(candidate)!.has(symbol),
          )
        ) {
          continue;
        }
        remaining.delete(candidate);
        component.push(candidate);
        queue.push(candidate);
      }
    }
    components.push(component);
  }
  return components;
}

/** True if the formula uses a real negation operator (not the "->" arrow). */
function hasNegation(formula: string): boolean {
  return /~/.test(formula) || /-(?!>)/.test(formula);
}

/**
 * Canonicalise attributed property assertions as predicates.
 *
 * `holds(fdt, lesion_adequate)` reifies `lesion_adequate` as a constant (arity
 * zero), which collides with `lesion_adequate(x)` in Prover9's shared symbol
 * namespace. Assertion context already lives in the containing claim block, so
 * the wrapper is redundant. This rewrite is purely syntactic and never merges
 * meanings: `holds(entity, property)` becomes `property(entity)`.
 */
export function normalizePropertyPredication(formula: string): string {
  return formula.replace(
    /\bholds\(\s*([a-z_][A-Za-z0-9_]*)\s*,\s*([a-z_][A-Za-z0-9_]*)\s*\)/g,
    (_match, entity: string, property: string) => `${property}(${entity})`,
  );
}

function normalizePropertyPredicationBlocks(blocks: LogicalBlock[]): {
  blocks: LogicalBlock[];
  repairs: string[];
} {
  const repairs: string[] = [];
  return {
    blocks: blocks.map((block) => ({
      ...block,
      propositions: block.propositions.map((formula) => {
        const normalized = normalizePropertyPredication(formula);
        if (normalized !== formula) {
          repairs.push(`${block.name}: ${formula} => ${normalized}`);
        }
        return normalized;
      }),
    })),
    repairs,
  };
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

  /*
   * A symbol used with two different argument counts anywhere in the submitted
   * set is not valid first-order logic, and Prover9 rejects the whole set.
   *
   * This local set-level check runs before the remote validator or prover. It
   * includes constants used as arguments (arity zero), which is what exposes a
   * property reified inside `holds(x, property)` and predicated elsewhere.
  */
  {
    const collectArities = (block: LogicalBlock) => {
      const arities = new Map<string, Set<number>>();
      for (const formula of block.propositions) {
        const boundVariables = new Set(
          [...formula.matchAll(/\b(?:all|exists)\s+([a-zA-Z_][\w]*)/g)].map(
            (match) => match[1],
          ),
        );
        for (const [, symbol, args] of formula.matchAll(
          /\b([a-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g,
        )) {
          if (QUANTIFIER_WORDS.has(symbol)) continue;
          const arity = args.trim() === "" ? 0 : args.split(",").length;
          if (!arities.has(symbol)) arities.set(symbol, new Set());
          arities.get(symbol)!.add(arity);
          for (const argument of args.split(",").map((value) => value.trim())) {
            if (
              /^[a-z_][A-Za-z0-9_]*$/.test(argument) &&
              !boundVariables.has(argument)
            ) {
              if (!arities.has(argument)) arities.set(argument, new Set());
              arities.get(argument)!.add(0);
            }
          }
        }
      }
      return arities;
    };
    const usages = blocks.map((block) => ({
      block,
      arities: collectArities(block),
    }));
    const locallyClashing = new Set<string>();
    for (const { block, arities } of usages) {
      const clashes = [...arities.entries()].filter(([, set]) => set.size > 1);
      if (clashes.length === 0) continue;
      for (const [symbol] of clashes) locallyClashing.add(symbol);
      warnings.push({
        code: "inconsistent_arity",
        severity: "critical",
        message:
          `Block "${block.name}" uses ${clashes.length} symbol(s) with more than ` +
          "one argument count. That is not well-formed first-order logic and the " +
          "prover rejects the submitted set. The conversion preflight stopped this " +
          "before any prover budget was spent. Give each " +
          "symbol a single fixed arity — if you need both a type and a relation, " +
          "name them differently (e.g. 'amino_acid(x)' and " +
          "'precursor_of(glutamate, glutamine)').",
        detail: clashes.map(
          ([symbol, set]) =>
            `${symbol} used with arity ${[...set].sort().join(" and ")} in ${block.name}`,
        ),
      });
    }

    const setArities = new Map<string, Set<number>>();
    const locations = new Map<string, Set<string>>();
    for (const { block, arities } of usages) {
      for (const [symbol, counts] of arities) {
        const combined = setArities.get(symbol) ?? new Set<number>();
        for (const count of counts) combined.add(count);
        setArities.set(symbol, combined);
        const blocksForSymbol = locations.get(symbol) ?? new Set<string>();
        blocksForSymbol.add(block.name);
        locations.set(symbol, blocksForSymbol);
      }
    }
    const crossBlockClashes = [...setArities.entries()].filter(
      ([symbol, counts]) => counts.size > 1 && !locallyClashing.has(symbol),
    );
    if (crossBlockClashes.length > 0) {
      warnings.push({
        code: "inconsistent_arity",
        severity: "critical",
        message:
          `Across assertion blocks, ${crossBlockClashes.length} symbol(s) use more than ` +
          "one argument count. Each block may be valid alone, but Prover9 uses one " +
          "global symbol namespace and rejects their union. The conversion preflight " +
          "stopped this before any prover budget was spent.",
        detail: crossBlockClashes.map(
          ([symbol, counts]) =>
            `${symbol} used with arity ${[...counts].sort().join(" and ")} in ` +
            `${[...(locations.get(symbol) ?? [])].sort().join(", ")}`,
        ),
      });
    }
  }

  /*
   * Blocks that share no predicate symbol cannot contradict each other.
   *
   * Two formula sets over disjoint vocabularies are always jointly satisfiable
   * — interpret each block's symbols independently and both are satisfied. So
   * a "no contradiction" verdict across such a pair is a property of the
   * encoding, exactly like the negation-free case, and carries no information
   * about the claims.
   *
   * This is the failure that survived the paraphrase fix. A run encoded
   * Frozen Accident as
   *     all x (allocation_of_particular_codons_to_particular_amino_acids(x) -> arbitrary(x))
   * and Stereochemical Affinity as
   *     all x (assignment(x) -> -arbitrary(x))
   * Both quantify over corpus entities and both use `-`, so every existing
   * check passed — but nothing forces anything to be both an `allocation...`
   * and an `assignment`, so the two positions could not collide whatever the
   * corpus said. Sharing `arbitrary` is not enough: the SUBJECT predicates
   * must meet.
   */
  const subjectsByBlock = blocks.map((block) => ({
    name: block.name,
    subjects: subjectSymbols(block.propositions),
    /*
     * Only blocks that introduce their OWN witnesses can drift apart.
     *
     * `p(x)`, `p(x) -> q(x)`, `-q(x)` share no subject either, yet they are a
     * real contradiction — the free variable ranges over the same individuals
     * in every block, so the chain closes. What makes the genetic-code pair
     * inert is that each side wrote `exists x (its_own_subject(x))`: the prover
     * can satisfy both by choosing different witnesses, and no amount of shared
     * property vocabulary forces them to meet.
     *
     * So the defect is specifically: a block that populates a private domain
     * over a subject predicate nobody else quantifies. Requiring an existential
     * here is what keeps the check from firing on the classic frustrated
     * triple, which it did on the first attempt.
     */
    introducesOwnWitness: block.propositions.some((f) => /\bexists\b/.test(f)),
  }));
  const evaluated = subjectsByBlock.filter((b) => b.subjects.size > 0);
  const disconnectedBlocks = evaluated.filter(
    (block) =>
      block.introducesOwnWitness &&
      evaluated.every(
        (other) =>
          other.name === block.name ||
          [...block.subjects].every((s) => !other.subjects.has(s)),
      ),
  );
  if (evaluated.length > 1 && disconnectedBlocks.length > 0) {
    warnings.push({
      code: "disjoint_predicates",
      severity: "critical",
      message:
        `${disconnectedBlocks.length} block(s) share no SUBJECT predicate with any other ` +
        "block. Formula sets over disjoint vocabularies are jointly satisfiable " +
        "by construction, so those blocks cannot contradict anything and a " +
        "clean verdict involving them says nothing about the claims. Where two " +
        "positions disagree about the same thing, they must quantify over the " +
        "same predicate — write 'all x (assignment(x) -> arbitrary(x))' against " +
        "'all x (assignment(x) -> -arbitrary(x))', not two differently-named " +
        "subjects that happen to share a property symbol.",
      detail: disconnectedBlocks.map(
        (block) =>
          `${block.name}: subjects {${[...block.subjects].sort().join(", ")}}`,
      ),
    });
  }

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
   * Conservative lexical alias detection. Embedding canonicalisation happens
   * upstream for extracted claims, but a missed merge must remain visible: two
   * spellings for one subject make a contradiction impossible by construction.
   * Only singular/plural equivalence or a single concept extended by a generic
   * type noun is flagged here; broader semantic similarity remains an audited
   * extraction concern rather than a silent rewrite.
   */
  const genericTypeTokens = new Set([
    "state",
    "type",
    "kind",
    "entity",
    "object",
    "concept",
    "property",
    "process",
    "claim",
  ]);
  const singular = (token: string) =>
    token.endsWith("ies") && token.length > 4
      ? `${token.slice(0, -3)}y`
      : token.endsWith("s") && !token.endsWith("ss") && token.length > 3
        ? token.slice(0, -1)
        : token;
  const aliasTokens = (symbol: string) => symbol.split("_").map(singular);
  const symbolsOccurIn = new Map<string, Set<string>>();
  for (const block of symbolsByBlock) {
    for (const symbol of block.symbols) {
      const names = symbolsOccurIn.get(symbol) ?? new Set<string>();
      names.add(block.name);
      symbolsOccurIn.set(symbol, names);
    }
  }
  const aliasCandidates: Array<{
    left: string;
    right: string;
    critical: boolean;
  }> = [];
  const symbolList = [...symbolsOccurIn].map(([symbol]) => symbol).sort();
  for (let i = 0; i < symbolList.length; i++) {
    for (let j = i + 1; j < symbolList.length; j++) {
      const left = symbolList[i];
      const right = symbolList[j];
      if (left.length < 5 || right.length < 5) continue;
      const leftTokens = aliasTokens(left);
      const rightTokens = aliasTokens(right);
      const exactLemma = leftTokens.join("_") === rightTokens.join("_");
      const shorter =
        leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
      const longer = shorter === leftTokens ? rightTokens : leftTokens;
      const genericExtension =
        shorter.length === 1 &&
        longer[0] === shorter[0] &&
        longer.slice(1).every((token) => genericTypeTokens.has(token));
      if (!exactLemma && !genericExtension) continue;
      const leftBlocks = symbolsOccurIn.get(left)!;
      const rightBlocks = symbolsOccurIn.get(right)!;
      const cooccurs = [...leftBlocks].some((name) => rightBlocks.has(name));
      aliasCandidates.push({ left, right, critical: !cooccurs });
    }
  }
  if (aliasCandidates.length > 0) {
    const critical = aliasCandidates.some((candidate) => candidate.critical);
    warnings.push({
      code: "predicate_aliasing_suspected",
      severity: critical ? "critical" : "warning",
      message:
        "Near-identical predicate symbols may name the same concept. The prover " +
        "treats them as unrelated, which can hide a contradiction. Review and " +
        "supply an audited alias map; no merge was applied silently.",
      detail: aliasCandidates.map(
        ({ left, right, critical: crossBlock }) =>
          `${left} vs ${right}${crossBlock ? " (different blocks)" : ""}`,
      ),
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

function formalizationWarningsWithSuggestions(
  blocks: LogicalBlock[],
  suggestions: readonly PredicateAliasSuggestion[],
): FormalizationWarning[] {
  const warnings = analyzeFormalization(blocks);
  if (suggestions.length === 0) return warnings;

  const details = suggestions.map(
    (suggestion) =>
      `${suggestion.source} -> ${suggestion.target} ` +
      `(cosine ${suggestion.similarity.toFixed(3)}; proposed canonical ` +
      `${suggestion.proposedCanonical})`,
  );
  const severity = suggestions.some(
    (suggestion) => suggestion.severity === "critical",
  )
    ? "critical"
    : "warning";
  const existing = warnings.find(
    (warning) => warning.code === "predicate_aliasing_suspected",
  );
  if (existing) {
    if (severity === "critical") existing.severity = "critical";
    existing.detail = [...new Set([...(existing.detail ?? []), ...details])];
  } else {
    warnings.push({
      code: "predicate_aliasing_suspected",
      severity,
      message:
        "Embedding similarity suggests predicate aliases, but none were " +
        "applied automatically. Review the candidates and supply an audited " +
        "ontology map before treating the consistency result as complete.",
      detail: details,
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
  /**
   * Configured arity guard. Unlike `maxArity`, this is not an explicit request
   * to stop: a small lattice that fits `maxChecks` may still auto-exhaust.
   */
  defaultMaxArity?: number;
  /**
   * Hard cap on satisfiability calls, since each is a Prover9/Mace4 run.
   *
   * This is a SAFETY VALVE against runaway cost, not a statement about what is
   * worth checking. The cap is needed because the subset lattice is 2^n and the
   * face-pruning only bites when contradictions are actually present: in a
   * largely-consistent corpus almost every subset survives pruning, so cost
   * approaches the full lattice.
   *
   * Set it high enough that realistic corpora finish. A level is all-or-nothing
   * (see the search loop), so a budget that lands mid-level silently downgrades
   * the answer from "no higher-order frustration" to "did not look" — which is
   * exactly the failure this default is sized to avoid. Cost to complete arity 4
   * on a fully-consistent corpus: ~1.1k checks at 13 blocks, ~2.5k at 16,
   * ~6.2k at 20.
   */
  maxChecks?: number;
  /**
   * Narrow each frustration to the individual propositions responsible.
   * Costs roughly one extra check per formula in the frustrated blocks.
   */
  extractCores?: boolean;
  /** Per-frustration budget for core extraction. */
  maxCoreChecks?: number;
  /** Test/debug path: bypass monotonicity shortcuts and enumerate the lattice. */
  forceExhaustive?: boolean;
  /** Audited alias map already applied by the extraction pipeline. */
  predicateAliases?: Readonly<Record<string, string>>;
  /** Embedding candidates surfaced for audit but not applied to formulas. */
  predicateAliasSuggestions?: readonly PredicateAliasSuggestion[];
  /**
   * User-facing pipeline gate: stop before the first expensive prover call
   * when static analysis finds a critical encoding defect.
   */
  abortOnCriticalFormalization?: boolean;
}

export const DEFAULT_COHOMOLOGY_OPTIONS: Required<LogicalCohomologyOptions> = {
  maxArity: 6,
  defaultMaxArity: 6,
  // Was 400, which completed arity 3 for a 10-15 block corpus and then stopped
  // one level short — so the arity-4 search this engine exists to run never
  // actually ran on a real corpus, while the tool contract advertised it.
  maxChecks: 50_000,
  extractCores: true,
  maxCoreChecks: 60,
  forceExhaustive: false,
  predicateAliases: {},
  predicateAliasSuggestions: [],
  abortOnCriticalFormalization: false,
};

/** Keep operator defaults distinct from a caller-requested hard arity cap. */
export function configuredCohomologyOptions(config: {
  LOGIC_MAX_ARITY: number;
  LOGIC_MAX_CHECKS: number;
}): LogicalCohomologyOptions {
  return {
    defaultMaxArity: config.LOGIC_MAX_ARITY,
    maxChecks: config.LOGIC_MAX_CHECKS,
  };
}

/** A satisfiability oracle: true = consistent, false = contradictory.
 * `null` means the check could not be completed (parse error / real timeout). */
export type SatOracle = (
  formulas: string[],
) => Promise<{ consistent: boolean | null; note?: string; domainSize?: number }>;

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
        const domainSize = Number(parsed?.model?.domain_size);
        const certificate = Number.isFinite(domainSize) ? { domainSize } : {};
        return vacuous
          ? {
              consistent: true,
              note: "VACUOUS: satisfied only by the empty world",
              ...certificate,
            }
          : { consistent: true, ...certificate };
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

function graphBoundaryRank(
  vertices: readonly string[],
  edges: readonly (readonly string[])[],
): { rank: number; components: number } {
  const parent = new Map(vertices.map((vertex) => [vertex, vertex]));
  const find = (vertex: string): string => {
    const current = parent.get(vertex)!;
    if (current === vertex) return vertex;
    const root = find(current);
    parent.set(vertex, root);
    return root;
  };
  for (const [left, right] of edges) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  }
  const components = new Set(vertices.map(find)).size;
  return { rank: vertices.length - components, components };
}

/**
 * Rank of d2 via sparse incremental Gaussian elimination over the reals.
 *
 * A triangle boundary starts with exactly three non-zero edge coefficients.
 * Keeping pivot columns sparse avoids the old `edges × triangles` dense matrix,
 * which exceeded two billion cells at the configured 120-block cap. The
 * existing implementation also used floating-point real rank, so this retains
 * its coefficient field and tolerance without its memory growth.
 */
function triangleBoundaryRank(
  edges: readonly (readonly string[])[],
  triangles: readonly (readonly [string, string, string])[],
  maxRank: number,
  tolerance = 1e-9,
): number {
  if (maxRank <= 0 || triangles.length === 0) return 0;
  const edgeIndex = new Map(
    edges.map((edge, index) => [`${edge[0]}|${edge[1]}`, index]),
  );
  const basis = new Map<number, Map<number, number>>();

  for (const triangle of triangles) {
    const [a, b, c] = [...triangle].sort();
    const vector = new Map<number, number>([
      [edgeIndex.get(`${b}|${c}`)!, 1],
      [edgeIndex.get(`${a}|${c}`)!, -1],
      [edgeIndex.get(`${a}|${b}`)!, 1],
    ]);

    while (vector.size > 0) {
      const pivot = Math.max(...vector.keys());
      const pivotValue = vector.get(pivot)!;
      const existing = basis.get(pivot);
      if (!existing) {
        for (const [index, value] of vector) {
          const normalized = value / pivotValue;
          if (Math.abs(normalized) < tolerance) vector.delete(index);
          else vector.set(index, normalized);
        }
        basis.set(pivot, vector);
        if (basis.size === maxRank) return basis.size;
        break;
      }

      for (const [index, value] of existing) {
        const reduced = (vector.get(index) ?? 0) - pivotValue * value;
        if (Math.abs(reduced) < tolerance) vector.delete(index);
        else vector.set(index, reduced);
      }
    }
  }
  return basis.size;
}

const key2 = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** One proposition together with the block it came from. */
export interface AttributedFormula {
  block: string;
  formula: string;
}

/**
 * extractCore — narrow an unsatisfiable formula set to a minimal core.
 *
 * Deletion-based minimisation, not combinatorial search. Try dropping each
 * formula in turn; if the remainder is still unsatisfiable the formula was not
 * needed, so drop it for good. What survives is a set in which EVERY member is
 * necessary — remove any one and the set becomes satisfiable.
 *
 * Cost is linear: one satisfiability call per formula, so a 9-formula block set
 * costs 9 calls. Enumerating subsets to arity 4 over the same 9 formulas would
 * be 255. At roughly a second per Mace4 invocation that is the difference
 * between usable and not.
 *
 * Returns ONE minimal core. There can be several independent ones; this finds
 * the first reachable by this deletion order, which is why the order is fixed
 * (input order) rather than arbitrary — the result is at least reproducible.
 *
 * Safety: an `undetermined` verdict means we could not establish that the
 * remainder is still unsatisfiable, so the formula is KEPT and the core is
 * marked truncated. Dropping on an inconclusive check would silently produce a
 * "core" that is not actually unsatisfiable.
 */
export async function extractCore(
  formulas: AttributedFormula[],
  sat: SatOracle,
  options: { maxChecks?: number } = {},
): Promise<{
  core: AttributedFormula[];
  truncated: boolean;
  checks: number;
  audit: Array<{
    formulas: AttributedFormula[];
    consistent: boolean | null;
    note?: string;
  }>;
}> {
  const maxChecks = options.maxChecks ?? 60;
  let working = [...formulas];
  let checks = 0;
  let truncated = false;
  const audit: Array<{
    formulas: AttributedFormula[];
    consistent: boolean | null;
    note?: string;
  }> = [];

  for (const candidate of [...formulas]) {
    if (working.length <= 1) break;
    if (checks >= maxChecks) {
      truncated = true;
      break;
    }
    const remainder = working.filter((f) => f !== candidate);
    if (remainder.length === 0) continue;

    const r = await sat(remainder.map((f) => f.formula));
    checks++;
    audit.push({
      formulas: remainder,
      consistent: r.consistent,
      note: r.note,
    });

    if (r.consistent === false) {
      // Still unsatisfiable without it ⇒ it was not load bearing.
      working = remainder;
    } else if (r.consistent === null) {
      truncated = true; // keep the formula; we cannot prove it redundant
    }
    // consistent === true ⇒ the formula IS necessary; keep it.
  }

  return { core: working, truncated, checks, audit };
}

/**
 * Run the full pipeline: internal-consistency → pairwise → triple checks via the
 * SatOracle, then compute H⁰/H¹ of the resulting consistency complex.
 */
export async function computeLogicalCohomology(
  blocks: LogicalBlock[],
  sat: SatOracle,
  options: LogicalCohomologyOptions = {},
): Promise<LogicalCohomologyResult> {
  const normalized = normalizePropertyPredicationBlocks(blocks);
  blocks = normalized.blocks;
  const opts = { ...DEFAULT_COHOMOLOGY_OPTIONS, ...options };
  const preflightWarnings = formalizationWarningsWithSuggestions(
    blocks,
    opts.predicateAliasSuggestions,
  );
  if (
    opts.abortOnCriticalFormalization &&
    preflightWarnings.some((warning) => warning.severity === "critical")
  ) {
    const truncationNote =
      "Formalization preflight aborted before the first prover call because " +
      "one or more critical encoding defects make the result vacuous. Repair " +
      "formalizationWarnings and re-run; no satisfiability budget was spent.";
    return {
      hasContradiction: false,
      frustrations: [],
      frustrationsComplete: false,
      frustrationSearchNote: truncationNote,
      formalizationWarnings: preflightWarnings,
      formalizationRepairs: normalized.repairs,
      resultIsVacuous: true,
      preflightAborted: true,
      h0: 0,
      h1: 0,
      hasObstruction: false,
      vertices: [],
      signatureComponents: [],
      predicateAliases: { ...opts.predicateAliases },
      predicateAliasSuggestions: [...opts.predicateAliasSuggestions],
      internallyInconsistent: [],
      uncheckedBlocks: blocks.map((block) => block.name),
      consistentPairs: [],
      frustratedTriples: [],
      searchedToArity: 0,
      searchTruncated: true,
      checksPerformed: 0,
      homologyDerivedAnalytically: false,
      rankD1: 0,
      rankD2: 0,
      checkFailures: [],
      checkLog: [],
      truncationNote,
    };
  }
  const checkFailures: string[] = [];
  const internallyInconsistent: string[] = [];
  const uncheckedBlocks: string[] = [];
  const checkLog: LogicalCohomologyResult["checkLog"] = [];
  let checksPerformed = 0;
  let budgetExhausted = false;
  let internalBudgetExhausted = false;

  const verdictOf = (c: boolean | null) =>
    c === true ? "consistent" : c === false ? "contradictory" : "undetermined";

  // 1) Internal consistency — "self-consistent tautologies" first.
  const vertices: string[] = [];
  const propsOf = new Map(blocks.map((b) => [b.name, b.propositions]));
  for (const b of blocks) {
    if (checksPerformed >= opts.maxChecks) {
      budgetExhausted = true;
      internalBudgetExhausted = true;
      uncheckedBlocks.push(b.name);
      continue;
    }
    const r = await sat(b.propositions);
    checksPerformed++;
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
  const frustrations: Frustration[] = internallyInconsistent.map((name) => ({
    blocks: [name],
    arity: 1,
  }));

  const keyOf = (names: string[]) => [...names].sort().join("|");
  /** Sets of size k known consistent, keyed by sorted join. */
  let previousLevel: string[][] = vertices.map((v) => [v]);
  let consistentKeys = new Set<string>(previousLevel.map(keyOf));

  let searchedToArity = 1;
  /** Budget the run would have needed to finish the level it stopped before. */
  let checksRequiredForNextLevel: number | undefined;
  /** Arity of the level that was skipped for want of budget. */
  let unreachedArity: number | undefined;
  if (internalBudgetExhausted) {
    searchedToArity = 0;
    unreachedArity = 1;
    // Conservative actionable rerun budget: all internal checks plus the full
    // pair level if every unchecked block proves internally consistent.
    checksRequiredForNextLevel =
      blocks.length + (blocks.length * Math.max(0, blocks.length - 1)) / 2;
  }
  let fullSetCertificate:
    | { modelFound: true; domainSize?: number }
    | undefined;
  let fullSetCertified = false;
  let twoSkeletonCertifiedComplete = false;
  let fullSetVerdict: boolean | null | undefined;

  /*
   * SAT is downward-monotone: an exhibited model of the full conjunction is a
   * model of every subset. Derive the complete 2/3-skeleton analytically rather
   * than spending one prover call per face.
   */
  if (
    !opts.forceExhaustive &&
    uncheckedBlocks.length === 0 &&
    vertices.length >= 2 &&
    checksPerformed < opts.maxChecks
  ) {
    const allFormulas = vertices.flatMap((name) => propsOf.get(name) ?? []);
    const full = await sat(allFormulas);
    fullSetVerdict = full.consistent;
    checksPerformed++;
    checkLog.push({
      kind: "set",
      blocks: [...vertices],
      formulas: allFormulas,
      verdict: verdictOf(full.consistent),
      note: full.note
        ? `${full.note}; full-set probe`
        : "full-set probe",
    });
    if (full.consistent === true) {
      fullSetCertified = true;
      twoSkeletonCertifiedComplete = true;
      fullSetCertificate = {
        modelFound: true,
        ...(full.domainSize === undefined ? {} : { domainSize: full.domainSize }),
      };
      searchedToArity = vertices.length;
      for (let i = 0; i < vertices.length; i++) {
        for (let j = i + 1; j < vertices.length; j++) {
          consistentPairs.push([vertices[i], vertices[j]]);
        }
      }
    } else if (full.consistent === null) {
      checkFailures.push(`full-set: ${full.note ?? "unknown"}`);
    }
  }

  /*
   * AUTO-EXHAUST SMALL LATTICES.
   *
   * maxArity is a cost guard, but on a small block set it costs nothing to
   * settle the question completely — and stopping early forces every caller to
   * carry a "higher-order frustrations not ruled out" caveat that need not
   * exist. Observed: a run with 6 evaluable blocks (a 64-subset lattice, budget
   * 5000) still reported truncation at arity 4.
   *
   * The bound is the number of subsets of size >= 2, which is a conservative
   * over-estimate since face-pruning only ever removes candidates. If even that
   * fits the budget, search the whole lattice.
   *
   * ONLY when maxArity was left at its default. An explicitly supplied cap is
   * an instruction — a caller asking for arity 3 wants arity 3, whether to
   * reproduce triples-only behaviour or to pin a regression. Two tests caught
   * an earlier version of this that overrode the explicit value.
   */
  const arityWasExplicit = options.maxArity !== undefined;
  const configuredMaxArity =
    options.maxArity ?? options.defaultMaxArity ?? DEFAULT_COHOMOLOGY_OPTIONS.maxArity;
  const fullLatticeUpperBound = 2 ** vertices.length - vertices.length - 1;
  const effectiveMaxArity =
    !arityWasExplicit &&
    fullLatticeUpperBound > 0 &&
    fullLatticeUpperBound <= opts.maxChecks
      ? vertices.length
      : configuredMaxArity;

  /*
   * An UNSAT full set is localised with monotone branch-and-bound MUS
   * enumeration. Deletion finds one minimal core; removing each member of that
   * core creates branches that cover every place another MUS could live. A SAT
   * branch certifies all of its subsets at once. This retains the old contract
   * (all MUSes, when the budget and oracle are conclusive) without walking the
   * entire powerset.
   */
  let usedMusEnumeration = false;
  let musEnumerationIncomplete = false;
  let frustrationSearchNote: string | undefined;
  if (
    !opts.forceExhaustive &&
    options.maxArity === undefined &&
    fullSetVerdict === false
  ) {
    usedMusEnumeration = true;
    const cache = new Map<
      string,
      { consistent: boolean | null; note?: string }
    >();
    cache.set(keyOf(vertices), { consistent: false, note: "full-set probe" });
    const knownSatSets: string[][] = [];
    const pending: string[][] = [[...vertices]];
    const scheduled = new Set<string>([keyOf(vertices)]);

    const subsetOf = (small: readonly string[], large: readonly string[]) => {
      const members = new Set(large);
      return small.every((name) => members.has(name));
    };
    const enqueueBranches = (candidate: string[], core: string[]) => {
      for (const omitted of core) {
        const child = candidate.filter((name) => name !== omitted);
        if (child.length < 2) continue;
        const key = keyOf(child);
        if (scheduled.has(key)) continue;
        scheduled.add(key);
        pending.push(child);
      }
    };
    const query = async (
      names: string[],
      note: string,
    ): Promise<{ consistent: boolean | null; note?: string } | undefined> => {
      const key = keyOf(names);
      const exact = cache.get(key);
      if (exact) return exact;
      if (knownSatSets.some((known) => subsetOf(names, known))) {
        return { consistent: true, note: "inferred from SAT superset" };
      }
      if (checksPerformed >= opts.maxChecks) {
        budgetExhausted = true;
        musEnumerationIncomplete = true;
        frustrationSearchNote =
          `MUS enumeration stopped at the maxChecks budget (${opts.maxChecks}); ` +
          "additional minimal contradictions may exist.";
        return undefined;
      }
      const formulas = names.flatMap((name) => propsOf.get(name) ?? []);
      const result = await sat(formulas);
      checksPerformed++;
      checkLog.push({
        kind: "set",
        blocks: [...names],
        formulas,
        verdict: verdictOf(result.consistent),
        note: result.note ? `${result.note}; ${note}` : note,
      });
      const cached = { consistent: result.consistent, note: result.note };
      cache.set(key, cached);
      if (result.consistent === true) knownSatSets.push([...names]);
      if (result.consistent === null) {
        musEnumerationIncomplete = true;
        frustrationSearchNote =
          "MUS enumeration encountered an undetermined oracle result; " +
          "additional minimal contradictions may exist.";
        checkFailures.push(
          `set(${names.join(",")}): ${result.note ?? "unknown"}`,
        );
      }
      return cached;
    };

    while (pending.length > 0 && !budgetExhausted) {
      const candidate = pending.pop()!;
      const containingKnown = frustrations.find((frustration) =>
        subsetOf(frustration.blocks, candidate),
      );
      if (containingKnown) {
        enqueueBranches(candidate, containingKnown.blocks);
        continue;
      }

      const candidateVerdict = await query(candidate, "MUS branch probe");
      if (!candidateVerdict || candidateVerdict.consistent !== false) continue;

      let working = [...candidate];
      let coreTruncated = false;
      for (const block of [...candidate]) {
        if (!working.includes(block) || working.length <= 1) continue;
        const remainder = working.filter((name) => name !== block);
        const verdict = await query(remainder, "block-core deletion probe");
        if (!verdict) {
          coreTruncated = true;
          break;
        }
        if (verdict.consistent === false) working = remainder;
        else if (verdict.consistent === null) coreTruncated = true;
      }

      if (coreTruncated) {
        musEnumerationIncomplete = true;
        frustrationSearchNote ??=
          "A block-level core could not be proven minimal; additional minimal " +
          "contradictions may exist.";
        break;
      }

      const coreKey = keyOf(working);
      if (!frustrations.some((frustration) => keyOf(frustration.blocks) === coreKey)) {
        frustrations.push({ blocks: working, arity: working.length });
      }
      enqueueBranches(candidate, working);
    }

    if (!musEnumerationIncomplete) {
      searchedToArity = vertices.length;
      const containsMus = (names: string[]) =>
        frustrations.some((frustration) => subsetOf(frustration.blocks, names));
      twoSkeletonCertifiedComplete = !frustrations.some(
        (frustration) => frustration.arity >= 2 && frustration.arity <= 3,
      );
      for (let i = 0; i < vertices.length; i++) {
        for (let j = i + 1; j < vertices.length; j++) {
          const pair = [vertices[i], vertices[j]];
          if (!containsMus(pair)) consistentPairs.push([pair[0], pair[1]]);
          if (!twoSkeletonCertifiedComplete) {
            for (let k = j + 1; k < vertices.length; k++) {
              const triple = [vertices[i], vertices[j], vertices[k]];
              if (!containsMus(triple)) {
                filledTriangles.push([triple[0], triple[1], triple[2]]);
              }
            }
          }
        }
      }
    }
  }

  for (
    let k = 2;
    !fullSetCertified &&
    !usedMusEnumeration &&
    uncheckedBlocks.length === 0 &&
    k <= Math.max(2, effectiveMaxArity);
    k++
  ) {
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
      // A level is all-or-nothing: exploring it partially would leave the
      // complex incomplete and the homology wrong. So stop — but record what
      // this level would have cost, so the caller learns the budget to re-run
      // with instead of just being told "truncated".
      budgetExhausted = true;
      checksRequiredForNextLevel = checksPerformed + candidates.length;
      unreachedArity = k;
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

  /*
   * 2b) Narrow each frustration to the propositions actually responsible.
   *
   * The block-level result says three positions cannot co-exist. It does not
   * say which of their claims collide, and a block routinely contributes
   * several formulas of which one matters. Deletion-based minimisation over
   * the union of the frustrated blocks' propositions answers that, at linear
   * rather than combinatorial cost.
   */
  if (opts.extractCores) {
    for (const f of frustrations) {
      const attributed: AttributedFormula[] = f.blocks.flatMap((name) =>
        (propsOf.get(name) ?? []).map((formula) => ({ block: name, formula })),
      );
      if (attributed.length === f.blocks.length) {
        f.core = attributed;
        checkLog.push({
          kind: "core",
          blocks: f.blocks,
          formulas: attributed.map((entry) => `${entry.block}: ${entry.formula}`),
          verdict: "contradictory",
          note: "minimal core inherited from one-formula-per-block MUS",
        });
        continue;
      }
      const { core, truncated, checks, audit } = await extractCore(
        attributed,
        sat,
        {
          maxChecks: Math.max(
            0,
            Math.min(opts.maxCoreChecks, opts.maxChecks - checksPerformed),
          ),
        },
      );
      checksPerformed += checks;
      f.core = core;
      if (truncated) f.coreTruncated = true;
      for (const entry of audit) {
        checkLog.push({
          kind: "core-probe",
          blocks: [...new Set(entry.formulas.map((formula) => formula.block))],
          formulas: entry.formulas.map((formula) => formula.formula),
          verdict: verdictOf(entry.consistent),
          note: entry.note
            ? `${entry.note}; core minimization check`
            : "core minimization check",
        });
      }
      checkLog.push({
        kind: "core",
        blocks: f.blocks,
        formulas: core.map((c) => `${c.block}: ${c.formula}`),
        verdict: "contradictory",
        note: truncated
          ? `minimal core (TRUNCATED — over-approximation), ${checks} checks`
          : `minimal core, ${checks} checks`,
      });
    }
  }

  const pairSet = new Set(consistentPairs.map(([a, b]) => key2(a, b)));
  void pairSet;
  const frustratedTriples = frustrations
    .filter((f) => f.arity === 3)
    .map((f) => f.blocks as [string, string, string]);

  // The search is exhaustive only if it was not cut short by either cap.
  const searchTruncated =
    musEnumerationIncomplete ||
    uncheckedBlocks.length > 0 ||
    checkFailures.length > 0 ||
    budgetExhausted ||
    (searchedToArity < vertices.length && searchedToArity >= effectiveMaxArity);

  // 4) Boundary matrices and homology.
  const edges = consistentPairs.map(([a, b]) => (a < b ? [a, b] : [b, a]));
  const expectedPairs = (vertices.length * Math.max(0, vertices.length - 1)) / 2;
  const expectedTriangles =
    (vertices.length *
      Math.max(0, vertices.length - 1) *
      Math.max(0, vertices.length - 2)) /
    6;
  const homologyDerivedAnalytically =
    twoSkeletonCertifiedComplete ||
    (edges.length === expectedPairs &&
      filledTriangles.length === expectedTriangles);
  let rankD1: number;
  let rankD2: number;
  let h0: number;
  let h1: number;
  if (homologyDerivedAnalytically) {
    // A certified complete 2-skeleton has rank(d1)=n-1 and
    // rank(d2)=C(n,2)-(n-1), whether certified by a full-set model or by a
    // complete MUS enumeration containing no pairwise/triple frustration.
    // Computing those ranks directly avoids materialising C(n,3) triangles or
    // an O(C(n,2)*C(n,3)) dense matrix at the configured 120-block cap.
    rankD1 = Math.max(0, vertices.length - 1);
    rankD2 = edges.length - rankD1;
    h0 = vertices.length === 0 ? 0 : 1;
    h1 = 0;
  } else {
    const graphRank = graphBoundaryRank(vertices, edges);
    rankD1 = graphRank.rank;
    h0 = graphRank.components;
    rankD2 = triangleBoundaryRank(
      edges,
      filledTriangles,
      edges.length - rankD1,
    );
    h1 = edges.length - rankD1 - rankD2;
  }

  const hasContradiction = frustrations.length > 0;
  const formalizationWarnings = [...preflightWarnings];
  const signatureComponents = signatureComponentsOf(vertices, propsOf);

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
  const criticalWarnings = formalizationWarnings.filter(
    (warning) => warning.severity === "critical",
  );
  // Most vacuity warnings only invalidate a clean consistency verdict: a real
  // contradiction proves those particular formulas were expressive enough.
  // Predicate alias drift and inconsistent arity are different: they can hide
  // additional contradictions even when an unrelated one was found, so the
  // overall result remains invalid until those symbol defects are audited.
  const globallyInvalidatingWarning = criticalWarnings.some(
    (warning) =>
      warning.code === "predicate_aliasing_suspected" ||
      warning.code === "inconsistent_arity",
  );
  const resultIsVacuous =
    globallyInvalidatingWarning ||
    (!hasContradiction && criticalWarnings.length > 0);
  const h1Note =
    hasContradiction && h1 === 0
      ? `H1 is 0 but ${frustrations.length} minimal unsatisfiable subset(s) were found. ` +
        "This is expected, not a discrepancy: with 4 or more blocks the other filled " +
        "simplices span the cycle space and cancel the obstruction, and H1 cannot see " +
        "frustrations above arity 3 at all. Read `frustrations`, not `h1`."
      : undefined;

  /*
   * Say WHICH cap stopped the search and what to change. `searchTruncated` on
   * its own has repeatedly been read as "the engine cannot search further",
   * when in every observed case it meant "the budget ran out one level early".
   * Those have opposite remedies, so the distinction is spelled out here.
   */
  const truncationNote = !searchTruncated
    ? undefined
    : musEnumerationIncomplete
      ? frustrationSearchNote
    : uncheckedBlocks.length > 0
      ? `Stopped during internal consistency checks: ${uncheckedBlocks.length} ` +
        `block(s) were not checked because maxChecks is ${opts.maxChecks}. ` +
        "This is a BUDGET limit, not a capability limit. " +
        `Re-run with maxChecks >= ${checksRequiredForNextLevel} to check every ` +
        "block and complete the pair level."
    : checkFailures.length > 0
      ? `${checkFailures.length} satisfiability check(s) were undetermined, so ` +
        "the search is incomplete and additional minimal contradictions may exist."
    : budgetExhausted && checksRequiredForNextLevel !== undefined
      ? `Stopped BEFORE arity ${unreachedArity}: that level needed a total budget of ` +
        `${checksRequiredForNextLevel} satisfiability checks, but maxChecks is ${opts.maxChecks}. ` +
        `This is a BUDGET limit, not a capability limit — maxArity is ${configuredMaxArity} and was ` +
        `never reached. Re-run with maxChecks >= ${checksRequiredForNextLevel} to settle it. ` +
        `Frustrations of arity > ${searchedToArity} are NOT ruled out.`
      : `Stopped at the arity cap: maxArity is ${configuredMaxArity} but there are ${vertices.length} ` +
        `blocks, so subsets of size ${configuredMaxArity + 1}..${vertices.length} were never tested. ` +
        `Re-run with a higher maxArity. Frustrations of arity > ${searchedToArity} are NOT ruled out.`;

  return {
    hasContradiction,
    frustrations,
    frustrationsComplete:
      !searchTruncated && checkFailures.length === 0,
    frustrationSearchNote,
    formalizationWarnings,
    formalizationRepairs: normalized.repairs,
    resultIsVacuous,
    preflightAborted: false,
    h0, h1, hasObstruction: h1 > 0, h1Note,
    vertices,
    signatureComponents,
    predicateAliases: { ...opts.predicateAliases },
    predicateAliasSuggestions: [...opts.predicateAliasSuggestions],
    internallyInconsistent,
    uncheckedBlocks,
    consistentPairs,
    frustratedTriples,
    searchedToArity, searchTruncated, checksRequiredForNextLevel, truncationNote,
    checksPerformed,
    fullSetCertificate,
    homologyDerivedAnalytically,
    rankD1, rankD2, checkFailures, checkLog,
  };
}

/* -------------------------------------------------------------------------- *
 * Model-facing projection of the check log.
 *
 * The engine-side `checkLog` is complete and belongs on disk. It must not be
 * what the model reads. Measured on a real 10-block run searched exhaustively
 * to arity 10: 1023 entries, 1.79 MB, ~450k tokens — 99.7% of the whole tool
 * result, and 44% of a 1M-token context window consumed by one message that
 * then sits in history for every remaining turn.
 *
 * The redundancy is total rather than incidental. Every entry re-serialises
 * the full formula text of every block in its subset, so the same 51 unique
 * formulas (2.4 KB) appeared as 1.24 MB — a factor of 512.
 *
 * Deduplicating the formulas is necessary but nowhere near sufficient: the
 * block-name arrays repeat 5120 times too, so an id-table alone still leaves
 * ~165k tokens. What actually works is answering the two different questions
 * separately:
 *
 *   "did the checks run?"      → counts. `checkLogDigest`, always exact.
 *   "what did a check say?"    → the entries that carry signal, verbatim.
 *
 * 848 `set` entries that all read "consistent" answer the first question and
 * nothing else, so they are represented by their count. Anything that could
 * change a verdict — a contradiction, an undetermined result, a vacuity note,
 * a minimal core, a per-block internal check — is kept in full. Same run
 * through this projection: 10.8 KB, ~2.7k tokens, 167x smaller, with every
 * conclusion and every caveat still present.
 *
 * Nothing is destroyed. The complete log is written to the run's JSONL by the
 * caller, and `get_check_log` reads it back on demand.
 * -------------------------------------------------------------------------- */

/** Exact counts over the complete log — never sampled, never truncated. */
export interface CheckLogDigest {
  totalChecks: number;
  byKind: Record<string, number>;
  byVerdict: Record<string, number>;
  returnedEntries: number;
  omittedEntries: number;
  /** True when even the signal-carrying entries had to be capped. */
  entriesCapped: boolean;
  note: string;
}

/** A check-log entry with its formulas replaced by `formulaTable` indices. */
export interface CompactCheckLogEntry {
  kind: CheckLogEntry["kind"];
  blocks: string[];
  formulaIds: number[];
  verdict: CheckLogEntry["verdict"];
  note?: string;
}

export interface SummarizedCheckLog {
  checkLogDigest: CheckLogDigest;
  /** Formulas referenced by the returned entries, deduplicated. */
  formulaTable: string[];
  checkLog: CompactCheckLogEntry[];
}

/** Cap on returned entries. Only bites on a corpus riddled with contradictions,
 * and the ranking below guarantees the contradictions are what survives. */
const MAX_RETURNED_CHECKLOG_ENTRIES = 200;

/**
 * Could this entry change how the verdict should be read?
 *
 * A "consistent" verdict on a subset is what the search expects to find; it is
 * evidence only in aggregate, which the digest already carries exactly. The
 * four cases below are the ones the corpus docs tell the agent to actually
 * read, so they are kept verbatim.
 */
function isSignalEntry(entry: CheckLogEntry): boolean {
  return (
    entry.verdict !== "consistent" ||
    entry.kind === "core" ||
    entry.kind === "internal" ||
    (entry.note ?? "").startsWith("VACUOUS")
  );
}

/** Lower sorts first, so a cap can never drop a contradiction to keep a
 * routine internal check. */
function signalRank(entry: CheckLogEntry): number {
  if (entry.verdict === "contradictory") return 0;
  if (entry.verdict === "undetermined") return 1;
  if ((entry.note ?? "").startsWith("VACUOUS")) return 2;
  if (entry.kind === "core") return 3;
  if (entry.kind === "internal") return 4;
  return 5;
}

/**
 * Project the complete check log into what the model should read.
 *
 * Pure. `runLogId`, when supplied, is quoted in the note so the agent can pull
 * the omitted entries with `get_check_log` instead of guessing at them.
 */
export function summarizeCheckLog(
  checkLog: readonly CheckLogEntry[],
  opts: { runLogId?: string; maxEntries?: number } = {},
): SummarizedCheckLog {
  const maxEntries = Math.max(
    1,
    opts.maxEntries ?? MAX_RETURNED_CHECKLOG_ENTRIES,
  );

  const byKind: Record<string, number> = {};
  const byVerdict: Record<string, number> = {};
  for (const entry of checkLog) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    byVerdict[entry.verdict] = (byVerdict[entry.verdict] ?? 0) + 1;
  }

  const ordered = checkLog
    .filter(isSignalEntry)
    .sort((a, b) => signalRank(a) - signalRank(b));
  const entriesCapped = ordered.length > maxEntries;
  const kept = entriesCapped ? ordered.slice(0, maxEntries) : ordered;

  const formulaTable: string[] = [];
  const formulaIndex = new Map<string, number>();
  const idOf = (formula: string): number => {
    const existing = formulaIndex.get(formula);
    if (existing !== undefined) return existing;
    const id = formulaTable.length;
    formulaTable.push(formula);
    formulaIndex.set(formula, id);
    return id;
  };

  const compact: CompactCheckLogEntry[] = kept.map((entry) => ({
    kind: entry.kind,
    blocks: entry.blocks,
    formulaIds: entry.formulas.map(idOf),
    verdict: entry.verdict,
    ...(entry.note ? { note: entry.note } : {}),
  }));

  const omitted = checkLog.length - compact.length;
  const where = opts.runLogId
    ? `get_check_log with runLogId "${opts.runLogId}"`
    : "get_check_log against this run's log id";
  const note =
    `byKind and byVerdict are EXACT counts over all ${checkLog.length} checks — ` +
    "use them to confirm a level actually ran. " +
    "Formulas are indexed into formulaTable. " +
    (omitted > 0
      ? `${omitted} entr${omitted === 1 ? "y" : "ies"} are not listed here; ` +
        (entriesCapped
          ? "that includes signal-carrying entries beyond the return cap, "
          : "all of them are routine 'consistent' subset checks already counted above, ") +
        `and every one is retrievable verbatim via ${where}. ` +
        "An entry left out is not an unexamined one — it was checked, and its " +
        "verdict is in byVerdict."
      : "Every check is listed.");

  return {
    checkLogDigest: {
      totalChecks: checkLog.length,
      byKind,
      byVerdict,
      returnedEntries: compact.length,
      omittedEntries: omitted,
      entriesCapped,
      note,
    },
    formulaTable,
    checkLog: compact,
  };
}
