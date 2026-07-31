/**
 * claim-extractor.ts
 *
 * Segments in, schema-validated claims out.
 *
 * WHAT THIS REPLACES
 *   Block proposal used to run: prose -> lemma bag -> Louvain community -> a
 *   list of top lemmas -> a model reconstructs what that list might have meant
 *   -> first-order logic. Two lossy hops with a model guessing at each end.
 *   Reconstruction is underdetermined, so the same corpus produced 3, then 6,
 *   then 2 contradictions across three runs, and IIT/GWT flipped from
 *   contradictory to consistent because the exclusion silently vanished.
 *
 *   Here pass one reads the whole corpus and closes the formal vocabulary;
 *   pass two reads each SENTENCE and emits typed claims by forced choice. There
 *   is no reconstruction step or permission to mint a surface-derived symbol,
 *   and the schema rejects claims whose shape is wrong rather than accepting
 *   them and being wrong later.
 *
 * THE INVARIANT
 *   Nothing enters the store that the schema will not accept. A dropped
 *   exclusion, an unsigned causal claim, a claim with no source sentence — all
 *   fail at write time with a constraint violation, and the failure is
 *   REPORTED, not swallowed. A rejected claim is a finding about the
 *   extraction, not an incident to hide.
 */

import { getActiveProvider } from "./llm.js";
import { convertSingleQuotedStrings } from "#agem/lcm/jsonRepair.js";
import { classifyError } from "./recovery-protocol.js";
import {
  loadPersistedGlossary,
  persistGlossary,
} from "./glossary-store.js";
import { claimStore } from "./typedb-claims.js";
import { settings } from "../config.js";
import { isOkResponse } from "@typedb/driver-http";
import { createHash } from "node:crypto";

/** Claim shapes the schema accepts. Kept in lockstep with schema/claims.tql. */
export type ClaimKind =
  | "distinction"
  | "dissociation"
  | "identity-claim"
  | "exclusion"
  | "joint-incompatibility"
  | "causal-claim"
  | "property-assertion"
  | "entailment";

/** Versioned inputs that participate in extraction replay identity. */
export const CLAIM_EXTRACTION_PROMPT_VERSION = "closed-glossary-v3-joint-incompatibility";
export const CLAIM_SCHEMA_VERSION = "claims-typeql-v3-joint-incompatibility";
export const CLAIM_SEGMENTATION_VERSION = "assertion-segments-v2";
export const CLAIM_SOURCE_SEMANTIC_VALIDATOR_VERSION =
  "source-semantics-v3-joint-incompatibility";
export const CLAIM_FORMALIZER_VERSION =
  "claim-propositions-v3-joint-incompatibility";

export type ClaimScope = "corpus" | "position";

export interface ExtractedClaim {
  kind: ClaimKind;
  /** Role name -> concept label. Role names must match the schema exactly. */
  roles: Record<string, string | string[]>;
  /** Who commits to the proposition. Never infer this from a graph community. */
  scope: ClaimScope;
  /** Required exactly when scope is `position`. */
  positionId?: string;
  modality?: "epistemic" | "modal" | "functional" | "metaphysical";
  polarity?: "asserts" | "denies";
  differenceKind?: "in-kind" | "in-degree";
}

export interface ExtractionOutcome {
  segmentId: string;
  /** Content-addressed entry in ExtractionReport.sourceSegments. */
  sourceSegmentId?: string;
  claim: ExtractedClaim;
  /** Concrete graph relation occurrence used by evidences links. */
  claimId?: string;
  /** Stable structural identity used for exact cross-run overlap. */
  claimKey?: string;
  accepted: boolean;
  /** Pipeline stage that rejected the claim, for cause-specific reporting. */
  rejectionKind?: "schema" | "attribution" | "vocabulary" | "storage";
  /** Constraint violation text when the schema refused the claim. */
  rejection?: string;
}

/** One corpus-scoped symbol selected before any claim extraction begins. */
export interface ClosedGlossaryEntry {
  /** Exact role label the claim pass must use. */
  label: string;
  /** Axes are metadata only; their values, never the heading, fill claim roles. */
  kind:
    | "entity"
    | "property"
    | "relation"
    | "constraint"
    | "axis"
    | "axis-value";
  /** Human-auditable meaning used by the claim pass for forced choice. */
  definition: string;
  /** Surface forms this entry intentionally collapses. */
  sourceForms: string[];
  /** Required on an axis-value and names its metadata-only axis entry. */
  axis?: string;
  /** Categorical axes use distinct values; signed axes assert/deny one property. */
  axisEncoding?: "categorical" | "signed-property";
  /** Required on an axis and names its eligible value/property labels. */
  values?: string[];
}

export interface UnmappableClaim {
  segmentId: string;
  /** Content-addressed entry in ExtractionReport.sourceSegments. */
  sourceSegmentId?: string;
  reason: string;
  /** Source-grounded glossary additions for propose-only repair. */
  candidateLabels?: string[];
}

export interface ExtractionSourceSegment {
  /** Content identity; repeated text is stored once even if it has several input IDs. */
  sourceSegmentId: string;
  segmentIds: string[];
  text: string;
  textHash: string;
  chars: number;
  truncated: false;
  redacted: false;
}

export interface ParseFailureOutcome {
  segmentId: string;
  sourceSegmentId: string;
  reason: "unparseable-provider-output";
}

export interface ExtractionReplayManifest {
  corpusId: string;
  corpusHash: string;
  segmentationVersion: string;
  promptVersion: string;
  schemaVersion: string;
}

export interface ExtractionReport {
  segmentsProcessed: number;
  claimsProposed: number;
  claimsAccepted: number;
  claimsRejected: number;
  outcomes: ExtractionOutcome[];
  /** Segments the model returned unparseable output for. */
  parseFailures: string[];
  parseFailureOutcomes: ParseFailureOutcome[];
  /** Deduplicated, lossless source table for every extraction outcome. */
  sourceSegments: ExtractionSourceSegment[];
  replayManifest: ExtractionReplayManifest;
  /** Immutable corpus-wide vocabulary used for every extraction batch. */
  glossary: ClosedGlossaryEntry[];
  /** Set when pass one could not establish a closed vocabulary. */
  glossaryFailure?: string;
  /** True when pass one's JSON needed syntactic repair to be usable. */
  glossaryRepaired?: boolean;
  /** Entries pass one produced that failed validation and were left out. */
  glossaryDropped?: Array<{ label: string; why: string }>;
  /**
   * Set when the vocabulary was reused rather than recast.
   *
   * Reported because a reused sieve changes what the run means: the same
   * corpus measured twice with the same instrument is a repeat measurement,
   * whereas two fresh castings are two different instruments and their
   * disagreement says nothing about the material.
   */
  glossaryReused?: {
    corpusHash: string;
    entries: number;
    firstCastAt: string;
    extendedTimes: number;
  };
  /**
   * The one vocabulary-extension round, when claims arrived that the first
   * glossary could not express. Reported in full: what was asked for, what was
   * added, what was refused and why. An extended vocabulary changes the
   * ontology fingerprint in `verificationDependencies`, so a finding derived
   * under it remains distinguishable from one derived under the original.
   */
  glossaryExtension?: {
    requested: number;
    additions: Array<{ label: string; kind: string; definition: string }>;
    rejected: Array<{ label: string; why: string }>;
    /** Claims still unmappable after the extension. */
    remapped?: number;
  };
  /** Explicit claims the model could not map without inventing a symbol. */
  unmappableClaims: UnmappableClaim[];
  telemetry: ExtractionTelemetry;
}

export interface ExtractionTelemetry {
  glossaryMs: number;
  proposalMs: number;
  persistenceMs: number;
  totalMs: number;
  glossaryCalls: number;
  batchCalls: number;
  fallbackBatches: number;
  fallbackSegmentCalls: number;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
  /** Audited aliases and canonicals that pass one must honor. */
  ontology?: Readonly<Record<string, string>>;
}

