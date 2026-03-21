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
import { CellularSheaf } from "./CellularSheaf.js";
export interface ADMMStepResult {
    readonly x: Float64Array;
    readonly primalResidual: number;
    readonly dualResidual: number;
}
export interface ConvergenceResult {
    readonly converged: boolean;
    readonly primalResidual: number;
    readonly dualResidual: number;
    readonly iteration: number;
}
export interface ConsensusResult {
    readonly x: Float64Array;
    readonly converged: boolean;
    readonly iterations: number;
    readonly finalEnergy: number;
}
export declare class ADMMSolver {
    readonly sheaf: CellularSheaf;
    private readonly maxIterations;
    private readonly tolerance;
    private readonly rho;
    constructor(sheaf: CellularSheaf, options?: {
        maxIterations?: number;
        tolerance?: number;
        rho?: number;
    });
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
    solve(initialState: Float64Array): ConsensusResult;
    /**
     * computeDirichletEnergy — compute E(x) = x^T L_sheaf x.
     *
     * Returns 0 for any global section x (i.e., any x in ker(B)).
     * Returns > 0 for states that violate the consistency conditions.
     *
     * Uses mathjs multiply for the quadratic form.
     */
    computeDirichletEnergy(x: Float64Array): number;
}
//# sourceMappingURL=ADMMSolver.d.ts.map