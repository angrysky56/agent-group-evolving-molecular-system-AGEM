import {
  claimAttributionIssue,
  claimSchemaIssue,
  claimSourceSemanticIssue,
  claimVocabularyIssue,
  normalizeClaimExtras,
  type ExtractedClaim,
  ClosedGlossaryEntry,
  type ExtractionOutcome,
  type ExtractionReport,
} from "./claim-extractor.js";
import type { PredicateAliasSuggestion } from "./predicate-aliases.js";

export type ExtractionRepairKind =
  | "glossary-addition"
  | "distinction-value"
  | "axis-value-choice"
  | "attribution-holder"
  | "predicate-bridge";

export interface ExtractionRepairCandidate {
  id: string;
  description: string;
  patch:
    | { operation: "add-glossary-label"; label: string }
    | { operation: "replace-distinction-values"; values: [string, string] }
    | { operation: "replace-role-value"; role: string; value: string }
    | { operation: "set-attribution"; scope: "position"; positionId: string }
    | { operation: "add-ontology-alias"; source: string; canonical: string };
  evidence: string;
  ranking?: {
    editCount: number;
    exactGlossaryReuse: boolean;
    sourceSpanDistance: number | null;
  };
  counterfactual?: {
    status: "validated" | "rejected" | "not-applicable";
    validator: "claim-integrity-v1";
    beforeFailures: string[];
    afterFailures: string[];
    sourceCoverageBefore: number;
    sourceCoverageAfter: number;
    patchedClaim?: ExtractedClaim;
    reason?: string;
  };
}

export interface ExtractionRepairProposal {
  kind: ExtractionRepairKind;
  segmentId?: string;
  failure: string;
  candidates: ExtractionRepairCandidate[];
  selectedCandidateId?: string;
  selectedBy?: "counterfactual-validator" | "mcp-logic:abductive_explain";
  status:
    | "counterfactually-validated"
    | "unresolved"
    | "no-candidate"
    | "oracle-failed";
  /** Repairs are suggestions until a human or audited ontology approves them. */
  applied: false;
  oracleError?: string;
  /**
   * Why no candidate could even be constructed, when `status` is
   * `no-candidate`.
   *
   * An empty proposal used to be reported as `unresolved`, which is the same
   * word used for "candidates were built and none of them validated". Those are
   * completely different situations and only one of them is waiting on a
   * decision. Observed live on the quantum-mind-genesis run
   * (2026-07-30T19-27-27): three proposals, zero candidates between them,
   * `validatorCalls: 0` — reported to the user as "three unresolved proposals
   * are flagged in the output", which reads as work in progress. There was
   * nothing there. The repair route was already closed and nobody was told.
   */
  noCandidateReason?: string;
}

export interface ExtractionRepairReport {
  mode: "propose-only";
  proposals: ExtractionRepairProposal[];
  abductiveCalls: number;
  oracleFailures: number;
  validatorCalls: number;
  truncated: boolean;
  /** Proposals for which no candidate could be constructed at all. */
  candidatelessProposals: number;
  /**
   * True when the repair route is CLOSED, not pending: every proposal is
   * empty, so there is nothing for a human or an ontology to approve. The
   * caller must say so plainly rather than implying repairs are outstanding.
   */
  repairRouteExhausted: boolean;
  /** One line per closed proposal, naming what a person would have to do. */
  humanActionRequired: string[];
}

/**
 * Why a proposal ended up with no candidates.
 *
 * These are not failures of the repair engine so much as the boundary of its
 * patch vocabulary, and naming the boundary is more useful than an empty list.
 * `attributionCandidates` can only propose a holder that the segment TEXT
 * already names; when a corpus speaks in its own voice — "the corpus notes the
 * asymmetry" — there is no such holder, and the real fix is to introduce a
 * narrator position, which is not something a claim-level patch can express.
 */
function noCandidateReason(kind: ExtractionRepairKind): string {
  switch (kind) {
    case "attribution-holder":
      return (
        "no glossary entity is named in this segment, so no holder can be proposed from the text. " +
        "If the corpus is speaking in its own voice, the fix is a corpus-narrator position, which " +
        "is outside the claim-level patch vocabulary and needs a human or an audited ontology."
      );
    case "glossary-addition":
      return (
        "the extractor proposed no candidate label for this unmappable claim, so there is nothing " +
        "to add to a reviewed glossary. Decide whether the claim is expressible in this corpus at all."
      );
    case "distinction-value":
      return "no closed-glossary axis defines two opposed values that this segment mentions.";
    case "axis-value-choice":
      return "the segment states no value of the offending axis, so no source-grounded substitution exists.";
    case "predicate-bridge":
      return "no alias target was proposed for this predicate.";
  }
}