/** Stable assertion-holder identity. Holder spelling is display data, not identity. */
export function canonicalPositionId(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

/** Accept the two JSON shapes inexpensive models commonly emit. */
export function parseClaimArray(value: unknown): ExtractedClaim[] | null {
  if (Array.isArray(value)) return value as ExtractedClaim[];
  if (!value || typeof value !== "object") return null;
  const claims = (value as { claims?: unknown }).claims;
  return Array.isArray(claims) ? (claims as ExtractedClaim[]) : null;
}

interface SegmentProposal {
  claims: ExtractedClaim[];
  unmappable: Array<{ reason: string; candidateLabels: string[] }>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSourceTable(
  segments: readonly { id: string; text: string }[],
): {
  sourceSegments: ExtractionSourceSegment[];
  sourceIdBySegmentId: Map<string, string>;
} {
  const byText = new Map<string, ExtractionSourceSegment>();
  const sourceIdBySegmentId = new Map<string, string>();
  for (const segment of segments) {
    const textHash = sha256(segment.text);
    let record = byText.get(segment.text);
    if (!record) {
      record = {
        sourceSegmentId: `source-segment:${textHash}`,
        segmentIds: [],
        text: segment.text,
        textHash,
        chars: segment.text.length,
        truncated: false,
        redacted: false,
      };
      byText.set(segment.text, record);
    }
    record.segmentIds.push(segment.id);
    sourceIdBySegmentId.set(segment.id, record.sourceSegmentId);
  }
  return { sourceSegments: [...byText.values()], sourceIdBySegmentId };
}

/** Parse the closed-pass envelope while retaining old array responses. */
export function parseSegmentProposal(
  value: unknown,
  requireUnmappableField = false,
): SegmentProposal | null {
  const claims = parseClaimArray(value);
  if (!claims) return null;
  if (Array.isArray(value)) {
    return requireUnmappableField ? null : { claims, unmappable: [] };
  }

  const raw = (value as { unmappable?: unknown }).unmappable;
  if (raw === undefined) {
    return requireUnmappableField ? null : { claims, unmappable: [] };
  }
  if (!Array.isArray(raw)) return null;
  const unmappable: SegmentProposal["unmappable"] = [];
  for (const item of raw) {
    const reason =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object"
          ? String((item as { reason?: unknown }).reason ?? "").trim()
          : "";
    if (!reason) return null;
    const rawCandidates =
      item && typeof item === "object"
        ? (item as { candidateLabels?: unknown }).candidateLabels
        : undefined;
    if (rawCandidates !== undefined && !Array.isArray(rawCandidates)) return null;
    const candidateLabels = [
      ...new Set(
        (Array.isArray(rawCandidates) ? rawCandidates : [])
          .filter((candidate): candidate is string => typeof candidate === "string")
          .map((candidate) => candidate.trim())
          .filter((candidate) => GLOSSARY_LABEL.test(candidate)),
      ),
    ].sort();
    unmappable.push({ reason, candidateLabels });
  }
  return { claims, unmappable };
}

const GLOSSARY_LABEL = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const formalSymbol = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
const PRONOUN_LABELS = new Set([
  "he",
  "her",
  "hers",
  "him",
  "his",
  "it",
  "its",
  "itself",
  "she",
  "that",
  "their",
  "theirs",
  "them",
  "themselves",
  "they",
  "this",
  "those",
]);

/** Strictly parse pass one's auditable, immutable vocabulary. */
/**
 * Parse a glossary, keeping the entries that are valid and NAMING the rest.
 *
 * `parseClosedGlossary` is all-or-nothing: any malformed entry returns null.
 * On a forty-entry vocabulary that means one bad definition discards
 * thirty-nine good ones and the run ends with no vocabulary at all. Observed
 * live (2026-07-31T06-00-34): 118 seconds of generation, `schema-invalid`,
 * glossary size 0, on a corpus that had extracted cleanly four runs running.
 *
 * Why partial acceptance is honest here, when repairing a TRUNCATED glossary
 * was not: a truncated response never generated its missing entries, so the
 * shortfall is unknowable and silent. A schema-invalid entry exists, is
 * visible, and can be named — "dropped `x` because it has no definition". A
 * vocabulary that is visibly shorter for stated reasons is a different thing
 * from one that is silently shorter.
 *
 * It also self-corrects: pass two will report the dropped concepts as
 * unmappable or mint them as out-of-glossary labels, and both now feed the
 * extension round, which can re-add them properly formed.
 *
 * Implemented by feeding the STRICT parser incrementally rather than
 * duplicating its rules, so partial acceptance can never diverge from strict
 * semantics. The retry loop exists because entry order matters — an axis whose
 * values appear later in the array is invalid until they arrive.
 */
export function parseClosedGlossaryPartial(value: unknown): {
  entries: ClosedGlossaryEntry[];
  dropped: Array<{ label: string; why: string }>;
} {
  const strict = parseClosedGlossary(value);
  if (strict) return { entries: strict, dropped: [] };

  const raw = (value as { glossary?: unknown })?.glossary;
  if (!Array.isArray(raw)) return { entries: [], dropped: [] };

  const accepted: unknown[] = [];
  let pending = [...raw];
  const dropped: Array<{ label: string; why: string }> = [];

  // Keep sweeping while any entry newly becomes admissible. An axis rejected
  // on pass one because its values had not appeared yet is accepted on pass
  // two once they have.
  let progressed = true;
  while (progressed && pending.length > 0) {
    progressed = false;
    const stillPending: unknown[] = [];
    for (const candidate of pending) {
      if (parseClosedGlossary({ glossary: [...accepted, candidate] })) {
        accepted.push(candidate);
        progressed = true;
      } else {
        stillPending.push(candidate);
      }
    }
    pending = stillPending;
  }

  for (const reject of pending) {
    const label = String(
      (reject as { label?: unknown })?.label ?? "(unlabelled entry)",
    );
    dropped.push({
      label,
      why: "entry is missing a required field, uses an unknown kind, duplicates another label, or references an axis/value that is not present",
    });
  }
  return {
    entries: parseClosedGlossary({ glossary: accepted }) ?? [],
    dropped,
  };
}

export function parseClosedGlossary(value: unknown): ClosedGlossaryEntry[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { glossary?: unknown }).glossary;
  if (!Array.isArray(raw)) return null;
  const labels = new Set<string>();
  const symbolKeys = new Set<string>();
  const entries: ClosedGlossaryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const source = item as {
      label?: unknown;
      kind?: unknown;
      definition?: unknown;
      sourceForms?: unknown;
      axis?: unknown;
      axisEncoding?: unknown;
      values?: unknown;
    };
    const label = String(source.label ?? "").trim();
    const kind = String(source.kind ?? "").trim() as ClosedGlossaryEntry["kind"];
    const definition = String(source.definition ?? "").trim();
    const labelTokens = label.split(/[-_]+/);
    const symbolKey = formalSymbol(label);
    if (
      !GLOSSARY_LABEL.test(label) ||
      ![
        "entity",
        "property",
        "relation",
        "constraint",
        "axis",
        "axis-value",
      ].includes(kind) ||
      labelTokens.some((token) => PRONOUN_LABELS.has(token)) ||
      !definition ||
      labels.has(label) ||
      symbolKeys.has(symbolKey)
    ) {
      return null;
    }
    if (source.sourceForms !== undefined && !Array.isArray(source.sourceForms)) {
      return null;
    }
    const sourceForms = [
      ...new Set(
        (Array.isArray(source.sourceForms) ? source.sourceForms : [])
          .filter((form): form is string => typeof form === "string")
          .map((form) => form.trim())
          .filter(Boolean),
      ),
    ].sort();
    const axis = typeof source.axis === "string" ? source.axis.trim() : undefined;
    const axisEncoding =
      source.axisEncoding === "categorical" || source.axisEncoding === "signed-property"
        ? source.axisEncoding
        : undefined;
    if (axis !== undefined && !GLOSSARY_LABEL.test(axis)) return null;
    if (source.values !== undefined && !Array.isArray(source.values)) return null;
    const values = [
      ...new Set(
        (Array.isArray(source.values) ? source.values : [])
          .filter((axisValue): axisValue is string => typeof axisValue === "string")
          .map((axisValue) => axisValue.trim())
          .filter(Boolean),
      ),
    ];
    if (
      kind === "axis" &&
      (axis !== undefined ||
        !axisEncoding ||
        (axisEncoding === "categorical" ? values.length < 2 : values.length !== 1))
    ) {
      return null;
    }
    if (kind === "axis-value" && (!axis || values.length > 0)) return null;
    if (
      kind !== "axis" &&
      kind !== "axis-value" &&
      (axis || axisEncoding || values.length > 0)
    ) {
      return null;
    }
    if (kind !== "axis" && axisEncoding) return null;
    labels.add(label);
    symbolKeys.add(symbolKey);
    entries.push({
      label,
      kind,
      definition,
      sourceForms,
      ...(axis ? { axis } : {}),
      ...(axisEncoding ? { axisEncoding } : {}),
      ...(values.length > 0 ? { values } : {}),
    });
  }
  const byLabel = new Map(entries.map((entry) => [entry.label, entry]));
  for (const entry of entries) {
    if (entry.kind === "axis") {
      if (entry.axisEncoding === "categorical") {
        if (
          entry.values!.some(
            (axisValue) =>
              byLabel.get(axisValue)?.kind !== "axis-value" ||
              byLabel.get(axisValue)?.axis !== entry.label,
          )
        ) {
          return null;
        }
      } else if (byLabel.get(entry.values![0])?.kind !== "property") return null;
    } else if (entry.kind === "axis-value") {
      const parent = byLabel.get(entry.axis!);
      if (parent?.kind !== "axis" || !parent.values?.includes(entry.label)) return null;
    }
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The role labels a claim used that are not in the closed glossary.
 *
 * `claimVocabularyIssue` returns prose for the rejection message; this returns
 * the labels themselves, because they are exactly the vocabulary the extension
 * round needs to consider.
 *
 * A minted label and an unmappable claim are the SAME signal wearing different
 * clothes: both say the closed vocabulary cannot express what the segment
 * asserts. The first says it by trying anyway, the second by declining. The
 * consciousness run reported 18 of the first and the extension round ignored
 * every one of them, because it only listened for the second.
 */
export function claimVocabularyOffenders(
  claim: ExtractedClaim,
  glossary: readonly ClosedGlossaryEntry[],
): string[] {
  const allowed = new Set(
    glossary.filter(({ kind }) => kind !== "axis").map(({ label }) => label),
  );
  const axisLabels = new Set(
    glossary.filter(({ kind }) => kind === "axis").map(({ label }) => label),
  );
  const roleValues = Object.values(claim.roles ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
  return [
    ...new Set(
      roleValues.filter(
        // An axis label used as a role is a different mistake — the value
        // exists, it was just the wrong one — so it is not a vocabulary gap.
        (value) => !allowed.has(value) && !axisLabels.has(value),
      ),
    ),
  ].sort();
}

/** Reject any claim that escaped pass two with a newly minted role label. */
export function claimVocabularyIssue(
  claim: ExtractedClaim,
  glossary: readonly ClosedGlossaryEntry[],
): string | null {
  const allowed = new Set(
    glossary.filter(({ kind }) => kind !== "axis").map(({ label }) => label),
  );
  const roleValues = Object.values(claim.roles ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);
  const axisLabels = new Set(
    glossary.filter(({ kind }) => kind === "axis").map(({ label }) => label),
  );
  const usedAxes = roleValues.filter((value) => axisLabels.has(value));
  if (usedAxes.length > 0) {
    return `closed vocabulary: metadata-only axis label(s) cannot fill claim roles; choose the declared value/property and structural polarity: ${[
      ...new Set(usedAxes),
    ]
      .sort()
      .join(", ")}`;
  }
  const outside = roleValues.filter((value) => !allowed.has(value));
  return outside.length > 0
    ? `closed vocabulary: role label(s) not in the corpus glossary: ${[
        ...new Set(outside),
      ]
        .sort()
        .join(", ")}`
    : null;
}

/**
 * Repair cheap-model envelope drift, then remove metadata the relation does not own.
 * This is deliberately structural: it never guesses semantic aliases.
 */
export function normalizeClaimExtras(claim: ExtractedClaim): ExtractedClaim {
  const source = claim as unknown as Record<string, unknown> & {
    kind: ClaimKind;
    roles?: Record<string, string | string[]>;
    extra?: { polarity?: unknown; differenceKind?: unknown };
    scope?: unknown;
  };
  const normalized = {
    ...claim,
    roles: { ...(claim.roles ?? {}) },
  } as ExtractedClaim & { extra?: unknown };
  const roleNamesByKind: Partial<Record<ClaimKind, string[]>> = {
    distinction: ["distinguished"],
    dissociation: ["dissociable"],
    "identity-claim": ["identified", "identified-with"],
    exclusion: ["excluder", "excluded"],
    "joint-incompatibility": ["incompatible"],
    "causal-claim": ["cause", "effect"],
    "property-assertion": ["subject", "property"],
    entailment: ["antecedent", "consequent"],
  };
  for (const role of roleNamesByKind[normalized.kind] ?? []) {
    const flattened = source[role];
    if (
      normalized.roles[role] === undefined &&
      (typeof flattened === "string" ||
        (Array.isArray(flattened) && flattened.every((value) => typeof value === "string")))
    ) {
      normalized.roles[role] = flattened as string | string[];
    }
    delete (normalized as unknown as Record<string, unknown>)[role];
  }
  if (source.scope && typeof source.scope === "object") {
    const rawScope = source.scope as { positionId?: unknown; type?: unknown };
    const scopedPosition =
      typeof rawScope.positionId === "string"
        ? rawScope.positionId.trim()
        : "";
    if (scopedPosition) normalized.scope = "position";
    else if (rawScope.type === "corpus") normalized.scope = "corpus";
    else delete (normalized as unknown as Record<string, unknown>).scope;
    if (scopedPosition && !normalized.positionId) normalized.positionId = scopedPosition;
  }
  /*
   * A taxonomic claim with no holder is corpus-scoped. Supply it.
   *
   * `distinction` and `dissociation` state that two things differ in kind or
   * come apart. That is the corpus's own analytical framework, not something a
   * named position asserts — which is why `claimAttributionIssue` already
   * EXEMPTS both kinds from the attribution-flattening guard. The schema has
   * therefore always treated them as corpus-level; it just refused to say so
   * unless the model spelled it out.
   *
   * Observed on the QM-interpretations run (2026-07-31T01-06-27): the model
   * emitted fourteen structurally identical distinctions over the corpus's
   * stance axes, wrote `"scope":"corpus"` on one, and omitted it on thirteen.
   * The thirteen were perfect — `deterministic`/`stochastic`,
   * `hidden-variables`/`psi-complete` — and all thirteen were rejected for a
   * field with exactly one legal value given the kind and the absence of a
   * positionId.
   *
   * Narrow on purpose. Only these two kinds, and only when the model named no
   * holder: if a positionId is present the claim is attributed and must stay
   * that way. Every other kind still has to declare its scope, because for
   * them "corpus" is a real choice with real consequences, and defaulting it
   * would be the attribution flattening the guard exists to catch.
   */
  if (
    normalized.scope === undefined &&
    !normalized.positionId &&
    (normalized.kind === "distinction" ||
      normalized.kind === "dissociation" ||
      // A joint incompatibility is a claim about the SPACE of positions — the
      // same reason it is exempt from the attribution guard. Frauchiger–Renner
      // was extracted correctly and then rejected for "scope is missing or
      // invalid", the only one of the six theorems lost to a field with
      // exactly one legal value.
      normalized.kind === "joint-incompatibility")
  ) {
    normalized.scope = "corpus";
  }
  const ownsPolarity =
    normalized.kind === "causal-claim" ||
    normalized.kind === "property-assertion" ||
    normalized.kind === "entailment";
  if (
    ownsPolarity &&
    normalized.polarity === undefined &&
    (source.extra?.polarity === "asserts" || source.extra?.polarity === "denies")
  ) {
    normalized.polarity = source.extra.polarity;
  }
  if (
    normalized.kind === "distinction" &&
    normalized.differenceKind === undefined &&
    (source.extra?.differenceKind === "in-kind" ||
      source.extra?.differenceKind === "in-degree")
  ) {
    normalized.differenceKind = source.extra.differenceKind;
  }
  delete normalized.extra;

  // An explicit lexical negator in a property slot is encoding syntax, not a
  // new predicate. Lift it into polarity before formalization.
  const negatedRole =
    normalized.kind === "property-assertion"
      ? "property"
      : normalized.kind === "entailment"
        ? "consequent"
        : undefined;
  if (negatedRole) {
    const value = normalized.roles[negatedRole];
    if (typeof value === "string") {
      const match = value.trim().match(/^(?:no|not|non)[-_\s]+(.+)$/i);
      if (match?.[1]) {
        normalized.roles[negatedRole] = match[1];
        normalized.polarity = "denies";
      }
    }
  }
  if (
    !ownsPolarity
  ) {
    delete normalized.polarity;
  }
  if (normalized.kind !== "distinction") delete normalized.differenceKind;
  return normalized;
}

/**
 * The corpus's own voice, as a holder.
 *
 * A document has an author. That is a fact about documents, not a judgement
 * call, so it does not need a person to decide it and it does not need the
 * model to notice it — this entity is minted deterministically for every
 * corpus.
 *
 * It exists because attribution failures had no repair candidate at all: the
 * repair engine could only propose a holder the segment TEXT names, and a
 * survey writing in its own voice ("the corpus notes the asymmetry") names
 * nobody. The reported remedy was "a corpus-narrator position, which needs a
 * human or an audited ontology" — a remedy the system could have supplied
 * itself, since the narrator is entailed by there being a document.
 */
export const CORPUS_NARRATOR_LABEL = "corpus-narrator";

/** The entity every corpus gets, so its own voice has somewhere to live. */
export function corpusNarratorEntry(): ClosedGlossaryEntry {
  return {
    label: CORPUS_NARRATOR_LABEL,
    kind: "entity",
    definition:
      "the corpus speaking in its own voice — the author's observations, framing and analytical apparatus, as distinct from any position the corpus reports",
    sourceForms: ["the corpus", "this paper", "we", "the author"],
  };
}

/**
 * Does this segment name someone whose claim it is?
 *
 * Exported so the repair engine can ask the same question the attribution
 * guard asks. The narrator may only be proposed when the answer is no: if the
 * text says "Bohm holds that…", the holder is Bohm and attributing it to the
 * corpus's own voice would be the flattening this guard exists to catch.
 */
export function sourceNamesAHolder(sourceText: string): boolean {
  // Same typography trap as the joint-incompatibility cue: "**Bohm** argues"
  // must read as "Bohm argues". Every cue matches on words, never on markup.
  const plain = stripEmphasis(sourceText);
  return (
    ATTRIBUTED_ASSERTION_CUE.test(plain) &&
    !GENERIC_POSITION_RULE_CUE.test(plain)
  );
}

/*
 * Split in two because the flags conflict.
 *
 * The common-noun and "according to" cues must be case-INSENSITIVE: a cue word
 * is capitalised whenever it opens a sentence, which is most of the time.
 * "Critics argue that…", "Proponents of the global workspace claim…",
 * "According to the higher-order view…" all failed to match while the
 * lowercase forms matched, so the attribution-flattening guard was silently
 * under-firing on the most ordinary phrasing there is.
 *
 * The proper-noun cue must stay case-SENSITIVE — `[A-Z]` is how it recognises
 * a name, and adding `i` would make it match any word followed by "argues".
 */
const ATTRIBUTED_COMMON_NOUN_CUE =
  /\b(?:positions?|theorists?|theories|theory|views?|accounts?|models?|camps?|advocates?|proponents?|supporters?|critics?|authors?|researchers?)\b[^.!?]{0,100}\b(?:hold|holds|held|argue|argues|argued|claim|claims|claimed|maintain|maintains|maintained|identify|identifies|identified|deny|denies|denied|assert|asserts|asserted|propose|proposes|proposed|say|says|said)\b|\baccording\s+to\b/i;

const ATTRIBUTED_PROPER_NOUN_CUE =
  /\b[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?\s+(?:argues|claims|maintains|identifies|denies|asserts|proposes|says)\b/;

const ATTRIBUTED_ASSERTION_CUE = {
  test: (text: string): boolean =>
    ATTRIBUTED_COMMON_NOUN_CUE.test(text) ||
    ATTRIBUTED_PROPER_NOUN_CUE.test(text),
};
/**
 * A corpus-level rule about arbitrary positions is not attribution to one holder.
 *
 * The noun list here MUST cover the noun list in ATTRIBUTED_ASSERTION_CUE, or a
 * universal negative gets read as an attributed assertion. It did not include
 * `position`, while the attribution cue did — so "No position can hold all of:
 * locality, …" tripped the attribution guard and was refused as flattening.
 *
 * Every impossibility theorem in the qm-interpretations corpus is phrased that
 * way. All six were extracted correctly as joint-incompatibility claims and all
 * six were then rejected, by a guard whose two halves disagreed about which
 * nouns count. This is the same failure as the missing `i` flag: two regexes
 * that must agree, drifting apart.
 */
const GENERIC_POSITION_RULE_CUE =
  /\b(?:any|every|each|no)\s+(?:positions?|theor(?:y|ies)|views?|accounts?|models?|camps?|subjects?|systems?|interpretations?)\b/i;

/**
 * Deterministic guard against model-elected attribution flattening. The model
 * still extracts the holder, but an obviously attributed source cannot enter
 * the corpus assertion context merely because it returned the wrong scope.
 */
export function claimAttributionIssue(
  claim: ExtractedClaim,
  sourceText = "",
): string | null {
  if (claim.scope !== "corpus" && claim.scope !== "position") {
    return "claim scope is missing or invalid";
  }
  const positionId = claim.positionId?.trim();
  if (claim.scope === "position" && !positionId) {
    return "position-scoped claim is missing positionId";
  }
  if (claim.scope === "corpus" && positionId) {
    return "corpus-scoped claim also names a positionId";
  }
  /*
   * `joint-incompatibility` joins distinction and dissociation as inherently
   * corpus-scoped.
   *
   * "No position can hold all of: locality, definite values, measurement
   * independence, empirical adequacy" is a claim about the SPACE of positions.
   * It is not something a holder asserts, and there is no holder to attribute
   * it to — which is why every published impossibility theorem reads as a
   * universal negative. Treating it as attributable is a category error, and
   * it cost this corpus all six of its theorems.
   */
  if (
    claim.scope === "corpus" &&
    claim.kind !== "distinction" &&
    claim.kind !== "dissociation" &&
    claim.kind !== "joint-incompatibility" &&
    sourceNamesAHolder(sourceText)
  ) {
    return (
      "attribution flattening detected: the source reports what a named holder " +
      "asserts, but the extracted claim was scoped to the corpus"
    );
  }
  return null;
}

const JOINT_INCOMPATIBILITY_CUE =
  /\bno\s+(?:position|theor(?:y|ies)|view|account|model|subject|system)\s+can\s+(?:(?:simultaneously\s+)(?:hold|satisfy|possess|instantiate)(?:\s+all(?:\s+(?:three|four|five|six|\d+))?\s+(?:of\s*)?:?)?|(?:hold|satisfy|possess|instantiate)\s+all(?:\s+(?:three|four|five|six|\d+))?\s+(?:of\s*)?:?)/i;

/**
 * Markdown emphasis, removed before any cue is matched.
 *
 * The corpus states Bell as "No position can hold **all** of: locality, …" and
 * the cue expects `hold\s+all`. ` **all**` is not `\s+all`, so the detector
 * missed the single most important construct in the corpus — and missed it
 * BECAUSE the author had bolded the load-bearing word. Of the five theorems in
 * that file, Bell is the only one that emphasises `all`, and it was the only
 * one not detected.
 *
 * The consequence was total: with no joint-incompatibility required, the model
 * was free to decompose each theorem into unary property assertions, which is
 * exactly what `claimSourceSemanticIssue` exists to forbid. The run extracted
 * 48 property-assertions, 8 distinctions, 1 entailment and ZERO joint
 * incompatibilities from a corpus whose entire subject is six impossibility
 * theorems.
 *
 * Cues are about words, not typography. Strip the markup, then match.
 */
export function stripEmphasis(text: string): string {
  /*
   * Asterisks are safe to remove anywhere — they never appear inside a symbol.
   * Underscores are NOT: `measurement_independence`, `psi_ontic` and `rt_n_k`
   * are identifiers, and a first version of this function turned the first of
   * those into `measurementindependence`. Markdown's own rule is the right one
   * — an underscore between word characters is not emphasis — so `_` is
   * stripped only at a word boundary.
   */
  return text
    .replace(/\*{1,3}/g, "")
    .replace(/(?<![A-Za-z0-9])_{1,3}(?=\S)|(?<=\S)_{1,3}(?![A-Za-z0-9])/g, "");
}

/** True when the source asserts that one subject cannot jointly satisfy a set. */
export function sourceRequiresJointIncompatibility(sourceText = ""): boolean {
  return JOINT_INCOMPATIBILITY_CUE.test(stripEmphasis(sourceText));
}

/** Reject a binary or unary decomposition of an irreducibly n-ary source. */
export function claimSourceSemanticIssue(
  claim: ExtractedClaim,
  sourceText = "",
): string | null {
  if (
    sourceRequiresJointIncompatibility(sourceText) &&
    claim.kind !== "joint-incompatibility"
  ) {
    return (
      "source semantics: a joint incompatibility must remain one n-ary claim; " +
      "binary exclusions, unary properties, and chained entailments change its meaning"
    );
  }
  return null;
}

/**
 * The role vocabulary, derived from the schema rather than restated in prose,
 * so the two cannot drift apart. If a relation gains a role, add it here and
 * the prompt updates with it.
 */
const ROLE_SPEC: Record<ClaimKind, { roles: string[]; extras?: string[]; gloss: string }> = {
  distinction: {
    roles: ["distinguished", "distinguished"],
    extras: ["differenceKind"],
    gloss: "A and B are not the same thing. Use differenceKind 'in-kind' when the text says the difference is categorical rather than a matter of degree.",
  },
  dissociation: {
    roles: ["dissociable", "dissociable"],
    gloss: "A and B can occur without each other. Stronger than a distinction — only use it when the text says they come apart.",
  },
  "identity-claim": {
    roles: ["identified", "identified-with"],
    gloss: "A position asserts that A just IS B (e.g. consciousness is integrated information).",
  },
  exclusion: {
    roles: ["excluder", "excluded"],
    gloss: "A rules out B. THIS IS THE ONE MOST OFTEN MISSED. If the text says one thing holds 'whether or not' another does, or that A is present while B is absent, that is an exclusion. Without it, two rival theories look compatible.",
  },
  "joint-incompatibility": {
    roles: ["incompatible", "incompatible"],
    gloss: "A single subject cannot satisfy all listed members simultaneously. Put the complete set under incompatible as one array; never emit pairwise exclusions or unary denials.",
  },
  "causal-claim": {
    roles: ["cause", "effect"],
    extras: ["polarity"],
    gloss: "A causes B. polarity is REQUIRED: 'asserts' if the text claims the causation holds, 'denies' if it claims it does not. An unsigned causal claim is meaningless.",
  },
  "property-assertion": {
    roles: ["subject", "property"],
    extras: ["polarity"],
    gloss: "A named theory, entity, or position has property B. Use this for 'CDT holds dominance' or 'FDT is lesion-adequate'; do NOT reverse it into an entailment from the property to the theory. polarity is REQUIRED.",
  },
  entailment: {
    roles: ["antecedent", "consequent"],
    extras: ["polarity"],
    gloss: "A implies B, directionally. Set polarity to 'denies' when A implies NOT-B; otherwise omit it or use 'asserts'. Do not encode negation in a role label.",
  },
};

/**
 * Validate the exact relation shape before any TypeDB write is attempted.
 *
 * TypeDB cardinality errors are useful as a last line of defence, but they are
 * too late to diagnose an extraction run: concepts and source segments may
 * already have been written, and the database error does not identify the
 * model-produced claim cleanly. This mirrors the role cardinalities in
 * schema/claims.tql and returns a stable, reportable reason.
 */
export function claimSchemaIssue(claim: ExtractedClaim): string | null {
  const spec = ROLE_SPEC[claim?.kind];
  if (!spec) return `unknown claim kind '${String(claim?.kind)}'`;
  if (!claim.roles || typeof claim.roles !== "object" || Array.isArray(claim.roles)) {
    return `claim kind '${claim.kind}' has no role map`;
  }

  const requiredCounts = new Map<string, number>();
  for (const role of spec.roles) {
    requiredCounts.set(role, (requiredCounts.get(role) ?? 0) + 1);
  }
  const unexpected = Object.keys(claim.roles).filter(
    (role) => !requiredCounts.has(role),
  );
  if (unexpected.length > 0) {
    return (
      `claim kind '${claim.kind}' has unexpected role(s): ` +
      unexpected.sort().join(", ")
    );
  }

  for (const [role, requiredCount] of requiredCounts) {
    const raw = claim.roles[role];
    const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    const distinctCount = new Set(values).size;
    const cardinalityValid =
      requiredCount > 1
        ? distinctCount >= requiredCount
        : values.length === 1 && distinctCount === 1;
    if (!cardinalityValid) {
      /*
       * Name the real cause when the same label was repeated.
       *
       * Observed live (2026-07-31T01-06-27): `{"distinguished":["collapse",
       * "collapse"]}` and the same for `locality`. Reported as "requires at
       * least 2 distinct values; found 1", which reads as a careless model.
       *
       * It is not. A signed-property axis carries exactly ONE label by design
       * — see ClosedGlossaryEntry.axisEncoding, "signed axes assert/deny one
       * property". Asked to express "collapse vs no collapse" from a closed
       * vocabulary containing only `collapse`, the model has no second label
       * to reach for, and duplicating the one it has is the only move
       * available. The vocabulary cannot express the claim; blaming the
       * cardinality points at the symptom.
       */
      /*
       * Only the axis-shaped kinds. A repeated member in a
       * joint-incompatibility is a different mistake with a different cause —
       * that role is a set of co-asserted commitments, not two poles of an
       * axis — so the vocabulary diagnosis would misdirect there.
       */
      const repeated =
        (claim.kind === "distinction" || claim.kind === "dissociation") &&
        requiredCount > 1 &&
        distinctCount === 1 &&
        values.length > 1;
      if (repeated) {
        return (
          `schema cardinality: ${claim.kind} role '${role}' repeated the single label ` +
          `'${values[0]}' ${values.length} times. A two-way distinction cannot be built from ` +
          `one label — this usually means the closed vocabulary holds only one pole of the axis ` +
          `(a signed-property axis carries one label and expresses the other side through ` +
          `polarity). Either state it as a property-assertion with polarity asserts/denies, or ` +
          `mint both poles as axis-values in a reviewed glossary.`
        );
      }
      return (
        `schema cardinality: ${claim.kind} role '${role}' requires ` +
        `${requiredCount > 1 ? `at least ${requiredCount} distinct values` : "exactly 1 value"}; ` +
        `found ${distinctCount}`
      );
    }
  }

  if (
    (claim.kind === "causal-claim" ||
      claim.kind === "property-assertion") &&
    claim.polarity !== "asserts" &&
    claim.polarity !== "denies"
  ) {
    return `schema cardinality: ${claim.kind} requires polarity 'asserts' or 'denies'`;
  }
  if (
    claim.kind === "entailment" &&
    claim.polarity !== undefined &&
    claim.polarity !== "asserts" &&
    claim.polarity !== "denies"
  ) {
    return "schema value: entailment polarity must be 'asserts' or 'denies'";
  }
  if (
    claim.modality !== undefined &&
    !["epistemic", "modal", "functional", "metaphysical"].includes(
      claim.modality,
    )
  ) {
    return `schema value: unsupported modality '${String(claim.modality)}'`;
  }
  if (
    claim.differenceKind !== undefined &&
    claim.differenceKind !== "in-kind" &&
    claim.differenceKind !== "in-degree"
  ) {
    return `schema value: unsupported differenceKind '${String(claim.differenceKind)}'`;
  }
  return null;
}

function glossaryEntry(
  value: string | ClosedGlossaryEntry,
): ClosedGlossaryEntry {
  return typeof value === "string"
    ? { label: value, kind: "property", definition: value, sourceForms: [] }
    : value;
}

/** Pass one: select the vocabulary with the entire corpus in view. */
export function buildCorpusGlossaryPrompt(
  segments: readonly { id: string; text: string }[],
  ontology: Readonly<Record<string, string>> = {},
): string {
  const numbered = segments
    .map(
      (segment, index) =>
        `[${index}] (segmentId=${segment.id}) ${segment.text}`,
    )
    .join("\n");
  const audited = Object.entries(ontology)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, canonical]) => `- ${alias} -> ${canonical}`)
    .join("\n");
  const ontologySection = audited
    ? `\nAUDITED ALIAS MAP (mandatory; use its canonical values):\n${audited}\n`
    : "";

  return `Read the ENTIRE numbered corpus and propose the smallest adequate CLOSED
formal vocabulary for extracting its explicit claims. Output JSON only.

Return exactly this shape:
{"glossary":[{"label":"wavefunction-status","kind":"axis","axisEncoding":"categorical","definition":"the corpus classification axis for the status of psi","sourceForms":["Wavefunction status"],"values":["psi-ontic","psi-epistemic"]},{"label":"psi-ontic","kind":"axis-value","axis":"wavefunction-status","definition":"psi represents an observer-independent physical state","sourceForms":["psi ontic"]},{"label":"psi-epistemic","kind":"axis-value","axis":"wavefunction-status","definition":"psi represents knowledge or information rather than an observer-independent physical state","sourceForms":["psi epistemic"]},{"label":"collapse-status","kind":"axis","axisEncoding":"signed-property","definition":"whether real dynamical collapse occurs","sourceForms":["collapse"],"values":["collapse"]},{"label":"collapse","kind":"property","definition":"a real dynamical collapse occurs","sourceForms":["real collapse","no collapse"]},{"label":"dominance","kind":"property","definition":"a decision rule preferring an act better in every state","sourceForms":["dominance principle","theory that holds dominance"]}]}

Rules:
- Each label is a lowercase hyphenated or underscored canonical symbol. It names
  one concept, not a sentence fragment or lightly slugified noun phrase.
- Collapse paraphrases, inflections, relative clauses, and coreferential
  mentions onto one label. For example, "theory that holds dominance" and
  "theory holding dominance" use the underlying property label "dominance".
- Include every concept needed as a typed claim role, including named theories,
  acts, properties, causes, and effects. Attribution holders are positionId
  metadata and need not be duplicated merely for attribution.
- Classify entries as entity, property, relation, constraint, axis, or axis-value.
  An axis is a category heading such as "wavefunction status" or "outcomes";
  it has no truth value and is metadata only. A categorical binary "X vs Y"
  axis uses axisEncoding "categorical", lists two distinct axis-value labels,
  and each value points back with axis. Never collapse opposed positive values
  such as psi-ontic/psi-epistemic, deterministic/stochastic, or
  single-outcome/many-outcomes.
- A lexical positive/negative opposition such as collapse/no collapse uses
  axisEncoding "signed-property" and lists exactly one positive property label.
  The claim pass asserts or denies that property structurally. Never create a
  no-*, not-*, or non-* label merely to carry grammatical negation.
- Axis headings can NEVER fill a claim role or become a Boolean predicate. A
  position has one of the axis-value properties; it does not assert or deny the
  axis name itself.
- Negation is not a concept. "no act is ratifiable", "not ratifiable", and
  "unratifiable" all use the positive label "ratifiable"; the claim pass records
  denial structurally.
- Pronouns are never labels. Resolve them from the whole-corpus context into the
  entry they refer to; "the act itself" uses the underlying "act" entry rather
  than a new "act-itself" label.
- In particular, never propose surface scaffolds such as
  "theory-that-holds-dominance", "being-total-over-well-posed-problems", or
  "act-itself". Use "dominance", "total-over-well-posed-problems", and "act".
- sourceForms records materially different corpus phrasings intentionally
  collapsed into the entry. For a pronoun or other ambiguous coreference, use
  the form "segmentId=<id>: <surface form>" so pass two retains the resolved
  referent even when it processes that segment in a batch. Do not invent
  background concepts.
${ontologySection}
NUMBERED CORPUS:
${numbered}`;
}

export function buildClaimExtractionPrompt(
  segment: string,
  glossary: readonly (string | ClosedGlossaryEntry)[] = [],
  closedVocabulary = false,
): string {
  const kinds = (Object.entries(ROLE_SPEC) as [ClaimKind, typeof ROLE_SPEC[ClaimKind]][])
    .map(([kind, spec]) => {
      const roles = [...new Set(spec.roles)].join(", ");
      const extras = spec.extras?.length ? `  extra fields: ${spec.extras.join(", ")}\n` : "";
      return `- ${kind}\n  roles: ${roles}\n${extras}  ${spec.gloss}`;
    })
    .join("\n");

  const entries = glossary.map(glossaryEntry);
  const eligibleEntries = entries.filter(({ kind }) => kind !== "axis");
  const axes = entries.filter(({ kind }) => kind === "axis");
  const glossarySection = !closedVocabulary && entries.length === 0
    ? ""
    : `\nCLOSED CORPUS ROLE VOCABULARY (pass one; immutable):\n${eligibleEntries
        .map(
          ({ label, kind, definition, sourceForms, axis }) =>
            `- ${label} [${kind}${axis ? ` of ${axis}` : ""}]: ${definition}${
              sourceForms.length > 0
                ? ` [covers: ${sourceForms.join("; ")}]`
                : ""
            }`,
        )
        .join("\n")}
\nMETADATA-ONLY AXES (never copy an axis label into a claim role):\n${axes
        .map(
          ({ label, definition, values, axisEncoding }) =>
            `- ${label} [${axisEncoding}]: ${definition} [${
              axisEncoding === "signed-property" ? "assert or deny" : "choose one of"
            }: ${(values ?? []).join("; ")}]`,
        )
        .join("\n")}
Every role value MUST be one of the labels above, copied exactly. Forced choice
means no new symbols are permitted. Resolve paraphrases, relativizers, and
pronouns to the matching label. If an explicit claim cannot be represented with
these labels, omit that claim and add
{"reason":"...","candidateLabels":["source-grounded-label"]} to "unmappable"
instead of minting a role label. Candidate labels are repair hypotheses only;
they are never added or applied by this extraction pass.\n`;
  const emptyOutput = closedVocabulary
    ? '{"claims":[],"unmappable":[]}'
    : '{"claims":[]}';
  const outputShape = closedVocabulary
    ? '{"claims":[],"unmappable":[]} when there are no claims, or the same envelope with typed claim objects whose role values are copied exactly from the closed role labels above. An unmappable item has shape {"reason":"why no closed label fits","candidateLabels":["one-or-more source-grounded glossary additions"]}.'
    : '{"claims":[{"kind":"identity-claim","roles":{"identified":"meta-state","identified-with":"thought-like"},"scope":"position","positionId":"HOT"},{"kind":"distinction","roles":{"distinguished":["hard-problem","easy-problems"]},"scope":"corpus","differenceKind":"in-kind"}]}';

  return `Extract the explicit claims from ONE sentence. Output JSON only.

Claim kinds and their REQUIRED roles:
${kinds}

Rules:
- Extract only what the sentence states. Do not infer, complete, or supply
  background knowledge. If the sentence makes no claim of these kinds, return
  ${emptyOutput}.
- Every role listed for a kind MUST be filled. A claim with a missing role is
  worse than no claim — it will be rejected, and silently dropping a role is how
  a contradiction gets reported as agreement.
- Concept labels are semantic concepts, not surface-form noun phrases. When a
  closed vocabulary is supplied below, copy its labels exactly.
- A "distinction" needs exactly two distinct values under "distinguished";
  supply them as an array. For a named axis or "X vs Y" sentence, use the two
  axis-value labels. Never repeat the axis heading as both values and never use
  the axis heading as a property.
- "No position can hold all of A, B, and C" is one joint-incompatibility, NOT
  three pairwise exclusions or unary negative properties. Emit exactly one
  joint-incompatibility claim with the complete set as the incompatible array.
- Infer attribution from ordinary prose; authors need not add extraction
  boilerplate. Every claim MUST include a scope. Use {"scope":"corpus"} when the
  source itself directly asserts the proposition. Use {"scope":"position",
  "positionId":"..."} when the sentence reports what a theory, author, camp,
  or other attributed holder asserts. Copy a short stable holder label.
- Never flatten rival positions into corpus assertions. A survey saying "HOT
  theorists identify meta-states with thoughts, while HOP theorists identify
  them with perceptions" contains two position-scoped identity claims, not two
  unrestricted corpus-level identities.
${glossarySection}

Output shape:
${outputShape}

Never emit an object named "extra". Put listed extra fields at the top level.
Never put not-, no-, or non- into a role label. Use polarity:"denies" for a
negative causal claim, property assertion, or entailment consequent. Only
causal-claim, property-assertion, and entailment own polarity; only distinction
owns differenceKind.

SENTENCE:
${segment}`;
}

/** Escape a value for a TypeQL string literal. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Canonicalise a claim without source provenance so equivalent runs overlap. */
export function canonicalClaim(claim: ExtractedClaim): string {
  const normalized = normalizeClaimExtras(claim);
  const roles = Object.fromEntries(
    Object.entries(normalized.roles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, value]) => [
        role,
        Array.isArray(value) ? value.map(String).sort() : String(value),
      ]),
  );
  return JSON.stringify({
    kind: normalized.kind,
    roles,
    scope: normalized.scope ?? null,
    positionId:
      normalized.scope === "position"
        ? canonicalPositionId(normalized.positionId) ?? null
        : null,
    modality: normalized.modality ?? null,
    polarity: normalized.polarity ?? null,
    differenceKind: normalized.differenceKind ?? null,
  });
}

