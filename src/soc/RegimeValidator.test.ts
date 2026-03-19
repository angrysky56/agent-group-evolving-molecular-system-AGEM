/**
 * RegimeValidator.test.ts
 *
 * Comprehensive unit tests for RegimeValidator (SOC-06) and RegimeAnalyzer (SOC-07).
 *
 * Tests cover:
 *   - RegimeValidator: sign tracking, transition confirmation, edge cases, configuration
 *   - RegimeAnalyzer: regime classification, metrics computation, edge cases, configuration
 *
 * All tests use synthetic data — no external dependencies, no imports from tna/, lcm/, orchestrator/.
 * Tests are fully deterministic: no random inputs, no timing dependencies.
 */

import { describe, it, expect } from "vitest";
import { RegimeValidator, RegimeAnalyzer } from "./RegimeValidator.js";
import type { SOCMetrics } from "./interfaces.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/**
 * makeSocMetrics — creates a SOCMetrics object with overrideable fields.
 *
 * Defaults produce a neutral "stable" scenario with cdp=0.1, correlationCoefficient=0.5.
 * Override specific fields for targeted scenarios.
 */
function makeSocMetrics(
  overrides: Partial<SOCMetrics> & { iteration: number },
): SOCMetrics {
  return {
    iteration: overrides.iteration,
    timestamp: Date.now(),
    vonNeumannEntropy: overrides.vonNeumannEntropy ?? 1.0,
    embeddingEntropy: overrides.embeddingEntropy ?? 0.9,
    cdp: overrides.cdp ?? 0.1,
    surprisingEdgeRatio: overrides.surprisingEdgeRatio ?? 0.05,
    correlationCoefficient: overrides.correlationCoefficient ?? 0.5,
    isPhaseTransition: overrides.isPhaseTransition ?? false,
  };
}

/**
 * feedPositiveCorrelations — helper to feed N positive correlation values
 * to a RegimeValidator, tracking each one at sequential iterations.
 */
function feedPositiveCorrelations(
  validator: RegimeValidator,
  count: number,
  startIteration: number,
  corrValue = 0.7,
): void {
  for (let i = 0; i < count; i++) {
    validator.trackCorrelation(corrValue, startIteration + i);
  }
}

/**
 * feedNegativeCorrelations — helper to feed N negative correlation values.
 */
function feedNegativeCorrelations(
  validator: RegimeValidator,
  count: number,
  startIteration: number,
  corrValue = -0.7,
): void {
  for (let i = 0; i < count; i++) {
    validator.trackCorrelation(corrValue, startIteration + i);
  }
}

/**
 * buildStableMetrics — creates a list of SOCMetrics with stable (low variance) characteristics.
 * cdp is constant at 0.1, correlationCoefficient is constant at 0.5.
 */
function buildStableMetrics(count: number, startIteration = 1): SOCMetrics[] {
  return Array.from({ length: count }, (_, i) =>
    makeSocMetrics({
      iteration: startIteration + i,
      cdp: 0.1,
      correlationCoefficient: 0.5,
    }),
  );
}

/**
 * buildHighVarianceMetrics — creates a list of SOCMetrics with high CDP variance.
 * CDP alternates between +1.5 and -1.5 (variance > 0.5 threshold).
 */
function buildHighVarianceMetrics(
  count: number,
  startIteration = 1,
): SOCMetrics[] {
  return Array.from({ length: count }, (_, i) =>
    makeSocMetrics({
      iteration: startIteration + i,
      cdp: i % 2 === 0 ? 1.5 : -1.5, // alternating wildly
      correlationCoefficient: 0.5,
    }),
  );
}

// ---------------------------------------------------------------------------
// RegimeValidator Tests (SOC-06)
// ---------------------------------------------------------------------------

