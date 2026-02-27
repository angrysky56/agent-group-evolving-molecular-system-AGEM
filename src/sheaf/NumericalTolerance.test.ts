/**
 * NumericalTolerance.test.ts
 *
 * Tests for numerical tolerance calibration in computeCohomology().
 *
 * These tests validate that:
 *   1. The default tolerance formula is calibrated (not hardcoded).
 *   2. The calibrated tolerance correctly detects H^1 for the standard test sheaf.
 *   3. Explicit tolerance overrides work and are reflected in the result.
 *   4. The absurdly loose tolerance (tol >> max singular value) collapses everything.
 *   5. Flat sheaf H^1 = 0 is stable across a reasonable tolerance range.
 *
 * Test sheaf used: buildFlatSheaf(3, 1, 'triangle')
 *   - N_0 = 3, N_1 = 3
 *   - B = incidence matrix of the triangle cycle (3x3 rank-2 matrix)
 *   - Singular values: [sqrt(3), sqrt(3), 0] ≈ [1.732, 1.732, 0]
 *   - rank(B) = 2, dim(H^1) = 1, dim(H^0) = 1
 *   - Calibrated tolerance ≈ 1.15e-15 (well below 1e-10)
 *
 * Why this sheaf:
 *   The flat 1D triangle is the canonical minimal non-trivial cohomology example.
 *   Its B matrix is the graph incidence matrix of a cycle, with well-separated singular
 *   values (structural 0 vs sqrt(3)). The gap ratio is ~1e15, making the calibrated
 *   tolerance extremely reliable for demonstrating tolerance sensitivity.
 *
 * Pitfall documented: using a hardcoded tolerance like 1e-6 without knowing the singular
 * value spectrum. This can falsely classify a structurally non-zero singular value as zero
 * (over-counting H^1) or fail to detect a structurally zero singular value (under-counting H^1).
 * The MATLAB rank() formula max(S) * max(N0,N1) * eps is a principled default.
 */

import { describe, it, expect } from 'vitest';
import { computeCohomology } from './CohomologyAnalyzer.js';
import { buildFlatSheaf } from './helpers/flatSheafFactory.js';

// Reuse the canonical test sheaf across all tests.
// Flat 1D triangle: N0=3, N1=3, singular values ≈ [1.732, 1.732, 0], rank=2, h1=1.
function buildTestSheaf() {
  return buildFlatSheaf(3, 1, 'triangle');
}

