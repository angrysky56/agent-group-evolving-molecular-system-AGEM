import { describe, expect, it } from "vitest";
import {
  evaluateRegistryDiscoveryValue,
  type DiscoveryReplayCycle,
} from "./DiscoveryValueEvaluator.js";

const usefulCycles: DiscoveryReplayCycle[] = Array.from(
  { length: 12 },
  (_, index) => ({
    cycleId: `saved-${index + 1}`,
    heldOutBridgeIds: [`bridge-${index}`],
    candidates: [
      {
        id: `decoy-${index}`,
        graphScore: 0.81,
        registryCycleScore: 0,
        perturbedRegistryCycleScore: 0.01,
        explorationCost: 1,
      },
      {
        id: `bridge-${index}`,
        graphScore: 0.8,
        registryCycleScore: 0.5,
        perturbedRegistryCycleScore: 0.48,
        explorationCost: 1,
      },
    ],
  }),
);

describe("registry cycle-topology discovery value", () => {
  it("retains the signal only when it adds stable held-out recovery", () => {
    const result = evaluateRegistryDiscoveryValue(usefulCycles, {
      topK: 1,
      registryWeight: 0.1,
      maximumMarginalCost: 2,
    });
    expect(result).toMatchObject({
      cycles: 12,
      graphOnly: { recovered: 0 },
      graphPlusRegistry: { recovered: 12, meanPerturbationJaccard: 1 },
      additionalUsefulProposals: 12,
      costPerAdditionalUsefulProposal: 1,
      decision: "retain-provisionally",
      decisionReasons: [],
    });
  });

  it("recommends retirement when the registry signal adds no value", () => {
    const noGain = usefulCycles.map((cycle) => ({
      ...cycle,
      candidates: cycle.candidates.map((candidate) => ({
        ...candidate,
        registryCycleScore: 0,
        perturbedRegistryCycleScore: 0,
      })),
    }));
    const result = evaluateRegistryDiscoveryValue(noGain, { topK: 1 });
    expect(result.decision).toBe("retire-after-migration");
    expect(result.decisionReasons).toContain("no incremental held-out recovery");
  });
});
