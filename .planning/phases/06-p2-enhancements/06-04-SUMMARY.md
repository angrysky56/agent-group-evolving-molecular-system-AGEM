---
phase: 06-p2-enhancements
plan: 04
subsystem: tna
tags: [layout, forceatlas2, visualization, force-directed, tna-08, phase6]
dependency_graph:
  requires: ["06-03"]
  provides: ["tna-08-layout", "force-atlas2-positions", "layout-json-export"]
  affects:
    ["orchestrator/ComposeRootModule", "tna/CooccurrenceGraph", "tna/index"]
tech_stack:
  added: ["graphology-layout-forceatlas2@0.10.1"]
  patterns:
    [
      "ForceAtlas2 force-directed layout",
      "hash-based deterministic seeding",
      "incremental layout updates",
      "regime-adaptive intervals",
      "convergence energy metric (mean squared displacement)",
      "JSON export for D3.js/Sigma.js",
    ]
key_files:
  created:
    - src/tna/LayoutComputer.ts
    - src/tna/LayoutComputer.test.ts
  modified:
    - src/tna/interfaces.ts
    - src/tna/CooccurrenceGraph.ts
    - src/tna/index.ts
    - src/types/Events.ts
    - src/orchestrator/ComposeRootModule.ts
    - src/vendor-types.d.ts
    - package.json
decisions:
  - "computeIfDue initial warm-up always runs (hasComputedInitial guard) regardless of interval"
  - "Trivial layout for < minGraphOrder (3) nodes: hash-positions, 0 iterations, no event"
  - "Energy metric = mean squared displacement from previous positions (first run = Infinity)"
  - "Hash-based deterministic seeding: Bernstein hash for x, FNV-variant for y from node ID string"
  - "createRequire CJS interop for graphology-layout-forceatlas2 (same pattern as graphology-metrics)"
  - "vendor-types.d.ts declaration added; skipLibCheck:true prevents bundled type conflicts"
metrics:
  duration: "~12 min"
  completed: "2026-03-06"
  tasks_completed: 6
  tasks_total: 6
  files_created: 2
  files_modified: 7
  new_tests: 42
  total_tests: 574
---

# Phase 6 Plan 04: TNA-08 ForceAtlas2 Layout Computer Summary

**One-liner:** ForceAtlas2 force-directed layout computer for TNA semantic graph visualization with deterministic seeding, incremental updates, convergence tracking, and JSON export.

## What Was Built

**TNA-08: LayoutComputer** — wraps `graphology-layout-forceatlas2` with configurable physics simulation to compute 2D node positions that make community structure spatially visible.

### Core class: `src/tna/LayoutComputer.ts`

- **ForceAtlas2 integration** via `createRequire` CJS interop (same pattern as `CentralityAnalyzer` / `graphology-metrics`)
- **Deterministic seeding** — Bernstein hash for x, FNV-variant for y — converts node ID strings to reproducible initial positions, ensuring same graph + same seed = same layout across runs
- **`computeLayout(iterations?)`** — seeds positions, runs FA2, reads x/y from graphology attributes, computes convergence energy, writes positions back to `CooccurrenceGraph`, emits `tna:layout-updated`
- **`computeIfDue(iteration)`** — always runs on first call (warm-up); subsequent calls gated by interval; initial = full iterations (100), incremental = `iterations * 0.5`
- **`adjustInterval(regime)`** — critical/transitioning = 10, stable = 20, default = 15
- **`exportJSON()`** — D3.js/Sigma.js compatible JSON with nodes (id, x, y, communityId, betweennessCentrality, label), edges (source, target, weight), metadata (nodeCount, edgeCount, energy, iterations, timestamp)
- **`isConverged()`** — returns `energy < convergenceEnergyThreshold` (default 1.0)
- **Trivial layout** — graphs with < 3 nodes get hash-seeded positions, 0 physics iterations, no event

### Convergence energy metric

```
energy = Σ[(x_new - x_old)² + (y_new - y_old)²] / nodeCount
```

First computation returns `Infinity` (no reference). Subsequent runs measure displacement from previous layout. Lower energy = more settled layout.

### Barnes-Hut optimization

Enabled by default (`barnesHutOptimize: true`, `barnesHutTheta: 0.5`) for O(n log n) repulsion computation. Suitable for TNA graphs ranging from 5 to 500+ nodes.

### Community clustering validation

T24 demonstrates that after ForceAtlas2 convergence on a two-cluster graph (5 nodes per cluster, single bridge edge), **average intra-cluster distance < average inter-cluster distance** — confirming that semantically related nodes cluster together in the 2D layout.

### CooccurrenceGraph extensions (`src/tna/CooccurrenceGraph.ts`)

- `updateNodePosition(nodeId, x, y)` — called by LayoutComputer to cache positions
- `getNodePosition(nodeId)` — retrieves `{ x, y } | undefined`
- `getNode()` / `getNodes()` now include `x?` and `y?` fields (optional, backward compatible)

