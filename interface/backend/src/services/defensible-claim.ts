/**
 * defensible-claim.ts — construct claims that survive scrutiny by anchoring
 * them to checkable reality.
 *
 * Where this sits
 * ---------------
 * AGEM has two ways to say something about a corpus. The formal path derives
 * typed claims and asks a prover; when it returns a verdict, that verdict is
 * what gets stored. But most of what a corpus supports is not a theorem. A
 * corpus can carry strong, checkable, provenance-bearing grounds for a
 * recommendation without any of it being deductively valid — and AGEM's
 * previous behaviour in that situation was to say nothing at all.
 *
 * This is the third path: an EVIDENTIAL claim. It is defeasible by
 * construction, labelled as such at every boundary, and it never satisfies a
 * verification contract item. It is not a weaker proof. It is a different
 * instrument, and conflating the two is the failure it exists to prevent.
 *
 * The two mechanisms that give it teeth
 * -------------------------------------
 *   1. A MANDATORY disconfirming search. `constructClaim` refuses to build
 *      anything if the caller cannot show it went looking for what would prove
 *      the recommendation wrong. Confirmation bias is not corrected downstream
 *      by weighting; it is prevented at the gather step or not at all.
 *   2. SCOPE CALIBRATION. A wild claim with a qualifier is still a wild claim,
 *      so hedging language is not the remedy. The scope is shrunk — "all" to
 *      "some", "is" to "appears" — until the claim fits inside what the grounds
 *      actually carry.
 *
 * What gets dropped, and why it is recorded
 * -----------------------------------------
 * Opinions and bare assertions are removed from the grounds, but they are
 * returned in `dropped` with the reason. A filter whose removals are invisible
 * is indistinguishable from a filter that silently discarded inconvenient
 * material.
 */

import { createHash } from "node:crypto";

export type EvidenceCategory = "data" | "observation" | "experience" | "testimony";
export type EvidenceBearing = "supports" | "contradicts";

/** The four things a statement can turn out to be when filtered. */
export type StatementVerdict = "opinion" | "assertion" | "anecdote" | "checkable";

/**
 * A raw statement offered as evidence, before filtering.
 *
 * The structured fields exist so classification is not a guess about prose.
 * When they are absent the lexical fallback fires and says so in `basis`, so a
 * reader can always tell which one decided.
 */
export interface CandidateStatement {
  id?: string;
  text: string;
  category?: EvidenceCategory;
  bearing?: EvidenceBearing;
  /** Resolvable locator: segment id, DOI, URL, page. Drives verifiability. */
  sourceRef?: string;
  /** How many independent instances this rests on. 1 ⇒ anecdote. */
  instanceCount?: number;
  /** True when the statement expresses what someone prefers, not what is. */
  isNormative?: boolean;
  /** Caller-declared source reliability tier. */
  reliabilityTier?: "primary" | "peer-reviewed" | "secondary" | "self-reported" | "anonymous";
  /** Sub-questions of the decision this statement bears on. Drives coverage. */
  addresses?: readonly string[];
}

export interface Evidence {
  id: string;
  category: EvidenceCategory;
  source: string;
  finding: string;
  bearing: EvidenceBearing;
  /** Kept, but cannot carry a claim alone. */
  warning?: string;
  weight: EvidenceWeight;
}

/**
 * The four-question filter. Each component is in [0,1] and carries the basis
 * that produced it, so a score can be argued with rather than only trusted.
 */
export interface EvidenceWeight {
  relevance: number;
  reliability: number;
  coverage: number;
  verifiability: number;
  /** Sum of the four. Range [0,4]. An ordering device, not a probability. */
  total: number;
  basis: Record<"relevance" | "reliability" | "coverage" | "verifiability", string>;
}

export interface DroppedStatement {
  id: string;
  text: string;
  verdict: StatementVerdict;
  why: string;
  basis: "structured" | "lexical";
}

