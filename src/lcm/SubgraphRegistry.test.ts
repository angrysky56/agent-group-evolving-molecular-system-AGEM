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

  // --------------------------------------------------------------------------
  // CONCEPT-VECTOR LAYER — "subgraph as a single embedding"
  //
  // The registry exposes:
  //   getConceptVector(id):       L2-normalized centroid of root-summary +
  //                               entry embeddings for the subgraph.
  //   conceptSimilarity(idA,idB): cosine between the two centroids.
  // These collapse the O(K^2) pairwise matching that buildSheafFromRegistry
  // used previously into O(1) per pair, and give downstream code a
  // semantically meaningful single handle per subgraph.
  // --------------------------------------------------------------------------

  it("ConceptVector: returns null for an empty subgraph (no entries, no summaries)", () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    expect(registry.getConceptVector("default")).toBeNull();
  });

  it("ConceptVector: returns null when entries exist but no embeddings are cached", () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    const sub = registry.create("noembed", "noembed-id");
    sub.store.append("text without cached embedding");
    // getConceptVector never invokes the embedder itself; it only averages
    // already-cached vectors. An entry without a cached embedding contributes
    // nothing and a fully-uncached subgraph yields null.
    expect(registry.getConceptVector("noembed-id")).toBeNull();
  });

  it("ConceptVector: produces an L2-normalized centroid from cached entry embeddings", async () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    const sub = registry.create("bio", "bio-id");

    const e1 = sub.store.append("RNA transcription");
    const e2 = sub.store.append("genetics and biology");
    await sub.cache.cacheEntry(e1.id, e1.content);
    await sub.cache.cacheEntry(e2.id, e2.content);

    const centroid = registry.getConceptVector("bio-id");
    expect(centroid).not.toBeNull();
    expect(centroid!.length).toBe(384);

    // L2 norm must be 1 (within float tolerance).
    let normSq = 0;
    for (let k = 0; k < centroid!.length; k++) normSq += centroid![k] ** 2;
    expect(Math.abs(Math.sqrt(normSq) - 1.0)).toBeLessThan(1e-9);

    // Deterministic embedder places biology vectors on axis 0, so the
    // centroid should be the unit vector on axis 0.
    expect(centroid![0]).toBeCloseTo(1.0, 9);
  });

  it("ConceptSimilarity: high for same-topic subgraphs, low for different topics", async () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    const subBioA = registry.create("bioA", "bio-a");
    const subBioB = registry.create("bioB", "bio-b");
    const subChem = registry.create("chem", "chem-id");

    const ea = subBioA.store.append("RNA transcription pathways");
    const eb = subBioB.store.append("genetics of biology");
    const ec = subChem.store.append("covalent chemical bonds");
    await subBioA.cache.cacheEntry(ea.id, ea.content);
    await subBioB.cache.cacheEntry(eb.id, eb.content);
    await subChem.cache.cacheEntry(ec.id, ec.content);

    const simBioBio = registry.conceptSimilarity("bio-a", "bio-b");
    const simBioChem = registry.conceptSimilarity("bio-a", "chem-id");

    expect(simBioBio).toBeGreaterThan(0.99); // both project to axis 0
    expect(simBioChem).toBeLessThan(0.01); // orthogonal in the test embedder
    expect(simBioBio).toBeGreaterThan(simBioChem);
  });

  it("ConceptSimilarity: returns -1 when either centroid is unavailable", async () => {
    const registry = new SubgraphRegistry(embedder, tokenCounter);
    registry.create("empty", "empty-id");
    const subBio = registry.create("bio", "bio-id");
    const e = subBio.store.append("RNA transcription");
    await subBio.cache.cacheEntry(e.id, e.content);

    expect(registry.conceptSimilarity("empty-id", "bio-id")).toBe(-1);
    expect(registry.conceptSimilarity("nonexistent", "bio-id")).toBe(-1);
  });

  // --------------------------------------------------------------------------
  // SHEAF: similarity-weighted restriction maps (replacing the [1.0]/[1.0]
  // identity that previously made cohomology equivalent to graph Betti).
  // --------------------------------------------------------------------------

  it("Sheaf: edges encode actual semantic similarity in the target restriction map", async () => {
    const orch = new Orchestrator(embedder, new MockCompressor());
    try {
      const reg = orch.subgraphRegistry;
      const subBioA = reg.create("bioA", "bio-a");
      const subBioB = reg.create("bioB", "bio-b");

      const ea = subBioA.store.append("RNA transcription pathways");
      const eb = subBioB.store.append("genetics of biology");
      await subBioA.cache.cacheEntry(ea.id, ea.content);
      await subBioB.cache.cacheEntry(eb.id, eb.content);

      const sheaf = await orch.buildSheafFromRegistry();
      const edgeIds = sheaf.getEdgeIds();
      // Only bio-a <-> bio-b crosses threshold; default and the others are
      // empty and produce -1 similarity.
      const bioEdge = edgeIds.find(
        (id) =>
          id.includes("bio-a") && id.includes("bio-b"),
      );
      expect(bioEdge).toBeDefined();

      const edge = sheaf.getEdge(bioEdge!);
      // Source map: identity [1.0].
      expect(Array.from(edge.sourceRestriction.entries)).toEqual([1.0]);
      // Target map carries the actual cosine similarity, NOT 1.0.
      const weight = edge.targetRestriction.entries[0]!;
      expect(weight).toBeGreaterThan(0.99); // same-axis test vectors
      expect(weight).toBeLessThanOrEqual(1.0);
    } finally {
      await orch.shutdown();
    }
  });

  it("Sheaf: H^0 grows with #disconnected semantic clusters (scalar sheaf semantics hold)", async () => {
    const orch = new Orchestrator(embedder, new MockCompressor());
    try {
      const reg = orch.subgraphRegistry;
      // Drop the default empty subgraph from the picture by populating it,
      // so every vertex has a well-defined concept vector.
      const subDef = reg.activeSubgraph;
      const ed = subDef.store.append("RNA transcription");
      await subDef.cache.cacheEntry(ed.id, ed.content);

      const subBio = reg.create("bio2", "bio-2");
      const subChem = reg.create("chem", "chem-id");
      const e1 = subBio.store.append("RNA polymerase II");
      const e2 = subChem.store.append("covalent chemical bonds and molecules");
      await subBio.cache.cacheEntry(e1.id, e1.content);
      await subChem.cache.cacheEntry(e2.id, e2.content);

      const sheaf = await orch.buildSheafFromRegistry();
      const coho = computeCohomology(sheaf);

      // Two semantic clusters: {default + bio-2} on axis 0, {chem-id} on axis 1.
      // The bio cluster has 2 vertices connected by a high-similarity edge.
      // The chem cluster is isolated (no edges into it).
      // Scalar sheaf cohomology: H^0 = #connected components in the
      // similarity-weighted graph.
      expect(coho.h0Dimension).toBeGreaterThanOrEqual(2);
      // No cycles among 3 vertices and at most 1 edge => H^1 = 0.
      expect(coho.h1Dimension).toBe(0);
    } finally {
      await orch.shutdown();
    }
  });
});
