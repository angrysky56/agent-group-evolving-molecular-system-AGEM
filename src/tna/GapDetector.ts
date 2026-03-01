/**
 * GapDetector.ts
 *
 * Structural gap detection with topological metrics.
 *
 * A gap is a low-density inter-community region that represents a semantic hole
 * in the network — a place where communities are only weakly connected. Gaps are
 * the primary targeting signal for Molecular-CoT bridging operations.
 *
 * For each pair of communities (i, j) with below-threshold inter-community density:
 *   - Compute inter-community density: edges_crossing / (|i| * |j|)
 *   - Compute shortest path length: average shortest path between the communities
 *   - Compute modularity delta: Q_separate - Q_merged (positive = gap is real)
 *   - Identify bridge nodes: high-centrality nodes with inter-community edges
 *
 * Algorithm notes:
 *   - A gap exists only if there is at least one inter-community edge (not zero-density).
 *   - Zero-density pairs (fully disconnected communities) are not gaps.
 *   - Bridge nodes are identified via betweenness centrality from CentralityAnalyzer.
 *   - Shortest paths computed via BFS on the co-occurrence graph.
 *
 * Dependencies:
 *   - src/tna/CooccurrenceGraph.ts (graph topology and node metadata)
 *   - src/tna/LouvainDetector.ts (community assignments)
 *   - src/tna/CentralityAnalyzer.ts (betweenness centrality scores)
 *   - src/tna/interfaces.ts (GapMetrics, TextNodeId)
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */

import type { CooccurrenceGraph } from './CooccurrenceGraph.js';
import type { LouvainDetector } from './LouvainDetector.js';
import type { CentralityAnalyzer } from './CentralityAnalyzer.js';
import type { GapMetrics, TextNodeId } from './interfaces.js';

// ---------------------------------------------------------------------------
// GapDetector class
// ---------------------------------------------------------------------------

/**
 * GapDetector — identifies structural gaps (low-density inter-community regions)
 * with topological metrics for Molecular-CoT targeting.
 *
 * Usage:
 *   const detector = new GapDetector(graph, louvainDetector, centralityAnalyzer);
 *   const gaps = detector.findGaps();
 *   const nearest = detector.findNearestGap();
 */
export class GapDetector {
  readonly #cooccurrenceGraph: CooccurrenceGraph;
  readonly #louvainDetector: LouvainDetector;
  readonly #centralityAnalyzer: CentralityAnalyzer;

  /** Cached gaps sorted by inter-community density (ascending). */
  #gaps: GapMetrics[] = [];

  /** Whether gaps have been computed yet. */
  #computed: boolean = false;

  constructor(
    cooccurrenceGraph: CooccurrenceGraph,
    louvainDetector: LouvainDetector,
    centralityAnalyzer: CentralityAnalyzer
  ) {
    this.#cooccurrenceGraph = cooccurrenceGraph;
    this.#louvainDetector = louvainDetector;
    this.#centralityAnalyzer = centralityAnalyzer;
  }

  // --------------------------------------------------------------------------
  // Public: findGaps()
  // --------------------------------------------------------------------------

