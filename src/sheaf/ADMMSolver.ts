/**
 * ADMMSolver.ts
 *
 * ADMM (Alternating Direction Method of Multipliers) solver interface and
 * Phase 1 placeholder implementation for sheaf consensus.
 *
 * The ADMM solver minimizes the Dirichlet energy E(x) = x^T L_sheaf x
 * subject to consensus constraints on the global section space.
 *
 * In Phase 1, we implement the interface using simple gradient descent on the
 * Dirichlet energy. Real ADMM uses auxiliary variables z, u, and per-edge updates
 * which are appropriate for distributed computation. That replacement happens in
 * a future phase without any test changes (interface stability is the point).
 *
 * Interface design:
 *   - solve(initialState): ConsensusResult — run to convergence
 *   - computeDirichletEnergy(x): number — E(x) = x^T L x
 *
 * Forward-compatibility guarantee:
 *   Replacing the gradient descent internals with true ADMM should not require
 *   any changes to any test that imports this module.
 */

import * as math from "mathjs";
import { CellularSheaf } from "./CellularSheaf.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ADMMStepResult {
  readonly x: Float64Array; // Updated C^0 vector
  readonly primalResidual: number; // ||Bx - z||
  readonly dualResidual: number; // ||rho * B^T(z - z_prev)||
}

export interface ConvergenceResult {
  readonly converged: boolean;
  readonly primalResidual: number;
  readonly dualResidual: number;
  readonly iteration: number;
}

export interface ConsensusResult {
  readonly x: Float64Array; // Final C^0 vector (all agent states)
  readonly converged: boolean;
  readonly iterations: number;
  readonly finalEnergy: number; // Dirichlet energy = x^T L x
}

// ---------------------------------------------------------------------------
// ADMMSolver
// ---------------------------------------------------------------------------

export class ADMMSolver {
  readonly sheaf: CellularSheaf;
  private readonly maxIterations: number;
  private readonly tolerance: number;
  private readonly rho: number;

  constructor(
    sheaf: CellularSheaf,
    options?: { maxIterations?: number; tolerance?: number; rho?: number },
  ) {
    this.sheaf = sheaf;
    this.maxIterations = options?.maxIterations ?? 1000;
    this.tolerance = options?.tolerance ?? 1e-8;
    this.rho = options?.rho ?? 1.0;
  }

  /**
   * solve — run consensus to convergence. Returns the converged state vector.
   *
   * PHASE 1 STUB: Uses gradient descent on Dirichlet energy.
   * Real ADMM with auxiliary variables z, u and per-edge updates
   * will replace this in a future phase (SHEAF-05 full implementation).
   *
   * Algorithm:
   *   x_{k+1} = x_k - alpha * L_sheaf * x_k
   *   where alpha = 0.5 / max_eigenvalue(L_sheaf)
   *
   * Convergence criterion: ||L_sheaf * x|| < tolerance
   * (Dirichlet energy gradient near zero means we are near a global section)
   */
  solve(initialState: Float64Array): ConsensusResult {
    const L = this.sheaf.getSheafLaplacian();
    const N0 = this.sheaf.c0Dimension;

    // Compute step size: alpha = 0.5 / max_eigenvalue(L).
    // Use eigenspectrum from cache if available.
    const spectrum = this.sheaf.getEigenspectrum();
    const eigenvalues = spectrum.eigenvalues;
    const maxEigenvalue = eigenvalues[eigenvalues.length - 1];

    // If max eigenvalue is 0 (or near zero), we are already at a global section.
    // Use a small alpha to avoid division by zero.
    const alpha = maxEigenvalue > 1e-14 ? 0.5 / maxEigenvalue : 0.5;

    // Initialize x as a copy of initialState.
    let x = new Float64Array(initialState);

    let iterations = 0;
    let converged = false;

    for (let k = 0; k < this.maxIterations; k++) {
      iterations = k + 1;

      // Compute L * x as math array.
      const xArray = Array.from(x);
      const LxRaw = math.multiply(L, xArray);
      const Lx: number[] = Array.isArray(LxRaw)
        ? (LxRaw as number[])
        : ((LxRaw as math.Matrix).toArray() as number[]);

      // Compute gradient norm ||L * x||.
      let gradNormSq = 0;
      for (let i = 0; i < N0; i++) {
        gradNormSq += Lx[i] * Lx[i];
      }
      const gradNorm = Math.sqrt(gradNormSq);

      if (gradNorm < this.tolerance) {
        converged = true;
        break;
      }

      // Gradient descent update: x_{k+1} = x_k - alpha * L * x_k
      for (let i = 0; i < N0; i++) {
        x[i] -= alpha * Lx[i];
      }
    }

    const finalEnergy = this.computeDirichletEnergy(x);

    return {
      x,
      converged,
      iterations,
      finalEnergy,
    };
  }

  /**
   * computeDirichletEnergy — compute E(x) = x^T L_sheaf x.
   *
   * Returns 0 for any global section x (i.e., any x in ker(B)).
   * Returns > 0 for states that violate the consistency conditions.
   *
   * Uses mathjs multiply for the quadratic form.
   */
  computeDirichletEnergy(x: Float64Array): number {
    const L = this.sheaf.getSheafLaplacian();
    const xArray = Array.from(x);

    // Lx = L * x
    const LxRaw = math.multiply(L, xArray);
    const Lx: number[] = Array.isArray(LxRaw)
      ? (LxRaw as number[])
      : ((LxRaw as math.Matrix).toArray() as number[]);

    // energy = x^T * Lx = sum_i x[i] * Lx[i]
    let energy = 0;
    for (let i = 0; i < x.length; i++) {
      energy += xArray[i] * Lx[i];
    }

    // Clamp small negatives to 0 (floating-point noise from PSD matrix)
    return Math.max(0, energy);
  }
}
