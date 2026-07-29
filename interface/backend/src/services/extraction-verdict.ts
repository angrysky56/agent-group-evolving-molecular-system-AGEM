import type { ExtractionReport } from "./claim-extractor.js";

export type ExtractionFailureCode =
  | "glossary-failure"
  | "unmappable-claims"
  | "vocabulary-rejections"
  | "schema-rejections"
  | "attribution-guard-rejections"
  | "storage-rejections"
  | "parse-failures"
  | "attribution-issues"
  | "quality-rejections"
  | "conversion-rejections";

export interface ExtractionFailureCause {
  code: ExtractionFailureCode;
  count: number;
  message: string;
}

interface DerivationFailures {
  attributionIssues: Array<{ segmentId: string; reason: string }>;
  rejected: Array<{
    segmentId: string;
    reason: string;
    rejectionKind?: "attribution" | "quality" | "conversion";
  }>;
}

/** Return only the failure channels that actually fired. */
export function extractionFailureCauses(
  extraction: Pick<ExtractionReport, "outcomes" | "parseFailures"> &
    Partial<Pick<ExtractionReport, "glossaryFailure" | "unmappableClaims">>,
  derivation: DerivationFailures,
): ExtractionFailureCause[] {
  const rejected = extraction.outcomes.filter((outcome) => !outcome.accepted);
  const count = (
    kind: "schema" | "attribution" | "vocabulary" | "storage",
  ) =>
    rejected.filter((outcome) => (outcome.rejectionKind ?? "storage") === kind)
      .length;
  const attributionIssueKeys = new Set(
    derivation.attributionIssues.map(
      (issue) => `${issue.segmentId}\n${issue.reason}`,
    ),
  );
  const conversionRejections = derivation.rejected.filter(
    (issue) =>
      issue.rejectionKind === "conversion" ||
      (issue.rejectionKind === undefined &&
        !attributionIssueKeys.has(`${issue.segmentId}\n${issue.reason}`)),
  ).length;
  const qualityRejections = derivation.rejected.filter(
    (issue) => issue.rejectionKind === "quality",
  ).length;

  return [
    {
      code: "glossary-failure" as const,
      count: extraction.glossaryFailure ? 1 : 0,
      message: "corpus glossary pass(es) failed, so no closed vocabulary was established",
    },
    {
      code: "unmappable-claims" as const,
      count: extraction.unmappableClaims?.length ?? 0,
      message: "explicit claim(s) could not map to the closed corpus vocabulary",
    },
    {
      code: "vocabulary-rejections" as const,
      count: count("vocabulary"),
      message: "claim(s) attempted to mint role labels outside the closed corpus vocabulary",
    },
    {
      code: "schema-rejections" as const,
      count: count("schema"),
      message: "claim(s) failed schema or role-cardinality validation",
    },
    {
      code: "attribution-guard-rejections" as const,
      count: count("attribution"),
      message: "claim(s) were rejected by the attribution-flattening guard",
    },
    {
      code: "storage-rejections" as const,
      count: count("storage"),
      message: "claim(s) were rejected by persistent storage",
    },
    {
      code: "parse-failures" as const,
      count: extraction.parseFailures.length,
      message: "segment(s) returned unparseable extraction output",
    },
    {
      code: "attribution-issues" as const,
      count: derivation.attributionIssues.length,
      message: "derived claim(s) lacked a valid assertion context",
    },
    {
      code: "quality-rejections" as const,
      count: qualityRejections,
      message: "accepted claim(s) failed deterministic quality validation",
    },
    {
      code: "conversion-rejections" as const,
      count: conversionRejections,
      message: "accepted claim(s) could not be converted into logic",
    },
  ].filter((cause) => cause.count > 0);
}

export function inconclusiveExtractionVerdict(
  causes: readonly ExtractionFailureCause[],
): string {
  const detail = causes
    .map((cause) => `${cause.count} ${cause.message}`)
    .join("; ");
  return (
    `INCONCLUSIVE EXTRACTION — ${detail || "the extraction was incomplete"}. ` +
    "No whole-corpus logical verdict is established and no finding may be stored."
  );
}

/** Name formalization failures directly instead of using an attribution catch-all. */
export function inconclusiveFormalizationVerdict(
  warnings: ReadonlyArray<{
    code: string;
    severity: string;
    message: string;
  }>,
): string {
  const critical = warnings.filter((warning) => warning.severity === "critical");
  const detail = critical
    .map((warning) => `${warning.code}: ${warning.message}`)
    .join("; ");
  return (
    `INCONCLUSIVE FORMALIZATION — ${detail || "critical encoding defects were reported"}. ` +
    "Preflight stopped before the prover, so no logical verdict was computed."
  );
}

/**
 * Missing claims cannot invalidate an UNSAT witness over accepted claims, but
 * they do invalidate a clean whole-corpus result. Preserve that asymmetry.
 */
export function applyExtractionCoverage<
  T extends { verdictKind: string; semanticsValidated: boolean },
>(
  verdict: T,
  coverage: { corpusComplete: boolean; capped: boolean },
): T {
  if (
    verdict.verdictKind === "no-contradiction" &&
    (!coverage.corpusComplete || coverage.capped)
  ) {
    return {
      ...verdict,
      verdictKind: "inconclusive",
      semanticsValidated: false,
    };
  }
  return verdict;
}
