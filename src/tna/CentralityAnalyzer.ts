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

// graphology-metrics does not have package.json "exports" field, so NodeNext
// subpath imports like 'graphology-metrics/centrality/betweenness' fail.
// Use createRequire (CJS interop) to load the submodule directly.
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import type { CooccurrenceGraph } from './CooccurrenceGraph.js';
import type {
  CentralityTimeSeries,
  CentralityTrend,
  CentralityTimeSeriesConfig,
} from './interfaces.js';

const _require = createRequire(import.meta.url);

interface IBetweennessCentrality {
  (graph: unknown, options?: { normalized?: boolean }): Record<string, number>;
  assign(graph: unknown, options?: { normalized?: boolean }): void;
}

const betweennessCentrality = _require('graphology-metrics/centrality/betweenness') as IBetweennessCentrality;

// ---------------------------------------------------------------------------
// Default time-series configuration
// ---------------------------------------------------------------------------

const DEFAULT_TIMESERIES_CONFIG: CentralityTimeSeriesConfig = {
  defaultComputeInterval: 10,
  urgentComputeInterval: 5,
  relaxedComputeInterval: 20,
  trendSlopeThreshold: 0.05,
  rapidChangeMultiplier: 3.0,
};

/** Maximum number of time-series entries per node (prevents unbounded growth). */
const MAX_TIMESERIES_LENGTH = 50;

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
export class CentralityAnalyzer extends EventEmitter {
  readonly #cooccurrenceGraph: CooccurrenceGraph;

  /** node ID → normalized betweenness centrality score in [0, 1] */
  #scores: Map<string, number> = new Map();

  // -------------------------------------------------------------------------
  // Phase 6: time-series fields
  // -------------------------------------------------------------------------

  readonly #timeSeriesConfig: CentralityTimeSeriesConfig;

  /** Time-series: nodeId → array of { iteration, score } entries (max 50). */
  #timeSeries: Map<string, Array<{ iteration: number; score: number }>> = new Map();

  /** Snapshot of node rank positions for topology reorganization detection. */
  #previousRanks: Map<string, number> = new Map();

  /** Last iteration at which centrality was computed. */
  #lastComputeIteration: number = 0;

  /** Current computation interval (adjusted by regime). */
  #currentInterval: number;

  constructor(
    cooccurrenceGraph: CooccurrenceGraph,
    timeSeriesConfig?: Partial<CentralityTimeSeriesConfig>
  ) {
    super();
    this.#cooccurrenceGraph = cooccurrenceGraph;
    this.#timeSeriesConfig = { ...DEFAULT_TIMESERIES_CONFIG, ...timeSeriesConfig };
    this.#currentInterval = this.#timeSeriesConfig.defaultComputeInterval;
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
  // Phase 6: computeIfDue()
  // --------------------------------------------------------------------------

  /**
   * computeIfDue — conditionally compute centrality based on iteration interval.
   *
   * Called by the orchestrator each iteration. Only performs the expensive
   * betweenness centrality computation when the interval has elapsed.
   *
   * @param iteration - The current reasoning iteration number.
   * @returns true if computation was performed, false if skipped.
   */
  computeIfDue(iteration: number): boolean {
    const elapsed = iteration - this.#lastComputeIteration;

    if (elapsed < this.#currentInterval) {
      return false;
    }

    // Perform computation.
    this.compute();

    // Update time-series with the new scores.
    this.#updateTimeSeries(iteration);

    return true;
  }

  // --------------------------------------------------------------------------
  // Phase 6: #updateTimeSeries()
  // --------------------------------------------------------------------------

  /**
   * #updateTimeSeries — record centrality scores for each node at this iteration.
   *
   * Also detects rapid changes and topology reorganizations, emitting events.
   *
   * @param iteration - The current reasoning iteration.
   */
  #updateTimeSeries(iteration: number): void {
    const totalNodes = this.#scores.size;

    // Track how many nodes changed rank significantly (for topology detection).
    let majorRankChanges = 0;

    // Build new rank snapshot.
    const newRanks = this.#buildRankSnapshot();

    for (const [nodeId, score] of this.#scores) {
      // Get or create time-series entry.
      let series = this.#timeSeries.get(nodeId);
      if (!series) {
        series = [];
        this.#timeSeries.set(nodeId, series);
      }

      // Get previous score for rapid change detection.
      const previousEntry = series.length > 0 ? series[series.length - 1] : null;

      // Append new data point.
      series.push({ iteration, score });

      // Trim to max entries.
      if (series.length > MAX_TIMESERIES_LENGTH) {
        series.splice(0, series.length - MAX_TIMESERIES_LENGTH);
      }

      // Detect rapid changes (3x increase in score).
      if (previousEntry !== null && previousEntry.score > 0) {
        const changeRatio = score / previousEntry.score;
        if (changeRatio >= this.#timeSeriesConfig.rapidChangeMultiplier) {
          const trend = this.#computeTrend(series);
          this.emit('tna:centrality-change-detected', {
            type: 'tna:centrality-change-detected',
            nodeId,
            trend,
            previousScore: previousEntry.score,
            currentScore: score,
            iteration,
          });
        }
      }

      // Check for major rank change (> 50% of total nodes).
      const prevRank = this.#previousRanks.get(nodeId);
      const newRank = newRanks.get(nodeId);
      if (prevRank !== undefined && newRank !== undefined && totalNodes > 0) {
        const rankChange = Math.abs(newRank - prevRank);
        if (rankChange > totalNodes * 0.5) {
          majorRankChanges++;
        }
      }
    }

    // Detect topology reorganization (> 3 nodes with major rank changes).
    if (majorRankChanges > 3) {
      this.emit('tna:topology-reorganized', {
        type: 'tna:topology-reorganized',
        majorNodeSwaps: majorRankChanges,
        iteration,
      });
    }

    // Update state.
    this.#previousRanks = newRanks;
    this.#lastComputeIteration = iteration;
  }

