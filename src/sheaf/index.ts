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

// Core sheaf data structure
export { CellularSheaf } from "./CellularSheaf.js";

// Laplacian computation
export { SheafLaplacian } from "./SheafLaplacian.js";

// Coboundary operator (used by ADMM in future phases)
export { buildCoboundaryMatrix } from "./CoboundaryOperator.js";

// Cohomology analysis (SVD-based H^0/H^1 computation + event emission)
export { CohomologyAnalyzer, computeCohomology } from "./CohomologyAnalyzer.js";

// ADMM solver (Phase 1 stub: gradient descent; Phase 5+ full ADMM)
export { ADMMSolver } from "./ADMMSolver.js";
export type {
  ADMMStepResult,
  ConvergenceResult,
  ConsensusResult,
} from "./ADMMSolver.js";

// Test helper factories (re-exported for integration tests in Phase 5)
export { buildFlatSheaf } from "./helpers/flatSheafFactory.js";
export { buildThreeCycleInconsistentSheaf } from "./helpers/threeCycleFactory.js";
