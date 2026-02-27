---
phase: "01"
plan: "02"
subsystem: "sheaf"
tags: ["types", "cellular-sheaf", "test-helpers", "validation", "wave-1"]
dependency_graph:
  requires: []
  provides:
    - "src/types/GraphTypes.ts — VertexId, EdgeId, StalkSpace, StalkVector, RestrictionMap, SheafVertex, SheafEdge, CohomologyResult, SheafEigenspectrum"
    - "src/types/Events.ts — SheafEventType, SheafConsensusReachedEvent, SheafH1ObstructionEvent, SheafEvent"
    - "src/types/index.ts — barrel export"
    - "src/sheaf/CellularSheaf.ts — construction, dimension bookkeeping, offset API"
    - "src/sheaf/helpers/flatSheafFactory.ts — identity-restriction sheaves (path/triangle/complete)"
    - "src/sheaf/helpers/threeCycleFactory.ts — canonical H^1 test configuration"
  affects:
    - "Phase 2 (LCM) can now import VertexId, EdgeId, CohomologyResult"
    - "Wave 2 (Laplacian assembly) has validated skeleton to build on"
    - "Wave 3 (cohomology computation) has both flat and non-flat test configurations"
tech_stack:
  added:
    - "TypeScript 5.9.3"
    - "vitest 4.0.18"
    - "mathjs 15.1.1"
    - "ml-matrix 6.12.1"
    - "tsx 4.21.0"
  patterns:
    - "NodeNext module resolution with .js extensions"
    - "Opaque string types (branded) for VertexId/EdgeId"
    - "Row-major Float64Array for restriction map entries"
    - "Construction-time validation with dimension mismatch errors"
    - "Protected internal state for extensible class hierarchy (Wave 2)"
key_files:
  created:
    - "package.json"
    - "tsconfig.json"
    - "vitest.config.ts"
    - "src/index.ts"
    - "src/types/GraphTypes.ts"
    - "src/types/Events.ts"
    - "src/types/index.ts"
    - "src/sheaf/CellularSheaf.ts"
    - "src/sheaf/helpers/flatSheafFactory.ts"
    - "src/sheaf/helpers/threeCycleFactory.ts"
    - "src/sheaf/CellularSheaf.test.ts"
  modified: []
decisions:
  - "Used branded/opaque string types for VertexId and EdgeId to catch ID misuse at compile time"
  - "Restriction map entry validation (isFinite check) throws with /dimension mismatch/i pattern for consistent test matching"
  - "CellularSheaf internals use protected (not private) access for Wave 2 Laplacian extension without rewriting"
  - "vitest passWithNoTests:true added to config to avoid exit code 1 on empty test suites during development"
  - "Both test helper factories committed in same wave so Wave 2 pitfall gate (dual-config test) can immediately run"
metrics:
  duration_minutes: 5
  tasks_completed: 8
  tasks_total: 8
  files_created: 11
  files_modified: 0
  tests_added: 24
  tests_passing: 24
  completed_date: "2026-02-27"
---

# Phase 1 Plan 2: Foundation Summary

**One-liner:** TypeScript + vitest toolchain, 9 shared sheaf types with zero external imports, CellularSheaf with dimension-mismatch construction guards, and both flat/non-flat test helper factories — all 24 unit tests passing.

## What Was Built

### Toolchain (w1-t1)

- `package.json` with production deps (mathjs 15.1.1, ml-matrix 6.12.1) and dev deps (TypeScript 5.9.3, vitest 4.0.18, tsx 4.21.0).
- `tsconfig.json` with `strict: true`, `target: ES2022`, `module/moduleResolution: NodeNext`.
- `vitest.config.ts` with `pool: 'forks'` (required for ml-matrix native module isolation) and `passWithNoTests: true`.

### Shared Types (w1-t2 through w1-t4)

`src/types/GraphTypes.ts` — zero external imports, all fields readonly:

| Type | Description |
|------|-------------|
| `VertexId` | Branded string for agent node IDs |
| `EdgeId` | Branded string for communication channel IDs |
| `StalkSpace` | `{ dim, label? }` — local vector space assignment |
| `StalkVector` | `Float64Array` alias for stalk vectors |
| `RestrictionMap` | Row-major linear map (targetDim × sourceDim entries) |
| `SheafVertex` | `{ id, stalkSpace }` |
| `SheafEdge` | `{ id, sourceVertex, targetVertex, stalkSpace, sourceRestriction, targetRestriction }` |
| `CohomologyResult` | `{ h0Dimension, h1Dimension, hasObstruction, h1Basis, tolerance, coboundaryRank }` |
| `SheafEigenspectrum` | `{ eigenvalues, computedAtIteration }` — forward-compat for Phase 4 SOC |

`src/types/Events.ts` — only imports `VertexId` from GraphTypes:
- `SheafEventType` union: `'sheaf:consensus-reached' | 'sheaf:h1-obstruction-detected' | 'sheaf:iteration-complete'`
- `SheafConsensusReachedEvent` and `SheafH1ObstructionEvent` concrete types
- `SheafEvent` discriminated union on the `type` field

`src/types/index.ts` — barrel re-export with `.js` extensions for NodeNext.

### CellularSheaf (w1-t5)

`src/sheaf/CellularSheaf.ts`:

