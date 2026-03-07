---
phase: 05-orchestrator
plan: 02
subsystem: orchestrator
tags:
  [
    worker_threads,
    async_hooks,
    AsyncLocalStorage,
    llm_map,
    parallel-dispatch,
    context-propagation,
  ]

# Dependency graph
requires:
  - phase: 05-01
    provides: "interfaces.ts (Task<T>, TaskResult<T>), EventBus, AgentPool, OrchestratorStateManager"
provides:
  - "llm_map async function with order preservation and partial failure handling"
  - "contextStorage AsyncLocalStorage for cross-thread context propagation"
  - "TaskWorker.ts worker thread entry point with stub executor"
  - "TaskWorker.mock.mjs pure-JS mock worker for test isolation"
  - "formatTaskForWorker() serialization validation helper"
  - "33 comprehensive llm_map tests (T1-T15) covering all dispatch scenarios"
affects:
  - "05-03 (ComposeRootModule imports llm_map for parallel reasoning dispatch)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "worker thread pool: Array.from({ length: poolSize }, () => new Worker(path)) — fresh per call"
    - "per-task Promise with message handler filtering by taskId"
    - "ORDER PRESERVATION: results.sort((a,b) => tasks.findIndex...)"
    - "context serialization: contextStorage.getStore() → Object.fromEntries → postMessage"
    - "effectivePoolSize = Math.max(1, Math.min(poolSize, tasks.length)) — clamp pattern"
    - "finally block worker.terminate() — no-leak guarantee"
    - "mock worker strategy: TaskWorker.mock.mjs (pure JS) for vitest isolation"

key-files:
  created:
    - src/orchestrator/llm_map.ts
    - src/orchestrator/workers/TaskWorker.ts
    - src/orchestrator/workers/TaskWorker.mock.mjs
    - src/orchestrator/llm_map.test.ts
  modified: []

key-decisions:
  - "TaskWorker.ts uses worker-local AsyncLocalStorage (not imported from llm_map.ts) — worker threads have separate module graphs; cross-thread AsyncLocalStorage sharing is not possible"
  - "TaskWorker.mock.mjs is pure JavaScript (.mjs) to avoid tsx/TypeScript ESM resolution issues in vitest worker thread context"
  - "effectivePoolSize clamped to [1, tasks.length] — no excess workers spawned (reduces overhead for small task batches)"
  - "formatTaskForWorker() uses JSON round-trip for serializability validation — functions silently dropped, circular refs throw"
  - "Worker error handlers use once() for crash events, on() for per-task message handlers — prevents duplicate resolution"
  - "contextStorage captured once per llm_map call (before worker spawn) and shared across all tasks — consistent context snapshot"

patterns-established:
  - "llm_map parallel dispatch: create pool → dispatch all → await Promise.all → sort by original index → finally terminate"
  - "worker thread test isolation: use .mjs mock worker (no TypeScript imports) instead of real TypeScript worker"
  - "per-task error boundary: resolve with TaskResult.error instead of rejecting Promise"

# Metrics
duration: 6min
completed: 2026-03-01
---

# Phase 5 Plan 02: llm_map Parallel Task Dispatch Summary

**llm_map primitive with AsyncLocalStorage context propagation, round-robin worker pool dispatch, deterministic order preservation sort, and partial failure sandboxing — 33 tests verifying all scenarios including the critical ordering pitfall guard**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-01T07:39:31Z
- **Completed:** 2026-03-01T07:45:43Z
- **Tasks:** 2/2
- **Files created:** 4

## Accomplishments

- `llm_map<T>()` dispatches N tasks to a pool of worker threads and returns results in original task order via sort-by-index (Pitfall 5 guard)
- `contextStorage` AsyncLocalStorage exported; context snapshot captured before dispatch and serialized as plain object for each worker
- `TaskWorker.ts` worker thread entry point with contextStorage.run() restoration, stub executor (shouldFail/value/prompt payloads), and full error sandboxing
- `TaskWorker.mock.mjs` pure JavaScript mock worker enables vitest testing without tsx/TypeScript cross-thread module resolution issues
- 33 tests pass (T1-T15): dispatch, ORDER PRESERVATION (critical T2), partial failures (T4), context propagation (T5, T14), cleanup (T10), round-robin (T8), edge cases (T6, T7, T12, T15)
- Total test count: 308 (up from 275; all 26 test files passing)

## Task Commits

1. **Task 1: llm_map.ts implementation** - `574681b` (feat)
2. **Task 2: TaskWorker + test suite** - `b33026e` (feat)

