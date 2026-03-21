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
// ---------------------------------------------------------------------------
// pearsonCorrelation
// ---------------------------------------------------------------------------
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
export function pearsonCorrelation(x, y) {
    const n = x.length;
    if (n < 2 || n !== y.length)
        return 0;
    // Compute means
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    // Compute numerator and variances
    let numerator = 0;
    let varX = 0;
    let varY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        numerator += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
    }
    const denominator = Math.sqrt(varX) * Math.sqrt(varY);
    if (denominator < 1e-12)
        return 0; // zero variance → no correlation defined
    return numerator / denominator;
}
// ---------------------------------------------------------------------------
// linearSlope
// ---------------------------------------------------------------------------
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
export function linearSlope(values) {
    const n = values.length;
    if (n < 2)
        return 0;
    let sumI = 0;
    let sumY = 0;
    let sumIY = 0;
    let sumI2 = 0;
    for (let i = 0; i < n; i++) {
        const y = values[i];
        sumI += i;
        sumY += y;
        sumIY += i * y;
        sumI2 += i * i;
    }
    const denominator = n * sumI2 - sumI * sumI;
    if (Math.abs(denominator) < 1e-12)
        return 0; // degenerate (all indices equal — impossible for n>=2)
    return (n * sumIY - sumI * sumY) / denominator;
}
//# sourceMappingURL=correlation.js.map