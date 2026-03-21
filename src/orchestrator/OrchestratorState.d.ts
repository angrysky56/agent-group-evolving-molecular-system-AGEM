/**
 * OrchestratorState.ts
 *
 * State machine for orchestrator operational modes (ORCH-03).
 *
 * Provides: OrchestratorState enum, StateChangeEvent interface,
 *           OrchestratorStateManager class.
 *
 * State machine semantics:
 *   NORMAL:     H^1 = 0 (or below obstruction threshold). Agents operate normally.
 *   OBSTRUCTED: H^1 crosses obstruction threshold. Increased monitoring; agents
 *               may switch to cautious reasoning strategies.
 *   CRITICAL:   H^1 exceeds critical threshold. Agents escalate context compression,
 *               activate emergency consensus protocols.
 *
 * Transitions driven by H^1 dimension metric from Sheaf analysis:
 *   NORMAL → OBSTRUCTED: h1 >= obstructionThreshold
 *   NORMAL → CRITICAL:   h1 >= criticalThreshold (direct skip of OBSTRUCTED)
 *   OBSTRUCTED → CRITICAL: h1 >= criticalThreshold
 *   OBSTRUCTED → NORMAL: h1 < obstructionThreshold
 *   CRITICAL → NORMAL:   h1 < obstructionThreshold (must drop fully below)
 *
 * State changes are synchronous (no async). Events emitted via EventBus for decoupling.
 *
 * Imports: EventBus from ./EventBus.js. No external npm dependencies.
 */
import type { EventBus } from "./EventBus.js";
/**
 * OrchestratorState — operational modes for the AGEM orchestrator.
 *
 * Driven by the H^1 topological obstruction dimension from CohomologyAnalyzer.
 * Higher H^1 dimension means more disagreement between agents' sheaf sections,
 * requiring escalated coordination strategies.
 */
export declare enum OrchestratorState {
    /** Default mode: H^1 below threshold; agents coordinate normally. */
    NORMAL = "NORMAL",
    /** H^1 crossed obstruction threshold; increased monitoring activated. */
    OBSTRUCTED = "OBSTRUCTED",
    /** H^1 exceeds critical threshold; emergency consensus protocols active. */
    CRITICAL = "CRITICAL"
}
/**
 * StateChangeEvent — emitted by OrchestratorStateManager on every state transition.
 *
 * Consumed by downstream components that need to react to operational mode changes,
 * e.g., AgentPool adjusting heartbeat frequency, LCM escalation protocol activation.
 */
export interface StateChangeEvent {
    /** Event type discriminant. */
    readonly type: "orch:state-changed";
    /** Previous operational state before this transition. */
    readonly oldState: OrchestratorState;
    /** New operational state after this transition. */
    readonly newState: OrchestratorState;
    /** Unix timestamp (ms) at the moment of transition. */
    readonly timestamp: number;
    /** The H^1 dimension value that triggered this transition (if applicable). */
    readonly h1Metric?: number;
    /** Human-readable description of why the transition occurred. */
    readonly reason: string;
}
/**
 * OrchestratorStateManager — deterministic state machine for AGEM operating modes.
 *
 * Call updateMetrics(h1Dimension) after each Sheaf analysis iteration. The manager
 * computes whether a state transition is warranted and emits StateChangeEvent via
 * the injected EventBus if the state changes.
 *
 * Transitions:
 *   updateMetrics(h1 >= criticalThreshold):      → CRITICAL
 *   updateMetrics(h1 >= obstructionThreshold):   → OBSTRUCTED
 *   updateMetrics(h1 < obstructionThreshold):    → NORMAL
 *
 * All transitions are synchronous. No state is mutated outside updateMetrics() and
 * the private setState() method.
 *
 * @example
 *   const bus = new EventBus();
 *   bus.subscribe('orch:state-changed', (ev) => console.log(ev));
 *   const sm = new OrchestratorStateManager(bus);
 *   sm.updateMetrics(3); // → OBSTRUCTED
 *   sm.updateMetrics(6); // → CRITICAL
 *   sm.updateMetrics(0); // → NORMAL
 */
export declare class OrchestratorStateManager {
    #private;
    /**
     * Create an OrchestratorStateManager.
     *
     * @param eventBus              - EventBus to emit StateChangeEvent on transitions.
     * @param h1ObstructionThreshold - H^1 dimension at/above which state transitions to OBSTRUCTED.
     *                                 Default: 2 (one obstruction cycle in a typical 3-agent sheaf).
     * @param h1CriticalThreshold   - H^1 dimension at/above which state transitions to CRITICAL.
     *                                 Default: 5 (severe multi-obstruction regime).
     */
    constructor(eventBus: EventBus, h1ObstructionThreshold?: number, h1CriticalThreshold?: number);
    /**
     * Update the state machine with a new H^1 dimension reading.
     *
     * Computes whether a transition is warranted based on current state and h1Dimension.
     * If a transition occurs, emits 'orch:state-changed' event via EventBus.
     * If no transition (state unchanged), no event is emitted.
     *
     * Transition logic (evaluated in priority order):
     *   1. NORMAL + h1 >= criticalThreshold  → CRITICAL (direct escalation)
     *   2. NORMAL + h1 >= obstructionThreshold → OBSTRUCTED
     *   3. OBSTRUCTED + h1 >= criticalThreshold → CRITICAL
     *   4. (OBSTRUCTED or CRITICAL) + h1 < obstructionThreshold → NORMAL
     *   5. All other cases: no transition
     *
     * @param h1Dimension - Current H^1 dimension from CohomologyAnalyzer (integer >= 0).
     */
    updateMetrics(h1Dimension: number): void;
    /**
     * Return the current operational state.
     *
     * @returns Current OrchestratorState enum value.
     */
    getState(): OrchestratorState;
    /**
     * Return the Unix timestamp (ms) of the most recent state change.
     *
     * Initialized to the time of OrchestratorStateManager construction.
     * Updated on each state transition.
     *
     * @returns Unix timestamp in milliseconds.
     */
    getLastStateChangeTime(): number;
}
//# sourceMappingURL=OrchestratorState.d.ts.map