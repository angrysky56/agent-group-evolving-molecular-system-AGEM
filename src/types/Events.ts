/**
 * Events.ts
 *
 * Event types emitted by CohomologyAnalyzer and consumed by the Phase 5 Orchestrator.
 * Only import: VertexId from ./GraphTypes.
 */

import type { VertexId } from './GraphTypes.js';

// ---------------------------------------------------------------------------
// Event type discriminant
// ---------------------------------------------------------------------------

/**
 * SheafEventType — string literal union of all sheaf event types.
 */
export type SheafEventType =
  | 'sheaf:consensus-reached'
  | 'sheaf:h1-obstruction-detected'
  | 'sheaf:iteration-complete';

// ---------------------------------------------------------------------------
// Concrete event types
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
// Discriminated union
// ---------------------------------------------------------------------------

/**
 * SheafEvent — discriminated union of all sheaf events, keyed on `type`.
 * Use exhaustive switch/match patterns against the `type` field.
 */
export type SheafEvent = SheafConsensusReachedEvent | SheafH1ObstructionEvent;
