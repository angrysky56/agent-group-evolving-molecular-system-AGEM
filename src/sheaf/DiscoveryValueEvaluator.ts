export interface DiscoveryRankingCandidate {
  readonly id: string;
  readonly graphScore: number;
  /** Registry cycle-topology metadata; never logical evidence. */
  readonly registryCycleScore: number;
  readonly perturbedRegistryCycleScore: number;
  readonly explorationCost: number;
}

export interface DiscoveryReplayCycle {
  readonly cycleId: string;
  readonly heldOutBridgeIds: readonly string[];
  readonly candidates: readonly DiscoveryRankingCandidate[];
}

export interface DiscoveryValueEvaluation {
  readonly cycles: number;
  readonly topK: number;
  readonly graphOnly: { recovered: number; meanReciprocalRank: number };
  readonly graphPlusRegistry: {
    recovered: number;
    meanReciprocalRank: number;
    meanPerturbationJaccard: number;
  };
  readonly additionalUsefulProposals: number;
  readonly costPerAdditionalUsefulProposal: number | null;
  readonly decision: "retain-provisionally" | "retire-after-migration";
  readonly decisionReasons: string[];
}

export interface DiscoveryValueOptions {
  readonly topK?: number;
  readonly registryWeight?: number;
  readonly minimumCycles?: number;
  readonly minimumStability?: number;
  readonly maximumMarginalCost?: number;
}

/** Deterministic A/B test of graph ranking with and without registry topology. */
export function evaluateRegistryDiscoveryValue(
  cycles: readonly DiscoveryReplayCycle[],
  options: DiscoveryValueOptions = {},
): DiscoveryValueEvaluation {
  const topK = Math.max(1, Math.floor(options.topK ?? 3));
  const registryWeight = Math.max(0, options.registryWeight ?? 0.1);
  const minimumCycles = Math.max(1, Math.floor(options.minimumCycles ?? 10));
  const minimumStability = options.minimumStability ?? 0.8;
  const maximumMarginalCost = options.maximumMarginalCost ?? Infinity;
  let graphRecovered = 0;
  let combinedRecovered = 0;
  let graphMrr = 0;
  let combinedMrr = 0;
  let stability = 0;
  let combinedSelectedCost = 0;

  for (const cycle of cycles) {
    const heldOut = new Set(cycle.heldOutBridgeIds);
    const graph = rank(cycle.candidates, (candidate) => candidate.graphScore);
    const combined = rank(
      cycle.candidates,
      (candidate) =>
        candidate.graphScore + registryWeight * candidate.registryCycleScore,
    );
    const perturbed = rank(
      cycle.candidates,
      (candidate) =>
        candidate.graphScore +
        registryWeight * candidate.perturbedRegistryCycleScore,
    );
    graphRecovered += hits(graph.slice(0, topK), heldOut);
    combinedRecovered += hits(combined.slice(0, topK), heldOut);
    graphMrr += reciprocalRank(graph, heldOut);
    combinedMrr += reciprocalRank(combined, heldOut);
    stability += jaccard(
      combined.slice(0, topK).map((candidate) => candidate.id),
      perturbed.slice(0, topK).map((candidate) => candidate.id),
    );
    combinedSelectedCost += combined
      .slice(0, topK)
      .reduce((sum, candidate) => sum + candidate.explorationCost, 0);
  }

  const additionalUsefulProposals = combinedRecovered - graphRecovered;
  const costPerAdditionalUsefulProposal =
    additionalUsefulProposals > 0
      ? combinedSelectedCost / additionalUsefulProposals
      : null;
  const meanStability = cycles.length > 0 ? stability / cycles.length : 0;
  const reasons: string[] = [];
  if (cycles.length < minimumCycles) reasons.push("insufficient replay cycles");
  if (additionalUsefulProposals <= 0) reasons.push("no incremental held-out recovery");
  if (combinedRecovered < graphRecovered) reasons.push("registry ranking regressed recovery");
  if (meanStability < minimumStability) reasons.push("unstable under harmless perturbation");
  if (
    costPerAdditionalUsefulProposal !== null &&
    costPerAdditionalUsefulProposal > maximumMarginalCost
  ) reasons.push("marginal proposal cost exceeds ceiling");

  return {
    cycles: cycles.length,
    topK,
    graphOnly: {
      recovered: graphRecovered,
      meanReciprocalRank: cycles.length > 0 ? graphMrr / cycles.length : 0,
    },
    graphPlusRegistry: {
      recovered: combinedRecovered,
      meanReciprocalRank: cycles.length > 0 ? combinedMrr / cycles.length : 0,
      meanPerturbationJaccard: meanStability,
    },
    additionalUsefulProposals,
    costPerAdditionalUsefulProposal,
    decision:
      reasons.length === 0 ? "retain-provisionally" : "retire-after-migration",
    decisionReasons: reasons,
  };
}

function rank(
  candidates: readonly DiscoveryRankingCandidate[],
  score: (candidate: DiscoveryRankingCandidate) => number,
): DiscoveryRankingCandidate[] {
  return [...candidates].sort(
    (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
  );
}

function hits(candidates: readonly DiscoveryRankingCandidate[], heldOut: Set<string>): number {
  return candidates.filter((candidate) => heldOut.has(candidate.id)).length;
}

function reciprocalRank(
  candidates: readonly DiscoveryRankingCandidate[],
  heldOut: Set<string>,
): number {
  const index = candidates.findIndex((candidate) => heldOut.has(candidate.id));
  return index >= 0 ? 1 / (index + 1) : 0;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / union.size;
}
