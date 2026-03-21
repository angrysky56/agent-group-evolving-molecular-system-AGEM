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
import type { RegimeValidatorConfig, RegimeAnalyzerConfig, RegimeStability, RegimeMetrics, SOCMetrics } from "./interfaces.js";
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
export declare class RegimeValidator {
    #private;
    constructor(config?: Partial<RegimeValidatorConfig> & {
        eeStabilizationThreshold?: number;
        vneGrowthThreshold?: number;
        earlyConvergenceMinIterations?: number;
    });
    /**
     * trackCorrelation — record the sign of the current correlation coefficient.
     *
     * Detects sign changes and starts a new candidate if a sign change is observed.
     * History is trimmed to 2x persistenceWindow to avoid unbounded growth.
     *
     * @param correlationCoefficient - Pearson correlation from SOCTracker.
     * @param iteration - Current iteration number.
     */
    trackCorrelation(correlationCoefficient: number, iteration: number): void;
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
    validateTransition(h1Dimension: number, iteration: number): {
        confirmed: boolean;
        coherence: number;
    };
    /**
     * getSignHistory — returns defensive copy of recorded sign values.
     */
    getSignHistory(): ReadonlyArray<number>;
    /**
     * getCurrentCandidate — returns current transition candidate state.
     */
    getCurrentCandidate(): {
        startIteration: number | null;
        sign: number;
    };
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
    trackEntropyPair(vne: number, ee: number, iteration: number): void;
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
    detectEarlyConvergence(windowSize?: number): {
        detected: boolean;
        eeVariance: number;
        vneSlope: number;
    };
    /**
     * getEntropyPairs — returns defensive copy of entropy pair history.
     */
    getEntropyPairs(): ReadonlyArray<{
        vne: number;
        ee: number;
        iteration: number;
    }>;
}
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
export declare class RegimeAnalyzer {
    #private;
    constructor(config?: Partial<RegimeAnalyzerConfig>);
    /**
     * analyzeRegime — compute regime metrics for the current iteration.
     *
     * @param metrics - Current SOCMetrics from SOCTracker.
     * @param isTransitioning - True if a phase transition candidate was just detected.
     * @returns RegimeMetrics with classification and supporting statistics.
     */
    analyzeRegime(metrics: SOCMetrics, isTransitioning: boolean): RegimeMetrics;
    /**
     * getCurrentRegime — returns the current regime stability classification.
     */
    getCurrentRegime(): RegimeStability;
    /**
     * getMetricsWindow — returns defensive copy of the current metrics window.
     */
    getMetricsWindow(): ReadonlyArray<SOCMetrics>;
}
//# sourceMappingURL=RegimeValidator.d.ts.map