export interface ExtractionRepairContext {
  segments: ReadonlyArray<{ id: string; text: string }>;
  extraction: Pick<ExtractionReport, "glossary" | "unmappableClaims" | "outcomes">;
  attributionIssues?: ReadonlyArray<{ segmentId: string; reason: string }>;
  predicateAliasSuggestions?: readonly PredicateAliasSuggestion[];
}

export type AbductiveRepairOracle = (args: {
  observation: string;
  candidates: string[];
  background: string[];
  max_complexity: number;
}) => Promise<string>;

const MAX_REPAIR_QUERIES = 32;
const MAX_VALIDATOR_CALLS = 128;
const MENTION_STOP_WORDS = new Set(["a", "an", "is", "the"]);

function sourceMentions(source: string, value: string): boolean {
  const tokens = (text: string) =>
    text
      .replace(/[-_]+/g, " ")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const sourceTokens = new Set(tokens(source));
  const valueTokens = tokens(value).filter(
    (token) => !MENTION_STOP_WORDS.has(token),
  );
  return valueTokens.length > 0 && valueTokens.every((token) => sourceTokens.has(token));
}

function entryMentioned(source: string, entry: ClosedGlossaryEntry): boolean {
  return (
    sourceMentions(source, entry.label) ||
    entry.sourceForms.some((form) => sourceMentions(source, form))
  );
}

function uniqueCandidates(
  candidates: ExtractionRepairCandidate[],
): ExtractionRepairCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate.patch);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function proposal(
  kind: ExtractionRepairKind,
  failure: string,
  candidates: ExtractionRepairCandidate[],
  segmentId?: string,
): ExtractionRepairProposal {
  return {
    kind,
    ...(segmentId ? { segmentId } : {}),
    failure,
    candidates: uniqueCandidates(candidates).map((candidate, index) => ({
      ...candidate,
      id: `candidate-${index}`,
    })),
    status: "unresolved",
    applied: false,
  };
}

function distinctionProposal(
  outcome: ExtractionOutcome,
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): ExtractionRepairProposal | null {
  if (outcome.claim.kind !== "distinction") return null;
  const raw = outcome.claim.roles?.distinguished;
  const existing = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  const byLabel = new Map(glossary.map((entry) => [entry.label, entry]));
  const axes = glossary.filter(
    (entry) =>
      entry.kind === "axis" &&
      entry.axisEncoding === "categorical" &&
      entry.values?.length === 2 &&
      (existing.includes(entry.label) ||
        existing.some((value) => byLabel.get(value)?.axis === entry.label) ||
        entryMentioned(source, entry) ||
        entry.values.some((value) => {
          const valueEntry = byLabel.get(value);
          return valueEntry ? entryMentioned(source, valueEntry) : false;
        })),
  );
  const candidates = axes.map((axis) => ({
    id: "",
    description: `Use the two opposed values of the ${axis.label} axis`,
    patch: {
      operation: "replace-distinction-values" as const,
      values: [axis.values![0], axis.values![1]] as [string, string],
    },
    evidence: `closed glossary axis ${axis.label} defines exactly these two values`,
  }));
  if (candidates.length === 0) return null;
  return proposal(
    "distinction-value",
    outcome.rejection ?? "distinction did not contain two distinct values",
    candidates,
    outcome.segmentId,
  );
}

function axisValueProposal(
  outcome: ExtractionOutcome,
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): ExtractionRepairProposal | null {
  if (outcome.claim.kind !== "property-assertion") return null;
  const roleEntries = Object.entries(outcome.claim.roles ?? {}).flatMap(
    ([role, raw]) =>
      (Array.isArray(raw) ? raw : [raw]).map((value) => [role, String(value)] as const),
  );
  const byLabel = new Map(glossary.map((entry) => [entry.label, entry]));
  const axisUse = roleEntries.find(([, value]) => byLabel.get(value)?.kind === "axis");
  if (!axisUse) return null;
  const [role, axisLabel] = axisUse;
  const axis = byLabel.get(axisLabel)!;
  if (axis.axisEncoding !== "categorical") return null;
  const values = (axis.values ?? [])
    .map((label) => byLabel.get(label))
    .filter((entry): entry is ClosedGlossaryEntry => !!entry);
  const mentioned = values.filter((entry) => entryMentioned(source, entry));
  const eligible = mentioned.length > 0 ? mentioned : [];
  return proposal(
    "axis-value-choice",
    outcome.rejection ?? `metadata-only axis ${axisLabel} was used as a claim role`,
    eligible.map((entry) => ({
      id: "",
      description: `Use the source-stated ${entry.label} value, not the ${axisLabel} heading`,
      patch: {
        operation: "replace-role-value" as const,
        role,
        value: entry.label,
      },
      evidence: `the same segment states ${
        entry.sourceForms.find((form) => sourceMentions(source, form)) ?? entry.label
      }`,
    })),
    outcome.segmentId,
  );
}

