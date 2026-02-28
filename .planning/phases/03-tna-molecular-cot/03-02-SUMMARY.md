---
phase: 03-tna-molecular-cot
plan: 02
subsystem: tna
tags: [graphology, louvain, community-detection, betweenness-centrality, determinism, mulberry32, prng, bridge-nodes]

# Dependency graph
requires:
  - phase: 03-01
    provides: CooccurrenceGraph with getGraph(), Preprocessor, TextNode/TextEdge interfaces, graphology undirected graph
provides:
  - LouvainDetector: deterministic Louvain community detection (Mulberry32 PRNG via rng option)
  - CentralityAnalyzer: normalized betweenness centrality, bridge node identification
  - CooccurrenceGraph.updateNodeCentrality(): writes centrality scores back to TextNode metadata
  - CooccurrenceGraph.updateNodeCommunity(): writes community labels back to TextNode metadata
affects: [03-03 GapDetector uses LouvainDetector + CentralityAnalyzer outputs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createRequire CJS interop for graphology-metrics and graphology-communities-louvain subpath imports (NodeNext ESM)"
    - "Mulberry32 PRNG for seeded determinism — injected via rng option, not Math.random patch"
    - "louvain.detailed() returns modularity score alongside community partition"
    - "betweennessCentrality(graph, {normalized: true}) → scores in [0,1]"

key-files:
  created:
    - src/tna/LouvainDetector.ts
    - src/tna/LouvainDetector.test.ts
    - src/tna/CentralityAnalyzer.ts
    - src/tna/CentralityAnalyzer.test.ts
  modified:
    - src/tna/CooccurrenceGraph.ts (added updateNodeCentrality() + updateNodeCommunity())

key-decisions:
  - "Mulberry32 PRNG seeded via rng option (Option A from plan) — graphology-communities-louvain natively supports rng parameter"
  - "createRequire CJS interop for graphology-metrics subpath (no package.json exports field, NodeNext fails on bare subpath)"
  - "louvain.detailed() for modularity score — ILouvain interface typed locally via createRequire cast"
  - "updateNodeCentrality() and updateNodeCommunity() added to CooccurrenceGraph (Rule 2 — required for T15 metadata writeback)"

patterns-established:
  - "PRNG seeding pattern: mulberry32(seed) → () => number, injected as rng option"
  - "CJS interop via createRequire for libraries without package.json exports"
  - "Two-clique test graph: 5+5 nodes, weight-10 intra-clique edges, weight-1 bridge edge a1--b1"

# Metrics
duration: ~8min
completed: 2026-02-28
---

# Phase 3 Plan 02: LouvainDetector + CentralityAnalyzer Summary

**Deterministic Louvain community detection (Mulberry32 seeded PRNG via rng option) and normalized betweenness centrality (graphology-metrics) with bridge node metadata writeback to CooccurrenceGraph**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-28T18:30:29Z
- **Completed:** 2026-02-28T18:38:00Z
- **Tasks:** 2/2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- Louvain determinism PERMANENTLY GUARDED: T9 (10 runs same seed = identical) is a regression test that will catch any future non-determinism (ROADMAP success criterion 2)
- CentralityAnalyzer identifies bridge nodes (a1, b1 in two-clique graph) with highest betweenness centrality, confirmed by T13
- TextNode.betweennessCentrality populated after compute() — GapDetector (Wave 3) has direct metadata access without recomputing

## Task Commits

Each task was committed atomically:

1. **Task 1: TDD LouvainDetector with deterministic seeding** - `71599a8` (feat)
2. **Task 2: TDD CentralityAnalyzer (betweenness centrality for bridge node identification)** - `554a5d3` (feat)

**Plan metadata:** (see final docs commit)

## Files Created/Modified

- `src/tna/LouvainDetector.ts` — Louvain community detection class: detect(seed?), getAssignment(), getCommunityMembers(), getCommunityCount(), getModularity()
- `src/tna/LouvainDetector.test.ts` — 8 tests: T9 (determinism 10-run), T9b (seed variation), T10/T10b (two-clique splits into 2), T11/T11b (complete graph = 1 community), T12/T12b (assignment + member lookup)
- `src/tna/CentralityAnalyzer.ts` — Betweenness centrality class: compute(), getScore(), getTopNodes(n), getBridgeNodes(threshold)
- `src/tna/CentralityAnalyzer.test.ts` — 8 tests: T13 (bridge nodes highest centrality), T13b (peripheral low), T14 (scores in [0,1]), T14b (K5 uniform ≈ 0), T15 (TextNode metadata writeback), T15b (top-N ranking)
- `src/tna/CooccurrenceGraph.ts` — Added updateNodeCentrality() and updateNodeCommunity() methods

## Decisions Made

- **Mulberry32 PRNG (Option A):** graphology-communities-louvain natively supports `rng` function option. Pass `mulberry32(seed)` directly — clean, zero patching of Math.random, no save/restore needed.
- **createRequire for CJS interop:** Both `graphology-metrics/centrality/betweenness` (no package.json exports) and `graphology-communities-louvain` (CJS default export with attached methods) require createRequire pattern in NodeNext ESM. This is consistent with the `GraphConstructor` cast pattern established in Wave 1.
- **louvain.detailed() for modularity:** The library's `detailed()` variant returns `{ communities, modularity, count, ... }` which gives us both the partition and quality score in one call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Added updateNodeCentrality() and updateNodeCommunity() to CooccurrenceGraph**
- **Found during:** Task 2 (CentralityAnalyzer implementation)
- **Issue:** Plan specified `updateNodeCentrality()` should be added to CooccurrenceGraph if not present — it was not present. T15 requires TextNode.betweennessCentrality to be populated after compute()
- **Fix:** Added both updateNodeCentrality(nodeId, score) and updateNodeCommunity(nodeId, communityId) to CooccurrenceGraph's public API
- **Files modified:** src/tna/CooccurrenceGraph.ts
- **Verification:** T15 passes — getNode('a1').betweennessCentrality is defined and > 0 after compute()
- **Committed in:** 554a5d3 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed TypeScript module resolution errors for CJS libraries under NodeNext**
- **Found during:** Task 2 post-GREEN phase typecheck
- **Issue:** Three TypeScript errors: (a) `graphology-metrics/centrality/betweenness` subpath not resolvable (no exports field), (b) `louvain.detailed` not visible on default import type, (c) `score: unknown` from `Object.entries` on untyped return
- **Fix:** Used `createRequire(import.meta.url)` for both libraries, defined local ILouvain and IBetweennessCentrality interfaces with correct return types, eliminating all type errors
- **Files modified:** src/tna/LouvainDetector.ts, src/tna/CentralityAnalyzer.ts
- **Verification:** `npx tsc --noEmit` exits 0 with zero errors
- **Committed in:** 554a5d3 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing functionality, 1 Rule 1 bug fix)
**Impact on plan:** Both fixes essential for correctness. No scope creep. Consistent with NodeNext ESM patterns from Wave 1 (GraphConstructor cast).

