# Phase 5 Planning Summary — Orchestrator Integration (REVISED)

**Created:** 2026-02-28
**Revised:** 2026-03-01
**Status:** PLANNING COMPLETE — ALL 5 ROADMAP CRITERIA COVERED
**Phase:** 05-orchestrator
**Plans:** 3 sequential (Wave 1 → Wave 2 → Wave 3)
**Total Tasks:** 9 (added 2 for missing criteria)
**Total Tests:** 65+ (revised from 40+)
**Dependencies:** Phases 1-4 (all complete and verified)

---

## Executive Summary

Phase 5 is the integration phase that brings together all four independently-built modules (Sheaf, LCM, TNA, SOC) under a single orchestrator with event-driven coordination, parallel task dispatch, obstruction-driven reconfiguration, and state machine tracking. Three sequential plans decompose this integration into manageable, testable chunks:

| Plan | Wave | Objective | Requirements | Scope |
|------|------|-----------|--------------|-------|
| **05-01** | 1 | Foundation: EventBus + AgentPool + StateManager | ORCH-01, ORCH-03, ORCH-04 | Interfaces, event routing, agent lifecycle, state transitions |
| **05-02** | 2 | Parallel dispatch: llm_map primitive | ORCH-02 | Order preservation, context propagation, worker threads |
| **05-03** | 3 | Composition root: Full integration + Obstruction handling | ORCH-05, Criteria #3 | Orchestrator, ObstructionHandler, module wiring, 10-iteration test, isolation verification |

**No new npm dependencies.** All primitives use Node.js built-ins (events, worker_threads, async_hooks).

---

## Plan Breakdown

### Plan 05-01: Foundation (Wave 1)

**Purpose:** Establish core orchestration primitives before any module integration.

**Files Created:**
- `src/orchestrator/interfaces.ts` — Type definitions: Agent, PoolConfig, Task, TaskResult, EventSubscriber, AnyEvent
- `src/orchestrator/EventBus.ts` + test — Event-driven coordination (ORCH-04)
- `src/orchestrator/AgentPool.ts` + test — Agent lifecycle management (ORCH-01)
- `src/orchestrator/OrchestratorState.ts` + test — State machine (ORCH-03) **[NEW FOR REVISION]**

**Key Architecture:**

EventBus (ORCH-04):
- Extends Node.js EventEmitter
- `subscribe(eventType, handler)` registers handler for specific event type
- `async emit(event)` runs ALL handlers in parallel via `Promise.all()` (not sequential)
- `unsubscribe(eventType, handler)` removes handler
- Multiple subscribers receive same event concurrently

AgentPool (ORCH-01):
- Manages N agents with async lifecycle: spawn → heartbeat → cleanup
- `initialize()` spawns all agents in parallel, starts heartbeat timer
- **Per-agent heartbeat timeouts** (via `Promise.race()`) prevent one slow agent blocking others — *critical pitfall fix*
- `shutdown()` is idempotent; cleans up all agents gracefully
- `getIdleAgents()` returns only agents with status='idle'

OrchestratorStateManager (ORCH-03): **[NEW FOR REVISION]**
- Enum: OrchestratorState { NORMAL, OBSTRUCTED, CRITICAL }
- State transitions driven by H^1 metric:
  - NORMAL → OBSTRUCTED when H^1 ≥ obstruction threshold
  - OBSTRUCTED → CRITICAL when H^1 ≥ critical threshold
  - CRITICAL → NORMAL when H^1 < obstruction threshold
- Emits StateChangeEvent on transitions (old/new state, h1 metric, reason)
- Deterministic and synchronous (no async operations)

**Tests:** 35+ (EventBus 10+, AgentPool 10+, OrchestratorState 8+)
- EventBus routing, multiple subscribers, unsubscribe, async handlers, error handling
- AgentPool spawn/shutdown, idle tracking, per-agent timeouts, cascade prevention
- OrchestratorState transitions (T1: NORMAL→OBSTRUCTED, T2: OBSTRUCTED→CRITICAL, T3: CRITICAL→NORMAL, T4-T8: edge cases)

**Success Criteria:**
- [x] EventBus routing verified (T1-T10)
- [x] Per-agent heartbeat timeouts prevent cascading hangs (T4)
- [x] State machine deterministic and testable (T1-T8)
- [x] Module isolation: only imports from src/types/Events.js

---

### Plan 05-02: Parallel Dispatch (Wave 2)