  // --------------------------------------------------------------------------
  // Private: #buildRankSnapshot()
  // --------------------------------------------------------------------------

  /**
   * #buildRankSnapshot — build a nodeId → rank position map from current scores.
   *
   * Rank 0 = highest centrality node.
   */
  #buildRankSnapshot(): Map<string, number> {
    const sorted = Array.from(this.#scores.entries()).sort((a, b) => b[1] - a[1]);
    const ranks = new Map<string, number>();
    sorted.forEach(([nodeId], idx) => ranks.set(nodeId, idx));
    return ranks;
  }

  // --------------------------------------------------------------------------
  // Phase 6: adjustInterval()
  // --------------------------------------------------------------------------

  /**
   * adjustInterval — change the computation interval based on regime.
   *
   * Called when regime:classification event arrives. Adjusts how frequently
   * centrality is recomputed to balance cost vs. accuracy.
   *
   * @param regime - Current system regime (string from RegimeAnalyzer).
   */
  adjustInterval(regime: string): void {
    switch (regime) {
      case 'transitioning':
      case 'critical':
        this.#currentInterval = this.#timeSeriesConfig.urgentComputeInterval;
        break;
      case 'stable':
        this.#currentInterval = this.#timeSeriesConfig.relaxedComputeInterval;
        break;
      default:
        this.#currentInterval = this.#timeSeriesConfig.defaultComputeInterval;
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Phase 6: getTimeSeries()
  // --------------------------------------------------------------------------

  /**
   * getTimeSeries — get the time-series centrality data for a single node.
   *
   * @param nodeId - The node's identifier (canonical lemma string).
   * @returns CentralityTimeSeries or undefined if no data for this node.
   */
  getTimeSeries(nodeId: string): CentralityTimeSeries | undefined {
    const series = this.#timeSeries.get(nodeId);
    if (!series || series.length === 0) {
      return undefined;
    }

    const frozen = series.slice();
    const trend = this.#computeTrend(frozen);
    const peak = this.#findPeak(frozen);
    const valley = this.#findValley(frozen);

    return {
      nodeId,
      scores: frozen,
      trend,
      peak,
      valley,
    };
  }

  // --------------------------------------------------------------------------
  // Phase 6: getAllTimeSeries()
  // --------------------------------------------------------------------------

  /**
   * getAllTimeSeries — get time-series data for all tracked nodes.
   *
   * @returns Array of CentralityTimeSeries for every node with data.
   */
  getAllTimeSeries(): ReadonlyArray<CentralityTimeSeries> {
    const result: CentralityTimeSeries[] = [];
    for (const [nodeId] of this.#timeSeries) {
      const ts = this.getTimeSeries(nodeId);
      if (ts) {
        result.push(ts);
      }
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Phase 6: getRisingNodes()
  // --------------------------------------------------------------------------

  /**
   * getRisingNodes — return nodes with a 'rising' centrality trend.
   *
   * @param minSlope - Optional minimum slope magnitude filter (default 0).
   * @returns Array of CentralityTimeSeries for rising nodes.
   */
  getRisingNodes(minSlope?: number): ReadonlyArray<CentralityTimeSeries> {
    const all = this.getAllTimeSeries();
    const rising = all.filter(ts => ts.trend === 'rising');

    if (minSlope !== undefined && minSlope > 0) {
      return rising.filter(ts => {
        const series = ts.scores as Array<{ iteration: number; score: number }>;
        if (series.length < 2) return false;
        const last = series[series.length - 1]!;
        const first = series[0]!;
        const slope = (last.score - first.score) / Math.max(1, series.length - 1);
        return slope >= minSlope;
      });
    }

    return rising;
  }

  // --------------------------------------------------------------------------
  // Private: #computeTrend()
  // --------------------------------------------------------------------------

  /**
   * #computeTrend — classify the trend direction from a time-series of scores.
   *
   * Algorithm:
   *   - If fewer than 3 data points: return 'stable'.
   *   - Take the last 3 data points.
   *   - Compute slope: (last.score - first.score) / 2.
   *   - If |slope| < trendSlopeThreshold: return 'stable'.
   *   - If slope > threshold: return 'rising'.
   *   - If slope < -threshold: return 'falling'.
   *   - Check for oscillation: if consecutive delta signs alternate, return 'oscillating'.
   *
   * @param scores - Array of { iteration, score } entries.
   * @returns CentralityTrend classification.
   */
  #computeTrend(scores: Array<{ iteration: number; score: number }>): CentralityTrend {
    if (scores.length < 3) {
      return 'stable';
    }

    const last3 = scores.slice(-3);
    const first = last3[0]!;
    const last = last3[last3.length - 1]!;

    // Compute slope over the last 3 points.
    const slope = (last.score - first.score) / 2;

    // Check for oscillation: alternating delta signs.
    const delta1 = last3[1]!.score - last3[0]!.score;
    const delta2 = last3[2]!.score - last3[1]!.score;
    if (Math.abs(delta1) > this.#timeSeriesConfig.trendSlopeThreshold &&
        Math.abs(delta2) > this.#timeSeriesConfig.trendSlopeThreshold &&
        Math.sign(delta1) !== Math.sign(delta2)) {
      return 'oscillating';
    }

    if (Math.abs(slope) < this.#timeSeriesConfig.trendSlopeThreshold) {
      return 'stable';
    }

    return slope > 0 ? 'rising' : 'falling';
  }

  // --------------------------------------------------------------------------
  // Private: #findPeak()
  // --------------------------------------------------------------------------

  /**
   * #findPeak — find the entry with the highest score in a time-series.
   *
   * @param scores - Array of { iteration, score } entries.
   * @returns Entry with highest score, or null if empty.
   */
  #findPeak(
    scores: Array<{ iteration: number; score: number }>
  ): { iteration: number; score: number } | null {
    if (scores.length === 0) return null;

    let peak = scores[0]!;
    for (const entry of scores) {
      if (entry.score > peak.score) {
        peak = entry;
      }
    }
    return { iteration: peak.iteration, score: peak.score };
  }

  // --------------------------------------------------------------------------
  // Private: #findValley()
  // --------------------------------------------------------------------------

  /**
   * #findValley — find the entry with the lowest score in a time-series.
   *
   * @param scores - Array of { iteration, score } entries.
   * @returns Entry with lowest score, or null if empty.
   */
  #findValley(
    scores: Array<{ iteration: number; score: number }>
  ): { iteration: number; score: number } | null {
    if (scores.length === 0) return null;

    let valley = scores[0]!;
    for (const entry of scores) {
      if (entry.score < valley.score) {
        valley = entry;
      }
    }
    return { iteration: valley.iteration, score: valley.score };
  }

  // --------------------------------------------------------------------------
  // Public: query methods (backward compatible)
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
