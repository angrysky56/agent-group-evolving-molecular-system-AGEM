/**
 * src/sheaf/index.ts
 *
 * Public API barrel export for the sheaf module.
 *
 * This is the single entry point for any external consumer of the sheaf module.
 * Import from here rather than from individual files to maintain a stable API surface.
 *
 * Phase 5 (Orchestrator) will import from 'src/sheaf/index.ts'.
 * Phase 4 (SOC) imports eigenspectrum types from 'src/types/' and receives
 * eigenspectrum data via typed interfaces — it does NOT import from src/sheaf/ directly.
 *
 * The test helpers (buildFlatSheaf, buildThreeCycleInconsistentSheaf) are re-exported
 * here for use in Phase 5 integration tests. In production, these are not needed.
 */
export { CellularSheaf } from "./CellularSheaf.js";
export { SheafLaplacian } from "./SheafLaplacian.js";
export { buildCoboundaryMatrix } from "./CoboundaryOperator.js";
export { CohomologyAnalyzer, computeCohomology } from "./CohomologyAnalyzer.js";
export { ADMMSolver } from "./ADMMSolver.js";
export type { ADMMStepResult, ConvergenceResult, ConsensusResult, } from "./ADMMSolver.js";
export { buildFlatSheaf } from "./helpers/flatSheafFactory.js";
export { buildThreeCycleInconsistentSheaf } from "./helpers/threeCycleFactory.js";
//# sourceMappingURL=index.d.ts.map