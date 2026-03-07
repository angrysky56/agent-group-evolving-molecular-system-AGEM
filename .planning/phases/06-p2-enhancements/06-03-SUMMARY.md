---
phase: 06-p2-enhancements
plan: 03
subsystem: tna
tags:
  [
    tna,
    centrality,
    catalyst,
    time-series,
    EventEmitter,
    templates,
    caching,
    trend-detection,
    betweenness,
  ]

# Dependency graph
requires:
  - phase: 06-01
    provides: RegimeValidator, RegimeAnalyzer, regime:classification events
  - phase: 06-02
    provides: VdWAgentSpawner, ORCH-06, ObstructionHandler VdW injection
  - phase: 03-03
    provides: GapDetector, CooccurrenceGraph, LouvainDetector, CentralityAnalyzer foundation
provides:
  - CatalystQuestionGenerator class with template-based gap question generation and gapId caching
  - CentralityAnalyzer extended with time-series tracking, trend detection, peak/valley, rapid change events
  - TNA event types: tna:catalyst-questions-generated, tna:centrality-change-detected, tna:topology-reorganized
  - TNAEvent discriminated union added to AnyEvent in orchestrator/interfaces.ts
  - Regime-adaptive centrality computation intervals (5/10/20 iterations)
  - Orchestrator wiring: CentralityAnalyzer events → EventBus; CatalystQuestionGenerator as public property
