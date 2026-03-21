/**
 * correlation.ts — SOC pure math utility functions (Wave 2)
 *
 * Provides:
 *   - pearsonCorrelation(x, y): Pearson r for rolling phase transition detection
 *   - linearSlope(values): OLS linear regression slope for metric trend computation
 *
 * Used by SOCTracker for:
 *   - Phase transition detection: Pearson r between rolling VN entropy deltas and
 *     rolling embedding entropy deltas (sign change = phase transition)
 *   - getMetricsTrend(): linear regression slope of vonNeumannEntropy time series
 *
 * Isolation invariant: ZERO imports from src/tna/, src/lcm/, or src/orchestrator/.
 */
/**
 * pearsonCorrelation(x, y) — standard Pearson correlation coefficient.
 *
 * Formula: r = (Σ(x_i - x̄)(y_i - ȳ)) / (sqrt(Σ(x_i - x̄)²) * sqrt(Σ(y_i - ȳ)²))
 *
 * Returns:
 *   - r in [-1, 1] for valid inputs with non-zero variance.
 *   - 0 if n < 2, or if either variable has zero variance (denominator = 0).
 *
 * @param x - First series (length must equal y.length).
 * @param y - Second series (length must equal x.length).
 * @returns Pearson correlation coefficient, or 0 for degenerate inputs.
 */
export declare function pearsonCorrelation(x: number[], y: number[]): number;
/**
 * linearSlope(values) — ordinary least-squares linear regression slope.
 *
 * Fits a line y = slope * i + intercept to values indexed i = 0..n-1.
 * Uses the direct OLS formula (avoids pearsonCorrelation + std ratio to keep
 * this function self-contained and numerically stable for small arrays):
 *
 *   slope = (n * Σ(i * y_i) - Σ(i) * Σ(y_i)) / (n * Σ(i²) - (Σ(i))²)
 *
 * Returns 0 if fewer than 2 values.
 *
 * @param values - Time series of numeric metric values.
 * @returns OLS slope. Positive = increasing, negative = decreasing, 0 = flat or degenerate.
 */
export declare function linearSlope(values: number[]): number;
//# sourceMappingURL=correlation.d.ts.map