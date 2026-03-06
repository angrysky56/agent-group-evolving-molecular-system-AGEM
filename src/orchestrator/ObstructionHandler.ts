/**
 * ObstructionHandler.ts
 *
 * Obstruction-driven reconfiguration handler (ROADMAP criteria #3).
 *
 * Purpose: Listen to Sheaf H^1 obstruction events and spawn GapDetector agents
 * to fill semantic voids in the TNA co-occurrence graph. This implements the
 * key AGEM feedback loop: topological obstructions → agent spawn → graph update.
 *
 * Pipeline:
 *   1. Subscribe to 'sheaf:h1-obstruction-detected' on EventBus
 *   2. Queue obstruction events (serialize processing to maintain ordering)
 *   3. For each obstruction: spawn a GapDetectorAgent from the pool
 *   4. Agent calls GapDetector.findGaps() to locate semantic voids
 *   5. Generate synthetic queries to fill gaps
 *   6. Integrate results back into TNA graph (new nodes + edges)
 *   7. Emit 'orch:obstruction-filled' event with results
 *
 * Isolation: This file imports ONLY from orchestrator-internal modules and TNA.
 * It does NOT import from sheaf/ or lcm/ — the EventBus is the decoupling layer.
 *
 * Imports:
 *   - EventBus from ./EventBus.js (event coordination)
 *   - GapDetector from ../tna/GapDetector.js (gap detection)
 *   - CooccurrenceGraph from ../tna/CooccurrenceGraph.js (graph integration)
 */

import { EventBus } from './EventBus.js';
import type { GapDetector } from '../tna/GapDetector.js';
import type { CooccurrenceGraph } from '../tna/CooccurrenceGraph.js';
import type { AnyEvent } from './interfaces.js';
import { VdWAgentSpawner } from './VdWAgentSpawner.js';
import type { VdWAgent } from './VdWAgentSpawner.js';

// ---------------------------------------------------------------------------
// GapDetectorAgent — stub agent for Phase 5
// ---------------------------------------------------------------------------

/**
 * GapDetectorAgent — stub implementation of a reasoning agent for gap filling.
 *
 * In Phase 5: synthetic stub that simulates gap-filling behavior without LLM calls.
 * In Phase 6+: would call actual LLM inference to generate bridging queries.
 *
 * Lifecycle: spawning → active → idle → terminating → terminated
 */
class GapDetectorAgent {
  /** Unique identifier for this agent instance. */
  readonly id: string;

  /** Current lifecycle status. */
  status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated';

  constructor(id: string) {
    this.id = id;
    this.status = 'spawning';
  }

  /** Initialize: transition from spawning to active. */
  async spawn(): Promise<void> {
    this.status = 'active';
  }

  /** Health probe: confirm agent is alive. */
  async heartbeat(): Promise<void> {
    // no-op for stub — always alive while active or idle
  }

  /** Release resources: transition to terminated. */
  async cleanup(): Promise<void> {
    this.status = 'terminated';
  }
}

// ---------------------------------------------------------------------------
// GapFillResult — output of a gap-filling agent run
// ---------------------------------------------------------------------------

/**
 * GapFillResult — outcome of one gap-detector agent execution.
 *
 * Returned by #runGapDetectorAgent() and passed to #integrateGapFillResults().
 */
export interface GapFillResult {
  /** Unique reference ID linking back to the original H^1 obstruction event. */
  readonly obstructionId: string;

  /** Number of semantic gaps detected in the TNA graph for this obstruction. */
  readonly gapsDetected: number;

  /** Node IDs added to the TNA graph during gap fill integration. */
  readonly entitiesAdded: string[];

  /** Edges added between entities during gap fill integration. */
  readonly relationsAdded: Array<{ from: string; to: string; type: string }>;

  /** Synthetic questions generated to guide gap bridging (for Phase 6 LLM use). */
  readonly synthQueries: string[];