/**
 * Return the self-describing, canonical schema fact used as a narrative
 * fidelity oracle, or null when the claim does not fill its required roles.
 *
 * The fact uses compact, schema-native function notation. It is not a
 * run-specific cipher or separator scheme, so a later model can recover it
 * without an external codebook. Narrative densification must retain every
 * returned fact byte-for-byte.
 */
export function schemaClaimFact(claim: ExtractedClaim): string | null {
  claim = normalizeClaimExtras(claim);
  const spec = ROLE_SPEC[claim?.kind];
  if (!spec || claimSchemaIssue(claim)) return null;
  if (claim.scope !== "corpus" && claim.scope !== "position") return null;
  const positionId = canonicalPositionId(claim.positionId);
  if (claim.scope === "position" && !positionId) return null;
  if (claim.scope === "corpus" && positionId) return null;

  const requiredCounts = new Map<string, number>();
  for (const role of spec.roles) {
    requiredCounts.set(role, (requiredCounts.get(role) ?? 0) + 1);
  }

  const roleParts: string[] = [];
  for (const [role, minimumCount] of requiredCounts) {
    const raw = claim.roles[role];
    const values = (Array.isArray(raw) ? raw : [raw])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    const canonicalValues = minimumCount > 1 ? [...values].sort() : values;
    roleParts.push(
      `${role}=${
        canonicalValues.length === 1
          ? JSON.stringify(canonicalValues[0])
          : JSON.stringify(canonicalValues)
      }`,
    );
  }

  const extras = [
    `scope=${JSON.stringify(claim.scope)}`,
    positionId ? `positionId=${JSON.stringify(positionId)}` : "",
    claim.modality ? `modality=${JSON.stringify(claim.modality)}` : "",
    claim.polarity ? `polarity=${JSON.stringify(claim.polarity)}` : "",
    claim.differenceKind
      ? `differenceKind=${JSON.stringify(claim.differenceKind)}`
      : "",
  ].filter(Boolean);
  return `${claim.kind}(${[...roleParts, ...extras].join(",")})`;
}

