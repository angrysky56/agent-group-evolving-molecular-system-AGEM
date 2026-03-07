/**
 * CooccurrenceGraph.test.ts
 *
 * TDD tests for the TNA CooccurrenceGraph (4-gram sliding window weighted graph).
 *
 * Test inventory:
 *   T5:  4-gram window creates correct edges with correct weights
 *   T5b: Repeated co-occurrences accumulate weight
 *   T6:  Lemmatization enforced before insertion — surface forms become lemmas
 *   T6b: Node count grows with unique concepts, NOT total word count (PRIMARY pitfall guard)
 *   T7:  Graph uses graphology — order and size accessible
 *   T7b: Edge weights are positive numbers
 *   T8:  Iteration tracking on edges (createdAtIteration)
 *   T8b: getNode() returns TextNode with surfaceForms populated
 *
 * RED phase: all tests fail until CooccurrenceGraph.ts is implemented.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Preprocessor } from "./Preprocessor.js";
import { CooccurrenceGraph } from "./CooccurrenceGraph.js";

describe("CooccurrenceGraph", () => {
  // Use a preprocessor with 0.0 TF-IDF threshold so all content words pass through.
  let preprocessor: Preprocessor;

  beforeEach(() => {
    preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  });

  // --------------------------------------------------------------------------
  // T5: 4-gram window creates correct edges
  // --------------------------------------------------------------------------

  it("T5: 4-gram window creates edges with correct weights for tokens [a,b,c,d,e]", () => {
    // For window=4, each token pair at distance d gets weight = (4 - d).
    // Tokens: a(0), b(1), c(2), d(3), e(4)
    // From a: b(dist=1,w=3), c(dist=2,w=2), d(dist=3,w=1) — e is out of window
    // From b: c(dist=1,w=3), d(dist=2,w=2), e(dist=3,w=1)
    // From c: d(dist=1,w=3), e(dist=2,w=2)
    // From d: e(dist=1,w=3)
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // Bypass preprocessing by using ingestTokens() for exact control,
    // or use texts that produce known single-token outputs.
    // We pass pre-lemmatized tokens directly to test the window logic.
    graph.ingestTokens(["alpha", "beta", "gamma", "delta", "epsilon"], 0);

    expect(graph.getEdgeWeight("alpha", "beta")).toBe(3); // dist=1
    expect(graph.getEdgeWeight("alpha", "gamma")).toBe(2); // dist=2
    expect(graph.getEdgeWeight("alpha", "delta")).toBe(1); // dist=3
    expect(graph.getEdgeWeight("beta", "gamma")).toBe(3); // dist=1
    expect(graph.getEdgeWeight("beta", "delta")).toBe(2); // dist=2
    expect(graph.getEdgeWeight("beta", "epsilon")).toBe(1); // dist=3
    expect(graph.getEdgeWeight("gamma", "delta")).toBe(3); // dist=1
    expect(graph.getEdgeWeight("gamma", "epsilon")).toBe(2); // dist=2
    expect(graph.getEdgeWeight("delta", "epsilon")).toBe(3); // dist=1

    // No edge between alpha and epsilon (distance 4, outside 4-gram window).
    expect(graph.getEdgeWeight("alpha", "epsilon")).toBe(0);
  });

  // --------------------------------------------------------------------------
  // T5b: Repeated co-occurrences accumulate weight
  // --------------------------------------------------------------------------

  it("T5b: repeated co-occurrences accumulate edge weight", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // "cat" and "dog" appear adjacent in two different calls.
    // First call: cat-dog at distance 1 → weight 3
    graph.ingestTokens(["cat", "dog", "sleep"], 0);
    // Second call: cat-dog at distance 1 again → weight += 3
    graph.ingestTokens(["cat", "dog", "play"], 1);

    // Total weight should be accumulated: 3 + 3 = 6.
    const weight = graph.getEdgeWeight("cat", "dog");
    expect(weight).toBeGreaterThan(3); // More than a single occurrence.
    expect(weight).toBe(6); // Exactly doubled from two adjacency-1 co-occurrences.
  });

  // --------------------------------------------------------------------------
  // T6: Lemmatization enforced before insertion
  // --------------------------------------------------------------------------

  it("T6: lemmatization enforced — surface forms become lemma nodes", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // Input contains morphological variants that should be lemmatized.
    // "cats" → "cat", "running" → "run", "dogs" → "dog"
    graph.ingest("The cats are running and the dogs ran quickly", 0);

    // Nodes should exist for LEMMAS, not surface forms.
    expect(graph.getNode("cat")).toBeDefined();
    expect(graph.getNode("run")).toBeDefined();
    expect(graph.getNode("dog")).toBeDefined();

    // Surface forms should NOT be nodes.
    expect(graph.getNode("cats")).toBeUndefined();
    expect(graph.getNode("running")).toBeUndefined();
    expect(graph.getNode("ran")).toBeUndefined();
    expect(graph.getNode("dogs")).toBeUndefined();
  });

  it("T6: node count equals number of unique lemmas, not surface forms", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // All 4 surface forms of "run" should produce exactly 1 node.
    // Plus: "quick" from "quickly" → 1 more node.
    graph.ingest("running runs ran run quickly", 0);

    // There should be exactly 2 unique lemmas: "run" and whatever "quickly" → "quick"
    // (after stopword removal and lemmatization).
    // The exact count depends on lemmatization but should be < 5 (less than 4 surface forms + 1).
    expect(graph.order).toBeLessThan(5);
    // "run" must be one of the nodes.
    expect(graph.getNode("run")).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // T6b: Node count proportional to unique concepts (PRIMARY pitfall guard)
  // --------------------------------------------------------------------------

  it("T6b: node count proportional to unique concepts, NOT total word count", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // Insert raw text containing 4 morphological variants of "analyze" repeated many times.
    // This tests the FULL pipeline: raw text → lemmatization → graph insertion.
    //
    // Without lemmatization: 4 distinct nodes (analyze, analyzing, analyzed, analysis).
    // With lemmatization:
    //   - "analyzing" → "analyze", "analyzed" → "analyze" (verb forms)
    //   - "analyze" → "analyze" (no change)
    //   - "analysis" → "analysis" (noun; wink-lemmatizer keeps this distinct)
    //   Result: ≤2 distinct lemma nodes (analyze and/or analysis).
    //
    // This is the PRIMARY pitfall guard from STATE.md: verifies that node count
    // grows proportional to unique CONCEPTS, not total word count.
    const sentence = Array.from(
      { length: 20 },
      () => "analyze analyzing analyzed analysis",
    ).join(" ");

    graph.ingest(sentence, 0);

    // Key assertions:
    // 1. At most 2 distinct lemma nodes (analyze + analysis at most).
    //    WITHOUT lemmatization we'd see 4 distinct surface form nodes.
    const nodeCount = graph.order;
    expect(nodeCount).toBeLessThanOrEqual(2);

    // 2. The total tokens in text was 80 (20 * 4 variants). Node count must not equal 80.
    expect(nodeCount).not.toBe(80);

    // 3. Not 4 — the number of distinct surface forms without lemmatization.
    expect(nodeCount).not.toBe(4);
  });

  // --------------------------------------------------------------------------
  // T7: Graphology graph properties
  // --------------------------------------------------------------------------

  it("T7: graph uses graphology — order and size accessible", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    graph.ingestTokens(["alpha", "beta", "gamma", "delta"], 0);

    // order = node count, size = edge count
    expect(graph.order).toBe(4);
    // With window=4 and 4 tokens: [a,b,c,d]
    // Edges: (a,b)=3, (a,c)=2, (a,d)=1, (b,c)=3, (b,d)=2, (c,d)=3 → 6 edges
    expect(graph.size).toBe(6);

    // Verify getGraph() returns the underlying graphology instance.
    const g = graph.getGraph();
    expect(g.order).toBe(4);
    expect(g.size).toBe(6);
  });

  it("T7b: all edge weights are positive numbers", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    graph.ingestTokens(["one", "two", "three", "four", "five"], 0);

    const g = graph.getGraph();
    g.forEachEdge((_edge: unknown, attrs: Record<string, unknown>) => {
      expect(attrs["weight"]).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // T8: Iteration tracking
  // --------------------------------------------------------------------------

  it("T8: createdAtIteration attribute is set on edges at ingest time", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // Ingest two sets of tokens at different iterations.
    graph.ingestTokens(["apple", "banana", "cherry"], 3);
    graph.ingestTokens(["dragon", "elderberry", "fig"], 7);

    const g = graph.getGraph();

    // Edges from iteration 3: apple-banana, apple-cherry, banana-cherry
    // Edges from iteration 7: dragon-elderberry, dragon-fig, elderberry-fig
    let foundIter3 = false;
    let foundIter7 = false;

    g.forEachEdge(
      (
        _edge: unknown,
        attrs: Record<string, unknown>,
        source: string,
        target: string,
      ) => {
        const iter = attrs["createdAtIteration"] as number;
        if (
          ["apple", "banana", "cherry"].includes(source) &&
          ["apple", "banana", "cherry"].includes(target)
        ) {
          expect(iter).toBe(3);
          foundIter3 = true;
        }
        if (
          ["dragon", "elderberry", "fig"].includes(source) &&
          ["dragon", "elderberry", "fig"].includes(target)
        ) {
          expect(iter).toBe(7);
          foundIter7 = true;
        }
      },
    );

    expect(foundIter3).toBe(true);
    expect(foundIter7).toBe(true);
  });

  // --------------------------------------------------------------------------
  // T8b: getNode() returns TextNode with surfaceForms
  // --------------------------------------------------------------------------

  it("T8b: getNode() returns TextNode with surfaceForms tracking all surface variants", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    // Ingest text with multiple surface forms of "run".
    graph.ingest("running quickly and runs often", 0);

    const runNode = graph.getNode("run");
    expect(runNode).toBeDefined();

    if (runNode) {
      // surfaceForms should include the original surface tokens that lemmatized to "run".
      // "running" → "run" and "runs" → "run" both should appear in surfaceForms.
      expect(runNode.surfaceForms).toContain("running");
      expect(runNode.surfaceForms).toContain("runs");

      // The node's lemma should be "run".
      expect(runNode.lemma).toBe("run");
      expect(runNode.id).toBe("run");
    }
  });

  // --------------------------------------------------------------------------
  // Additional: getNodes() returns all nodes
  // --------------------------------------------------------------------------

  it("getNodes() returns all TextNodes", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    graph.ingestTokens(["alpha", "beta", "gamma"], 0);

    const nodes = graph.getNodes();
    expect(nodes.length).toBe(3);

    const lemmas = nodes.map((n) => n.lemma);
    expect(lemmas).toContain("alpha");
    expect(lemmas).toContain("beta");
    expect(lemmas).toContain("gamma");
  });

  it("ingest() with only stopwords produces empty graph", () => {
    const graph = new CooccurrenceGraph(preprocessor, { windowSize: 4 });

    graph.ingest("the and is are of in on at by for", 0);

    // No content words → empty graph.
    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
  });
});
