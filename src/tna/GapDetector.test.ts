/**
 * GapDetector.test.ts
 *
 * TDD tests for structural gap detection with topological metrics.
 *
 * Test inventory (RED phase — all should fail until GapDetector.ts is implemented):
 *   T16:   Zero gaps in fully connected 6-node graph
 *   T16b:  Exactly one gap in two-clique bridge graph (ROADMAP SC3 first edge case)
 *   T17:   Gap metrics include inter-community density
 *   T17b:  Gap metrics include shortest path length
 *   T17c:  Gap metrics include modularity delta
 *   T18:   Bridge nodes identified in gap region
 *   T18b:  Three-cluster graph produces exactly two gaps
 *   T19:   findNearestGap returns lowest density gap
 *   T19b:  Gap detection is idempotent
 *
 * GREEN phase: implement GapDetector.ts to pass all tests.
 * REFACTOR: ensure clean separation, no side effects.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Preprocessor } from "./Preprocessor.js";
import { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import { LouvainDetector } from "./LouvainDetector.js";
import { CentralityAnalyzer } from "./CentralityAnalyzer.js";
import { GapDetector } from "./GapDetector.js";

// ---------------------------------------------------------------------------
// Test helper: buildTwoCliqueGraph()
// Creates a two-clique graph (same as LouvainDetector.test.ts).
// Run Louvain and CentralityAnalyzer to populate community and centrality metadata.
// ---------------------------------------------------------------------------

function buildTwoCliqueGraph(): {
  graph: CooccurrenceGraph;
  louvain: LouvainDetector;
  centrality: CentralityAnalyzer;
} {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const cliqueA = ["a1", "a2", "a3", "a4", "a5"];
  const cliqueB = ["b1", "b2", "b3", "b4", "b5"];

  graph.ingestTokens([...cliqueA, ...cliqueB], 0);
  const g = graph.getGraph();

  // Ensure full connectivity within clique A.
  for (let i = 0; i < cliqueA.length; i++) {
    for (let j = i + 1; j < cliqueA.length; j++) {
      const src = cliqueA[i]!;
      const dst = cliqueA[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 10, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, "weight", 10);
      }
    }
  }

  // Ensure full connectivity within clique B.
  for (let i = 0; i < cliqueB.length; i++) {
    for (let j = i + 1; j < cliqueB.length; j++) {
      const src = cliqueB[i]!;
      const dst = cliqueB[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 10, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, "weight", 10);
      }
    }
  }

  // Remove all inter-clique edges except a1--b1.
  g.forEachEdge((edge, _attrs, source, target) => {
    const srcInA = cliqueA.includes(source);
    const dstInA = cliqueA.includes(target);
    const srcInB = cliqueB.includes(source);
    const dstInB = cliqueB.includes(target);

    const isInterClique = (srcInA && dstInB) || (srcInB && dstInA);
    if (!isInterClique) return;

    const isBridge =
      (source === "a1" && target === "b1") ||
      (source === "b1" && target === "a1");
    if (!isBridge) {
      g.dropEdge(edge);
    } else {
      g.setEdgeAttribute(edge, "weight", 1);
    }
  });

  if (!g.hasEdge("a1", "b1")) {
    g.addEdge("a1", "b1", { weight: 1, createdAtIteration: 0 });
  }

  // Run Louvain and CentralityAnalyzer to populate metadata.
  const louvain = new LouvainDetector(graph);
  const louvainResult = louvain.detect(42);

  // Update graph metadata with community assignments using public API.
  for (const [nodeId, communityId] of louvainResult.assignments) {
    graph.updateNodeCommunity(nodeId, communityId);
  }

  const centrality = new CentralityAnalyzer(graph);
  centrality.compute();

  return { graph, louvain, centrality };
}

// ---------------------------------------------------------------------------
// Test helper: buildFullyConnectedGraph(n)
// Creates a complete graph on n nodes (all edges, no communities).
// ---------------------------------------------------------------------------

function buildFullyConnectedGraph(n: number): {
  graph: CooccurrenceGraph;
  louvain: LouvainDetector;
  centrality: CentralityAnalyzer;
} {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const nodes = Array.from({ length: n }, (_, i) => `node${i}`);
  graph.ingestTokens(nodes, 0);

  const g = graph.getGraph();

  // Ensure complete graph connectivity.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const src = nodes[i]!;
      const dst = nodes[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 5, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, "weight", 5);
      }
    }
  }

  const louvain = new LouvainDetector(graph);
  const louvainResult = louvain.detect(42);

  // Update graph metadata with community assignments using public API.
  for (const [nodeId, communityId] of louvainResult.assignments) {
    graph.updateNodeCommunity(nodeId, communityId);
  }

  const centrality = new CentralityAnalyzer(graph);
  centrality.compute();

  return { graph, louvain, centrality };
}

// ---------------------------------------------------------------------------
// Test helper: buildThreeClusterGraph()
// Creates three cliques: A-B connected by bridge, B-C connected by bridge,
// but A-C have NO connection (disconnected communities).
// ---------------------------------------------------------------------------

function buildThreeClusterGraph(): {
  graph: CooccurrenceGraph;
  louvain: LouvainDetector;
  centrality: CentralityAnalyzer;
} {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const cliqueA = ["a1", "a2", "a3"];
  const cliqueB = ["b1", "b2", "b3"];
  const cliqueC = ["c1", "c2", "c3"];

  graph.ingestTokens([...cliqueA, ...cliqueB, ...cliqueC], 0);
  const g = graph.getGraph();

  // Helper: make a clique fully connected
  const makeClique = (nodes: string[]) => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const src = nodes[i]!;
        const dst = nodes[j]!;
        if (!g.hasEdge(src, dst)) {
          g.addEdge(src, dst, { weight: 10, createdAtIteration: 0 });
        } else {
          const edge = g.edge(src, dst)!;
          g.setEdgeAttribute(edge, "weight", 10);
        }
      }
    }
  };

  makeClique(cliqueA);
  makeClique(cliqueB);
  makeClique(cliqueC);

  // Remove all inter-clique edges except a1--b1 and b1--c1.
  g.forEachEdge((edge, _attrs, source, target) => {
    const srcInA = cliqueA.includes(source);
    const srcInB = cliqueB.includes(source);
    const srcInC = cliqueC.includes(source);
    const dstInA = cliqueA.includes(target);
    const dstInB = cliqueB.includes(target);
    const dstInC = cliqueC.includes(target);

    const isInterClique =
      (srcInA && (dstInB || dstInC)) ||
      (srcInB && (dstInA || dstInC)) ||
      (srcInC && (dstInA || dstInB));
    if (!isInterClique) return;

    const isBridgeAB =
      (source === "a1" && target === "b1") ||
      (source === "b1" && target === "a1");
    const isBridgeBC =
      (source === "b1" && target === "c1") ||
      (source === "c1" && target === "b1");

    if (!isBridgeAB && !isBridgeBC) {
      g.dropEdge(edge);
    } else if (isBridgeAB || isBridgeBC) {
      g.setEdgeAttribute(edge, "weight", 1);
    }
  });

  // Ensure bridges exist.
  if (!g.hasEdge("a1", "b1")) {
    g.addEdge("a1", "b1", { weight: 1, createdAtIteration: 0 });
  }
  if (!g.hasEdge("b1", "c1")) {
    g.addEdge("b1", "c1", { weight: 1, createdAtIteration: 0 });
  }

  const louvain = new LouvainDetector(graph);
  const louvainResult = louvain.detect(42);

  for (const [nodeId, communityId] of louvainResult.assignments) {
    graph.updateNodeCommunity(nodeId, communityId);
  }

  const centrality = new CentralityAnalyzer(graph);
  centrality.compute();

  return { graph, louvain, centrality };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GapDetector", () => {
  let twoCliqueGraph: CooccurrenceGraph;
  let twoCliqueLouvain: LouvainDetector;
  let twoCliqueCentrality: CentralityAnalyzer;

  beforeEach(() => {
    const result = buildTwoCliqueGraph();
    twoCliqueGraph = result.graph;
    twoCliqueLouvain = result.louvain;
    twoCliqueCentrality = result.centrality;
  });

  // --------------------------------------------------------------------------
  // T16: Zero gaps in fully connected 6-node graph
  // ROADMAP success criterion 3 — first edge case
  // --------------------------------------------------------------------------

  it("T16: fully connected graph has zero gaps (no structural holes)", () => {
    const { graph, louvain, centrality } = buildFullyConnectedGraph(6);

    const detector = new GapDetector(graph, louvain, centrality);
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // T16b: Exactly one gap in two-clique bridge graph
  // ROADMAP success criterion 3 — second edge case
  // --------------------------------------------------------------------------

  it("T16b: two-clique bridge graph has exactly one gap", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // T17: Gap metrics include inter-community density
  // --------------------------------------------------------------------------

  it("T17: gap has inter-community density metric (low for two-clique, ~0.04)", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(1);
    const gap = gaps[0]!;

    expect(gap.interCommunityDensity).toBeDefined();
    // Two 5-node cliques with 1 bridge edge: density = 1 / (5 * 5) = 0.04
    expect(gap.interCommunityDensity).toBeCloseTo(0.04, 2);
  });

  // --------------------------------------------------------------------------
  // T17b: Gap metrics include shortest path length
  // --------------------------------------------------------------------------

  it("T17b: gap has shortest path length metric (>1 for two-clique)", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(1);
    const gap = gaps[0]!;

    expect(gap.shortestPathLength).toBeDefined();
    // For a two-clique graph with a single bridge, shortest path between
    // cliques is > 1 (must cross the bridge).
    expect(gap.shortestPathLength).toBeGreaterThan(1);
  });

  // --------------------------------------------------------------------------
  // T17c: Gap metrics include modularity delta
  // --------------------------------------------------------------------------

  it("T17c: gap has modularity delta metric (positive for bridge gap)", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(1);
    const gap = gaps[0]!;

    expect(gap.modularityDelta).toBeDefined();
    // Merging the two cliques would reduce modularity (gap is real).
    expect(gap.modularityDelta).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // T18: Bridge nodes identified in gap region
  // --------------------------------------------------------------------------

  it("T18: gap includes bridge nodes with high centrality", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    expect(gaps).toHaveLength(1);
    const gap = gaps[0]!;

    expect(gap.bridgeNodes).toBeDefined();
    expect(gap.bridgeNodes.length).toBeGreaterThan(0);

    // For the two-clique bridge, a1 and b1 should be the bridge nodes
    // (they are the endpoints of the only inter-clique edge).
    const bridgeNodeIds = gap.bridgeNodes.map((id) => id.toString());
    expect(bridgeNodeIds).toContain("a1");
    expect(bridgeNodeIds).toContain("b1");
  });

  // --------------------------------------------------------------------------
  // T18b: Three-cluster graph produces exactly two gaps
  // --------------------------------------------------------------------------

  it("T18b: three-cluster graph (A-B-C chain) produces exactly two gaps", () => {
    const { graph, louvain, centrality } = buildThreeClusterGraph();

    const detector = new GapDetector(graph, louvain, centrality);
    const gaps = detector.findGaps();

    // Should find gaps between A-B and B-C, but not A-C (disconnected, not a gap).
    expect(gaps).toHaveLength(2);
  });

  // --------------------------------------------------------------------------
  // T19: findNearestGap returns the gap with lowest inter-community density
  // --------------------------------------------------------------------------

  it("T19: findNearestGap returns the gap with lowest density", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );
    const gaps = detector.findGaps();

    const nearest = detector.findNearestGap();

    expect(nearest).toBeDefined();
    expect(nearest).toEqual(gaps[0]);

    // For two-clique, there's only one gap, so nearest should be it.
    expect(nearest?.interCommunityDensity).toBeCloseTo(0.04, 2);
  });

  // --------------------------------------------------------------------------
  // T19b: Gap detection is idempotent
  // --------------------------------------------------------------------------

  it("T19b: running findGaps twice returns the same result", () => {
    const detector = new GapDetector(
      twoCliqueGraph,
      twoCliqueLouvain,
      twoCliqueCentrality,
    );

    const gaps1 = detector.findGaps();
    const gaps2 = detector.findGaps();

    expect(gaps1).toHaveLength(gaps2.length);
    for (let i = 0; i < gaps1.length; i++) {
      const gap1 = gaps1[i]!;
      const gap2 = gaps2[i]!;
      expect(gap1.communityA).toBe(gap2.communityA);
      expect(gap1.communityB).toBe(gap2.communityB);
      expect(gap1.interCommunityDensity).toBeCloseTo(
        gap2.interCommunityDensity,
        6,
      );
    }
  });
});