export function claimIdentity(
  claim: ExtractedClaim,
  segmentId: string,
): { claimId: string; claimKey: string } {
  const canonical = canonicalClaim(claim);
  return {
    claimKey: `claim:${sha256(canonical)}`,
    claimId: `claim-occurrence:${sha256(`${segmentId}\n${canonical}`)}`,
  };
}

/**
 * Build the queries for one claim.
 *
 * TWO queries, not one pipeline. Concepts are `put` (upsert, since `label` is
 * @key and concepts recur across segments); the claim is a separate
 * `match ... insert`. Chaining them as `put ... end; match ...` is a parse
 * error ("expected EOI") — and a parse error is indistinguishable from a
 * constraint violation at the call site unless they are kept apart, which is
 * exactly how a broken query masquerades as a working guard.
 */
export function claimToTypeQL(
  claim: ExtractedClaim,
  segmentId: string,
): {
  concepts: string;
  position?: string;
  claim: string;
  attribution?: string;
  claimId: string;
  claimKey: string;
} | null {
  claim = normalizeClaimExtras(claim);
  const spec = ROLE_SPEC[claim.kind];
  if (!spec || claimSchemaIssue(claim)) return null;
  const positionId = canonicalPositionId(claim.positionId);
  if (claim.scope !== "corpus" && claim.scope !== "position") return null;
  if (claim.scope === "position" && !positionId) return null;
  if (claim.scope === "corpus" && positionId) return null;

  // Flatten roles, expanding array-valued ones (distinction/dissociation).
  const pairs: Array<[string, string]> = [];
  for (const [role, value] of Object.entries(claim.roles)) {
    if (Array.isArray(value)) for (const v of value) pairs.push([role, String(v)]);
    else pairs.push([role, String(value)]);
  }
  if (pairs.length === 0) return null;

  const labels = [...new Set(pairs.map(([, v]) => v))];
  const varOf = new Map(labels.map((l, i) => [l, `$c${i}`]));

  const puts = labels
    .map((l) => `  ${varOf.get(l)} isa concept, has label "${esc(l)}";`)
    .join("\n");
  const matches = labels
    .map((l) => `  ${varOf.get(l)} isa concept, has label "${esc(l)}";`)
    .join("\n");

  const links = pairs.map(([r, v]) => `${r}: ${varOf.get(v)}`).join(", ");
  const identity = claimIdentity(claim, segmentId);
  const attrs = [
    `has claim-id "${esc(identity.claimId)}"`,
    `has claim-key "${esc(identity.claimKey)}"`,
    `has claim-scope "${claim.scope}"`,
    claim.modality ? `has modality "${esc(claim.modality)}"` : "",
    claim.polarity ? `has polarity "${esc(claim.polarity)}"` : "",
    claim.differenceKind ? `has difference-kind "${esc(claim.differenceKind)}"` : "",
  ].filter(Boolean);
  const attrClause = attrs.length ? `,\n    ${attrs.join(",\n    ")}` : "";

  return {
    concepts: `put\n${puts}`,
    ...(positionId
      ? {
          position: `put\n  $position isa position, has label "${esc(positionId)}";`,
        }
      : {}),
    claim: `match\n${matches}  $s isa segment, has segment-id "${esc(segmentId)}";\ninsert\n  $claim isa ${claim.kind}, links (${links}, source: $s)${attrClause};`,
    ...(positionId
      ? {
          attribution:
            `match\n` +
            `  $claim isa claim, has claim-id "${esc(identity.claimId)}";\n` +
            `  $position isa position, has label "${esc(positionId)}";\n` +
            `insert\n` +
            `  $_ isa attribution, links (holder: $position, attributed-claim: $claim);`,
        }
      : {}),
    ...identity,
  };
}

