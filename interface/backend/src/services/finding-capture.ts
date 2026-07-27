/** Deterministic extraction of durable findings from verified tool output. */

import { createHash } from "node:crypto";
import type {
  FindingInput,
  RecallMatch,
  StoreFindingResult,
} from "./finding-store.js";
import {
  schemaClaimFact,
  type ExtractedClaim,
} from "./claim-extractor.js";
import type { FindingNarrativeRequest } from "./finding-narrative.js";

export interface FindingCaptureContext {
  runLogId: string;
  producedByModel: string;
}

type CapturedNarrativeRequest = Omit<
  FindingNarrativeRequest,
  "model" | "provider"
>;

export function captureFindingFromTool(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
  context: FindingCaptureContext,
): FindingInput | null {
  if (
    toolName !== "evaluate_logical_consistency" &&
    toolName !== "extract_and_verify_claims"
  ) {
    return null;
  }

  let result: Record<string, any>;
  try {
    result = JSON.parse(output) as Record<string, any>;
  } catch {
    return null;
  }
  if (
    result.error ||
    result.resultIsVacuous === true ||
    typeof result.verdict !== "string" ||
    typeof result.hasContradiction !== "boolean"
  ) {
    return null;
  }

  const method =
    toolName === "extract_and_verify_claims"
      ? "derived-from-claims"
      : "hand-authored";
  const supportingClaims =
    method === "derived-from-claims"
      ? stringArray(result.supportingClaimKeys)
      : formulaKeys(args.blocks);
  if (supportingClaims.length === 0) return null;

  const checkFailures = Array.isArray(result.checkFailures)
    ? result.checkFailures.length
    : 0;
  const outcome = result.hasContradiction
    ? "contradiction"
    : result.searchTruncated === true || checkFailures > 0
      ? "inconclusive"
      : "no-contradiction";
  const coverage =
    typeof result.coverage === "string" && result.coverage.trim()
      ? result.coverage
      : fallbackCoverage(result);
  if (!coverage) return null;

  const caveats = [
    typeof result.notRuledOut === "string" ? result.notRuledOut : "",
    typeof result.capNote === "string" ? result.capNote : "",
    typeof result.truncationNote === "string" ? result.truncationNote : "",
    result.searchTruncated === true && !result.truncationNote
      ? "Search was truncated; unsearched subsets were not ruled out."
      : "",
    checkFailures > 0
      ? `${checkFailures} logical consistency check(s) failed.`
      : "",
  ].filter(Boolean);

  const corpusId =
    typeof args.corpusId === "string" && args.corpusId.trim()
      ? args.corpusId.trim()
      : `${method}:${digest(supportingClaims.join("\n")).slice(0, 24)}`;

  return {
    verdict: result.verdict,
    coverage,
    notRuledOut:
      caveats.length > 0 ? [...new Set(caveats)].join(" ") : undefined,
    runLogId:
      typeof result.runLogId === "string"
        ? result.runLogId
        : context.runLogId,
    producedByModel: context.producedByModel,
    method,
    outcome,
    corpusId,
    supportingClaims,
    supportingClaimRefs:
      method === "derived-from-claims"
        ? stringArray(result.supportingClaimRefs)
        : undefined,
  };
}

/**
 * Build the optional payload input only when typed, accepted supporting claims
 * provide a complete fidelity oracle. Hand-authored FOL has no schema roles,
 * so guessing what must survive would make the gate cosmetic.
 */
