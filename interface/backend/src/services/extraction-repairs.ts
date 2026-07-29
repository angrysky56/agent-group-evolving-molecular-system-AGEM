import type {
  ClosedGlossaryEntry,
  ExtractionOutcome,
  ExtractionReport,
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
}

export interface ExtractionRepairProposal {
  kind: ExtractionRepairKind;
  segmentId?: string;
  failure: string;
  candidates: ExtractionRepairCandidate[];
  selectedCandidateId?: string;
  selectedBy?: "mcp-logic:abductive_explain";
  explainsFailure?: boolean;
  status: "proposed" | "unresolved" | "oracle-failed";
  /** Repairs are suggestions until a human or audited ontology approves them. */
  applied: false;
  oracleError?: string;
}

export interface ExtractionRepairReport {
  mode: "propose-only";
  proposals: ExtractionRepairProposal[];
  abductiveCalls: number;
  oracleFailures: number;
  truncated: boolean;
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

/** Rank each bounded repair set with mcp-logic abduction, without applying it. */
export async function proposeExtractionRepairs(
  context: ExtractionRepairContext,
  oracle: AbductiveRepairOracle,
): Promise<ExtractionRepairReport> {
  const all = collectExtractionRepairProposals(context);
  const ranked = all.slice(0, MAX_REPAIR_QUERIES);
  let abductiveCalls = 0;
  let oracleFailures = 0;

  for (const repair of ranked) {
    if (repair.candidates.length === 0) continue;
    const formulas = repair.candidates.map((_, index) => `repair_${index}`);
    const observation = "failure_resolved";
    try {
      abductiveCalls++;
      const raw = await oracle({
        observation,
        candidates: formulas,
        background: formulas.map((formula) => `${formula} -> ${observation}`),
        max_complexity: 8,
      });
      const result = JSON.parse(raw) as {
        best_explanation?: unknown;
        explains_observation?: unknown;
        error?: unknown;
      };
      if (result.error) throw new Error(String(result.error));
      const match =
        typeof result.best_explanation === "string"
          ? result.best_explanation.match(/^repair_(\d+)$/)
          : null;
      const selected = match ? repair.candidates[Number(match[1])] : undefined;
      if (!selected || result.explains_observation !== true) {
        repair.status = "unresolved";
        repair.explainsFailure = false;
        continue;
      }
      repair.selectedCandidateId = selected.id;
      repair.selectedBy = "mcp-logic:abductive_explain";
      repair.explainsFailure = true;
      repair.status = "proposed";
    } catch (error) {
      oracleFailures++;
      repair.status = "oracle-failed";
      repair.oracleError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mode: "propose-only",
    proposals: all,
    abductiveCalls,
    oracleFailures,
    truncated: all.length > ranked.length,
  };
}
