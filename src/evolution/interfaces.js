/**
 * interfaces.ts
 *
 * Types for the Price Equation evolutionary feedback module.
 *
 * The Price equation decomposes population-level change into:
 *   Δz̄ = Cov(w,z)/w̄  +  E(wΔz)/w̄
 *         ↑ selection      ↑ transmission bias
 *
 * In AGEM: "population" = TNA graph edges, "fitness" = outcome-derived scores,
 * "trait" = edge weight (reasoning path strength).
 *
 * ZERO external imports — pure TypeScript interfaces only.
 */
export const DEFAULT_PRICE_CONFIG = {
    baseLearningRate: 0.1,
    nascentMultiplier: 2.0,
    stableMultiplier: 0.3,
    criticalMultiplier: 1.0,
    gapClosureFitness: 1.0,
    h1ReductionFitness: 0.8,
    cdpIncreaseFitness: 0.5,
    weakLumpabilityPenalty: -0.6,
    minEdgeWeight: 0.1,
    maxHistory: 100,
};
//# sourceMappingURL=interfaces.js.map