/** Persist a segment so claims have something to cite. */
export async function storeSegment(
  segmentId: string,
  text: string,
  corpusId: string,
): Promise<boolean> {
  const res = await claimStore.write(`put
  $s isa segment, has segment-id "${esc(segmentId)}",
     has corpus-id "${esc(corpusId)}", has text "${esc(text)}";`);
  return !!res && isOkResponse(res);
}

/**
 * Why pass one failed, when it did.
 *
 * `null` used to be the only answer, so a model that emitted 8 KB of valid
 * JSON with one stray comma was indistinguishable from one that hit the token
 * ceiling mid-object. Those need opposite responses — the first is repairable,
 * the second means the corpus is too large for a single glossary call — and
 * the run reported both as "an invalid or truncated corpus glossary", which
 * named neither.
 */
export type GlossaryFailureKind =
  | "truncated"
  | "unparseable"
  | "schema-invalid"
  | "ontology-conflict";

export interface GlossaryAttempt {
  glossary: ClosedGlossaryEntry[] | null;
  failure?: GlossaryFailureKind;
  /** Human-readable detail naming what to do about it. */
  detail?: string;
  /** Whether a JSON repair was applied to get here. */
  repaired?: boolean;
  /**
   * Entries the glossary pass produced that failed validation and were left
   * out. A vocabulary that is shorter than the model intended must say which
   * concepts it is missing, or the omission is silent.
   */
  droppedEntries?: Array<{ label: string; why: string }>;
}

