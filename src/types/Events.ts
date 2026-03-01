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

import type { VertexId } from './GraphTypes.js';

// ---------------------------------------------------------------------------
// Sheaf event type discriminant
// ---------------------------------------------------------------------------

/**
 * SheafEventType — string literal union of all sheaf event types.
 * SOC events are NOT included here — see SOCEventType below.
 */
export type SheafEventType =
  | 'sheaf:consensus-reached'
  | 'sheaf:h1-obstruction-detected'
  | 'sheaf:iteration-complete';

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
  readonly type: 'sheaf:consensus-reached';
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
  readonly type: 'sheaf:h1-obstruction-detected';
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
  | 'soc:metrics'
  | 'phase:transition'
  | 'phase:transition-confirmed'
  | 'regime:classification';

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
  readonly type: 'soc:metrics';
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
  readonly type: 'phase:transition';
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
  readonly type: 'phase:transition-confirmed';
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
  readonly type: 'regime:classification';
  readonly iteration: number;
  readonly regime: import('../soc/interfaces.js').RegimeStability;
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
  | RegimeClassificationEvent;