  /** Unix timestamp (ms) when gap fill completed. */
  readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// ObstructionEventPayload — partial type for H^1 event received from EventBus
// ---------------------------------------------------------------------------

interface ObstructionEventPayload {
  readonly type: 'sheaf:h1-obstruction-detected';
  readonly iteration: number;
  readonly h1Dimension: number;
}

// ---------------------------------------------------------------------------
// ObstructionHandler class
// ---------------------------------------------------------------------------

/**
 * ObstructionHandler — reactive handler for H^1 sheaf obstructions.
 *
 * On construction, subscribes to 'sheaf:h1-obstruction-detected' events on the
 * injected EventBus. Each obstruction event is queued and processed asynchronously
 * via a serialized FIFO queue — this ensures ordered processing even when events
 * arrive faster than the handler can process them.
 *
 * Usage:
 *   const handler = new ObstructionHandler(eventBus, gapDetector, tnaGraph);
 *   // Auto-subscribed; will react to obstruction events on the bus.
 *   await handler.shutdown(); // drain queue and clean up
 *
 * Architecture:
 *   - Queue serialization: ensures obstruction events are processed in FIFO order.
 *   - Agent pooling: GapDetectorAgent instances are reused across events.
 *   - Graph integration: gap fill results feed back into TNA graph topology.
 *   - Monitoring: 'orch:obstruction-filled' event emitted for observability.
 */
export class ObstructionHandler {
  readonly #eventBus: EventBus;
  readonly #gapDetector: GapDetector;
  readonly #tnaGraph: CooccurrenceGraph;
  readonly #agentPool: GapDetectorAgent[];
  readonly #agentPoolSize: number;

  /** Phase 6: optional VdW agent spawner (null if not injected — backward compatible). */
  readonly #vdwSpawner: VdWAgentSpawner | null;

  /** FIFO queue of obstruction events awaiting processing. */
  #obstructionQueue: ObstructionEventPayload[] = [];

  /** Serialization lock: true while processing a queue item. */
  #isProcessing: boolean = false;

  /** Agent ID counter for unique naming. */
  #agentCounter: number = 0;

  /** Subscription cleanup function (for unsubscribe on shutdown). */
  readonly #obstructionHandler: (event: AnyEvent) => void;

  /**
   * Create an ObstructionHandler.
   *
   * @param eventBus    - Central EventBus to subscribe to and emit on.
   * @param gapDetector - TNA GapDetector for structural gap analysis.
   * @param tnaGraph    - TNA CooccurrenceGraph to integrate gap fill results into.
   * @param config      - Optional configuration (agentPoolSize defaults to 4; vdwSpawner optional).
   */
  constructor(
    eventBus: EventBus,
    gapDetector: GapDetector,
    tnaGraph: CooccurrenceGraph,
    config?: { agentPoolSize?: number; vdwSpawner?: VdWAgentSpawner }
  ) {
    this.#eventBus = eventBus;
    this.#gapDetector = gapDetector;
    this.#tnaGraph = tnaGraph;
    this.#agentPoolSize = config?.agentPoolSize ?? 4;
    this.#vdwSpawner = config?.vdwSpawner ?? null;

    // Pre-populate agent pool with idle agents
    this.#agentPool = [];
    for (let i = 0; i < this.#agentPoolSize; i++) {
      const agent = new GapDetectorAgent(`gap-detector-${++this.#agentCounter}`);
      agent.status = 'idle'; // pre-initialize as idle (spawned lazily)
      this.#agentPool.push(agent);
    }

    // Subscribe to obstruction events on the EventBus.
    // Arrow function preserves `this` binding.
    this.#obstructionHandler = (event: AnyEvent) => {
      this.#onObstructionDetected(event as unknown as ObstructionEventPayload);
    };

    this.#eventBus.subscribe('sheaf:h1-obstruction-detected', this.#obstructionHandler);
  }

  // -------------------------------------------------------------------------
  // Private: onObstructionDetected
  // -------------------------------------------------------------------------

