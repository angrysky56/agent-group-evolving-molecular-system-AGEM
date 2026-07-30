/**
 * abductive-engine.ts — inference to the best explanation over CORPUS anomalies.
 *
 * What this is for
 * ----------------
 * Peirce's abduction takes the form:
 *
 *     The surprising fact, C, is observed.
 *     But if A were true, C would be a matter of course.
 *     Hence, there is reason to suspect that A is true.
 *
 * This module runs that inference against the material AGEM has ingested. The
 * observation is a fact about the CORPUS — an assertion its own other claims do
 * not entail, a bridge between concept communities the partition says should be
 * separate, a structural gap, an H¹ obstruction, a proved incompatibility. The
 * hypothesis is a proposed cause stated in the corpus's own vocabulary.
 *
 * What this is NOT for
 * --------------------
 * It does not diagnose AGEM. Explaining why an extractor rejected a label is
 * `extraction-repairs.ts`, which already proposes bounded, counterfactually
 * validated patches. Pointing abduction at the machine instead of the subject
 * matter produces hypotheses about the tool and none about the world, which is
 * the failure mode this header exists to prevent.
 *
 * Why the middle premise is checked, not asserted
 * -----------------------------------------------
 * "If A were true, C would be a matter of course" is the whole inference. A
 * generator that skips it emits plausible-sounding causes and calls them
 * explanations. Here it is a prover call: a candidate enters the pool only if
 * `background ∪ {A} ⊢ C`, and it is dropped if `background ∪ {A} ⊢ ⊥`. The
 * ranking then decides among candidates that have already earned their place.
 *
 * What abduction is not licensed to conclude
 * ------------------------------------------
 * Nothing. It justifies ADOPTING a hypothesis for testing — no more. The
 * output carries no verdict, is never stored as a finding, and never satisfies
 * a verification contract item. `frameAsProvisional` enforces the register.
 */

import { createHash } from "node:crypto";

/** Where an anomalous observation came from. Each has its own hard criterion. */
export type AnomalySource =
  | "unexplained-assertion"
  | "community-bridge"
  | "structural-gap"
  | "cohomology-obstruction"
  | "logical-conflict";

/**
 * A candidate surprising fact.
 *
 * `formula` is the FOL rendering the prover will be asked about. Observations
 * without one can still be surfaced and ranked, but they cannot be abduced
 * over — the middle premise is uncheckable — and are reported as such rather
 * than quietly explained anyway.
 */
export interface Observation {
  id: string;
  phenomenon: string;
  source: AnomalySource;
  /** Corpus provenance. An observation with no source segments is inadmissible. */
  segmentIds: readonly string[];
  formula?: string;
  /**
   * Constituent facts the explanation is expected to account for. Explanatory
   * depth is measured against these, so a hypothesis that covers one symptom
   * cannot outscore one that covers the whole anomaly.
   */
  constituentFormulas?: readonly string[];
  /** Signals backing the hard criterion below; carried for auditability. */
  signals?: Readonly<Record<string, number | boolean | string>>;
}

/** The verdict of the anomaly gate, with the criterion that produced it. */
export interface AnomalyAssessment {
  observation: Observation;
  isAnomalous: boolean;
  /** The deterministic criterion applied, named in full. */
  criterion: string;
  /** Why it passed or failed that criterion. */
  basis: string;
  /**
   * Set when the corpus already entails the observation. Abduction is the
   * wrong instrument here and the caller is told which one is right.
   */
  deductiveWitness?: string;
}

export interface Hypothesis {
  id: string;
  proposedCause: string;
  /** FOL rendering. Required — an unformalised cause cannot be tested. */
  formula: string;
  /** Corpus labels the hypothesis quantifies over. */
  vocabulary: readonly string[];
  /**
   * Entities the hypothesis introduces that the corpus does not contain.
   * Ockham's razor bites exactly here and nowhere else.
   */
  leapsOfFaith: readonly string[];
  provenance: "corpus-vocabulary" | "exogenous";
}

export type HypothesisStatus =
  | "candidate"
  | "refuted-incoherent"
  | "rejected-does-not-explain"
  | "undecided"
  | "best-explanation";

export interface ScoredHypothesis {
  hypothesis: Hypothesis;
  status: HypothesisStatus;
  score: number;
  /** Fraction of `constituentFormulas` the hypothesis plus background entails. */
  explanatoryDepth: number;
  entailedConstituents: readonly string[];
  unexplainedConstituents: readonly string[];
  /** Every prover result that produced this row, for audit. */
  checks: readonly AbductiveCheck[];
  /** Plain-language account of why this hypothesis scored as it did. */
  rationale: string;
}

