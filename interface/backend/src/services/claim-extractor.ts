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
 *   Here the model reads the SENTENCE and emits a typed claim. There is no
 *   reconstruction step to improvise in, and the schema rejects claims whose
 *   shape is wrong rather than accepting them and being wrong later.
 *
 * THE INVARIANT
 *   Nothing enters the store that the schema will not accept. A dropped
 *   exclusion, an unsigned causal claim, a claim with no source sentence — all
 *   fail at write time with a constraint violation, and the failure is
 *   REPORTED, not swallowed. A rejected claim is a finding about the
 *   extraction, not an incident to hide.
 */

import { getActiveProvider } from "./llm.js";
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
  | "causal-claim"
  | "property-assertion"
  | "entailment";

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
  claim: ExtractedClaim;
  /** Concrete graph relation occurrence used by evidences links. */
  claimId?: string;
  /** Stable structural identity used for exact cross-run overlap. */
  claimKey?: string;
  accepted: boolean;
  /** Pipeline stage that rejected the claim, for cause-specific reporting. */
  rejectionKind?: "schema" | "attribution" | "storage";
  /** Constraint violation text when the schema refused the claim. */
  rejection?: string;
}

export interface ExtractionReport {
  segmentsProcessed: number;
  claimsProposed: number;
  claimsAccepted: number;
  claimsRejected: number;
  outcomes: ExtractionOutcome[];
  /** Segments the model returned unparseable output for. */
  parseFailures: string[];
  telemetry: ExtractionTelemetry;
}

export interface ExtractionTelemetry {
  proposalMs: number;
  persistenceMs: number;
  totalMs: number;
  batchCalls: number;
  fallbackBatches: number;
  fallbackSegmentCalls: number;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
}

/** Remove model-added metadata that the selected relation kind does not own. */
export function normalizeClaimExtras(claim: ExtractedClaim): ExtractedClaim {
  const normalized = { ...claim };
  if (
    normalized.kind !== "causal-claim" &&
    normalized.kind !== "property-assertion"
  ) {
    delete normalized.polarity;
  }
  if (normalized.kind !== "distinction") delete normalized.differenceKind;
  return normalized;
}

const ATTRIBUTED_ASSERTION_CUE =
  /\b(?:theorists?|theories|theory|views?|accounts?|models?|camps?|advocates?|proponents?|supporters?|critics?|authors?|researchers?)\b[^.!?]{0,100}\b(?:hold|holds|held|argue|argues|argued|claim|claims|claimed|maintain|maintains|maintained|identify|identifies|identified|deny|denies|denied|assert|asserts|asserted|propose|proposes|proposed|say|says|said)\b|\baccording\s+to\b|\b[A-Z][\w-]+(?:\s+[A-Z][\w-]+)?\s+(?:argues|claims|maintains|identifies|denies|asserts|proposes|says)\b/;
