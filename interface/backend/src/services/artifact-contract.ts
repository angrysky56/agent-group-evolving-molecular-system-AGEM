import type { RunIntent } from "../../../shared/types.js";

export type ArtifactContractStatus =
  | "observation"
  | "discovery-candidate"
  | "typed-claim"
  | "verified-finding";

const DISCOVERY_CANDIDATE_TOOLS = new Set([
  "detect_gaps",
  "generate_catalyst_questions",
]);

const DISCOVERY_OBSERVATION_TOOLS = new Set([
  "get_agem_state",
  "run_agem_cycle",
  "run_agem_cycles_sectioned",
  "get_graph_topology",
  "get_cohomology",
  "get_soc_metrics",
  "search_context",
]);

const DISCOVERY_TOOL_NAMES = new Set([
  ...DISCOVERY_CANDIDATE_TOOLS,
  ...DISCOVERY_OBSERVATION_TOOLS,
  "spawn_agem_agent",
  "reset_agem_engine",
  "read_skill",
]);

const VERIFICATION_TOOL_NAMES = new Set([
  "get_agem_state",
  "evaluate_logical_consistency",
  "get_check_log",
  "extract_and_verify_claims",
  "list_finding_conflicts",
  "resolve_finding_conflict",
  "read_skill",
]);

export function normalizeRunIntent(value: unknown): RunIntent {
  return value === "discover" ||
    value === "verify" ||
    value === "discover-then-verify"
    ? value
    : "discover-then-verify";
}

/** Native AGEM tool surface allowed for a run intent. */
export function toolNamesForRunIntent(intent: RunIntent): ReadonlySet<string> | null {
  if (intent === "discover") return DISCOVERY_TOOL_NAMES;
  if (intent === "verify") return VERIFICATION_TOOL_NAMES;
  return null;
}

/**
 * Attach the epistemic contract to machine-readable output. Existing fields
 * are preserved except for runIntent, which always records the current run.
 */
export function annotateArtifactOutput(
  fnName: string,
  output: string,
  intent: RunIntent,
): string {
  if (
    !DISCOVERY_CANDIDATE_TOOLS.has(fnName) &&
    !DISCOVERY_OBSERVATION_TOOLS.has(fnName) &&
    fnName !== "extract_and_verify_claims" &&
    fnName !== "evaluate_logical_consistency"
  ) {
    return output;
  }
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      return JSON.stringify(
        parsed.map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? annotateObject(fnName, entry as Record<string, unknown>, intent)
            : entry,
        ),
      );
    }
    if (!parsed || typeof parsed !== "object") return output;
    return JSON.stringify(
      annotateObject(fnName, parsed as Record<string, unknown>, intent),
    );
  } catch {
    return output;
  }
}

function annotateObject(
  fnName: string,
  parsed: Record<string, unknown>,
  intent: RunIntent,
): Record<string, unknown> {
    const discoveryCandidate = DISCOVERY_CANDIDATE_TOOLS.has(fnName);
    const formallyVerified =
      (fnName === "extract_and_verify_claims" ||
        fnName === "evaluate_logical_consistency") &&
      parsed.semanticsValidated === true;
    const extraction =
      parsed.extraction && typeof parsed.extraction === "object"
        ? (parsed.extraction as Record<string, unknown>)
        : undefined;
    const sourceSegments = Array.isArray(extraction?.sourceSegments)
      ? extraction.sourceSegments
      : [];
    const sourceReferences = sourceSegments
      .map((segment) =>
        segment && typeof segment === "object"
          ? (segment as Record<string, unknown>).sourceSegmentId
          : undefined,
      )
      .filter((value): value is string => typeof value === "string");
    if (typeof parsed.gap_id === "string") sourceReferences.push(parsed.gap_id);
    const unmappableCount = Array.isArray(extraction?.unmappableClaims)
      ? extraction.unmappableClaims.length
      : null;
    return {
      ...parsed,
      runIntent: intent,
      artifactStatus:
        parsed.artifactStatus ??
        (discoveryCandidate
          ? "discovery-candidate"
          : formallyVerified
            ? "verified-finding"
            : fnName === "extract_and_verify_claims"
              ? "typed-claim"
              : "observation"),
      evidenceScope:
        parsed.evidenceScope ??
        (fnName === "extract_and_verify_claims"
          ? "source-grounded-typed-claims"
          : fnName === "evaluate_logical_consistency"
            ? "audited-formulas-only"
            : "discovery-diagnostic"),
      formalCertificateExists:
        parsed.formalCertificateExists ?? formallyVerified,
      discoveryProposal:
        parsed.discoveryProposal ?? discoveryCandidate,
      coverage:
        parsed.coverage ??
        (fnName === "extract_and_verify_claims"
          ? "not-reported"
          : "not-applicable"),
      unmappableCount: parsed.unmappableCount ?? unmappableCount,
      artifactProvenance: parsed.artifactProvenance ?? {
        producer: fnName,
        sourceReferences: [...new Set(sourceReferences)].sort(),
        transformation:
          fnName === "extract_and_verify_claims"
            ? "closed-glossary typed extraction and formal verification"
            : discoveryCandidate
              ? "bounded discovery proposal generation"
              : "diagnostic observation",
        validationStatus: formallyVerified
          ? "semantics-validated"
          : discoveryCandidate
            ? "propose-only"
            : "not-formally-validated",
      },
    };
}
