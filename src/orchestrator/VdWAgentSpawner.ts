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

import { EventBus } from './EventBus.js';
import type { AnyEvent } from './interfaces.js';
import type { GapMetrics } from '../tna/interfaces.js';

// ---------------------------------------------------------------------------
// VdWSpawnParams — parameters for spawning a single VdW agent
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// VdWAgent — ephemeral reasoning agent with bounded lifecycle
// ---------------------------------------------------------------------------

/**
 * VdWAgent — lightweight, ephemeral reasoning agent for brief gap exploration.
 *
 * Lifecycle: spawning → active → (reasoning steps) → terminated
 * Self-terminates after maxIterations steps OR when marked for termination.
 *
 * In Phase 6: stub implementation (no actual LLM calls).
 * In Phase 7+: would call LLM inference for real bridging queries.
 */
export class VdWAgent {
  readonly id: string;
  readonly params: VdWSpawnParams;

  #status: 'spawning' | 'active' | 'terminated' = 'spawning';
  #stepsExecuted: number = 0;
  #synthQueries: string[] = [];
  #entitiesAdded: string[] = [];
  #relationsAdded: Array<{ from: string; to: string; type: string }> = [];

  constructor(id: string, params: VdWSpawnParams) {
    this.id = id;
    this.params = params;
  }

  get status(): 'spawning' | 'active' | 'terminated' {
    return this.#status;
  }

  get stepsExecuted(): number {
    return this.#stepsExecuted;
  }

  /** Activate the agent (transition from spawning → active). */
  activate(): void {
    this.#status = 'active';
  }

  /**
   * Execute one reasoning step (stub for Phase 6).
   * Returns true if agent should continue, false if done (self-terminated).
   */
  async executeStep(): Promise<boolean> {
    if (this.#status !== 'active') return false;

    this.#stepsExecuted++;

    // Phase 6 stub: generate synthetic bridging query
    const query =
      `VdW probe: What bridges community ${this.params.communityA} ` +
      `to community ${this.params.communityB}? (step ${this.#stepsExecuted})`;
    this.#synthQueries.push(query);

    // Generate synthetic bridge entity on the first step
    if (this.#stepsExecuted === 1) {
      const entity = `vdw-bridge-${this.params.gapId}-${this.id}`;
      this.#entitiesAdded.push(entity);
      this.#relationsAdded.push({
        from: entity,
        to: `community-${this.params.communityA}`,
        type: 'vdw-bridge',
      });
    }

    // Self-terminate if maxIterations reached
    if (this.#stepsExecuted >= this.params.maxIterations) {
      this.#status = 'terminated';
      return false;
    }

