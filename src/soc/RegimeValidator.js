/**
 * RegimeValidator.ts
 *
 * Phase 6 SOC enhancements: SOC-06 (RegimeValidator) and SOC-07 (RegimeAnalyzer).
 *
 * RegimeValidator — validates that a phase transition candidate is genuine, not noise.
 *   Three-gate check: persistence + coherence + H^1 dimension gating.
 *
 * RegimeAnalyzer — classifies system stability into four states:
 *   nascent | stable | critical | transitioning
 *
 * Isolation: ZERO imports from tna/, lcm/, orchestrator/, or sheaf/.
 * Only imports from sibling soc/interfaces.ts.
 */
import { linearSlope } from "./correlation.js";
// ---------------------------------------------------------------------------
// Private math helpers
// ---------------------------------------------------------------------------
function variance(values) {
    if (values.length < 2)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return (values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1));
}
function stdDev(values) {
    return Math.sqrt(variance(values));
}
// ---------------------------------------------------------------------------
// Default configurations
// ---------------------------------------------------------------------------
const DEFAULT_VALIDATOR_CONFIG = {
    persistenceWindow: 3,
    coherenceThreshold: 0.6,
    h1DimensionThreshold: 2,
};
const DEFAULT_ANALYZER_CONFIG = {
    analysisWindowSize: 10,
    persistenceThreshold: 5,
    criticalCdpVariance: 0.5,
    stableCdpVariance: 0.2,
    criticalCorrelationStdDev: 0.8,
    stableCorrelationStdDev: 0.3,
};
// ---------------------------------------------------------------------------
// RegimeValidator class (SOC-06)
// ---------------------------------------------------------------------------
/**
 * RegimeValidator — validates phase transition candidates using three gates:
 *
 * Gate 1 (Persistence): The correlation sign change must persist for N consecutive
 *   iterations (default: 3) before being considered for confirmation.
 *
 * Gate 2 (Coherence): Within the persistence window, count_same_sign / window_size
 *   must be >= coherenceThreshold (default: 0.6). Prevents noisy sign flip confirmation.
 *
 * Gate 3 (H^1 gating): The Sheaf H^1 dimension must be >= h1DimensionThreshold
 *   (default: 2) at the time of validation. Ensures topological support.
 *
 * Usage:
 *   const validator = new RegimeValidator();
 *   validator.trackCorrelation(r, iteration);
 *   const { confirmed, coherence } = validator.validateTransition(h1Dim, iteration);
 */
