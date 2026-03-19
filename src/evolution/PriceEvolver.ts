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
import type {
  PriceEvolverConfig,
  PriceDecomposition,
  EdgeFitness,
} from "./interfaces.js";
import { DEFAULT_PRICE_CONFIG } from "./interfaces.js";

export class PriceEvolver {
  readonly #config: PriceEvolverConfig;
  readonly #graph: AbstractGraph;
  readonly #history: PriceDecomposition[] = [];

  /** Per-edge fitness accumulators for the current iteration. */
  #currentFitnesses: Map<string, { fitness: number; reasons: string[] }> = new Map();

  /** Previous iteration's edge weights for Δz computation. */
  #previousWeights: Map<string, number> = new Map();

  /** Current regime (drives learning rate). */
  #currentRegime: string = "nascent";

  /** Previous H¹ dimension for delta tracking. */
  #previousH1: number = 0;

  /** Previous CDP for delta tracking. */
  #previousCDP: number = 0;

  /** Current iteration counter. */
  #iteration: number = 0;

  constructor(graph: AbstractGraph, config?: Partial<PriceEvolverConfig>) {
    this.#graph = graph;
    this.#config = { ...DEFAULT_PRICE_CONFIG, ...config };
  }

  // ─── Event Handlers (called by ComposeRootModule wiring) ───

  /** Update regime — drives learning rate adaptation. */
  onRegimeChange(regime: string): void {
    this.#currentRegime = regime;
  }