- Constructor stores vertices/edges as `Map<Id, T>` with explicit insertion-order arrays.
- Validates every edge at construction time:
  1. `sourceVertex` and `targetVertex` must exist in vertex map.
  2. `sourceRestriction.sourceDim` must equal `vertex.stalkSpace.dim`.
  3. `sourceRestriction.targetDim` must equal `edge.stalkSpace.dim`.
  4. `entries.length` must equal `targetDim * sourceDim`.
  5. All entries must be finite (`isFinite()` — rejects NaN, Infinity).
  - All errors throw with message matching `/dimension mismatch/i`.
- Precomputes and caches vertex and edge offsets at construction time.
- Public API: `c0Dimension`, `c1Dimension`, `getVertexOffset`, `getEdgeOffset`, `getVertexIds`, `getEdgeIds`, `getVertex`, `getEdge`, `getEdgeRestrictions`, `getEdgeDim`.
- Internal maps are `protected` (not `private`) to support Wave 2 extension.

### Test Helpers (w1-t6, w1-t7)

`src/sheaf/helpers/flatSheafFactory.ts` — `buildFlatSheaf(numVertices, stalkDim, topology?)`:
- `'path'`: linear chain, `numVertices - 1` edges.
- `'triangle'`: requires exactly 3 vertices, 3 edges.
- `'complete'`: all pairs, `n*(n-1)/2` edges.
- All restriction maps are identity matrices (diagonal 1, off-diagonal 0).

`src/sheaf/helpers/threeCycleFactory.ts` — `buildThreeCycleInconsistentSheaf()`:
- 3 vertices (v0, v1, v2), all `R^2` (dim=2).
- 3 edges (e01, e12, e20), all `R^1` (dim=1).
- Alternating first/second-axis projections per research spec.
- `c0Dimension = 6`, `c1Dimension = 3`, expected `dim(H^1) = 1` (validated in Wave 2).

### Unit Tests (w1-t8)

`src/sheaf/CellularSheaf.test.ts` — 24 tests, all passing:

| Group | Tests | Description |
|-------|-------|-------------|
| T1 | 4 | Dimension assertions for heterogeneous stalk dims |
| T2 | 6 | 5 rejection cases (entries.length, sourceDim, targetDim, missing vertex, NaN/Infinity) |
| T10-partial | 3 | Cumulative vertex offset computation (dims 3, 2, 4) |
| flatSheafFactory | 5 | Smoke tests for all 3 topologies + identity entry verification |
| threeCycleFactory | 5 | c0/c1 dimensions, vertex/edge counts, exact restriction map values |

## Commits

| Task | Commit | Message |
|------|--------|---------|
| w1-t1 | 421baa4 | chore(01-02): initialize project toolchain |
| w1-t2 | 7b69f46 | feat(types): define shared sheaf types in GraphTypes.ts |
| w1-t3 | 92864c1 | feat(types): define sheaf event types in Events.ts |
| w1-t4 | f6a1476 | feat(types): create barrel export in src/types/index.ts |
| w1-t5 | 1675514 | feat(sheaf): implement CellularSheaf with construction validation |
| w1-t6 | eb7cb19 | feat(sheaf): create flatSheafFactory test helper |
| w1-t7 | fefad6d | feat(sheaf): create threeCycleInconsistentSheaf test helper |
| w1-t8 | 4f76dff | test(sheaf): write CellularSheaf unit tests |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vitest exits code 1 with no test files**

- **Found during:** Task 1
- **Issue:** The plan acceptance criteria required `npx vitest run` to exit 0 with "no test files found". By default vitest 4.0.18 exits with code 1 when no test files are found.
- **Fix:** Added `passWithNoTests: true` to `vitest.config.ts`. This is the correct approach per vitest documentation.
- **Files modified:** `vitest.config.ts`
- **Commit:** 421baa4

**2. [Rule 1 - Bug] tsconfig.json paths alias without baseUrl**

- **Found during:** Task 1
- **Issue:** The plan suggested adding a `paths` alias `"@types/*"`. In NodeNext moduleResolution mode, non-relative paths in `paths` require `baseUrl`. Adding `baseUrl` would conflict with the NodeNext resolution strategy.
- **Fix:** Removed the `paths` alias from `tsconfig.json`. The plan noted it as "optional convenience" and it is not required by any test or compilation check. Modules continue to use relative imports.
- **Files modified:** `tsconfig.json`
- **Commit:** 421baa4

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS (0 errors) |
| `npx vitest run` (24 tests) | PASS (24/24) |
| Zero external imports in `src/types/GraphTypes.ts` | PASS |
| `src/types/Events.ts` only imports from `./GraphTypes` | PASS |
| Zero cross-imports from sheaf into lcm/tna/soc/orchestrator | PASS |
| `flatSheafFactory` and `threeCycleFactory` both exist | PASS |
| `threeCycleFactory` c0Dimension=6, c1Dimension=3 | PASS |
| `CellularSheaf` rejects all 5 dimension mismatch cases | PASS |
| vitest `pool: 'forks'` configured | PASS |

## What Wave 1 Does NOT Include

As planned:
- No Laplacian computation (Wave 2)
- No coboundary operator assembly (Wave 2)
- No SVD or eigenvalue computation (Wave 3)
- No cohomology analysis (Wave 3)
- No ADMM solver (Wave 2)
- No event emission (Wave 3)

## Parallel Work Enabled

Phase 2 (LCM) can now begin. It depends only on `VertexId`, `EdgeId`, and `CohomologyResult` from `src/types/index.ts`. All types are stable and committed.

## Self-Check: PASSED

All 10 key files exist on disk. All 8 task commits (421baa4 through 4f76dff) found in git log. 24/24 tests passing. TypeScript compiles with zero errors.
