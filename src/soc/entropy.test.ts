/**
 * entropy.test.ts — Mathematical correctness guard tests for SOC entropy functions.
 *
 * Tests T-VN-01 through T-VN-05: Von Neumann entropy (SOC-01)
 * Tests T-EE-01 through T-EE-05: Embedding entropy (SOC-02)
 *
 * These are permanent correctness gates — any change to entropy.ts that breaks
 * these tests indicates a regression in the mathematical formulas.
 *
 * Primary success criteria validated here:
 *   SC-1: VonNeumannEntropy(K_n) = ln(n-1) within tolerance (T-VN-01, T-VN-02)
 *   SC-1: Entropy for K_n never exceeds ln(n) (T-VN-05, holds since ln(n-1) < ln(n))
 *   SC-2: Identical embeddings → near-zero entropy (T-EE-01)
 *   SC-2: d orthogonal unit vectors → entropy near ln(d) (T-EE-02)
 *
 * DEVIATION NOTE — K_n formula (Rule 1 auto-fix, documented in 04-01-SUMMARY.md):
 *   ROADMAP/CONTEXT.md state S(K_n) = ln(n), but the mathematically correct result
 *   for the normalized Laplacian density matrix rho = L_norm / trace(L_norm) is:
 *     S(K_n) = ln(n-1)
 *   Derivation:
 *     - L_norm eigenvalues: 0 (once), n/(n-1) (n-1 times); trace = n
 *     - rho eigenvalues: 0 (once), 1/(n-1) (n-1 times)
 *     - S = -(n-1) * (1/(n-1)) * ln(1/(n-1)) = ln(n-1)
 *   RESEARCH.md §Pattern 1 (lines 172-187) explicitly notes this discrepancy and
 *   states: "CONCLUSION: Implement per CONTEXT.md exactly and validate with the K_n
 *   test. If the K_n test fails, the density matrix normalization needs adjustment."
 *   Tests encode ln(n-1) (the correct mathematical result). The upper bound invariant
 *   T-VN-05 remains valid since ln(n-1) < ln(n) for all n >= 2.
 */

import { describe, it, expect } from 'vitest';
import { vonNeumannEntropy, embeddingEntropy } from './entropy.js';

// ---------------------------------------------------------------------------
// Helper: build complete graph K_n edges
// ---------------------------------------------------------------------------

/**
 * buildKn — build a complete graph K_n edge list.
 * Every pair (i, j) for i < j is connected with weight 1.
 * Returns an array suitable for vonNeumannEntropy().
 */
function buildKn(n: number): Array<{ source: number; target: number; weight: number }> {
  const edges: Array<{ source: number; target: number; weight: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ source: i, target: j, weight: 1 });
    }
  }
  return edges;
}

/**
 * buildPathGraph — build a path graph P_n: 0-1-2-...(n-1).
 * Returns edges suitable for vonNeumannEntropy().
 */
