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
  | "entailment";

export interface ExtractedClaim {
  kind: ClaimKind;
  /** Role name -> concept label. Role names must match the schema exactly. */
  roles: Record<string, string>;
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
  entailment: {
    roles: ["antecedent", "consequent"],
    gloss: "A implies B, directionally. Do not use for mutual implication; that is two claims.",
  },
};

function buildPrompt(segment: string): string {
  const kinds = (Object.entries(ROLE_SPEC) as [ClaimKind, typeof ROLE_SPEC[ClaimKind]][])
    .map(([kind, spec]) => {
      const roles = [...new Set(spec.roles)].join(", ");
      const extras = spec.extras?.length ? `  extra fields: ${spec.extras.join(", ")}\n` : "";
      return `- ${kind}\n  roles: ${roles}\n${extras}  ${spec.gloss}`;
    })
    .join("\n");

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

Output shape:
[{"kind":"exclusion","roles":{"excluder":"phi","excluded":"global-broadcast"}},
 {"kind":"distinction","roles":{"distinguished":["hard-problem","easy-problems"]},"differenceKind":"in-kind"}]

SENTENCE:
${segment}`;
}

/** Escape a value for a TypeQL string literal. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Canonicalise a claim without source provenance so equivalent runs overlap. */
export function canonicalClaim(claim: ExtractedClaim): string {
  const roles = Object.fromEntries(
    Object.entries(claim.roles)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, value]) => [
        role,
        Array.isArray(value) ? value.map(String).sort() : String(value),
      ]),
  );
  return JSON.stringify({
    kind: claim.kind,
    roles,
    modality: claim.modality ?? null,
    polarity: claim.polarity ?? null,
    differenceKind: claim.differenceKind ?? null,
  });
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
): { concepts: string; claim: string; claimId: string; claimKey: string } | null {
  const spec = ROLE_SPEC[claim.kind];
  if (!spec) return null;

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
    claim.modality ? `has modality "${esc(claim.modality)}"` : "",
    claim.polarity ? `has polarity "${esc(claim.polarity)}"` : "",
    claim.differenceKind ? `has difference-kind "${esc(claim.differenceKind)}"` : "",
  ].filter(Boolean);
  const attrClause = attrs.length ? `,\n    ${attrs.join(",\n    ")}` : "";

  return {
    concepts: `put\n${puts}`,
    claim: `match\n${matches}  $s isa segment, has segment-id "${esc(segmentId)}";\ninsert\n  $_ isa ${claim.kind}, links (${links}, source: $s)${attrClause};`,
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
export async function proposeClaims(segment: string): Promise<ExtractedClaim[] | null> {
  const provider = getActiveProvider();
  const res = await provider.chat({
    messages: [{ role: "user", content: buildPrompt(segment) }],
    maxTokens: 1024,
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

function buildBatchPrompt(segments: Array<{ id: string; text: string }>): string {
  const numbered = segments.map((s, i) => `[${i}] ${s.text}`).join("\n");
  return `${buildPrompt("(see the numbered sentences below)")}

You are given SEVERAL sentences. Treat each INDEPENDENTLY — do not carry a
claim from one sentence into another, and do not merge them.

Return a JSON object mapping each index to its claim array, e.g.
{"0": [], "1": [{"kind":"exclusion","roles":{"excluder":"phi","excluded":"global-broadcast"}}]}

SENTENCES:
${numbered}`;
}

/** Extract claims for a batch. Returns a map from batch index to claims. */
async function proposeClaimsBatch(
  segments: Array<{ id: string; text: string }>,
): Promise<Map<number, ExtractedClaim[] | null>> {
  const out = new Map<number, ExtractedClaim[] | null>();
  const provider = getActiveProvider();

  /*
   * Losing a whole batch to one bad response is not acceptable — a truncated
   * reply would write off every segment in it. Fall back to per-segment calls,
   * which are slower but cannot take their neighbours down with them.
   */
  const fallbackPerSegment = async () => {
    const results = await Promise.all(
      segments.map((s) => proposeClaims(s.text).catch(() => null)),
    );
    results.forEach((r, i) => out.set(i, r));
    return out;
  };

  let content = "";
  try {
    const res = await provider.chat({
      messages: [{ role: "user", content: buildBatchPrompt(segments) }],
      maxTokens: BATCH_MAX_TOKENS,
    });
    content = res.content;
  } catch {
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
): Promise<ExtractionReport> {
  const report: ExtractionReport = {
    segmentsProcessed: 0,
    claimsProposed: 0,
    claimsAccepted: 0,
    claimsRejected: 0,
    outcomes: [],
    parseFailures: [],
  };

  if (!claimStore.available) return report;

  // Split into batches, then run a bounded number of batches concurrently.
  const batches: Array<Array<{ id: string; text: string }>> = [];
  for (let i = 0; i < segments.length; i += BATCH_SIZE)
    batches.push(segments.slice(i, i + BATCH_SIZE));

  const proposals: Array<{ seg: { id: string; text: string }; claims: ExtractedClaim[] | null }> = [];
  for (let i = 0; i < batches.length; i += BATCH_CONCURRENCY) {
    const wave = batches.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(wave.map((b) => proposeClaimsBatch(b)));
    wave.forEach((batch, w) => {
      batch.forEach((seg, idx) => {
        proposals.push({ seg, claims: results[w].get(idx) ?? null });
      });
    });
  }

  for (const { seg, claims } of proposals) {
    report.segmentsProcessed++;
    await storeSegment(seg.id, seg.text, corpusId);

    if (claims === null) {
      report.parseFailures.push(seg.id);
      continue;
    }

    for (const claim of claims) {
      const query = claimToTypeQL(claim, seg.id);
      if (!query) {
        report.claimsProposed++;
        report.claimsRejected++;
        report.outcomes.push({
          segmentId: seg.id,
          claim,
          accepted: false,
          rejection: `unknown claim kind '${claim.kind}'`,
        });
        continue;
      }
      report.claimsProposed++;
      // Concepts first (upsert), then the claim. Separate writes — see
      // claimToTypeQL for why they cannot be one pipeline.
      await claimStore.write(query.concepts);
      const res = await claimStore.write(query.claim);
      const accepted = !!res && isOkResponse(res);
      if (accepted) report.claimsAccepted++;
      else report.claimsRejected++;
      report.outcomes.push({
        segmentId: seg.id,
        claim,
        claimId: query.claimId,
        claimKey: query.claimKey,
        accepted,
        rejection: accepted ? undefined : describeRejection(res),
      });
    }
  }

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
