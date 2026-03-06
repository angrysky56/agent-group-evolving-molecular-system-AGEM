---
phase: 06-p2-enhancements
plan: 02
subsystem: orchestrator
tags: [vdw-agents, obstruction-handling, regime-gating, hysteresis, token-budget, event-bus, tna]

# Dependency graph
requires:
  - phase: 06-01
    provides: "RegimeValidator, RegimeAnalyzer, regime:classification events from SOCTracker"
  - phase: 05-03
    provides: "ObstructionHandler, ComposeRootModule, EventBus, GapDetector"
provides:
  - "VdWAgent: ephemeral reasoning agent with bounded lifecycle (spawning→active→terminated)"
  - "VdWAgentSpawner: regime-gated H^1-parameterized spawner with hysteresis, cooldown, cap"
  - "ObstructionHandler integration: optional VdW spawner injection via config"
  - "ComposeRootModule wiring: regime:classification and H^1 events forwarded to spawner"
  - "New event types: orch:vdw-agent-spawned, orch:vdw-agent-complete in AnyEvent union"
affects: ["06-03", "06-04", "Phase7-real-llm-inference"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Regime-gated spawning: stable suppresses, nascent limits, transitioning/critical enables"
    - "H^1 hysteresis: consecutive iteration count prevents transient-spike false spawning"
    - "Inverse token budget scaling: max(500, 5000/h1Dimension) — more obstruction = smaller budget per agent"
    - "Spawn cooldown: same gap not re-spawned within N iterations"
    - "Concurrent agent cap: maxConcurrentAgents=10 prevents resource exhaustion"
    - "Serialized agent execution: runAgents() processes one at a time to avoid graph mutation races"
    - "Optional spawner injection: config.vdwSpawner enables backward compatibility"
    - "Regime via method call, not import: VdWAgentSpawner receives regime as string, never imports soc/"

key-files:
  created:
    - "src/orchestrator/VdWAgentSpawner.ts"
    - "src/orchestrator/VdWAgentSpawner.test.ts"
  modified:
    - "src/types/Events.ts"
    - "src/orchestrator/interfaces.ts"
    - "src/orchestrator/ObstructionHandler.ts"
    - "src/orchestrator/ComposeRootModule.ts"
    - "src/orchestrator/ObstructionHandler.test.ts"
    - "src/orchestrator/index.ts"

key-decisions:
  - "VdWAgentSpawner receives regime as string argument (not RegimeStability import) to maintain soc/ isolation"
  - "VdWAgent.getResults() returns readonly arrays; ingestTokens() requires spread ([...readonly]) for mutable arg"
  - "Agents serialized in runAgents() (not parallel) to avoid graph mutation races per research doc"
  - "VdWAgent stores h1Dimension in params but complete event iteration field is a proxy — real tracking done by ObstructionHandler"
  - "AnyEvent union extended to include OrchestratorEvent (VdWAgentSpawnedEvent | VdWAgentCompleteEvent)"
  - "Pre-existing RegimeValidator.test.ts failures (9 tests from Plan 06-01) are unrelated to this plan"

patterns-established:
  - "VdW spawning pattern: evaluateAndSpawn() → runAgents() → integrate results into TNA graph"
  - "H^1 hysteresis pattern: updateH1Dimension() called before evaluateAndSpawn() each iteration"
  - "Optional feature injection pattern: config.optionalFeature ?? null for backward compatibility"

# Metrics
duration: 9min
completed: 2026-03-06
---

# Phase 6 Plan 02: VdW Agent Spawning (ORCH-06) Summary

**Regime-gated Van der Waals agent spawning with H^1 hysteresis, inverse token budget scaling, and bounded agent lifecycle integrated into the obstruction pipeline**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-06T08:07:24Z
- **Completed:** 2026-03-06T08:16:24Z
- **Tasks:** 5/5
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- VdWAgent class with bounded lifecycle (spawning→active→terminated), synthetic bridging query generation, and self-termination at configurable maxIterations
- VdWAgentSpawner with complete ORCH-06 spawning logic: 2-iteration H^1 hysteresis, regime gating (stable suppresses/nascent limits/transitioning-critical enables), inverse token budget, 10-agent cap, 3-iteration cooldown per gap
- Full integration into ObstructionHandler (optional injection, backward compatible) and ComposeRootModule (regime + H^1 event wiring)
- 101 new tests: 42 VdWAgentSpawner unit tests + 6 ObstructionHandler integration tests covering all ORCH-06 requirements; 471 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Define VdW event types and extend AnyEvent** - `3d63921` (feat)
2. **Task 2: Implement VdWAgentSpawner class** - `ead404c` (feat)
3. **Task 3: Integrate into ObstructionHandler and ComposeRootModule** - `c60effa` (feat)
4. **Task 4: Write VdWAgentSpawner unit tests** - `6c02d9b` (test)
5. **Task 5: Integration tests, barrel export, type fixes** - `bfbe43b` (feat)

## Files Created/Modified

- `src/orchestrator/VdWAgentSpawner.ts` — VdWAgent + VdWAgentSpawner classes (453 lines); regime-gated H^1-parameterized spawning, hysteresis, cooldown, bounded agent lifecycle
- `src/orchestrator/VdWAgentSpawner.test.ts` — 42 unit tests covering all spawn logic branches
- `src/types/Events.ts` — OrchestratorEventType, VdWAgentSpawnedEvent, VdWAgentCompleteEvent, OrchestratorEvent union added
- `src/orchestrator/interfaces.ts` — AnyEvent extended to include OrchestratorEvent
- `src/orchestrator/ObstructionHandler.ts` — optional vdwSpawner injection, VdW spawn logic in #processQueue, updateRegime/updateH1ForSpawner public methods, shutdown cleanup
- `src/orchestrator/ComposeRootModule.ts` — VdWAgentSpawner instantiation and injection, regime:classification and H^1 event wiring
- `src/orchestrator/ObstructionHandler.test.ts` — 6 integration tests for VdW spawning pipeline
- `src/orchestrator/index.ts` — VdWAgentSpawner, VdWAgent, VdWSpawnParams, VdWSpawnerConfig barrel exports

## Decisions Made

- **Regime as string, not imported type:** VdWAgentSpawner receives regime via `updateRegime(regime: string)` method call, never importing from soc/. This maintains module isolation (VdWAgentSpawner may import from tna/ only).
- **Readonly spread for ingestTokens:** `VdWAgent.getResults().entitiesAdded` returns `readonly string[]`; `ingestTokens()` requires mutable `string[]`. Fixed with `[...results.entitiesAdded]` spread.
- **Serialized agent execution:** `runAgents()` processes agents sequentially (not in parallel) to avoid graph mutation races per ORCH-06 research doc.
- **AnyEvent union extended:** Added OrchestratorEvent to AnyEvent union in interfaces.ts so VdW events flow through EventBus type system.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed readonly string[] incompatible with ingestTokens(string[]) in ObstructionHandler**
- **Found during:** Task 3 (ObstructionHandler integration)
- **Issue:** `VdWAgent.getResults().entitiesAdded` returns `readonly string[]` but `CooccurrenceGraph.ingestTokens()` requires mutable `string[]`. TypeScript error TS2345.
- **Fix:** Added spread `[...results.entitiesAdded]` to create mutable copy before calling ingestTokens.
- **Files modified:** src/orchestrator/ObstructionHandler.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** c60effa (Task 3 commit)

**2. [Rule 1 - Bug] Fixed EventSubscriber return type violation in test helper**
- **Found during:** Task 5 (barrel export and type fixes)
- **Issue:** `(e) => events.push(e)` returns `number` (array length) but EventSubscriber requires `void | Promise<void>`. TypeScript error TS2322.
- **Fix:** Changed to `(e) => { events.push(e); }` (statement body returns void).
- **Files modified:** src/orchestrator/VdWAgentSpawner.test.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** bfbe43b (Task 5 commit)

**3. [Rule 1 - Bug] Fixed `as Record<string, unknown>` cast incompatibility with typed event union**
- **Found during:** Task 5 (barrel export and type fixes)
- **Issue:** `VdWAgentSpawnedEvent | undefined` cannot be directly cast to `Record<string, unknown>` because the interface lacks an index signature. TypeScript error TS2352.
- **Fix:** Added intermediate `as unknown` cast: `... as unknown as Record<string, unknown>`.
- **Files modified:** src/orchestrator/VdWAgentSpawner.test.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** bfbe43b (Task 5 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs)
**Impact on plan:** All fixes were minor TypeScript type correctness issues. No scope changes or architectural modifications needed.

## Issues Encountered

None — plan executed with only minor TypeScript type fixes needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 06-03 (TNA-07: Catalyst Question Generation) can begin; VdW agents will receive catalyst questions as reasoning priors
- `VdWAgentSpawner` and `VdWAgent` are exported from `src/orchestrator/index.ts`
- Event flow verified: H^1 obstruction → regime check → hysteresis check → evaluateAndSpawn → runAgents → complete events
- All 471 tests passing, `tsc --noEmit` clean

## Self-Check: PASSED

- All 8 key files exist (2 created, 6 modified)
- All 5 task commits found: 3d63921, ead404c, c60effa, 6c02d9b, bfbe43b
- 471 tests passing across 31 test files
- `tsc --noEmit` clean

---
*Phase: 06-p2-enhancements*
*Completed: 2026-03-06*
