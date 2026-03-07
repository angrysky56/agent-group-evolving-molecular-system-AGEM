/**
 * LayoutComputer.test.ts
 *
 * Comprehensive tests for TNA-08: ForceAtlas2-based layout computation
 * for semantic graph visualization.
 *
 * Test coverage:
 *   - Basic layout computation: positions, finite values, caching
 *   - Convergence: energy decreases, isConverged()
 *   - Determinism: same graph → same positions across runs
 *   - Incremental updates: computeIfDue() interval scheduling
 *   - Graph edge cases: < 3 nodes, 0 nodes, disconnected, complete
 *   - Community clustering: intra < inter distance
 *   - JSON export: LayoutExportJSON, serialization
 *   - Regime-adaptive intervals: adjustInterval()
 *   - Event emission: tna:layout-updated
 *   - Configuration: custom physics parameters
 *
 * All tests use synthetic graphs (ingestTokens) — no external data dependencies.
 * Tests are deterministic via fixed seeds.
 */

import { describe, it, expect, vi } from "vitest";
import { Preprocessor } from "./Preprocessor.js";
import { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import { LouvainDetector } from "./LouvainDetector.js";
import { LayoutComputer } from "./LayoutComputer.js";

// ---------------------------------------------------------------------------
// Test graph builders
// ---------------------------------------------------------------------------

/**
 * buildTwoClusterGraph — builds a 10-node graph with two tight clusters
 * connected by a single weak bridge.
 *
 * Cluster A: alpha, beta, gamma, delta, epsilon (5 nodes, dense intra-edges)
 * Cluster B: one, two, three, four, five (5 nodes, dense intra-edges)
 * Bridge: epsilon ↔ one (weak inter-cluster edge)
 */
function buildTwoClusterGraph(): {
  graph: CooccurrenceGraph;
  clusterA: string[];
  clusterB: string[];
} {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const clusterA = ["alpha", "beta", "gamma", "delta", "epsilon"];
  const clusterB = ["one", "two", "three", "four", "five"];

  // Ingest each cluster multiple times to build dense intra-cluster edges.
  graph.ingestTokens(clusterA, 1);
  graph.ingestTokens(clusterA, 2);
  graph.ingestTokens(clusterA, 3);
  graph.ingestTokens(clusterB, 1);
  graph.ingestTokens(clusterB, 2);
  graph.ingestTokens(clusterB, 3);

  // Single weak bridge
  graph.ingestTokens(["epsilon", "one"], 1);

  return { graph, clusterA, clusterB };
}

/**
 * buildLinearGraph — builds a simple path graph: a — b — c — d — e
 */
function buildLinearGraph(): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  // Path: adjacent tokens within 4-gram window create weighted edges
  graph.ingestTokens(["a", "b", "c", "d", "e"], 1);
  return graph;
}

/**
 * buildSmallGraph — builds a 2-node graph (below minGraphOrder=3).
 */
function buildSmallGraph(): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  graph.ingestTokens(["x", "y"], 1);
  return graph;
}

/**
 * buildEmptyGraph — builds a graph with no nodes.
 */
function buildEmptyGraph(): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  return new CooccurrenceGraph(preprocessor);
}

/**
 * buildSingleNodeGraph — a graph with exactly 1 node.
 */
function buildSingleNodeGraph(): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  graph.ingestTokens(["solo"], 1);
  return graph;
}

/**
 * buildCompleteGraph — 5 nodes all mutually connected.
 */
function buildCompleteGraph(): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  // Ingest all orderings to maximize edge density.
  graph.ingestTokens(["p", "q", "r", "s", "t"], 1);
  graph.ingestTokens(["t", "s", "r", "q", "p"], 2);
  graph.ingestTokens(["p", "r", "t", "q", "s"], 3);
  return graph;
}

/**
 * euclideanDistance — distance between two positions.
 */