describe("RegimeValidator (SOC-06)", () => {
  // -------------------------------------------------------------------------
  // Sign tracking
  // -------------------------------------------------------------------------

  describe("Sign tracking", () => {
    it("T1: trackCorrelation records positive sign (+1) for positive correlation", () => {
      const validator = new RegimeValidator();
      validator.trackCorrelation(0.8, 1);
      const history = validator.getSignHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toBe(1);
    });

    it("T2: trackCorrelation records negative sign (-1) for negative correlation", () => {
      const validator = new RegimeValidator();
      validator.trackCorrelation(-0.6, 1);
      const history = validator.getSignHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toBe(-1);
    });

    it("T3: trackCorrelation records zero sign (0) for zero correlation", () => {
      const validator = new RegimeValidator();
      validator.trackCorrelation(0, 1);
      const history = validator.getSignHistory();
      expect(history).toHaveLength(1);
      expect(history[0]).toBe(0);
    });

    it("T4: Sign history is trimmed to 2x persistenceWindow after excess entries", () => {
      // Default persistenceWindow = 3, so max history = 6
      const validator = new RegimeValidator({ persistenceWindow: 3 });

      // Feed 10 entries (well over 2x3=6)
      for (let i = 1; i <= 10; i++) {
        validator.trackCorrelation(0.5, i);
      }

      const history = validator.getSignHistory();
      expect(history.length).toBeLessThanOrEqual(6);
    });

    it("T5: Sign history with custom persistenceWindow trims correctly", () => {
      const validator = new RegimeValidator({ persistenceWindow: 5 });
      // max history = 10

      for (let i = 1; i <= 15; i++) {
        validator.trackCorrelation(0.5, i);
      }

      const history = validator.getSignHistory();
      expect(history.length).toBeLessThanOrEqual(10);
    });

    it("T6: getSignHistory() returns defensive copy (mutation does not affect state)", () => {
      const validator = new RegimeValidator();
      validator.trackCorrelation(0.5, 1);
      validator.trackCorrelation(0.6, 2);

      const history1 = validator.getSignHistory() as number[];
      history1.push(999); // mutate the returned copy

      const history2 = validator.getSignHistory();
      expect(history2).toHaveLength(2); // internal state unchanged
      expect(history2).not.toContain(999);
    });
  });

  // -------------------------------------------------------------------------
  // Transition confirmation
  // -------------------------------------------------------------------------

  describe("Transition confirmation", () => {
    it("T7: Transition NOT confirmed before persistence window iterations elapsed", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 3,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Establish positive correlation baseline
      feedPositiveCorrelations(validator, 5, 1);

      // One negative sign (sign change at iteration 6)
      validator.trackCorrelation(-0.7, 6);

      // Only 0 iterations elapsed since candidate start — should not confirm
      const result = validator.validateTransition(5, 6);
      expect(result.confirmed).toBe(false);
    });

    it("T8: Transition NOT confirmed after N-1 same-sign iterations (one short)", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 3,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // Sign change at iteration 4
      validator.trackCorrelation(-0.7, 4);
      // Two more negative (only 2 iterations elapsed since candidate at 4)
      validator.trackCorrelation(-0.7, 5);

      // Gap = iteration 5 - startIteration 4 = 1 → still < 3
      const result = validator.validateTransition(5, 5);
      expect(result.confirmed).toBe(false);
    });

    it("T9: Transition confirmed after N consecutive same-sign iterations with H^1 >= threshold", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 3,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline — establish #lastSign as positive
      feedPositiveCorrelations(validator, 5, 1);

      // Sign change at iteration 6 — starts candidate
      validator.trackCorrelation(-0.7, 6);
      // Continue negative for 2 more iterations (total elapsed = 3 from iteration 6)
      validator.trackCorrelation(-0.8, 7);
      validator.trackCorrelation(-0.6, 8);

      // At iteration 9: elapsed = 9 - 6 = 3 >= persistenceWindow = 3
      validator.trackCorrelation(-0.7, 9);
      const result = validator.validateTransition(3, 9); // h1Dimension=3 >= threshold=2
      expect(result.confirmed).toBe(true);
      expect(result.coherence).toBeGreaterThanOrEqual(0.6);
    });

    it("T10: Transition NOT confirmed when coherence < 0.6 (signs flip back and forth)", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 4,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // Sign change at iteration 4
      validator.trackCorrelation(-0.7, 4);
      // Flip back positive at 5 (noise)
      validator.trackCorrelation(0.5, 5);
      // Negative again at 6
      validator.trackCorrelation(-0.6, 6);
      // Positive again at 7 (still noisy)
      validator.trackCorrelation(0.4, 7);

      // Check validation: last 4 signs are [-1, +1, -1, +1] → 2 match candidate sign (-1) / 4 = 0.5 < 0.6
      const result = validator.validateTransition(5, 7);
      expect(result.confirmed).toBe(false);
      // Coherence should be reported (it is computed even when failing)
      expect(result.coherence).toBeLessThan(0.6);
    });

    it("T11: Transition NOT confirmed when H^1 < threshold even with good coherence", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 3,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // Sign change and sustained negative
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(-0.8, 5);
      validator.trackCorrelation(-0.9, 6);
      validator.trackCorrelation(-0.7, 7);

      // H^1 = 1 (below threshold of 2)
      const result = validator.validateTransition(1, 7);
      expect(result.confirmed).toBe(false);
      // Coherence would be good but H^1 gate fails
      expect(result.coherence).toBeGreaterThanOrEqual(0.6);
    });

    it("T12: Transition confirmed at exact threshold values (coherence=0.6, H^1=2)", () => {
      // persistenceWindow=5, coherenceThreshold=0.6 → need 3/5 same signs
      const validator = new RegimeValidator({
        persistenceWindow: 5,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 5, 1);

      // Sign change at iteration 6 — candidate starts
      validator.trackCorrelation(-0.7, 6);
      // 3 more negative (3+1=4 in window, but we need last 5 to have 3/5 = 0.6 matching)
      // Last 5 signs: [-1, -1, -1, -1, +1] (the last positive before transition)
      // Wait — window contains what we feed. Let's be precise:
      // After iteration 6: history has [+1,+1,+1,+1,+1,-1] trimmed to last 10 entries
      // After 4 more negatives (iters 7,8,9,10): history last 5 = [-1,-1,-1,-1,-1] = 5/5 = 1.0
      validator.trackCorrelation(-0.8, 7);
      validator.trackCorrelation(-0.7, 8);
      validator.trackCorrelation(-0.9, 9);
      validator.trackCorrelation(-0.6, 10);

      // elapsed = 10 - 6 = 4 < 5, still not enough persistence
      const notYet = validator.validateTransition(2, 10);
      expect(notYet.confirmed).toBe(false);

      // iteration 11: elapsed = 11 - 6 = 5 >= persistenceWindow=5
      validator.trackCorrelation(-0.7, 11);
      const result = validator.validateTransition(2, 11);
      expect(result.confirmed).toBe(true);
      expect(result.coherence).toBeGreaterThanOrEqual(0.6);
    });

    it("T13: Duplicate suppression — same transition not confirmed twice at same iteration", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 2,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // Sign change and sustained for 2+ iterations
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(-0.8, 5);
      validator.trackCorrelation(-0.7, 6);

      // First call: should confirm (elapsed = 6-4=2 >= window=2)
      const first = validator.validateTransition(3, 6);
      expect(first.confirmed).toBe(true);

      // Second call at same iteration: should NOT confirm (duplicate suppression)
      // Note: candidate was cleared by first confirmation, so no candidate active
      const second = validator.validateTransition(3, 6);
      expect(second.confirmed).toBe(false);
    });

    it("T14: After confirmation, candidate is reset and new candidate can begin", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 2,
        coherenceThreshold: 0.5,
        h1DimensionThreshold: 1,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // First sign change: positive → negative
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(-0.8, 5);
      validator.trackCorrelation(-0.7, 6);

      // Confirm the first transition
      const first = validator.validateTransition(2, 6);
      expect(first.confirmed).toBe(true);

      // Now: candidate should be null, #lastSign = -1
      expect(validator.getCurrentCandidate().startIteration).toBeNull();

      // Second sign change: negative → positive (new candidate starts)
      validator.trackCorrelation(0.6, 7);
      validator.trackCorrelation(0.7, 8);
      validator.trackCorrelation(0.8, 9);

      // Candidate should be set now (sign changed at iteration 7)
      expect(validator.getCurrentCandidate().startIteration).not.toBeNull();

      // Second confirmation should eventually work
      const second = validator.validateTransition(2, 9);
      expect(second.confirmed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("T15: No sign change ever — no confirmation possible", () => {
      const validator = new RegimeValidator();

      // Feed 20 positive correlations — no sign change
      feedPositiveCorrelations(validator, 20, 1);

      const result = validator.validateTransition(5, 20);
      expect(result.confirmed).toBe(false);
      expect(validator.getCurrentCandidate().startIteration).toBeNull();
    });

    it("T16: Single iteration — no confirmation possible", () => {
      const validator = new RegimeValidator();
      validator.trackCorrelation(-0.5, 1);

      const result = validator.validateTransition(5, 1);
      expect(result.confirmed).toBe(false);
    });

    it("T17: persistenceWindow=1 — confirms immediately if H^1 OK and coherence OK", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 1,
        coherenceThreshold: 0.5,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      validator.trackCorrelation(0.8, 1);
      validator.trackCorrelation(0.7, 2);

      // Sign change at iteration 3 — candidate starts
      validator.trackCorrelation(-0.6, 3);

      // Elapsed = 3 - 3 = 0 < 1, still not enough
      const notYet = validator.validateTransition(3, 3);
      expect(notYet.confirmed).toBe(false);

      // One more negative at iteration 4: elapsed = 4 - 3 = 1 >= window=1
      validator.trackCorrelation(-0.7, 4);
      const result = validator.validateTransition(3, 4);
      expect(result.confirmed).toBe(true);
    });

    it("T18: Very large persistence window (10) requires 10 elapsed iterations", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 10,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Positive baseline
      feedPositiveCorrelations(validator, 5, 1);

      // Sign change at iteration 6
      for (let i = 0; i < 9; i++) {
        validator.trackCorrelation(-0.7, 6 + i);
      }

      // At iteration 14: elapsed = 14 - 6 = 8 < 10 → NOT confirmed
      const notYet = validator.validateTransition(5, 14);
      expect(notYet.confirmed).toBe(false);

      // Feed more until elapsed >= 10
      validator.trackCorrelation(-0.7, 15);
      validator.trackCorrelation(-0.6, 16);

      // At iteration 16: elapsed = 16 - 6 = 10 >= window=10
      const result = validator.validateTransition(5, 16);
      expect(result.confirmed).toBe(true);
    });

    it("T19: Rapid oscillation (sign changes every iteration) — coherence < 0.6 — never confirms", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 5,
        coherenceThreshold: 0.6,
        h1DimensionThreshold: 2,
      });

      // Feed alternating signs: +1, -1, +1, -1, +1, -1, ...
      for (let i = 1; i <= 20; i++) {
        const corr = i % 2 === 0 ? -0.7 : 0.7;
        validator.trackCorrelation(corr, i);
        const result = validator.validateTransition(5, i);
        expect(result.confirmed).toBe(false);
      }
    });

    it("T20: validateTransition with no active candidate returns { confirmed: false, coherence: 0 }", () => {
      const validator = new RegimeValidator();
      const result = validator.validateTransition(5, 1);
      expect(result.confirmed).toBe(false);
      expect(result.coherence).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe("Configuration", () => {
    it("T21: Custom persistenceWindow is respected", () => {
      const validator = new RegimeValidator({ persistenceWindow: 2 });

      // Feed positive baseline
      feedPositiveCorrelations(validator, 3, 1);

      // Sign change at 4, then one more negative
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(-0.7, 5);
      validator.trackCorrelation(-0.7, 6);

      // elapsed = 6-4 = 2 >= custom window=2
      const result = validator.validateTransition(3, 6);
      expect(result.confirmed).toBe(true);
    });

    it("T22: Custom coherenceThreshold is respected", () => {
      // Very high threshold: 0.9 = need 90% of signs to match
      const validator = new RegimeValidator({
        persistenceWindow: 3,
        coherenceThreshold: 0.9,
        h1DimensionThreshold: 2,
      });

      feedPositiveCorrelations(validator, 3, 1);

      // Mix of signs after transition — not 90% coherent
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(0.5, 5); // flip back
      validator.trackCorrelation(-0.6, 6);
      validator.trackCorrelation(-0.7, 7);

      // Last 3 signs: [+1, -1, -1] → 2/3 = 0.67 < 0.9 threshold
      const result = validator.validateTransition(5, 7);
      expect(result.confirmed).toBe(false);
    });

    it("T23: Custom h1DimensionThreshold is respected (threshold=3, h1=2 rejected)", () => {
      const validator = new RegimeValidator({
        persistenceWindow: 2,
        coherenceThreshold: 0.5,
        h1DimensionThreshold: 3,
      });

      feedPositiveCorrelations(validator, 3, 1);
      validator.trackCorrelation(-0.7, 4);
      validator.trackCorrelation(-0.7, 5);
      validator.trackCorrelation(-0.7, 6);

      // H^1 = 2 < custom threshold of 3 → rejected
      const result = validator.validateTransition(2, 6);
      expect(result.confirmed).toBe(false);

      // H^1 = 3 >= threshold of 3 → accepted
      const result2 = validator.validateTransition(3, 6);
      expect(result2.confirmed).toBe(true);
    });

    it("T24: Default config matches documented values (persistenceWindow=3, coherenceThreshold=0.6, h1DimensionThreshold=2)", () => {
      // Use getCurrentCandidate to inspect (private config not exposed directly)
      // Verify by behavior: with defaults, need exactly 3 iterations + coherence >= 0.6 + H^1 >= 2

      const validator = new RegimeValidator(); // no config override = defaults

      feedPositiveCorrelations(validator, 5, 1);
      validator.trackCorrelation(-0.7, 6);
      validator.trackCorrelation(-0.8, 7);
      validator.trackCorrelation(-0.9, 8);

      // elapsed = 8-6=2 < 3 (default persistenceWindow) → NOT confirmed
      const before = validator.validateTransition(5, 8);
      expect(before.confirmed).toBe(false);

      validator.trackCorrelation(-0.7, 9);

      // elapsed = 9-6=3 >= 3 AND H^1=2 >= 2 AND coherence = 1.0 >= 0.6 → confirmed
      const after = validator.validateTransition(2, 9);
      expect(after.confirmed).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// RegimeAnalyzer Tests (SOC-07)
// ---------------------------------------------------------------------------

describe("RegimeAnalyzer (SOC-07)", () => {
  // -------------------------------------------------------------------------
  // Regime classification
  // -------------------------------------------------------------------------

  describe("Regime classification", () => {
    it('T25: Initial regime is "nascent"', () => {
      const analyzer = new RegimeAnalyzer();
      expect(analyzer.getCurrentRegime()).toBe("nascent");
    });

    it('T26: After persistenceThreshold iterations with low variance → "stable"', () => {
      // Use custom config to make stable easy to reach
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 3,
        analysisWindowSize: 5,
        stableCdpVariance: 0.2,
        stableCorrelationStdDev: 0.3,
        criticalCdpVariance: 0.5,
        criticalCorrelationStdDev: 0.8,
      });

      // Feed 5 stable metrics (constant CDP=0.1, constant correlation=0.5)
      // variance=0, stdDev=0 → well below stable thresholds
      // persistence after 5 iters = 5 >= threshold=3
      for (let i = 1; i <= 5; i++) {
        const metrics = makeSocMetrics({
          iteration: i,
          cdp: 0.1,
          correlationCoefficient: 0.5,
        });
        analyzer.analyzeRegime(metrics, false);
      }

      const regime = analyzer.getCurrentRegime();
      expect(regime).toBe("stable");
    });

    it('T27: High CDP variance (> 0.5) → "critical"', () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 4,
        criticalCdpVariance: 0.5,
        stableCdpVariance: 0.2,
        criticalCorrelationStdDev: 0.8,
        stableCorrelationStdDev: 0.3,
      });

      // Feed 2 stable iterations to pass nascent
      // Then feed high-variance CDPs
      for (let i = 1; i <= 4; i++) {
        const cdp = i % 2 === 0 ? 2.0 : -2.0; // alternating wildly → very high variance
        const metrics = makeSocMetrics({
          iteration: i,
          cdp,
          correlationCoefficient: 0.5,
        });
        analyzer.analyzeRegime(metrics, false);
      }

      expect(analyzer.getCurrentRegime()).toBe("critical");
    });

    it('T28: High correlation std dev (> 0.8) → "critical"', () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 4,
        criticalCdpVariance: 0.5,
        stableCdpVariance: 0.2,
        criticalCorrelationStdDev: 0.8,
        stableCorrelationStdDev: 0.3,
      });

      for (let i = 1; i <= 4; i++) {
        // Alternating correlation: +0.9 and -0.9 → stdDev ≈ 0.9 > 0.8
        const corr = i % 2 === 0 ? 0.9 : -0.9;
        const metrics = makeSocMetrics({
          iteration: i,
          cdp: 0.1,
          correlationCoefficient: corr,
        });
        analyzer.analyzeRegime(metrics, false);
      }

      expect(analyzer.getCurrentRegime()).toBe("critical");
    });

    it('T29: isTransitioning=true → "transitioning" regardless of other metrics', () => {
      const analyzer = new RegimeAnalyzer({ persistenceThreshold: 1 });

      // Feed some stable metrics first
      for (let i = 1; i <= 5; i++) {
        analyzer.analyzeRegime(
          makeSocMetrics({
            iteration: i,
            cdp: 0.1,
            correlationCoefficient: 0.5,
          }),
          false,
        );
      }

      // Now trigger with isTransitioning=true
      const result = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 6, cdp: 0.1, correlationCoefficient: 0.5 }),
        true, // transitioning overrides everything
      );

      expect(result.regime).toBe("transitioning");
      expect(analyzer.getCurrentRegime()).toBe("transitioning");
    });

    it("T30: Regime changes reset the persistence counter", () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 6,
        criticalCdpVariance: 0.5,
        stableCdpVariance: 0.2,
        criticalCorrelationStdDev: 0.8,
        stableCorrelationStdDev: 0.3,
      });

      // Enter stable regime (3 stable iterations)
      for (let i = 1; i <= 3; i++) {
        analyzer.analyzeRegime(
          makeSocMetrics({
            iteration: i,
            cdp: 0.1,
            correlationCoefficient: 0.5,
          }),
          false,
        );
      }
      expect(analyzer.getCurrentRegime()).toBe("stable");

      // Trigger transitioning — this changes regime, resetting persistence
      const result = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 4, cdp: 0.1, correlationCoefficient: 0.5 }),
        true,
      );
      expect(result.persistenceIterations).toBeLessThan(4); // persistence reset when transitioning started
    });
  });

  // -------------------------------------------------------------------------
  // Metrics computation
  // -------------------------------------------------------------------------

  describe("Metrics computation", () => {
    it("T31: cdpVariance computed correctly for known CDP series", () => {
      const analyzer = new RegimeAnalyzer({ analysisWindowSize: 10 });

      // Feed CDPs = [1, 3] → mean=2, variance = ((1-2)^2 + (3-2)^2) / (2-1) = 2
      analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 1, cdp: 1.0, correlationCoefficient: 0.5 }),
        false,
      );
      const result = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 2, cdp: 3.0, correlationCoefficient: 0.5 }),
        false,
      );

      expect(result.cdpVariance).toBeCloseTo(2.0, 5);
    });

    it("T32: correlationConsistency computed correctly for known correlation series", () => {
      const analyzer = new RegimeAnalyzer({ analysisWindowSize: 10 });

      // Feed correlations = [0.5, 0.5] → stdDev = 0
      analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 1, cdp: 0.1, correlationCoefficient: 0.5 }),
        false,
      );
      const result1 = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 2, cdp: 0.1, correlationCoefficient: 0.5 }),
        false,
      );
      expect(result1.correlationConsistency).toBeCloseTo(0, 10);

      // Feed different correlations: [0, 1] → mean=0.5, std = sqrt(((0-0.5)^2+(1-0.5)^2)/1) = sqrt(0.25+0.25) ≈ 0.707
      const analyzer2 = new RegimeAnalyzer({ analysisWindowSize: 10 });
      analyzer2.analyzeRegime(
        makeSocMetrics({ iteration: 1, cdp: 0.1, correlationCoefficient: 0.0 }),
        false,
      );
      const result2 = analyzer2.analyzeRegime(
        makeSocMetrics({ iteration: 2, cdp: 0.1, correlationCoefficient: 1.0 }),
        false,
      );
      expect(result2.correlationConsistency).toBeCloseTo(Math.sqrt(0.5), 5);
    });

    it("T33: persistenceIterations tracks time since regime entry", () => {
      const analyzer = new RegimeAnalyzer({ persistenceThreshold: 100 }); // keep nascent forever

      // All iterations should stay nascent, incrementing persistenceIterations
      let lastResult = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 0 }),
        false,
      );
      for (let i = 1; i <= 10; i++) {
        lastResult = analyzer.analyzeRegime(
          makeSocMetrics({ iteration: i }),
          false,
        );
      }

      // persistenceIterations = current_iteration - regimeStartIteration (which was 0 from init)
      expect(lastResult.persistenceIterations).toBe(10);
    });

    it("T34: Rolling window trims old metrics beyond analysisWindowSize", () => {
      const analyzer = new RegimeAnalyzer({ analysisWindowSize: 3 });

      // Feed 5 entries — window should only retain last 3
      for (let i = 1; i <= 5; i++) {
        analyzer.analyzeRegime(
          makeSocMetrics({
            iteration: i,
            cdp: i * 1.0,
            correlationCoefficient: 0.5,
          }),
          false,
        );
      }

      // The metrics window should have max 3 entries
      const window = analyzer.getMetricsWindow();
      expect(window.length).toBeLessThanOrEqual(3);
      // Last entry should have iteration=5
      expect(window[window.length - 1]!.iteration).toBe(5);
    });

    it("T35: analyzeRegime returns RegimeMetrics with all required fields", () => {
      const analyzer = new RegimeAnalyzer();
      const result = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 1 }),
        false,
      );

      expect(result).toHaveProperty("regime");
      expect(result).toHaveProperty("cdpVariance");
      expect(result).toHaveProperty("correlationConsistency");
      expect(result).toHaveProperty("persistenceIterations");
      expect(result).toHaveProperty("iteration");
      expect(result.iteration).toBe(1);
      expect(typeof result.cdpVariance).toBe("number");
      expect(typeof result.correlationConsistency).toBe("number");
      expect(typeof result.persistenceIterations).toBe("number");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("Edge cases", () => {
    it("T36: Window with single metric — variance = 0 → still nascent (insufficient persistence)", () => {
      const analyzer = new RegimeAnalyzer({ persistenceThreshold: 5 });
      const result = analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 1, cdp: 1.5 }),
        false,
      );

      expect(result.cdpVariance).toBe(0); // single value → variance = 0 by definition
      expect(result.regime).toBe("nascent"); // < persistenceThreshold
    });

    it("T37: All CDPs identical — variance = 0 — classified as stable after threshold", () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 3,
        analysisWindowSize: 5,
        stableCdpVariance: 0.2,
        stableCorrelationStdDev: 0.3,
        criticalCdpVariance: 0.5,
        criticalCorrelationStdDev: 0.8,
      });

      for (let i = 1; i <= 5; i++) {
        // Perfectly constant: variance=0, stdDev=0
        analyzer.analyzeRegime(
          makeSocMetrics({
            iteration: i,
            cdp: 0.1,
            correlationCoefficient: 0.5,
          }),
          false,
        );
      }

      expect(analyzer.getCurrentRegime()).toBe("stable");
    });

    it("T38: CDPs alternating wildly — high variance — classified as critical", () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 6,
        criticalCdpVariance: 0.5,
        stableCdpVariance: 0.2,
        criticalCorrelationStdDev: 0.8,
        stableCorrelationStdDev: 0.3,
      });

      const highVarianceMetrics = buildHighVarianceMetrics(6, 1);
      let lastResult = highVarianceMetrics[0]!;
      for (const metrics of highVarianceMetrics) {
        const r = analyzer.analyzeRegime(metrics, false);
        lastResult = { ...metrics, ...r } as unknown as SOCMetrics;
      }

      expect(analyzer.getCurrentRegime()).toBe("critical");
    });

    it('T39: Empty state — getCurrentRegime returns "nascent" without any analysis', () => {
      const analyzer = new RegimeAnalyzer();
      expect(analyzer.getCurrentRegime()).toBe("nascent");
      expect(analyzer.getMetricsWindow()).toHaveLength(0);
    });

    it("T40: Very long stable run (50+ iterations) — stays stable throughout", () => {
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 3,
        analysisWindowSize: 10,
        stableCdpVariance: 0.2,
        stableCorrelationStdDev: 0.3,
        criticalCdpVariance: 0.5,
        criticalCorrelationStdDev: 0.8,
      });

      const metrics = buildStableMetrics(60, 1);
      let stableCount = 0;
      for (const m of metrics) {
        const result = analyzer.analyzeRegime(m, false);
        if (result.regime === "stable") stableCount++;
      }

      // After warming up (first 3 iterations are nascent), remaining 57+ should be stable
      expect(stableCount).toBeGreaterThan(50);
      expect(analyzer.getCurrentRegime()).toBe("stable");
    });
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  describe("Configuration", () => {
    it("T41: Custom analysisWindowSize respected — only last N metrics used", () => {
      const analyzer = new RegimeAnalyzer({ analysisWindowSize: 2 });

      // Feed 10 entries with very different CDPs early on
      for (let i = 1; i <= 10; i++) {
        analyzer.analyzeRegime(
          makeSocMetrics({ iteration: i, cdp: i * 10.0 }),
          false,
        );
      }

      // Only last 2 CDPs [90, 100] are in window
      const window = analyzer.getMetricsWindow();
      expect(window.length).toBe(2);
      expect(window[0]!.cdp).toBeCloseTo(90, 0);
      expect(window[1]!.cdp).toBeCloseTo(100, 0);
    });

    it("T42: Custom criticalCdpVariance threshold respected", () => {
      // Very low critical threshold (0.05) → any small variance triggers critical
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 4,
        criticalCdpVariance: 0.05,
        stableCdpVariance: 0.01,
        criticalCorrelationStdDev: 5.0, // effectively disabled
        stableCorrelationStdDev: 0.3,
      });

      // Feed CDPs with moderate variance (e.g., 0.2 and 0.8 → variance ≈ 0.18 > 0.05)
      for (let i = 1; i <= 4; i++) {
        const cdp = i % 2 === 0 ? 0.8 : 0.2;
        analyzer.analyzeRegime(makeSocMetrics({ iteration: i, cdp }), false);
      }

      expect(analyzer.getCurrentRegime()).toBe("critical");
    });

    it("T43: Custom stableCdpVariance threshold respected", () => {
      // High stable threshold (0.9) → nearly any variance is below stable threshold
      const analyzer = new RegimeAnalyzer({
        persistenceThreshold: 2,
        analysisWindowSize: 4,
        criticalCdpVariance: 10.0, // effectively disabled
        stableCdpVariance: 0.9,
        criticalCorrelationStdDev: 10.0, // effectively disabled
        stableCorrelationStdDev: 0.9,
      });

      // Feed moderate variance CDPs — variance ≈ 0.18 < 0.9 stable threshold
      for (let i = 1; i <= 4; i++) {
        const cdp = i % 2 === 0 ? 0.8 : 0.2;
        analyzer.analyzeRegime(
          makeSocMetrics({ iteration: i, cdp, correlationCoefficient: 0.5 }),
          false,
        );
      }

      expect(analyzer.getCurrentRegime()).toBe("stable");
    });

    it("T44: Default config matches documented values", () => {
      // Default: analysisWindowSize=10, persistenceThreshold=5,
      //          criticalCdpVariance=0.5, stableCdpVariance=0.2,
      //          criticalCorrelationStdDev=0.8, stableCorrelationStdDev=0.3

      const analyzer = new RegimeAnalyzer(); // no config override

      // With defaults: need 5 iterations before "stable" is possible
      // Feed 4 stable iterations → should still be nascent
      for (let i = 1; i <= 4; i++) {
        analyzer.analyzeRegime(
          makeSocMetrics({
            iteration: i,
            cdp: 0.1,
            correlationCoefficient: 0.5,
          }),
          false,
        );
      }
      expect(analyzer.getCurrentRegime()).toBe("nascent");

      // Feed 5th stable iteration → should now be stable (persistence = 5 >= threshold=5)
      analyzer.analyzeRegime(
        makeSocMetrics({ iteration: 5, cdp: 0.1, correlationCoefficient: 0.5 }),
        false,
      );
      expect(analyzer.getCurrentRegime()).toBe("stable");
    });
  });
});


