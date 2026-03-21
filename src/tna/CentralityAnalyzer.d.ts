/**
 * CentralityAnalyzer.ts
 *
 * Betweenness centrality computation for bridge node identification in TNA graphs,
 * extended with Phase 6 time-series tracking (TNA-09).
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
 * Phase 6 additions (TNA-09):
 *   - Time-series tracking: stores centrality scores per node per iteration.
 *   - Trend detection: 'rising', 'falling', 'stable', 'oscillating' from 3+ points.
 *   - Peak and valley identification.
 *   - Rapid change detection (3x multiplier) → emits 'tna:centrality-change-detected'.
 *   - Topology reorganization detection → emits 'tna:topology-reorganized'.
 *   - Regime-adaptive computation interval (5/10/20 iterations).
 *   - Extends EventEmitter (same pattern as CohomologyAnalyzer, SOCTracker).
 *
 * Dependencies:
 *   - graphology-metrics/centrality/betweenness (betweenness centrality)
 *   - src/tna/CooccurrenceGraph.ts (source of graphology graph + metadata update)
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */
import { EventEmitter } from "events";
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type { CentralityTimeSeries, CentralityTimeSeriesConfig } from "./interfaces.js";
export interface CentralityEntry {
    readonly nodeId: string;
    readonly score: number;
}
/**
 * CentralityAnalyzer — computes betweenness centrality for all nodes in a
 * TNA co-occurrence graph, identifies bridge nodes, and writes centrality
 * scores back to the CooccurrenceGraph TextNode metadata.
 *
 * Phase 6: Extends EventEmitter and adds time-series tracking (TNA-09).
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
 *
 *   // Phase 6 time-series:
 *   const updated = analyzer.computeIfDue(iteration); // conditional compute
 *   analyzer.adjustInterval('critical');              // set urgentComputeInterval
 *   const ts = analyzer.getTimeSeries('nodeId');      // get trend/peak/valley
 */
export declare class CentralityAnalyzer extends EventEmitter {
    #private;
    constructor(cooccurrenceGraph: CooccurrenceGraph, timeSeriesConfig?: Partial<CentralityTimeSeriesConfig>);
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
    compute(): ReadonlyMap<string, number>;
    /**
     * computeIfDue — conditionally compute centrality based on iteration interval.
     *
     * Called by the orchestrator each iteration. Only performs the expensive
     * betweenness centrality computation when the interval has elapsed.
     *
     * @param iteration - The current reasoning iteration number.
     * @returns true if computation was performed, false if skipped.
     */
    computeIfDue(iteration: number): boolean;
    /**
     * adjustInterval — change the computation interval based on regime.
     *
     * Called when regime:classification event arrives. Adjusts how frequently
     * centrality is recomputed to balance cost vs. accuracy.
     *
     * @param regime - Current system regime (string from RegimeAnalyzer).
     */
    adjustInterval(regime: string): void;
    /**
     * getTimeSeries — get the time-series centrality data for a single node.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @returns CentralityTimeSeries or undefined if no data for this node.
     */
    getTimeSeries(nodeId: string): CentralityTimeSeries | undefined;
    /**
     * getAllTimeSeries — get time-series data for all tracked nodes.
     *
     * @returns Array of CentralityTimeSeries for every node with data.
     */
    getAllTimeSeries(): ReadonlyArray<CentralityTimeSeries>;
    /**
     * getRisingNodes — return nodes with a 'rising' centrality trend.
     *
     * @param minSlope - Optional minimum slope magnitude filter (default 0).
     * @returns Array of CentralityTimeSeries for rising nodes.
     */
    getRisingNodes(minSlope?: number): ReadonlyArray<CentralityTimeSeries>;
    /**
     * getScore — returns the betweenness centrality score for a node.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @returns Score in [0, 1], or 0 if node not found or compute() not called.
     */
    getScore(nodeId: string): number;
    /**
     * getTopNodes — returns the top N nodes by betweenness centrality, sorted descending.
     *
     * @param n - Number of top nodes to return.
     * @returns Array of { nodeId, score } sorted by score descending.
     */
    getTopNodes(n: number): ReadonlyArray<CentralityEntry>;
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
    getBridgeNodes(threshold: number): ReadonlyArray<string>;
}
//# sourceMappingURL=CentralityAnalyzer.d.ts.map