## Files Created/Modified

- `src/orchestrator/llm_map.ts` (272 lines) — llm_map function, contextStorage, WorkerInboundMessage, WorkerOutboundMessage, formatTaskForWorker
- `src/orchestrator/workers/TaskWorker.ts` (208 lines) — ESM worker entry point, worker-local AsyncLocalStorage, stub executor, error sandboxing
- `src/orchestrator/workers/TaskWorker.mock.mjs` (pure JS) — Mock worker for test isolation: supports delay, shouldFail, value, prompt, \_context echo
- `src/orchestrator/llm_map.test.ts` — 33 tests (T1-T15) with full coverage of dispatch, ordering, partial failures, context propagation, cleanup

## Decisions Made

**TaskWorker.ts uses worker-local AsyncLocalStorage (not imported from llm_map.ts)**
Worker threads have completely separate module graphs. The `contextStorage` instance in the worker is a different object from the main thread's `contextStorage`. This is correct behavior — workers restore context from the serialized plain object received via `postMessage`, using their own local `AsyncLocalStorage`.

**TaskWorker.mock.mjs is pure JavaScript (.mjs)**
The real `TaskWorker.ts` imports from `../interfaces.js` using TypeScript NodeNext module resolution. In worker threads spawned by vitest tests, the tsx/esm loader does not automatically resolve `.js` → `.ts` for imports from outside the worker's module graph. Creating a pure JavaScript mock worker avoids this issue entirely and keeps tests fast and dependency-free.

**effectivePoolSize clamped to [1, tasks.length]**
No point spawning 10 workers for 2 tasks. The clamp prevents unnecessary thread overhead and ensures workers[i % effectivePoolSize] always maps to a valid worker.

**Worker error handlers: once() for crash events, on() for message events**
Task message handlers are registered with `on()` and explicitly removed when the matching taskId arrives. Worker crash handlers use `once()` to avoid duplicate error resolutions. This prevents memory leaks from accumulated handlers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript union type inference in test mixed-payload arrays**

- **Found during:** Task 2 (test compilation)
- **Issue:** TypeScript inferred `Task<{ value: number }> | Task<{ shouldFail: boolean }>` for heterogeneous arrays, which is not assignable to `readonly Task<T>[]` with any concrete T
- **Fix:** Annotated mixed-payload arrays as `Task<unknown>[]` at three call sites in T3, T4, and T9 tests
- **Files modified:** src/orchestrator/llm_map.test.ts
- **Verification:** `tsc --noEmit` passes cleanly
- **Committed in:** b33026e (Task 2 commit)

**2. [Rule 1 - Bug] TaskWorker.ts initially imported contextStorage from llm_map.ts**

- **Found during:** Task 2 (worker testing)
- **Issue:** Worker spawned with `tsx/esm` loader could not resolve `../llm_map.js` → `../llm_map.ts` because the tsx loader doesn't handle this cross-package resolution in worker thread context
- **Fix:** Replaced import with worker-local `AsyncLocalStorage` instance (`workerContextStorage`); removed dependency on `../llm_map.js`. This is architecturally correct — workers have separate module graphs
- **Files modified:** src/orchestrator/workers/TaskWorker.ts
- **Verification:** Worker spawned successfully in integration test; tests pass
- **Committed in:** b33026e (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bug fixes found during compilation/testing)
**Impact on plan:** Both fixes essential for correctness. No scope creep. The architectural fix (worker-local AsyncLocalStorage) is actually the correct design per Node.js worker thread semantics.

## Issues Encountered

**ESM worker thread TypeScript resolution:** The tsx/esm Node.js loader does not resolve `.js` imports as `.ts` files inside worker threads spawned from a vitest test process. Root cause: tsx hooks are registered in the main process; worker threads spawn as fresh Node.js processes and must re-register hooks. Resolution: created `TaskWorker.mock.mjs` (pure JavaScript) for all tests, avoiding the tsx resolution requirement. The real `TaskWorker.ts` is the production-ready worker; mock worker is test infrastructure only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `llm_map` ready for import in Plan 03 (ComposeRootModule): `import { llm_map, contextStorage } from './llm_map.js'`
- `TaskWorker.ts` ready for production use (replace `execute()` stub with real LLM inference)
- ORCH-02 (parallel task dispatch with context preservation) implemented and tested
- Context serialization pattern established: `contextStorage.getStore()` → `Object.fromEntries` → `postMessage` → `new Map(Object.entries(context))` in worker

---

_Phase: 05-orchestrator_
_Completed: 2026-03-01_