/** A corpus-level rule about arbitrary positions is not attribution to one holder. */
const GENERIC_POSITION_RULE_CUE =
  /\b(?:any|every|each|no)\s+(?:theor(?:y|ies)|views?|accounts?|models?)\b/i;

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
  if (
    claim.scope === "corpus" &&
    claim.kind !== "distinction" &&
    claim.kind !== "dissociation" &&
    ATTRIBUTED_ASSERTION_CUE.test(sourceText) &&
    !GENERIC_POSITION_RULE_CUE.test(sourceText)
  ) {
    return (
      "attribution flattening detected: the source reports what a named holder " +
      "asserts, but the extracted claim was scoped to the corpus"
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
    gloss: "A implies B, directionally. Do not use for mutual implication; that is two claims.",
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

export function buildClaimExtractionPrompt(
  segment: string,
  glossary: readonly string[] = [],
): string {
  const kinds = (Object.entries(ROLE_SPEC) as [ClaimKind, typeof ROLE_SPEC[ClaimKind]][])
    .map(([kind, spec]) => {
      const roles = [...new Set(spec.roles)].join(", ");
      const extras = spec.extras?.length ? `  extra fields: ${spec.extras.join(", ")}\n` : "";
      return `- ${kind}\n  roles: ${roles}\n${extras}  ${spec.gloss}`;
    })
    .join("\n");

  const glossarySection = glossary.length === 0
    ? ""
    : `\nRUNNING PREDICATE GLOSSARY (already used in this corpus):\n${[
        ...new Set(glossary),
      ]
        .sort()
        .slice(0, 120)
        .map((label) => `- ${label}`)
        .join("\n")}\nReuse a glossary label whenever it names the same concept. Coin a new label only for a genuinely different concept.\n`;

  return `Extract the explicit claims from ONE sentence. Output JSON only.

Claim kinds and their REQUIRED roles:
${kinds}

Rules:
- Extract only what the sentence states. Do not infer, complete, or supply
  background knowledge. If the sentence makes no claim of these kinds, return [].
- Every role listed for a kind MUST be filled. A claim with a missing role is
  worse than no claim — it will be rejected, and silently dropping a role is how
  a contradiction gets reported as agreement.
- Concept labels: short, lowercase, hyphenated, reused consistently
  ("phenomenal-consciousness", "phi", "global-broadcast").
- A "distinction" needs exactly two distinct values under "distinguished";
  supply them as an array.
- Every claim MUST include a scope. Use {"scope":"corpus"} only when the
  source itself directly asserts the proposition. Use {"scope":"position",
  "positionId":"..."} when the sentence reports what a theory, author, camp,
  or other attributed holder asserts. Copy a short stable holder label.
- Never flatten rival positions into corpus assertions. A survey saying "HOT
  theorists identify meta-states with thoughts, while HOP theorists identify
  them with perceptions" contains two position-scoped identity claims, not two
  unrestricted corpus-level identities.
${glossarySection}

Output shape:
[{"kind":"identity-claim","roles":{"identified":"meta-state","identified-with":"thought-like"},"scope":"position","positionId":"HOT"},
 {"kind":"distinction","roles":{"distinguished":["hard-problem","easy-problems"]},"scope":"corpus","differenceKind":"in-kind"}]

Never emit an extra field unless it is listed for that claim kind. In
particular, only causal-claim and property-assertion own polarity, and only
distinction owns differenceKind.

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
        ? normalized.positionId?.trim() || null
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
  const positionId = claim.positionId?.trim();
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
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest("hex");
  return {
    claimKey: `claim:${digest(canonical)}`,
    claimId: `claim-occurrence:${digest(`${segmentId}\n${canonical}`)}`,
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
  const positionId = claim.positionId?.trim();
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

/** Ask the model for claims in one segment. Returns null on unparseable output. */
export async function proposeClaims(
  segment: string,
  glossary: readonly string[] = [],
  signal?: AbortSignal,
): Promise<ExtractedClaim[] | null> {
  signal?.throwIfAborted();
  const provider = getActiveProvider();
  const res = await provider.chat({
    messages: [
      {
        role: "user",
        content: buildClaimExtractionPrompt(segment, glossary),
      },
    ],
    maxTokens: 1024,
    signal,
  });
  const match = res.content.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as ExtractedClaim[]) : null;
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
  glossary: readonly string[],
): string {
  const numbered = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");
  return `${buildClaimExtractionPrompt("(see the numbered sentences below)", glossary)}

You are given SEVERAL sentences. Treat each INDEPENDENTLY — do not carry a
claim from one sentence into another, and do not merge them.

Return a JSON object mapping each index to its claim array, e.g.
{"0": [], "1": [{"kind":"exclusion","roles":{"excluder":"phi","excluded":"global-broadcast"},"scope":"position","positionId":"IIT"}]}

SENTENCES:
${numbered}`;
}

/** Extract claims for a batch. Returns a map from batch index to claims. */
async function proposeClaimsBatch(
  segments: Array<{ id: string; text: string }>,
  glossary: readonly string[],
  telemetry: ExtractionTelemetry,
  signal?: AbortSignal,
): Promise<Map<number, ExtractedClaim[] | null>> {
  const out = new Map<number, ExtractedClaim[] | null>();
  const provider = getActiveProvider();

  /*
   * Losing a whole batch to one bad response is not acceptable — a truncated
   * reply would write off every segment in it. Fall back to per-segment calls,
   * which are slower but cannot take their neighbours down with them.
   */
  const fallbackPerSegment = async () => {
    telemetry.fallbackBatches++;
    telemetry.fallbackSegmentCalls += segments.length;
    const results = await Promise.all(
      segments.map((s) =>
        proposeClaims(s.text, glossary, signal).catch((error) => {
          signal?.throwIfAborted();
          return null;
        }),
      ),
    );
    results.forEach((r, i) => out.set(i, r));
    return out;
  };

  let content = "";
  try {
    signal?.throwIfAborted();
    telemetry.batchCalls++;
    const res = await provider.chat({
      messages: [
        { role: "user", content: buildBatchPrompt(segments, glossary) },
      ],
      maxTokens: BATCH_MAX_TOKENS,
      signal,
    });
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
  for (let i = 0; i < segments.length; i++) {
    const v = parsed[String(i)];
    out.set(i, Array.isArray(v) ? (v as ExtractedClaim[]) : v === undefined ? null : []);
  }
  return out;
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
  const report: ExtractionReport = {
    segmentsProcessed: 0,
    claimsProposed: 0,
    claimsAccepted: 0,
    claimsRejected: 0,
    outcomes: [],
    parseFailures: [],
    telemetry: {
      proposalMs: 0,
      persistenceMs: 0,
      totalMs: 0,
      batchCalls: 0,
      fallbackBatches: 0,
      fallbackSegmentCalls: 0,
    },
  };

  if (!claimStore.available) {
    report.telemetry.totalMs = performance.now() - startedAt;
    return report;
  }

  // Split into batches, then run a bounded number of batches concurrently.
  const batches: Array<Array<{ id: string; text: string }>> = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE)
    batches.push(segments.slice(i, i + BATCH_SIZE));

  const proposals: Array<{ seg: { id: string; text: string }; claims: ExtractedClaim[] | null }> = [];
  const runningGlossary = new Set<string>();
  const proposalStartedAt = performance.now();
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    options.signal?.throwIfAborted();
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const glossary = [...runningGlossary];
    const results = await Promise.all(
      wave.map((batch) =>
        proposeClaimsBatch(
          batch,
          glossary,
          report.telemetry,
          options.signal,
        ),
      ),
    );
    wave.forEach((batch, w) => {
      batch.forEach((seg, idx) => {
        const claims = results[w].get(idx) ?? null;
        proposals.push({ seg, claims });
        for (const claim of claims ?? []) {
          for (const value of Object.values(claim?.roles ?? {})) {
            for (const label of Array.isArray(value) ? value : [value]) {
              if (String(label).trim()) runningGlossary.add(String(label).trim());
            }
          }
        }
      });
    });
  }
  report.telemetry.proposalMs = performance.now() - proposalStartedAt;

  const persistenceStartedAt = performance.now();
  for (const { seg, claims } of proposals) {
    options.signal?.throwIfAborted();
    report.segmentsProcessed++;
    await storeSegment(seg.id, seg.text, corpusId);

    if (claims === null) {
      report.parseFailures.push(seg.id);
      continue;
    }

    for (const proposedClaim of claims) {
      const claim = normalizeClaimExtras(proposedClaim);
      const schemaRejection = claimSchemaIssue(claim);
      if (schemaRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          claim,
          accepted: false,
          rejectionKind: "schema",
          rejection: schemaRejection,
        });
        continue;
      }
      const attributionRejection = claimAttributionIssue(claim, seg.text);
      if (attributionRejection) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          claim,
          accepted: false,
          rejectionKind: "attribution",
          rejection: attributionRejection,
        });
        continue;
      }
      const query = claimToTypeQL(claim, seg.id);
      if (!query) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
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
        propositions: [`${sign}${pred(property)}(${pred(subject)})`],
      };
    }
    case "entailment": {
      const a = one("antecedent"), b = one("consequent");
      if (!a || !b) return null;
      return {
        name: `entails(${a},${b})`,
        propositions: [
          `all x (${pred(a)}(x) -> ${pred(b)}(x))`,
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
