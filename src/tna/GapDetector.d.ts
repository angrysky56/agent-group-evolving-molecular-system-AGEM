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
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type { LouvainDetector } from "./LouvainDetector.js";
import type { CentralityAnalyzer } from "./CentralityAnalyzer.js";
import type { GapMetrics } from "./interfaces.js";
/**
 * GapDetector — identifies structural gaps (low-density inter-community regions)
 * with topological metrics for Molecular-CoT targeting.
 *
 * Usage:
 *   const detector = new GapDetector(graph, louvainDetector, centralityAnalyzer);
 *   const gaps = detector.findGaps();
 *   const nearest = detector.findNearestGap();
 */
export declare class GapDetector {
    #private;
    /** Default inter-community density threshold below which a region is considered a gap. */
    static readonly DENSITY_THRESHOLD = 0.2;
    constructor(cooccurrenceGraph: CooccurrenceGraph, louvainDetector: LouvainDetector, centralityAnalyzer: CentralityAnalyzer);
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
    findGaps(): ReadonlyArray<GapMetrics>;
    /**
     * findNearestGap — returns the gap with the lowest inter-community density
     * (the most promising exploration target).
     *
     * @returns GapMetrics or undefined if no gaps.
     */
    findNearestGap(): GapMetrics | undefined;
    /**
     * getGapCount — returns the number of detected gaps.
     */
    getGapCount(): number;
    /**
     * getGapBetween — looks up a specific gap between two communities.
     *
     * @param communityA - First community ID.
     * @param communityB - Second community ID.
     * @returns GapMetrics or undefined if not found.
     */
    getGapBetween(communityA: number, communityB: number): GapMetrics | undefined;
}
//# sourceMappingURL=GapDetector.d.ts.map