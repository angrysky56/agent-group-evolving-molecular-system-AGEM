---
phase: 05-orchestrator
plan: "01"
subsystem: orchestrator-foundation
tags:
  - eventbus
  - agent-pool
  - state-machine
  - orch-01
  - orch-03
  - orch-04
dependency_graph:
  requires:
    - src/types/Events.ts
    - node:events (built-in)
  provides:
    - src/orchestrator/interfaces.ts
    - src/orchestrator/EventBus.ts
    - src/orchestrator/AgentPool.ts
    - src/orchestrator/OrchestratorState.ts
  affects:
    - Phase 5 Plan 02 (composition root and llm_map integration)
    - Phase 5 Plan 03 (Molecular-CoT reasoning integration)
tech_stack:
  added: []
  patterns:
    - "Promise.all() for parallel handler dispatch in EventBus"
    - "Promise.race() per-agent for heartbeat timeouts in AgentPool"
    - "Private class fields (#field) for encapsulation"
    - "Idempotent shutdown via #isShuttingDown boolean guard"
    - "Synchronous state machine with async EventBus emission"
key_files:
  created:
    - src/orchestrator/interfaces.ts
    - src/orchestrator/EventBus.ts
    - src/orchestrator/EventBus.test.ts
    - src/orchestrator/AgentPool.ts
    - src/orchestrator/AgentPool.test.ts
    - src/orchestrator/OrchestratorState.ts
    - src/orchestrator/OrchestratorState.test.ts
  modified: []
decisions:
  - "EventBus is standalone class (not extends EventEmitter) — emit() signature incompatible with EventEmitter base"
  - "EventBus holds EventEmitter as private #emitter field for future Node.js integration"
  - "CRITICAL does not downgrade to OBSTRUCTED — must go through NORMAL (drop below obs threshold)"
  - "Heartbeat only runs on non-terminated agents (#runHeartbeat filters by status)"
  - "StateChangeEvent uses void emit cast (not part of AnyEvent union — extended in later plans)"
metrics:
  duration: "~7 minutes"
  completed_date: "2026-03-01"
  tasks_completed: 4
  files_created: 7
  tests_added: 36
  total_tests: 275
---

# Phase 5 Plan 01: Orchestrator Foundation (Wave 1) Summary

One-liner: EventBus with Promise.all parallel dispatch, AgentPool with per-agent Promise.race heartbeat timeouts, and OrchestratorStateManager NORMAL/OBSTRUCTED/CRITICAL state machine driven by H^1 dimension metrics.

## Architecture

### EventBus (ORCH-04)

`src/orchestrator/EventBus.ts` — standalone class (does not extend EventEmitter due to `emit()` signature incompatibility).

Internal state: `#subscribers: Map<string, EventSubscriber[]>`

- `subscribe(eventType, handler)` — pushes handler to array for that event type key
- `emit(event: AnyEvent): Promise<void>` — dispatches to handlers via `Promise.all(handlers.map(h => Promise.resolve(h(event))))`; parallel execution confirmed by timing tests
- `unsubscribe(eventType, handler)` — removes by reference index; no-op if not found
- `getSubscriberCount(eventType)` — returns array length for verification

Key design: `Promise.all()` ensures all handlers fire concurrently. Fail-fast on any handler rejection. Sync handlers wrapped in `Promise.resolve()` for uniform awaiting.

### AgentPool (ORCH-01)

`src/orchestrator/AgentPool.ts` — manages fixed-size pool of reasoning agents.

Internal state: `#config`, `#agents`, `#heartbeatTimer`, `#isShuttingDown`

- `initialize()` — `Promise.all(agents.map(a => a.spawn()))` then starts interval timer
- `#runHeartbeat()` — filters terminated agents, then `Promise.race([agent.heartbeat(), timeout])` per agent via `Promise.all`; failures caught and logged (graceful degradation)
- `shutdown()` — idempotent guard via `#isShuttingDown`; clears interval, `Promise.all(agents.map(a => a.cleanup()))`
- `getAgents()` — returns all agents (including terminated)
- `getIdleAgents()` — filters by `status === 'idle'`

