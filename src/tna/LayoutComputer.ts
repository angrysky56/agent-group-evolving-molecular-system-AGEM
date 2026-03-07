/**
 * LayoutComputer.ts
 *
 * TNA-08: Force-Atlas2 layout algorithm for semantic graph visualization.
 *
 * Computes force-directed 2D positions for the TNA co-occurrence graph using
 * the ForceAtlas2 algorithm (via graphology-layout-forceatlas2). Positions make
 * community structure spatially visible: semantically related nodes cluster
 * together, structurally distant nodes spread apart.
 *
 * Key design choices:
 *   - Deterministic seeding: hash-based initial positions from node IDs.
 *   - Incremental updates: partial re-runs (N/2 iterations) after initial convergence.
 *   - Barnes-Hut optimization: O(n log n) repulsion for large graphs.
 *   - Regime-adaptive intervals: more frequent in critical/transitioning regimes.
 *   - JSON export: D3.js/Sigma.js compatible output for visualization consumers.
 *   - EventEmitter: emits 'tna:layout-updated' after each computation.
 *
 * Convergence metric:
 *   Energy = mean squared displacement from previous layout positions.
 *   First run returns Infinity (no reference). Below ~1.0 = converged.
 *
 * Dependencies:
 *   - graphology-layout-forceatlas2 (via createRequire — same CJS interop
 *     pattern as CentralityAnalyzer / graphology-metrics).
 *   - src/tna/CooccurrenceGraph.ts (read graph topology + write positions)
 *   - src/tna/interfaces.ts (layout types only)
 *   - Node.js built-ins: events, module
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 * Module isolation is verified by src/tna/isolation.test.ts.
 */

import { EventEmitter } from "events";
import { createRequire } from "module";
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type {
  LayoutConfig,
  LayoutOutput,
  LayoutExportJSON,
  LayoutComputerConfig,
  NodePosition,
} from "./interfaces.js";

// ---------------------------------------------------------------------------
// Load ForceAtlas2 via createRequire (CJS interop — no exports field)
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);

interface IForceAtlas2 {
  (
    graph: unknown,
    params: {
      iterations: number;
      settings?: Record<string, unknown>;
      getEdgeWeight?: string | null;
    },
  ): Record<string, { x: number; y: number }>;
  assign(
    graph: unknown,
    params: {
      iterations: number;
      settings?: Record<string, unknown>;
      getEdgeWeight?: string | null;
    },
  ): void;
  inferSettings(order: number): Record<string, unknown>;
}

const forceAtlas2 = _require("graphology-layout-forceatlas2") as IForceAtlas2;

// ---------------------------------------------------------------------------
// Default configurations
// ---------------------------------------------------------------------------

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  iterations: 100,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  linLogMode: false,
  gravity: 1.0,
  slowDown: 1.0,
  edgeWeightInfluence: 1.0,
  scalingRatio: 2.0,
  strongGravityMode: false,
  seed: 42,
};

const DEFAULT_COMPUTER_CONFIG: LayoutComputerConfig = {
  defaultComputeInterval: 15,
  urgentComputeInterval: 10,
  relaxedComputeInterval: 20,
  convergenceEnergyThreshold: 1.0,
  minGraphOrder: 3,
  incrementalMultiplier: 0.5,
};

// ---------------------------------------------------------------------------
// LayoutComputer class
// ---------------------------------------------------------------------------

/**
 * LayoutComputer — wraps ForceAtlas2 physics simulation for TNA graph visualization.
 *
 * Extends EventEmitter — emits 'tna:layout-updated' after each layout computation.
 *
 * Usage:
 *   const layoutComputer = new LayoutComputer(cooccurrenceGraph);
 *
 *   // Full layout (100 iterations, deterministic):
 *   const output = layoutComputer.computeLayout();
 *   console.log('Energy:', output.energy);
 *   console.log('Positions:', output.positions.get('neuron'));
 *
 *   // Incremental update (50 iterations, regime-adaptive):
 *   const updated = layoutComputer.computeIfDue(iteration);
 *
 *   // JSON export for D3.js / Sigma.js:
 *   const json = layoutComputer.exportJSON();
 *   const serialized = JSON.stringify(json);
 *
 *   // Convergence check:
 *   console.log('Converged:', layoutComputer.isConverged());
 */