/** Pass one: propose the only labels pass two will be allowed to emit. */
export async function proposeClosedGlossary(
  segments: readonly { id: string; text: string }[],
  ontology: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<ClosedGlossaryEntry[] | null> {
  return (await attemptClosedGlossary(segments, ontology, signal)).glossary;
}

/**
 * The same pass, reporting WHY it failed and repairing what is repairable.
 *
 * A single malformed response used to end the entire run: one call, no retry,
 * no repair, and `jsonRepair.ts` sitting unused elsewhere in the codebase.
 * Observed live on 2026-07-30T23-36-00 — 64 segments, 28 seconds, glossary
 * size 0, whole run terminal.
 *
 * Repair is bounded and honest: it fixes syntax the model got wrong, never
 * content. A repaired glossary that still fails the schema is still a failure,
 * and the fact that a repair was applied is reported so nobody mistakes a
 * salvaged response for a clean one.
 */
export async function attemptClosedGlossary(
  segments: readonly { id: string; text: string }[],
  ontology: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<GlossaryAttempt> {
  signal?.throwIfAborted();
  const provider = getActiveProvider();
  const prompt = buildCorpusGlossaryPrompt(segments, ontology);

  /*
   * Bounded retry, TRANSIENT ONLY.
   *
   * One provider hiccup used to end the run: a live analysis ingested 16
   * sections into a 296-node graph and then lost the whole formal path to
   * "OpenRouter stream error: Upstream error from Ambient". The corpus was
   * fine, the prompt was fine, the model was fine.
   *
   * Deterministic failures are deliberately NOT retried. This call runs at
   * temperature 0, so a truncation or a malformed response reproduces exactly
   * on a second attempt — retrying would double the latency to reach the same
   * answer. Only a failure of the transport is worth repeating, which is the
   * same rule `isRetrySafe` applies to tool calls.
   */
  const attempts = 3;
  let res: Awaited<ReturnType<typeof provider.chat>> | undefined;
  let lastTransient: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      res = await provider.chat({
        messages: [{ role: "user", content: prompt }],
        maxTokens: BATCH_MAX_TOKENS,
        reasoning: { enabled: false },
        responseFormat: { type: "json_object" },
        temperature: 0,
        signal,
      });
      lastTransient = undefined;
      break;
    } catch (error) {
      signal?.throwIfAborted();
      if (classifyError(error) !== "transient" || attempt === attempts - 1) {
        throw error;
      }
      lastTransient = error;
      // Linear backoff. The upstream is being asked to recover, not raced.
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  if (!res) {
    throw lastTransient ?? new Error("glossary pass produced no response");
  }
  if (res.finishReason === "length") {
    /*
     * Not repairable here. The model ran out of tokens mid-glossary, so the
     * missing entries were never generated — repairing the syntax would
     * produce a SHORTER closed vocabulary that silently excludes real corpus
     * concepts, and pass two would then reject every claim that needed one.
     * A quietly narrowed vocabulary is worse than an honest failure.
     */
    return {
      glossary: null,
      failure: "truncated",
      detail:
        `pass one hit the ${BATCH_MAX_TOKENS}-token ceiling across ${segments.length} segments and stopped mid-glossary. ` +
        "The missing entries were never generated, so this cannot be repaired without narrowing the vocabulary. " +
        "Section the corpus and extract per section, or raise the output cap.",
    };
  }
  let parsed: unknown;
  let repaired = false;
  try {
    parsed = JSON.parse(res.content);
  } catch {
    /*
     * Syntax the model got wrong, with the content all present. This is what
     * jsonRepair exists for, and it was never wired in — one stray comma ended
     * a 28-second pass and the whole run with it.
     */
    const salvaged = repairGlossaryJson(res.content);
    if (salvaged === null) {
      return {
        glossary: null,
        failure: "unparseable",
        detail:
          "pass one returned content that is not JSON and could not be repaired. The response was complete, so this is a formatting failure rather than a size limit.",
      };
    }
    parsed = salvaged;
    repaired = true;
  }
  try {
    /*
     * Keep what is valid, name what is not. One malformed entry used to
     * discard the entire vocabulary and end the run with nothing.
     */
    const { entries: glossary, dropped } = parseClosedGlossaryPartial(parsed);
    if (glossary.length === 0) {
      return {
        glossary: null,
        failure: "schema-invalid",
        repaired,
        detail:
          `pass one returned parseable JSON but NO entry survived validation (${dropped.length} rejected). ` +
          "Every entry is missing a required field, uses an unknown kind, or references an axis that is absent.",
        droppedEntries: dropped,
      };
    }
    const audited = new Map(
      Object.entries(ontology).map(([alias, canonical]) => [
        formalSymbol(alias),
        formalSymbol(canonical),
      ]),
    );
    const respectsOntology = glossary.every(({ label }) => {
      const labelSymbol = formalSymbol(label);
      const requiredCanonical = audited.get(labelSymbol);
      return !requiredCanonical || requiredCanonical === labelSymbol;
    });
    return respectsOntology
      ? { glossary, repaired, droppedEntries: dropped }
      : {
          glossary: null,
          failure: "ontology-conflict",
          repaired,
          detail:
            "pass one minted a label that the supplied ontology maps to a different canonical symbol. Accepting it would merge two concepts the ontology keeps apart.",
        };
  } catch (error) {
    return {
      glossary: null,
      failure: "schema-invalid",
      repaired,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Repair JSON syntax without touching content.
 *
 * Deliberately narrow: strips code fences and trailing commas, and converts
 * single-quoted strings, all of which are formatting mistakes a model makes
 * while emitting complete content. It does NOT close unterminated structures —
 * that would invent entries the model never wrote, and a fabricated glossary
 * label becomes a predicate the corpus does not contain.
 */
export function repairGlossaryJson(raw: string): unknown | null {
  const fenced = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const candidates = [
    fenced,
    fenced.replace(/,(\s*[}\]])/g, "$1"),
    convertSingleQuotedStrings(fenced).replace(/,(\s*[}\]])/g, "$1"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next repair
    }
  }
  return null;
}

/**
 * Ask pass one to EXTEND the vocabulary it already proposed.
 *
 * Why this is not a hole in the closed-vocabulary guard
 * ----------------------------------------------------
 * The guard exists because pass two used to mint predicates mid-claim and
 * produced junk: `this(x)` from a pronoun, `causes_makes_the_comparison_
 * quantitative(x)` from a run-on verb phrase. The rule that fixed it is "pass
 * two may only use labels a glossary pass produced", and that rule is intact
 * here — this IS a glossary pass. It simply runs second, knowing what pass two
 * discovered it needed.
 *
 * The asymmetry it removes: pass one's labels are generated unsupervised from
 * the corpus and auto-accepted (43 of them on the QM run), while pass two's
 * requests — each carrying a specific claim that needs it and a source segment
 * to ground it — required a human. The second set has strictly more evidence
 * than the first. Gating it on a person meant every new subject needed a
 * hand-made ontology, which is not a system that reasons about its material.
 *
 * Bounds, all of them load-bearing:
 *   - ADD ONLY. Never redefines or aliases an existing label; merging two
 *     concepts the first pass kept apart manufactures contradictions.
 *   - ONE round, by construction — this function is called once. If claims are
 *     still unmappable afterwards, that is a real finding about the corpus and
 *     not something to keep grinding at.
 *   - Source-grounded. An addition whose surface forms appear nowhere in the
 *     segment that asked for it is rejected, so the model cannot invent
 *     vocabulary the corpus does not use.
 */
export async function extendClosedGlossary(
  needs: ReadonlyArray<{ segmentId: string; text: string; reason: string; candidateLabels?: string[] }>,
  existing: readonly ClosedGlossaryEntry[],
  ontology: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<{ additions: ClosedGlossaryEntry[]; rejected: Array<{ label: string; why: string }> }> {
  signal?.throwIfAborted();
  if (needs.length === 0) return { additions: [], rejected: [] };

  const existingLabels = new Set(existing.map((entry) => entry.label));
  const provider = getActiveProvider();
  const res = await provider.chat({
    messages: [
      { role: "user", content: buildGlossaryExtensionPrompt(needs, existing, ontology) },
    ],
    maxTokens: BATCH_MAX_TOKENS,
    reasoning: { enabled: false },
    responseFormat: { type: "json_object" },
    temperature: 0,
    signal,
  });
  if (res.finishReason === "length") return { additions: [], rejected: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.content);
  } catch {
    parsed = repairGlossaryJson(res.content);
    if (parsed === null) return { additions: [], rejected: [] };
  }
  /*
   * Validate the additions AGAINST THE FULL VOCABULARY, not on their own.
   *
   * `parseClosedGlossary` enforces internal consistency: an `axis-value` must
   * find its parent `axis` among the entries being parsed. Additions are by
   * construction only the new entries, so any value hanging off an axis that
   * already exists had no parent in the batch and the parser returned null —
   * discarding the entire extension. Every useful extension has that shape,
   * which is why the round ran and produced nothing.
   *
   * Parsing the union fixes it and is also the stricter check: the additions
   * must be consistent with the vocabulary they are joining, not merely with
   * each other.
   */
  const rawEntries = Array.isArray((parsed as { glossary?: unknown })?.glossary)
    ? ((parsed as { glossary: unknown[] }).glossary as unknown[])
    : [];
  const rejected: Array<{ label: string; why: string }> = [];
  /*
   * Catch redefinition attempts on the RAW entries, before the union.
   *
   * Two reasons this cannot wait: a duplicate label would collide inside the
   * union parse, and — more importantly — the union filter drops anything
   * whose label already exists, so a refused redefinition would vanish without
   * ever being reported. A guard whose refusals are invisible looks exactly
   * like a guard that was never reached.
   */
  const admissible = rawEntries.filter((raw) => {
    const label = (raw as { label?: unknown })?.label;
    if (typeof label === "string" && existingLabels.has(label)) {
      rejected.push({
        label,
        why: "label already exists; extension may only add, never redefine",
      });
      return false;
    }
    return true;
  });
  const union = parseClosedGlossary({
    glossary: [...existing, ...admissible],
  });
  if (!union) return { additions: [], rejected };
  const existingLabelSet = new Set(existing.map(({ label }) => label));
  const proposed = union.filter(({ label }) => !existingLabelSet.has(label));

  const allText = needs.map((need) => need.text).join("\n").toLocaleLowerCase();
  const additions: ClosedGlossaryEntry[] = [];

  /*
   * Every alias the audited ontology knows about, as normalised symbols.
   *
   * An alias is a string the ontology has already ruled on: it means the
   * canonical it points at, not a concept of its own. Minting it as a NEW
   * label re-splits something a human deliberately unified — or, in the
   * direction reverse-math warns about, invents a near-twin of an existing
   * concept whose merge would destroy the corpus:
   *
   *   "rt22 and rt_n_k are DIFFERENT statements with different strengths. Any
   *    alias between them destroys the corpus."   — corpora/reverse-math/ontology.json
   */
  const auditedAliases = new Set(
    Object.keys(ontology).map((alias) => formalSymbol(alias)),
  );

  for (const entry of proposed) {
    const audited = ontology[entry.label];
    if (audited && formalSymbol(audited) !== formalSymbol(entry.label)) {
      rejected.push({
        label: entry.label,
        why: "the audited ontology maps this label to a different canonical symbol",
      });
      continue;
    }
    if (!audited && auditedAliases.has(formalSymbol(entry.label))) {
      rejected.push({
        label: entry.label,
        why: "the audited ontology already rules on this string as an alias of another concept; minting it as a new label would re-split what the ontology unified",
      });
      continue;
    }
    if (looksLikeDocumentStructure(entry.label)) {
      rejected.push({
        label: entry.label,
        why: "the label names a piece of the document's structure rather than a concept in it",
      });
      continue;
    }
    const grounded = [entry.label, ...entry.sourceForms].some((form) =>
      allText.includes(form.replace(/[-_]+/g, " ").toLocaleLowerCase()) ||
      allText.includes(form.toLocaleLowerCase()),
    );
    if (!grounded) {
      rejected.push({
        label: entry.label,
        why: "no surface form of this label appears in the segments that requested it",
      });
      continue;
    }
    additions.push(entry);
    existingLabels.add(entry.label);
  }
  return { additions, rejected };
}

/**
 * Does this label name a piece of the document rather than a concept in it?
 *
 * The extension round minted `section-4-impossibility` on the decision-theory
 * baseline — a heading promoted to a claim role. That is the same class of
 * defect the closed vocabulary was built to stop (`this(x)` from a pronoun,
 * `causes_makes_the_comparison_quantitative(x)` from a verb phrase), arriving
 * through the door I opened.
 *
 * A predicate over `section_4_impossibility(x)` says nothing about decision
 * theory. It says something about where the sentence sat on the page.
 */
export function looksLikeDocumentStructure(label: string): boolean {
  return /^(section|chapter|part|figure|table|appendix|paragraph|page|step|item|note|footnote)[-_]?\d*([-_]|$)/i.test(
    label,
  );
}

export function buildGlossaryExtensionPrompt(
  needs: ReadonlyArray<{ segmentId: string; text: string; reason: string; candidateLabels?: string[] }>,
  existing: readonly ClosedGlossaryEntry[],
  ontology: Readonly<Record<string, string>> = {},
): string {
  const current = existing
    .map((entry) => `- ${entry.label} (${entry.kind}): ${entry.definition}`)
    .join("\n");
  const gaps = needs
    .map(
      (need, index) =>
        `[${index}] (segmentId=${need.segmentId})\nSOURCE: ${need.text}\nWHY UNMAPPABLE: ${need.reason}` +
        (need.candidateLabels?.length
          ? `\nEXTRACTOR SUGGESTED: ${need.candidateLabels.join(", ")}`
          : ""),
    )
    .join("\n\n");
  const audited = Object.entries(ontology)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([alias, canonical]) => `- ${alias} -> ${canonical}`)
    .join("\n");

  return `A closed vocabulary was proposed for this corpus, then claim extraction
found explicit claims it could not express. EXTEND the vocabulary so those claims
become expressible. Output JSON only.

EXISTING VOCABULARY (do not redefine, do not repeat):
${current}
${audited ? `\nAUDITED ALIAS MAP (mandatory; use its canonical values):\n${audited}\n` : ""}
CLAIMS THAT COULD NOT BE EXPRESSED:
${gaps}

Return the same shape as the original glossary, containing ONLY NEW entries:
{"glossary":[{"label":"framework-relativity","kind":"axis","axisEncoding":"categorical","definition":"whether probabilities are stated relative to a chosen framework","sourceForms":["relative to a framework"],"values":["framework-relative","framework-absolute"]}]}

Rules:
- ADD ONLY. Never emit a label that already exists above, and never merge two
  existing concepts into one — the earlier pass separated them deliberately.
- Every new label must be grounded: at least one of its sourceForms must appear
  in the source text of the segment that requested it. Do not invent vocabulary
  the corpus does not use.
- A label names one concept, lowercase, hyphenated or underscored — never a
  sentence fragment or a lightly slugified noun phrase.
- If a gap needs a two-way distinction, mint BOTH poles as axis-values of a
  categorical axis. A signed-property axis carries one label and expresses the
  other side through polarity; do not use it where the corpus states two named
  alternatives.
- If a claim genuinely cannot be expressed by any well-formed addition, omit it.
  An honest gap is a finding; a fabricated label is not.`;
}

/** Ask the model for claims in one segment. Returns null on unparseable output. */
export async function proposeClaims(
  segment: string,
  glossary: readonly (string | ClosedGlossaryEntry)[] = [],
  signal?: AbortSignal,
  closedVocabulary = false,
): Promise<ExtractedClaim[] | null> {
  return (
    await proposeSegmentClaims(
      segment,
      glossary,
      signal,
      closedVocabulary,
    )
  )?.claims ?? null;
}

