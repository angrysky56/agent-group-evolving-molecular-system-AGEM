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
import { EventBus } from "./EventBus.js";
import type { GapDetector } from "../tna/GapDetector.js";
import type { CooccurrenceGraph } from "../tna/CooccurrenceGraph.js";
import { VdWAgentSpawner } from "./VdWAgentSpawner.js";
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
    readonly relationsAdded: Array<{
        from: string;
        to: string;
        type: string;
    }>;
    /** Synthetic questions generated to guide gap bridging (for Phase 6 LLM use). */
    readonly synthQueries: string[];
    /** Unix timestamp (ms) when gap fill completed. */
    readonly timestamp: number;
}
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
export declare class ObstructionHandler {
    #private;
    /**
     * Create an ObstructionHandler.
     *
     * @param eventBus    - Central EventBus to subscribe to and emit on.
     * @param gapDetector - TNA GapDetector for structural gap analysis.
     * @param tnaGraph    - TNA CooccurrenceGraph to integrate gap fill results into.
     * @param config      - Optional configuration (agentPoolSize defaults to 4; vdwSpawner optional).
     */
    constructor(eventBus: EventBus, gapDetector: GapDetector, tnaGraph: CooccurrenceGraph, config?: {
        agentPoolSize?: number;
        vdwSpawner?: VdWAgentSpawner;
    });
    /**
     * updateRegime — forward regime classification to the VdW spawner.
     * Called by ComposeRootModule when 'regime:classification' events arrive.
     * No-op if no VdW spawner is configured (backward compatible).
     */
    updateRegime(regime: string): void;
    /**
     * updateH1ForSpawner — forward H^1 dimension to VdW spawner for hysteresis tracking.
     * Called by ComposeRootModule when 'sheaf:h1-obstruction-detected' events arrive.
     * No-op if no VdW spawner is configured (backward compatible).
     */
    updateH1ForSpawner(h1Dimension: number): void;
    /**
     * shutdown — drain the obstruction queue and clean up agents.
     *
     * Waits for any in-progress processing to complete, then terminates all agents.
     */
    shutdown(): Promise<void>;
    /**
     * getProcessingStatus — return current processing state for monitoring/testing.
     */
    getProcessingStatus(): {
        isProcessing: boolean;
        queueLength: number;
        agentCount: number;
    };
}
//# sourceMappingURL=ObstructionHandler.d.ts.map