export class LayoutComputer extends EventEmitter {
  readonly #cooccurrenceGraph: CooccurrenceGraph;
  readonly #layoutConfig: LayoutConfig;
  readonly #computerConfig: LayoutComputerConfig;

  /** Most recent layout output (null until first computation). */
  #lastLayout: LayoutOutput | null = null;

  /** Previous positions used for energy computation. */
  #previousPositions: Map<string, NodePosition> | null = null;

  /** Reasoning iteration at which centrality was last computed. */
  #lastComputeIteration: number = 0;

  /** Current computation interval (adjusted by regime). */
  #currentInterval: number;

  /** True after the first full layout has been computed. */
  #hasComputedInitial: boolean = false;

  constructor(
    cooccurrenceGraph: CooccurrenceGraph,
    layoutConfig?: Partial<LayoutConfig>,
    computerConfig?: Partial<LayoutComputerConfig>,
  ) {
    super();
    this.#cooccurrenceGraph = cooccurrenceGraph;
    this.#layoutConfig = { ...DEFAULT_LAYOUT_CONFIG, ...layoutConfig };
    this.#computerConfig = { ...DEFAULT_COMPUTER_CONFIG, ...computerConfig };
    this.#currentInterval = this.#computerConfig.defaultComputeInterval;
  }

  // --------------------------------------------------------------------------
  // Public: computeLayout()
  // --------------------------------------------------------------------------

  /**
   * computeLayout — run ForceAtlas2 physics simulation and update node positions.
   *
   * Algorithm:
   *   1. Check graph has sufficient nodes (≥ minGraphOrder). Return trivial layout if not.
   *   2. Seed initial positions deterministically from node ID hashes (first run only).
   *   3. Run ForceAtlas2 assign() with configured physics parameters.
   *   4. Read positions from graphology node attributes.
   *   5. Compute convergence energy vs. previous positions.
   *   6. Write positions to CooccurrenceGraph via updateNodePosition().
   *   7. Emit 'tna:layout-updated'.
   *   8. Return LayoutOutput.
   *
   * @param iterations - Override number of physics iterations (default: config.iterations).
   * @returns LayoutOutput with positions, energy, counts.
   */
  computeLayout(iterations?: number): LayoutOutput {
    const graph = this.#cooccurrenceGraph.getGraph();
    const nodeCount = graph.order;
    const edgeCount = graph.size;
    const physicsIterations = iterations ?? this.#layoutConfig.iterations;

    // Trivial layout: graph too small for meaningful ForceAtlas2.
    if (nodeCount < this.#computerConfig.minGraphOrder) {
      const positions = this.#buildTrivialLayout(graph);
      const output: LayoutOutput = {
        positions,
        energy: 0,
        iterations: 0,
        nodeCount,
        edgeCount,
      };
      this.#lastLayout = output;
      // Do NOT emit event for trivial layouts (per plan spec T36).
      return output;
    }

    // Step 1: Seed positions deterministically on first run.
    this.#seedPositions(graph);

    // Step 2: Run ForceAtlas2.
    forceAtlas2.assign(graph, {
      iterations: physicsIterations,
      settings: {
        barnesHutOptimize: this.#layoutConfig.barnesHutOptimize,
        barnesHutTheta: this.#layoutConfig.barnesHutTheta,
        linLogMode: this.#layoutConfig.linLogMode,
        gravity: this.#layoutConfig.gravity,
        slowDown: this.#layoutConfig.slowDown,
        edgeWeightInfluence: this.#layoutConfig.edgeWeightInfluence,
        scalingRatio: this.#layoutConfig.scalingRatio,
        strongGravityMode: this.#layoutConfig.strongGravityMode,
      },
      getEdgeWeight: "weight",
    });

    // Step 3: Read positions from graph node attributes.
    const currentPositions = new Map<string, NodePosition>();
    graph.forEachNode((nodeId: string) => {
      const x = graph.getNodeAttribute(nodeId, "x") as number | undefined;
      const y = graph.getNodeAttribute(nodeId, "y") as number | undefined;
      if (x !== undefined && y !== undefined && isFinite(x) && isFinite(y)) {
        currentPositions.set(nodeId, { x, y });
      } else {
        // Fallback: use seeded position if ForceAtlas2 produced invalid values.
        const fallback = this.#hashPosition(nodeId);
        currentPositions.set(nodeId, fallback);
        graph.setNodeAttribute(nodeId, "x", fallback.x);
        graph.setNodeAttribute(nodeId, "y", fallback.y);
      }
    });

    // Step 4: Compute convergence energy.
    const energy = this.#computeEnergy(
      this.#previousPositions,
      currentPositions,
    );

