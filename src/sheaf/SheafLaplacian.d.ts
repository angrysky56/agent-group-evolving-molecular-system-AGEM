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
import type { SheafEigenspectrum } from "../types/index.js";
export declare class SheafLaplacian {
    private readonly sheaf;
    private cachedB;
    private cachedL;
    constructor(sheaf: CellularSheaf);
    /**
     * getCoboundaryMatrix — returns the coboundary operator B (N_1 x N_0 matrix).
     * Lazily computed and cached.
     */
    getCoboundaryMatrix(): math.Matrix;
    /**
     * getSheafLaplacian — returns L_sheaf = B^T B (N_0 x N_0 matrix).
     * Lazily computed and cached.
     *
     * L_sheaf is symmetric positive semidefinite by construction (it equals B^T B
     * for any real matrix B).
     */
    getSheafLaplacian(): math.Matrix;
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
    getEigenspectrum(): SheafEigenspectrum;
    /**
     * invalidateCache — force recomputation on next call.
     * Call this after modifying the underlying sheaf topology.
     */
    invalidateCache(): void;
}
//# sourceMappingURL=SheafLaplacian.d.ts.map