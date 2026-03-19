/**
 * Events.ts
 *
 * Event types emitted by CohomologyAnalyzer (sheaf events) and SOCTracker (SOC events),
 * consumed by the Phase 5 Orchestrator.
 *
 * Imports: VertexId from ./GraphTypes only.
 *
 * Note: SOC events have their own discriminated union (SOCEvent, SOCEventType)
 * separate from SheafEventType. They are NOT added to SheafEventType.
 */

import type { VertexId } from "./GraphTypes.js";

// ---------------------------------------------------------------------------
// Sheaf event type discriminant
// ---------------------------------------------------------------------------

/**
 * SheafEventType — string literal union of all sheaf event types.
 * SOC events are NOT included here — see SOCEventType below.
 */
export type SheafEventType =
  | "sheaf:consensus-reached"
  | "sheaf:h1-obstruction-detected"
  | "sheaf:iteration-complete";

// ---------------------------------------------------------------------------
// Sheaf concrete event types
// ---------------------------------------------------------------------------

/**
 * SheafConsensusReachedEvent — emitted when all agents reach consensus.
 *
 * Consensus = H^0 is full-rank (all vertices agree on a global section)
 * and the Dirichlet energy (sum of squared coboundary residuals) is below threshold.
 */
export interface SheafConsensusReachedEvent {
  readonly type: "sheaf:consensus-reached";
  readonly iteration: number;
  readonly h0Dimension: number;
  readonly dirichletEnergy: number;
}

/**
 * SheafH1ObstructionEvent — emitted when H^1 dimension > 0.
 *
 * The `h1Basis` vectors span the obstruction space in C^1 = ⊕ F(e).
 * `affectedVertices` lists the vertex IDs whose stalks contribute to the obstruction.
 */
export interface SheafH1ObstructionEvent {
  readonly type: "sheaf:h1-obstruction-detected";
  readonly iteration: number;
  readonly h1Dimension: number;
  readonly h1Basis: readonly Float64Array[];
  readonly affectedVertices: readonly VertexId[];
}

// ---------------------------------------------------------------------------
// Sheaf discriminated union
// ---------------------------------------------------------------------------

/**
 * SheafEvent — discriminated union of all sheaf events, keyed on `type`.
 * Use exhaustive switch/match patterns against the `type` field.
 */
export type SheafEvent = SheafConsensusReachedEvent | SheafH1ObstructionEvent;

// ---------------------------------------------------------------------------
// SOC event type discriminant (separate from SheafEventType)
// ---------------------------------------------------------------------------

/**
 * SOCEventType — string literal union of all SOC event types.
 * These are emitted by SOCTracker (Phase 4), not by CohomologyAnalyzer.
 */
export type SOCEventType =
  | "soc:metrics"
  | "phase:transition"
  | "phase:transition-confirmed"
  | "regime:classification"
  | "soc:system1-early-convergence";

// ---------------------------------------------------------------------------
// SOC concrete event types
// ---------------------------------------------------------------------------

/**
 * SOCMetricsEvent — emitted every iteration with all five SOC metrics.
 *
 * Fields:
 *   - type: discriminant ('soc:metrics')
 *   - iteration: which iteration produced these metrics
 *   - timestamp: Date.now() at emission time (milliseconds since epoch)
 *   - vonNeumannEntropy: S_VN = -Σ λ_i ln(λ_i) of normalized Laplacian density matrix
 *   - embeddingEntropy: S_EE = -Σ λ_i ln(λ_i) of embedding covariance eigenspectrum
 *   - cdp: Complexity Differential Probe = vonNeumannEntropy - embeddingEntropy
 *   - surprisingEdgeRatio: fraction of new edges this iteration that cross community boundaries
 *     with cosine similarity < δ_surprising (default 0.3)
 *   - correlationCoefficient: Pearson r between rolling VN entropy and rolling embedding entropy
 *   - isPhaseTransition: true if correlationCoefficient sign changed since previous iteration
 */
export interface SOCMetricsEvent {
  readonly type: "soc:metrics";
  readonly iteration: number;
  readonly timestamp: number;
  readonly vonNeumannEntropy: number;
  readonly embeddingEntropy: number;
  readonly cdp: number;
  readonly surprisingEdgeRatio: number;
  readonly correlationCoefficient: number;
  readonly isPhaseTransition: boolean;
}

