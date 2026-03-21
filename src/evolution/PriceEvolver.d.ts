/**
 * PriceEvolver.ts
 *
 * Evolutionary feedback mechanism for AGEM reasoning paths.
 *
 * Implements the Price equation to track and drive selection pressure
 * on TNA graph edges. Subscribes to EventBus events to compute fitness,
 * applies Pólya-style reinforcement to edge weights, and decomposes
 * population-level change into selection vs transmission components.
 *
 * The Price equation:
 *   Δz̄ = Cov(w,z)/w̄  +  E(wΔz)/w̄
 *   where w = fitness, z = trait (edge weight)
 *
 * Dependencies:
 *   - graphology AbstractGraph (TNA graph, injected)
 *   - EventBus events: soc:metrics, lumpability:*, sheaf:*, regime:*
 *   - No LLM inference — pure mathematical feedback
 */
import type { AbstractGraph } from "graphology-types";
import type { PriceEvolverConfig, PriceDecomposition, EdgeFitness } from "./interfaces.js";
export declare class PriceEvolver {
    #private;
    constructor(graph: AbstractGraph, config?: Partial<PriceEvolverConfig>);
    /** Update regime — drives learning rate adaptation. */
    onRegimeChange(regime: string): void;
    /** Record H¹ change for fitness computation. */
    onCohomologyUpdate(h1Dimension: number): void;
    /** Record SOC metrics for CDP-based fitness. */
    onSOCMetrics(cdp: number): void;
    /** Reward edges near bridge nodes when a gap closes. */
    onGapClosure(bridgeNodes: readonly string[]): void;
    /** Penalize edges associated with weak lumpability. */
    onWeakLumpability(sourceEntryIds: readonly string[]): void;
    /**
     * evolve() — called once per iteration after all events have fired.
     *
     * 1. Snapshot current weights
     * 2. Compute Price decomposition from accumulated fitnesses
     * 3. Apply Pólya reinforcement to edge weights
     * 4. Store decomposition in history
     * 5. Reset fitness accumulators
     *
     * Returns the Price decomposition for this iteration.
     */
    evolve(iteration: number): PriceDecomposition;
    /** Get the full Price decomposition history. */
    getHistory(): readonly PriceDecomposition[];
    /** Get the latest decomposition. */
    getLatest(): PriceDecomposition | null;
    /** Get current explore/exploit ratio (0 = pure exploit, 1 = pure explore). */
    getExploreExploitRatio(): number;
    /** Get current effective learning rate. */
    getCurrentLearningRate(): number;
    /** Get all edge fitness entries for the current iteration. */
    getCurrentFitnesses(): readonly EdgeFitness[];
}
//# sourceMappingURL=PriceEvolver.d.ts.map