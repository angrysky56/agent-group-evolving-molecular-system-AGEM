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
 * Salience, not weight — policy must not contaminate evidence
 * ------------------------------------------------------------
 * Reinforcement writes a separate `salience` attribute and NEVER touches
 * `weight`. This matters more than it looks. Edge `weight` is accumulated
 * co-occurrence: a *measurement* of the corpus, and the substrate Louvain, VNE,
 * H⁰ and every SOC metric are computed over. The evolver previously overwrote
 * it, which meant a rise in VNE could equally be corpus growth or the evolver
 * inflating its favourites, and nothing distinguished them. For a system whose
 * stated virtue is honest metrics, silently mutating what the metrics measure
 * is worse than any dynamics bug.
 *
 * So the two are separated by construction:
 *   weight   — evidence. Written only by the TNA ingest. Never by this class.
 *   salience — policy. A relative attention multiplier with mean 1, consumed
 *              by EXPLORATION decisions (what to probe next, which gaps to
 *              prioritise, where to spawn), never by measurement.
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
   * Operates on SALIENCE, never on edge weight. See the class header.
   *
   * 1. Snapshot current salience
   * 2. Compute Price decomposition from accumulated fitnesses
   * 3. Apply Pólya reinforcement, then conserve mass, then floor
   * 4. Store decomposition in history
   * 5. Reset fitness accumulators
   */
  evolve(iteration: number): PriceDecomposition {
    this.#iteration = iteration;

    // 1. Collect current salience and fitness.
    //    A previously-unseen edge starts at neutral salience 1.0 — salience is
    //    a RELATIVE attention multiplier with mean 1, not an accumulator.
    const edges: Array<{
      key: string;
      weight: number;
      prevWeight: number;
      fitness: number;
    }> = [];

    this.#graph.forEachEdge((edgeKey, attrs) => {
      const s = (attrs as { salience?: number }).salience ?? 1;
      const prevS = this.#previousWeights.get(edgeKey) ?? s;
      const fitnessEntry = this.#currentFitnesses.get(edgeKey);
      const f = fitnessEntry?.fitness ?? 0;
      edges.push({ key: edgeKey, weight: s, prevWeight: prevS, fitness: f });
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

    // Reinforced salience BEFORE the mass-conserving rescale.
    //
    // Order matters here, and getting it wrong makes the decomposition
    // vacuous. Normalisation pins mean salience at 1, so if Δz is measured
    // across the rescale then Δz̄ ≡ 0 by construction, selection and
    // transmission are forced to cancel, and both read 0.00000 forever — which
    // is exactly what the first version of this fix produced. The Price
    // equation must describe the change reinforcement *induced*; the rescale is
    // a separate bookkeeping step that follows it.
    const raw: number[] = edges.map((e) =>
      Math.max(0, e.weight * (1 + alpha * e.fitness)),
    );

    const meanW = relW.reduce((s, w) => s + w, 0) / n;
    const meanZ = edges.reduce((s, e) => s + e.weight, 0) / n;

    // Selection: Cov(w, z) / w̄  — z is the parent trait (pre-update salience)
    let covWZ = 0;
    for (let i = 0; i < n; i++) {
      covWZ += (relW[i] - meanW) * (edges[i].weight - meanZ);
    }
    covWZ /= n;
    const selection = meanW > 0 ? covWZ / meanW : 0;

    // Transmission: E(w × Δz) / w̄  — Δz is the reinforcement-induced change
    let ewDz = 0;
    for (let i = 0; i < n; i++) {
      ewDz += relW[i] * (raw[i] - edges[i].weight);
    }
    ewDz /= n;
    const transmission = meanW > 0 ? ewDz / meanW : 0;

    const totalChange = selection + transmission;

    // 3. Apply Pólya reinforcement to SALIENCE, with mass conserved.
    //
    //    s_new = s × (1 + α·f), then rescaled so the mean returns to 1.
    //
    //    The rescale is what makes this an urn rather than an inflator. Without
    //    it, multiplying a subset upward while leaving the rest alone merely
    //    lets the light edges catch up — measured, that FLATTENED the
    //    distribution (Gini 0.439 → 0.396 as α rose), the opposite of the
    //    rich-get-richer dynamic the design calls for. Conserving total mass
    //    means promoting the fit necessarily demotes the unfit, so selection
    //    concentrates attention instead of diluting it.
    //
    //    The floor is the guard against that concentration becoming amnesia: no
    //    edge can be driven to zero salience and disappear from consideration
    //    entirely, however long it goes unrewarded.
    const newWeights = new Map<string, number>();
    const rawTotal = raw.reduce((s, v) => s + v, 0);
    const scale = rawTotal > 0 ? n / rawTotal : 1; // target mean = 1

    for (let i = 0; i < n; i++) {
      const e = edges[i];
      const scaled = Math.max(this.#config.minSalience, raw[i] * scale);
      try {
        this.#graph.setEdgeAttribute(e.key, "salience", scaled);
      } catch {
        // Edge may have been removed between iterations
      }
      newWeights.set(e.key, scaled);
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
  /**
   * Salience of every edge, highest first — the exploration-priority ranking.
   *
   * This is the intended consumer surface: what to probe next, which gaps to
   * prioritise, where to spawn. It is deliberately NOT wired into any metric.
   * Mean salience is 1 by construction, so a value above 1 means "the
   * reinforcement history says attend here", below 1 means "deprioritised but
   * never discarded" (see `minSalience`).
   */
  getSalienceRanking(): Array<{ edgeKey: string; salience: number }> {
    const out: Array<{ edgeKey: string; salience: number }> = [];
    this.#graph.forEachEdge((edgeKey, attrs) => {
      out.push({
        edgeKey,
        salience: (attrs as { salience?: number }).salience ?? 1,
      });
    });
    return out.sort((a, b) => b.salience - a.salience || a.edgeKey.localeCompare(b.edgeKey));
  }

  /** Salience of one edge; 1.0 (neutral) if never reinforced. */
  getSalience(edgeKey: string): number {
    try {
      return (
        (this.#graph.getEdgeAttribute(edgeKey, "salience") as number) ?? 1
      );
    } catch {
      return 1;
    }
  }

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