export class RegimeValidator {
    #config;
    /** Rolling window of correlation sign values (+1, -1, or 0). */
    #signHistory = [];
    /** Start iteration of the current transition candidate (null if none active). */
    #candidateStartIteration = null;
    /** Sign direction of the current candidate. */
    #candidateSign = 0;
    /** Last sign recorded (for detecting sign changes). */
    #lastSign = 0;
    /** Last confirmed transition iteration (for duplicate suppression). */
    #lastConfirmedIteration = null;
    // ---- System 1 override detection (early convergence) ----
    /**
     * Rolling history of entropy pairs (VNE, EE) per iteration.
     * Used to detect when embedding entropy stabilizes while structural
     * complexity is still growing — the mathematical signature of
     * "conclusion precedes logic" (System 1 override).
     */
    #entropyPairs = [];
    /** Maximum entropy pair history size (2x early convergence window). */
    #maxEntropyHistory = 20;
    /** Minimum EE variance below which we consider semantics "converged". Default: 0.01 */
    #eeStabilizationThreshold;
    /** Minimum VNE slope above which structure is still "growing". Default: 0.05 */
    #vneGrowthThreshold;
    /** Minimum iterations before early convergence detection activates. Default: 5 */
    #earlyConvergenceMinIterations;
    constructor(config = {}) {
        this.#config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };
        this.#eeStabilizationThreshold = config.eeStabilizationThreshold ?? 0.01;
        this.#vneGrowthThreshold = config.vneGrowthThreshold ?? 0.05;
        this.#earlyConvergenceMinIterations = config.earlyConvergenceMinIterations ?? 5;
    }
    /**
     * trackCorrelation — record the sign of the current correlation coefficient.
     *
     * Detects sign changes and starts a new candidate if a sign change is observed.
     * History is trimmed to 2x persistenceWindow to avoid unbounded growth.
     *
     * @param correlationCoefficient - Pearson correlation from SOCTracker.
     * @param iteration - Current iteration number.
     */
    trackCorrelation(correlationCoefficient, iteration) {
        const currentSign = Math.sign(correlationCoefficient);
        this.#signHistory.push(currentSign);
        // Trim history to 2x persistence window
        const maxHistory = this.#config.persistenceWindow * 2;
        if (this.#signHistory.length > maxHistory) {
            this.#signHistory.shift();
        }
        // Detect sign change (from meaningful non-zero sign to different non-zero sign)
        if (this.#lastSign !== 0 &&
            currentSign !== 0 &&
            currentSign !== this.#lastSign) {
            // Start a new transition candidate
            this.#candidateStartIteration = iteration;
            this.#candidateSign = currentSign;
        }
        this.#lastSign = currentSign;
        void iteration; // used only for candidate start tracking
    }
    /**
     * validateTransition — check whether the current candidate should be confirmed.
     *
     * All three gates must pass simultaneously:
     *   1. Persistence: iterations since candidate start >= persistenceWindow
     *   2. Coherence: fraction of last N signs matching candidate sign >= coherenceThreshold
     *   3. H^1 gating: h1Dimension >= h1DimensionThreshold
     *
     * @param h1Dimension - Current H^1 dimension from Sheaf analysis.
     * @param iteration - Current iteration number.
     * @returns { confirmed: boolean; coherence: number }
     */
    validateTransition(h1Dimension, iteration) {
        if (this.#candidateStartIteration === null) {
            return { confirmed: false, coherence: 0 };
        }
        const iterationsSinceCandidate = iteration - this.#candidateStartIteration;
        // Gate 1: Persistence check
        if (iterationsSinceCandidate < this.#config.persistenceWindow) {
            return { confirmed: false, coherence: 0 };
        }
        // Gate 2: Coherence check
        const window = this.#config.persistenceWindow;
        const recentSigns = this.#signHistory.slice(-window);
        const sameSignCount = recentSigns.filter((s) => s === this.#candidateSign).length;
        const coherence = recentSigns.length > 0 ? sameSignCount / recentSigns.length : 0;
        if (coherence < this.#config.coherenceThreshold) {
            return { confirmed: false, coherence };
        }
        // Gate 3: H^1 gating
        if (h1Dimension < this.#config.h1DimensionThreshold) {
            return { confirmed: false, coherence };
        }
        // Duplicate suppression: don't confirm same transition twice
        if (this.#lastConfirmedIteration === iteration) {
            return { confirmed: false, coherence };
        }
        // All gates passed — confirm the transition
        this.#lastConfirmedIteration = iteration;
        this.#candidateStartIteration = null;
        return { confirmed: true, coherence };
    }
    /**
     * getSignHistory — returns defensive copy of recorded sign values.
     */
    getSignHistory() {
        return [...this.#signHistory];
    }
    /**
     * getCurrentCandidate — returns current transition candidate state.
     */
    getCurrentCandidate() {
        return {
            startIteration: this.#candidateStartIteration,
            sign: this.#candidateSign,
        };
    }
    // -------------------------------------------------------------------------
    // System 1 Override Detection (Early Convergence)
    // -------------------------------------------------------------------------
    /**
     * trackEntropyPair — record VNE and EE for this iteration.
     *
     * Called by SOCTracker.computeAndEmit() every iteration.
     * Maintains a rolling window for early convergence analysis.
     *
     * @param vne - Von Neumann entropy (structural complexity) for this iteration.
     * @param ee  - Embedding entropy (semantic diversity) for this iteration.
     * @param iteration - Current iteration number.
     */
    trackEntropyPair(vne, ee, iteration) {
        this.#entropyPairs.push({ vne, ee, iteration });
        if (this.#entropyPairs.length > this.#maxEntropyHistory) {
            this.#entropyPairs.shift();
        }
    }
    /**
     * detectEarlyConvergence — check for System 1 override pattern.
     *
     * The mathematical signature of "conclusion precedes logic":
     *   - Embedding entropy (semantic space) has STABILIZED: variance(EE) < threshold.
     *     This means the model has already converged on a semantic cluster — it "knows"
     *     its answer before the reasoning has developed.
     *   - Von Neumann entropy (structural complexity) is still GROWING: slope(VNE) > threshold.
     *     This means new graph topology is being built, but the semantic conclusion
     *     was predetermined — the structure is post-hoc rationalization.
     *
     * In Markov chain terms: the embedding entropy reaching equilibrium before
     * structural entropy indicates the system has collapsed to a low-dimensional
     * attractor in semantic space — a weakly lumpable state that only works for
     * the specific distribution the model has already committed to.
     *
     * @param windowSize - Number of recent entropy pairs to analyze. Default: 5.
     * @returns { detected: boolean; eeVariance: number; vneSlope: number }
     */
    detectEarlyConvergence(windowSize = 5) {
        if (this.#entropyPairs.length < Math.max(windowSize, this.#earlyConvergenceMinIterations)) {
            return { detected: false, eeVariance: NaN, vneSlope: NaN };
        }
        const recent = this.#entropyPairs.slice(-windowSize);
        const eeValues = recent.map((p) => p.ee);
        const vneValues = recent.map((p) => p.vne);
        // Compute EE variance — low variance means semantic space has converged
        const eeVariance = variance(eeValues);
        // Compute VNE slope — positive slope means structure is still growing
        const vneSlope = linearSlope(vneValues);
        // System 1 override detected when:
        //   (a) semantic space has converged (low EE variance)
        //   (b) structural complexity is still developing (positive VNE slope)
        const detected = eeVariance < this.#eeStabilizationThreshold &&
            vneSlope > this.#vneGrowthThreshold;
        return { detected, eeVariance, vneSlope };
    }
    /**
     * getEntropyPairs — returns defensive copy of entropy pair history.
     */
    getEntropyPairs() {
        return [...this.#entropyPairs];
    }
}
// ---------------------------------------------------------------------------
// RegimeAnalyzer class (SOC-07)
// ---------------------------------------------------------------------------
/**
 * RegimeAnalyzer — classifies the current operating regime into four states.
 *
 * Classification logic:
 *   - 'transitioning': isTransitioning flag is set (sign change just detected)
 *   - 'nascent':       persistence < persistenceThreshold (insufficient data)
 *   - 'critical':      cdpVariance > criticalCdpVariance OR corrStdDev > criticalCorrelationStdDev
 *   - 'stable':        cdpVariance < stableCdpVariance AND corrStdDev < stableCorrelationStdDev
 *   - 'nascent':       default (insufficient evidence for stable or critical)
 *
 * Usage:
 *   const analyzer = new RegimeAnalyzer();
 *   const regimeMetrics = analyzer.analyzeRegime(metrics, isTransitioning);
 */
export class RegimeAnalyzer {
    #config;
    #currentRegime = "nascent";
    #regimeStartIteration = 0;
    #metricsWindow = [];
    /** Total number of analyzeRegime() calls made. Used for initial nascent detection. */
    #totalIterations = 0;
    constructor(config = {}) {
        this.#config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
    }
    /**
     * analyzeRegime — compute regime metrics for the current iteration.
     *
     * @param metrics - Current SOCMetrics from SOCTracker.
     * @param isTransitioning - True if a phase transition candidate was just detected.
     * @returns RegimeMetrics with classification and supporting statistics.
     */
    analyzeRegime(metrics, isTransitioning) {
        // Update rolling window
        this.#metricsWindow.push(metrics);
        if (this.#metricsWindow.length > this.#config.analysisWindowSize) {
            this.#metricsWindow.shift();
        }
        // Track total calls for initial nascent detection
        this.#totalIterations++;
        // Compute metrics
        const cdpValues = this.#metricsWindow.map((m) => m.cdp);
        const corrValues = this.#metricsWindow.map((m) => m.correlationCoefficient);
        const cdpVariance = variance(cdpValues);
        const correlationConsistency = stdDev(corrValues);
        // Persistence: how many iterations since the system entered the current regime.
        // Uses metrics.iteration - #regimeStartIteration for consistent tracking.
        const persistenceIterations = metrics.iteration - this.#regimeStartIteration;
        // Classify regime
        const newRegime = this.#classifyRegime(cdpVariance, correlationConsistency, persistenceIterations, isTransitioning);
        // If regime changed, reset persistence counter.
        // When transitioning OUT of 'nascent' (to stable/critical/transitioning),
        // mark the regime start at the current iteration so persistence resets correctly.
        if (newRegime !== this.#currentRegime) {
            this.#currentRegime = newRegime;
            this.#regimeStartIteration = metrics.iteration;
        }
        return {
            regime: this.#currentRegime,
            cdpVariance,
            correlationConsistency,
            persistenceIterations,
            iteration: metrics.iteration,
        };
    }
    /**
     * #classifyRegime — determine the regime based on computed statistics.
     */
    #classifyRegime(cdpVariance, corrConsistency, persistence, isTransitioning) {
        // Priority 1: Transitioning (transient state for sign changes)
        if (isTransitioning)
            return "transitioning";
        // Priority 2: Nascent — only applies while still in initial 'nascent' regime.
        // Once the system has graduated to stable/critical/transitioning, the persistence
        // check no longer blocks classification. 'nascent' can only re-appear as a default
        // when metrics are ambiguous (between stable and critical thresholds).
        if (this.#currentRegime === "nascent" &&
            persistence < this.#config.persistenceThreshold) {
            return "nascent";
        }
        // Priority 3: Critical (high instability markers)
        if (cdpVariance > this.#config.criticalCdpVariance ||
            corrConsistency > this.#config.criticalCorrelationStdDev) {
            return "critical";
        }
        // Priority 4: Stable (low variance, consistent correlation)
        if (cdpVariance < this.#config.stableCdpVariance &&
            corrConsistency < this.#config.stableCorrelationStdDev) {
            return "stable";
        }
        // Default: nascent (insufficient evidence for stable or critical after data warmup)
        return "nascent";
    }
    /**
     * getCurrentRegime — returns the current regime stability classification.
     */
    getCurrentRegime() {
        return this.#currentRegime;
    }
    /**
     * getMetricsWindow — returns defensive copy of the current metrics window.
     */
    getMetricsWindow() {
        return [...this.#metricsWindow];
    }
}
//# sourceMappingURL=RegimeValidator.js.map