    // Step 5: Write positions to CooccurrenceGraph metadata.
    for (const [nodeId, pos] of currentPositions) {
      this.#cooccurrenceGraph.updateNodePosition(nodeId, pos.x, pos.y);
    }

    // Step 6: Build output.
    const output: LayoutOutput = {
      positions: currentPositions as ReadonlyMap<string, NodePosition>,
      energy,
      iterations: physicsIterations,
      nodeCount,
      edgeCount,
    };

    // Step 7: Update state.
    this.#previousPositions = currentPositions;
    this.#lastLayout = output;

    // Step 8: Emit event.
    this.emit("tna:layout-updated", {
      type: "tna:layout-updated",
      iteration: this.#lastComputeIteration,
      energy,
      nodeCount,
      physicsIterations,
    });

    return output;
  }

  // --------------------------------------------------------------------------
  // Public: computeIfDue()
  // --------------------------------------------------------------------------

  /**
   * computeIfDue — conditionally run layout based on interval schedule.
   *
   * Called by the orchestrator each iteration. Only runs the expensive
   * ForceAtlas2 computation when the schedule interval has elapsed.
   *
   * Initial run: full iterations (100 by default).
   * Subsequent runs: incremental (iterations * incrementalMultiplier).
   *
   * @param iteration - The current reasoning iteration number.
   * @returns true if layout was computed, false if skipped.
   */
  computeIfDue(iteration: number): boolean {
    const elapsed = iteration - this.#lastComputeIteration;

    // Always run the initial full layout (warm-up) regardless of interval.
    // Subsequent runs are gated by the interval.
    if (this.#hasComputedInitial && elapsed < this.#currentInterval) {
      return false;
    }

    // Determine iterations count for this run.
    const physicsIter = this.#hasComputedInitial
      ? Math.max(
          1,
          Math.round(
            this.#layoutConfig.iterations *
              this.#computerConfig.incrementalMultiplier,
          ),
        )
      : this.#layoutConfig.iterations;

    this.computeLayout(physicsIter);
    this.#hasComputedInitial = true;
    this.#lastComputeIteration = iteration;

    return true;
  }

  // --------------------------------------------------------------------------
  // Public: adjustInterval()
  // --------------------------------------------------------------------------

  /**
   * adjustInterval — change computation frequency based on system regime.
   *
   * Called when 'regime:classification' event arrives via ComposeRootModule.
   * Critical/transitioning regimes need more frequent layout updates to track
   * rapidly changing graph topology.
   *
   * @param regime - Current regime string from RegimeAnalyzer.
   */
  adjustInterval(regime: string): void {
    switch (regime) {
      case "transitioning":
      case "critical":
        this.#currentInterval = this.#computerConfig.urgentComputeInterval;
        break;
      case "stable":
        this.#currentInterval = this.#computerConfig.relaxedComputeInterval;
        break;
      default:
        this.#currentInterval = this.#computerConfig.defaultComputeInterval;
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Public: exportJSON()
  // --------------------------------------------------------------------------

  /**
   * exportJSON — build a JSON-serializable layout export.
   *
   * Output is compatible with D3.js force simulation and Sigma.js.
   * Contains all nodes (with positions, community, centrality, label),
   * all edges (source, target, weight), and metadata.
   *
   * If no layout has been computed, positions default to (0, 0) for all nodes.
   *
   * @returns LayoutExportJSON — fully JSON-serializable layout snapshot.
   */
  exportJSON(): LayoutExportJSON {
    const graph = this.#cooccurrenceGraph.getGraph();

    // Build node list with positions and metadata.
    const nodes: Array<{
      id: string;
      x: number;
      y: number;
      communityId?: number;
      betweennessCentrality?: number;
      label: string;
    }> = [];

    graph.forEachNode((nodeId: string) => {
      const pos = this.#cooccurrenceGraph.getNodePosition(nodeId);
      const textNode = this.#cooccurrenceGraph.getNode(nodeId);
      nodes.push({
        id: nodeId,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        communityId: textNode?.communityId,
        betweennessCentrality: textNode?.betweennessCentrality,
        label: nodeId, // For TNA nodes, label = canonical lemma
      });
    });

    // Build edge list.
    const edges: Array<{ source: string; target: string; weight: number }> = [];
    graph.forEachEdge(
      (
        _edgeId: string,
        attrs: Record<string, unknown>,
        source: string,
        target: string,
      ) => {
        edges.push({
          source,
          target,
          weight: (attrs["weight"] as number | undefined) ?? 1,
        });
      },
    );

    const lastLayout = this.#lastLayout;

    return {
      nodes,
      edges,
      metadata: {
        nodeCount: graph.order,
        edgeCount: graph.size,
        energy: lastLayout?.energy ?? 0,
        iterations: lastLayout?.iterations ?? 0,
        timestamp: Date.now(),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Public: getLastLayout()
  // --------------------------------------------------------------------------

  /**
   * getLastLayout — return the cached most recent LayoutOutput.
   *
   * Returns null before first computation.
   */
  getLastLayout(): LayoutOutput | null {
    return this.#lastLayout;
  }

  // --------------------------------------------------------------------------
  // Public: isConverged()
  // --------------------------------------------------------------------------

  /**
   * isConverged — return true if the layout has converged.
   *
   * Convergence = energy < convergenceEnergyThreshold.
   * Returns false before first computation (energy not yet measured).
   */
  isConverged(): boolean {
    if (this.#lastLayout === null) return false;
    return (
      this.#lastLayout.energy < this.#computerConfig.convergenceEnergyThreshold
    );
  }

  // --------------------------------------------------------------------------
  // Private: #computeEnergy()
  // --------------------------------------------------------------------------

  /**
   * #computeEnergy — compute mean squared displacement between two position maps.
   *
   * Energy = Σ[(x_new - x_old)² + (y_new - y_old)²] / nodeCount
   *
   * Returns Infinity if no previous positions exist (first computation).
   * Returns 0 if positions are identical.
   *
   * @param prev - Previous position map (null = first run).
   * @param curr - Current position map.
   * @returns Mean squared displacement energy.
   */
  #computeEnergy(
    prev: Map<string, NodePosition> | null,
    curr: Map<string, NodePosition>,
  ): number {
    if (prev === null || prev.size === 0) {
      return Infinity;
    }

    let totalSq = 0;
    let count = 0;

    for (const [nodeId, currPos] of curr) {
      const prevPos = prev.get(nodeId);
      if (prevPos !== undefined) {
        const dx = currPos.x - prevPos.x;
        const dy = currPos.y - prevPos.y;
        totalSq += dx * dx + dy * dy;
        count++;
      }
    }

    if (count === 0) return 0;
    return totalSq / count;
  }

  // --------------------------------------------------------------------------
  // Private: #seedPositions()
  // --------------------------------------------------------------------------

  /**
   * #seedPositions — assign deterministic initial positions to unpositioned nodes.
   *
   * ForceAtlas2 requires nodes to have initial (x, y) attributes set on the graph.
   * Without seeds, different runs may start from random positions → non-determinism.
   *
   * Algorithm: For each node without existing x/y, compute a hash-based position
   * using the node ID string. This is deterministic (same ID → same seed position).
   *
   * @param graph - The graphology graph instance.
   */
  #seedPositions(graph: unknown): void {
    const g = graph as {
      forEachNode: (cb: (nodeId: string) => void) => void;
      getNodeAttribute: (nodeId: string, attr: string) => unknown;
      setNodeAttribute: (nodeId: string, attr: string, value: number) => void;
    };

    g.forEachNode((nodeId: string) => {
      const existingX = g.getNodeAttribute(nodeId, "x");
      const existingY = g.getNodeAttribute(nodeId, "y");

      // Only seed if node has no position OR position is 0 (default uninitialized).
      if (existingX === undefined || existingX === null || existingX === 0) {
        const pos = this.#hashPosition(nodeId);
        g.setNodeAttribute(nodeId, "x", pos.x);
        g.setNodeAttribute(nodeId, "y", pos.y);
      } else if (
        existingY === undefined ||
        existingY === null ||
        existingY === 0
      ) {
        const pos = this.#hashPosition(nodeId);
        g.setNodeAttribute(nodeId, "y", pos.y);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Private: #hashPosition()
  // --------------------------------------------------------------------------

  /**
   * #hashPosition — compute a deterministic 2D position from a node ID string.
   *
   * Uses polynomial rolling hash (Bernstein hash variant) to convert the string
   * to two independent floating-point coordinates in the range [-50, 50].
   *
   * @param nodeId - Node identifier string.
   * @returns Deterministic { x, y } position.
   */
  #hashPosition(nodeId: string): NodePosition {
    // Compute two independent hash values from the same string.
    // Using different seed constants to get orthogonal x and y.
    let hashX = this.#layoutConfig.seed;
    let hashY = this.#layoutConfig.seed * 31 + 7;

    for (let i = 0; i < nodeId.length; i++) {
      const code = nodeId.charCodeAt(i);
      hashX = ((hashX << 5) + hashX + code) | 0; // Bernstein hash
      hashY = ((hashY * 31) ^ code) | 0; // FNV-variant
    }

    // Map to [-50, 50] using modulo + offset.
    // Use Math.abs to handle negative integers from bitwise ops.
    const x = (Math.abs(hashX) % 100) - 50;
    const y = (Math.abs(hashY) % 100) - 50;

    return { x: x === 0 ? 0.1 : x, y: y === 0 ? 0.1 : y };
  }

  // --------------------------------------------------------------------------
  // Private: #buildTrivialLayout()
  // --------------------------------------------------------------------------

  /**
   * #buildTrivialLayout — return hash-seeded positions for small graphs.
   *
   * ForceAtlas2 requires ≥ 3 nodes to produce meaningful physics. For smaller
   * graphs, we return deterministic hash-based positions without running the
   * simulation.
   *
   * @param graph - The graphology graph instance.
   * @returns Position map for all nodes.
   */
  #buildTrivialLayout(graph: unknown): ReadonlyMap<string, NodePosition> {
    const g = graph as {
      forEachNode: (cb: (nodeId: string) => void) => void;
    };

    const positions = new Map<string, NodePosition>();
    g.forEachNode((nodeId: string) => {
      positions.set(nodeId, this.#hashPosition(nodeId));
    });
    return positions;
  }
}
