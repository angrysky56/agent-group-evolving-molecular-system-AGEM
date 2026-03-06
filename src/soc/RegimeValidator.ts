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

import type {
  RegimeValidatorConfig,
  RegimeAnalyzerConfig,
  RegimeStability,
  RegimeMetrics,
  SOCMetrics,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// Private math helpers
// ---------------------------------------------------------------------------

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
}

function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

// ---------------------------------------------------------------------------
// Default configurations
// ---------------------------------------------------------------------------

const DEFAULT_VALIDATOR_CONFIG: RegimeValidatorConfig = {
  persistenceWindow: 3,
  coherenceThreshold: 0.6,
  h1DimensionThreshold: 2,
};

const DEFAULT_ANALYZER_CONFIG: RegimeAnalyzerConfig = {
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
  readonly #config: RegimeValidatorConfig;

  /** Rolling window of correlation sign values (+1, -1, or 0). */
  #signHistory: number[] = [];

  /** Start iteration of the current transition candidate (null if none active). */
  #candidateStartIteration: number | null = null;

  /** Sign direction of the current candidate. */
  #candidateSign: number = 0;

  /** Last sign recorded (for detecting sign changes). */
  #lastSign: number = 0;

  /** Last confirmed transition iteration (for duplicate suppression). */
  #lastConfirmedIteration: number | null = null;

  constructor(config: Partial<RegimeValidatorConfig> = {}) {
    this.#config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };
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
  trackCorrelation(correlationCoefficient: number, iteration: number): void {
    const currentSign = Math.sign(correlationCoefficient);
    this.#signHistory.push(currentSign);

    // Trim history to 2x persistence window
    const maxHistory = this.#config.persistenceWindow * 2;
    if (this.#signHistory.length > maxHistory) {
      this.#signHistory.shift();
    }

    // Detect sign change (from meaningful non-zero sign to different non-zero sign)
    if (
      this.#lastSign !== 0 &&
      currentSign !== 0 &&
      currentSign !== this.#lastSign
    ) {
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
  validateTransition(
    h1Dimension: number,
    iteration: number
  ): { confirmed: boolean; coherence: number } {
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
    const sameSignCount = recentSigns.filter(s => s === this.#candidateSign).length;
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
  getSignHistory(): ReadonlyArray<number> {
    return [...this.#signHistory];
  }

  /**
   * getCurrentCandidate — returns current transition candidate state.
   */
  getCurrentCandidate(): { startIteration: number | null; sign: number } {
    return {
      startIteration: this.#candidateStartIteration,
      sign: this.#candidateSign,
    };
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
  readonly #config: RegimeAnalyzerConfig;
  #currentRegime: RegimeStability = 'nascent';
  #regimeStartIteration: number = 0;
  #metricsWindow: SOCMetrics[] = [];

  constructor(config: Partial<RegimeAnalyzerConfig> = {}) {
    this.#config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
  }

  /**
   * analyzeRegime — compute regime metrics for the current iteration.
   *
   * @param metrics - Current SOCMetrics from SOCTracker.
   * @param isTransitioning - True if a phase transition candidate was just detected.
   * @returns RegimeMetrics with classification and supporting statistics.
   */
  analyzeRegime(metrics: SOCMetrics, isTransitioning: boolean): RegimeMetrics {
    // Update rolling window
    this.#metricsWindow.push(metrics);
    if (this.#metricsWindow.length > this.#config.analysisWindowSize) {
      this.#metricsWindow.shift();
    }

    // Compute metrics
    const cdpValues = this.#metricsWindow.map(m => m.cdp);
    const corrValues = this.#metricsWindow.map(m => m.correlationCoefficient);
    const cdpVariance = variance(cdpValues);
    const correlationConsistency = stdDev(corrValues);
    const persistenceIterations = metrics.iteration - this.#regimeStartIteration;

    // Classify regime
    const newRegime = this.#classifyRegime(
      cdpVariance,
      correlationConsistency,
      persistenceIterations,
      isTransitioning
    );

    // If regime changed, reset persistence counter
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
  #classifyRegime(
    cdpVariance: number,
    corrConsistency: number,
    persistence: number,
    isTransitioning: boolean
  ): RegimeStability {
    // Priority 1: Transitioning (transient state for sign changes)
    if (isTransitioning) return 'transitioning';

    // Priority 2: Nascent (insufficient history)
    if (persistence < this.#config.persistenceThreshold) return 'nascent';

    // Priority 3: Critical (high instability markers)
    if (
      cdpVariance > this.#config.criticalCdpVariance ||
      corrConsistency > this.#config.criticalCorrelationStdDev
    ) {
      return 'critical';
    }

    // Priority 4: Stable (low variance, consistent correlation)
    if (
      cdpVariance < this.#config.stableCdpVariance &&
      corrConsistency < this.#config.stableCorrelationStdDev
    ) {
      return 'stable';
    }

    // Default: nascent (insufficient evidence for stable or critical)
    return 'nascent';
  }

  /**
   * getCurrentRegime — returns the current regime stability classification.
   */
  getCurrentRegime(): RegimeStability {
    return this.#currentRegime;
  }

  /**
   * getMetricsWindow — returns defensive copy of the current metrics window.
   */
  getMetricsWindow(): ReadonlyArray<SOCMetrics> {
    return [...this.#metricsWindow];
  }
}