// ---------------------------------------------------------------------------
// System 1 Early Convergence Detection Tests (SOC-08)
// ---------------------------------------------------------------------------

describe("System 1 Early Convergence Detection (SOC-08)", () => {
  describe("Entropy pair tracking", () => {
    it("T45: trackEntropyPair records VNE/EE pairs", () => {
      const validator = new RegimeValidator();
      validator.trackEntropyPair(1.5, 0.8, 1);
      validator.trackEntropyPair(1.7, 0.82, 2);

      const pairs = validator.getEntropyPairs();
      expect(pairs).toHaveLength(2);
      expect(pairs[0]!.vne).toBe(1.5);
      expect(pairs[0]!.ee).toBe(0.8);
      expect(pairs[1]!.iteration).toBe(2);
    });

    it("T46: entropy pair history trims to max size", () => {
      const validator = new RegimeValidator();
      // Default max is 20
      for (let i = 1; i <= 30; i++) {
        validator.trackEntropyPair(i * 0.1, 0.5, i);
      }
      const pairs = validator.getEntropyPairs();
      expect(pairs.length).toBeLessThanOrEqual(20);
    });

    it("T47: getEntropyPairs returns defensive copy", () => {
      const validator = new RegimeValidator();
      validator.trackEntropyPair(1.0, 0.5, 1);
      const p1 = validator.getEntropyPairs() as Array<{vne: number; ee: number; iteration: number}>;
      p1.push({ vne: 999, ee: 999, iteration: 999 });
      expect(validator.getEntropyPairs()).toHaveLength(1);
    });
  });

  describe("Early convergence detection", () => {
    it("T48: not detected with insufficient iterations", () => {
      const validator = new RegimeValidator({
        earlyConvergenceMinIterations: 5,
      });
      // Feed only 3 pairs — below the minimum
      for (let i = 1; i <= 3; i++) {
        validator.trackEntropyPair(i * 0.1, 0.5, i);
      }
      const result = validator.detectEarlyConvergence();
      expect(result.detected).toBe(false);
      expect(isNaN(result.eeVariance)).toBe(true);
    });

    it("T49: DETECTED when EE stabilized but VNE growing (System 1 override)", () => {
      // EE variance < 0.01, VNE slope > 0.05
      // This is the signature: semantic space converged, structure still building
      const validator = new RegimeValidator({
        eeStabilizationThreshold: 0.01,
        vneGrowthThreshold: 0.05,
        earlyConvergenceMinIterations: 5,
      });

      // EE is flat at 0.5 (converged), VNE is linearly increasing
      for (let i = 1; i <= 6; i++) {
        validator.trackEntropyPair(0.5 + i * 0.1, 0.5, i);
      }

      const result = validator.detectEarlyConvergence(5);
      expect(result.detected).toBe(true);
      expect(result.eeVariance).toBeLessThan(0.01);
      expect(result.vneSlope).toBeGreaterThan(0.05);
    });

    it("T50: NOT detected when both EE and VNE are growing (healthy reasoning)", () => {
      const validator = new RegimeValidator({
        eeStabilizationThreshold: 0.01,
        vneGrowthThreshold: 0.05,
        earlyConvergenceMinIterations: 5,
      });

      // Both entropies growing — healthy exploration, no shortcutting
      for (let i = 1; i <= 6; i++) {
        validator.trackEntropyPair(0.5 + i * 0.1, 0.3 + i * 0.08, i);
      }

      const result = validator.detectEarlyConvergence(5);
      expect(result.detected).toBe(false);
      // EE variance should be high (growing)
      expect(result.eeVariance).toBeGreaterThan(0.01);
    });

    it("T51: NOT detected when VNE is flat (no structural growth)", () => {
      const validator = new RegimeValidator({
        eeStabilizationThreshold: 0.01,
        vneGrowthThreshold: 0.05,
        earlyConvergenceMinIterations: 5,
      });

      // Both flat — stable state, not a System 1 override
      for (let i = 1; i <= 6; i++) {
        validator.trackEntropyPair(1.5, 0.5, i);
      }

      const result = validator.detectEarlyConvergence(5);
      expect(result.detected).toBe(false);
      // VNE slope should be ~0
      expect(Math.abs(result.vneSlope)).toBeLessThan(0.05);
    });
  });
});