    return true;
  }

  /** Force terminate the agent immediately. */
  terminate(): void {
    this.#status = 'terminated';
  }

  /** Get the results of this agent's exploration. */
  getResults(): {
    synthQueries: readonly string[];
    entitiesAdded: readonly string[];
    relationsAdded: ReadonlyArray<{ from: string; to: string; type: string }>;
    stepsExecuted: number;
    success: boolean;
  } {
    return {
      synthQueries: [...this.#synthQueries],
      entitiesAdded: [...this.#entitiesAdded],
      relationsAdded: [...this.#relationsAdded],
      stepsExecuted: this.#stepsExecuted,
      success: this.#stepsExecuted > 0,
    };
  }
}

// ---------------------------------------------------------------------------
// VdWSpawnerConfig — configurable parameters
// ---------------------------------------------------------------------------

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

const DEFAULT_SPAWNER_CONFIG: VdWSpawnerConfig = {
  maxConcurrentAgents: 10,
  h1Threshold: 2,
  h1HysteresisCount: 2,
  agentMaxIterations: 15,
  spawnCooldownIterations: 3,
};

// ---------------------------------------------------------------------------
// VdWAgentSpawner — regime-gated H^1-parameterized spawner
// ---------------------------------------------------------------------------

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
export class VdWAgentSpawner {
  readonly #eventBus: EventBus;
  readonly #config: VdWSpawnerConfig;

  /** Active VdW agents awaiting execution. */
  #agents: VdWAgent[] = [];

  /** H^1 hysteresis tracking: consecutive iterations at or above threshold. */
  #h1AboveThresholdCount: number = 0;

  /** Current regime classification (updated by external caller via updateRegime()). */
  #currentRegime: string = 'nascent';

  /** Spawn cooldown: gapId -> last spawn iteration. */
  #gapSpawnHistory: Map<string, number> = new Map();

  /** Agent ID counter. */
  #agentCounter: number = 0;

  constructor(eventBus: EventBus, config: Partial<VdWSpawnerConfig> = {}) {
    this.#eventBus = eventBus;
    this.#config = { ...DEFAULT_SPAWNER_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Public: regime and H^1 updates (called by ComposeRootModule wiring)
  // -------------------------------------------------------------------------

  /**
   * updateRegime — store the current regime classification.
   * Called by ObstructionHandler.updateRegime() which is called by ComposeRootModule
   * when 'regime:classification' events arrive. Regime is passed as a string to
   * maintain isolation (VdWAgentSpawner does not import from soc/).
   */
  updateRegime(regime: string): void {
    this.#currentRegime = regime;
  }

  /**
   * updateH1Dimension — track H^1 hysteresis.
   *
   * If h1 >= threshold: increment consecutive count.
   * If h1 < threshold: reset count to 0.
   * This implements the 2-iteration hysteresis: spawning only occurs when
   * H^1 has been sustained above threshold for multiple consecutive iterations,
   * preventing false spawning from transient spikes.
   */
  updateH1Dimension(h1Dimension: number): void {
    if (h1Dimension >= this.#config.h1Threshold) {
      this.#h1AboveThresholdCount++;
    } else {
      this.#h1AboveThresholdCount = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Public: evaluateAndSpawn
  // -------------------------------------------------------------------------

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
  async evaluateAndSpawn(
    gaps: ReadonlyArray<GapMetrics>,
    h1Dimension: number,
    iteration: number
  ): Promise<VdWAgent[]> {
    // Step 1: Check hysteresis — H^1 must have been sustained for enough iterations
    if (this.#h1AboveThresholdCount < this.#config.h1HysteresisCount) {
      return [];
    }

    // Step 2: Check regime gating
    const regime = this.#currentRegime;

    if (regime === 'stable') {
      // Stable regime: system in steady-state, no exploration needed
      return [];
    }

    if (gaps.length === 0) {
      // No gaps to spawn for
      return [];
    }

    // Step 3: Compute token budget (inverse scaling)
    let tokenBudget: number;
    if (regime === 'nascent') {
      // Nascent: forced to minimum budget regardless of H^1
      tokenBudget = 500;
    } else {
      tokenBudget = Math.max(500, Math.floor(5000 / h1Dimension));
    }

    // Step 4: Determine agents per gap based on regime and H^1
    let agentsPerGap: number;
    if (regime === 'critical' && h1Dimension >= 5) {
      agentsPerGap = 2;
    } else {
      agentsPerGap = 1;
    }

    // Step 5: Limit by nascent regime (max 1 agent total)
    const maxNewAgents =
      regime === 'nascent'
        ? 1
        : this.#config.maxConcurrentAgents - this.#agents.length;

    if (maxNewAgents <= 0) {
      // Already at agent cap
      return [];
    }

    // Step 6: Filter gaps by cooldown and spawn cap
    const spawnedAgents: VdWAgent[] = [];

    for (const gap of gaps) {
      if (spawnedAgents.length >= maxNewAgents) {
        break;
      }

      const gapId = `gap-${gap.communityA}-${gap.communityB}`;

      // Check cooldown: skip if gap was spawned within cooldown window
      const lastSpawnIteration = this.#gapSpawnHistory.get(gapId);
      if (
        lastSpawnIteration !== undefined &&
        iteration - lastSpawnIteration < this.#config.spawnCooldownIterations
      ) {
        continue;
      }

      // Spawn agentsPerGap agents for this gap (subject to overall cap)
      const agentsForThisGap = Math.min(agentsPerGap, maxNewAgents - spawnedAgents.length);

      for (let i = 0; i < agentsForThisGap; i++) {
        const agentId = `vdw-agent-${++this.#agentCounter}`;

        const params: VdWSpawnParams = {
          h1Dimension,
          gapId,
          tokenBudget,
          maxIterations: this.#config.agentMaxIterations,
          communityA: gap.communityA,
          communityB: gap.communityB,
        };

        const agent = new VdWAgent(agentId, params);
        agent.activate();
        this.#agents.push(agent);
        spawnedAgents.push(agent);

        // Emit 'orch:vdw-agent-spawned' event
        const spawnedEvent: AnyEvent = {
          type: 'orch:vdw-agent-spawned',
          agentId,
          iteration,
          h1Dimension,
          gapId,
          tokenBudget,
          maxIterations: this.#config.agentMaxIterations,
          regime,
        } as unknown as AnyEvent;

        await this.#eventBus.emit(spawnedEvent);
      }

      // Record spawn for cooldown tracking (use the iteration of first agent for this gap)
      this.#gapSpawnHistory.set(gapId, iteration);
    }

    return spawnedAgents;
  }

  // -------------------------------------------------------------------------
  // Public: runAgents
  // -------------------------------------------------------------------------

  /**
   * runAgents — execute all active agents to completion (serialized).
   *
   * Agents are processed one at a time (not in parallel) to avoid graph
   * mutation races when their results are integrated back into the TNA graph.
   * After each agent completes, emits 'orch:vdw-agent-complete' and removes
   * the agent from the active list.
   */
  async runAgents(): Promise<void> {
    // Process all currently active agents (snapshot the list to avoid mutation during iteration)
    const agentsToRun = [...this.#agents.filter((a) => a.status === 'active')];

    for (const agent of agentsToRun) {
      // Run agent to completion (bounded by maxIterations via self-termination)
      let continueRunning = true;
      while (continueRunning) {
        continueRunning = await agent.executeStep();
      }

      // Get results and emit completion event
      const results = agent.getResults();
      const completeEvent: AnyEvent = {
        type: 'orch:vdw-agent-complete',
        agentId: agent.id,
        iteration: agent.params.h1Dimension, // use h1Dimension as proxy; real iteration tracked by ObstructionHandler
        synthQueries: results.synthQueries,
        entitiesAdded: results.entitiesAdded,
        relationsAdded: results.relationsAdded,
        stepsExecuted: results.stepsExecuted,
        success: results.success,
      } as unknown as AnyEvent;

      await this.#eventBus.emit(completeEvent);

      // Remove agent from active list
      const idx = this.#agents.indexOf(agent);
      if (idx !== -1) {
        this.#agents.splice(idx, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public: inspection helpers
  // -------------------------------------------------------------------------

  /**
   * getActiveAgentCount — returns number of currently active (not terminated) agents.
   */
  getActiveAgentCount(): number {
    return this.#agents.filter((a) => a.status === 'active').length;
  }

  /**
   * getH1HysteresisStatus — returns current H^1 hysteresis state for monitoring.
   */
  getH1HysteresisStatus(): { count: number; threshold: number; sustained: boolean } {
    return {
      count: this.#h1AboveThresholdCount,
      threshold: this.#config.h1HysteresisCount,
      sustained: this.#h1AboveThresholdCount >= this.#config.h1HysteresisCount,
    };
  }

  // -------------------------------------------------------------------------
  // Public: cleanup
  // -------------------------------------------------------------------------

  /**
   * cleanup — terminate all active agents and clear the agent list.
   * Called by ObstructionHandler.shutdown() for resource cleanup.
   */
  cleanup(): void {
    for (const agent of this.#agents) {
      agent.terminate();
    }
    this.#agents = [];
  }
}