async function proposeSegmentClaims(
  segment: string,
  glossary: readonly (string | ClosedGlossaryEntry)[] = [],
  signal?: AbortSignal,
  closedVocabulary = false,
): Promise<SegmentProposal | null> {
  signal?.throwIfAborted();
  const provider = getActiveProvider();
  const res = await provider.chat({
    messages: [
      {
        role: "user",
        content: buildClaimExtractionPrompt(
          segment,
          glossary,
          closedVocabulary,
        ),
      },
    ],
    maxTokens: 1024,
    reasoning: { enabled: false },
    responseFormat: { type: "json_object" },
    temperature: 0,
    signal,
  });
  if (res.finishReason === "length") return null;
  try {
    const parsed = JSON.parse(res.content) as unknown;
    return parseSegmentProposal(parsed, closedVocabulary);
  } catch {
    return null;
  }
}

/**
 * How many segments go into one model call.
 *
 * One call per segment is correct but unusably slow: a 52-segment corpus is 52
 * serial round-trips, which ran past six minutes without finishing. Batching
 * trades a little per-segment focus for a usable wall-clock time. Keep it
 * modest — a large batch invites the model to blur claims across sentences,
 * which is the reconstruction problem we removed.
 */
const BATCH_SIZE = 4;
/** Batches in flight at once. Bounded to avoid hammering the provider. */
const BATCH_CONCURRENCY = 4;
/**
 * Output budget for a batch call.
 *
 * MEASURED FAILURE: at 4096 with 6 segments, OpenRouter returned
 * `finish_reason=length` — the JSON map was cut mid-object, the closing brace
 * never arrived, JSON.parse failed, and ALL segments in that batch were
 * recorded as parse failures. A truncated response silently destroyed a whole
 * batch of extraction rather than reporting a problem.
 */
const BATCH_MAX_TOKENS = settings.all.EXTRACTION_MAX_TOKENS;

function buildBatchPrompt(
  segments: Array<{ id: string; text: string }>,
  glossary: readonly ClosedGlossaryEntry[],
): string {
  const numbered = segments
    .map((s, i) => `[${i}] (segmentId=${s.id}) ${s.text}`)
    .join("\n");
  return `${buildClaimExtractionPrompt("(see the numbered sentences below)", glossary, true)}

You are given SEVERAL sentences. Treat each INDEPENDENTLY — do not carry a
claim from one sentence into another, and do not merge them.

Return a JSON object mapping each index to a claims/unmappable object, e.g.
{"0":{"claims":[],"unmappable":[]},"1":{"claims":[],"unmappable":[{"reason":"no closed label represents the explicit claim"}]}}

SENTENCES:
${numbered}`;
}

/** Extract claims for a batch. Returns a map from batch index to claims. */
async function proposeClaimsBatch(
  segments: Array<{ id: string; text: string }>,
  glossary: readonly ClosedGlossaryEntry[],
  telemetry: ExtractionTelemetry,
  signal?: AbortSignal,
): Promise<Map<number, SegmentProposal | null>> {
  const out = new Map<number, SegmentProposal | null>();
  const provider = getActiveProvider();

  /*
   * Losing a whole batch to one bad response is not acceptable — a truncated
   * reply would write off every segment in it. Fall back to per-segment calls,
   * which are slower but cannot take their neighbours down with them.
   */
  const fallbackIndices = async (indices: readonly number[]) => {
    telemetry.fallbackBatches++;
    // Batches already run concurrently. Keep each batch's fallback sequential
    // so four truncated batches cannot fan out into sixteen simultaneous calls.
    for (const index of indices) {
      telemetry.fallbackSegmentCalls++;
      const proposal = await proposeSegmentClaims(
        segments[index].text,
        glossary,
        signal,
        true,
      ).catch((error) => {
          signal?.throwIfAborted();
          return null;
        });
      out.set(index, proposal);
    }
    return out;
  };
  const fallbackPerSegment = () =>
    fallbackIndices(segments.map((_, index) => index));

  let content = "";
  try {
    signal?.throwIfAborted();
    telemetry.batchCalls++;
    const res = await provider.chat({
      messages: [
        { role: "user", content: buildBatchPrompt(segments, glossary) },
      ],
      maxTokens: BATCH_MAX_TOKENS,
      reasoning: { enabled: false },
      responseFormat: { type: "json_object" },
      temperature: 0,
      signal,
    });
    if (res.finishReason === "length") return fallbackPerSegment();
    content = res.content;
  } catch (error) {
    signal?.throwIfAborted();
    return fallbackPerSegment();
  }

  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return fallbackPerSegment();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    // Almost always a truncated response: the closing brace never arrived.
    return fallbackPerSegment();
  }
  const missing: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const v = parsed[String(i)];
    const proposal = parseSegmentProposal(v, true);
    if (proposal === null) missing.push(i);
    else out.set(i, proposal);
  }
  return missing.length > 0 ? fallbackIndices(missing) : out;
}

/**
 * Extract claims from segments and write them.
 *
 * Rejections are counted and returned, never swallowed: the rejection rate is
 * the measurement that tells you whether extraction is working.
 */