/** Scope ladder, strongest first. Calibration walks DOWN it and cannot cycle. */
export const SCOPE_LADDER = [
  "universal",
  "general",
  "typical",
  "some",
  "at-least-one",
] as const;
export type ClaimScope = (typeof SCOPE_LADDER)[number];

/** Certainty ladder, strongest first. */
export const CERTAINTY_LADDER = [
  "is",
  "indicates",
  "appears",
  "is-consistent-with",
] as const;
export type ClaimCertainty = (typeof CERTAINTY_LADDER)[number];

export interface CalibrationStep {
  from: { scope: ClaimScope; certainty: ClaimCertainty };
  to: { scope: ClaimScope; certainty: ClaimCertainty };
  reason: string;
}

export interface DefensibleClaim {
  recommendation: string;
  scope: ClaimScope;
  certainty: ClaimCertainty;
  /** Checkable facts anchoring the point, strongest first. */
  grounds: readonly Evidence[];
  /** Evidence that bears against the recommendation. Never discarded. */
  contradicting: readonly Evidence[];
  /** The bridge: why the grounds justify the recommendation, and what it costs. */
  reasoning: string;
  /** The strongest objection, stated in its own terms before it is answered. */
  strongestObjection: string;
  calibration: {
    initial: { scope: ClaimScope; certainty: ClaimCertainty };
    final: { scope: ClaimScope; certainty: ClaimCertainty };
    steps: readonly CalibrationStep[];
    groundsStrength: number;
    scopeDemand: number;
  };
  dropped: readonly DroppedStatement[];
  /**
   * True when nothing survived that can carry a claim — no checkable grounds,
   * or only anecdotes. The claim is returned anyway so the caller can see what
   * was tried, but it must not be presented as a conclusion.
   */
  cannotStand: boolean;
  /** The sentence a caller may quote. Always marked defeasible. */
  statement: string;
}

export interface FilterResult {
  kept: CandidateStatement[];
  dropped: DroppedStatement[];
  /** Statements kept with a warning, i.e. anecdotes. */
  anecdotes: CandidateStatement[];
}

/**
 * Preference markers. Used only when `isNormative` was not supplied, and the
 * fallback is always recorded as `lexical` so nobody mistakes it for a fact
 * about the statement's structure.
 */
const PREFERENCE_MARKERS =
  /\b(i (think|feel|believe|prefer|like|hate)|in my (view|opinion)|should be|ought to|better than|worse than|the best|the worst|obviously|clearly the)\b/i;

/** Strip feelings and assumptions masquerading as facts. */
export function filterNoise(
  statements: readonly CandidateStatement[],
): FilterResult {
  const kept: CandidateStatement[] = [];
  const dropped: DroppedStatement[] = [];
  const anecdotes: CandidateStatement[] = [];

  for (const statement of statements) {
    const id = statement.id ?? statementId(statement.text);
    const structured =
      statement.isNormative !== undefined ||
      statement.sourceRef !== undefined ||
      statement.instanceCount !== undefined;
    const basis: DroppedStatement["basis"] = structured ? "structured" : "lexical";

    const normative =
      statement.isNormative ?? PREFERENCE_MARKERS.test(statement.text);
    if (normative) {
      dropped.push({
        id,
        text: statement.text,
        verdict: "opinion",
        why: "expresses a preference about what should be, not a checkable fact about what is",
        basis,
      });
      continue;
    }

    const backed = !!statement.sourceRef?.trim();
    if (!backed) {
      dropped.push({
        id,
        text: statement.text,
        verdict: "assertion",
        why: "no backing was stated, so a skeptic has nothing to check",
        basis,
      });
      continue;
    }

    if ((statement.instanceCount ?? 0) === 1) {
      anecdotes.push({ ...statement, id });
      kept.push({ ...statement, id });
      continue;
    }

    kept.push({ ...statement, id });
  }

  return { kept, dropped, anecdotes };
}

const RELIABILITY_TIERS: Record<
  NonNullable<CandidateStatement["reliabilityTier"]>,
  number
> = {
  primary: 1,
  "peer-reviewed": 0.9,
  secondary: 0.6,
  "self-reported": 0.35,
  anonymous: 0.15,
};