  /**
   * #onObstructionDetected — called when 'sheaf:h1-obstruction-detected' fires.
   *
   * Enqueues the obstruction and triggers async processing.
   */
  #onObstructionDetected(event: ObstructionEventPayload): void {
    this.#obstructionQueue.push(event);
    // Trigger processing (async; no-op if already processing)
    void this.#processQueue();
  }

  // -------------------------------------------------------------------------
  // Private: processQueue
  // -------------------------------------------------------------------------

  /**
   * #processQueue — serialize obstruction processing via a FIFO queue.
   *
   * Uses an isProcessing lock to ensure only one obstruction is processed at
   * a time. When processing completes, any newly enqueued items are immediately
   * picked up (while loop).
   */
  async #processQueue(): Promise<void> {
    if (this.#isProcessing) {
      return; // already processing — queue will be drained by the running loop
    }

    this.#isProcessing = true;

    try {
      while (this.#obstructionQueue.length > 0) {
        const obstruction = this.#obstructionQueue.shift()!;
        await this.#processSingleObstruction(obstruction);
      }
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * #processSingleObstruction — process one obstruction from the queue.
   */
  async #processSingleObstruction(obstruction: ObstructionEventPayload): Promise<void> {
    // Get an idle agent from the pool (or create a new one if needed)
    let agent = this.#agentPool.find((a) => a.status === 'idle');
    if (!agent) {
      // No idle agents: create a new one (up to agentPoolSize)
      if (this.#agentPool.length < this.#agentPoolSize) {
        agent = new GapDetectorAgent(`gap-detector-${++this.#agentCounter}`);
        this.#agentPool.push(agent);
      } else {
        // All agents busy: use the first one anyway (best-effort for Phase 5)
        agent = this.#agentPool[0]!;
      }
    }

    // Spawn agent (transition to active)
    await agent.spawn();

    // Run gap detection and fill
    const gapFillResult = await this.#runGapDetectorAgent(agent, obstruction);

    // Integrate results into TNA graph
    this.#integrateGapFillResults(gapFillResult);

    // Return agent to idle state
    agent.status = 'idle';

    // Phase 6: VdW agent spawning (ORCH-06)
    await this.#processVdWSpawning(obstruction);

    // Emit monitoring event
    const filledEvent = {
      type: 'orch:obstruction-filled' as const,
      ...gapFillResult,
    };
    // Emit as unknown/any since orch:obstruction-filled is not in AnyEvent union
    await this.#eventBus.emit(filledEvent as unknown as AnyEvent);

    console.log(
      `[ORCH-OBSTRUCTION] Filled obstruction from iteration ${obstruction.iteration}: ` +
      `${gapFillResult.gapsDetected} gaps, ` +
      `${gapFillResult.entitiesAdded.length} new entities, ` +
      `${gapFillResult.relationsAdded.length} new relations`
    );
  }

  /**
   * #processVdWSpawning — handle Phase 6 VdW agent spawning logic.
   */
  async #processVdWSpawning(obstruction: ObstructionEventPayload): Promise<void> {
    if (!this.#vdwSpawner) return;

    const gaps = this.#gapDetector.findGaps();
    const spawnedAgents: VdWAgent[] = await this.#vdwSpawner.evaluateAndSpawn(
      gaps,
      obstruction.h1Dimension,
      obstruction.iteration
    );

    if (spawnedAgents.length > 0) {
      console.log(
        `[ORCH-OBSTRUCTION] Spawned ${spawnedAgents.length} VdW agents ` +
        `for iteration ${obstruction.iteration}`
      );

      // Run spawned agents (serialized to avoid graph mutation races)
      await this.#vdwSpawner.runAgents();

      // Integrate VdW agent results into TNA graph
      for (const vdwAgent of spawnedAgents) {
        const results = vdwAgent.getResults();
        if (results.entitiesAdded.length > 0) {
          // Spread readonly array to mutable string[] (required by ingestTokens signature)
          this.#tnaGraph.ingestTokens([...results.entitiesAdded]);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: runGapDetectorAgent
  // -------------------------------------------------------------------------

  /**
   * #runGapDetectorAgent — execute a gap-filling agent for an obstruction.
   *
   * Steps:
   *   1. Find structural gaps in TNA graph via GapDetector.findGaps()
   *   2. For each gap: generate a synthetic bridging query
   *   3. Simulate agent execution (Phase 5 stub — no actual LLM calls)
   *   4. Return GapFillResult with entities and relations to add
   *
   * @param agent       - GapDetectorAgent instance (must be status='active')
   * @param obstruction - The H^1 obstruction event that triggered this run
   */
  async #runGapDetectorAgent(
    agent: GapDetectorAgent,
    obstruction: ObstructionEventPayload
  ): Promise<GapFillResult> {
    // Step 1: Find structural gaps in TNA graph
    const gaps = this.#gapDetector.findGaps();
    const gapsDetected = gaps.length;

    // Step 2: Generate synthetic queries for each gap
    const synthQueries: string[] = [];
    const entitiesAdded: string[] = [];
    const relationsAdded: Array<{ from: string; to: string; type: string }> = [];

    for (const gap of gaps) {
      // Generate a synthetic bridging query
      const query = `What relates community ${gap.communityA} to community ${gap.communityB}? ` +
        `(density=${gap.interCommunityDensity.toFixed(3)}, path=${gap.shortestPathLength})`;
      synthQueries.push(query);

      // Phase 5 stub: generate synthetic entity IDs to bridge the gap
      // In Phase 6: actual LLM inference would return real entities/relations
      const bridgeEntity = `bridge-gap-${obstruction.iteration}-c${gap.communityA}-c${gap.communityB}`;
      entitiesAdded.push(bridgeEntity);

      // Add a synthetic relation between communities via the bridge entity
      const bridgeNodes = gap.bridgeNodes;
      if (bridgeNodes.length >= 1) {
        relationsAdded.push({
          from: String(bridgeNodes[0]),
          to: bridgeEntity,
          type: 'gap-bridge',
        });
      }
    }

    // Simulate agent execution time (minimal for Phase 5)
    await Promise.resolve(); // yield to event loop

    return {
      obstructionId: `obstruction-iter-${obstruction.iteration}-h1-${obstruction.h1Dimension}`,
      gapsDetected,
      entitiesAdded,
      relationsAdded,
      synthQueries,
      timestamp: Date.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Private: integrateGapFillResults
  // -------------------------------------------------------------------------

  /**
   * #integrateGapFillResults — feed gap fill results back into TNA graph.
   *
   * For each entity in the gap fill result:
   *   - Add a new node to the TNA co-occurrence graph
   *   - Add edges for relations between entities
   *
   * This implements the feedback loop: obstructions → gap fill → topology update.
   */
  #integrateGapFillResults(results: GapFillResult): void {
    // Add new entity nodes to TNA graph via ingestTokens()
    if (results.entitiesAdded.length > 0) {
      this.#tnaGraph.ingestTokens(results.entitiesAdded);
      console.log(
        `[ORCH-OBSTRUCTION] Integrated ${results.entitiesAdded.length} new entities from gap fill`
      );
    }

    // Note: CooccurrenceGraph builds edges via the sliding window during ingestTokens().
    // For explicitly requested relations (relationsAdded), we log them for Phase 6.
    // In Phase 6, direct edge addition would be supported with a dedicated method.
    if (results.relationsAdded.length > 0) {
      console.log(
        `[ORCH-OBSTRUCTION] ${results.relationsAdded.length} relations noted ` +
        `(direct edge addition available in Phase 6)`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Public: Phase 6 regime and H^1 forwarding methods
  // -------------------------------------------------------------------------

  /**
   * updateRegime — forward regime classification to the VdW spawner.
   * Called by ComposeRootModule when 'regime:classification' events arrive.
   * No-op if no VdW spawner is configured (backward compatible).
   */
  updateRegime(regime: string): void {
    this.#vdwSpawner?.updateRegime(regime);
  }

  /**
   * updateH1ForSpawner — forward H^1 dimension to VdW spawner for hysteresis tracking.
   * Called by ComposeRootModule when 'sheaf:h1-obstruction-detected' events arrive.
   * No-op if no VdW spawner is configured (backward compatible).
   */
  updateH1ForSpawner(h1Dimension: number): void {
    this.#vdwSpawner?.updateH1Dimension(h1Dimension);
  }

  // -------------------------------------------------------------------------
  // Public: shutdown
  // -------------------------------------------------------------------------

  /**
   * shutdown — drain the obstruction queue and clean up agents.
   *
   * Waits for any in-progress processing to complete, then terminates all agents.
   */
  async shutdown(): Promise<void> {
    // Unsubscribe from obstruction events
    this.#eventBus.unsubscribe('sheaf:h1-obstruction-detected', this.#obstructionHandler);

    // Drain the queue: wait for processing to complete
    // Poll until the queue is empty and processing has stopped
    const maxWaitMs = 5000;
    const pollIntervalMs = 10;
    const startTime = Date.now();

    while ((this.#isProcessing || this.#obstructionQueue.length > 0) &&
           Date.now() - startTime < maxWaitMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // Phase 6: Clean up VdW spawner
    this.#vdwSpawner?.cleanup();

    // Clean up all agents
    await Promise.all(this.#agentPool.map((agent) => agent.cleanup()));

    console.log('[ORCH-OBSTRUCTION] ObstructionHandler shutdown complete.');
  }

  // -------------------------------------------------------------------------
  // Public: getProcessingStatus
  // -------------------------------------------------------------------------

  /**
   * getProcessingStatus — return current processing state for monitoring/testing.
   */
  getProcessingStatus(): { isProcessing: boolean; queueLength: number; agentCount: number } {
    return {
      isProcessing: this.#isProcessing,
      queueLength: this.#obstructionQueue.length,
      agentCount: this.#agentPool.length,
    };
  }
}