describe('Numerical tolerance calibration', () => {
  // ---------------------------------------------------------------------------
  // Tolerance formula documentation test
  // ---------------------------------------------------------------------------

  it('default tolerance is positive and very small (< 1e-10)', () => {
    const sheaf = buildTestSheaf();
    const result = computeCohomology(sheaf);

    // The tolerance field should reflect the calibrated formula, not a hardcoded value.
    // For the 1D triangle: tol = sqrt(3) * 3 * Number.EPSILON ≈ 1.15e-15.
    // We verify it is in the expected range for the calibrated formula.
    expect(result.tolerance).toBeGreaterThan(0);
    expect(result.tolerance).toBeLessThan(1e-10);
  });

  it('default tolerance follows the MATLAB rank() formula: max(S) * max(N0,N1) * eps', () => {
    const sheaf = buildTestSheaf();
    const result = computeCohomology(sheaf);

    // The maximum singular value for the 1D triangle is sqrt(3) ≈ 1.732.
    // max(N0, N1) = 3. Number.EPSILON ≈ 2.22e-16.
    // Expected tol ≈ 1.732 * 3 * 2.22e-16 ≈ 1.154e-15.
    const maxS = Math.sqrt(3); // The exact singular value of the incidence matrix of K_3 cycle
    const N = 3; // max(N0, N1)
    const eps = Number.EPSILON;
    const expectedTol = maxS * N * eps;

    // Allow 5% relative tolerance for numerical differences in SVD implementation.
    expect(result.tolerance).toBeCloseTo(expectedTol, 30); // roughly equal
    expect(Math.abs(result.tolerance - expectedTol) / expectedTol).toBeLessThan(0.05);
  });

  // ---------------------------------------------------------------------------
  // Tolerance sensitivity tests
  // ---------------------------------------------------------------------------

  it('calibrated tolerance correctly detects H^1 = 1 for flat 1D triangle', () => {
    const sheaf = buildTestSheaf();
    const result = computeCohomology(sheaf); // default (calibrated) tolerance
    expect(result.h1Dimension).toBe(1);
  });

  it('H^1 is robust across reasonable tolerance range for flat 1D triangle', () => {
    const sheaf = buildTestSheaf();

    // The flat 1D triangle has well-separated singular values:
    // [sqrt(3) ≈ 1.732, sqrt(3) ≈ 1.732, 0].
    // Gap ratio between smallest non-zero and largest: ~1e15.
    // So any reasonable tolerance (1e-1 to 1e-15) should give the same answer.

    // Tight tolerance (still well above machine epsilon for these values):
    const resultTight = computeCohomology(sheaf, 1e-10);
    expect(resultTight.h1Dimension).toBe(1);

    // Moderate tolerance (still well below the non-zero singular values):
    const resultModerate = computeCohomology(sheaf, 1e-6);
    expect(resultModerate.h1Dimension).toBe(1);

    // Default calibrated tolerance:
    const resultDefault = computeCohomology(sheaf);
    expect(resultDefault.h1Dimension).toBe(1);
  });

  it('absurdly loose tolerance (tol=10.0) collapses all singular values to "zero"', () => {
    // With tol=10.0, ALL singular values (max ≈ sqrt(3) ≈ 1.732 < 10) are treated as zero.
    // rank(B) = 0 → h1 = N1 - 0 = 3 (everything is "zero").
    // This is the WRONG answer and proves that tolerance matters.
    const sheaf = buildTestSheaf();
    const resultAbsurd = computeCohomology(sheaf, 10.0);

    // rank = 0 (all singular values < 10.0)
    expect(resultAbsurd.coboundaryRank).toBe(0);
    // h1 = N1 - 0 = 3 (all edge stalks form the "obstruction")
    expect(resultAbsurd.h1Dimension).toBe(3);
    // h0 = N0 - 0 = 3 (spurious: even non-sections appear "global")
    expect(resultAbsurd.h0Dimension).toBe(3);
    // tolerance field reflects the override
    expect(resultAbsurd.tolerance).toBe(10.0);
  });

  // ---------------------------------------------------------------------------
  // Singular value spectrum diagnostic test
  // ---------------------------------------------------------------------------

  it('coboundaryRank = 2 for flat 1D triangle (two non-zero singular values)', () => {
    const sheaf = buildTestSheaf();
    const result = computeCohomology(sheaf);

    // B = incidence matrix of triangle cycle: rank 2 out of 3 rows.
    // Two non-zero singular values (sqrt(3) each), one structural zero.
    expect(result.coboundaryRank).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Override tolerance test
  // ---------------------------------------------------------------------------

  it('explicit tolerance parameter overrides the calibrated default', () => {
    const sheaf = buildTestSheaf();
    const explicitTol = 1e-3;
    const result = computeCohomology(sheaf, explicitTol);

    // The override should be reflected in the result's tolerance field.
    expect(result.tolerance).toBe(explicitTol);
  });

  it('explicit tolerance of 1e-3 still gives correct H^1 = 1 for flat 1D triangle', () => {
    // 1e-3 is below all non-zero singular values (sqrt(3) ≈ 1.732) but above any noise.
    const sheaf = buildTestSheaf();
    const result = computeCohomology(sheaf, 1e-3);
    expect(result.h1Dimension).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Flat sheaf tolerance robustness
  // ---------------------------------------------------------------------------

  it('flat 2D path sheaf H^1 = 0 is stable across reasonable tolerance range', () => {
    // The flat 2D path has all non-zero singular values (no structural zeros in B).
    // H^1 = 0 should be stable as long as tol < min(singular values).
    const sheaf = buildFlatSheaf(3, 2, 'path');

    // Default calibrated tolerance:
    expect(computeCohomology(sheaf).h1Dimension).toBe(0);

    // Tight tolerance (well above machine epsilon for these values):
    expect(computeCohomology(sheaf, 1e-10).h1Dimension).toBe(0);

    // Moderate tolerance (still below the smallest non-zero singular value ≈ 1.0):
    expect(computeCohomology(sheaf, 1e-8).h1Dimension).toBe(0);

    // Somewhat loose (still below the smallest non-zero singular value ≈ 1.0):
    expect(computeCohomology(sheaf, 0.5).h1Dimension).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Multi-sheaf consistency: all three configurations give consistent results
  // ---------------------------------------------------------------------------

  it('tolerance calibration gives consistent rank across all standard test sheaves', () => {
    // All three standard configurations should give consistent rank with default tolerance.
    const sheaf1D = buildFlatSheaf(3, 1, 'triangle');
    const sheaf2Dpath = buildFlatSheaf(3, 2, 'path');
    const sheaf2Dtri = buildFlatSheaf(3, 2, 'triangle');

    const r1 = computeCohomology(sheaf1D);
    const r2 = computeCohomology(sheaf2Dpath);
    const r3 = computeCohomology(sheaf2Dtri);

    // Rank-nullity theorem: rank(B) + dim(H^0) = N_0
    expect(r1.coboundaryRank + r1.h0Dimension).toBe(sheaf1D.c0Dimension);
    expect(r2.coboundaryRank + r2.h0Dimension).toBe(sheaf2Dpath.c0Dimension);
    expect(r3.coboundaryRank + r3.h0Dimension).toBe(sheaf2Dtri.c0Dimension);

    // Rank-corank: rank(B) + dim(H^1) = N_1
    expect(r1.coboundaryRank + r1.h1Dimension).toBe(sheaf1D.c1Dimension);
    expect(r2.coboundaryRank + r2.h1Dimension).toBe(sheaf2Dpath.c1Dimension);
    expect(r3.coboundaryRank + r3.h1Dimension).toBe(sheaf2Dtri.c1Dimension);
  });
});