/** A resolvable locator: something a skeptic can actually go and open. */
const RESOLVABLE_LOCATOR =
  /^(https?:\/\/|doi:|10\.\d{4,}\/|segment:|section:|p\.\s*\d+|[a-z0-9][\w-]*:[\w./-]+)/i;

/**
 * Rank one piece of evidence against one specific decision.
 *
 * Strength is a spectrum, not a category — the same study is strong evidence
 * for one question and weak for its neighbour. So the decision is an argument
 * here, and a weight computed against a different decision is not reusable.
 *
 * `embed` is optional. With it, relevance is cosine similarity; without it,
 * relevance is content-token overlap. The basis string always names which ran,
 * because the two are not interchangeable and a reader must be able to tell.
 */
export async function weighEvidence(
  statement: CandidateStatement,
  decision: { question: string; subQuestions?: readonly string[] },
  embed?: (text: string) => Promise<readonly number[]>,
): Promise<EvidenceWeight> {
  let relevance: number;
  let relevanceBasis: string;
  if (embed) {
    try {
      const [a, b] = await Promise.all([
        embed(statement.text),
        embed(decision.question),
      ]);
      relevance = clamp01(cosine(a, b));
      relevanceBasis = `cosine similarity ${relevance.toFixed(3)} against the decision question`;
    } catch {
      relevance = tokenOverlap(statement.text, decision.question);
      relevanceBasis = `embedding unavailable; token overlap ${relevance.toFixed(3)} against the decision question`;
    }
  } else {
    relevance = tokenOverlap(statement.text, decision.question);
    relevanceBasis = `token overlap ${relevance.toFixed(3)} against the decision question (no embedder supplied)`;
  }

  const tier = statement.reliabilityTier;
  const reliability = tier ? RELIABILITY_TIERS[tier] : 0.5;
  const reliabilityBasis = tier
    ? `declared source tier: ${tier}`
    : "no source tier declared; scored at the neutral midpoint rather than assumed trustworthy";

  const subQuestions = decision.subQuestions ?? [];
  const addressed = (statement.addresses ?? []).filter((item) =>
    subQuestions.includes(item),
  );
  const coverage =
    subQuestions.length === 0 ? 0.5 : addressed.length / subQuestions.length;
  const coverageBasis =
    subQuestions.length === 0
      ? "the decision was not broken into sub-questions, so span cannot be measured"
      : `addresses ${addressed.length} of ${subQuestions.length} sub-question(s)`;

  const ref = statement.sourceRef?.trim() ?? "";
  const verifiable = RESOLVABLE_LOCATOR.test(ref);
  const verifiability = verifiable ? 1 : ref ? 0.4 : 0;
  const verifiabilityBasis = verifiable
    ? `locator ${ref} resolves to something a skeptic can open`
    : ref
      ? `source "${ref}" is named but is not a resolvable locator`
      : "no source locator at all";

  return {
    relevance,
    reliability,
    coverage,
    verifiability,
    total: relevance + reliability + coverage + verifiability,
    basis: {
      relevance: relevanceBasis,
      reliability: reliabilityBasis,
      coverage: coverageBasis,
      verifiability: verifiabilityBasis,
    },
  };
}

/**
 * How much claim the grounds can carry, in [0,1].
 *
 * Three things reduce it, each for a different reason:
 *   - thin or weak supporting evidence (the obvious one);
 *   - standing contradicting evidence, weighted — a claim with a strong
 *     unanswered counter-example is not merely less supported, it is disputed;
 *   - reliance on anecdotes, which cannot carry a claim alone no matter how
 *     many of the other boxes they tick.
 */
