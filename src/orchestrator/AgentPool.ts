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
export class AgentPool {
  #config: PoolConfig;
  #agents: Agent[];
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #isShuttingDown: boolean = false;

  /**
   * Create an AgentPool.
   *
   * @param agentFactory - Factory function called poolSize times to create agents.
   *                       Each call must return a new unique Agent instance.
   * @param config       - Pool configuration (size, heartbeat timing).
   */
  constructor(agentFactory: () => Agent, config: PoolConfig) {
    this.#config = config;
    this.#agents = [];
    for (let i = 0; i < config.poolSize; i++) {
      this.#agents.push(agentFactory());
    }
  }

  /**
   * Initialize the pool: spawn all agents in parallel and start the heartbeat timer.
   *
   * Calls agent.spawn() on all agents simultaneously via Promise.all().
   * After all spawns complete, the heartbeat interval starts.
   *
   * @throws If any agent's spawn() rejects, the error propagates and the pool
   *         is left in an inconsistent state. Callers should handle initialization failures.
   */
  async initialize(): Promise<void> {
    await Promise.all(this.#agents.map((agent) => agent.spawn()));
    this.#heartbeatTimer = setInterval(
      () => void this.#runHeartbeat(),
      this.#config.heartbeatIntervalMs,
    );
  }

  /**
   * Run one heartbeat cycle across all agents in parallel.
   *
   * Each agent races its heartbeat() against a per-agent timeout (Promise.race).
   * If an agent times out or throws, it is marked 'terminated' without affecting others.
   * Errors are logged via console.error but not propagated.
   *
   * Per-agent timeouts (Pitfall 4 guard): prevents one slow agent from blocking
   * the entire heartbeat cycle for all other agents.
   */
  async #runHeartbeat(): Promise<void> {
    const promises = this.#agents
      .filter((agent) => agent.status !== "terminated")
      .map((agent) =>
        Promise.race([
          agent.heartbeat(),
          new Promise<void>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`Heartbeat timeout for agent ${agent.id}`)),
              this.#config.heartbeatTimeoutMs,
            ),
          ),
        ]).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Agent ${agent.id} heartbeat failed: ${message}`);
          agent.status = "terminated";
        }),
      );

    await Promise.all(promises);
  }

  /**
   * Shut down the pool: stop heartbeat timer and clean up all agents.
   *
   * Idempotent — calling shutdown() multiple times is safe (second call is a no-op).
   * All agents with status !== 'terminated' have cleanup() called in parallel.
   *
   * @returns Promise that resolves when all agent cleanups have completed.
   */
  async shutdown(): Promise<void> {
    if (this.#isShuttingDown) return;
    this.#isShuttingDown = true;

    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    await Promise.all(this.#agents.map((agent) => agent.cleanup()));
  }

  /**
   * Return all agents in the pool (including terminated ones).
   *
   * Returns a readonly view — the backing array is not copied.
   * Callers must not mutate the returned array.
   *
   * @returns Readonly array of all Agent instances.
   */
  getAgents(): readonly Agent[] {
    return this.#agents as readonly Agent[];
  }

  /**
   * Return only agents with status === 'idle'.
   *
   * Idle agents are ready to receive new tasks. The returned array is
   * a filtered snapshot — it may become stale if agent statuses change.
   *
   * @returns Readonly array of idle Agent instances.
   */
  getIdleAgents(): readonly Agent[] {
    return this.#agents.filter(
      (agent) => agent.status === "idle",
    ) as readonly Agent[];
  }

  /**
   * Return the total number of agents in the pool (active + idle + terminated).
   *
   * Helper for tests and diagnostics.
   */
  getAgentCount(): number {
    return this.#agents.length;
  }
}
