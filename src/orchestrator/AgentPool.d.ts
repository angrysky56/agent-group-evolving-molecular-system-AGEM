/**
 * AgentPool.ts
 *
 * Agent lifecycle management pool (ORCH-01).
 *
 * Provides: AgentPool class with initialize/shutdown/getAgents/getIdleAgents methods.
 *
 * Key design choices:
 *   - Per-agent heartbeat timeouts via Promise.race() prevent one slow agent from
 *     blocking heartbeat checks for all others (05-RESEARCH.md Pitfall 4).
 *   - Heartbeat errors are caught and logged, not propagated — graceful degradation.
 *   - Idempotent shutdown: calling shutdown() multiple times is safe.
 *   - Agent factory pattern allows test mocks to be injected.
 *
 * Imports: Agent, PoolConfig from ./interfaces.js only. No external npm dependencies.
 */
import type { Agent, PoolConfig } from "./interfaces.js";
/**
 * AgentPool — manages the lifecycle of a fixed-size pool of reasoning agents.
 *
 * Usage:
 *   const pool = new AgentPool(() => new MyAgent(), { poolSize: 4, ... });
 *   await pool.initialize(); // spawns all agents
 *   const idleAgents = pool.getIdleAgents(); // agents available for work
 *   await pool.shutdown(); // cleans up all agents
 *
 * Lifecycle:
 *   1. Constructor creates agents via factory (all start as 'spawning')
 *   2. initialize() spawns all agents in parallel, starts heartbeat timer
 *   3. Heartbeat timer fires every heartbeatIntervalMs:
 *      - Each agent's heartbeat() races against heartbeatTimeoutMs
 *      - Timed-out or failed agents marked 'terminated' without blocking others
 *   4. shutdown() clears heartbeat timer, cleans up all non-terminated agents
 */
export declare class AgentPool {
    #private;
    /**
     * Create an AgentPool.
     *
     * @param agentFactory - Factory function called poolSize times to create agents.
     *                       Each call must return a new unique Agent instance.
     * @param config       - Pool configuration (size, heartbeat timing).
     */
    constructor(agentFactory: () => Agent, config: PoolConfig);
    /**
     * Initialize the pool: spawn all agents in parallel and start the heartbeat timer.
     *
     * Calls agent.spawn() on all agents simultaneously via Promise.all().
     * After all spawns complete, the heartbeat interval starts.
     *
     * @throws If any agent's spawn() rejects, the error propagates and the pool
     *         is left in an inconsistent state. Callers should handle initialization failures.
     */
    initialize(): Promise<void>;
    /**
     * Shut down the pool: stop heartbeat timer and clean up all agents.
     *
     * Idempotent — calling shutdown() multiple times is safe (second call is a no-op).
     * All agents with status !== 'terminated' have cleanup() called in parallel.
     *
     * @returns Promise that resolves when all agent cleanups have completed.
     */
    shutdown(): Promise<void>;
    /**
     * Return all agents in the pool (including terminated ones).
     *
     * Returns a readonly view — the backing array is not copied.
     * Callers must not mutate the returned array.
     *
     * @returns Readonly array of all Agent instances.
     */
    getAgents(): readonly Agent[];
    /**
     * Return only agents with status === 'idle'.
     *
     * Idle agents are ready to receive new tasks. The returned array is
     * a filtered snapshot — it may become stale if agent statuses change.
     *
     * @returns Readonly array of idle Agent instances.
     */
    getIdleAgents(): readonly Agent[];
    /**
     * Return the total number of agents in the pool (active + idle + terminated).
     *
     * Helper for tests and diagnostics.
     */
    getAgentCount(): number;
}
//# sourceMappingURL=AgentPool.d.ts.map