export async function extractIntoStore(
  segments: Array<{ id: string; text: string }>,
  corpusId: string,
  options: ExtractionOptions = {},
): Promise<ExtractionReport> {
  options.signal?.throwIfAborted();
  const startedAt = performance.now();
  const { sourceSegments, sourceIdBySegmentId } = buildSourceTable(segments);
  const corpusHash = sha256(
    JSON.stringify(segments.map(({ id, text }) => ({ id, text }))),
  );
  const report: ExtractionReport = {
    segmentsProcessed: 0,
    claimsProposed: 0,
    claimsAccepted: 0,
    claimsRejected: 0,
    outcomes: [],
    parseFailures: [],
    parseFailureOutcomes: [],
    sourceSegments,
    replayManifest: {
      corpusId,
      corpusHash,
      segmentationVersion: CLAIM_SEGMENTATION_VERSION,
      promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
      schemaVersion: CLAIM_SCHEMA_VERSION,
    },
    glossary: [],
    unmappableClaims: [],
    telemetry: {
      glossaryMs: 0,
      proposalMs: 0,
      persistenceMs: 0,
      totalMs: 0,
      glossaryCalls: 0,
      batchCalls: 0,
      fallbackBatches: 0,
      fallbackSegmentCalls: 0,
    },
  };

  if (!claimStore.available) {
    report.telemetry.totalMs = performance.now() - startedAt;
    return report;
  }

  const proposalStartedAt = performance.now();
  if (segments.length > 0) {
    const glossaryStartedAt = performance.now();
    report.telemetry.glossaryCalls++;
    /*
     * Reuse the sieve this corpus was already measured with.
     *
     * Keyed on the corpus hash, so changed text always recasts. Reuse skips
     * pass one entirely — which is also where the 118-second generations and
     * the intermittent schema-invalid failures live, so a settled vocabulary
     * removes the run's least reliable step as well as its least stable one.
     */
    // The same hash the replay manifest records — one source of truth.
    const hash = corpusHash;
    const persisted = await loadPersistedGlossary(corpusId, hash);
    if (persisted) {
      report.glossary = persisted.entries;
      report.glossaryReused = {
        corpusHash: hash,
        entries: persisted.entries.length,
        firstCastAt: persisted.createdAt,
        extendedTimes: persisted.extendedTimes,
      };
      report.telemetry.glossaryMs = performance.now() - glossaryStartedAt;
    }
    try {
      const attempt = persisted
        ? { glossary: persisted.entries }
        : await attemptClosedGlossary(
            segments,
            options.ontology,
            options.signal,
          );
      if (!attempt.glossary) {
        // Name the failure and what to do about it. "Invalid or truncated"
        // described two opposite problems and pointed at neither.
        report.glossaryFailure = `pass one failed (${attempt.failure}): ${attempt.detail}`;
      } else {
        /*
         * Every corpus gets a narrator, minted here rather than asked for.
         *
         * Deterministic on purpose: whether a document has an authorial voice
         * is not a question the model should get a vote on, and leaving it to
         * the prompt would make attribution repair depend on model compliance.
         * Appended only if the glossary pass did not already produce it.
         */
        const glossary = attempt.glossary;
        report.glossary = glossary.some(
          ({ label }) => label === CORPUS_NARRATOR_LABEL,
        )
          ? glossary
          : [...glossary, corpusNarratorEntry()];
        if (attempt.repaired) {
          // A salvaged response is usable but must not look pristine.
          report.glossaryRepaired = true;
        }
        if (attempt.droppedEntries?.length) {
          // The concepts this vocabulary is knowingly missing. Pass two will
          // surface them again as gaps, and the extension round can re-mint
          // them properly formed.
          report.glossaryDropped = attempt.droppedEntries;
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      report.glossaryFailure = `pass one failed to establish a corpus glossary: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
    report.telemetry.glossaryMs = performance.now() - glossaryStartedAt;
  }
  if (report.glossaryFailure) {
    report.telemetry.proposalMs = performance.now() - proposalStartedAt;
    report.telemetry.totalMs = performance.now() - startedAt;
    return report;
  }

  // Split into batches, then run a bounded number of batches concurrently.
  const batches: Array<Array<{ id: string; text: string }>> = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE)
    batches.push(segments.slice(i, i + BATCH_SIZE));

  const proposals: Array<{
    seg: { id: string; text: string };
    proposal: SegmentProposal | null;
  }> = [];
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    options.signal?.throwIfAborted();
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(
      wave.map((batch) =>
        proposeClaimsBatch(
          batch,
          report.glossary,
          report.telemetry,
          options.signal,
        ),
      ),
    );
    wave.forEach((batch, w) => {
      batch.forEach((seg, idx) => {
        proposals.push({ seg, proposal: results[w].get(idx) ?? null });
      });
    });
  }
  /*
   * ONE glossary extension round.
   *
   * Pass two has now told us exactly which claims its vocabulary could not
   * express, and for most of them it named the labels it wanted. Previously
   * that was where extraction stopped and a person was asked to hand-author
   * ontology — which meant every new subject needed a bespoke glossary before
   * AGEM could reason about it at all.
   *
   * So: ask the glossary pass to extend itself, validate the additions, and
   * re-run pass two on ONLY the segments that failed. Bounded to a single
   * round; anything still unmappable afterwards is a genuine finding about the
   * corpus rather than a budget to keep spending.
   */
  const gaps = proposals.flatMap(({ seg, proposal }) => [
    // Declared gaps: the model said it could not express the claim.
    ...(proposal?.unmappable ?? []).map((unmappable) => ({
      segmentId: seg.id,
      text: seg.text,
      reason: unmappable.reason,
      candidateLabels: unmappable.candidateLabels,
    })),
    /*
     * Demonstrated gaps: the model expressed the claim anyway, using labels
     * the glossary does not contain, and the vocabulary guard will reject it.
     *
     * This is the same signal as an unmappable claim — the closed vocabulary
     * cannot say what the segment asserts — and it is the LOUDER of the two,
     * because the model has already named the exact labels it needed. The
     * consciousness run produced 18 of these ("global workspace", "pain",
     * "higher-order state") and the extension round ignored all of them while
     * dutifully handling the smaller pile of declared gaps.
     */
    ...(() => {
      const offenders = [
        ...new Set(
          (proposal?.claims ?? []).flatMap((claim) =>
            claimVocabularyOffenders(normalizeClaimExtras(claim), report.glossary),
          ),
        ),
      ];
      return offenders.length > 0
        ? [
            {
              segmentId: seg.id,
              text: seg.text,
              reason: `the claim used role label(s) absent from the closed glossary: ${offenders.join(", ")}`,
              candidateLabels: offenders,
            },
          ]
        : [];
    })(),
  ]);
  if (gaps.length > 0 && report.glossary.length > 0) {
    options.signal?.throwIfAborted();
    report.telemetry.glossaryCalls++;
    try {
      const { additions, rejected } = await extendClosedGlossary(
        gaps,
        report.glossary,
        options.ontology,
        options.signal,
      );
      report.glossaryExtension = {
        requested: gaps.length,
        additions: additions.map(({ label, kind, definition }) => ({
          label,
          kind,
          definition,
        })),
        rejected,
      };
      if (additions.length > 0) {
        report.glossary = [...report.glossary, ...additions];
        const gapSegmentIds = new Set(gaps.map((gap) => gap.segmentId));
        const retryable = proposals.filter(({ seg }) => gapSegmentIds.has(seg.id));
        const retryBatches: Array<Array<{ id: string; text: string }>> = [];
        for (let i = 0; i < retryable.length; i += BATCH_SIZE) {
          retryBatches.push(retryable.slice(i, i + BATCH_SIZE).map(({ seg }) => seg));
        }
        for (let i = 0; i < retryBatches.length; i += BATCH_CONCURRENCY) {
          options.signal?.throwIfAborted();
          const wave = retryBatches.slice(i, i + BATCH_CONCURRENCY);
          const results = await Promise.all(
            wave.map((batch) =>
              proposeClaimsBatch(
                batch,
                report.glossary,
                report.telemetry,
                options.signal,
              ),
            ),
          );
          wave.forEach((batch, w) => {
            batch.forEach((seg, idx) => {
              const reproposed = results[w].get(idx);
              if (!reproposed) return;
              /*
               * Replace the original only when the retry actually improved it.
               * A retry that maps nothing keeps the honest first result rather
               * than overwriting it with a second failure.
               *
               * "Improved" counts BOTH kinds of gap. Measuring only unmappable
               * claims would score a retry as a success when it silently
               * converted a declared gap into a minted label — which is not a
               * fix, it is the same failure wearing the other costume.
               */
              const gapCount = (p: SegmentProposal | null | undefined) =>
                (p?.unmappable.length ?? 0) +
                (p?.claims ?? []).filter(
                  (claim) =>
                    claimVocabularyOffenders(
                      normalizeClaimExtras(claim),
                      report.glossary,
                    ).length > 0,
                ).length;
              const target = proposals.find((p) => p.seg.id === seg.id);
              if (target && gapCount(reproposed) < gapCount(target.proposal)) {
                target.proposal = reproposed;
              }
            });
          });
        }
        report.glossaryExtension.remapped = proposals
          .filter(({ seg }) => gapSegmentIds.has(seg.id))
          .reduce(
            (count, { proposal }) => count + (proposal?.unmappable.length ?? 0),
            0,
          );
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      // A failed extension leaves the first-pass result untouched. The run
      // reports the original gaps, which is where it would have stopped anyway.
      report.glossaryExtension = {
        requested: gaps.length,
        additions: [],
        rejected: [
          {
            label: "(extension pass)",
            why: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
  /*
   * Settle the vocabulary for next time.
   *
   * Written after the extension round so the stored sieve is the one the run
   * actually reckoned with, extensions included. Keyed on the corpus hash, so
   * this can only ever be reused for the same text.
   */
  if (report.glossary.length > 0 && !report.glossaryFailure) {
    try {
      await persistGlossary(
        corpusId,
        corpusHash,
        report.glossary,
        (report.glossaryReused?.extendedTimes ?? 0) +
          (report.glossaryExtension?.additions.length ? 1 : 0),
      );
    } catch {
      // A vocabulary that cannot be cached is still a usable vocabulary.
      // Never fail a run over its own memoisation.
    }
  }
  report.telemetry.proposalMs = performance.now() - proposalStartedAt;

  const persistenceStartedAt = performance.now();
  for (const { seg, proposal } of proposals) {
    options.signal?.throwIfAborted();
    report.segmentsProcessed++;
    await storeSegment(seg.id, seg.text, corpusId);
    const sourceSegmentId = sourceIdBySegmentId.get(seg.id)!;

    if (proposal === null) {
      report.parseFailures.push(seg.id);
      report.parseFailureOutcomes.push({
        segmentId: seg.id,
        sourceSegmentId,
        reason: "unparseable-provider-output",
      });
      continue;
    }

    if (sourceRequiresJointIncompatibility(seg.text)) {
      const jointClaims = proposal.claims.filter(
        (claim) => claim.kind === "joint-incompatibility",
      );
      if (jointClaims.length !== 1 || proposal.claims.length !== 1) {
        report.unmappableClaims.push({
          segmentId: seg.id,
          sourceSegmentId,
          reason:
            "source semantics: expected exactly one complete joint-incompatibility claim; refused unary, pairwise, or chained decomposition",
        });
        continue;
      }
    }
    for (const unmappable of proposal.unmappable) {
      report.unmappableClaims.push({
        segmentId: seg.id,
        sourceSegmentId,
        reason: unmappable.reason,
        ...(unmappable.candidateLabels.length > 0
          ? { candidateLabels: unmappable.candidateLabels }
          : {}),
      });
    }

    for (const proposedClaim of proposal.claims) {
      const claim = normalizeClaimExtras(proposedClaim);
      const schemaRejection = claimSchemaIssue(claim);
      if (schemaRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          sourceSegmentId,
          claim,
          accepted: false,
          rejectionKind: "schema",
          rejection: schemaRejection,
        });
        continue;
      }
      const semanticRejection = claimSourceSemanticIssue(claim, seg.text);
      if (semanticRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          sourceSegmentId,
          claim,
          accepted: false,
          rejectionKind: "schema",
          rejection: semanticRejection,
        });
        continue;
      }
      const attributionRejection = claimAttributionIssue(claim, seg.text);
      if (attributionRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          sourceSegmentId,
          claim,
          accepted: false,
          rejectionKind: "attribution",
          rejection: attributionRejection,
        });
        continue;
      }
      const vocabularyRejection = claimVocabularyIssue(claim, report.glossary);
      if (vocabularyRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          sourceSegmentId,
          claim,
          accepted: false,
          rejectionKind: "vocabulary",
          rejection: vocabularyRejection,
        });
        continue;
      }
      const query = claimToTypeQL(claim, seg.id);
      if (!query) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          sourceSegmentId,
          claim,
          accepted: false,
          rejectionKind: "schema",
          rejection: "claim conversion failed after schema validation",
        });
        continue;
      }
      report.claimsProposed++;
      // Concepts first (upsert), then the claim. Separate writes — see
      // claimToTypeQL for why they cannot be one pipeline.
      options.signal?.throwIfAborted();
      await claimStore.write(query.concepts);
      options.signal?.throwIfAborted();
      const positionRes = query.position
        ? await claimStore.write(query.position)
        : undefined;
      const positionAccepted =
        !query.position || (!!positionRes && isOkResponse(positionRes));
      options.signal?.throwIfAborted();
      const res = positionAccepted ? await claimStore.write(query.claim) : null;
      const claimAccepted = !!res && isOkResponse(res);
      options.signal?.throwIfAborted();
      const attributionRes =
        claimAccepted && query.attribution
          ? await claimStore.write(query.attribution)
          : undefined;
      const attributionAccepted =
        !query.attribution ||
        (!!attributionRes && isOkResponse(attributionRes));
      const accepted = positionAccepted && claimAccepted && attributionAccepted;
      if (accepted) report.claimsAccepted++;
      else report.claimsRejected++;
      report.outcomes.push({
        segmentId: seg.id,
        sourceSegmentId,
        claim,
        claimId: query.claimId,
        claimKey: query.claimKey,
        accepted,
        rejectionKind: accepted ? undefined : "storage",
        rejection: accepted
          ? undefined
          : !positionAccepted
            ? `position write rejected: ${describeRejection(positionRes)}`
            : !claimAccepted
              ? describeRejection(res)
              : `attribution write rejected: ${describeRejection(attributionRes)}`,
      });
    }
  }

  report.telemetry.persistenceMs = performance.now() - persistenceStartedAt;
  report.telemetry.totalMs = performance.now() - startedAt;
  return report;
}

/**
 * Turn a stored claim into first-order logic — DETERMINISTICALLY.
 *
 * This is the point of the whole exercise. The negation in an `exclusion` is
 * emitted because the relation is typed `exclusion`, not because a model
 * remembered to write `-`. It cannot be dropped.
 *
 * Measured cost of the old path, on ONE corpus:
 *   - exhaustive run:  IIT/GWT CONTRADICTORY, Hard/Easy fine
 *   - later run:       IIT/GWT consistent (exclusion vanished),
 *                      Hard/Easy CONTRADICTORY (a clash the corpus never made,
 *                      manufactured by encoding "the hard problem is not a
 *                      functional performance")
 * Same text, opposite answers, because the formalization was authored freehand.
 *
 * Every block also carries an existential witness. A set of bare universals is
 * satisfied by the empty world, which is how a vacuous "no contradiction" gets
 * reported as a finding.
 */
export function claimToPropositions(claim: ExtractedClaim): {
  name: string;
  propositions: string[];
} | null {
  claim = normalizeClaimExtras(claim);
  if (claimSchemaIssue(claim) || claimAttributionIssue(claim)) return null;
  const pred = (label: string) => label.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  const entity = (label: string) => `entity_${pred(label)}`;
  const r = claim.roles as Record<string, string | string[]>;
  const one = (k: string): string | undefined => {
    const v = r[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const many = (k: string): string[] => {
    const v = r[k];
    return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  };

  switch (claim.kind) {
    case "joint-incompatibility": {
      const members = [...new Set(many("incompatible"))].sort();
      if (members.length < 2) return null;
      const consequent = pred(members.at(-1)!);
      const antecedent = members
        .slice(0, -1)
        .map((member) => `${pred(member)}(x)`)
        .join(" & ");
      return {
        name: `joint-incompatibility(${members.join(",")})`,
        // This forbids only the complete conjunction. No member, pair, or
        // other proper subset is made impossible by the encoding.
        propositions: [`all x ((${antecedent}) -> -${consequent}(x))`],
      };
    }
    case "exclusion": {
      const a = one("excluder"), b = one("excluded");
      if (!a || !b) return null;
      return {
        name: `exclusion(${a},${b})`,
        // The '-' is structural, not remembered.
        propositions: [
          `all x (${pred(a)}(x) -> -${pred(b)}(x))`,
          `exists x (${pred(a)}(x))`,
        ],
      };
    }
    case "identity-claim": {
      const a = one("identified"), b = one("identified-with");
      if (!a || !b) return null;
      return {
        name: `identity(${a},${b})`,
        propositions: [
          `all x (${pred(a)}(x) <-> ${pred(b)}(x))`,
          `exists x (${pred(a)}(x))`,
        ],
      };
    }
    case "causal-claim": {
      const a = one("cause"), b = one("effect");
      if (!a || !b || !claim.polarity) return null;
      const sign = claim.polarity === "denies" ? "-" : "";
      return {
        name: `causal(${a}${claim.polarity === "denies" ? " -/->" : " ->"}${b})`,
        propositions: [
          `all x (${pred(a)}(x) -> ${sign}causes_${pred(b)}(x))`,
          `exists x (${pred(a)}(x))`,
        ],
      };
    }
    case "property-assertion": {
      const subject = one("subject"), property = one("property");
      if (!subject || !property || !claim.polarity) return null;
      const sign = claim.polarity === "denies" ? "-" : "";
      return {
        name: `property(${subject},${sign}${property})`,
        propositions: [`${sign}${pred(property)}(${entity(subject)})`],
      };
    }
    case "entailment": {
      const a = one("antecedent"), b = one("consequent");
      if (!a || !b) return null;
      const sign = claim.polarity === "denies" ? "-" : "";
      return {
        name: `entails(${a},${sign}${b})`,
        propositions: [
          `all x (${pred(a)}(x) -> ${sign}${pred(b)}(x))`,
          `exists x (${pred(a)}(x))`,
        ],
      };
    }
    case "distinction":
    case "dissociation": {
      const [a, b] = many(claim.kind === "distinction" ? "distinguished" : "dissociable");
      if (!a || !b) return null;
      /*
       * NOT a contradiction — non-coextension. "A differs from B" says some A
       * is not B, which is compatible with almost everything. Encoding a
       * distinction as opposed predicates is what manufactured the false
       * Hard/Easy contradiction; a dissociation adds only the converse.
       */
      const props = [`exists x (${pred(a)}(x) & -${pred(b)}(x))`];
      if (claim.kind === "dissociation")
        props.push(`exists x (${pred(b)}(x) & -${pred(a)}(x))`);
      return { name: `${claim.kind}(${a},${b})`, propositions: props };
    }
    default:
      return null;
  }
}

function describeRejection(res: unknown): string {
  const err = (res as { err?: { code?: string; message?: string } } | null)?.err;
  if (!err) return "write failed";
  return [err.code, err.message].filter(Boolean).join(" ").slice(0, 240);
}