  /** Record H¹ change for fitness computation. */
  onCohomologyUpdate(h1Dimension: number): void {
    const delta = this.#previousH1 - h1Dimension;
    if (delta > 0) {
      // H¹ decreased — reward all current edges
      this.#applyGlobalFitness(
        this.#config.h1ReductionFitness * delta,
        `H¹ reduced by ${delta}`,
      );
    }
    this.#previousH1 = h1Dimension;
  }

  /** Record SOC metrics for CDP-based fitness. */
  onSOCMetrics(cdp: number): void {
    const delta = cdp - this.#previousCDP;
    if (delta > 0) {
      // CDP increased — reward edges created this iteration
      this.#applyRecentEdgeFitness(
        this.#config.cdpIncreaseFitness,
        `CDP increased by ${delta.toFixed(4)}`,
      );
    }
    this.#previousCDP = cdp;
  }

  /** Reward edges near bridge nodes when a gap closes. */
  onGapClosure(bridgeNodes: readonly string[]): void {
    for (const nodeId of bridgeNodes) {
      if (!this.#graph.hasNode(nodeId)) continue;
      this.#graph.forEachEdge(nodeId, (edgeKey) => {
        this.#addFitness(edgeKey, this.#config.gapClosureFitness, "bridge in gap closure");
      });
    }
  }

  /** Penalize edges associated with weak lumpability. */
  onWeakLumpability(sourceEntryIds: readonly string[]): void {
    // Penalize recently-created edges as they contributed to weak compression
    this.#applyRecentEdgeFitness(
      this.#config.weakLumpabilityPenalty,
      `weak lumpability (${sourceEntryIds.length} entries)`,
    );
  }

  // ─── Core Evolution Step ───

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
  evolve(iteration: number): PriceDecomposition {
    this.#iteration = iteration;

    // 1. Collect current edge weights and fitnesses
    const edges: Array<{
      key: string;
      weight: number;
      prevWeight: number;
      fitness: number;
    }> = [];

    this.#graph.forEachEdge((edgeKey, attrs) => {
      const w = (attrs as { weight?: number }).weight ?? 1;
      const prevW = this.#previousWeights.get(edgeKey) ?? w;
      const fitnessEntry = this.#currentFitnesses.get(edgeKey);
      const f = fitnessEntry?.fitness ?? 0;
      edges.push({ key: edgeKey, weight: w, prevWeight: prevW, fitness: f });
    });

    const n = edges.length;
    if (n === 0) {
      const empty: PriceDecomposition = {
        iteration, timestamp: Date.now(),
        selection: 0, transmission: 0, totalChange: 0,
        meanFitness: 0, populationSize: 0, regime: this.#currentRegime,
      };
      this.#pushHistory(empty);
      this.#reset();
      return empty;
    }

    // 2. Compute Price equation components
    //    w = fitness, z = weight (trait)
    //    Δz = weight - prevWeight (trait change)
    const meanW = edges.reduce((s, e) => s + e.fitness, 0) / n;
    const meanZ = edges.reduce((s, e) => s + e.weight, 0) / n;

    // Selection: Cov(w, z) / w̄
    let covWZ = 0;
    for (const e of edges) {
      covWZ += (e.fitness - meanW) * (e.weight - meanZ);
    }
    covWZ /= n;
    const selection = meanW !== 0 ? covWZ / Math.abs(meanW) : 0;

    // Transmission: E(w × Δz) / w̄
    let ewDz = 0;
    for (const e of edges) {
      const dz = e.weight - e.prevWeight;
      ewDz += e.fitness * dz;
    }
    ewDz /= n;
    const transmission = meanW !== 0 ? ewDz / Math.abs(meanW) : 0;

    const totalChange = selection + transmission;

    // 3. Apply Pólya reinforcement: w_new = w × (1 + α × fitness)
    const alpha = this.#getLearningRate();
    const newWeights = new Map<string, number>();

    for (const e of edges) {
      const reinforcement = 1 + alpha * e.fitness;
      const newWeight = Math.max(this.#config.minEdgeWeight, e.weight * reinforcement);
      try {
        this.#graph.setEdgeAttribute(e.key, "weight", newWeight);
      } catch {
        // Edge may have been removed between iterations
      }
      newWeights.set(e.key, newWeight);
    }

    // 4. Store decomposition
    const decomp: PriceDecomposition = {
      iteration,
      timestamp: Date.now(),
      selection,
      transmission,
      totalChange,
      meanFitness: meanW,
      populationSize: n,
      regime: this.#currentRegime,
    };
    this.#pushHistory(decomp);

    // 5. Prepare for next iteration
    this.#previousWeights = newWeights;
    this.#reset();

    return decomp;
  }

  // ─── Query APIs ───

  /** Get the full Price decomposition history. */
  getHistory(): readonly PriceDecomposition[] {
    return [...this.#history];
  }

  /** Get the latest decomposition. */
  getLatest(): PriceDecomposition | null {
    return this.#history.length > 0 ? this.#history[this.#history.length - 1]! : null;
  }

  /** Get current explore/exploit ratio (0 = pure exploit, 1 = pure explore). */
  getExploreExploitRatio(): number {
    const latest = this.getLatest();
    if (!latest) return 0.5;
    const total = Math.abs(latest.selection) + Math.abs(latest.transmission);
    if (total === 0) return 0.5;
    return Math.abs(latest.transmission) / total;
  }

  /** Get current effective learning rate. */
  getCurrentLearningRate(): number {
    return this.#getLearningRate();
  }

  /** Get all edge fitness entries for the current iteration. */
  getCurrentFitnesses(): readonly EdgeFitness[] {
    const result: EdgeFitness[] = [];
    for (const [edgeKey, entry] of this.#currentFitnesses) {
      try {
        const endpoints = this.#graph.extremities(edgeKey);
        result.push({
          edgeKey,
          source: endpoints[0],
          target: endpoints[1],
          fitness: entry.fitness,
          reasons: [...entry.reasons],
        });
      } catch {
        // Edge may have been removed
      }
    }
    return result;
  }

  // ─── Private Helpers ───

  #addFitness(edgeKey: string, delta: number, reason: string): void {
    const existing = this.#currentFitnesses.get(edgeKey);
    if (existing) {
      existing.fitness += delta;
      existing.reasons.push(reason);
    } else {
      this.#currentFitnesses.set(edgeKey, { fitness: delta, reasons: [reason] });
    }
  }


  /** Apply fitness to all edges in the graph. */
  #applyGlobalFitness(delta: number, reason: string): void {
    this.#graph.forEachEdge((edgeKey) => {
      this.#addFitness(edgeKey, delta, reason);
    });
  }

  /** Apply fitness to edges created in the current iteration. */
  #applyRecentEdgeFitness(delta: number, reason: string): void {
    this.#graph.forEachEdge((edgeKey, attrs) => {
      const created = (attrs as { createdAtIteration?: number }).createdAtIteration;
      if (created !== undefined && created >= this.#iteration - 1) {
        this.#addFitness(edgeKey, delta, reason);
      }
    });
  }

  /** Get regime-adapted learning rate. */
  #getLearningRate(): number {
    const base = this.#config.baseLearningRate;
    switch (this.#currentRegime) {
      case "nascent":
        return base * this.#config.nascentMultiplier;
      case "stable":
        return base * this.#config.stableMultiplier;
      case "critical":
      case "transitioning":
        return base * this.#config.criticalMultiplier;
      default:
        return base;
    }
  }

  /** Push decomposition to history, trimming if over max. */
  #pushHistory(decomp: PriceDecomposition): void {
    this.#history.push(decomp);
    if (this.#history.length > this.#config.maxHistory) {
      this.#history.splice(0, this.#history.length - this.#config.maxHistory);
    }
  }

  /** Reset per-iteration accumulators. */
  #reset(): void {
    this.#currentFitnesses = new Map();
  }
}