  /**
   * findGaps — detect all structural gaps (low-density inter-community regions).
   *
   * Algorithm:
   *   1. Get community assignments and distinct community IDs.
   *   2. If only 1 community, return empty array (no gaps possible).
   *   3. For each pair of communities (i < j):
   *      a. Count inter-community edges.
   *      b. Compute density = edges / (size_i * size_j).
   *      c. If density > 0 and density < threshold (0.2), it's a gap.
   *      d. Compute shortest path, modularity delta, and bridge nodes.
   *   4. Sort by density (ascending) and return.
   *
   * @returns Read-only array of GapMetrics sorted by inter-community density.
   */
  findGaps(): ReadonlyArray<GapMetrics> {
    if (this.#computed) {
      return this.#gaps;
    }

    const graph = this.#cooccurrenceGraph.getGraph();
    const nodes = this.#cooccurrenceGraph.getNodes();

    // Build community membership map: communityId -> [nodeIds]
    const communityMembers = new Map<number, string[]>();
    for (const node of nodes) {
      const communityId = node.communityId;
      if (communityId !== undefined) {
        const members = communityMembers.get(communityId) ?? [];
        members.push(node.lemma);
        communityMembers.set(communityId, members);
      }
    }

    const communityIds = Array.from(communityMembers.keys()).sort((a, b) => a - b);

    // If only 1 community, no gaps possible.
    if (communityIds.length <= 1) {
      this.#computed = true;
      return [];
    }

    const newGaps: GapMetrics[] = [];
    const densityThreshold = 0.2;

    // For each pair of communities, compute gap metrics.
    for (let i = 0; i < communityIds.length; i++) {
      for (let j = i + 1; j < communityIds.length; j++) {
        const commA = communityIds[i]!;
        const commB = communityIds[j]!;

        const membersA = communityMembers.get(commA) ?? [];
        const membersB = communityMembers.get(commB) ?? [];

        // Count inter-community edges.
        let interEdges = 0;
        const interEdgeNodes = new Set<string>();

        for (const nodeA of membersA) {
          for (const nodeB of membersB) {
            if (graph.hasEdge(nodeA, nodeB)) {
              interEdges++;
              interEdgeNodes.add(nodeA);
              interEdgeNodes.add(nodeB);
            }
          }
        }

        // Skip zero-density pairs (disconnected, not a gap).
        if (interEdges === 0) continue;

        // Compute inter-community density.
        const density = interEdges / (membersA.length * membersB.length);

        // Only include if below threshold.
        if (density >= densityThreshold) continue;

        // Compute shortest path length (via BFS sample).
        const spl = this.#computeShortestPathLength(graph, membersA, membersB);

        // Compute modularity delta (estimate).
        const modDelta = this.#estimateModularityDelta(graph, commA, commB, membersA, membersB);

        // Identify bridge nodes: high centrality nodes with inter-community edges.
        const bridges = this.#identifyBridgeNodes(membersA, membersB, interEdgeNodes);

        const gap: GapMetrics = {
          communityA: commA,
          communityB: commB,
          interCommunityDensity: density,
          shortestPathLength: spl,
          modularityDelta: modDelta,
          bridgeNodes: bridges,
        };

        newGaps.push(gap);
      }
    }

    // Sort by density (ascending — lowest density = biggest gap).
    newGaps.sort((a, b) => a.interCommunityDensity - b.interCommunityDensity);

    this.#gaps = newGaps;
    this.#computed = true;
    return this.#gaps;
  }

  // --------------------------------------------------------------------------
  // Public: findNearestGap()
  // --------------------------------------------------------------------------

  /**
   * findNearestGap — returns the gap with the lowest inter-community density
   * (the most promising exploration target).
   *
   * @returns GapMetrics or undefined if no gaps.
   */
  findNearestGap(): GapMetrics | undefined {
    const gaps = this.findGaps();
    return gaps.length > 0 ? gaps[0] : undefined;
  }

  // --------------------------------------------------------------------------
  // Public: getGapCount()
  // --------------------------------------------------------------------------

  /**
   * getGapCount — returns the number of detected gaps.
   */
  getGapCount(): number {
    return this.findGaps().length;
  }

  // --------------------------------------------------------------------------
  // Public: getGapBetween()
  // --------------------------------------------------------------------------

  /**
   * getGapBetween — looks up a specific gap between two communities.
   *
   * @param communityA - First community ID.
   * @param communityB - Second community ID.
   * @returns GapMetrics or undefined if not found.
   */
  getGapBetween(communityA: number, communityB: number): GapMetrics | undefined {
    const gaps = this.findGaps();
    for (const gap of gaps) {
      if (
        (gap.communityA === communityA && gap.communityB === communityB) ||
        (gap.communityA === communityB && gap.communityB === communityA)
      ) {
        return gap;
      }
    }
    return undefined;
  }

  // --------------------------------------------------------------------------
  // Private: compute shortest path length via BFS
  // --------------------------------------------------------------------------