/**
 * SOCPhaseTransitionEvent — emitted when cross-correlation sign changes.
 *
 * A sign change in the Pearson correlation between Von Neumann entropy and
 * embedding entropy signals a phase transition in the agent group's collective
 * cognitive structure — the point at which structural complexity (graph topology)
 * and semantic complexity (embedding covariance) decouple or re-couple.
 *
 * Fields:
 *   - type: discriminant ('phase:transition')
 *   - iteration: current iteration at detection time
 *   - centeredAtIteration: iteration estimate of the transition midpoint (center of window)
 *   - correlationCoefficient: current Pearson r (the new value, after sign change)
 *   - previousCorrelation: Pearson r from the previous iteration (the old value, before sign change)
 */
export interface SOCPhaseTransitionEvent {
  readonly type: "phase:transition";
  readonly iteration: number;
  readonly centeredAtIteration: number;
  readonly correlationCoefficient: number;
  readonly previousCorrelation: number;
}

// ---------------------------------------------------------------------------
// Phase 6 SOC event types (SOC-06, SOC-07)
// ---------------------------------------------------------------------------

/**
 * PhaseTransitionConfirmedEvent — emitted when a phase transition is validated
 * by the RegimeValidator (persistence + coherence + H^1 gating).
 *
 * Unlike 'phase:transition' (instantaneous sign change), this event fires only
 * after the transition has been confirmed over multiple iterations.
 */
export interface PhaseTransitionConfirmedEvent {
  readonly type: "phase:transition-confirmed";
  readonly iteration: number;
  readonly centeredAtIteration: number;
  readonly coherence: number;
  readonly h1Dimension: number;
  readonly correlationCoefficient: number;
  readonly previousCorrelation: number;
}

/**
 * RegimeClassificationEvent — emitted every iteration with the current regime
 * stability classification and supporting metrics.
 *
 * Consumed by ORCH-06 (agent spawning decisions) and TNA-09 (centrality frequency).
 */
export interface RegimeClassificationEvent {
  readonly type: "regime:classification";
  readonly iteration: number;
  readonly regime: import("../soc/interfaces.js").RegimeStability;
  readonly cdpVariance: number;
  readonly correlationConsistency: number;
  readonly persistenceIterations: number;
}

// ---------------------------------------------------------------------------
// SOC discriminated union
// ---------------------------------------------------------------------------

/**
 * SOCEvent — discriminated union of all SOC events, keyed on `type`.
 * Use exhaustive switch/match patterns against the `type` field.
 */
export type SOCEvent =
  | SOCMetricsEvent
  | SOCPhaseTransitionEvent
  | PhaseTransitionConfirmedEvent
  | RegimeClassificationEvent
  | System1EarlyConvergenceEvent;

// ---------------------------------------------------------------------------
// Phase 6 Orchestrator event types (ORCH-06)
// ---------------------------------------------------------------------------

/**
 * OrchestratorEventType — string literal union of orchestrator event types.
 * These are emitted by orchestrator components, not by Phase 1-4 modules.
 */
export type OrchestratorEventType =
  | "orch:vdw-agent-spawned"
  | "orch:vdw-agent-complete";

/**
 * VdWAgentSpawnedEvent — emitted when a Van der Waals agent is spawned.
 */
export interface VdWAgentSpawnedEvent {
  readonly type: "orch:vdw-agent-spawned";
  readonly agentId: string;
  readonly iteration: number;
  readonly h1Dimension: number;
  readonly gapId: string;
  readonly tokenBudget: number;
  readonly maxIterations: number;
  readonly regime: string;
}

/**
 * VdWAgentCompleteEvent — emitted when a Van der Waals agent finishes its lifecycle.
 */
export interface VdWAgentCompleteEvent {
  readonly type: "orch:vdw-agent-complete";
  readonly agentId: string;
  readonly iteration: number;
  readonly synthQueries: readonly string[];
  readonly entitiesAdded: readonly string[];
  readonly relationsAdded: ReadonlyArray<{
    from: string;
    to: string;
    type: string;
  }>;
  readonly stepsExecuted: number;
  readonly success: boolean;
}

/**
 * OrchestratorEvent — discriminated union of orchestrator events.
 */
export type OrchestratorEvent = VdWAgentSpawnedEvent | VdWAgentCompleteEvent;

// ---------------------------------------------------------------------------
// Phase 6 TNA event types (TNA-07, TNA-09)
// ---------------------------------------------------------------------------

/**
 * TNAEventType — string literal union of TNA event types.
 */
export type TNAEventType =
  | "tna:catalyst-questions-generated"
  | "tna:centrality-change-detected"
  | "tna:topology-reorganized"
  | "tna:layout-updated";

/**
 * CatalystQuestionsGeneratedEvent — emitted when catalyst questions are generated for a gap.
 */