function attributionCandidates(
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): ExtractionRepairCandidate[] {
  return glossary
    .filter((entry) => entry.kind === "entity" && entryMentioned(source, entry))
    .map((entry) => ({
      id: "",
      description: `Attribute the claim to ${entry.label}`,
      patch: {
        operation: "set-attribution" as const,
        scope: "position" as const,
        positionId: entry.label,
      },
      evidence: `the same segment names ${entry.sourceForms[0] ?? entry.label}`,
    }));
}

/**
 * Build a tiny, source-bounded hypothesis space. Nothing here mutates the
 * glossary, claims, ontology, or store; the oracle only ranks proposals.
 */
export function collectExtractionRepairProposals(
  context: ExtractionRepairContext,
): ExtractionRepairProposal[] {
  const sourceById = new Map(
    context.segments.map((segment) => [segment.id, segment.text]),
  );
  const proposals: ExtractionRepairProposal[] = [];

  for (const unmappable of context.extraction.unmappableClaims) {
    const candidates = (unmappable.candidateLabels ?? []).map((label) => ({
      id: "",
      description: `Add ${label} to the next reviewed corpus glossary`,
      patch: { operation: "add-glossary-label" as const, label },
      evidence: `the extractor proposed ${label} from segment ${unmappable.segmentId}`,
    }));
    proposals.push(
      proposal(
        "glossary-addition",
        unmappable.reason,
        candidates,
        unmappable.segmentId,
      ),
    );
  }

  for (const outcome of context.extraction.outcomes) {
    if (outcome.accepted) continue;
    const source = sourceById.get(outcome.segmentId) ?? "";
    const distinction = distinctionProposal(
      outcome,
      source,
      context.extraction.glossary,
    );
    if (distinction) proposals.push(distinction);
    const axisValue = axisValueProposal(
      outcome,
      source,
      context.extraction.glossary,
    );
    if (axisValue) proposals.push(axisValue);
    if (outcome.rejectionKind === "attribution") {
      proposals.push(
        proposal(
          "attribution-holder",
          outcome.rejection ?? "claim attribution is missing or invalid",
          attributionCandidates(source, context.extraction.glossary),
          outcome.segmentId,
        ),
      );
    }
  }

  for (const issue of context.attributionIssues ?? []) {
    const source = sourceById.get(issue.segmentId) ?? "";
    proposals.push(
      proposal(
        "attribution-holder",
        issue.reason,
        attributionCandidates(source, context.extraction.glossary),
        issue.segmentId,
      ),
    );
  }

  for (const suggestion of context.predicateAliasSuggestions ?? []) {
    proposals.push(
      proposal(
        "predicate-bridge",
        `predicate ${suggestion.source} is semantically close to ${suggestion.target} but remains structurally separate`,
        [
          {
            id: "",
            description: `Bridge ${suggestion.source} to ${suggestion.proposedCanonical}`,
            patch: {
              operation: "add-ontology-alias",
              source: suggestion.source,
              canonical: suggestion.proposedCanonical,
            },
            evidence: `embedding similarity ${suggestion.similarity.toFixed(3)}; ${suggestion.severity} because the symbols ${
              suggestion.severity === "critical" ? "do not share" : "share"
            } an assertion block`,
          },
        ],
      ),
    );
  }

  return proposals;
}

function patchLabels(candidate: ExtractionRepairCandidate): string[] {
  switch (candidate.patch.operation) {
    case "add-glossary-label":
      return [candidate.patch.label];
    case "replace-distinction-values":
      return [...candidate.patch.values];
    case "replace-role-value":
      return [candidate.patch.value];
    case "set-attribution":
      return [candidate.patch.positionId];
    case "add-ontology-alias":
      return [candidate.patch.source, candidate.patch.canonical];
  }
}