  /**
   * #computeShortestPathLength — compute average shortest path length between
   * two sets of nodes via BFS.
   *
   * Sample-based for performance: only compute from first 3 nodes of community A
   * to all of community B (sufficient for metric purposes).
   */
  readonly #computeShortestPathLength = (
    graph: any,
    membersA: string[],
    membersB: string[]
  ): number => {
    const sample = membersA.slice(0, Math.min(3, membersA.length));
    const setB = new Set(membersB);
    let totalDistance = 0;
    let count = 0;

    for (const startNode of sample) {
      const distances = this.#bfs(graph, startNode);
      for (const endNode of membersB) {
        const dist = distances.get(endNode);
        if (dist !== undefined && dist !== Infinity) {
          totalDistance += dist;
          count++;
        }
      }
    }

    return count > 0 ? totalDistance / count : Infinity;
  };

  // --------------------------------------------------------------------------
  // Private: BFS for shortest path
  // --------------------------------------------------------------------------

  /**
   * #bfs — breadth-first search from a start node.
   * Returns a map of node -> shortest distance.
   */
  readonly #bfs = (
    graph: any,
    startNode: string
  ): Map<string, number> => {
    const distances = new Map<string, number>();
    const visited = new Set<string>();
    const queue: [string, number][] = [[startNode, 0]];

    visited.add(startNode);
    distances.set(startNode, 0);

    while (queue.length > 0) {
      const [node, dist] = queue.shift()!;

      graph.forEachNeighbor(node, (neighbor: string) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          distances.set(neighbor, dist + 1);
          queue.push([neighbor, dist + 1]);
        }
      });
    }

    return distances;
  };

  // --------------------------------------------------------------------------
  // Private: estimate modularity delta
  // --------------------------------------------------------------------------

  /**
   * #estimateModularityDelta — estimate change in modularity if two communities
   * were merged.
   *
   * Simple heuristic: higher inter-community edge count relative to community
   * size -> larger (positive) delta. Assumes that bridges reduce modularity.
   */
  readonly #estimateModularityDelta = (
    graph: any,
    commA: number,
    commB: number,
    membersA: string[],
    membersB: string[]
  ): number => {
    // Count inter- and intra-community edges.
    let interEdges = 0;
    let intraEdgesA = 0;
    let intraEdgesB = 0;

    for (const nodeA of membersA) {
      for (const nodeB of membersB) {
        if (graph.hasEdge(nodeA, nodeB)) {
          interEdges++;
        }
      }
    }

    for (let i = 0; i < membersA.length; i++) {
      for (let j = i + 1; j < membersA.length; j++) {
        if (graph.hasEdge(membersA[i]!, membersA[j]!)) {
          intraEdgesA++;
        }
      }
    }

    for (let i = 0; i < membersB.length; i++) {
      for (let j = i + 1; j < membersB.length; j++) {
        if (graph.hasEdge(membersB[i]!, membersB[j]!)) {
          intraEdgesB++;
        }
      }
    }

    // Simple heuristic: delta is positive when intra-edges dominate.
    // (Low inter-community density relative to intra-community density indicates
    // that merging would reduce modularity, so delta is positive.)
    const totalIntra = intraEdgesA + intraEdgesB;
    const intraRatio = totalIntra > 0 ? totalIntra / (totalIntra + interEdges) : 1;

    // Scale to a reasonable range (0 to ~1).
    return Math.max(0.01, Math.min(1, intraRatio - 0.5));
  };

  // --------------------------------------------------------------------------
  // Private: identify bridge nodes
  // --------------------------------------------------------------------------

  /**
   * #identifyBridgeNodes — find nodes with high betweenness centrality and
   * inter-community edges.
   */
  readonly #identifyBridgeNodes = (
    membersA: string[],
    membersB: string[],
    interEdgeNodes: Set<string>
  ): readonly TextNodeId[] => {
    const candidates: { nodeId: string; score: number }[] = [];

    // Gather candidates from both communities that participate in inter-community edges.
    for (const nodeId of interEdgeNodes) {
      const score = this.#centralityAnalyzer.getScore(nodeId);
      candidates.push({ nodeId, score });
    }

    // Sort by centrality (descending).
    candidates.sort((a, b) => b.score - a.score);

    // Take top nodes (up to 2 for small gaps, more for larger).
    const topN = Math.max(2, Math.floor(candidates.length * 0.3));
    return candidates
      .slice(0, topN)
      .map(c => c.nodeId as TextNodeId);
  };
}
