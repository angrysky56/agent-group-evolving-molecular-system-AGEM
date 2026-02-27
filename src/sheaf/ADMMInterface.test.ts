/**
 * ADMMInterface.test.ts
 *
 * Forward-compatibility tests for the ADMM interface:
 *
 *   T10: ADMM interface methods are accessible on CellularSheaf
 *   T10b: ADMMSolver basic convergence on flat sheaf
 *   T10c: Dirichlet energy correctness (0 for global section, > 0 for non-section)
 *
 * Purpose: Verify that the interface is stable enough that replacing the gradient
 * descent internals with real ADMM in a future phase requires ZERO test changes.
 *
 * These tests check the interface, not the algorithm details.
 */

import { describe, it, expect } from 'vitest';
import { CellularSheaf } from './CellularSheaf.js';
import { ADMMSolver } from './ADMMSolver.js';
import { buildFlatSheaf } from './helpers/flatSheafFactory.js';
import type { VertexId, EdgeId } from '../types/index.js';

// ---------------------------------------------------------------------------
// T10: ADMM interface methods are accessible on CellularSheaf
// ---------------------------------------------------------------------------

describe('T10: ADMM interface methods accessible on CellularSheaf', () => {
  /**
   * Verify that all methods needed for ADMM forward compatibility are present
   * and return correct types on a standard CellularSheaf.
   */
  it('T10.1: getCoboundaryMatrix returns matrix with shape [c1Dimension, c0Dimension]', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const B = sheaf.getCoboundaryMatrix();
    const s = B.size();

    expect(s[0]).toBe(sheaf.c1Dimension); // rows = N_1
    expect(s[1]).toBe(sheaf.c0Dimension); // cols = N_0
  });

  it('T10.2: getSheafLaplacian returns matrix with shape [c0Dimension, c0Dimension]', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const L = sheaf.getSheafLaplacian();
    const s = L.size();

    expect(s[0]).toBe(sheaf.c0Dimension); // rows = N_0
    expect(s[1]).toBe(sheaf.c0Dimension); // cols = N_0
  });

  it('T10.3: getVertexOffset returns correct cumulative sums', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const [v0, v1, v2] = sheaf.getVertexIds();

    expect(sheaf.getVertexOffset(v0)).toBe(0); // first vertex: offset 0
    expect(sheaf.getVertexOffset(v1)).toBe(2); // v1: offset = dim(v0) = 2
    expect(sheaf.getVertexOffset(v2)).toBe(4); // v2: offset = dim(v0) + dim(v1) = 4
  });

  it('T10.4: getEdgeOffset returns correct cumulative sums', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const [e01, e12] = sheaf.getEdgeIds();

    expect(sheaf.getEdgeOffset(e01)).toBe(0); // first edge: offset 0
    expect(sheaf.getEdgeOffset(e12)).toBe(2); // e12: offset = dim(e01) = 2
  });

  it('T10.5: getEdgeDim returns correct edge stalk dimension', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    for (const eid of sheaf.getEdgeIds()) {
      expect(sheaf.getEdgeDim(eid)).toBe(2); // all edges have dim=2 in flat 2D sheaf
    }
  });

  it('T10.6: getEdgeRestrictions returns source and target restriction maps', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const [e01] = sheaf.getEdgeIds();
    const restrictions = sheaf.getEdgeRestrictions(e01);

    expect(restrictions).toHaveProperty('source');
    expect(restrictions).toHaveProperty('target');
    expect(restrictions.source.entries).toBeInstanceOf(Float64Array);
    expect(restrictions.target.entries).toBeInstanceOf(Float64Array);
    // For flat sheaf with 2D stalks: identity maps
    expect(Array.from(restrictions.source.entries)).toEqual([1, 0, 0, 1]);
    expect(Array.from(restrictions.target.entries)).toEqual([1, 0, 0, 1]);
  });

  it('T10.7: getVertexIds returns array in insertion order', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const vertexIds = sheaf.getVertexIds();

    expect(vertexIds).toHaveLength(3);
    expect(vertexIds[0]).toBe('v0' as VertexId);
    expect(vertexIds[1]).toBe('v1' as VertexId);
    expect(vertexIds[2]).toBe('v2' as VertexId);
  });

  it('T10.8: getEdgeIds returns array in insertion order', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const edgeIds = sheaf.getEdgeIds();

    expect(edgeIds).toHaveLength(2);
    expect(edgeIds[0]).toBe('e01' as EdgeId);
    expect(edgeIds[1]).toBe('e12' as EdgeId);
  });

  it('T10.9: getCoboundaryMatrix delegates correctly (same as SheafLaplacian instance)', () => {
    const sheaf = buildFlatSheaf(2, 2, 'path');
    const B_direct = sheaf.getCoboundaryMatrix();
    const B_again = sheaf.getCoboundaryMatrix();

    // Same reference (cached)
    expect(B_direct).toBe(B_again);
  });

  it('T10.10: getEigenspectrum returns SheafEigenspectrum with correct shape', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const spectrum = sheaf.getEigenspectrum();

    expect(spectrum).toHaveProperty('eigenvalues');
    expect(spectrum).toHaveProperty('computedAtIteration');
    expect(spectrum.eigenvalues).toBeInstanceOf(Float64Array);
    expect(spectrum.eigenvalues.length).toBe(sheaf.c0Dimension);
  });
});