Key design: Per-agent `Promise.race()` (Pitfall 4 guard) prevents one slow agent's heartbeat timeout from blocking the entire heartbeat cycle.

### OrchestratorStateManager (ORCH-03)

`src/orchestrator/OrchestratorState.ts` — synchronous state machine for operational modes.

Internal state: `#currentState`, `#h1ObstructionThreshold (default 2)`, `#h1CriticalThreshold (default 5)`, `#eventBus`, `#lastStateChangeTime`

State transitions via `updateMetrics(h1Dimension)`:

| From       | Condition         | To         |
| ---------- | ----------------- | ---------- |
| NORMAL     | h1 >= critical    | CRITICAL   |
| NORMAL     | h1 >= obstruction | OBSTRUCTED |
| OBSTRUCTED | h1 >= critical    | CRITICAL   |
| OBSTRUCTED | h1 < obstruction  | NORMAL     |
| CRITICAL   | h1 < obstruction  | NORMAL     |
| Any        | same state        | no-op      |

Key design: CRITICAL does NOT transition to OBSTRUCTED — it must drop all the way to NORMAL (h1 < obstructionThreshold). This is the correct topology-motivated behavior: once the group exits the critical regime, we start fresh rather than lingering in OBSTRUCTED.

### interfaces.ts

`src/orchestrator/interfaces.ts` — shared type definitions.

Exports: `Agent` (5-stage lifecycle), `PoolConfig` (3 fields), `Task<T>`, `TaskResult<T>`, `AnyEvent = SheafEvent | SOCEvent`, `EventSubscriber = (event: AnyEvent) => void | Promise<void>`.

## Test Results

### EventBus (12 tests — T1-T10 + 2 additional)

| Test | Name                                                                     | Status |
| ---- | ------------------------------------------------------------------------ | ------ |
| T1   | Single subscriber receives emitted event                                 | PASS   |
| T2   | Multiple subscribers for same event all receive it                       | PASS   |
| T3   | Different event types route to different subscribers only                | PASS   |
| T4   | Unsubscribe prevents handler from receiving subsequent events            | PASS   |
| T5   | Async handlers run in parallel, not sequentially                         | PASS   |
| T6   | emit with no subscribers resolves without error                          | PASS   |
| T7   | Handler that throws causes emit() to reject                              | PASS   |
| T8   | Same handler subscribed twice is called twice per emit                   | PASS   |
| T9   | Event type matching is case-sensitive                                    | PASS   |
| T10  | getSubscriberCount returns accurate counts through subscribe/unsubscribe | PASS   |
| A1   | EventBus has accessible EventEmitter via .emitter property               | PASS   |
| A2   | Multiple event types tracked independently                               | PASS   |

### AgentPool (12 tests — T1-T10 + 2 additional)

| Test | Name                                                                                 | Status |
| ---- | ------------------------------------------------------------------------------------ | ------ |
| T1   | initialize() spawns all agents in parallel and marks them active                     | PASS   |
| T2   | getIdleAgents() returns only agents with status idle                                 | PASS   |
| T3   | Heartbeat interval fires periodically on all active agents                           | PASS   |
| T4   | Per-agent heartbeat timeout marks timed-out agent terminated without blocking others | PASS   |
| T5   | shutdown() calls cleanup() on all agents                                             | PASS   |
| T6   | shutdown() is idempotent — calling twice does not throw                              | PASS   |
| T7   | getAgents() includes terminated agents                                               | PASS   |
| T8   | Agent status transitions follow lifecycle order                                      | PASS   |
| T9   | Heartbeat failure is caught, agent marked terminated, pool remains responsive        | PASS   |
| T10  | Multiple shutdown calls result in exactly one cleanup() per agent                    | PASS   |
| A1   | getAgentCount() returns total pool size                                              | PASS   |
| A2   | Empty pool (size=0) initializes and shuts down cleanly                               | PASS   |

### OrchestratorStateManager (12 tests — T1-T8 + 4 additional)

