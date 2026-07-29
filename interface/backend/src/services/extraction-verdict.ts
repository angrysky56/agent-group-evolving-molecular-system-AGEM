import type { ExtractionReport } from "./claim-extractor.js";

export type ExtractionFailureCode =
  | "schema-rejections"
  | "attribution-guard-rejections"
  | "storage-rejections"
  | "parse-failures"
  | "attribution-issues"
  | "conversion-rejections";

export interface ExtractionFailureCause {
  code: ExtractionFailureCode;
  count: number;
  message: string;
}

interface DerivationFailures {
  attributionIssues: Array<{ segmentId: string; reason: string }>;
  rejected: Array<{ segmentId: string; reason: string }>;
}

/** Return only the failure channels that actually fired. */
export function extractionFailureCauses(
  extraction: Pick<ExtractionReport, "outcomes" | "parseFailures">,
  derivation: DerivationFailures,
): ExtractionFailureCause[] {
  const rejected = extraction.outcomes.filter((outcome) => !outcome.accepted);
  const count = (kind: "schema" | "attribution" | "storage") =>
    rejected.filter((outcome) => (outcome.rejectionKind ?? "storage") === kind)
      .length;
  const attributionIssueKeys = new Set(
    derivation.attributionIssues.map(
      (issue) => `${issue.segmentId}\n${issue.reason}`,
    ),
  );
  const conversionRejections = derivation.rejected.filter(
    (issue) => !attributionIssueKeys.has(`${issue.segmentId}\n${issue.reason}`),
  ).length;

  return [
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
    "No logical verdict was computed and no finding may be stored."
  );
}
