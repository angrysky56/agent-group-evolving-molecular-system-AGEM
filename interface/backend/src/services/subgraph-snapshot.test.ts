import { describe, expect, it } from "vitest";
import type { SubgraphRegistrySnapshot } from "#agem/lcm/index.js";
import { prepareSubgraphsForEmbeddingModel } from "./subgraph-snapshot.js";

const snapshot = (embeddingModel: string): SubgraphRegistrySnapshot => ({
  activeSubgraphId: "default",
  subgraphs: [
    {
      id: "default",
      name: "first",
      createdAt: 1,
      embeddingModel,
      entries: [],
      embeddings: { entry: [1, 0, 0] },
      summaryNodes: [],
    },
  ],
});

describe("prepareSubgraphsForEmbeddingModel", () => {
  it("uses the legacy root tag to invalidate blank-model subgraph caches after a model swap", () => {
    const result = prepareSubgraphsForEmbeddingModel(
      snapshot(""),
      "provider/new-model",
      { model: "provider/old-model", dim: 3 },
    );

    expect(result.snapshot.subgraphs[0]).toMatchObject({
      embeddingModel: "provider/new-model",
      embeddings: {},
    });
    expect(result.invalidations[0]).toMatch(/old-model.*new-model/i);
  });

  it("applies the legacy dimension only to the subgraph whose root cache supplied it", () => {
    const source = snapshot("");
    source.subgraphs.push({
      ...source.subgraphs[0]!,
      id: "second",
      name: "second",
      embeddings: { other: [1, 0, 0, 0] },
    });

    const result = prepareSubgraphsForEmbeddingModel(
      source,
      "provider/current-model",
      { model: "provider/current-model", dim: 3 },
    );

    expect(result.snapshot.subgraphs[1]!.embeddings).toEqual({
      other: [1, 0, 0, 0],
    });
    expect(result.invalidations).toEqual([]);
  });
});