export function groundsStrength(
  grounds: readonly Evidence[],
  contradicting: readonly Evidence[],
): number {
  const supporting = grounds.filter((e) => e.bearing === "supports");
  if (supporting.length === 0) return 0;

  const best = Math.max(...supporting.map((e) => e.weight.total)) / 4;
  const breadth = Math.min(1, supporting.length / 3);
  const support = best * 0.7 + breadth * 0.3;

  const counterWeight =
    contradicting.length === 0
      ? 0
      : Math.max(...contradicting.map((e) => e.weight.total)) / 4;

  const onlyAnecdotes = supporting.every((e) => !!e.warning);
  const anecdotePenalty = onlyAnecdotes ? 0.5 : 0;

  return clamp01(support - counterWeight * 0.6 - anecdotePenalty);
}

/** How much strength a scope/certainty pair demands, in [0,1]. */
export function scopeDemand(
  scope: ClaimScope,
  certainty: ClaimCertainty,
): number {
  const scopeCost = 1 - SCOPE_LADDER.indexOf(scope) / (SCOPE_LADDER.length - 1);
  const certaintyCost =
    1 - CERTAINTY_LADDER.indexOf(certainty) / (CERTAINTY_LADDER.length - 1);
  return clamp01(scopeCost * 0.6 + certaintyCost * 0.4);
}

/**
 * Shrink the claim until it fits inside the evidence.
 *
 * The specification writes this as `WHILE scope > strength: shrink`. Taken
 * literally that loop need not terminate, so it is bounded here by the ladders
 * themselves: each pass steps scope down, then certainty down, and when both
 * are at their weakest the loop ends whether or not the claim fits. If it still
 * does not fit at the bottom, the honest report is `cannotStand`, not a further
 * softened wording.
 */
export function calibrateCertainty(
  initial: { scope: ClaimScope; certainty: ClaimCertainty },
  strength: number,
): {
  scope: ClaimScope;
  certainty: ClaimCertainty;
  steps: CalibrationStep[];
  demand: number;
} {
  let scope = initial.scope;
  let certainty = initial.certainty;
  const steps: CalibrationStep[] = [];
  const maxSteps = SCOPE_LADDER.length + CERTAINTY_LADDER.length;

  for (let i = 0; i < maxSteps; i++) {
    const demand = scopeDemand(scope, certainty);
    if (demand <= strength) break;

    const scopeIndex = SCOPE_LADDER.indexOf(scope);
    const certaintyIndex = CERTAINTY_LADDER.indexOf(certainty);
    const from = { scope, certainty };

    if (scopeIndex < SCOPE_LADDER.length - 1) {
      scope = SCOPE_LADDER[scopeIndex + 1]!;
      steps.push({
        from,
        to: { scope, certainty },
        reason: `scope demand ${demand.toFixed(2)} exceeded grounds strength ${strength.toFixed(2)}; narrowed the scope rather than adding a qualifier`,
      });
      continue;
    }
    if (certaintyIndex < CERTAINTY_LADDER.length - 1) {
      certainty = CERTAINTY_LADDER[certaintyIndex + 1]!;
      steps.push({
        from,
        to: { scope, certainty },
        reason: `scope was already at its narrowest; softened the certainty from "${from.certainty}" to "${certainty}"`,
      });
      continue;
    }
    break;
  }

  return { scope, certainty, steps, demand: scopeDemand(scope, certainty) };
}

export interface ConstructClaimInput {
  /** The decision this claim is for. Weighing is relative to it. */
  decision: { question: string; subQuestions?: readonly string[] };
  /** The point you want accepted, before calibration. */
  recommendation: string;
  /** Everything gathered, supporting AND disconfirming. */
  statements: readonly CandidateStatement[];
  /**
   * Receipt that the disconfirming search actually ran. Required.
   * See `DisconfirmingSearch`.
   */
  disconfirmingSearch: DisconfirmingSearch;
  initialScope?: ClaimScope;
  initialCertainty?: ClaimCertainty;
  embed?: (text: string) => Promise<readonly number[]>;
}

/**
 * Receipt for the mandatory "what would prove me wrong?" pass.
 *
 * A boolean would be trivially satisfiable, so this asks for the query that was
 * run and where. Finding nothing is a legitimate outcome — `found: 0` with a
 * real query is a result. Not looking is not.
 */