affects:
  - 06-04 (Dynamic sheaf topology uses community structure and centrality for visualization)
  - Future Phase 7 (LLM integration replaces template-based question generation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CentralityAnalyzer extends EventEmitter (same pattern as CohomologyAnalyzer, SOCTracker)"
    - "computeIfDue(iteration) pattern for regime-adaptive recomputation gating"
    - "gapId = communityA_communityB string key for caching and event routing"
    - "Template rotation: index % 3 selects from 3 question templates"
    - "Time-series trimmed to 50 entries per node (circular buffer semantics via splice)"
    - "Semantic distance proxy: TF-IDF weight difference → Phase 7 replaces with cosine similarity"

key-files:
  created:
    - src/tna/CatalystQuestionGenerator.ts
    - src/tna/CatalystQuestionGenerator.test.ts
  modified:
    - src/tna/CentralityAnalyzer.ts
    - src/tna/CentralityAnalyzer.test.ts
    - src/tna/interfaces.ts
    - src/tna/index.ts
    - src/types/Events.ts
    - src/orchestrator/interfaces.ts
    - src/orchestrator/ComposeRootModule.ts

key-decisions:
  - "Phase 6 semantic distance = TF-IDF weight proxy (not embedding cosine): deterministic, no LLM, Phase 7 replaces"
  - "Template rotation by index (not random) ensures deterministic and diverse question sets"
  - "gapId key format communityA_communityB (consistent with VdWAgentSpawner gap tracking)"
  - "computeIfDue() gates expensive betweenness centrality recomputation to avoid O(n^3) every iteration"
  - "Time-series capped at 50 entries (MAX_TIMESERIES_LENGTH) to prevent unbounded memory growth"
  - "Rapid change threshold 3x (rapidChangeMultiplier) calibrated to avoid noise from minor graph updates"
  - "Topology reorganization threshold >3 major rank changes (50% of total nodes per node = conservative)"
  - "Regime-adaptive intervals: critical=5, default=10, stable=20 (matching ROADMAP TNA-09 requirements)"
  - "CatalystQuestionGenerator: zero imports from lcm/sheaf/soc/orchestrator (TNA isolation preserved)"
  - "EventEmitter extension is additive: existing compute()/getScore()/getTopNodes()/getBridgeNodes() unchanged"

patterns-established:
  - "Pattern: CentralityAnalyzer computeIfDue() called each iteration in runReasoning() after Louvain detection"
  - "Pattern: EventEmitter.on() forwarding in #wireEventBus() for TNA → EventBus routing"
  - "Pattern: Regime string (not enum import) keeps SOC module isolated from orchestrator consumers"

# Metrics
duration: 11min
completed: 2026-03-06
---

# Phase 6 Plan 03: TNA Semantic Analysis (TNA-07 + TNA-09) Summary

**Template-based CatalystQuestionGenerator for gap-targeted bridging queries with centrality-ranked seed selection, plus CentralityAnalyzer extended with time-series trend detection, peak/valley tracking, rapid change events, and regime-adaptive recomputation intervals**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-03-06T08:22:19Z
- **Completed:** 2026-03-06T08:33:34Z
- **Tasks:** 5/5
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- **CatalystQuestionGenerator (TNA-07):** Extracts top N representative nodes per community by betweenness centrality, computes TF-IDF-based semantic distance proxy (Phase 6), generates 1-3 catalyst questions per gap using 3 rotating templates ("How does X relate to Y?", "What concept bridges X and Y?", "In what context would X and Y co-occur?"), caches by gapId, batch processing via generateBatchQuestions(), cache invalidation for stale gaps
- **CentralityAnalyzer time-series (TNA-09):** Extends EventEmitter, stores up to 50 score snapshots per node per computeIfDue() call, detects 'rising'/'falling'/'stable'/'oscillating' trends from last 3 data points, identifies peak and valley from stored history, emits 'tna:centrality-change-detected' on 3x score increase, emits 'tna:topology-reorganized' on >3 major rank changes, adjustInterval() sets 5/10/20 iteration intervals based on regime string
- **Event pipeline:** CentralityAnalyzer events wired through ComposeRootModule → EventBus → future consumers; regime:classification → adjustInterval() feedback loop; computeIfDue() called each iteration after Louvain
- **61 new tests:** 29 CatalystQuestionGenerator + 32 CentralityAnalyzer time-series; total now 532 (up from 471)
- **Isolation preserved:** CatalystQuestionGenerator and extended CentralityAnalyzer have zero imports from lcm/sheaf/soc/orchestrator; all 7 TNA isolation tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Define interfaces and event types** - `d46ff47` (feat)
2. **Task 2: Implement CatalystQuestionGenerator** - `b537c78` (feat)
3. **Task 3: Extend CentralityAnalyzer with time-series** - `5548094` (feat)
4. **Task 4: Comprehensive tests** - `f4234ff` (test)
5. **Task 5: Wire to orchestrator, barrel exports** - `ab1f3b7` (feat)

## Files Created/Modified

- `src/tna/CatalystQuestionGenerator.ts` — Template-based catalyst question generation for structural gaps; 3 rotating templates; centrality-ranked representative node selection; gapId cache; batch generation
- `src/tna/CatalystQuestionGenerator.test.ts` — 29 tests: representative nodes, generation, caching, batch, edge cases, 4 integration tests
- `src/tna/CentralityAnalyzer.ts` — Extended with EventEmitter, time-series Map, computeIfDue(), adjustInterval(), getTimeSeries(), getAllTimeSeries(), getRisingNodes(), #computeTrend(), #findPeak(), #findValley(); all 8 original tests still pass
- `src/tna/CentralityAnalyzer.test.ts` — Added 32 time-series tests: computeIfDue gating, trend detection, peak/valley, rapid change events, topology reorganization, regime-adaptive intervals, query methods
- `src/tna/interfaces.ts` — Added CatalystQuestion, CentralityTrend, CentralityTimeSeries, CentralityTimeSeriesConfig
- `src/tna/index.ts` — Barrel exports: CatalystQuestionGenerator class + 4 Phase 6 types
- `src/types/Events.ts` — Added TNAEventType, CatalystQuestionsGeneratedEvent, CentralityChangeDetectedEvent, TopologyReorganizedEvent, TNAEvent union
- `src/orchestrator/interfaces.ts` — AnyEvent = SheafEvent | SOCEvent | OrchestratorEvent | TNAEvent
- `src/orchestrator/ComposeRootModule.ts` — tnaCatalystGenerator property; CentralityAnalyzer event wiring; regime → adjustInterval() subscription; computeIfDue() in runReasoning()

## Decisions Made

- Phase 6 uses TF-IDF weight difference as semantic distance proxy (0 if both zero → falls back to centrality difference). Phase 7 will replace with cosine similarity of real embeddings.
- Template rotation by index (not random selection) ensures deterministic test behavior and balanced template coverage.
- gapId format `communityA_communityB` (e.g., "0_1") consistent with VdWAgentSpawner gap tracking from Plan 06-02.
- computeIfDue() gates the O(n^3) betweenness centrality computation to the configured interval; direct compute() remains available for tests.
- Time-series trimmed to 50 entries per node using splice (circular buffer semantics) to prevent unbounded memory growth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test T4 assumed specific node name as top centrality node**

- **Found during:** Task 4 (test execution)
- **Issue:** Test assumed 'alpha' was the highest-centrality node in community 0, but 'gamma' actually had higher betweenness centrality in the test graph
- **Fix:** Changed test to dynamically compute which node has highest centrality (reduce over community nodes), then assert that node is the seed
- **Files modified:** src/tna/CatalystQuestionGenerator.test.ts
- **Verification:** All 29 CatalystQuestionGenerator tests pass
- **Committed in:** f4234ff (Task 4 commit)

**2. [Rule 1 - Bug] Tests T-TS-7 and T-TS-13 tried to add edges that already existed**

- **Found during:** Task 4 (test execution)
- **Issue:** `ingestTokens(['p', 'q', 'r'])` already creates p-q, q-r, p-r edges via 4-gram sliding window; subsequent `g.addEdge('p', 'q', ...)` threw UsageGraphError (duplicate edge)
- **Fix:** T-TS-7: removed redundant addEdge calls (ingestTokens creates them automatically). T-TS-13: same fix.
- **Files modified:** src/tna/CentralityAnalyzer.test.ts
- **Verification:** All 40 CentralityAnalyzer tests pass
- **Committed in:** f4234ff (Task 4 commit)

**3. [Rule 1 - Bug] TypeScript error on topologyEvent.majorNodeSwaps in T-TS-22**

- **Found during:** Task 5 (tsc --noEmit after orchestrator wiring)
- **Issue:** `topologyEvent` typed as `Record<string, unknown> | null`; TS narrowed to `never` inside null check for property access
- **Fix:** Explicit cast `(topologyEvent as Record<string, unknown>)['majorNodeSwaps']` with typeof check
- **Files modified:** src/tna/CentralityAnalyzer.test.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** ab1f3b7 (Task 5 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 - Bug)
**Impact on plan:** All auto-fixes were test correctness issues (wrong assumption or runtime error). No scope creep. No architectural changes.

## Issues Encountered

None beyond the 3 auto-fixed bugs listed above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 06-04 (Dynamic sheaf topology)** can now use:
  - `tnaCatalystGenerator.generateQuestions(gap)` for structured bridging queries
  - `tnaCentrality.getTimeSeries(nodeId)` for identifying rising bridge nodes
  - `tnaCentrality.getRisingNodes()` for centrality-trend-based visualization prioritization
  - Community structure (LouvainDetector) and centrality (CentralityAnalyzer) for dynamic sheaf vertex assignment
- All TNA isolation tests pass — no new cross-module dependencies introduced
- 532 total tests passing; all prior test suites unaffected

## Self-Check: PASSED

All created/modified files exist and all commits are present:

- `src/tna/CatalystQuestionGenerator.ts` — FOUND
- `src/tna/CatalystQuestionGenerator.test.ts` — FOUND
- `src/tna/CentralityAnalyzer.ts` — FOUND (modified)
- `src/tna/CentralityAnalyzer.test.ts` — FOUND (modified)
- `src/tna/interfaces.ts` — FOUND (modified)
- `src/tna/index.ts` — FOUND (modified)
- `src/types/Events.ts` — FOUND (modified)
- `src/orchestrator/interfaces.ts` — FOUND (modified)
- `src/orchestrator/ComposeRootModule.ts` — FOUND (modified)
- Commits d46ff47, b537c78, 5548094, f4234ff, ab1f3b7 — all present in git log

---

_Phase: 06-p2-enhancements_
_Completed: 2026-03-06_