function sourceSpanDistance(
  source: string,
  candidate: ExtractionRepairCandidate,
): number | null {
  const normalized = source.toLocaleLowerCase();
  const positions = patchLabels(candidate)
    .map((label) => normalized.indexOf(label.replace(/[-_]+/g, " ").toLocaleLowerCase()))
    .filter((index) => index >= 0);
  return positions.length > 0 ? Math.min(...positions) : null;
}

function orderCandidates(
  candidates: readonly ExtractionRepairCandidate[],
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): ExtractionRepairCandidate[] {
  const glossaryLabels = new Set(glossary.map(({ label }) => label));
  return candidates
    .map((candidate) => {
      const ranking = {
        editCount: 1,
        exactGlossaryReuse: patchLabels(candidate).every((label) =>
          glossaryLabels.has(label),
        ),
        sourceSpanDistance: sourceSpanDistance(source, candidate),
      };
      return { ...candidate, ranking };
    })
    .sort(
      (a, b) =>
        a.ranking!.editCount - b.ranking!.editCount ||
        Number(b.ranking!.exactGlossaryReuse) -
          Number(a.ranking!.exactGlossaryReuse) ||
        (a.ranking!.sourceSpanDistance ?? Number.MAX_SAFE_INTEGER) -
          (b.ranking!.sourceSpanDistance ?? Number.MAX_SAFE_INTEGER) ||
        JSON.stringify(a.patch).localeCompare(JSON.stringify(b.patch)),
    );
}

function roleValues(claim: ExtractedClaim): string[] {
  return Object.values(claim.roles ?? {}).flatMap((raw) =>
    (Array.isArray(raw) ? raw : [raw]).map(String),
  );
}

function sourceCoverage(
  claim: ExtractedClaim,
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): number {
  const byLabel = new Map(glossary.map((entry) => [entry.label, entry]));
  return roleValues(claim).filter((label) => {
    const entry = byLabel.get(label);
    return sourceMentions(source, label) || (!!entry && entryMentioned(source, entry));
  }).length;
}

function integrityFailures(
  claim: ExtractedClaim,
  source: string,
  glossary: readonly ClosedGlossaryEntry[],
): string[] {
  return [
    claimSchemaIssue(claim),
    claimSourceSemanticIssue(claim, source),
    claimAttributionIssue(claim, source),
    claimVocabularyIssue(claim, glossary),
  ].filter((failure): failure is string => !!failure);
}

function applyCandidate(
  claim: ExtractedClaim,
  candidate: ExtractionRepairCandidate,
): ExtractedClaim | null {
  const patched = normalizeClaimExtras(structuredClone(claim));
  switch (candidate.patch.operation) {
    case "replace-distinction-values":
      if (patched.kind !== "distinction") return null;
      patched.roles.distinguished = [...candidate.patch.values];
      return patched;
    case "replace-role-value":
      if (!(candidate.patch.role in patched.roles)) return null;
      patched.roles[candidate.patch.role] = candidate.patch.value;
      return patched;
    case "set-attribution":
      patched.scope = candidate.patch.scope;
      patched.positionId = candidate.patch.positionId;
      return patched;
    case "add-glossary-label":
    case "add-ontology-alias":
      // These alter semantic dependencies and require fresh extraction or
      // explicit ontology acceptance; changing the failed claim here would be
      // the same false-success shortcut this validator replaces.
      return null;
  }
}

function targetOutcome(
  repair: ExtractionRepairProposal,
  context: ExtractionRepairContext,
): ExtractionOutcome | undefined {
  return context.extraction.outcomes.find(
    (outcome) =>
      !outcome.accepted &&
      outcome.segmentId === repair.segmentId &&
      outcome.rejection === repair.failure,
  );
}

