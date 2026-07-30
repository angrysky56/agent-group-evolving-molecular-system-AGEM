import { describe, expect, it } from "vitest";
import { anomalyBlock, censusAnomalies } from "./anomaly-census.js";
import { assessAnomaly } from "./abductive-engine.js";

const communities = [
  { id: 1, label: "consciousness · selection", members: ["consciousness", "selection", "trait"] },
  { id: 9, label: "genetic · code · optimize", members: ["genetic", "code", "optimize"] },
  { id: 2, label: "orch · penrose", members: ["orch", "penrose"] },
];

describe("outlying bridges", () => {
  // The Peirce/Einstein run's most informative structural result was a bridge
  // far above the mean. It was printed and never explained.
  const edges = [
    { source: 1, target: 9, edge_count: 20 },
    { source: 1, target: 2, edge_count: 3 },
    { source: 2, target: 9, edge_count: 2 },
  ];

  it("names a bridge that outruns the mean", () => {
    const found = censusAnomalies({ communities, conceptEdges: edges });
    expect(found).toHaveLength(1);
    expect(found[0]!.observation.source).toBe("community-bridge");
    expect(found[0]!.observation.phenomenon).toMatch(/20 links/);
  });

  it("leaves ordinary connections alone", () => {
    const flat = [
      { source: 1, target: 9, edge_count: 10 },
      { source: 1, target: 2, edge_count: 9 },
      { source: 2, target: 9, edge_count: 11 },
    ];
    expect(censusAnomalies({ communities, conceptEdges: flat })).toHaveLength(0);
  });

  it("carries signals the engine's own gate will accept", async () => {
    const [candidate] = censusAnomalies({ communities, conceptEdges: edges });
    const assessment = await assessAnomaly(candidate!.observation, {
      background: [],
      oracle: async () => ({ outcome: "unprovable" }),
    });
    expect(assessment.isAnomalous).toBe(true);
  });

  it("carries concept provenance, so the gate does not refuse it", () => {
    const [candidate] = censusAnomalies({ communities, conceptEdges: edges });
    expect(candidate!.observation.segmentIds.length).toBeGreaterThan(0);
    expect(candidate!.observation.segmentIds[0]).toMatch(/^concept:/);
  });
});

describe("gaps, obstructions and conflicts", () => {
  it("names a gap by GapDetector's own criterion", () => {
    const found = censusAnomalies({
      communities,
      gaps: [
        { community_a: 1, community_b: 2, density: 0.04, shortest_path: 3, modularity_delta: 0.3 },
      ],
    });
    expect(found[0]!.observation.source).toBe("structural-gap");
  });

  it("ignores a pair that is not a gap by that criterion", () => {
    expect(
      censusAnomalies({
        communities,
        gaps: [
          { community_a: 1, community_b: 2, density: 0.04, shortest_path: 3, modularity_delta: -0.1 },
        ],
      }),
    ).toHaveLength(0);
  });

  it("treats H¹ > 0 as wanting a cause, and H¹ = 0 as nothing to explain", () => {
    expect(censusAnomalies({ communities, h1: 2 })).toHaveLength(1);
    expect(censusAnomalies({ communities, h1: 0 })).toHaveLength(0);
  });

  it("ranks an established conflict above structural hints", () => {
    const found = censusAnomalies({
      communities,
      h1: 1,
      logicVerdict: { verdictKind: "positions-incompatible", arity: 3 },
      gaps: [
        { community_a: 1, community_b: 2, density: 0.04, shortest_path: 3, modularity_delta: 0.3 },
      ],
    });
    expect(found[0]!.observation.source).toBe("logical-conflict");
    expect(found[0]!.observation.signals?.arity).toBe(3);
  });

  it("says nothing about a clean verdict", () => {
    expect(
      censusAnomalies({ communities, logicVerdict: { verdictKind: "no-contradiction" } }),
    ).toHaveLength(0);
  });
});

describe("the block itself", () => {
  it("is omitted entirely when nothing qualified", () => {
    // An empty "anomalies" section is the same scaffolding-as-substance failure
    // that made three empty repair proposals look like pending work.
    expect(anomalyBlock([])).toBeNull();
  });

  it("says these are candidates, not findings, and who must supply causes", () => {
    const block = anomalyBlock(censusAnomalies({ communities, h1: 1 }))!;
    expect(String(block.note)).toMatch(/CANDIDATES for abduce_best_explanation, not findings/);
    expect(String(block.note)).toMatch(/re-applies its own anomaly criteria/);
    expect(String(block.note)).toMatch(/You must supply the candidate causes/);
  });

  it("stays bounded so a large graph cannot flood the reader", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      source: 1,
      target: i + 100,
      edge_count: i === 0 ? 1 : 200,
    }));
    expect(censusAnomalies({ communities, conceptEdges: many }).length).toBeLessThanOrEqual(6);
  });
});