export interface DisconfirmingSearch {
  /** The question asked of the corpus, in the form "what would show this is false?" */
  query: string;
  /** Where it was run: corpus segment ids, tool name, external source. */
  searchedIn: readonly string[];
  /** How many disconfirming items it turned up. Zero is a valid answer. */
  found: number;
}

export class DisconfirmingSearchRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisconfirmingSearchRequired";
  }
}

/**
 * Build the bridge from grounds to recommendation.
 *
 * The reasoning must do the heavy lifting: it has to answer the strongest
 * objection, not restate the grounds in a confident tone. So the strongest
 * standing counter-evidence is stated in its own terms FIRST, and the bridge
 * is written against it. When there is no counter-evidence, the absence is
 * reported as an absence — which is itself a weakness of the evidence base,
 * not a strength of the claim.
 */
export function buildLogicalBridge(
  recommendation: string,
  grounds: readonly Evidence[],
  contradicting: readonly Evidence[],
  search: DisconfirmingSearch,
): { reasoning: string; strongestObjection: string } {
  const strongest = [...contradicting].sort(
    (a, b) => b.weight.total - a.weight.total,
  )[0];

  const strongestObjection = strongest
    ? `${strongest.finding} (${strongest.source}; weight ${strongest.weight.total.toFixed(2)}/4)`
    : search.found === 0
      ? `No disconfirming evidence was found by the query "${search.query}" across ${search.searchedIn.length} source(s). The strongest objection is therefore that the search itself may have been too narrow — an unchallenged claim is not the same as a tested one.`
      : "No disconfirming evidence survived filtering.";

  const supporting = grounds.filter((e) => e.bearing === "supports");
  const lead = supporting[0];
  const carrier = lead
    ? `The claim rests principally on ${lead.finding} (${lead.source}), which is ${lead.category} evidence weighted ${lead.weight.total.toFixed(2)}/4.`
    : "No supporting evidence survived filtering, so nothing carries the claim.";

  const answer = strongest
    ? `That objection is not dissolved: it stands, and it is why the scope below is narrower than the recommendation as first stated. The claim is advanced only over the range where the supporting grounds outweigh it.`
    : `Because the objection is about search coverage rather than contrary findings, the claim is advanced only as far as the sources actually consulted reach.`;

  const anecdotal = supporting.filter((e) => !!e.warning);
  const anecdoteNote =
    anecdotal.length > 0
      ? ` ${anecdotal.length} of the supporting item(s) rest on a single instance and cannot carry the claim alone.`
      : "";

  return {
    reasoning: `${carrier} ${answer}${anecdoteNote}`,
    strongestObjection,
  };
}

/**
 * Assemble a defensible claim.
 *
 * Order matters and is the specification's: gather honestly (enforced by the
 * disconfirming-search receipt), filter, weigh, structure, then calibrate. The
 * calibration is last because it needs the finished evidence base to know how
 * far the claim may reach.
 *
 * @throws DisconfirmingSearchRequired when no genuine disconfirming pass was run.
 */