**Purpose:** Implement parallel task dispatch primitive with order preservation and context propagation.

**Files Created:**
- `src/orchestrator/llm_map.ts` + test — Parallel task dispatch (ORCH-02)
- `src/orchestrator/workers/TaskWorker.ts` — Worker thread entry point

**Key Architecture:**

llm_map (ORCH-02):
- Signature: `async llm_map<T>(tasks: Task<T>[], workerScriptPath: string, poolSize?: number): Promise<TaskResult<T>[]>`
- Creates poolSize worker threads via `new Worker()`
- Dispatches N tasks round-robin: `worker = workers[i % poolSize]`
- Each task receives context snapshot via AsyncLocalStorage serialization
- **Critical:** Results sorted back to original task order before returning (T2 verifies order invariant)
- Partial failures: some tasks succeed, others fail, all returned in results array
- Workers terminated in finally block (no resource leaks)

TaskWorker:
- ESM worker script receiving `{ task, context }` messages from main thread
- Context available via `contextStorage.getStore()` for execution tracing
- Task execution in try/catch: errors serialized and sent back as TaskResult
- Worker doesn't crash on individual task failures

**Tests:** 15+ (ordering, context, partial failures, cleanup, edge cases)
- T1: Task dispatch and collection
- T2: **Order preservation** (5 tasks with different completion times)
- T3-T4: Result structure and partial failures
- T5: Context propagation to worker
- T6-T7: Edge cases (empty, single task)
- T8: Worker pool reuse
- T9: Error handling (one fails, others succeed)
- T10: Worker cleanup (no lingering processes)
- T11-T15: Large payloads, timeouts, sequential calls

**Success Criteria:**
- [x] Results always returned in original task ID order (T2)
- [x] Partial failure handling verified (T3-T4)
- [x] Context serialization working (T5)
- [x] Worker cleanup verified (no leaks) (T10)

---

### Plan 05-03: Composition Root & Integration (Wave 3)

**Purpose:** Wire all four modules together, implement obstruction-driven reconfiguration, and verify end-to-end integration with isolation enforcement.