| Test | Name                                                               | Status |
| ---- | ------------------------------------------------------------------ | ------ |
| E1   | Exports NORMAL, OBSTRUCTED, CRITICAL enum values                   | PASS   |
| T1   | NORMAL → OBSTRUCTED when H1 reaches obstruction threshold          | PASS   |
| T2   | OBSTRUCTED → CRITICAL when H1 exceeds critical threshold           | PASS   |
| T3   | CRITICAL → NORMAL when H1 drops below obstruction threshold        | PASS   |
| T4   | State change event has all required payload fields                 | PASS   |
| T5   | getState() and getLastStateChangeTime() update correctly           | PASS   |
| T6   | No event emitted when state does not change                        | PASS   |
| T7   | Custom thresholds control transition points                        | PASS   |
| T8   | H1=0 brings any state back to NORMAL                               | PASS   |
| A1   | NORMAL can jump directly to CRITICAL if H1 >= criticalThreshold    | PASS   |
| A2   | CRITICAL stays CRITICAL when H1 is between obs and crit thresholds | PASS   |
| A3   | Initial state is NORMAL regardless of construction arguments       | PASS   |

**Total: 36 new tests — all passing.**
**Full suite: 275 tests across 25 test files — zero regressions.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] EventBus emit() method signature conflicts with EventEmitter base class**

- **Found during:** Post-task TypeScript compilation check (`tsc --noEmit`)
- **Issue:** `async emit(event: AnyEvent): Promise<void>` is not assignable to EventEmitter's `emit(eventName: string | symbol, ...args: any[]): boolean` — TypeScript TS2416 error
- **Fix:** Changed EventBus from `extends EventEmitter` to a standalone class. Added private `#emitter: EventEmitter` field for future Node.js infrastructure integration, exposed via `.emitter` getter. The plan's intent ("for future extension") is preserved via composition instead of inheritance.
- **Files modified:** `src/orchestrator/EventBus.ts`, `src/orchestrator/EventBus.test.ts`
- **Commit:** 57d8fec
- **Impact:** Zero — all 12 EventBus tests pass unchanged; external API (subscribe/emit/unsubscribe) is identical.

## Integration Readiness (for Phase 5 Plan 02)

### EventBus — ready

- All event type routing verified (sheaf/soc events)
- Async handler support confirmed
- `getSubscriberCount()` available for integration tests

### AgentPool — ready

- `Agent` interface stable (id, status, spawn/heartbeat/cleanup)
- MockAgent pattern established for Phase 02 tests
- `getIdleAgents()` ready for task assignment logic

### OrchestratorStateManager — ready

- Default thresholds (obs=2, crit=5) match H^1 typical range in 3-agent AGEM
- StateChangeEvent format stable for downstream consumers
- `getState()` ready for Orchestrator main loop conditionals

## State for Next Plan (05-02)

All three Wave 1 modules are ready for composition root and llm_map integration:

- Import path: `import { EventBus } from '../orchestrator/EventBus.js'`
- Import path: `import { AgentPool } from '../orchestrator/AgentPool.js'`
- Import path: `import { OrchestratorState, OrchestratorStateManager } from '../orchestrator/OrchestratorState.js'`
- Import path: `import type { Agent, PoolConfig, AnyEvent, EventSubscriber } from '../orchestrator/interfaces.js'`

No circular dependencies — all orchestrator modules import only from `src/types/` (Events.ts) and from each other within `src/orchestrator/`.

## Self-Check: PASSED

Files checked:

- FOUND: src/orchestrator/interfaces.ts
- FOUND: src/orchestrator/EventBus.ts
- FOUND: src/orchestrator/EventBus.test.ts
- FOUND: src/orchestrator/AgentPool.ts
- FOUND: src/orchestrator/AgentPool.test.ts
- FOUND: src/orchestrator/OrchestratorState.ts
- FOUND: src/orchestrator/OrchestratorState.test.ts

Commits checked:

- FOUND: 6393f0a (interfaces)
- FOUND: cc76366 (EventBus)
- FOUND: 34af321 (AgentPool)
- FOUND: 8b06107 (OrchestratorState)
- FOUND: 57d8fec (TypeScript fix)

Test count: 36 new + 239 prior = 275 total passing.
TypeScript: `tsc --noEmit` — zero errors.
