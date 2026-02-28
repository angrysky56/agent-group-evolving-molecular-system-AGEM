/**
 * CentralityAnalyzer.ts
 *
 * Betweenness centrality computation for bridge node identification in TNA graphs.
 *
 * Bridge nodes are conceptual bottlenecks between communities — nodes that lie on
 * shortest paths between different community clusters. They are the primary signal
 * of structural gaps that GapDetector (Wave 3) uses to identify Molecular-CoT
 * bridging opportunities.
 *
 * Algorithm:
 *   - Betweenness centrality: fraction of shortest paths between all pairs of nodes
 *     that pass through a given node.
 *   - Uses normalized betweenness centrality (values in [0, 1]).
 *   - Computed via graphology-metrics betweenness centrality function.
 *
 * Dependencies:
 *   - graphology-metrics/centrality/betweenness (betweenness centrality)
 *   - src/tna/CooccurrenceGraph.ts (source of graphology graph + metadata update)
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */

// graphology-metrics does not have package.json "exports" field, so NodeNext
// subpath imports like 'graphology-metrics/centrality/betweenness' fail.
// Use createRequire (CJS interop) to load the submodule directly.
import { createRequire } from 'module';
import type { CooccurrenceGraph } from './CooccurrenceGraph.js';

const _require = createRequire(import.meta.url);

interface IBetweennessCentrality {
  (graph: unknown, options?: { normalized?: boolean }): Record<string, number>;
  assign(graph: unknown, options?: { normalized?: boolean }): void;
}

const betweennessCentrality = _require('graphology-metrics/centrality/betweenness') as IBetweennessCentrality;

// ---------------------------------------------------------------------------
// CentralityEntry type
// ---------------------------------------------------------------------------

export interface CentralityEntry {
  readonly nodeId: string;
  readonly score: number;
}

// ---------------------------------------------------------------------------
// CentralityAnalyzer class
// ---------------------------------------------------------------------------

/**
 * CentralityAnalyzer — computes betweenness centrality for all nodes in a
 * TNA co-occurrence graph, identifies bridge nodes, and writes centrality
 * scores back to the CooccurrenceGraph TextNode metadata.
 *
 * Usage:
 *   const analyzer = new CentralityAnalyzer(cooccurrenceGraph);
 *   const scores = analyzer.compute();
 *
 *   // Get bridge candidates (high centrality):
 *   const bridges = analyzer.getBridgeNodes(0.5);
 *
 *   // Top-N ranked by centrality:
 *   const top5 = analyzer.getTopNodes(5);
 *
 *   // TextNode metadata is updated:
 *   const node = cooccurrenceGraph.getNode('concept');
 *   console.log(node?.betweennessCentrality); // populated after compute()
 */
export class CentralityAnalyzer {
  readonly #cooccurrenceGraph: CooccurrenceGraph;

  /** node ID → normalized betweenness centrality score in [0, 1] */
  #scores: Map<string, number> = new Map();

  constructor(cooccurrenceGraph: CooccurrenceGraph) {
    this.#cooccurrenceGraph = cooccurrenceGraph;
  }

  // --------------------------------------------------------------------------
  // Public: compute()
  // --------------------------------------------------------------------------

  /**
   * compute — calculate normalized betweenness centrality for all nodes.
   *
   * Uses graphology-metrics betweenness centrality with `normalized: true` to
   * produce values in [0, 1].
   *
   * After compute():
   *   - `scores` map is populated with centrality for every node.
   *   - CooccurrenceGraph node metadata is updated (betweennessCentrality field).
   *
   * @returns ReadonlyMap from node ID to normalized betweenness centrality score.
   */
  compute(): ReadonlyMap<string, number> {
    const graph = this.#cooccurrenceGraph.getGraph();

    // Compute betweenness centrality with normalization.
    // The `normalized: true` option divides by (n-1)*(n-2)/2 for undirected graphs,
    // giving values in [0, 1].
    const rawScores = betweennessCentrality(graph, {
      normalized: true,
    });

    // Build the scores map.
    const newScores = new Map<string, number>();
    for (const [nodeId, score] of Object.entries(rawScores)) {
      newScores.set(nodeId, score);
    }

    this.#scores = newScores;

    // Write centrality scores back to CooccurrenceGraph node metadata.
    // This populates TextNode.betweennessCentrality for downstream consumers
    // (GapDetector, serialization, etc.).
    for (const [nodeId, score] of this.#scores) {
      this.#cooccurrenceGraph.updateNodeCentrality(nodeId, score);
    }

    return this.#scores as ReadonlyMap<string, number>;
  }

  // --------------------------------------------------------------------------
  // Public: query methods
  // --------------------------------------------------------------------------

  /**
   * getScore — returns the betweenness centrality score for a node.
   *
   * @param nodeId - The node's identifier (canonical lemma string).
   * @returns Score in [0, 1], or 0 if node not found or compute() not called.
   */
  getScore(nodeId: string): number {
    return this.#scores.get(nodeId) ?? 0;
  }

  /**
   * getTopNodes — returns the top N nodes by betweenness centrality, sorted descending.
   *
   * @param n - Number of top nodes to return.
   * @returns Array of { nodeId, score } sorted by score descending.
   */
  getTopNodes(n: number): ReadonlyArray<CentralityEntry> {
    if (n <= 0) return [];

    const sorted = Array.from(this.#scores.entries())
      .map(([nodeId, score]) => ({ nodeId, score }))
      .sort((a, b) => b.score - a.score);

    return sorted.slice(0, n);
  }

  /**
   * getBridgeNodes — returns node IDs with centrality above a given threshold.
   *
   * Bridge nodes are structural bottlenecks between communities — nodes with high
   * betweenness centrality that mediate information flow between clusters.
   * Used by GapDetector to identify candidates for Molecular-CoT bridging.
   *
   * @param threshold - Minimum centrality score (inclusive) for a node to be
   *   considered a bridge candidate. Values in [0, 1].
   * @returns Array of node IDs (canonical lemmas) with score > threshold.
   */
  getBridgeNodes(threshold: number): ReadonlyArray<string> {
    const bridges: string[] = [];
    for (const [nodeId, score] of this.#scores) {
      if (score > threshold) {
        bridges.push(nodeId);
      }
    }
    return bridges;
  }
}