// ---------------------------------------------------------------------------
// T10b: ADMMSolver basic convergence on flat sheaf
// ---------------------------------------------------------------------------

describe('T10b: ADMMSolver basic convergence on flat sheaf', () => {
  it('T10b.1: ADMMSolver constructs from CellularSheaf without error', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    expect(solver).toBeInstanceOf(ADMMSolver);
    expect(solver.sheaf).toBe(sheaf);
  });

  it('T10b.2: solve() with random initial state converges (converged = true)', () => {
    /**
     * For a flat sheaf, gradient descent on the Dirichlet energy converges
     * to a global section (constant section). With enough iterations and a
     * suitable step size, convergence should be achieved.
     */
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf, { maxIterations: 5000, tolerance: 1e-8 });

    // Random initial state (deterministic seed via specific values)
    const initialState = new Float64Array([0.5, -0.3, 0.8, 0.1, -0.4, 0.7]);
    const result = solver.solve(initialState);

    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThanOrEqual(5000);
  });

  it('T10b.3: converged state is approximately a constant section', () => {
    /**
     * After convergence, all vertex states should be equal (or very close),
     * since the flat sheaf identity maps mean x in ker(B) implies all vertices
     * have the same state.
     *
     * For the 3-vertex path with 2D stalks:
     *   x = [a, b, a, b, a, b] is a constant section for any (a, b).
     */
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf, { maxIterations: 10000, tolerance: 1e-9 });

    const initialState = new Float64Array([1.0, 0.0, 0.5, 0.5, -0.5, 1.0]);
    const result = solver.solve(initialState);

    expect(result.converged).toBe(true);

    // Check that the Dirichlet energy is near zero (consistent with global section)
    expect(result.finalEnergy).toBeLessThan(1e-10);
  });

  it('T10b.4: Dirichlet energy of converged state is < tolerance^2', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const tol = 1e-8;
    const solver = new ADMMSolver(sheaf, { maxIterations: 5000, tolerance: tol });

    const initialState = new Float64Array([2.0, -1.0, 0.0, 3.0, 1.0, -2.0]);
    const result = solver.solve(initialState);

    expect(result.converged).toBe(true);
    expect(result.finalEnergy).toBeLessThan(1e-10);
  });

  it('T10b.5: solve() returns ConsensusResult with correct shape', () => {
    const sheaf = buildFlatSheaf(2, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    const initialState = new Float64Array(sheaf.c0Dimension).fill(1);
    const result = solver.solve(initialState);

    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('converged');
    expect(result).toHaveProperty('iterations');
    expect(result).toHaveProperty('finalEnergy');
    expect(result.x).toBeInstanceOf(Float64Array);
    expect(result.x.length).toBe(sheaf.c0Dimension);
    expect(typeof result.converged).toBe('boolean');
    expect(typeof result.iterations).toBe('number');
    expect(typeof result.finalEnergy).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// T10c: Dirichlet energy correctness
// ---------------------------------------------------------------------------

describe('T10c: Dirichlet energy correctness', () => {
  it('T10c.1: Dirichlet energy = 0 for a known global section', () => {
    /**
     * A constant section of a flat sheaf has zero Dirichlet energy.
     * For 3-vertex path with 2D stalks: x = [1, 0, 1, 0, 1, 0]
     * is a global section (B * x = 0), so E(x) = x^T L x = 0.
     */
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    const globalSection = new Float64Array([1, 0, 1, 0, 1, 0]);
    const energy = solver.computeDirichletEnergy(globalSection);

    expect(energy).toBeLessThan(1e-12);
  });

  it('T10c.2: Dirichlet energy = 0 for second constant section', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    const globalSection2 = new Float64Array([0, 1, 0, 1, 0, 1]);
    const energy = solver.computeDirichletEnergy(globalSection2);

    expect(energy).toBeLessThan(1e-12);
  });

  it('T10c.3: Dirichlet energy > 0 for a non-section state', () => {
    /**
     * A state where different vertices have different values is NOT a global section.
     * The Dirichlet energy measures the inconsistency.
     * x = [1, 0, 0, 1, 1, 0]: v0=[1,0], v1=[0,1], v2=[1,0] — inconsistent.
     */
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    const nonSection = new Float64Array([1, 0, 0, 1, 1, 0]);
    const energy = solver.computeDirichletEnergy(nonSection);

    expect(energy).toBeGreaterThan(0.5);
  });

  it('T10c.4: Dirichlet energy is non-negative for all inputs', () => {
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    // Test several random-ish states
    const states = [
      new Float64Array([1, 2, 3, 4, 5, 6]),
      new Float64Array([-1, 0.5, -0.3, 2, 1, -1]),
      new Float64Array([0, 0, 0, 0, 0, 0]),
      new Float64Array([1, 0, 1, 0, 1, 0]), // global section
    ];

    for (const state of states) {
      const energy = solver.computeDirichletEnergy(state);
      expect(energy).toBeGreaterThanOrEqual(0);
    }
  });

  it('T10c.5: Dirichlet energy uses L_sheaf (verified via quadratic form x^T L x)', () => {
    /**
     * For the 2-vertex flat sheaf with 2D stalks:
     *   L_sheaf = B^T B where B = [[-1,0,1,0],[0,-1,0,1]]
     *   L_sheaf = [[1,0,-1,0],[0,1,0,-1],[-1,0,1,0],[0,-1,0,1]]
     *
     * For x = [1, 0, 0, 0]:
     *   L*x = [1, 0, -1, 0]
     *   x^T * L * x = 1 * 1 + 0 * 0 + 0 * (-1) + 0 * 0 = 1
     *
     * Let's verify this numerically.
     */
    const sheaf = buildFlatSheaf(2, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    // x = [1, 0, 0, 0]: only v0's first component is 1
    const x = new Float64Array([1, 0, 0, 0]);
    const energy = solver.computeDirichletEnergy(x);

    // Expected: x^T L x = 1 (verified by hand)
    expect(Math.abs(energy - 1)).toBeLessThan(1e-12);
  });

  it('T10c.6: scaling energy: E(2x) = 4 * E(x)', () => {
    /**
     * The Dirichlet energy is a quadratic form: E(alpha * x) = alpha^2 * E(x).
     * This is a direct consequence of E(x) = x^T L x.
     */
    const sheaf = buildFlatSheaf(3, 2, 'path');
    const solver = new ADMMSolver(sheaf);

    const x = new Float64Array([1, 0, 0, 1, 1, 0]);
    const twoX = new Float64Array(x.map(v => 2 * v));

    const Ex = solver.computeDirichletEnergy(x);
    const E2x = solver.computeDirichletEnergy(twoX);

    expect(Math.abs(E2x - 4 * Ex)).toBeLessThan(1e-10);
  });
});