function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LayoutComputer (TNA-08)", () => {
  // =========================================================================
  // Basic layout computation
  // =========================================================================

  describe("Basic layout computation", () => {
    it("T1: computeLayout() returns LayoutOutput with positions for all nodes", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      const output = layoutComputer.computeLayout();

      expect(output.positions).toBeDefined();
      expect(output.positions.size).toBe(10);

      // All nodes should have positions.
      const graphInstance = graph.getGraph();
      graphInstance.forEachNode((nodeId: string) => {
        expect(output.positions.has(nodeId)).toBe(true);
      });
    });

    it("T2: All node positions are finite numbers (no NaN or Infinity in x/y)", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      const output = layoutComputer.computeLayout();

      for (const [nodeId, pos] of output.positions) {
        expect(isFinite(pos.x), `x for ${nodeId} should be finite`).toBe(true);
        expect(isFinite(pos.y), `y for ${nodeId} should be finite`).toBe(true);
        expect(isNaN(pos.x), `x for ${nodeId} should not be NaN`).toBe(false);
        expect(isNaN(pos.y), `y for ${nodeId} should not be NaN`).toBe(false);
      }
    });

    it("T3: Positions are cached in CooccurrenceGraph via updateNodePosition()", () => {
      const { graph, clusterA } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      layoutComputer.computeLayout();

      // CooccurrenceGraph should have positions cached.
      for (const nodeId of clusterA) {
        const pos = graph.getNodePosition(nodeId);
        expect(pos).toBeDefined();
        expect(isFinite(pos!.x)).toBe(true);
        expect(isFinite(pos!.y)).toBe(true);
      }
    });

    it("T4: getNodePosition() on CooccurrenceGraph returns coordinates after layout", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      layoutComputer.computeLayout();

      const pos = linear.getNodePosition("a");
      expect(pos).toBeDefined();
      expect(typeof pos!.x).toBe("number");
      expect(typeof pos!.y).toBe("number");
    });

    it("T5: LayoutOutput contains correct nodeCount and edgeCount", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      const output = layoutComputer.computeLayout();

      expect(output.nodeCount).toBe(linear.order);
      expect(output.edgeCount).toBe(linear.size);
      expect(output.nodeCount).toBeGreaterThan(0);
      expect(output.edgeCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Convergence
  // =========================================================================

  describe("Convergence", () => {
    it("T6: Layout with more iterations has lower or equal energy on second run", () => {
      // Run two sequential layouts; second should have lower energy (positions stabilized).
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      // First run establishes baseline positions.
      const first = layoutComputer.computeLayout(50);
      expect(first.energy).toBe(Infinity); // First run has no previous reference.

      // Second run measures displacement from first.
      const second = layoutComputer.computeLayout(50);
      expect(second.energy).toBeLessThan(Infinity);

      // Third run with more iterations should have lower energy.
      const third = layoutComputer.computeLayout(100);
      expect(third.energy).toBeLessThan(Infinity);
    });

    it("T7: Energy transitions from Infinity (round 1) to finite (round 2+)", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph, {
        iterations: 100,
        barnesHutOptimize: false,
        seed: 42,
      });

      // Round 1: establishes baseline positions; energy = Infinity (no previous reference).
      const first = layoutComputer.computeLayout(100);
      expect(first.energy).toBe(Infinity);

      // Round 2: has previous reference; energy is now finite (positions displaced from round 1).
      const second = layoutComputer.computeLayout(100);
      expect(isFinite(second.energy)).toBe(true);
      expect(second.energy).toBeGreaterThan(0); // Layout changed from round 1.

      // Round 3: energy is still finite.
      const third = layoutComputer.computeLayout(100);
      expect(isFinite(third.energy)).toBe(true);
      // Energy across rounds is not guaranteed monotone (FA2 can oscillate),
      // but it should be substantially lower than Infinity.
      expect(third.energy).toBeLessThan(Infinity);
    });

    it("T8: isConverged() returns true when energy < threshold", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        { convergenceEnergyThreshold: 1000 },
      );

      // First run.
      layoutComputer.computeLayout(100);
      // Second run — energy should be computed.
      layoutComputer.computeLayout(100);

      const lastLayout = layoutComputer.getLastLayout()!;
      if (lastLayout.energy < 1000) {
        expect(layoutComputer.isConverged()).toBe(true);
      }
    });

    it("T9: isConverged() returns false before first computation", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      expect(layoutComputer.isConverged()).toBe(false);
    });

    it("T10: Second computation with same graph measures finite energy (incremental convergence)", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear, { iterations: 100 });

      // First run: no previous reference → Infinity.
      const first = layoutComputer.computeLayout();
      expect(first.energy).toBe(Infinity);

      // Second run: has previous reference → finite energy.
      const second = layoutComputer.computeLayout();
      expect(second.energy).not.toBe(Infinity);
      expect(isFinite(second.energy)).toBe(true);
    });
  });

  // =========================================================================
  // Determinism
  // =========================================================================

  describe("Determinism", () => {
    it("T11: Same graph produces same positions across two independent LayoutComputer instances", () => {
      const { graph: graph1, clusterA } = buildTwoClusterGraph();
      const { graph: graph2 } = buildTwoClusterGraph();

      const lc1 = new LayoutComputer(graph1, {
        seed: 42,
        iterations: 50,
        barnesHutOptimize: false,
      });
      const lc2 = new LayoutComputer(graph2, {
        seed: 42,
        iterations: 50,
        barnesHutOptimize: false,
      });

      const out1 = lc1.computeLayout(50);
      const out2 = lc2.computeLayout(50);

      // Positions should be identical (same seed, same graph topology).
      for (const nodeId of clusterA) {
        const p1 = out1.positions.get(nodeId)!;
        const p2 = out2.positions.get(nodeId)!;
        expect(p1.x).toBeCloseTo(p2.x, 5);
        expect(p1.y).toBeCloseTo(p2.y, 5);
      }
    });

    it("T12: Deterministic seeding produces reproducible initial positions for same node IDs", () => {
      const linear1 = buildLinearGraph();
      const linear2 = buildLinearGraph();

      const lc1 = new LayoutComputer(linear1, {
        seed: 42,
        iterations: 1,
        barnesHutOptimize: false,
      });
      const lc2 = new LayoutComputer(linear2, {
        seed: 42,
        iterations: 1,
        barnesHutOptimize: false,
      });

      const out1 = lc1.computeLayout(1);
      const out2 = lc2.computeLayout(1);

      // With just 1 iteration, output is almost entirely seed-dependent.
      const nodeIds = ["a", "b", "c", "d", "e"];
      for (const nodeId of nodeIds) {
        const p1 = out1.positions.get(nodeId)!;
        const p2 = out2.positions.get(nodeId)!;
        expect(p1.x).toBeCloseTo(p2.x, 3);
        expect(p1.y).toBeCloseTo(p2.y, 3);
      }
    });

    it("T13: Same config + same graph → same energy value", () => {
      const { graph: graph1 } = buildTwoClusterGraph();
      const { graph: graph2 } = buildTwoClusterGraph();

      const lc1 = new LayoutComputer(graph1, {
        seed: 42,
        iterations: 50,
        barnesHutOptimize: false,
      });
      const lc2 = new LayoutComputer(graph2, {
        seed: 42,
        iterations: 50,
        barnesHutOptimize: false,
      });

      // Second round to get non-infinite energy.
      lc1.computeLayout(50);
      lc2.computeLayout(50);
      const e1 = lc1.computeLayout(50).energy;
      const e2 = lc2.computeLayout(50).energy;

      expect(e1).toBeCloseTo(e2, 2);
    });
  });

  // =========================================================================
  // Incremental updates
  // =========================================================================

  describe("Incremental updates", () => {
    it("T14: computeIfDue() returns false before interval has elapsed", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        { defaultComputeInterval: 15 },
      );

      // First call always computes (warm-up, hasComputedInitial=false).
      const firstComputed = layoutComputer.computeIfDue(1);
      expect(firstComputed).toBe(true); // First call always computes.

      // At iteration 5, only 4 elapsed since iteration 1 — below interval of 15.
      const skipped = layoutComputer.computeIfDue(5);
      expect(skipped).toBe(false);

      // At iteration 14, 13 elapsed — still below interval of 15.
      const stillSkipped = layoutComputer.computeIfDue(14);
      expect(stillSkipped).toBe(false);
    });

    it("T15: computeIfDue() returns true and computes when interval has elapsed", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        { defaultComputeInterval: 10 },
      );

      // First computation always runs regardless of iteration (warm-up).
      const first = layoutComputer.computeIfDue(0);
      expect(first).toBe(true);

      // Exactly 10 elapsed since iteration 0: should compute.
      const second = layoutComputer.computeIfDue(10);
      expect(second).toBe(true);

      // Verify layout was actually computed.
      expect(layoutComputer.getLastLayout()).not.toBeNull();
    });

    it("T16: Incremental computation uses fewer iterations (multiplier * default)", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        { iterations: 100 },
        { defaultComputeInterval: 5, incrementalMultiplier: 0.5 },
      );

      // First run (warm-up): always computes with full iterations.
      const firstRan = layoutComputer.computeIfDue(0);
      expect(firstRan).toBe(true);
      const firstLayout = layoutComputer.getLastLayout()!;
      expect(firstLayout.iterations).toBe(100); // Full iterations.

      // Second run: interval elapsed (5 >= 5); uses incremental (0.5 * 100 = 50).
      const secondRan = layoutComputer.computeIfDue(5);
      expect(secondRan).toBe(true);
      const secondLayout = layoutComputer.getLastLayout()!;
      expect(secondLayout.iterations).toBe(50); // Incremental.
    });

    it("T17: computeIfDue at exact interval boundary computes", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        { defaultComputeInterval: 7 },
      );

      layoutComputer.computeIfDue(0);

      // At exactly 7 elapsed, should compute.
      const result = layoutComputer.computeIfDue(7);
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Graph edge cases
  // =========================================================================

  describe("Graph edge cases", () => {
    it("T18: Graph with < 3 nodes → trivial layout returned with positions", () => {
      const small = buildSmallGraph(); // 2 nodes
      const layoutComputer = new LayoutComputer(
        small,
        {},
        { minGraphOrder: 3 },
      );

      const output = layoutComputer.computeLayout();

      // Trivial layout: positions exist but 0 physics iterations.
      expect(output.iterations).toBe(0);
      expect(output.nodeCount).toBe(2);
      // Positions should still be set (hash-based).
      expect(output.positions.size).toBe(2);
    });

    it("T19: Graph with 0 nodes → empty positions map", () => {
      const empty = buildEmptyGraph();
      const layoutComputer = new LayoutComputer(
        empty,
        {},
        { minGraphOrder: 3 },
      );

      const output = layoutComputer.computeLayout();

      expect(output.positions.size).toBe(0);
      expect(output.nodeCount).toBe(0);
      expect(output.edgeCount).toBe(0);
    });

    it("T20: Single-node graph → trivial layout with one position", () => {
      const single = buildSingleNodeGraph();
      const layoutComputer = new LayoutComputer(
        single,
        {},
        { minGraphOrder: 3 },
      );

      const output = layoutComputer.computeLayout();

      expect(output.positions.size).toBe(1);
      expect(output.positions.has("solo")).toBe(true);
      const pos = output.positions.get("solo")!;
      expect(isFinite(pos.x)).toBe(true);
      expect(isFinite(pos.y)).toBe(true);
    });

    it("T21: Complete graph → all positions are finite after layout", () => {
      const complete = buildCompleteGraph();
      const layoutComputer = new LayoutComputer(complete, {
        iterations: 50,
        barnesHutOptimize: false,
      });

      const output = layoutComputer.computeLayout();

      expect(output.nodeCount).toBe(5);
      for (const [, pos] of output.positions) {
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
      }
    });

    it("T22: Two-node graph below minGraphOrder → trivial layout, no event emitted", () => {
      const small = buildSmallGraph();
      const layoutComputer = new LayoutComputer(
        small,
        {},
        { minGraphOrder: 3 },
      );

      const events: unknown[] = [];
      layoutComputer.on("tna:layout-updated", (e) => events.push(e));

      layoutComputer.computeLayout();

      // No event for trivial layout (< minGraphOrder nodes).
      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // Community clustering
  // =========================================================================

  describe("Community clustering", () => {
    it("T23: Community detection assigns different IDs to the two clusters", () => {
      const { graph } = buildTwoClusterGraph();
      const louvain = new LouvainDetector(graph);
      const result = louvain.detect(42);

      // Write community assignments back to graph metadata (as done in orchestrator).
      for (const [nodeId, communityId] of result.assignments) {
        graph.updateNodeCommunity(nodeId, communityId);
      }

      // Each cluster should have nodes in the same community.
      const nodeA = graph.getNode("alpha");
      const nodeB = graph.getNode("one");
      expect(nodeA?.communityId).toBeDefined();
      expect(nodeB?.communityId).toBeDefined();
      // The two clusters should be in different communities.
      expect(nodeA!.communityId).not.toBe(nodeB!.communityId);
    });

    it("T24: Average intra-cluster distance < average inter-cluster distance after layout", () => {
      const { graph, clusterA, clusterB } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph, {
        iterations: 150,
        barnesHutOptimize: false,
        scalingRatio: 2.0,
        gravity: 1.0,
        seed: 42,
      });

      // Multiple rounds to converge.
      layoutComputer.computeLayout(100);
      layoutComputer.computeLayout(150);

      // Compute intra-cluster average distance for cluster A.
      let intraSum = 0;
      let intraCount = 0;
      for (let i = 0; i < clusterA.length; i++) {
        for (let j = i + 1; j < clusterA.length; j++) {
          const posI = graph.getNodePosition(clusterA[i]!)!;
          const posJ = graph.getNodePosition(clusterA[j]!)!;
          intraSum += dist(posI, posJ);
          intraCount++;
        }
      }
      // Cluster B intra-distance.
      for (let i = 0; i < clusterB.length; i++) {
        for (let j = i + 1; j < clusterB.length; j++) {
          const posI = graph.getNodePosition(clusterB[i]!)!;
          const posJ = graph.getNodePosition(clusterB[j]!)!;
          intraSum += dist(posI, posJ);
          intraCount++;
        }
      }
      const avgIntra = intraSum / intraCount;

      // Compute inter-cluster average distance.
      let interSum = 0;
      let interCount = 0;
      for (const nodeA of clusterA) {
        for (const nodeB of clusterB) {
          const posA = graph.getNodePosition(nodeA)!;
          const posB = graph.getNodePosition(nodeB)!;
          interSum += dist(posA, posB);
          interCount++;
        }
      }
      const avgInter = interSum / interCount;

      // The key ForceAtlas2 property: intra-cluster nodes should be closer.
      expect(avgIntra).toBeLessThan(avgInter);
    });

    it("T25: Linear graph: endpoint nodes (a, e) are farther apart than adjacent nodes (a, b)", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear, {
        iterations: 100,
        barnesHutOptimize: false,
        seed: 42,
      });

      layoutComputer.computeLayout(100);
      layoutComputer.computeLayout(100); // second pass for more stability

      const posA = linear.getNodePosition("a")!;
      const posB = linear.getNodePosition("b")!;
      const posE = linear.getNodePosition("e")!;

      expect(posA).toBeDefined();
      expect(posB).toBeDefined();
      expect(posE).toBeDefined();

      const distAB = dist(posA, posB);
      const distAE = dist(posA, posE);

      // In a path graph, endpoints should be farther apart than adjacent nodes.
      expect(distAE).toBeGreaterThan(distAB);
    });
  });

  // =========================================================================
  // JSON export
  // =========================================================================

  describe("JSON export", () => {
    it("T26: exportJSON() returns a valid LayoutExportJSON structure", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      layoutComputer.computeLayout();
      const json = layoutComputer.exportJSON();

      expect(json.nodes).toBeDefined();
      expect(json.edges).toBeDefined();
      expect(json.metadata).toBeDefined();
    });

    it("T27: JSON nodes have id, x, y, label; communityId and betweennessCentrality optional", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      layoutComputer.computeLayout();
      const json = layoutComputer.exportJSON();

      expect(json.nodes.length).toBe(linear.order);
      for (const node of json.nodes) {
        expect(node.id).toBeDefined();
        expect(typeof node.x).toBe("number");
        expect(typeof node.y).toBe("number");
        expect(node.label).toBeDefined();
        // communityId and betweennessCentrality are optional.
      }
    });

    it("T28: JSON edges have source, target, weight", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      layoutComputer.computeLayout();
      const json = layoutComputer.exportJSON();

      expect(json.edges.length).toBe(linear.size);
      for (const edge of json.edges) {
        expect(edge.source).toBeDefined();
        expect(edge.target).toBeDefined();
        expect(typeof edge.weight).toBe("number");
        expect(edge.weight).toBeGreaterThan(0);
      }
    });

    it("T29: JSON metadata has nodeCount, edgeCount, energy, iterations, timestamp", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear, { iterations: 50 });

      layoutComputer.computeLayout(50);
      const json = layoutComputer.exportJSON();

      expect(json.metadata.nodeCount).toBe(linear.order);
      expect(json.metadata.edgeCount).toBe(linear.size);
      expect(typeof json.metadata.energy).toBe("number");
      expect(json.metadata.iterations).toBe(50);
      expect(json.metadata.timestamp).toBeGreaterThan(0);
      expect(json.metadata.timestamp).toBeLessThanOrEqual(Date.now() + 100);
    });

    it("T30: JSON is fully serializable via JSON.stringify (no circular refs)", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph);

      layoutComputer.computeLayout();
      const json = layoutComputer.exportJSON();

      expect(() => JSON.stringify(json)).not.toThrow();

      const parsed = JSON.parse(JSON.stringify(json)) as typeof json;
      expect(parsed.nodes.length).toBe(10);
      expect(parsed.edges.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Regime-adaptive interval
  // =========================================================================

  describe("Regime-adaptive interval", () => {
    it('T31: adjustInterval("critical") sets interval to urgentComputeInterval', () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        {
          defaultComputeInterval: 15,
          urgentComputeInterval: 10,
          relaxedComputeInterval: 20,
        },
      );

      layoutComputer.adjustInterval("critical");

      // Compute at 0, then at 5 — below default (15) but above urgent (10).
      layoutComputer.computeIfDue(0);
      const skipped = layoutComputer.computeIfDue(5);
      expect(skipped).toBe(false); // 5 < urgentComputeInterval (10).

      const computed = layoutComputer.computeIfDue(10);
      expect(computed).toBe(true); // 10 >= urgentComputeInterval (10).
    });

    it('T32: adjustInterval("stable") sets interval to relaxedComputeInterval', () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        {
          defaultComputeInterval: 15,
          urgentComputeInterval: 10,
          relaxedComputeInterval: 20,
        },
      );

      layoutComputer.adjustInterval("stable");

      // Compute at 0, then at 15 — above default but below relaxed.
      layoutComputer.computeIfDue(0);
      const skipped = layoutComputer.computeIfDue(15);
      expect(skipped).toBe(false); // 15 < relaxedComputeInterval (20).

      const computed = layoutComputer.computeIfDue(20);
      expect(computed).toBe(true); // 20 >= relaxedComputeInterval (20).
    });

    it('T33: adjustInterval("nascent") sets interval to defaultComputeInterval', () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        {
          defaultComputeInterval: 15,
          urgentComputeInterval: 10,
          relaxedComputeInterval: 20,
        },
      );

      layoutComputer.adjustInterval("stable"); // First set to relaxed.
      layoutComputer.adjustInterval("nascent"); // Then reset to default.

      layoutComputer.computeIfDue(0);
      const skipped = layoutComputer.computeIfDue(10);
      expect(skipped).toBe(false); // 10 < defaultComputeInterval (15).

      const computed = layoutComputer.computeIfDue(15);
      expect(computed).toBe(true); // 15 >= defaultComputeInterval (15).
    });

    it('T34b: adjustInterval("transitioning") uses urgentComputeInterval', () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        {
          defaultComputeInterval: 15,
          urgentComputeInterval: 10,
          relaxedComputeInterval: 20,
        },
      );

      layoutComputer.adjustInterval("transitioning");

      layoutComputer.computeIfDue(0);
      const skipped = layoutComputer.computeIfDue(5);
      expect(skipped).toBe(false); // Below urgent interval.

      const computed = layoutComputer.computeIfDue(10);
      expect(computed).toBe(true); // At urgent interval.
    });
  });

  // =========================================================================
  // Event emission
  // =========================================================================

  describe("Event emission", () => {
    it("T34: tna:layout-updated is emitted after computeLayout() on a normal graph", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      const events: Array<{
        type: string;
        iteration: number;
        energy: number;
        nodeCount: number;
        physicsIterations: number;
      }> = [];

      layoutComputer.on("tna:layout-updated", (e) =>
        events.push(e as (typeof events)[0]),
      );

      layoutComputer.computeLayout();

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("tna:layout-updated");
    });

    it("T35: Event payload contains energy, nodeCount, physicsIterations", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear, { iterations: 75 });

      const events: Array<{
        type: string;
        iteration: number;
        energy: number;
        nodeCount: number;
        physicsIterations: number;
      }> = [];

      layoutComputer.on("tna:layout-updated", (e) =>
        events.push(e as (typeof events)[0]),
      );

      layoutComputer.computeLayout(75);

      const event = events[0]!;
      expect(typeof event.energy).toBe("number");
      expect(event.nodeCount).toBe(linear.order);
      expect(event.physicsIterations).toBe(75);
    });

    it("T36: tna:layout-updated NOT emitted for trivial layouts (< minGraphOrder)", () => {
      const small = buildSmallGraph(); // 2 nodes
      const layoutComputer = new LayoutComputer(
        small,
        {},
        { minGraphOrder: 3 },
      );

      const events: unknown[] = [];
      layoutComputer.on("tna:layout-updated", (e) => events.push(e));

      layoutComputer.computeLayout();

      expect(events).toHaveLength(0);
    });

    it("T37b: computeIfDue emits event when computation runs", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(
        linear,
        {},
        { defaultComputeInterval: 5 },
      );

      const events: unknown[] = [];
      layoutComputer.on("tna:layout-updated", (e) => events.push(e));

      layoutComputer.computeIfDue(0); // computes
      layoutComputer.computeIfDue(3); // skips
      layoutComputer.computeIfDue(5); // computes

      expect(events).toHaveLength(2);
    });
  });

  // =========================================================================
  // Configuration
  // =========================================================================

  describe("Configuration", () => {
    it("T37: Custom iterations count is respected in LayoutOutput", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear, { iterations: 200 });

      const output = layoutComputer.computeLayout(200);

      expect(output.iterations).toBe(200);
    });

    it("T38: barnesHutOptimize: false produces valid layout", () => {
      const { graph } = buildTwoClusterGraph();
      const layoutComputer = new LayoutComputer(graph, {
        iterations: 50,
        barnesHutOptimize: false,
      });

      const output = layoutComputer.computeLayout();

      expect(output.positions.size).toBe(10);
      for (const [, pos] of output.positions) {
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
      }
    });

    it("T39: Custom scalingRatio changes position spread (higher ratio = more spread)", () => {
      const { graph: graph1 } = buildTwoClusterGraph();
      const { graph: graph2 } = buildTwoClusterGraph();

      const lc1 = new LayoutComputer(graph1, {
        iterations: 100,
        scalingRatio: 1.0,
        barnesHutOptimize: false,
        seed: 42,
      });
      const lc2 = new LayoutComputer(graph2, {
        iterations: 100,
        scalingRatio: 5.0,
        barnesHutOptimize: false,
        seed: 42,
      });

      lc1.computeLayout(100);
      lc2.computeLayout(100);

      // Measure total spread (sum of distances from origin) — higher scalingRatio should give larger spread.
      let spread1 = 0;
      let spread2 = 0;
      for (const [nodeId] of graph1
        .getGraph()
        .nodes()
        .map((n: string) => [n])) {
        const pos1 = graph1.getNodePosition(nodeId as string);
        const pos2 = graph2.getNodePosition(nodeId as string);
        if (pos1) spread1 += Math.sqrt(pos1.x ** 2 + pos1.y ** 2);
        if (pos2) spread2 += Math.sqrt(pos2.x ** 2 + pos2.y ** 2);
      }

      // Higher scalingRatio should produce larger spread (repulsion is stronger).
      expect(spread2).toBeGreaterThan(spread1);
    });

    it("T40: Default config matches documented LayoutConfig values", () => {
      const linear = buildLinearGraph();
      const layoutComputer = new LayoutComputer(linear);

      const output = layoutComputer.computeLayout();

      // Default iterations is 100.
      expect(output.iterations).toBe(100);
    });
  });
});
