/**
 * SheafLaplacian.ts
 *
 * Computes and caches the Sheaf Laplacian L_sheaf = B^T B.
 *
 * Mathematical properties guaranteed by this implementation:
 *   1. Shape: N_0 x N_0 (c0Dimension x c0Dimension)
 *   2. Symmetric: L_sheaf[i][j] = L_sheaf[j][i] (exact, not just approximately)
 *   3. Positive semidefinite: all eigenvalues >= 0 (up to numerical tolerance -1e-12)
 *   4. Null space = global sections (ker B) = H^0
 *   5. For a flat sheaf on a connected graph: dim(ker B) = stalkDim
 *
 * The eigenspectrum is forward-compatible with Phase 4 Von Neumann entropy:
 *   S = -Σ λ_i log(λ_i)
 */

import * as math from "mathjs";
import { CellularSheaf } from "./CellularSheaf.js";
import { buildCoboundaryMatrix } from "./CoboundaryOperator.js";
import type { SheafEigenspectrum } from "../types/index.js";

export class SheafLaplacian {
  private readonly sheaf: CellularSheaf;
  private cachedB: math.Matrix | null = null;
  private cachedL: math.Matrix | null = null;

  constructor(sheaf: CellularSheaf) {
    this.sheaf = sheaf;
  }

  /**
   * getCoboundaryMatrix — returns the coboundary operator B (N_1 x N_0 matrix).
   * Lazily computed and cached.
   */
  getCoboundaryMatrix(): math.Matrix {
    if (this.cachedB === null) {
      this.cachedB = buildCoboundaryMatrix(this.sheaf);
    }
    return this.cachedB;
  }

  /**
   * getSheafLaplacian — returns L_sheaf = B^T B (N_0 x N_0 matrix).
   * Lazily computed and cached.
   *
   * L_sheaf is symmetric positive semidefinite by construction (it equals B^T B
   * for any real matrix B).
   */
  getSheafLaplacian(): math.Matrix {
    if (this.cachedL === null) {
      const B = this.getCoboundaryMatrix();
      const BT = math.transpose(B);
      this.cachedL = math.multiply(BT, B) as math.Matrix;
    }
    return this.cachedL;
  }

  /**
   * getEigenspectrum — compute eigenvalues of L_sheaf sorted ascending.
   *
   * Uses math.eigs() on the symmetric positive semidefinite L_sheaf.
   * Small negative eigenvalues (down to -1e-12) are normal floating-point noise
   * from the B^T B multiplication and are NOT sign errors.
   *
   * The computedAtIteration field defaults to 0 in Phase 1.
   * Phase 5 (Orchestrator) will set this to the current consensus round.
   */
  getEigenspectrum(): SheafEigenspectrum {
    const L = this.getSheafLaplacian();
    const N0 = this.sheaf.c0Dimension;

    // math.eigs() returns { values, vectors } for symmetric matrices.
    const result = math.eigs(L);

    // Extract eigenvalues. math.eigs returns them in the .values property.
    // The type may be math.Matrix or a plain array depending on the input.
    let rawValues: number[];
    const vals = result.values;
    if (Array.isArray(vals)) {
      rawValues = vals as number[];
    } else {
      // math.Matrix — convert to flat array
      rawValues = (vals as math.Matrix).toArray() as number[];
    }

    // Sort ascending (math.eigs does not guarantee order).
    rawValues.sort((a, b) => a - b);

    // Convert to Float64Array.
    const eigenvalues = new Float64Array(N0);
    for (let i = 0; i < rawValues.length && i < N0; i++) {
      eigenvalues[i] = rawValues[i];
    }

    return {
      eigenvalues,
      computedAtIteration: 0,
    };
  }

  /**
   * invalidateCache — force recomputation on next call.
   * Call this after modifying the underlying sheaf topology.
   */
  invalidateCache(): void {
    this.cachedB = null;
    this.cachedL = null;
  }
}
