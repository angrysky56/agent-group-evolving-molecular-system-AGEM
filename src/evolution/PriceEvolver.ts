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
 *   where w = RELATIVE fitness, z = trait (edge weight)
 *
 * On the choice of w — this matters and was originally wrong.
 * ----------------------------------------------------------
 * The Price equation's w̄ is a normalizer that assumes w is *absolute fitness*:
 * non-negative, with a mean around 1. This implementation originally used the
 * raw signed fitness score as w. That score is 0 for the overwhelming majority
 * of edges (only a handful get tagged per iteration), so w̄ ≈ 0 and both terms
 * were divided by a near-zero quantity. The result was numerically unstable and
 * not comparable between iterations — selection jumped 0.0000 → −0.1430 →
 * −0.1467 on a real run without any corresponding change in selection pressure.
 *
 * The fix is already latent in the model: the Pólya multiplier
 *
 *     w_i = 1 + α · f_i
 *
 * IS a relative fitness. It is positive (clamped below), has mean ≈ 1 because
 * most f_i are 0, and it is exactly the factor by which edge i's weight is
 * about to be reproduced. Using it makes w̄ well-conditioned and gives
 * selection/transmission their textbook meaning: the covariance between an
 * edge's reproductive success and its weight, normalised by mean success.
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

  /** Previous H⁰. `null` until the first reading, so cycle 1 is not a "drop". */
  #previousH0: number | null = null;

  /**
   * Previous CDP. `null` until the first reading — initialising to 0 made the
   * first cycle look like a large CDP *increase* (0 → 2.45) and handed out
   * fitness for nothing.
   */
  #previousCDP: number | null = null;

  /**
   * Iteration the events currently arriving belong to.
   *
   * Set by `beginIteration()` BEFORE the event handlers run. It used to be
   * assigned only at the top of `evolve()`, which runs *after* all events have
   * fired, so `#applyRecentEdgeFitness` compared against the previous cycle's
   * number and rewarded a wider window than "edges created this iteration".
   */
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

  /**
   * Record H¹ change for fitness computation.
   *
   * Retained, but note it is effectively dormant: the geometric sheaf's H¹ is
   * ≈ 0 regardless of content (real embeddings saturate the coboundary rank),
   * so a *reduction* in it essentially never occurs. It was 0 on every cycle of
   * every real run to date. `onFragmentationUpdate` carries this channel now.
   */
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

  /**
   * Record H⁰ (semantic fragmentation) change.
   *
   * A fall in H⁰ means a new idea bridged previously disconnected topic
   * islands — the sheaf's one reliable signal, and the event most worth
   * reinforcing. Rewards edges created recently, since those are the ones that
   * did the bridging; rewarding the whole graph would give every edge the same
   * fitness and drive the selection covariance to zero.
   */
  onFragmentationUpdate(h0Dimension: number): void {
    if (this.#previousH0 !== null) {
      const delta = this.#previousH0 - h0Dimension;
      if (delta > 0) {
        this.#applyRecentEdgeFitness(
          this.#config.h0ReductionFitness * delta,
          `H⁰ reduced by ${delta} (islands bridged)`,
        );
      }
    }
    this.#previousH0 = h0Dimension;
  }

  /**
   * Mark the start of an iteration. MUST be called before the cycle's events
   * fire, so "recent edge" means edges from this cycle rather than the last.
   */
  beginIteration(iteration: number): void {
    this.#iteration = iteration;
  }

  /** Record SOC metrics for CDP-based fitness. */
  onSOCMetrics(cdp: number): void {
    if (this.#previousCDP === null) {
      this.#previousCDP = cdp;
      return; // First reading is a baseline, not an increase.
    }
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

    // 2. Compute Price equation components.
    //    w = RELATIVE fitness = the Pólya multiplier (1 + α·f), clamped to stay
    //        positive. See the header note on why raw signed fitness is wrong
    //        here: it is 0 for most edges, so w̄ ≈ 0 and both terms blow up.
    //    z  = edge weight (the trait under selection)
    //    Δz = weight − prevWeight
    const alpha = this.#getLearningRate();
    const relW = edges.map((e) =>
      Math.max(this.#config.minRelativeFitness, 1 + alpha * e.fitness),
    );

    const meanW = relW.reduce((s, w) => s + w, 0) / n;
    const meanZ = edges.reduce((s, e) => s + e.weight, 0) / n;

    // Selection: Cov(w, z) / w̄
    let covWZ = 0;
    for (let i = 0; i < n; i++) {
      covWZ += (relW[i] - meanW) * (edges[i].weight - meanZ);
    }
    covWZ /= n;
    const selection = meanW > 0 ? covWZ / meanW : 0;

    // Transmission: E(w × Δz) / w̄
    let ewDz = 0;
    for (let i = 0; i < n; i++) {
      ewDz += relW[i] * (edges[i].weight - edges[i].prevWeight);
    }
    ewDz /= n;
    const transmission = meanW > 0 ? ewDz / meanW : 0;

    const totalChange = selection + transmission;

    // 3. Apply Pólya reinforcement: w_new = w × (1 + α × fitness)
    //    Same multiplier used as relative fitness above — reproduction and
    //    the fitness that explains it are by construction the same number.
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

  /**
   * Apply fitness to edges created in the current iteration.
   *
   * `>= this.#iteration` — not `- 1`. With `beginIteration()` now setting the
   * counter before events fire, this selects exactly the edges this cycle
   * created. The old off-by-one widened the window to two cycles, which both
   * diluted the signal and gave older edges repeated rewards.
   */
  #applyRecentEdgeFitness(delta: number, reason: string): void {
    this.#graph.forEachEdge((edgeKey, attrs) => {
      const created = (attrs as { createdAtIteration?: number }).createdAtIteration;
      if (created !== undefined && created >= this.#iteration) {
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