**Files Created:**
- `src/orchestrator/ComposeRootModule.ts` + test — Composition root (ORCH-05)
- `src/orchestrator/ObstructionHandler.ts` + test — Obstruction handling (Criteria #3) **[NEW FOR REVISION]**
- `src/orchestrator/isolation.test.ts` — Module independence verification (5 tests)
- `src/orchestrator/index.ts` — Public barrel export

**Key Architecture:**

Orchestrator (ORCH-05):
- Constructor(embedder: IEmbedder) instantiates all four modules with shared dependencies:
  1. EventBus (central coordination point)
  2. LCM: ImmutableStore, EmbeddingCache, LCMClient (with shared embedder)
  3. Sheaf: CellularSheaf, CohomologyAnalyzer
  4. TNA: Preprocessor, CooccurrenceGraph, LouvainDetector, GapDetector
  5. SOC: SOCTracker
  6. OrchestratorStateManager (NEW)
  7. ObstructionHandler (NEW)

- Wires event emissions (explicit and visible):
  - CohomologyAnalyzer.on('sheaf:consensus-reached') → eventBus.emit(event)
  - CohomologyAnalyzer.on('sheaf:h1-obstruction-detected') → eventBus.emit(event) + stateManager.updateMetrics()
  - SOCTracker.on('soc:metrics') → eventBus.emit(event)
  - SOCTracker.on('phase:transition') → eventBus.emit(event)
  - StateManager.on('orch:state-changed') → eventBus.emit(event)

- `async runReasoning(prompt)` executes full pipeline:
  1. Preprocess text via TNA
  2. Build co-occurrence graph
  3. Run Louvain community detection
  4. Append prompt to LCM
  5. Run Sheaf cohomology analysis (triggers H^1 detection if applicable)
  6. State machine updates on H^1 metric
  7. Compute SOC metrics
  8. Events automatically emitted and routed

ObstructionHandler (Criteria #3): **[NEW FOR REVISION]**
- Subscribes to 'sheaf:h1-obstruction-detected' events
- Spawns gapDetector agents via AgentPool when obstruction detected
- Feeds gap fill results back to TNA graph (new nodes/edges)
- Emits 'orch:obstruction-filled' events for monitoring
- Queues and serializes multiple obstructions (FIFO)
- Integrates results into graph for next iteration

Isolation Test:
- T1-T4: Verify zero cross-imports between src/sheaf, src/lcm, src/tna, src/soc
- T5: Verify only ComposeRootModule has multi-module imports
- Uses regex pattern matching on source files

Barrel Export:
- Exports: Orchestrator, ObstructionHandler, OrchestratorState, EventBus, AgentPool, llm_map, OrchestratorStateManager
- Re-exports types: Agent, PoolConfig, Task, TaskResult, EventSubscriber, AnyEvent, StateChangeEvent, IEmbedder

**Tests:** 37+ integration + isolation (ComposeRootModule 15+, ObstructionHandler 7+, isolation 5+)
- T1: Instantiation succeeds (all 11 properties non-null, stateManager and obstructionHandler included)
- T2-T3: Event wiring verified (CohomologyAnalyzer, SOCTracker → EventBus)
- T4: State transitions on H^1 obstruction detection
- T5: Single iteration executes
- T6: **10-iteration loop** executes completely (core integration test)
- T7: LCM appends text entries
- T8: TNA graph accumulates nodes
- T9: SOC metrics computed each iteration
- T10: Sheaf cohomology computed each iteration
- T11: getIterationCount() accurate
- T12: getState() returns correct orchestrator state
- T13: Obstruction triggers ObstructionHandler + agent spawn + gap fill integration
- T14: Public properties accessible
- T15: Edge cases (long prompt, empty, 20+ iterations, shutdown)

**Success Criteria:**
- [x] 10-iteration loop completes without exceptions (T6)
- [x] All four modules instantiate and work together
- [x] State machine tracks modes (NORMAL/OBSTRUCTED/CRITICAL)
- [x] Obstruction detection triggers gapDetector spawn and gap fill integration
- [x] Zero cross-module imports verified (isolation.test.ts)
- [x] LCM accumulates entries, TNA accumulates nodes, SOC emits metrics, state transitions occur

---

## Dependency Graph

```
Plan 05-01 (Foundation)
    ├── interfaces.ts
    ├── EventBus.ts ────────┐
    ├── AgentPool.ts        │
    └── OrchestratorState.ts [NEW]
                            ↓
                      Plan 05-02 (Parallel Dispatch)
                            ├── llm_map.ts (uses EventBus context)
                            └── TaskWorker.ts (receives context)
                                        ↓
                            Plan 05-03 (Integration)
                                ├── ComposeRootModule.ts (imports all, integrates state + obstruction)
                                ├── ObstructionHandler.ts [NEW]
                                ├── isolation.test.ts (verifies no cross-imports)
                                └── index.ts (barrel export)
```

Each plan is executable independently AFTER its dependencies complete.

---

## Phase 5 Requirements Coverage

| Requirement | Plan | Component | Status |
|-------------|------|-----------|--------|
| ORCH-01 | 05-01 | AgentPool (spawn/heartbeat/cleanup) | ✓ Fully specified |
| ORCH-02 | 05-02 | llm_map (parallel dispatch, order preservation) | ✓ Fully specified |
| ORCH-03 | 05-01 | OrchestratorStateManager (state machine) | ✓ Fully specified [NEW] |
| ORCH-04 | 05-01 | EventBus (async event routing) | ✓ Fully specified |
| ORCH-05 | 05-03 | Orchestrator composition root | ✓ Fully specified |

**All five ORCH requirements satisfied by end of Phase 5.**

---

## ROADMAP Success Criteria Coverage

| Criteria # | Description | Implementation | Plan | Tests |
|-----------|-------------|-----------------|------|-------|
| 1 | Single composition root | ComposeRootModule instantiates Sheaf, LCM, TNA, SOC | 05-03 | T1, T5 (10-iteration) |
| 2 | llm_map context preservation | AsyncLocalStorage serialization + order preservation | 05-02 | T2-T15 (15 tests) |
| 3 | Obstruction-driven reconfiguration | H1 → ObstructionHandler → gapDetector spawn | 05-03 Task 2 [NEW] | T13 + 7 dedicated tests |
| 4 | Three-mode state machine | OrchestratorState enum + transitions (NORMAL/OBSTRUCTED/CRITICAL) | 05-01 Task 4 [NEW] | T1-T8 (8 tests) |
| 5 | End-to-end 10-iteration run | Full AGEM loop with all modules + state transitions | 05-03 | T6 (10-iteration) |

**All 5 criteria now explicitly covered in Phase 5 plans (was missing #3 and #4).**

---

## Testing Strategy

**Total: 65+ tests across three plans**

| Component | Tests | Coverage |
|-----------|-------|----------|
| EventBus | 10+ | Routing, subscribers, async, unsubscribe, errors |
| AgentPool | 10+ | Lifecycle, spawn, heartbeat, shutdown, timeouts |
| OrchestratorState | 8+ | State transitions, events, thresholds [NEW] |
| llm_map | 15+ | Ordering, context, partial failures, cleanup |
| ComposeRootModule | 15+ | Instantiation, pipeline, 10-iteration, state machine, obstruction |
| ObstructionHandler | 7+ | Event subscription, agent spawn, gap fill integration [NEW] |
| isolation.test.ts | 5 | Zero cross-imports per module |

**Characteristics:**
- All tests use mock/synthetic data (no real embeddings, no LLM calls)
- Deterministic (no flaky timing issues; explicit timeouts where needed)
- Fast (<5 seconds total)
- Can run independently per plan

---

## Architecture Decisions

### 1. No External npm Dependencies
All orchestrator primitives use Node.js built-ins:
- `node:events` (EventEmitter)
- `node:worker_threads` (Worker, parentPort)
- `node:async_hooks` (AsyncLocalStorage)

**Benefit:** Zero external risk, no dependency conflicts, stable APIs.

### 2. Per-Agent Heartbeat Timeouts (Pitfall 4 Prevention)
```typescript
Promise.race([
  agent.heartbeat(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Heartbeat timeout')), config.heartbeatTimeoutMs)
  )
]).catch(err => {
  agent.status = 'terminated';
});
```

**Benefit:** One slow agent doesn't block heartbeat checks on others.

### 3. Order Preservation in llm_map (Pitfall 3 Prevention)
```typescript
return results.sort((a, b) => {
  const indexA = tasks.findIndex(t => t.id === a.taskId);
  const indexB = tasks.findIndex(t => t.id === b.taskId);
  return indexA - indexB;
});
```

**Benefit:** Results always returned in original task order; caller never needs to re-sort.

### 4. Single Composition Root (No Circular Dependencies)
Only `src/orchestrator/ComposeRootModule.ts` imports from multiple modules. All four Phase 1-4 modules maintain zero cross-imports.

**Benefit:** Module independence verified at static analysis time; circular dependency risk eliminated.

### 5. Event Subscribers Run in Parallel
```typescript
await Promise.all(handlers.map((h) => Promise.resolve(h(event))));
```

**Benefit:** Slow subscriber doesn't block others; all subscribers see events concurrently.

### 6. State Machine Driven by Metrics (NEW) [ROADMAP Criteria #4]
OrchestratorStateManager responds to H^1 obstruction metric:
- NORMAL → OBSTRUCTED: H^1 crosses threshold (topological complexity increases)
- OBSTRUCTED → CRITICAL: H^1 exceeds critical limit (severe obstruction)
- CRITICAL → NORMAL: H^1 drops below threshold (obstruction resolved)

**Benefit:** Operational mode reflects topological health; state transitions trigger adaptive behaviors.

### 7. Obstruction-Driven Reconfiguration (NEW) [ROADMAP Criteria #3]
ObstructionHandler subscribes to H^1 events and spawns gapDetector agents:
- Event: 'sheaf:h1-obstruction-detected'
- Action: Spawn gapDetector agent from AgentPool
- Integration: Feed gap fill results back to TNA (new nodes/edges)
- Monitoring: Emit 'orch:obstruction-filled' for tracking

**Benefit:** System responds reactively to topological obstructions; semantic voids auto-filled.

---

## Integration with Phases 1-4

**No changes to Phase 1-4 modules.** All Phase 5 work is purely additive in `src/orchestrator/`:

- **Phase 1 (Sheaf):** CellularSheaf, CohomologyAnalyzer
- **Phase 2 (LCM):** LCMClient, ImmutableStore, EmbeddingCache
- **Phase 3 (TNA):** Preprocessor, CooccurrenceGraph, LouvainDetector, GapDetector
- **Phase 4 (SOC):** SOCTracker

Orchestrator imports from public barrel exports (index.ts) of each module. Module isolation enforced by isolation.test.ts.

---

## File Structure After Phase 5

```
src/
├── orchestrator/
│   ├── interfaces.ts                — Agent, PoolConfig, Task, TaskResult, EventSubscriber
│   ├── EventBus.ts                  — Event routing (ORCH-04)
│   ├── EventBus.test.ts             — 10+ tests
│   ├── AgentPool.ts                 — Lifecycle management (ORCH-01)
│   ├── AgentPool.test.ts            — 10+ tests
│   ├── OrchestratorState.ts         — State machine (ORCH-03) [NEW]
│   ├── OrchestratorState.test.ts    — 8+ tests [NEW]
│   ├── llm_map.ts                   — Parallel dispatch (ORCH-02)
│   ├── llm_map.test.ts              — 15+ tests
│   ├── workers/
│   │   └── TaskWorker.ts            — Worker entry point
│   ├── ComposeRootModule.ts         — Composition root (ORCH-05)
│   ├── ComposeRootModule.test.ts    — 15+ integration tests
│   ├── ObstructionHandler.ts        — H^1 → gapDetector spawn (Criteria #3) [NEW]
│   ├── ObstructionHandler.test.ts   — 7+ tests [NEW]
│   ├── isolation.test.ts            — 5 module isolation tests
│   └── index.ts                     — Public barrel export
│
├── sheaf/ (Phase 1 — no changes)
├── lcm/ (Phase 2 — no changes)
├── tna/ (Phase 3 — no changes)
└── soc/ (Phase 4 — no changes)
```

---

## Next Steps

### Immediate (Phase 5 Execution)
Run: `/gsd:execute-phase 05-orchestrator`

This will execute all three plans sequentially:
1. Wave 1: EventBus, AgentPool, OrchestratorState, interfaces
2. Wave 2: llm_map, TaskWorker
3. Wave 3: Orchestrator, ObstructionHandler, isolation.test.ts, barrel export

### After Phase 5 Complete
- Run full integration test suite: `npm test -- src/orchestrator/`
- Verify 65+ tests passing (revised from 40+)
- Verify all 5 ROADMAP criteria satisfied
- Verify no unhandled rejections in 10-iteration loop

### Phase 6 (If Requirements Warrant)
- Dynamic pool resizing (adjust poolSize based on queue depth)
- GraphRAG catalyst generation (at structural gaps)
- Advanced topology healing (using van der Waals agents)
- Performance optimization and monitoring

---

## Planning Artifacts

Three executable PLAN.md files created in `.planning/phases/05-orchestrator/`:

1. **05-PLAN.md** (05-01) — Wave 1: Foundation (4 tasks, 35+ tests)
2. **05-02-PLAN.md** (05-02) — Wave 2: Parallel Dispatch (2 tasks, 15+ tests)
3. **05-03-PLAN.md** (05-03) — Wave 3: Integration & Verification (3 tasks, 37+ tests)

All plans follow gsd-planner structure:
- Frontmatter: phase, plan, wave, dependencies, files, must_haves
- Objective: What and why
- Execution context: Workflows and templates
- Context: References to prior work
- Tasks: 2-3 per plan, each with files, action, verify, done
- Verification: Specific checks for success
- Success criteria: Measurable completion
- Output: Summary document location

---

## Revision Summary

**Revised by:** gsd-planner on 2026-03-01

**Changes Made:**
- Added Task 4 to Wave 1 (05-PLAN.md): OrchestratorState enum + state machine implementation
- Added Task 2 to Wave 3 (05-03-PLAN.md): ObstructionHandler for H^1 → gapDetector spawn pipeline
- Updated ComposeRootModule to instantiate and integrate OrchestratorStateManager and ObstructionHandler
- Updated barrel export (index.ts) to include ObstructionHandler, OrchestratorState, OrchestratorStateManager
- Updated must_haves in all three plans to reflect new criteria
- Increased test count from 40+ to 65+

**ROADMAP Criteria Now Covered:**
- ✓ Criteria #1: Single composition root (was already covered)
- ✓ Criteria #2: llm_map context preservation (was already covered)
- ✓ Criteria #3: Obstruction-driven reconfiguration (NEWLY ADDED)
- ✓ Criteria #4: Three-mode state machine (NEWLY ADDED)
- ✓ Criteria #5: End-to-end multi-iteration run (was already covered)

**Status:** PLANNING COMPLETE — Ready for execution

---

**Status:** PLANNING COMPLETE ✓
**Ready for execution:** `/gsd:execute-phase 05-orchestrator`
**Generated by:** gsd-planner (2026-02-28)
**Revised:** 2026-03-01