export interface AbductiveCheck {
  kind: "matter-of-course" | "coherence" | "constituent-entailment";
  hypothesisId: string;
  goal: string;
  outcome: "proved" | "unprovable" | "error";
  detail?: string;
}

export interface AbductionResult {
  assessment: AnomalyAssessment;
  /** Empty when the observation was not anomalous. */
  ranked: readonly ScoredHypothesis[];
  best?: ScoredHypothesis;
  /** The only sentence a caller should quote as the engine's conclusion. */
  provisionalStatement: string;
  /** What would confirm or kill the leading hypothesis. Never optional. */
  testProposal: string;
  proverCalls: number;
  proverFailures: number;
  budgetExhausted: boolean;
  /**
   * Set when coherence was checked without any existence witness. The result
   * is still reported, but the reader is told the counter-abduction may have
   * been satisfied by the empty world rather than by the hypothesis being
   * compatible with anything real. See `AbductionOptions.existenceWitnesses`.
   */
  vacuityRisk?: string;
  /** Present when abduction was declined; explains what to do instead. */
  declined?: string;
}

/**
 * The prover interface. Returns "proved" when the goal follows from the
 * premises. Supplied by the caller so this module never reaches for MCP itself.
 */
export type ProofOracle = (
  premises: readonly string[],
  goal: string,
) => Promise<{ outcome: "proved" | "unprovable" | "error"; detail?: string }>;

export interface AbductionOptions {
  /**
   * Corpus claims the inference may rely on. These are the "background
   * knowledge" of the middle premise — the corpus's own asserted formulas, not
   * the model's beliefs about the world.
   */
  background: readonly string[];
  /**
   * Existence assertions for what the background's conditionals quantify over,
   * e.g. `exists x (organism(x))`.
   *
   * Without these the coherence check is worthless. A theory of universal
   * conditionals is satisfied vacuously by the empty world, so `background ∪
   * {A} ⊬ ⊥` can mean "A is coherent" or it can mean "nothing exists" — and
   * AGEM has already been misled by exactly this once: a real biosemiotics
   * contradiction returned H¹ = 0 until `exists x (organism(x))` was added,
   * whereupon the prover found it in 27 steps. A hypothesis that survives
   * counter-abduction only because the domain is empty has survived nothing.
   *
   * Empty is permitted, because a caller may have no witnesses to offer, but
   * the result records that the check was run without them.
   */
  existenceWitnesses?: readonly string[];
  oracle: ProofOracle;
  /** Hard ceiling on prover calls. Abduction is bounded search, not a crawl. */
  maxProverCalls?: number;
  /** Penalty per introduced entity. See OCKHAM_PENALTY. */
  ockhamPenalty?: number;
}

/**
 * Cost of one new entity, in units of explanatory depth.
 *
 * Depth is a fraction in [0,1], so at 0.35 a hypothesis needs to explain about
 * a third more of the anomaly to justify each entity it invents. That is the
 * "heavily penalize" of the specification made numeric — and it is a RANKING
 * weight, not a probability. It orders candidates that have all already passed
 * the matter-of-course and coherence gates; it never promotes a candidate that
 * failed one.
 */
const OCKHAM_PENALTY = 0.35;
const DEFAULT_MAX_PROVER_CALLS = 64;

/**
 * Decide whether an observation is surprising enough to abduce over.
 *
 * Every source has a criterion AGEM already computes. Nothing here is a
 * judgement call about how interesting a phenomenon feels.
 *
 * `unexplained-assertion` is the only source that needs the prover: an
 * assertion is surprising precisely when the rest of the corpus does not make
 * it a matter of course. If the corpus DOES entail it, abduction is the wrong
 * instrument and the caller is redirected to deduction with the witness.
 */
