/**
 * SOCTracker.ts — SOCTracker class (SOC-03, SOC-04, SOC-05, SOC-06, SOC-07)
 *
 * The SOCTracker is the integration point for all five SOC metrics:
 *   1. Von Neumann entropy (vonNeumannEntropy — SOC-01)
 *   2. Embedding entropy (embeddingEntropy — SOC-02)
 *   3. Complexity Differential Probe: CDP = VNE - EE (SOC-03)
 *   4. Per-iteration surprising edge ratio (SOC-04)
 *   5. Dynamic phase transition detection via rolling Pearson correlation (SOC-05)
 *
 * Phase 6 additions:
 *   6. Regime persistence validation (SOC-06) — RegimeValidator confirms transitions
 *      only after N consecutive same-sign iterations with coherence check and H^1 gating.
 *   7. Regime stability analysis (SOC-07) — RegimeAnalyzer classifies system into
 *      one of four states: nascent / stable / critical / transitioning.
 *
 * Extends EventEmitter (same pattern as CohomologyAnalyzer.ts in Phase 1).
 * Emits:
 *   - 'soc:metrics' (SOCMetricsEvent): every iteration with all 8 fields
 *   - 'phase:transition' (SOCPhaseTransitionEvent): when correlation sign changes
 *   - 'phase:transition-confirmed' (PhaseTransitionConfirmedEvent): after validation
 *   - 'regime:classification' (RegimeClassificationEvent): every iteration
 *
 * Isolation invariant: ZERO imports from src/tna/, src/lcm/, or src/orchestrator/.
 * All inputs arrive via the SOCInputs plain-type interface.
 * H^1 dimension is provided externally via updateH1Dimension() — no sheaf import needed.
 *
 * Key design decisions (from CONTEXT.md and 04-01-SUMMARY.md):
 *   - Phase transition detected via sign change in rolling Pearson correlation of
 *     entropy deltas (deltaS_structural and deltaS_semantic), NOT at a fixed iteration.
 *     No literal "400" appears in this file.
 *   - Surprising edge ratio is per-iteration only: edges with createdAtIteration !== iteration
 *     are excluded (Pitfall 3 guard from RESEARCH.md).
 *   - An edge is surprising IFF: (a) cross-community AND (b) cosineSimilarity < threshold.
 */
import { EventEmitter } from "events";
import type { SOCInputs, SOCMetrics, SOCConfig, MetricsTrend, RegimeStability, RegimeMetrics } from "./interfaces.js";
/**
 * SOCTracker — computes and emits all five SOC metrics each iteration.
 *
 * Usage:
 *   const tracker = new SOCTracker({ correlationWindowSize: 10 });
 *   tracker.on('soc:metrics', (event) => console.log(event));
 *   tracker.on('phase:transition', (event) => alert('Phase transition!'));
 *
 *   const metrics = tracker.computeAndEmit(inputs);
 *
 * Thread safety: SOCTracker is not thread-safe. For multi-agent use, create
 * one SOCTracker instance per agent group and merge in the orchestrator.
 */
export declare class SOCTracker extends EventEmitter {
    #private;
    /**
     * Creates a new SOCTracker with optional configuration overrides.
     *
     * @param config - Partial SOCConfig. Unspecified fields use DEFAULT_CONFIG values.
     */
    constructor(config?: Partial<SOCConfig>);
    /**
     * computeAndEmit(inputs) — compute all 5 SOC metrics and emit soc:metrics event.
     *
     * Steps:
     *   1. Von Neumann entropy from graph structure
     *   2. Embedding entropy from covariance eigenspectrum
     *   3. CDP = VNE - EE
     *   4. Surprising edge ratio (per-iteration, both criteria required)
     *   5. Phase transition detection via rolling Pearson correlation sign change
     *   6. Build SOCMetrics object, push to history, emit events
     *
     * @param inputs - All metric computation inputs for this iteration.
     * @returns Computed SOCMetrics for this iteration.
     */
    computeAndEmit(inputs: SOCInputs): SOCMetrics;
    /**
     * updateH1Dimension — update the current H^1 dimension from sheaf obstruction events.
     *
     * Called by the orchestrator (ComposeRootModule) when 'sheaf:h1-obstruction-detected'
     * events arrive. This value is used by RegimeValidator for H^1 gating.
     *
     * Design: SOCTracker does NOT import from sheaf/. Instead, the orchestrator
     * passes the H^1 dimension via this method, maintaining module isolation.
     *
     * @param h1Dimension - Current H^1 dimension from CohomologyAnalyzer.
     */
    updateH1Dimension(h1Dimension: number): void;
    /**
     * getRegimeMetrics — returns the most recent regime analysis.
     *
     * Returns undefined if computeAndEmit() has never been called.
     */
    getRegimeMetrics(): RegimeMetrics | undefined;
    /**
     * getCurrentRegime — returns the current regime stability classification.
     *
     * Returns 'nascent' before computeAndEmit() is first called.
     */
    getCurrentRegime(): RegimeStability;
    /**
     * getMetricsHistory() — returns the full SOCMetrics time series.
     *
     * Returns a defensive frozen copy (same pattern as LCM ImmutableStore.getAll()).
     * Each call returns a new array, so mutations to the returned array do not
     * affect the internal history.
     */
    getMetricsHistory(): ReadonlyArray<SOCMetrics>;
    /**
     * getLatestMetrics() — returns the most recently computed SOCMetrics.
     *
     * Returns undefined if computeAndEmit() has never been called.
     */
    getLatestMetrics(): SOCMetrics | undefined;
    /**
     * getMetricsTrend(window?) — compute mean and OLS slope of vonNeumannEntropy.
     *
     * Uses the last `window` iterations (default: config.trendWindowSize).
     * If fewer iterations have been recorded, uses all available history.
     *
     * @param window - Number of recent iterations to include. Defaults to config.trendWindowSize.
     * @returns MetricsTrend with mean, slope, and actual window size used.
     */
    getMetricsTrend(window?: number): MetricsTrend;
}
//# sourceMappingURL=SOCTracker.d.ts.map