function validateCandidate(
  repair: ExtractionRepairProposal,
  candidate: ExtractionRepairCandidate,
  context: ExtractionRepairContext,
): ExtractionRepairCandidate["counterfactual"] {
  const source =
    context.segments.find(({ id }) => id === repair.segmentId)?.text ?? "";
  const target = targetOutcome(repair, context);
  if (!target) {
    return {
      status: "not-applicable",
      validator: "claim-integrity-v1",
      beforeFailures: [],
      afterFailures: [],
      sourceCoverageBefore: 0,
      sourceCoverageAfter: 0,
      reason: "no concrete rejected claim is available for isolated revalidation",
    };
  }
  const patched = applyCandidate(target.claim, candidate);
  const beforeFailures = integrityFailures(
    target.claim,
    source,
    context.extraction.glossary,
  );
  const sourceCoverageBefore = sourceCoverage(
    target.claim,
    source,
    context.extraction.glossary,
  );
  if (!patched) {
    return {
      status: "not-applicable",
      validator: "claim-integrity-v1",
      beforeFailures,
      afterFailures: beforeFailures,
      sourceCoverageBefore,
      sourceCoverageAfter: sourceCoverageBefore,
      reason: "candidate requires fresh extraction or audited ontology acceptance",
    };
  }
  const afterFailures = integrityFailures(
    patched,
    source,
    context.extraction.glossary,
  );
  const sourceCoverageAfter = sourceCoverage(
    patched,
    source,
    context.extraction.glossary,
  );
  const validated =
    beforeFailures.length > 0 &&
    afterFailures.length === 0 &&
    sourceCoverageAfter >= sourceCoverageBefore;
  return {
    status: validated ? "validated" : "rejected",
    validator: "claim-integrity-v1",
    beforeFailures,
    afterFailures,
    sourceCoverageBefore,
    sourceCoverageAfter,
    patchedClaim: patched,
    ...(validated
      ? {}
      : {
          reason:
            afterFailures.length > 0
              ? "the patched copy still fails an extraction integrity validator"
              : sourceCoverageAfter < sourceCoverageBefore
                ? "the patched copy reduces exact source coverage"
                : "the original failure was not reproduced by the validator",
        }),
  };
}

/**
 * Validate concrete patches on isolated copies. The abductive oracle parameter
 * remains API-compatible, but is intentionally not called until a future
 * adapter can express real typed consequences and integrity constraints.
 */
export async function proposeExtractionRepairs(
  context: ExtractionRepairContext,
  _oracle?: AbductiveRepairOracle,
): Promise<ExtractionRepairReport> {
  const all = collectExtractionRepairProposals(context);
  const ranked = all.slice(0, MAX_REPAIR_QUERIES);
  let abductiveCalls = 0;
  let oracleFailures = 0;
  let validatorCalls = 0;
  let validatorBudgetExhausted = false;

  for (const repair of ranked) {
    const source =
      context.segments.find(({ id }) => id === repair.segmentId)?.text ?? "";
    repair.candidates = orderCandidates(
      repair.candidates,
      source,
      context.extraction.glossary,
    );
    for (const candidate of repair.candidates) {
      if (validatorCalls >= MAX_VALIDATOR_CALLS) {
        validatorBudgetExhausted = true;
        break;
      }
      validatorCalls++;
      candidate.counterfactual = validateCandidate(repair, candidate, context);
    }
    const validated = repair.candidates.filter(
      ({ counterfactual }) => counterfactual?.status === "validated",
    );
    if (validated.length > 0) {
      repair.selectedCandidateId = validated[0]!.id;
      repair.selectedBy = "counterfactual-validator";
      repair.status = "counterfactually-validated";
    } else if (repair.candidates.length === 0) {
      // Nothing was ever built. Do not call that "unresolved" — see
      // ExtractionRepairProposal.noCandidateReason.
      repair.status = "no-candidate";
      repair.noCandidateReason = noCandidateReason(repair.kind);
    } else {
      repair.status = "unresolved";
    }
    if (validatorBudgetExhausted) break;
  }

  // Proposals beyond the query cap were never examined, so they are neither
  // validated nor closed; leave them alone and let `truncated` say so.
  for (const repair of all.slice(ranked.length)) {
    if (repair.candidates.length === 0) {
      repair.status = "no-candidate";
      repair.noCandidateReason = noCandidateReason(repair.kind);
    }
  }

  const candidateless = all.filter(
    (repair) => repair.status === "no-candidate",
  );
  return {
    mode: "propose-only",
    proposals: all,
    abductiveCalls,
    oracleFailures,
    validatorCalls,
    truncated: all.length > ranked.length || validatorBudgetExhausted,
    candidatelessProposals: candidateless.length,
    repairRouteExhausted:
      all.length > 0 && candidateless.length === all.length,
    humanActionRequired: candidateless.map(
      (repair) =>
        `${repair.kind}${repair.segmentId ? ` @ ${repair.segmentId}` : ""}: ${repair.noCandidateReason}`,
    ),
  };
}
