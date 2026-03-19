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

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PriceEvolverConfig {
  /** Base learning rate for Pólya reinforcement. Default: 0.1 */
  readonly baseLearningRate: number;
  /** Learning rate multiplier in nascent regime (explore). Default: 2.0 */
  readonly nascentMultiplier: number;
  /** Learning rate multiplier in stable regime (exploit). Default: 0.3 */
  readonly stableMultiplier: number;
  /** Learning rate multiplier in critical regime. Default: 1.0 */
  readonly criticalMultiplier: number;
  /** Fitness reward for edges involved in gap closure. Default: 1.0 */
  readonly gapClosureFitness: number;
  /** Fitness reward for H¹ reduction. Default: 0.8 */
  readonly h1ReductionFitness: number;
  /** Fitness reward for CDP increase. Default: 0.5 */
  readonly cdpIncreaseFitness: number;
  /** Fitness penalty for weak lumpability. Default: -0.6 */
  readonly weakLumpabilityPenalty: number;
  /** Minimum edge weight floor (prevents collapse to zero). Default: 0.1 */
  readonly minEdgeWeight: number;
  /** Max history of Price decompositions to retain. Default: 100 */
  readonly maxHistory: number;
}

export const DEFAULT_PRICE_CONFIG: PriceEvolverConfig = {
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

// ---------------------------------------------------------------------------
// Fitness and decomposition types
// ---------------------------------------------------------------------------

/**
 * EdgeFitness — fitness score assigned to a TNA edge for one iteration.
 * Positive = this reasoning path contributed to progress.
 * Negative = this path was associated with degradation.
 */
export interface EdgeFitness {
  readonly edgeKey: string;
  readonly source: string;
  readonly target: string;
  readonly fitness: number;
  readonly reasons: readonly string[];
}

/**
 * PriceDecomposition — the two-term Price equation result for one iteration.
 *
 * Δz̄ = selection + transmission
 *
 * selection > 0: high-fitness edges are gaining weight (exploitation)
 * transmission > 0: edges are mutating/growing independent of fitness (exploration)
 * 
 * The ratio selection/(selection+transmission) indicates explore/exploit balance.
 */
export interface PriceDecomposition {
  readonly iteration: number;
  readonly timestamp: number;
  /** Cov(w,z)/w̄ — covariance of fitness with trait (weight). */
  readonly selection: number;
  /** E(wΔz)/w̄ — expected fitness-weighted trait change. */
  readonly transmission: number;
  /** Total population-level change Δz̄. */
  readonly totalChange: number;
  /** Mean fitness across all edges. */
  readonly meanFitness: number;
  /** Number of edges in the population. */
  readonly populationSize: number;
  /** Current regime at time of computation. */
  readonly regime: string;
}

/**
 * EvolutionSnapshot — full state of the evolver at one point in time.
 */
export interface EvolutionSnapshot {
  readonly iteration: number;
  readonly decomposition: PriceDecomposition;
  readonly edgeFitnesses: readonly EdgeFitness[];
  readonly learningRate: number;
}