## Issues Encountered

None beyond the auto-fixed TypeScript interop issues above.

## Self-Check

Verifying claims before state update:

- `src/tna/LouvainDetector.ts` exists: YES (71599a8)
- `src/tna/LouvainDetector.test.ts` exists: YES (71599a8)
- `src/tna/CentralityAnalyzer.ts` exists: YES (554a5d3)
- `src/tna/CentralityAnalyzer.test.ts` exists: YES (554a5d3)
- All 8 LouvainDetector tests pass: YES (38 total TNA tests pass)
- All 8 CentralityAnalyzer tests pass: YES (38 total TNA tests pass)
- TypeScript: zero errors: YES (`npx tsc --noEmit` exits 0)
- No cross-module imports: YES (verified by grep)

## Self-Check: PASSED

All files exist, all commits verified, all tests green.

## Next Phase Readiness

- Wave 2 complete: LouvainDetector + CentralityAnalyzer ready for GapDetector consumption
- GapDetector (Plan 03-03) can call `detector.detect(seed)` for community assignments and `analyzer.getBridgeNodes(threshold)` for bridge candidates
- TextNode metadata (communityId, betweennessCentrality) populated after running both analyzers
- TNA module still needs barrel export (Plan 03-03)

---
*Phase: 03-tna-molecular-cot*
*Completed: 2026-02-28*