export async function assessAnomaly(
  observation: Observation,
  options: Pick<AbductionOptions, "background" | "oracle">,
): Promise<AnomalyAssessment> {
  if (observation.segmentIds.length === 0) {
    return {
      observation,
      isAnomalous: false,
      criterion: "corpus-provenance",
      basis:
        "the observation cites no source segment, so there is no corpus fact to explain",
    };
  }

  const signals = observation.signals ?? {};
  const numeric = (key: string): number | undefined =>
    typeof signals[key] === "number" ? (signals[key] as number) : undefined;

  switch (observation.source) {
    case "unexplained-assertion": {
      if (!observation.formula) {
        return {
          observation,
          isAnomalous: false,
          criterion: "background-entailment",
          basis:
            "the assertion has no formal rendering, so whether the corpus already entails it cannot be decided",
        };
      }
      const check = await options.oracle(
        options.background,
        observation.formula,
      );
      if (check.outcome === "proved") {
        return {
          observation,
          isAnomalous: false,
          criterion: "background-entailment",
          basis:
            "the rest of the corpus already entails this assertion, so it is a matter of course, not a surprise",
          deductiveWitness: check.detail ?? "proved from corpus background",
        };
      }
      return {
        observation,
        isAnomalous: true,
        criterion: "background-entailment",
        basis:
          check.outcome === "error"
            ? "the prover could not decide whether the corpus entails this assertion; treated as not established"
            : "the corpus asserts this but its other claims do not entail it",
      };
    }
    case "structural-gap": {
      const modularityDelta = numeric("modularityDelta") ?? 0;
      const density = numeric("density") ?? 1;
      const threshold = numeric("densityThreshold") ?? 0.2;
      const anomalous = modularityDelta > 0 && density < threshold;
      return {
        observation,
        isAnomalous: anomalous,
        criterion: "gap-detector (modularityDelta > 0 and density < threshold)",
        basis: anomalous
          ? `separating these communities raises modularity by ${modularityDelta} while inter-community density is only ${density}`
          : `modularityDelta ${modularityDelta} / density ${density} does not meet the gap criterion`,
      };
    }
    case "community-bridge": {
      const links = numeric("links") ?? 0;
      const mean = numeric("meanInterCommunityLinks") ?? 0;
      const factor = numeric("factor") ?? 2;
      const anomalous = mean > 0 && links >= mean * factor;
      return {
        observation,
        isAnomalous: anomalous,
        criterion: `bridge strength (links >= ${factor}x mean inter-community links)`,
        basis: anomalous
          ? `${links} links against a mean of ${mean}: the partition says these communities are distinct, yet they are heavily joined`
          : `${links} links against a mean of ${mean} is not an outlying bridge`,
      };
    }
    case "cohomology-obstruction": {
      const h1 = numeric("h1") ?? 0;
      return {
        observation,
        isAnomalous: h1 > 0,
        criterion: "sheaf cohomology (H¹ > 0)",
        basis:
          h1 > 0
            ? `H¹ = ${h1}: local agreements do not glue into a global section`
            : "H¹ = 0: no obstruction to explain",
      };
    }
    case "logical-conflict": {
      const kind = String(signals.verdictKind ?? "");
      /*
       * Mirrors `ClaimVerdictKind` in claim-blocks.ts. Keep the two in step.
       *
       * `mixed` belongs here and is easy to miss. It means several conflict
       * kinds were found at once, so no finding is stored and a human is left
       * to interpret — which makes it the verdict MOST in need of a candidate
       * explanation, not the one to skip. An earlier version of this gate
       * omitted it and silently answered "not anomalous" to the hardest case
       * the engine can produce.
       */
      const conflictKinds = new Set([
        "corpus-contradiction",
        "position-contradiction",
        "positions-incompatible",
        "mixed",
      ]);
      const anomalous = conflictKinds.has(kind);
      /*
       * Frustration arity distinguishes a pairwise clash from an n-ary joint
       * incompatibility ("no position can hold all of A, B, and C"). The two
       * want different explanations: a pair suggests one disputed predicate,
       * a triple-or-wider suggests a constraint no single position violates
       * alone. Pass `arity` in signals and it is reported here.
       */
      const arity =
        typeof signals.arity === "number" ? signals.arity : undefined;
      const shape =
        arity === undefined
          ? ""
          : arity >= 3
            ? ` The conflict is n-ary (arity ${arity}): no single position violates it alone, so look for a shared constraint rather than one disputed predicate.`
            : ` The conflict is pairwise (arity ${arity}).`;
      return {
        observation,
        isAnomalous: anomalous,
        criterion: "logical verdict kind",
        basis: anomalous
          ? `the prover established ${kind}, which is a fact about the corpus that wants explaining.${shape}`
          : `verdict kind ${kind || "(none)"} reports no conflict`,
      };
    }
  }
}

/**
 * Identify which of a hypothesis's terms the corpus does not contain.
 *
 * This is the input to Ockham's razor, so it must be mechanical. A term counts
 * as introduced when it appears in the hypothesis formula and in neither the
 * corpus vocabulary nor the background formulas.
 */
