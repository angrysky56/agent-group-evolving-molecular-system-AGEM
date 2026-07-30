import { canonicalClaim, type ExtractedClaim } from "./claim-extractor.js";

export interface BaselineAnswerKey {
  corpusId: string;
  mustFind: string[];
  mustNotFind: string[];
}

export interface BaselineExtractionRun {
  corpusId: string;
  runId: string;
  segmentsProcessed: number;
  outcomes: Array<{
    segmentId: string;
    accepted: boolean;
    claim?: ExtractedClaim;
  }>;
  unmappableSegmentIds: string[];
  latencyMs: number;
  costUsd?: number;
  truncated: boolean;
  providerFailure: boolean;
}

export interface ExtractorBaselineReport {
  scorecard: {
    mustFind: { found: number; total: number; recall: number | null };
    mustNotFindViolations: number;
    coverage: { acceptedClaims: number; segmentsProcessed: number; ratio: number | null };
    vacuousRuns: number;
  };
  runCount: number;
  exactSegmentAgreement: { agreed: number; total: number; ratio: number | null };
  disagreement: {
    kind: number;
    roles: number;
    scope: number;
    polarity: number;
    omission: number;
    unmappable: number;
  };
  operations: {
    totalLatencyMs: number;
    meanLatencyMs: number | null;
    totalCostUsd: number | null;
    truncationRuns: number;
    providerFailureRuns: number;
  };
  adaptiveSamplingRecommended: boolean;
}

export function evaluateExtractorBaseline(
  runs: readonly BaselineExtractionRun[],
  keys: readonly BaselineAnswerKey[],
): ExtractorBaselineReport {
  const keyByCorpus = new Map(keys.map((key) => [key.corpusId, key]));
  let found = 0;
  let mustFindTotal = 0;
  let mustNotFindViolations = 0;
  let acceptedClaims = 0;
  let segmentsProcessed = 0;
  let vacuousRuns = 0;

  for (const run of runs) {
    const claims = acceptedCanonicalClaims(run);
    const key = keyByCorpus.get(run.corpusId);
    if (key) {
      mustFindTotal += key.mustFind.length;
      found += key.mustFind.filter((claim) => claims.has(claim)).length;
      mustNotFindViolations += key.mustNotFind.filter((claim) =>
        claims.has(claim),
      ).length;
    }
    acceptedClaims += claims.size;
    segmentsProcessed += run.segmentsProcessed;
    if (claims.size === 0) vacuousRuns++;
  }

  const grouped = new Map<string, BaselineExtractionRun[]>();
  for (const run of runs) {
    const current = grouped.get(run.corpusId) ?? [];
    current.push(run);
    grouped.set(run.corpusId, current);
  }

  const disagreement = {
    kind: 0,
    roles: 0,
    scope: 0,
    polarity: 0,
    omission: 0,
    unmappable: 0,
  };
  let agreementTotal = 0;
  let agreementCount = 0;
  for (const corpusRuns of grouped.values()) {
    const segmentIds = new Set(
      corpusRuns.flatMap((run) => [
        ...run.outcomes.map((outcome) => outcome.segmentId),
        ...run.unmappableSegmentIds,
      ]),
    );
    for (const segmentId of segmentIds) {
      agreementTotal++;
      const structures = corpusRuns.map((run) =>
        structuresForSegment(run, segmentId),
      );
      if (allEqual(structures.map((value) => value.full))) agreementCount++;
      if (!allEqual(structures.map((value) => value.kinds))) disagreement.kind++;
      if (!allEqual(structures.map((value) => value.roles))) disagreement.roles++;
      if (!allEqual(structures.map((value) => value.scopes))) disagreement.scope++;
      if (!allEqual(structures.map((value) => value.polarities))) disagreement.polarity++;
      if (!allEqual(structures.map((value) => value.count))) disagreement.omission++;
      if (!allEqual(structures.map((value) => value.unmappable))) {
        disagreement.unmappable++;
      }
    }
  }

  const totalLatencyMs = runs.reduce((sum, run) => sum + run.latencyMs, 0);
  const costs = runs.map((run) => run.costUsd).filter((value): value is number => value !== undefined);
  const exactRatio = ratio(agreementCount, agreementTotal);
  return {
    scorecard: {
      mustFind: {
        found,
        total: mustFindTotal,
        recall: ratio(found, mustFindTotal),
      },
      mustNotFindViolations,
      coverage: {
        acceptedClaims,
        segmentsProcessed,
        ratio: ratio(acceptedClaims, segmentsProcessed),
      },
      vacuousRuns,
    },
    runCount: runs.length,
    exactSegmentAgreement: {
      agreed: agreementCount,
      total: agreementTotal,
      ratio: exactRatio,
    },
    disagreement,
    operations: {
      totalLatencyMs,
      meanLatencyMs: runs.length > 0 ? totalLatencyMs / runs.length : null,
      totalCostUsd:
        costs.length === runs.length
          ? costs.reduce((sum, value) => sum + value, 0)
          : null,
      truncationRuns: runs.filter((run) => run.truncated).length,
      providerFailureRuns: runs.filter((run) => run.providerFailure).length,
    },
    adaptiveSamplingRecommended:
      runs.length > 0 &&
      (exactRatio === null || exactRatio < 0.9) &&
      runs.every((run) => !run.providerFailure),
  };
}

function acceptedCanonicalClaims(run: BaselineExtractionRun): Set<string> {
  return new Set(
    run.outcomes
      .filter(
        (outcome): outcome is typeof outcome & { claim: ExtractedClaim } =>
          outcome.accepted && !!outcome.claim,
      )
      .map((outcome) => canonicalClaim(outcome.claim)),
  );
}

function structuresForSegment(run: BaselineExtractionRun, segmentId: string) {
  const claims = run.outcomes
    .filter(
      (outcome): outcome is typeof outcome & { claim: ExtractedClaim } =>
        outcome.segmentId === segmentId && outcome.accepted && !!outcome.claim,
    )
    .map((outcome) => outcome.claim);
  const sort = (values: unknown[]) => JSON.stringify(values.map(stableValue).sort());
  return {
    full: sort(claims.map(canonicalClaim)),
    kinds: sort(claims.map((claim) => claim.kind)),
    roles: sort(claims.map((claim) => claim.roles)),
    scopes: sort(claims.map((claim) => claim.scope ?? null)),
    polarities: sort(claims.map((claim) => claim.polarity ?? null)),
    count: String(claims.length),
    unmappable: String(run.unmappableSegmentIds.includes(segmentId)),
  };
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${key}:${stableValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function allEqual(values: string[]): boolean {
  return values.length <= 1 || values.every((value) => value === values[0]);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