export async function constructClaim(
  input: ConstructClaimInput,
): Promise<DefensibleClaim> {
  const search = input.disconfirmingSearch;
  if (!search?.query?.trim() || (search.searchedIn?.length ?? 0) === 0) {
    throw new DisconfirmingSearchRequired(
      "A defensible claim requires a disconfirming search: the query asked and where it ran. " +
        "Gathering only supporting material and weighting it afterwards does not correct for " +
        "confirmation bias — ask what would prove the recommendation wrong, then build.",
    );
  }

  const { kept, dropped, anecdotes } = filterNoise(input.statements);
  const anecdoteIds = new Set(anecdotes.map((s) => s.id));

  const weighed: Evidence[] = [];
  for (const statement of kept) {
    const weight = await weighEvidence(statement, input.decision, input.embed);
    weighed.push({
      id: statement.id!,
      category: statement.category ?? "observation",
      source: statement.sourceRef!,
      finding: statement.text,
      bearing: statement.bearing ?? "supports",
      ...(anecdoteIds.has(statement.id!)
        ? {
            warning:
              "single isolated instance — admissible, but cannot carry a claim on its own",
          }
        : {}),
      weight,
    });
  }

  const byWeight = (a: Evidence, b: Evidence) =>
    b.weight.total - a.weight.total || a.id.localeCompare(b.id);
  const grounds = weighed.filter((e) => e.bearing === "supports").sort(byWeight);
  const contradicting = weighed
    .filter((e) => e.bearing === "contradicts")
    .sort(byWeight);

  const strength = groundsStrength(grounds, contradicting);
  const initial = {
    scope: input.initialScope ?? "general",
    certainty: input.initialCertainty ?? "is",
  } as const;
  const calibrated = calibrateCertainty(initial, strength);

  const { reasoning, strongestObjection } = buildLogicalBridge(
    input.recommendation,
    grounds,
    contradicting,
    search,
  );

  const cannotStand =
    grounds.length === 0 ||
    grounds.every((e) => !!e.warning) ||
    calibrated.demand > strength;

  return {
    recommendation: input.recommendation,
    scope: calibrated.scope,
    certainty: calibrated.certainty,
    grounds,
    contradicting,
    reasoning,
    strongestObjection,
    calibration: {
      initial,
      final: { scope: calibrated.scope, certainty: calibrated.certainty },
      steps: calibrated.steps,
      groundsStrength: strength,
      scopeDemand: calibrated.demand,
    },
    dropped,
    cannotStand,
    statement: claimStatement(
      input.recommendation,
      calibrated.scope,
      calibrated.certainty,
      grounds.length,
      contradicting.length,
      cannotStand,
    ),
  };
}

const SCOPE_WORDS: Record<ClaimScope, string> = {
  universal: "In all cases",
  general: "Generally",
  typical: "Typically",
  some: "In some cases",
  "at-least-one": "In at least one documented case",
};

const CERTAINTY_WORDS: Record<ClaimCertainty, string> = {
  is: "the evidence establishes that",
  indicates: "the evidence indicates that",
  appears: "the evidence suggests that",
  "is-consistent-with": "the evidence is consistent with",
};

/**
 * The one sentence a caller may quote.
 *
 * Templated for the same reason the abductive statement is: freely worded
 * conclusions drift upward in confidence. The EVIDENTIAL prefix is not
 * decoration — it is the boundary that keeps this out of the space where
 * logical verdicts live.
 */
export function claimStatement(
  recommendation: string,
  scope: ClaimScope,
  certainty: ClaimCertainty,
  groundCount: number,
  counterCount: number,
  cannotStand: boolean,
): string {
  if (cannotStand) {
    return (
      `INSUFFICIENT GROUNDS — the recommendation "${recommendation}" cannot be advanced at any scope ` +
      `the surviving evidence supports (${groundCount} checkable supporting item(s), ${counterCount} contradicting). ` +
      "This is a report of what the evidence does not carry, not a claim."
    );
  }
  return (
    `EVIDENTIAL (defeasible) — ${SCOPE_WORDS[scope]}, ${CERTAINTY_WORDS[certainty]} ${recommendation}. ` +
    `Anchored to ${groundCount} checkable ground(s)` +
    (counterCount > 0 ? `, against ${counterCount} standing counter-item(s)` : "") +
    ". This is an evidential claim, not a logical verdict: it is defeasible by new evidence " +
    "and does not satisfy formal verification."
  );
}

function statementId(text: string): string {
  return `ev:${createHash("sha256").update(text.trim().replace(/\s+/g, " "), "utf8").digest("hex").slice(0, 12)}`;
}

const CONTENT_STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "of",
  "to", "in", "on", "for", "with", "and", "or", "but", "that", "this", "it",
  "as", "at", "by", "from", "not", "do", "does", "did", "has", "have", "had",
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (token) => token.length > 2 && !CONTENT_STOP_WORDS.has(token),
    ),
  );
}

/** Jaccard overlap on content tokens. Lexical, and reported as such. */
function tokenOverlap(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
