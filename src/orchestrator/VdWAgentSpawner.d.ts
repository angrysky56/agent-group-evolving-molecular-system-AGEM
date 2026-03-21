/**
 * VdWAgentSpawner.ts
 *
 * ORCH-06: Obstruction-Driven Topology Reconfiguration with Van der Waals Agent Spawning.
 *
 * Purpose: When the system detects H^1 sheaf obstructions AND the regime is in a
 * transitioning or critical state, spawn lightweight exploratory "Van der Waals" agents
 * parameterized by the obstruction magnitude. These agents perform brief exploration
 * of semantic gaps with bounded token budgets and lifetimes.
 *
 * Architecture:
 *   - VdWAgent: ephemeral reasoning agent with bounded lifecycle (max N steps)
 *   - VdWAgentSpawner: regime-gated, H^1-parameterized spawner with hysteresis + cooldown
 *   - Agents are serialized (one at a time) to avoid graph mutation races
 *   - Events emitted: 'orch:vdw-agent-spawned', 'orch:vdw-agent-complete'
 *
 * Isolation: imports ONLY from orchestrator-internal EventBus and TNA GapMetrics type.
 *   - TNA import is type-only (GapMetrics) — same isolation level as ObstructionHandler.
 *   - No imports from sheaf/, lcm/, soc/ — regime info arrives via method call, not import.
 */
import { EventBus } from "./EventBus.js";
import type { GapMetrics } from "../tna/interfaces.js";
/**
 * VdWSpawnParams — parameters for spawning a Van der Waals agent.
 */
export interface VdWSpawnParams {
    readonly h1Dimension: number;
    readonly gapId: string;
    readonly tokenBudget: number;
    readonly maxIterations: number;
    readonly communityA: number;
    readonly communityB: number;
}
/**
 * VdWAgent — lightweight, ephemeral reasoning agent for brief gap exploration.
 *
 * Lifecycle: spawning → active → (reasoning steps) → terminated
 * Self-terminates after maxIterations steps OR when marked for termination.
 *
 * In Phase 6: stub implementation (no actual LLM calls).
 * In Phase 7+: would call LLM inference for real bridging queries.
 */
export declare class VdWAgent {
    #private;
    readonly id: string;
    readonly params: VdWSpawnParams;
    constructor(id: string, params: VdWSpawnParams);
    get status(): "spawning" | "active" | "terminated";
    get stepsExecuted(): number;
    /** Activate the agent (transition from spawning → active). */
    activate(): void;
    /**
     * Execute one reasoning step (stub for Phase 6).
     * Returns true if agent should continue, false if done (self-terminated).
     */
    executeStep(): Promise<boolean>;
    /** Force terminate the agent immediately. */
    terminate(): void;
    /** Get the results of this agent's exploration. */
    getResults(): {
        synthQueries: readonly string[];
        entitiesAdded: readonly string[];
        relationsAdded: ReadonlyArray<{
            from: string;
            to: string;
            type: string;
        }>;
        stepsExecuted: number;
        success: boolean;
    };
}
/**
 * VdWSpawnerConfig — configurable parameters for VdWAgentSpawner.
 */
export interface VdWSpawnerConfig {
    /** Maximum concurrent active VdW agents. Default: 10 */
    readonly maxConcurrentAgents: number;
    /** Minimum H^1 dimension to trigger spawning. Default: 2 */
    readonly h1Threshold: number;
    /** Consecutive iterations H^1 must be >= threshold before spawning. Default: 2 */
    readonly h1HysteresisCount: number;
    /** Maximum reasoning steps per agent before self-termination. Default: 15 */
    readonly agentMaxIterations: number;
    /** Minimum iterations between re-spawns for the same gap. Default: 3 */
    readonly spawnCooldownIterations: number;
}
/**
 * VdWAgentSpawner — decides when and how many VdW agents to spawn based on:
 *   1. H^1 hysteresis: H^1 must be >= threshold for N consecutive iterations
 *   2. Regime gating: 'stable' suppresses; 'nascent' limits; 'transitioning'/'critical' enables
 *   3. Spawn count: 1 per gap (transitioning), 2 per gap (critical + H^1 >= 5)
 *   4. Token budget: max(500, 5000 / h1Dimension) — inverse scaling
 *   5. Agent cap: maxConcurrentAgents total concurrent (including already-running)
 *   6. Cooldown: same gap not re-spawned within spawnCooldownIterations
 *
 * Usage (via ObstructionHandler and ComposeRootModule):
 *   const spawner = new VdWAgentSpawner(eventBus);
 *   spawner.updateRegime('critical');
 *   spawner.updateH1Dimension(3);
 *   const agents = await spawner.evaluateAndSpawn(gaps, 3, iteration);
 *   await spawner.runAgents();
 */
export declare class VdWAgentSpawner {
    #private;
    constructor(eventBus: EventBus, config?: Partial<VdWSpawnerConfig>);
    /**
     * updateRegime — store the current regime classification.
     * Called by ObstructionHandler.updateRegime() which is called by ComposeRootModule
     * when 'regime:classification' events arrive. Regime is passed as a string to
     * maintain isolation (VdWAgentSpawner does not import from soc/).
     */
    updateRegime(regime: string): void;
    /**
     * updateH1Dimension — track H^1 hysteresis.
     *
     * If h1 >= threshold: increment consecutive count.
     * If h1 < threshold: reset count to 0.
     * This implements the 2-iteration hysteresis: spawning only occurs when
     * H^1 has been sustained above threshold for multiple consecutive iterations,
     * preventing false spawning from transient spikes.
     */
    updateH1Dimension(h1Dimension: number): void;
    /**
     * evaluateAndSpawn — main decision method for VdW agent spawning.
     *
     * Called by ObstructionHandler when an H^1 obstruction is detected.
     * Returns array of newly spawned (and activated) VdWAgent instances.
     * Returns empty array when suppressed by hysteresis, regime gating, or cap.
     *
     * @param gaps        - Structural gaps from GapDetector.findGaps()
     * @param h1Dimension - H^1 dimension from the obstruction event
     * @param iteration   - Current orchestrator iteration number
     */
    evaluateAndSpawn(gaps: ReadonlyArray<GapMetrics>, h1Dimension: number, iteration: number): Promise<VdWAgent[]>;
    /**
     * runAgents — execute all active agents to completion (serialized).
     *
     * Agents are processed one at a time (not in parallel) to avoid graph
     * mutation races when their results are integrated back into the TNA graph.
     * After each agent completes, emits 'orch:vdw-agent-complete' and removes
     * the agent from the active list.
     */
    runAgents(): Promise<void>;
    /**
     * getActiveAgentCount — returns number of currently active (not terminated) agents.
     */
    getActiveAgentCount(): number;
    /**
     * getH1HysteresisStatus — returns current H^1 hysteresis state for monitoring.
     */
    getH1HysteresisStatus(): {
        count: number;
        threshold: number;
        sustained: boolean;
    };
    /**
     * cleanup — terminate all active agents and clear the agent list.
     * Called by ObstructionHandler.shutdown() for resource cleanup.
     */
    cleanup(): void;
}
//# sourceMappingURL=VdWAgentSpawner.d.ts.map