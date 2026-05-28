import { describe, it, expect } from "vitest";
import { SubgraphRegistry } from "./SubgraphRegistry.js";
import { GptTokenCounter, MockEmbedder, MockCompressor } from "./interfaces.js";
import { Orchestrator } from "../orchestrator/ComposeRootModule.js";
import { computeCohomology } from "../sheaf/index.js";

// Deterministic embedder for robust routing testing
class DeterministicTestEmbedder extends MockEmbedder {
  async embed(text: string): Promise<Float64Array> {
    const vec = new Float64Array(384);
    if (
      text.includes("biology") ||
      text.includes("genetics") ||
      text.includes("transcription") ||
      text.includes("RNA")
    ) {
      vec[0] = 1.0;
    } else if (
      text.includes("chemistry") ||
      text.includes("covalent") ||
      text.includes("bonds") ||
      text.includes("molecules")
    ) {
      vec[1] = 1.0;
    } else {
      return super.embed(text);
    }
    return vec;
  }
}

describe("SubgraphRegistry & MEMO-inspired Subgraphs (Move B & C)", () => {
  const tokenCounter = new GptTokenCounter();
  const embedder = new DeterministicTestEmbedder();

  it("B1: SubgraphRegistry successfully manages named independent subgraphs", async () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);

    // Default subgraph exists
    expect(registry.list()).toHaveLength(1);
    expect(registry.activeSubgraph.name).toBe("default");
    expect(registry.activeSubgraphId).toBe("default");

    // Create custom subgraphs
    const subA = registry.create("molecular-biology");
    const subB = registry.create("quantum-chemistry");

    expect(registry.list()).toHaveLength(3);
    expect(registry.get(subA.id)).toBeDefined();
    expect(registry.get(subB.id)).toBeDefined();

    // Activate custom subgraph
    registry.activate(subA.id);
    expect(registry.activeSubgraphId).toBe(subA.id);
    expect(registry.activeSubgraph.name).toBe("molecular-biology");
  });

  it("B1: SubgraphRegistry correctly snapshots and restores the entire registry", () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    const subA = registry.create("biology");
    subA.store.append("RNA transcription details");

    const snapshot = registry.snapshot();
    expect(snapshot.subgraphs).toHaveLength(2);

    const newRegistry = new SubgraphRegistry(embedder, tokenCounter);
    newRegistry.restore(snapshot);

    expect(newRegistry.list()).toHaveLength(2);
    const restoredSubA = newRegistry.get(subA.id);
    expect(restoredSubA).toBeDefined();
    expect(restoredSubA!.name).toBe("biology");
    expect(restoredSubA!.store.size).toBe(1);
    expect(restoredSubA!.store.getAll()[0]!.content).toBe(
      "RNA transcription details",
    );
  });

  it("B1/C1: SubgraphRegistry routes queries to correct subgraphs based on root similarity and reflections", async () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    const subBio = registry.create("biology", "bio-id");
    const subChem = registry.create("chemistry", "chem-id");

    // Append some content
    const entryBio = subBio.store.append("RNA sequencing and genetics");
    const entryChem = subChem.store.append(
      "Covalent chemical bonds and molecules",
    );

    // Cache embeddings
    await subBio.cache.cacheEntry(entryBio.id, entryBio.content);
    await subChem.cache.cacheEntry(entryChem.id, entryChem.content);

    // Route biology query
    const routesBio = await registry.route(
      "Tell me about RNA genetics",
      embedder,
    );
    expect(routesBio[0]!.subgraphId).toBe("bio-id");

    // Route chemistry query
    const routesChem = await registry.route(
      "What are chemical bonds?",
      embedder,
    );
    expect(routesChem[0]!.subgraphId).toBe("chem-id");
  });

  it("B2: Orchestrator dynamically builds CellularSheaf and runs CohomologyAnalyzer over multiple subgraphs", async () => {
    const customCompressor = new MockCompressor();
    const orch = new Orchestrator(embedder, customCompressor);

    try {
      // Initially 1 subgraph (default) -> 0 edges
      const sheaf1 = await orch.buildSheafFromRegistry();
      expect(sheaf1.getVertexIds()).toHaveLength(1);
      expect(sheaf1.getEdgeIds()).toHaveLength(0);

      // Create 3 subgraphs in a triangle topology by making them share topic alignments
      const subA = orch.subgraphRegistry.create("Biology", "sub-a");
      const subB = orch.subgraphRegistry.create("Biochemistry", "sub-b");
      const subC = orch.subgraphRegistry.create("Molecular Biology", "sub-c");

      // Add overlapping topic entries so they align above 0.7 threshold
      const entryA = subA.store.append(
        "Shared topic: cellular proteins and molecular biochemistry",
      );
      const entryB = subB.store.append(
        "Shared topic: cellular proteins and molecular biochemistry",
      );
      const entryC = subC.store.append(
        "Shared topic: cellular proteins and molecular biochemistry",
      );

      await subA.cache.cacheEntry(entryA.id, entryA.content);
      await subB.cache.cacheEntry(entryB.id, entryB.content);
      await subC.cache.cacheEntry(entryC.id, entryC.content);

      // Build the dynamic sheaf
      const sheaf = await orch.buildSheafFromRegistry();

      // Total subgraphs = 4 (default, A, B, C)
      expect(sheaf.getVertexIds()).toHaveLength(4);

      // Edges between A-B, B-C, C-A (3 edges) because of overlapping topic
      expect(sheaf.getEdgeIds()).toHaveLength(3);

      // Run Cohomology analysis using standalone function to bypass spawner triggering
      const result = computeCohomology(sheaf);

      // Since there are loops/cycles in the dynamic base graph (triangle A-B-C), H^1 is non-zero (384-dimensional per loop)
      expect(result.h1Dimension).toBeGreaterThan(0);
      expect(result.hasObstruction).toBe(true);
    } finally {
      // Properly shutdown the orchestrator to clean up background spawner cycles
      await orch.shutdown();
    }
  });

  it("C1: reflections are generated at compaction and used in query routing", async () => {
    class ReflectionMockCompressor extends MockCompressor {
      async generateReflections(text: string) {
        return [
          { question: "What is RNA?", answer: "RNA is ribonucleic acid." },
          {
            question: "How does sequencing work?",
            answer: "By reading nucleotides.",
          },
        ];
      }
    }

    const mockComp = new ReflectionMockCompressor();
    const orch = new Orchestrator(embedder, mockComp);

    try {
      // Trigger compaction (add past token limit)
      // Live escalation threshold is 1000, so let's set level1TokenLimit to 10 for testing
      orch.lcmEscalation.setThresholds({ level1TokenLimit: 10 });

      await orch.runReasoning(
        "This is a very long prompt to trigger compaction.",
      );

      const active = orch.subgraphRegistry.activeSubgraph;
      const summaryNodes = active.summaryIndex.list();
      expect(summaryNodes).toHaveLength(1);

      const node = summaryNodes[0]!;
      expect(node.metrics.reflections).toHaveLength(2);
      expect((node.metrics.reflections as any)[0].question).toBe(
        "What is RNA?",
      );

      // Verify reflection question embeddings are seeded
      expect(active.cache.has(`${node.id}-ref-0`)).toBe(true);
      expect(active.cache.has(`${node.id}-ref-1`)).toBe(true);

      // Routing ranks the query highly if matching reflection question
      const routes = await orch.subgraphRegistry.route(
        "Tell me about RNA genetics",
        embedder,
      );
      expect(routes[0]!.score).toBeGreaterThan(0.5);
    } finally {
      await orch.shutdown();
    }
  });

  it("C2: staged query protocol runs successfully", async () => {
    class StagedMockCompressor extends MockCompressor {
      async synthesize(query: string, context: string) {
        return `Synthesized answer for ${query} using: ${context}`;
      }
    }

    const mockComp = new StagedMockCompressor();
    const orch = new Orchestrator(embedder, mockComp);

    try {
      const active = orch.subgraphRegistry.activeSubgraph;
      active.store.append(
        "RNA is responsible for protein synthesis in biological cells.",
      );
      await active.cache.cacheEntry(
        active.store.getAll()[0]!.id,
        active.store.getAll()[0]!.content,
      );

      const answer = await orch.stagedQuery(
        "Explain RNA cell protein synthesis",
      );
      expect(answer).toContain(
        "Synthesized answer for Explain RNA cell protein synthesis",
      );
      expect(answer).toContain("protein synthesis");
    } finally {
      await orch.shutdown();
    }
  });
});