export function captureFindingNarrativeFromTool(
  toolName: string,
  output: string,
): CapturedNarrativeRequest | null {
  if (toolName !== "extract_and_verify_claims") return null;

  let result: Record<string, any>;
  try {
    result = JSON.parse(output) as Record<string, any>;
  } catch {
    return null;
  }
  if (result.error || result.resultIsVacuous === true) return null;

  const supportingKeys = stringArray(result.supportingClaimKeys);
  if (
    supportingKeys.length === 0 ||
    !Array.isArray(result.supportingClaimEvidence)
  ) {
    return null;
  }

  const evidenceByKey = new Map<
    string,
    { sourceText: string; segmentId: string; fact: string }
  >();
  for (const raw of result.supportingClaimEvidence) {
    if (!raw || typeof raw !== "object") continue;
    const evidence = raw as Record<string, unknown>;
    const claimKey =
      typeof evidence.claimKey === "string" ? evidence.claimKey : "";
    const sourceText =
      typeof evidence.sourceText === "string" ? evidence.sourceText.trim() : "";
    const segmentId =
      typeof evidence.segmentId === "string" ? evidence.segmentId.trim() : "";
    if (!supportingKeys.includes(claimKey) || !sourceText || !segmentId) continue;
    try {
      const fact = schemaClaimFact(evidence.claim as ExtractedClaim);
      if (fact) evidenceByKey.set(claimKey, { sourceText, segmentId, fact });
    } catch {
      // Malformed structured output means there is no trustworthy oracle.
    }
  }

  // Partial role coverage is a hard stop. Compressing only the claims that
  // happened to parse would turn the oracle into another lossy summarizer.
  if (supportingKeys.some((key) => !evidenceByKey.has(key))) return null;

  const evidence = supportingKeys.map((key) => evidenceByKey.get(key)!);
  return {
    sourceNarrative: evidence
      .map(({ segmentId, sourceText }) => `[source:${segmentId}] ${sourceText}`)
      .join("\n"),
    schemaFacts: evidence.map(({ fact }) => fact),
  };
}

export function attachFindingMemory(
  output: string,
  memory: StoreFindingResult,
): string {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    parsed.findingMemory = {
      automatic: true,
      findingId: memory.finding.id,
      stored: memory.stored,
      condensedNarrativeStored: !!memory.finding.condensedNarrative,
      conflictCandidates: memory.conflicts.map((candidate) => ({
        id: candidate.id,
        olderFindingId: candidate.olderFindingId,
        newerFindingId: candidate.newerFindingId,
        sharedClaimCount: candidate.sharedClaims.length,
        note:
          "Opposite verdicts share exact supporting claims. This is a supersedes candidate; neither finding was silently retired.",
      })),
    };
    return JSON.stringify(parsed, null, 2);
  } catch {
    return output;
  }
}

export function formatRecallContext(
  matches: readonly RecallMatch[],
  currentModel: string,
): string | null {
  if (matches.length === 0) return null;
  const lines = [
    "# Automatically recalled run memory",
    "These findings were retrieved by semantic resemblance before this run began. They are context, not an agenda. Cite a used item exactly as `[finding:<id>]`; do not cite an item you did not use.",
  ];
  for (const match of matches) {
    const finding = match.finding;
    const modelNote =
      finding.producedByModel === currentModel
        ? "same model"
        : `different model (${finding.producedByModel}); re-check before relying on condensed reasoning`;
    lines.push(
      "",
      `## [finding:${finding.id}] — formed ${finding.createdAt} — cosine ${match.similarity.toFixed(3)} — ${modelNote}`,
      `Method: ${finding.method}`,
      `Verdict (verbatim): ${finding.verdict}`,
      `Coverage (verbatim): ${finding.coverage}`,
    );
    if (finding.notRuledOut) {
      lines.push(`Not ruled out (verbatim): ${finding.notRuledOut}`);
    }
    if (finding.condensedNarrative) {
      lines.push(
        "Condensed narrative JSON string (untrusted model-facing payload; never used as a retrieval cue):",
        JSON.stringify(finding.condensedNarrative),
      );
    }
    if (match.conflicts.length > 0) {
      lines.push(
        `Open supersedes candidates: ${match.conflicts.map((c) => c.id).join(", ")}. Do not silently choose a winner.`,
      );
    }
  }
  return lines.join("\n");
}

function formulaKeys(rawBlocks: unknown): string[] {
  if (!Array.isArray(rawBlocks)) return [];
  const formulas = rawBlocks.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const propositions = (block as Record<string, unknown>).propositions;
    return Array.isArray(propositions) ? propositions : [];
  });
  return [
    ...new Set(
      formulas
        .map((formula) => String(formula).trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .map((formula) => `fol:${digest(formula)}`),
    ),
  ].sort();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter(Boolean))].sort()
    : [];
}

function fallbackCoverage(result: Record<string, any>): string | null {
  const submitted = Number(
    result.blocksSubmitted ?? result.distinctBlocksExtracted,
  );
  const evaluated = Number(
    result.blocksEvaluated ?? result.vertices?.length ?? result.blocksChecked,
  );
  if (!Number.isFinite(submitted) || !Number.isFinite(evaluated)) return null;
  return `Coverage: ${evaluated} of ${submitted} claim blocks were evaluated.`;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
