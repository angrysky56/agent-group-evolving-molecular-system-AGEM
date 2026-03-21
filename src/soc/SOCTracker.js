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
import { vonNeumannEntropy, embeddingEntropy, cosineSimilarity, } from "./entropy.js";
import { pearsonCorrelation, linearSlope } from "./correlation.js";
import { RegimeValidator, RegimeAnalyzer } from "./RegimeValidator.js";
// ---------------------------------------------------------------------------
// SOCConfig defaults
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
    correlationWindowSize: 10,
    surprisingEdgeSimilarityThreshold: 0.3,
    trendWindowSize: 5,
};
// ---------------------------------------------------------------------------
// SOCTracker class
// ---------------------------------------------------------------------------
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
export class SOCTracker extends EventEmitter {
    // Private state using # prefix (ESM private fields)
    #config;
    #history;
    #previousVNE;
    #previousEE;
    #previousCorrelation;
    #deltaStructural;
    #deltaSemantic;
    // Phase 6: Regime validation (SOC-06) and stability analysis (SOC-07)
    #regimeValidator;
    #regimeAnalyzer;
    #currentH1Dimension;
    #latestRegimeMetrics;
    /**
     * Creates a new SOCTracker with optional configuration overrides.
     *
     * @param config - Partial SOCConfig. Unspecified fields use DEFAULT_CONFIG values.
     */
    constructor(config = {}) {
        super();
        this.#config = { ...DEFAULT_CONFIG, ...config };
        this.#history = [];
        this.#previousVNE = null;
        this.#previousEE = null;
        this.#previousCorrelation = null;
        this.#deltaStructural = [];
        this.#deltaSemantic = [];
        // Phase 6: Instantiate regime components with optional config overrides
        this.#regimeValidator = new RegimeValidator(config.regimeValidatorConfig ?? {});
        this.#regimeAnalyzer = new RegimeAnalyzer(config.regimeAnalyzerConfig ?? {});
        this.#currentH1Dimension = 0;
        this.#latestRegimeMetrics = undefined;
    }
    // ---------------------------------------------------------------------------
    // computeAndEmit — main computation method
    // ---------------------------------------------------------------------------
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
    computeAndEmit(inputs) {
        const { nodeCount, edges, embeddings, communityAssignments, newEdges, iteration, } = inputs;
        // Step 1: Von Neumann entropy
        const vne = vonNeumannEntropy(nodeCount, edges);
        // Step 2: Embedding entropy
        const ee = embeddingEntropy(Array.from(embeddings.values()));
        // Step 3: CDP = vonNeumannEntropy - embeddingEntropy
        const cdp = vne - ee;
        // Step 4: Surprising edge ratio
        const surprisingEdgeRatio = this.#computeSurprisingEdgeRatio(inputs, embeddings, communityAssignments, newEdges, iteration);
        // Step 5: Phase transition detection
        const deltaVNE = this.#previousVNE !== null ? vne - this.#previousVNE : 0;
        const deltaEE = this.#previousEE !== null ? ee - this.#previousEE : 0;
        this.#deltaStructural.push(deltaVNE);
        this.#deltaSemantic.push(deltaEE);
        // Update previous values for next iteration
        this.#previousVNE = vne;
        this.#previousEE = ee;
        // Compute rolling Pearson correlation if enough data
        let correlationCoefficient = 0;
        let isPhaseTransition = false;
        const windowSize = this.#config.correlationWindowSize;
        if (this.#deltaStructural.length >= windowSize) {
            const structWindow = this.#deltaStructural.slice(-windowSize);
            const semWindow = this.#deltaSemantic.slice(-windowSize);
            correlationCoefficient = pearsonCorrelation(structWindow, semWindow);
            // Check for sign change (phase transition)
            if (this.#previousCorrelation !== null) {
                const prevSign = Math.sign(this.#previousCorrelation);
                const currSign = Math.sign(correlationCoefficient);
                // Sign change AND both magnitudes above noise floor (0.1)
                if (prevSign !== currSign &&
                    Math.abs(correlationCoefficient) > 0.1 &&
                    Math.abs(this.#previousCorrelation) > 0.1) {
                    isPhaseTransition = true;
                }
            }
        }
        // Step 6: Build SOCMetrics object
        const metrics = {
            iteration,
            timestamp: Date.now(),
            vonNeumannEntropy: vne,
            embeddingEntropy: ee,
            cdp,
            surprisingEdgeRatio,
            correlationCoefficient,
            isPhaseTransition,
        };
        // Push to history before emitting (history is ground truth)
        this.#history.push(metrics);
        // Update correlation history AFTER computing this iteration's transition flag
        this.#previousCorrelation =
            correlationCoefficient !== 0
                ? correlationCoefficient
                : this.#previousCorrelation;
        // Emit soc:metrics event
        const metricsEvent = {
            type: "soc:metrics",
            iteration,
            timestamp: metrics.timestamp,
            vonNeumannEntropy: vne,
            embeddingEntropy: ee,
            cdp,
            surprisingEdgeRatio,
            correlationCoefficient,
            isPhaseTransition,
        };
        this.emit("soc:metrics", metricsEvent);
        // Emit phase:transition event if detected
        if (isPhaseTransition) {
            const transitionEvent = {
                type: "phase:transition",
                iteration,
                centeredAtIteration: iteration - Math.floor(windowSize / 2),
                correlationCoefficient,
                previousCorrelation: this.#previousCorrelation ?? 0,
            };
            this.emit("phase:transition", transitionEvent);
        }
        // Phase 6: Regime validation (SOC-06)
        // Track correlation sign in the validator every iteration
        this.#regimeValidator.trackCorrelation(correlationCoefficient, iteration);
        // Check if any pending transition candidate should be confirmed
        let isTransitionConfirmed = false;
        const candidate = this.#regimeValidator.getCurrentCandidate();
        if (isPhaseTransition || candidate.startIteration !== null) {
            const validationResult = this.#regimeValidator.validateTransition(this.#currentH1Dimension, iteration);
            if (validationResult.confirmed) {
                isTransitionConfirmed = true;
                const confirmedEvent = {
                    type: "phase:transition-confirmed",
                    iteration,
                    centeredAtIteration: iteration - Math.floor(windowSize / 2),
                    coherence: validationResult.coherence,
                    h1Dimension: this.#currentH1Dimension,
                    correlationCoefficient,
                    previousCorrelation: this.#previousCorrelation ?? 0,
                };
                this.emit("phase:transition-confirmed", confirmedEvent);
            }
        }
        // Phase 6: Regime stability analysis (SOC-07) — emit every iteration
        const regimeMetrics = this.#regimeAnalyzer.analyzeRegime(metrics, isTransitionConfirmed);
        this.#latestRegimeMetrics = regimeMetrics;
        const classificationEvent = {
            type: "regime:classification",
            iteration,
            regime: regimeMetrics.regime,
            cdpVariance: regimeMetrics.cdpVariance,
            correlationConsistency: regimeMetrics.correlationConsistency,
            persistenceIterations: regimeMetrics.persistenceIterations,
        };
        this.emit("regime:classification", classificationEvent);
        // Phase 7: System 1 override detection (entropy pair tracking)
        // Track the VNE/EE pair every iteration for early convergence analysis.
        this.#regimeValidator.trackEntropyPair(vne, ee, iteration);
        // Check for System 1 override: semantic convergence before structural development.
        const earlyConvergence = this.#regimeValidator.detectEarlyConvergence();
        if (earlyConvergence.detected) {
            const s1Event = {
                type: "soc:system1-early-convergence",
                iteration,
                eeVariance: earlyConvergence.eeVariance,
                vneSlope: earlyConvergence.vneSlope,
                timestamp: Date.now(),
            };
            this.emit("soc:system1-early-convergence", s1Event);
        }
        return metrics;
    }
    // ---------------------------------------------------------------------------
    // Phase 6 public methods
    // ---------------------------------------------------------------------------
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
    updateH1Dimension(h1Dimension) {
        this.#currentH1Dimension = h1Dimension;
    }
    /**
     * getRegimeMetrics — returns the most recent regime analysis.
     *
     * Returns undefined if computeAndEmit() has never been called.
     */
    getRegimeMetrics() {
        return this.#latestRegimeMetrics;
    }
    /**
     * getCurrentRegime — returns the current regime stability classification.
     *
     * Returns 'nascent' before computeAndEmit() is first called.
     */
    getCurrentRegime() {
        return this.#regimeAnalyzer.getCurrentRegime();
    }
    // ---------------------------------------------------------------------------
    // #computeSurprisingEdgeRatio — per-iteration surprising edge computation
    // ---------------------------------------------------------------------------
    /**
     * Computes the surprising edge ratio for this iteration.
     *
     * An edge is "surprising" IFF ALL of these hold:
     *   (a) createdAtIteration === inputs.iteration (per-iteration isolation)
     *   (b) source and target are in different communities (cross-community)
     *   (c) cosineSimilarity(embeddings[source], embeddings[target]) < threshold
     *
     * Returns 0 if no new edges this iteration (avoids division by zero).
     *
     * Pitfall 3 guard: edges created in prior iterations are excluded from the
     * per-iteration ratio. Only edges tagged with the current iteration are counted.
     */
    #computeSurprisingEdgeRatio(_inputs, embeddings, communityAssignments, newEdges, currentIteration) {
        // Filter to current iteration only (Pitfall 3 guard)
        const currentEdges = newEdges.filter((e) => e.createdAtIteration === currentIteration);
        if (currentEdges.length === 0)
            return 0;
        const threshold = this.#config.surprisingEdgeSimilarityThreshold;
        let surprisingCount = 0;
        for (const edge of currentEdges) {
            const sourceCommunity = communityAssignments.get(edge.source);
            const targetCommunity = communityAssignments.get(edge.target);
            // Criterion (b): cross-community check
            if (sourceCommunity === undefined || targetCommunity === undefined)
                continue;
            if (sourceCommunity === targetCommunity)
                continue; // intra-community → not surprising
            // Criterion (c): semantic similarity check
            const sourceEmb = embeddings.get(edge.source);
            const targetEmb = embeddings.get(edge.target);
            if (sourceEmb === undefined || targetEmb === undefined)
                continue;
            const similarity = cosineSimilarity(sourceEmb, targetEmb);
            if (similarity < threshold) {
                surprisingCount++;
            }
        }
        return surprisingCount / currentEdges.length;
    }
    // ---------------------------------------------------------------------------
    // History access methods
    // ---------------------------------------------------------------------------
    /**
     * getMetricsHistory() — returns the full SOCMetrics time series.
     *
     * Returns a defensive frozen copy (same pattern as LCM ImmutableStore.getAll()).
     * Each call returns a new array, so mutations to the returned array do not
     * affect the internal history.
     */
    getMetricsHistory() {
        return Object.freeze([...this.#history]);
    }
    /**
     * getLatestMetrics() — returns the most recently computed SOCMetrics.
     *
     * Returns undefined if computeAndEmit() has never been called.
     */
    getLatestMetrics() {
        return this.#history[this.#history.length - 1];
    }
    /**
     * getMetricsTrend(window?) — compute mean and OLS slope of vonNeumannEntropy.
     *
     * Uses the last `window` iterations (default: config.trendWindowSize).
     * If fewer iterations have been recorded, uses all available history.
     *
     * @param window - Number of recent iterations to include. Defaults to config.trendWindowSize.
     * @returns MetricsTrend with mean, slope, and actual window size used.
     */
    getMetricsTrend(window) {
        const w = window ?? this.#config.trendWindowSize;
        const slice = this.#history.slice(-w);
        const values = slice.map((m) => m.vonNeumannEntropy);
        const actualWindow = values.length;
        if (actualWindow === 0) {
            return { mean: 0, slope: 0, window: 0 };
        }
        const mean = values.reduce((acc, v) => acc + v, 0) / actualWindow;
        const slope = linearSlope(values);
        return { mean, slope, window: actualWindow };
    }
}
//# sourceMappingURL=SOCTracker.js.map