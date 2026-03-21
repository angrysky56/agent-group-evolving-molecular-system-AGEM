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
    id;
    params;
    #status = "spawning";
    #stepsExecuted = 0;
    #synthQueries = [];
    #entitiesAdded = [];
    #relationsAdded = [];
    constructor(id, params) {
        this.id = id;
        this.params = params;
    }
    get status() {
        return this.#status;
    }
    get stepsExecuted() {
        return this.#stepsExecuted;
    }
    /** Activate the agent (transition from spawning → active). */
    activate() {
        this.#status = "active";
    }
    /**
     * Execute one reasoning step (stub for Phase 6).
     * Returns true if agent should continue, false if done (self-terminated).
     */
    async executeStep() {
        if (this.#status !== "active")
            return false;
        this.#stepsExecuted++;
        // Phase 6 stub: generate synthetic bridging query
        const query = `VdW probe: What bridges community ${this.params.communityA} ` +
            `to community ${this.params.communityB}? (step ${this.#stepsExecuted})`;
        this.#synthQueries.push(query);
        // Generate synthetic bridge entity on the first step
        if (this.#stepsExecuted === 1) {
            const entity = `vdw-bridge-${this.params.gapId}-${this.id}`;
            this.#entitiesAdded.push(entity);
            this.#relationsAdded.push({
                from: entity,
                to: `community-${this.params.communityA}`,
                type: "vdw-bridge",
            });
        }
        // Self-terminate if maxIterations reached
        if (this.#stepsExecuted >= this.params.maxIterations) {
            this.#status = "terminated";
            return false;
        }
        return true;
    }
    /** Force terminate the agent immediately. */
    terminate() {
        this.#status = "terminated";
    }
    /** Get the results of this agent's exploration. */
    getResults() {
        return {
            synthQueries: [...this.#synthQueries],
            entitiesAdded: [...this.#entitiesAdded],
            relationsAdded: [...this.#relationsAdded],
            stepsExecuted: this.#stepsExecuted,
            success: this.#stepsExecuted > 0,
        };
    }
}
const DEFAULT_SPAWNER_CONFIG = {
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
    #eventBus;
    #config;
    /** Active VdW agents awaiting execution. */
    #agents = [];
    /** H^1 hysteresis tracking: consecutive iterations at or above threshold. */
    #h1AboveThresholdCount = 0;
    /** Current regime classification (updated by external caller via updateRegime()). */
    #currentRegime = "nascent";
    /** Spawn cooldown: gapId -> last spawn iteration. */
    #gapSpawnHistory = new Map();
    /** Agent ID counter. */
    #agentCounter = 0;
    constructor(eventBus, config = {}) {
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
    updateRegime(regime) {
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
    updateH1Dimension(h1Dimension) {
        if (h1Dimension >= this.#config.h1Threshold) {
            this.#h1AboveThresholdCount++;
        }
        else {
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
    async evaluateAndSpawn(gaps, h1Dimension, iteration) {
        if (this.#shouldSuppressSpawn(gaps)) {
            return [];
        }
        const regime = this.#currentRegime;
        const tokenBudget = this.#computeTokenBudget(regime, h1Dimension);
        const agentsPerGap = this.#determineAgentsPerGap(regime, h1Dimension);
        // Limit by nascent regime (max 1 agent total)
        const maxNewAgents = regime === "nascent"
            ? 1
            : this.#config.maxConcurrentAgents - this.#agents.length;
        if (maxNewAgents <= 0) {
            return [];
        }
        // Step 6: Filter gaps by cooldown and spawn cap
        const spawnedAgents = [];
        for (const gap of gaps) {
            if (spawnedAgents.length >= maxNewAgents) {
                break;
            }
            const gapId = `gap-${gap.communityA}-${gap.communityB}`;
            // Check cooldown: skip if gap was spawned within cooldown window
            const lastSpawnIteration = this.#gapSpawnHistory.get(gapId);
            if (lastSpawnIteration !== undefined &&
                iteration - lastSpawnIteration < this.#config.spawnCooldownIterations) {
                continue;
            }
            // Spawn agentsPerGap agents for this gap (subject to overall cap)
            const agentsForThisGap = Math.min(agentsPerGap, maxNewAgents - spawnedAgents.length);
            for (let i = 0; i < agentsForThisGap; i++) {
                const agentId = `vdw-agent-${++this.#agentCounter}`;
                const params = {
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
                await this.#emitSpawnEvent(agentId, h1Dimension, gapId, tokenBudget, iteration);
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
    async runAgents() {
        // Process all currently active agents (snapshot the list to avoid mutation during iteration)
        const agentsToRun = [...this.#agents.filter((a) => a.status === "active")];
        for (const agent of agentsToRun) {
            // Run agent to completion (bounded by maxIterations via self-termination)
            let continueRunning = true;
            while (continueRunning) {
                continueRunning = await agent.executeStep();
            }
            // Get results and emit completion event
            const results = agent.getResults();
            await this.#emitCompleteEvent(agent, results);
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
    getActiveAgentCount() {
        return this.#agents.filter((a) => a.status === "active").length;
    }
    /**
     * getH1HysteresisStatus — returns current H^1 hysteresis state for monitoring.
     */
    getH1HysteresisStatus() {
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
    cleanup() {
        for (const agent of this.#agents) {
            agent.terminate();
        }
        this.#agents = [];
    }
    // -------------------------------------------------------------------------
    // Private Helper Methods
    // -------------------------------------------------------------------------
    #shouldSuppressSpawn(gaps) {
        // 1. Check hysteresis
        if (this.#h1AboveThresholdCount < this.#config.h1HysteresisCount) {
            return true;
        }
        // 2. Check regime gating
        if (this.#currentRegime === "stable") {
            return true;
        }
        // 3. No gaps to spawn for
        if (gaps.length === 0) {
            return true;
        }
        return false;
    }
    #computeTokenBudget(regime, h1Dimension) {
        if (regime === "nascent") {
            return 500;
        }
        return Math.max(500, Math.floor(5000 / h1Dimension));
    }
    #determineAgentsPerGap(regime, h1Dimension) {
        return regime === "critical" && h1Dimension >= 5 ? 2 : 1;
    }
    async #emitSpawnEvent(agentId, h1Dimension, gapId, tokenBudget, iteration) {
        const spawnedEvent = {
            type: "orch:vdw-agent-spawned",
            agentId,
            iteration,
            h1Dimension,
            gapId,
            tokenBudget,
            maxIterations: this.#config.agentMaxIterations,
            regime: this.#currentRegime,
        };
        await this.#eventBus.emit(spawnedEvent);
    }
    async #emitCompleteEvent(agent, results) {
        const completeEvent = {
            type: "orch:vdw-agent-complete",
            agentId: agent.id,
            iteration: agent.params.h1Dimension,
            synthQueries: results.synthQueries,
            entitiesAdded: results.entitiesAdded,
            relationsAdded: results.relationsAdded,
            stepsExecuted: results.stepsExecuted,
            success: results.success,
        };
        await this.#eventBus.emit(completeEvent);
    }
}
//# sourceMappingURL=VdWAgentSpawner.js.map