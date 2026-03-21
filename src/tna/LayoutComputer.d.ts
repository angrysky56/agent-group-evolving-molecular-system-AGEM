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
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type { LayoutConfig, LayoutOutput, LayoutExportJSON, LayoutComputerConfig } from "./interfaces.js";
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
export declare class LayoutComputer extends EventEmitter {
    #private;
    constructor(cooccurrenceGraph: CooccurrenceGraph, layoutConfig?: Partial<LayoutConfig>, computerConfig?: Partial<LayoutComputerConfig>);
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
    computeLayout(iterations?: number): LayoutOutput;
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
    computeIfDue(iteration: number): boolean;
    /**
     * adjustInterval — change computation frequency based on system regime.
     *
     * Called when 'regime:classification' event arrives via ComposeRootModule.
     * Critical/transitioning regimes need more frequent layout updates to track
     * rapidly changing graph topology.
     *
     * @param regime - Current regime string from RegimeAnalyzer.
     */
    adjustInterval(regime: string): void;
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
    exportJSON(): LayoutExportJSON;
    /**
     * getLastLayout — return the cached most recent LayoutOutput.
     *
     * Returns null before first computation.
     */
    getLastLayout(): LayoutOutput | null;
    /**
     * isConverged — return true if the layout has converged.
     *
     * Convergence = energy < convergenceEnergyThreshold.
     * Returns false before first computation (energy not yet measured).
     */
    isConverged(): boolean;
}
//# sourceMappingURL=LayoutComputer.d.ts.map