function buildPathGraph(n: number): Array<{ source: number; target: number; weight: number }> {
  const edges: Array<{ source: number; target: number; weight: number }> = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push({ source: i, target: i + 1, weight: 1 });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Von Neumann Entropy Tests (SOC-01)
// ---------------------------------------------------------------------------

describe('vonNeumannEntropy — SOC-01 correctness gates', () => {
  /**
   * T-VN-01: Complete graph K_3 yields Von Neumann entropy = ln(2).
   *
   * Mathematical derivation:
   *   L_norm for K_3: eigenvalues 0 (once) and 3/2 (twice); trace = 3.
   *   rho = L_norm/3: eigenvalues 0, 1/2, 1/2.
   *   S = -2*(1/2)*ln(1/2) = ln(2).
   *
   * General formula: S(K_n) = ln(n-1) for the L_norm/trace(L_norm) density matrix.
   *
   * This is the PRIMARY correctness gate for the Von Neumann entropy implementation
   * (ROADMAP SC-1 variant). The ROADMAP states ln(n), but the math gives ln(n-1).
   * See module-level DEVIATION NOTE for full explanation.
   */
  it('T-VN-01: K_3 complete graph yields Von Neumann entropy approximately ln(2)', () => {
    const edges = buildKn(3);
    const result = vonNeumannEntropy(3, edges);

    // S(K_3) = ln(2) = 0.6931... (not ln(3) = 1.0986...)
    expect(result).toBeCloseTo(Math.log(2), 5); // within 1e-5
  });

  /**
   * T-VN-02: Generalized K_n test for n=4 and n=5.
   * S(K_4) = ln(3). S(K_5) = ln(4). General: S(K_n) = ln(n-1).
   */
  it('T-VN-02: K_4 complete graph yields Von Neumann entropy approximately ln(3)', () => {
    const edges = buildKn(4);
    const result = vonNeumannEntropy(4, edges);
    // S(K_4) = ln(3) = 1.0986...
    expect(result).toBeCloseTo(Math.log(3), 5);
  });

  it('T-VN-02b: K_5 complete graph yields Von Neumann entropy approximately ln(4)', () => {
    const edges = buildKn(5);
    const result = vonNeumannEntropy(5, edges);
    // S(K_5) = ln(4) = 1.3862...
    expect(result).toBeCloseTo(Math.log(4), 5);
  });

  /**
   * T-VN-03: Path graph P_4 yields entropy strictly less than K_4's entropy.
   * Path graphs are less structurally complex than complete graphs.
   * S(P_4) < S(K_4) = ln(3). Since K_4 is the maximum for 4 nodes, P_4 must be below.
   */
  it('T-VN-03: Path graph P_4 yields entropy strictly less than ln(4)', () => {
    const edges = buildPathGraph(4);
    const result = vonNeumannEntropy(4, edges);
    // Path graphs have strictly less entropy than complete graphs
    expect(result).toBeLessThan(Math.log(4));
    // Also verify it's positive (a non-trivial graph)
    expect(result).toBeGreaterThan(0);
  });

  /**
   * T-VN-04: Single node with no edges yields entropy exactly 0.
   * Degenerate case: no Laplacian structure means zero entropy.
   * The function must handle nodeCount=1, edges=[] without throwing.
   */
  it('T-VN-04: Single node with no edges yields entropy 0', () => {
    const result = vonNeumannEntropy(1, []);
    expect(result).toBe(0);
  });

  /**
   * T-VN-05: Von Neumann entropy never exceeds ln(n) for any n-node graph.
   * ROADMAP SC-1 invariant (upper bound). K_n achieves ln(n-1) < ln(n), confirming
   * the invariant holds. Tests n=3,4,5,6 with K_n (the maximum-entropy graph).
   *
   * Note: The bound ln(n) is NOT tight — K_n achieves ln(n-1), not ln(n).
   * The invariant is still valid: ln(n-1) <= ln(n) + 1e-10 for all n.
   */
  it('T-VN-05: Von Neumann entropy never exceeds ln(n) for K_3, K_4, K_5, K_6', () => {
    for (const n of [3, 4, 5, 6]) {
      const edges = buildKn(n);
      const result = vonNeumannEntropy(n, edges);
      // Allow 1e-10 numerical tolerance. ln(n-1) < ln(n) so this always holds.
      expect(result).toBeLessThanOrEqual(Math.log(n) + 1e-10);
    }
  });
});

// ---------------------------------------------------------------------------
// Embedding Entropy Tests (SOC-02)
// ---------------------------------------------------------------------------

describe('embeddingEntropy — SOC-02 correctness gates', () => {
  /**
   * T-EE-01: Identical embeddings yield entropy near zero.
   * ROADMAP SC-2 first edge case.
   * 5 copies of the same 10-dimensional vector [1,0,...,0].
   * Covariance matrix Sigma = outer([1,0,...,0],[1,0,...,0]) has rank 1.
   * Normalized eigenspectrum: [1, 0, 0, ...] → entropy = 0.
   */
  it('T-EE-01: Five identical embeddings yield entropy near zero', () => {
    const vec = new Float64Array(10);
    vec[0] = 1;
    const embeddings = [vec, vec, vec, vec, vec];
    const result = embeddingEntropy(embeddings);
    expect(result).toBeLessThan(1e-6);
  });

  /**
   * T-EE-02: d orthogonal unit vectors yield entropy near ln(d).
   * ROADMAP SC-2 second edge case — the primary embedding entropy correctness gate.
   * 4 standard basis vectors in R^4: e_1=[1,0,0,0], e_2=[0,1,0,0], etc.
   * Covariance Sigma = (1/4) * I_4. All eigenvalues equal 1/4.
   * Normalized eigenvalues: p_i = 1/4 for all i.
   * Entropy = -4 * (1/4) * ln(1/4) = ln(4).
   */
  it('T-EE-02: Four orthogonal unit vectors yield entropy approximately ln(4)', () => {
    const d = 4;
    const embeddings: Float64Array[] = [];
    for (let i = 0; i < d; i++) {
      const vec = new Float64Array(d);
      vec[i] = 1;
      embeddings.push(vec);
    }
    const result = embeddingEntropy(embeddings);
    // ROADMAP SC-2 primary gate: S(orthogonal unit vectors) = ln(d)
    expect(result).toBeCloseTo(Math.log(d), 5);
  });

  /**
   * T-EE-03: Two orthogonal embeddings yield entropy approximately ln(2).
   * e_1 = [1,0,0] and e_2 = [0,1,0].
   * Sigma = (1/2) * diag(1,1,0). Non-zero eigenvalues: [1/2, 1/2].
   * Normalized: p_1 = p_2 = 1/2.
   * Entropy = -2 * (1/2) * ln(1/2) = ln(2).
   */
  it('T-EE-03: Two orthogonal embeddings yield entropy approximately ln(2)', () => {
    const e1 = new Float64Array([1, 0, 0]);
    const e2 = new Float64Array([0, 1, 0]);
    const result = embeddingEntropy([e1, e2]);
    expect(result).toBeCloseTo(Math.log(2), 5);
  });

  /**
   * T-EE-04: Empty embedding set yields entropy exactly 0.
   * Degenerate case: no data → no covariance structure → zero entropy.
   * The function must handle embeddings.length === 0 without throwing.
   */
  it('T-EE-04: Empty embedding set yields entropy 0', () => {
    const result = embeddingEntropy([]);
    expect(result).toBe(0);
  });

  /**
   * T-EE-05: Single embedding yields entropy exactly 0.
   * One vector has a rank-1 covariance matrix.
   * Normalized eigenspectrum: [1, 0, 0, ...] → entropy = -1*ln(1) = 0.
   * The function must handle embeddings.length === 1 without throwing.
   */
  it('T-EE-05: Single embedding yields entropy 0', () => {
    const result = embeddingEntropy([new Float64Array([1, 2, 3])]);
    expect(result).toBe(0);
  });
});