export function leapsOfFaith(
  formula: string,
  corpusVocabulary: readonly string[],
  background: readonly string[],
): string[] {
  const known = new Set<string>();
  for (const label of corpusVocabulary) known.add(normalizeSymbol(label));
  for (const premise of background) {
    for (const symbol of predicateSymbols(premise)) known.add(symbol);
  }
  return [...new Set(predicateSymbols(formula))]
    .filter((symbol) => !known.has(symbol))
    .sort();
}

/** Quantifier-stripped predicate symbols. See the ENGINEERING-HANDOFF trap:
 * `all x (p(x)` matches `[a-z_]\w*\s*\(` at `x (`, capturing the bound
 * variable as a predicate. Strip the binders before matching. */
export function predicateSymbols(formula: string): string[] {
  const stripped = formula.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
  return [...stripped.matchAll(/([a-zA-Z_]\w*)\s*\(/g)].map((match) =>
    normalizeSymbol(match[1]!),
  );
}

function normalizeSymbol(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

/**
 * Rank candidates by explanatory elegance — the specification's three tests,
 * in the order they must be applied.
 *
 *   A. Coherence (counter-abduction) runs FIRST, not third. A hypothesis that
 *      contradicts the corpus is refuted outright; scoring it would let a
 *      wide-covering absurdity outrank a modest truth.
 *   B. The matter-of-course test decides membership. A cause that does not make
 *      the observation follow is not an explanation of it, however plausible.
 *   C. Explanatory depth and Ockham's razor then order the survivors.
 *
 * Ordering is fully deterministic: score, then fewer leaps, then more
 * constituents entailed, then hypothesis id. Two runs over the same inputs
 * produce the same ranking.
 */
export async function rankBestExplanation(
  observation: Observation,
  candidates: readonly Hypothesis[],
  options: AbductionOptions,
): Promise<{
  ranked: ScoredHypothesis[];
  proverCalls: number;
  proverFailures: number;
  budgetExhausted: boolean;
}> {
  const budget = options.maxProverCalls ?? DEFAULT_MAX_PROVER_CALLS;
  const penalty = options.ockhamPenalty ?? OCKHAM_PENALTY;
  const constituents =
    observation.constituentFormulas && observation.constituentFormulas.length > 0
      ? observation.constituentFormulas
      : observation.formula
        ? [observation.formula]
        : [];

  let proverCalls = 0;
  let proverFailures = 0;
  let budgetExhausted = false;
  const scored: ScoredHypothesis[] = [];

  const ask = async (
    kind: AbductiveCheck["kind"],
    hypothesisId: string,
    premises: readonly string[],
    goal: string,
  ): Promise<AbductiveCheck> => {
    if (proverCalls >= budget) {
      budgetExhausted = true;
      return { kind, hypothesisId, goal, outcome: "error", detail: "budget exhausted" };
    }
    proverCalls++;
    try {
      const result = await options.oracle(premises, goal);
      if (result.outcome === "error") proverFailures++;
      return { kind, hypothesisId, goal, outcome: result.outcome, detail: result.detail };
    } catch (error) {
      proverFailures++;
      return {
        kind,
        hypothesisId,
        goal,
        outcome: "error",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const witnesses = options.existenceWitnesses ?? [];

  for (const hypothesis of candidates) {
    const checks: AbductiveCheck[] = [];
    const premises = [...options.background, ...witnesses, hypothesis.formula];

    // A. Coherence. Does this contradict what the corpus already establishes?
    const coherence = await ask("coherence", hypothesis.id, premises, "$F");
    checks.push(coherence);
    if (coherence.outcome === "proved") {
      scored.push({
        hypothesis,
        status: "refuted-incoherent",
        score: Number.NEGATIVE_INFINITY,
        explanatoryDepth: 0,
        entailedConstituents: [],
        unexplainedConstituents: constituents,
        checks,
        rationale:
          "Refuted by counter-abduction: asserting this alongside the corpus background derives a contradiction.",
      });
      continue;
    }

    // B. The middle premise. Would the observation be a matter of course?
    const matterOfCourse = observation.formula
      ? await ask("matter-of-course", hypothesis.id, premises, observation.formula)
      : undefined;
    if (matterOfCourse) checks.push(matterOfCourse);

    // C. Explanatory depth over the anomaly's constituent facts.
    const entailed: string[] = [];
    const unexplained: string[] = [];
    for (const constituent of constituents) {
      const check = await ask(
        "constituent-entailment",
        hypothesis.id,
        premises,
        constituent,
      );
      checks.push(check);
      if (check.outcome === "proved") entailed.push(constituent);
      else unexplained.push(constituent);
    }
    const explanatoryDepth =
      constituents.length === 0 ? 0 : entailed.length / constituents.length;

    const explains =
      matterOfCourse?.outcome === "proved" || entailed.length > 0;
    const undecided =
      !explains &&
      (matterOfCourse?.outcome === "error" ||
        checks.some((check) => check.outcome === "error"));

    const score = explains
      ? explanatoryDepth - hypothesis.leapsOfFaith.length * penalty
      : Number.NEGATIVE_INFINITY;

    scored.push({
      hypothesis,
      status: explains ? "candidate" : undecided ? "undecided" : "rejected-does-not-explain",
      score,
      explanatoryDepth,
      entailedConstituents: entailed,
      unexplainedConstituents: unexplained,
      checks,
      rationale: explains
        ? `Explains ${entailed.length} of ${constituents.length} constituent fact(s)` +
          (hypothesis.leapsOfFaith.length > 0
            ? `, at the cost of introducing ${hypothesis.leapsOfFaith.length} entity/entities the corpus does not contain (${hypothesis.leapsOfFaith.join(", ")}).`
            : ", introducing nothing the corpus does not already contain.")
        : undecided
          ? /*
             * Say WHY it could not be decided. "The prover could not establish
             * it" reads as a hard logical problem, and for a malformed formula
             * that is simply false — the caller has a typo and can fix it in
             * seconds if told. Carrying the oracle's own detail is the
             * difference between an actionable result and a shrug.
             */
            `Undecided: ${
              checks.find((check) => check.outcome === "error")?.detail ??
              "the prover could not establish that the observation would follow from this cause"
            }.`
          : "Does not explain the observation: it would not be a matter of course if this were true.",
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.hypothesis.leapsOfFaith.length - b.hypothesis.leapsOfFaith.length ||
      b.entailedConstituents.length - a.entailedConstituents.length ||
      a.hypothesis.id.localeCompare(b.hypothesis.id),
  );

  return { ranked: scored, proverCalls, proverFailures, budgetExhausted };
}

/**
 * Language of deductive certainty, forbidden in abductive output.
 *
 * Abduction's whole epistemic content is "there is reason to SUSPECT". A
 * sentence that says "proves", "establishes" or "shows that" has silently
 * upgraded a suspicion into a result, and a reader downstream cannot tell the
 * difference. The check is mechanical because the temptation is constant.
 */
const DEDUCTIVE_REGISTER =
  /\b(prove[sdn]?|proven|establishe?[sd]?|demonstrates?|confirms?|shows? that|entails?|therefore|must be|is certainly|conclusively)\b/i;

export function containsDeductiveRegister(statement: string): boolean {
  return DEDUCTIVE_REGISTER.test(statement);
}

/**
 * The one sentence a caller may quote as the engine's conclusion.
 *
 * Built by template rather than by the model, for the same reason the verdict
 * strings elsewhere in AGEM are: a conclusion phrased freely drifts toward the
 * register of the strongest thing in the room, and here the strongest thing is
 * a prover result about a CONDITIONAL, not about the world.
 */
export function frameAsProvisional(
  observation: Observation,
  best: ScoredHypothesis | undefined,
): string {
  if (!best || best.status !== "candidate") {
    return (
      `NO ADOPTABLE EXPLANATION — the surprising fact "${observation.phenomenon}" ` +
      "remains unexplained: no candidate cause both cohered with the corpus and made the " +
      "observation a matter of course. This is a live gap, not a negative result."
    );
  }
  const cost =
    best.hypothesis.leapsOfFaith.length === 0
      ? "introducing nothing the corpus does not already contain"
      : `at the cost of ${best.hypothesis.leapsOfFaith.length} introduced entity/entities (${best.hypothesis.leapsOfFaith.join(", ")})`;
  return (
    `PROVISIONAL — given the surprising fact "${observation.phenomenon}", the most coherent ` +
    `explanation requiring the fewest assumptions is: ${best.hypothesis.proposedCause}. ` +
    `If true, this mechanically accounts for ${best.entailedConstituents.length} of ` +
    `${best.entailedConstituents.length + best.unexplainedConstituents.length} constituent fact(s), ` +
    `${cost}. Abduction justifies adopting this hypothesis for testing — it is not a verdict, ` +
    "and no finding may be stored on it. It should now be tested inductively."
  );
}

/**
 * What would confirm or kill the leading hypothesis.
 *
 * Peirce's sequence is abduction → deduction → induction. An abduction handed
 * over without its test is a guess with a citation, so the test is part of the
 * result rather than an optional extra.
 */
export function proposeTest(
  observation: Observation,
  best: ScoredHypothesis | undefined,
): string {
  if (!best || best.status !== "candidate") {
    return (
      "Widen the candidate pool before testing anything: the current hypotheses either " +
      "contradict the corpus or fail to make the observation follow. Look for causes stated " +
      "in the corpus's own vocabulary that the extraction may not have reached."
    );
  }
  const residue = best.unexplainedConstituents;
  const lines = [
    `Deduce: if ${best.hypothesis.proposedCause}, what else must hold that the corpus has not yet been checked for?`,
    `Induce: seek corpus or external evidence for those consequences. Grounds are collected with build_defensible_claim, not asserted here.`,
  ];
  if (residue.length > 0) {
    lines.push(
      `Discriminate: this hypothesis leaves ${residue.length} constituent fact(s) unexplained. A rival that covers them at equal or lower assumption cost would displace it.`,
    );
  }
  if (best.hypothesis.leapsOfFaith.length > 0) {
    lines.push(
      `Falsify cheapest first: the introduced entity/entities (${best.hypothesis.leapsOfFaith.join(", ")}) carry the assumption cost. Evidence bearing on their existence is the highest-value test.`,
    );
  }
  return lines.join(" ");
}

/** Stable id for a hypothesis, so rankings are reproducible across runs. */
export function hypothesisId(formula: string): string {
  return `hyp:${createHash("sha256").update(formula.trim().replace(/\s+/g, " "), "utf8").digest("hex").slice(0, 12)}`;
}

/**
 * Execute the abductive leap over one observation.
 *
 * Step A gates on anomaly: a phenomenon the corpus already entails is returned
 * to deduction rather than explained a second time. Steps B and C are the
 * creative pool and the crucible. Step D frames the survivor provisionally.
 */
export async function executeAbductiveLeap(
  observation: Observation,
  candidates: readonly Hypothesis[],
  options: AbductionOptions,
): Promise<AbductionResult> {
  const assessment = await assessAnomaly(observation, options);

  if (!assessment.isAnomalous) {
    return {
      assessment,
      ranked: [],
      provisionalStatement:
        `NOT ANOMALOUS — ${assessment.basis}. ` +
        (assessment.deductiveWitness
          ? "Use deduction: the phenomenon already follows from the corpus."
          : "There is no surprising fact here to explain."),
      testProposal:
        "No abductive test applies. If the phenomenon still seems puzzling, the puzzle is about the corpus's premises, not about an unexplained fact.",
      proverCalls: 0,
      proverFailures: 0,
      budgetExhausted: false,
      declined:
        "Abduction declined. Inference to the best explanation applies only to facts the background does not already make a matter of course.",
    };
  }

  if (candidates.length === 0) {
    return {
      assessment,
      ranked: [],
      provisionalStatement: frameAsProvisional(observation, undefined),
      testProposal: proposeTest(observation, undefined),
      proverCalls: 0,
      proverFailures: 0,
      budgetExhausted: false,
      declined:
        "No candidate causes were supplied. The engine ranks and tests hypotheses; it does not invent them without a source.",
    };
  }

  const { ranked, proverCalls, proverFailures, budgetExhausted } =
    await rankBestExplanation(observation, candidates, options);
  const leader = ranked.find((entry) => entry.status === "candidate");
  const best = leader
    ? { ...leader, status: "best-explanation" as HypothesisStatus }
    : undefined;

  return {
    assessment,
    ranked: ranked.map((entry) =>
      entry === leader ? { ...entry, status: "best-explanation" as const } : entry,
    ),
    best,
    provisionalStatement: frameAsProvisional(observation, leader),
    testProposal: proposeTest(observation, leader),
    proverCalls,
    proverFailures,
    budgetExhausted,
    ...((options.existenceWitnesses?.length ?? 0) === 0
      ? {
          vacuityRisk:
            "Coherence was checked without existence witnesses. A hypothesis that " +
            "survived counter-abduction may have done so only because the empty world " +
            "satisfies a theory of universal conditionals. Supply existenceWitnesses " +
            "(e.g. `exists x (organism(x))`) for the entities the background quantifies " +
            "over before treating any survivor as compatible with the corpus.",
        }
      : {}),
  };
}