export interface CatalystQuestionsGeneratedEvent {
  readonly type: "tna:catalyst-questions-generated";
  readonly gapId: string;
  readonly questionCount: number;
  readonly semanticDistance: number;
  readonly iteration: number;
}

/**
 * CentralityChangeDetectedEvent — emitted when a node's centrality changes rapidly.
 */
export interface CentralityChangeDetectedEvent {
  readonly type: "tna:centrality-change-detected";
  readonly nodeId: string;
  readonly trend: import("../tna/interfaces.js").CentralityTrend;
  readonly previousScore: number;
  readonly currentScore: number;
  readonly iteration: number;
}

/**
 * TopologyReorganizedEvent — emitted when major centrality swaps detected.
 */
export interface TopologyReorganizedEvent {
  readonly type: "tna:topology-reorganized";
  readonly majorNodeSwaps: number;
  readonly iteration: number;
}

/**
 * LayoutUpdatedEvent — emitted after a ForceAtlas2 layout computation completes.
 *
 * Consumed by visualization consumers and the EventBus for layout monitoring.
 * Energy indicates convergence quality (lower = more settled layout).
 */
export interface LayoutUpdatedEvent {
  readonly type: "tna:layout-updated";
  /** Current reasoning iteration at layout time. */
  readonly iteration: number;
  /** Convergence energy (mean squared displacement from previous layout). */
  readonly energy: number;
  /** Number of nodes positioned in this layout. */
  readonly nodeCount: number;
  /** Number of ForceAtlas2 physics iterations executed. */
  readonly physicsIterations: number;
}

/**
 * TNAEvent — discriminated union of TNA events.
 */
export type TNAEvent =
  | CatalystQuestionsGeneratedEvent
  | CentralityChangeDetectedEvent
  | TopologyReorganizedEvent
  | LayoutUpdatedEvent;


// ---------------------------------------------------------------------------
// Lumpability event types (LUMP-01)
// ---------------------------------------------------------------------------

/**
 * LumpabilityEventType — string literal union of lumpability auditor event types.
 * Emitted by LumpabilityAuditor when compaction boundaries are audited.
 */
export type LumpabilityEventType =
  | "lumpability:audit-complete"
  | "lumpability:weak-compression";

/**
 * LumpabilityAuditCompleteEvent — emitted after every compaction audit.
 *
 * Contains the full audit result including entropy profiles, preservation ratio,
 * centroid similarity, and classification (strong/weak/degenerate).
 */
export interface LumpabilityAuditCompleteEvent {
  readonly type: "lumpability:audit-complete";
  readonly summaryNodeId: string;
  readonly escalationLevel: 1 | 2 | 3;
  readonly entropyPreservationRatio: number;
  readonly centroidSimilarity: number;
  readonly classification: "strong" | "weak" | "degenerate";
  readonly timestamp: number;
}

/**
 * LumpabilityWeakCompressionEvent — emitted ONLY when classification = 'weak'.
 *
 * This event drives the recovery feedback loop: ObstructionHandler can subscribe
 * and trigger lcm_expand to re-inject lost context from the ImmutableStore.
 *
 * The sourceEntryIds field enables targeted recovery — the handler knows exactly
 * which original entries need to be re-expanded.
 */
export interface LumpabilityWeakCompressionEvent {
  readonly type: "lumpability:weak-compression";
  readonly summaryNodeId: string;
  readonly sourceEntryIds: readonly string[];
  readonly escalationLevel: 1 | 2 | 3;
  readonly entropyPreservationRatio: number;
  readonly centroidSimilarity: number;
  readonly threshold: number;
  readonly timestamp: number;
}

/**
 * LumpabilityEvent — discriminated union of all lumpability events.
 */
export type LumpabilityEvent =
  | LumpabilityAuditCompleteEvent
  | LumpabilityWeakCompressionEvent;


// ---------------------------------------------------------------------------
// System 1 override event type (SOC-08)
// ---------------------------------------------------------------------------

/**
 * System1EarlyConvergenceEvent — emitted when the system detects that
 * embedding entropy (semantic space) has stabilized before structural
 * entropy (VNE) has finished developing.
 *
 * This is the mathematical signature of a System 1 override:
 * the model has "decided" its answer before the reasoning chain has
 * been fully constructed. The structural complexity is post-hoc
 * rationalization for a pre-determined semantic conclusion.
 *
 * In lumpability terms: the system has collapsed to a weakly lumpable
 * attractor that only works for the specific distribution the model
 * has already committed to.
 */
export interface System1EarlyConvergenceEvent {
  readonly type: "soc:system1-early-convergence";
  readonly iteration: number;
  readonly eeVariance: number;
  readonly vneSlope: number;
  readonly timestamp: number;
}
