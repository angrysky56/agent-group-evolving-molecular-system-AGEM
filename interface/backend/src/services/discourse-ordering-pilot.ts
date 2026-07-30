export type DiscourseRole = "nucleus" | "satellite" | "background";

export interface AnnotatedEdu {
  id: string;
  role: DiscourseRole;
  relation: "cause" | "evidence" | "condition" | "contrast" | "exception" | "elaboration";
}

export interface DiscoursePilotCandidate {
  id: string;
  editCount: number;
  exactGlossaryReuse: boolean;
  sourceSpanDistance: number | null;
  eduIds: string[];
  counterfactuallyValid: boolean;
}

export interface DiscoursePilotFixture {
  id: string;
  edus: AnnotatedEdu[];
  candidates: DiscoursePilotCandidate[];
}

export interface DiscoursePilotReport {
  fixtures: number;
  validCandidateRecallBaseline: number;
  validCandidateRecallDiscourse: number;
  meanEvaluationsBeforeValidBaseline: number | null;
  meanEvaluationsBeforeValidDiscourse: number | null;
  falsePruned: 0;
  recommendation: "keep-soft-tiebreaker" | "stop-after-pilot";
}

const ROLE_WEIGHT: Record<DiscourseRole, number> = {
  nucleus: 1,
  satellite: 0.7,
  // Background is inspectable metadata, not a hard zero: decisive exceptions
  // are sometimes rhetorically subordinate.
  background: 0.3,
};

/**
 * Hand-annotated pilot only. Discourse breaks exact baseline ties and never
 * removes a candidate, changes validator evidence, or becomes logical input.
 */
export function evaluateDiscourseTieBreaker(
  fixtures: readonly DiscoursePilotFixture[],
): DiscoursePilotReport {
  let baselineFound = 0;
  let discourseFound = 0;
  let baselineEvaluations = 0;
  let discourseEvaluations = 0;
  let fixturesWithValid = 0;

  for (const fixture of fixtures) {
    const eduWeights = new Map(
      fixture.edus.map((edu) => [edu.id, ROLE_WEIGHT[edu.role]]),
    );
    const base = rankCandidates(fixture.candidates, () => 0);
    const discourse = rankCandidates(fixture.candidates, (candidate) =>
      candidate.eduIds.reduce(
        (max, id) => Math.max(max, eduWeights.get(id) ?? 0),
        0,
      ),
    );
    const validCount = fixture.candidates.filter(
      (candidate) => candidate.counterfactuallyValid,
    ).length;
    baselineFound += base.filter((candidate) => candidate.counterfactuallyValid).length;
    discourseFound += discourse.filter((candidate) => candidate.counterfactuallyValid).length;
    if (validCount > 0) {
      fixturesWithValid++;
      baselineEvaluations +=
        base.findIndex((candidate) => candidate.counterfactuallyValid) + 1;
      discourseEvaluations +=
        discourse.findIndex((candidate) => candidate.counterfactuallyValid) + 1;
    }
  }

  const totalValid = fixtures.reduce(
    (sum, fixture) =>
      sum + fixture.candidates.filter((candidate) => candidate.counterfactuallyValid).length,
    0,
  );
  const baselineMean = fixturesWithValid > 0
    ? baselineEvaluations / fixturesWithValid
    : null;
  const discourseMean = fixturesWithValid > 0
    ? discourseEvaluations / fixturesWithValid
    : null;
  const recallPreserved = baselineFound === totalValid && discourseFound === totalValid;
  return {
    fixtures: fixtures.length,
    validCandidateRecallBaseline: totalValid > 0 ? baselineFound / totalValid : 1,
    validCandidateRecallDiscourse: totalValid > 0 ? discourseFound / totalValid : 1,
    meanEvaluationsBeforeValidBaseline: baselineMean,
    meanEvaluationsBeforeValidDiscourse: discourseMean,
    falsePruned: 0,
    recommendation:
      fixtures.length >= 8 &&
      recallPreserved &&
      baselineMean !== null &&
      discourseMean !== null &&
      discourseMean < baselineMean
        ? "keep-soft-tiebreaker"
        : "stop-after-pilot",
  };
}

function rankCandidates(
  candidates: readonly DiscoursePilotCandidate[],
  discourseScore: (candidate: DiscoursePilotCandidate) => number,
): DiscoursePilotCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      a.editCount - b.editCount ||
      Number(b.exactGlossaryReuse) - Number(a.exactGlossaryReuse) ||
      (a.sourceSpanDistance ?? Number.MAX_SAFE_INTEGER) -
        (b.sourceSpanDistance ?? Number.MAX_SAFE_INTEGER) ||
      // Discourse is intentionally the final semantic tie-breaker.
      discourseScore(b) - discourseScore(a) ||
      a.id.localeCompare(b.id),
  );
}
