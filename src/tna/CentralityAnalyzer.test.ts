/**
 * CentralityAnalyzer.test.ts
 *
 * TDD tests for betweenness centrality computation used in bridge node identification.
 *
 * Test inventory:
 *   T13:  Bridge node has highest betweenness centrality in two-clique graph
 *   T13b: Peripheral nodes (within-clique-only) have low centrality
 *   T14:  Centrality values are normalized between 0 and 1
 *   T14b: Complete graph has approximately uniform centrality
 *   T15:  Centrality results are assigned back to TextNode metadata via CooccurrenceGraph
 *   T15b: getTopNodes() returns nodes ranked by centrality in descending order
 *
 * RED phase: all tests fail until CentralityAnalyzer.ts is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Preprocessor } from './Preprocessor.js';
import { CooccurrenceGraph } from './CooccurrenceGraph.js';
import { CentralityAnalyzer } from './CentralityAnalyzer.js';

// ---------------------------------------------------------------------------
// Test helper: buildTwoCliqueGraph()
//
// Identical to the helper in LouvainDetector.test.ts.
// Two cliques of 5 nodes each, connected by a single bridge edge a1--b1.
// ---------------------------------------------------------------------------

function buildTwoCliqueGraph(): {
  graph: CooccurrenceGraph;
  cliqueA: string[];
  cliqueB: string[];
  bridgeNodes: [string, string];
} {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const cliqueA = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const cliqueB = ['b1', 'b2', 'b3', 'b4', 'b5'];

  graph.ingestTokens([...cliqueA, ...cliqueB], 0);

  const g = graph.getGraph();

  // Full connectivity within clique A.
  for (let i = 0; i < cliqueA.length; i++) {
    for (let j = i + 1; j < cliqueA.length; j++) {
      const src = cliqueA[i]!;
      const dst = cliqueA[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 10, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, 'weight', 10);
      }
    }
  }

  // Full connectivity within clique B.
  for (let i = 0; i < cliqueB.length; i++) {
    for (let j = i + 1; j < cliqueB.length; j++) {
      const src = cliqueB[i]!;
      const dst = cliqueB[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 10, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, 'weight', 10);
      }
    }
  }

  // Remove all inter-clique edges except a1--b1 bridge.
  g.forEachEdge((edge, _attrs, source, target) => {
    const srcInA = cliqueA.includes(source);
    const dstInA = cliqueA.includes(target);
    const srcInB = cliqueB.includes(source);
    const dstInB = cliqueB.includes(target);

    const isInterClique = (srcInA && dstInB) || (srcInB && dstInA);
    if (!isInterClique) return;

    const isBridge =
      (source === 'a1' && target === 'b1') || (source === 'b1' && target === 'a1');
    if (!isBridge) {
      g.dropEdge(edge);
    } else {
      g.setEdgeAttribute(edge, 'weight', 1);
    }
  });

  if (!g.hasEdge('a1', 'b1')) {
    g.addEdge('a1', 'b1', { weight: 1, createdAtIteration: 0 });
  }

  return { graph, cliqueA, cliqueB, bridgeNodes: ['a1', 'b1'] };
}

// ---------------------------------------------------------------------------
// Test helper: buildFullyConnectedGraph(n)
// ---------------------------------------------------------------------------

function buildFullyConnectedGraph(n: number): CooccurrenceGraph {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);

  const nodes = Array.from({ length: n }, (_, i) => `node${i}`);
  graph.ingestTokens(nodes, 0);

  const g = graph.getGraph();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const src = nodes[i]!;
      const dst = nodes[j]!;
      if (!g.hasEdge(src, dst)) {
        g.addEdge(src, dst, { weight: 5, createdAtIteration: 0 });
      } else {
        const edge = g.edge(src, dst)!;
        g.setEdgeAttribute(edge, 'weight', 5);
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CentralityAnalyzer', () => {
  let twoCliqueGraph: CooccurrenceGraph;
  let cliqueA: string[];
  let cliqueB: string[];
  let bridgeNodes: [string, string];

  beforeEach(() => {
    const result = buildTwoCliqueGraph();
    twoCliqueGraph = result.graph;
    cliqueA = result.cliqueA;
    cliqueB = result.cliqueB;
    bridgeNodes = result.bridgeNodes;
  });

  // --------------------------------------------------------------------------
  // T13: Bridge node has highest betweenness centrality
  // --------------------------------------------------------------------------

  it('T13: bridge nodes (a1, b1) have the highest betweenness centrality', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    const scores = analyzer.compute();

    const bridgeA1 = scores.get('a1') ?? 0;
    const bridgeB1 = scores.get('b1') ?? 0;

    // Bridge nodes should have higher centrality than all other nodes.
    for (const node of [...cliqueA, ...cliqueB]) {
      if (node === 'a1' || node === 'b1') continue;
      const score = scores.get(node) ?? 0;
      expect(bridgeA1).toBeGreaterThan(score);
      expect(bridgeB1).toBeGreaterThan(score);
    }
  });

  // --------------------------------------------------------------------------
  // T13b: Peripheral nodes have low centrality
  // --------------------------------------------------------------------------

  it('T13b: peripheral nodes (non-bridge clique members) have betweenness centrality near 0', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    const scores = analyzer.compute();

    // Non-bridge nodes in clique A: a2, a3, a4, a5
    // These are NOT on any shortest path between communities.
    const peripheralA = cliqueA.filter(n => n !== 'a1');
    const peripheralB = cliqueB.filter(n => n !== 'b1');

    for (const node of [...peripheralA, ...peripheralB]) {
      const score = scores.get(node) ?? 0;
      // Peripheral nodes should have low centrality (close to 0).
      expect(score).toBeLessThan(0.5);
    }
  });

  // --------------------------------------------------------------------------
  // T14: Centrality values are normalized between 0 and 1
  // --------------------------------------------------------------------------

  it('T14: all betweenness centrality values are in [0, 1]', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    const scores = analyzer.compute();

    for (const [_node, score] of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  // --------------------------------------------------------------------------
  // T14b: Complete graph has approximately uniform centrality
  // --------------------------------------------------------------------------

  it('T14b: fully connected graph has approximately equal betweenness for all nodes', () => {
    const fullyConnected = buildFullyConnectedGraph(5);
    const analyzer = new CentralityAnalyzer(fullyConnected);
    const scores = analyzer.compute();

    // All nodes should have the same (or very similar) centrality.
    // In a complete graph K_n, there are no shortest paths of length > 1 that pass through
    // a single intermediate node — all paths are direct.
    // Normalized betweenness centrality for all nodes in K_n = 0.
    for (const [_node, score] of scores) {
      expect(score).toBeCloseTo(0, 5);
    }
  });

  // --------------------------------------------------------------------------
  // T15: Centrality results assigned back to TextNode metadata
  // --------------------------------------------------------------------------

  it('T15: after compute(), cooccurrenceGraph.getNode() returns TextNode with betweennessCentrality set', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    analyzer.compute();

    // Bridge node 'a1' should have betweennessCentrality populated.
    const bridgeNode = twoCliqueGraph.getNode('a1');
    expect(bridgeNode).toBeDefined();
    expect(bridgeNode?.betweennessCentrality).toBeDefined();
    expect(typeof bridgeNode?.betweennessCentrality).toBe('number');
    expect(bridgeNode?.betweennessCentrality).toBeGreaterThan(0);

    // Peripheral node 'a2' should also have betweennessCentrality populated (may be 0).
    const peripheralNode = twoCliqueGraph.getNode('a2');
    expect(peripheralNode?.betweennessCentrality).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // T15b: getTopNodes() returns nodes ranked by centrality
  // --------------------------------------------------------------------------

  it('T15b: getTopNodes(3) returns the top 3 nodes by betweenness centrality, sorted descending', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    analyzer.compute();

    const top3 = analyzer.getTopNodes(3);

    expect(top3).toHaveLength(3);

    // Scores should be in descending order.
    for (let i = 0; i < top3.length - 1; i++) {
      expect(top3[i]!.score).toBeGreaterThanOrEqual(top3[i + 1]!.score);
    }

    // The top nodes should include the bridge nodes (they have highest centrality).
    const topNodeIds = top3.map(n => n.nodeId);
    expect(topNodeIds).toContain('a1');
    expect(topNodeIds).toContain('b1');

    // getTopNodes(0) returns empty array.
    const top0 = analyzer.getTopNodes(0);
    expect(top0).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Additional: getScore() and getBridgeNodes() methods
  // --------------------------------------------------------------------------

  it('getScore() returns 0 for unknown nodes and correct scores for known nodes', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    analyzer.compute();

    // Known bridge node has score > 0.
    const bridgeScore = analyzer.getScore('a1');
    expect(bridgeScore).toBeGreaterThan(0);

    // Unknown node returns 0.
    const unknownScore = analyzer.getScore('nonexistent');
    expect(unknownScore).toBe(0);
  });

  it('getBridgeNodes(threshold) returns nodes with centrality above threshold', () => {
    const analyzer = new CentralityAnalyzer(twoCliqueGraph);
    analyzer.compute();

    // High threshold — should return only the bridge nodes.
    const highThreshold = analyzer.getScore('a1') * 0.5;
    const bridgeNodesList = analyzer.getBridgeNodes(highThreshold);

    expect(bridgeNodesList).toContain('a1');
    expect(bridgeNodesList).toContain('b1');

    // Very high threshold — should return empty.
    const veryHighThreshold = 2.0; // > 1.0, so nothing can exceed it
    expect(analyzer.getBridgeNodes(veryHighThreshold)).toHaveLength(0);
  });
});
