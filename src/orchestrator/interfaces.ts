/**
 * interfaces.ts
 *
 * Shared type definitions for the Phase 5 Orchestrator.
 *
 * Provides: Agent interface, PoolConfig, Task<T>, TaskResult<T>,
 *           EventSubscriber, and AnyEvent union type.
 *
 * Imports: SheafEvent, SOCEvent from src/types/Events.js only.
 * No other external dependencies.
 */

import type { SheafEvent, SOCEvent, OrchestratorEvent, TNAEvent } from '../types/Events.js';

// ---------------------------------------------------------------------------
// Agent lifecycle types
// ---------------------------------------------------------------------------

/**
 * Agent — interface for a reasoning agent managed by AgentPool.
 *
 * Lifecycle stages:
 *   spawning    → Agent is being initialized; resources allocated, not yet ready.
 *   active      → Agent is running and processing tasks.
 *   idle        → Agent is ready but has no pending work; eligible for assignment.
 *   terminating → Agent is shutting down; finishing in-flight work.
 *   terminated  → Agent lifecycle complete; resources freed, not restartable.
 *
 * State transitions:
 *   spawning → active     (after spawn() resolves)
 *   active → idle         (after completing current task)
 *   idle → active         (after receiving new task)
 *   active | idle → terminating  (on shutdown signal)
 *   terminating → terminated    (after cleanup() resolves)
 *   active | idle → terminated  (heartbeat timeout — no cleanup possible)
 */
export interface Agent {
  /** Unique identifier for this agent instance. Immutable after creation. */
  readonly id: string;

  /**
   * Current lifecycle status of this agent.
   * Mutable: AgentPool updates this field during lifecycle transitions.
   */
  status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated';

  /**
   * Initialize the agent: allocate resources, establish connections.
   * Resolves when agent is ready to process tasks.
   * Should transition status to 'active' on success.
   */
  spawn(): Promise<void>;

  /**
   * Health probe: confirm agent is alive and responsive.
   * Called periodically by AgentPool at heartbeatIntervalMs.
   * Must resolve within heartbeatTimeoutMs or agent is marked terminated.
   */
  heartbeat(): Promise<void>;

  /**
   * Graceful shutdown: release resources and finalize pending work.
   * Called by AgentPool.shutdown() for all non-terminated agents.
   * Should transition status to 'terminated' on completion.
   */
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pool configuration
// ---------------------------------------------------------------------------

/**
 * PoolConfig — configuration for AgentPool lifecycle management.
 *
 * Reasonable defaults (not enforced here — set in AgentPool constructor):
 *   poolSize:             4       (number of concurrent reasoning agents)
 *   heartbeatIntervalMs:  5000    (5 seconds between heartbeat cycles)
 *   heartbeatTimeoutMs:   2000    (2 seconds per-agent heartbeat deadline)
 */
export interface PoolConfig {
  /**
   * Number of agents to create and maintain in the pool.
   * All agents are spawned on initialize() and cleaned up on shutdown().
   */
  readonly poolSize: number;

  /**
   * Interval in milliseconds between heartbeat cycles.
   * AgentPool runs one heartbeat check per interval across all agents.
   * Recommended: 5000ms (5 seconds).
   */
  readonly heartbeatIntervalMs: number;

  /**
   * Per-agent heartbeat timeout in milliseconds.
   * If an agent's heartbeat() does not resolve within this time, that agent
   * is marked 'terminated'. Other agents are not affected (per-agent Promise.race).
   * Recommended: 2000ms (2 seconds).
   */
  readonly heartbeatTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Task types (for llm_map in later plan)
// ---------------------------------------------------------------------------

/**
 * Task<T> — generic work unit submitted to the agent pool or llm_map.
 *
 * @template T - Type of the task payload; use `unknown` for heterogeneous queues.
 */
export interface Task<T = unknown> {
  /** Unique identifier for this task instance. Used to correlate TaskResult. */
  readonly id: string;

  /** Task-specific data consumed by the executing agent. */
  readonly payload: T;

  /** Optional arbitrary key-value metadata (routing hints, priority, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * TaskResult<T> — result returned after an agent processes a Task.
 *
 * @template T - Type of the task result value.
 */
export interface TaskResult<T = unknown> {
  /** The id of the Task that produced this result. */
  readonly taskId: string;

  /** True if the task completed without throwing; false if an error occurred. */
  readonly success: boolean;

  /** Result value on success. Undefined if success === false. */
  readonly result?: T;

  /** Error instance on failure. Undefined if success === true. */
  readonly error?: Error;
}

// ---------------------------------------------------------------------------
// EventBus subscriber and event union
// ---------------------------------------------------------------------------

/**
 * AnyEvent — discriminated union of all event types flowing through the EventBus.
 *
 * Covers all events emitted by Phase 1 (CohomologyAnalyzer), Phase 4 (SOCTracker),
 * and Phase 6 orchestrator components (VdWAgentSpawner).
 */
export type AnyEvent = SheafEvent | SOCEvent | OrchestratorEvent | TNAEvent;

/**
 * EventSubscriber — handler function registered with EventBus.subscribe().
 *
 * Handlers may be synchronous (void) or asynchronous (Promise<void>).
 * EventBus.emit() uses Promise.all() to await all handlers in parallel.
 *
 * Example (sync):
 *   const handler: EventSubscriber = (event) => { console.log(event.type); };
 *
 * Example (async):
 *   const handler: EventSubscriber = async (event) => { await persist(event); };
 */
export type EventSubscriber = (event: AnyEvent) => void | Promise<void>;