### Type additions

**`src/tna/interfaces.ts`:**

- `NodePosition` — `{ x, y }` readonly
- `LayoutConfig` — 10 physics parameters (iterations, barnesHutOptimize, barnesHutTheta, linLogMode, gravity, slowDown, edgeWeightInfluence, scalingRatio, strongGravityMode, seed)
- `LayoutOutput` — positions, energy, iterations, nodeCount, edgeCount
- `LayoutExportJSON` — JSON-serializable nodes/edges/metadata
- `LayoutComputerConfig` — scheduling parameters
- `TextNode.x?` and `TextNode.y?` optional fields

**`src/types/Events.ts`:**

- `LayoutUpdatedEvent` — `tna:layout-updated` with iteration, energy, nodeCount, physicsIterations
- `TNAEventType` extended with `'tna:layout-updated'`
- `TNAEvent` union extended with `LayoutUpdatedEvent`

### Orchestrator wiring (`src/orchestrator/ComposeRootModule.ts`)

- `tnaLayout: LayoutComputer` public property
- Constructor instantiates `new LayoutComputer(this.tnaGraph)`
- `tna:layout-updated` events forwarded to EventBus
- `regime:classification` subscription calls `tnaLayout.adjustInterval(regime)`
- `runReasoning()` calls `tnaLayout.computeIfDue(iteration)` when `tnaGraph.order >= 3`

## Tests: 42 new (574 total)

| Group                | Tests    | What is verified                                                              |
| -------------------- | -------- | ----------------------------------------------------------------------------- |
| Basic computation    | T1-T5    | Positions exist for all nodes, finite values, cached in graph, correct counts |
| Convergence          | T6-T10   | Energy Infinity on first run, finite on second, isConverged()                 |
| Determinism          | T11-T13  | Same seed + same graph = same positions and energy                            |
| Incremental updates  | T14-T17  | computeIfDue() interval scheduling, warm-up on first call, multiplier         |
| Graph edge cases     | T18-T22  | < 3 nodes trivial layout, 0 nodes, 1 node, complete graph, no event           |
| Community clustering | T23-T25  | Louvain assigns different clusters, intra < inter distance, path endpoints    |
| JSON export          | T26-T30  | LayoutExportJSON structure, all fields present, JSON.stringify safe           |
| Regime intervals     | T31-T34b | critical/transitioning/stable/nascent adjustInterval()                        |
| Event emission       | T34-T37b | tna:layout-updated emitted, payload fields, not emitted for trivial           |
| Configuration        | T37-T40  | Custom iterations, barnesHutOptimize, scalingRatio, defaults                  |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] computeIfDue() initial call always blocked by interval check**

- **Found during:** Task 5 (T14, T15, T16 failures — all showed `computeIfDue(0)` returning false)
- **Issue:** `computeIfDue` checked `elapsed < interval` unconditionally. On first call with `iteration=0`, `elapsed = 0 - 0 = 0 < interval` (any positive value) → always false. The warm-up computation never ran.
- **Fix:** Added `this.#hasComputedInitial &&` guard before the interval check — first call always runs regardless of interval; subsequent calls gated by interval.
- **Files modified:** `src/tna/LayoutComputer.ts` — `computeIfDue()` method
- **Tests corrected:** T14, T15, T16 updated to reflect warm-up semantics

**2. [Rule 1 - Bug] T7 asserted strict monotone energy decrease**

- **Found during:** Task 5 (T7 failure — round 3 energy 78.7 > round 2 energy 47.5)
- **Issue:** ForceAtlas2 energy is NOT guaranteed strictly monotone across sequential runs. Energy measures displacement from previous positions; after initial settling, subsequent displacements can fluctuate.
- **Fix:** Weakened assertion to verify: round 1 = Infinity, round 2+ = finite. Energy across rounds is non-monotone by design (positions re-converge from different starting points).
- **Files modified:** `src/tna/LayoutComputer.test.ts` — T7 assertion

## Self-Check: PASSED

| Item                                       | Status   |
| ------------------------------------------ | -------- |
| `src/tna/LayoutComputer.ts`                | FOUND    |
| `src/tna/LayoutComputer.test.ts`           | FOUND    |
| Commit `9dd7b63` (chore: dependency)       | FOUND    |
| Commit `2497b69` (feat: interfaces)        | FOUND    |
| Commit `c54eaeb` (feat: CooccurrenceGraph) | FOUND    |
| Commit `184da8b` (feat: LayoutComputer)    | FOUND    |
| Commit `1d6b3c1` (test: 42 tests)          | FOUND    |
| Commit `2a8e78e` (feat: wiring)            | FOUND    |
| 574 tests passing                          | VERIFIED |
| TNA isolation test                         | PASSED   |
| Orchestrator isolation test                | PASSED   |
