---
wave: 1
title: "Foundation: Shared Types, CellularSheaf Structure, Test Helpers"
depends_on: []
files_modified:
  - src/types/GraphTypes.ts
  - src/types/Events.ts
  - src/types/index.ts
  - src/sheaf/CellularSheaf.ts
  - src/sheaf/CellularSheaf.test.ts
  - src/sheaf/helpers/flatSheafFactory.ts
  - src/sheaf/helpers/threeCycleFactory.ts
  - package.json
  - tsconfig.json
  - vitest.config.ts
autonomous: true
commits:
  - "feat(types): define sheaf type system (StalkSpace, RestrictionMap, SheafEdge, SheafVertex, CohomologyResult, Events)"
  - "feat(sheaf): implement CellularSheaf with construction validation and dimension methods"
---

# Wave 1: Foundation

## Purpose

Establish the shared type system that all five project modules depend on, then build the `CellularSheaf` class with construction-time validation and dimension bookkeeping. This wave produces zero mathematical computation -- no Laplacian, no SVD, no cohomology. It delivers the structural skeleton that Waves 2 and 3 build on, and it unblocks Phase 2 (LCM) to start in parallel as soon as the types are committed.

## Why This Must Come First

1. The `src/types/` module is the dependency root for every phase. Phase 2 (LCM) imports `VertexId`/`EdgeId` from it. No types, no parallel work.
2. `CellularSheaf` construction validation (dimension mismatch rejection) is the first line of defense against silent numerical bugs. If a restriction map's `entries.length` does not equal `sourceDim * targetDim`, every downstream computation is garbage. Catching this at construction time -- before any matrix assembly -- is cheaper by orders of magnitude than debugging SVD output.
3. The test helper factories (`flatSheafFactory`, `threeCycleFactory`) must exist from the first test commit so that Wave 2 can immediately use both flat and non-flat configurations. The pitfall gate at Commit 3 (Wave 2) requires BOTH helpers to already exist.

## Prerequisite Setup

Before any task in this wave, the project must have a working TypeScript + vitest environment. Task 1 handles this.

---

<task id="w1-t1" title="Initialize project toolchain (TypeScript, vitest, mathjs, ml-matrix)">
  <description>
    Create `package.json` with the Phase 1 dependencies:
    - `mathjs@15.1.1` (matrix assembly, arithmetic, eigenvalues)
    - `ml-matrix@6.12.1` (SVD for null-space computation)
    - Dev dependencies: `typescript@5.9.3`, `vitest@4.0.18`, `tsx@4.21.0`

    Create `tsconfig.json` with:
    - `"strict": true`
    - `"target": "ES2022"` (for native private fields and top-level await)
    - `"module": "NodeNext"` / `"moduleResolution": "NodeNext"`
    - `"rootDir": "src"`, `"outDir": "dist"`
    - Path alias `"@types/*"` mapping to `"src/types/*"` (optional convenience)

    Create `vitest.config.ts` with:
    - `pool: 'forks'` (required for ml-matrix native module isolation)
    - `include: ['src/**/*.test.ts']`

    Run `npm install` and verify `npx vitest --version` succeeds.
  </description>
  <acceptance>
    - `npm install` exits 0 with no peer dependency warnings for mathjs or ml-matrix.
    - `npx tsc --noEmit` exits 0 on an empty `src/` directory.
    - `npx vitest run` exits 0 with "no test files found" (not a crash).
    - `tsconfig.json` has `"strict": true`.
  </acceptance>
</task>

<task id="w1-t2" title="Define shared sheaf types in src/types/GraphTypes.ts">
  <description>
    Create `src/types/GraphTypes.ts` containing all sheaf-related type definitions. These are pure TypeScript interfaces with ZERO library imports (no mathjs, no ml-matrix, no Node.js builtins).

    Types to define (from 01-RESEARCH.md Section 3.1):

    1. `VertexId` -- opaque string type alias for agent IDs.
    2. `EdgeId` -- opaque string type alias for communication channel IDs.
    3. `StalkSpace` -- `{ readonly dim: number; readonly label?: string }`.
    4. `StalkVector` -- `Float64Array` type alias.
    5. `RestrictionMap` -- `{ sourceVertexId, edgeId, sourceDim, targetDim, entries: Float64Array }`.
       - `entries` is row-major, length = `targetDim * sourceDim`.
    6. `SheafEdge` -- `{ id, sourceVertex, targetVertex, stalkSpace, sourceRestriction, targetRestriction }`.
    7. `SheafVertex` -- `{ id, stalkSpace }`.
    8. `CohomologyResult` -- `{ h0Dimension, h1Dimension, hasObstruction, h1Basis, tolerance, coboundaryRank }`.
    9. `SheafEigenspectrum` -- `{ eigenvalues: Float64Array, computedAtIteration: number }`.
       - Forward-compatibility for Phase 4 SOC Von Neumann entropy.

    All fields must be `readonly`. This enforces immutability at the type level.

    CRITICAL: This file must have ZERO imports from any module outside `src/types/`. No `import { Matrix } from 'mathjs'`. No `import { EventEmitter } from 'events'`. Types only.
  </description>
  <acceptance>
    - `npx tsc --noEmit` passes with GraphTypes.ts in place.
    - File contains exactly zero `import` statements referencing external packages.
    - All 9 types/interfaces listed above are exported.
    - All fields on all interfaces are `readonly`.
    - `RestrictionMap.entries` is typed as `Float64Array`.
    - `StalkVector` is typed as `Float64Array`.
  </acceptance>
</task>

<task id="w1-t3" title="Define sheaf event types in src/types/Events.ts">
  <description>
    Create `src/types/Events.ts` containing the event types that `CohomologyAnalyzer` will emit and that the Phase 5 Orchestrator will consume.

    Types to define (from 01-RESEARCH.md Section 3.1):

    1. `SheafEventType` -- string literal union: `'sheaf:consensus-reached' | 'sheaf:h1-obstruction-detected' | 'sheaf:iteration-complete'`.
    2. `SheafConsensusReachedEvent` -- `{ type: 'sheaf:consensus-reached', iteration: number, h0Dimension: number, dirichletEnergy: number }`.
    3. `SheafH1ObstructionEvent` -- `{ type: 'sheaf:h1-obstruction-detected', iteration: number, h1Dimension: number, h1Basis: Float64Array[], affectedVertices: VertexId[] }`.
    4. `SheafEvent` -- discriminated union of the above two.

    Import `VertexId` from `./GraphTypes`. This is the only allowed import.
  </description>
  <acceptance>
    - `npx tsc --noEmit` passes.
    - The only import is from `./GraphTypes`.
    - `SheafEvent` is a discriminated union on the `type` field.
    - All event fields are `readonly`.
  </acceptance>
</task>

<task id="w1-t4" title="Create src/types/index.ts barrel export">
  <description>
    Create `src/types/index.ts` that re-exports everything from `GraphTypes.ts` and `Events.ts`. This is the single import point for all other modules:

    ```typescript
    export * from './GraphTypes.js';
    export * from './Events.js';
    ```

    Note the `.js` extension for NodeNext module resolution.
  </description>
  <acceptance>
    - `import { VertexId, SheafEvent, CohomologyResult } from '../types/index.js'` resolves without error.
    - `npx tsc --noEmit` passes.
  </acceptance>
</task>

<task id="w1-t5" title="Implement CellularSheaf class with construction validation">
  <description>
    Create `src/sheaf/CellularSheaf.ts`. This is the core data structure for the entire sheaf module. It stores the graph topology (vertices + edges) and provides dimension bookkeeping methods. It does NOT compute the Laplacian or coboundary operator (that is Wave 2).

    Constructor behavior:
    1. Accept `vertices: SheafVertex[]` and `edges: SheafEdge[]`.
    2. Store internally as `Map<VertexId, SheafVertex>` and `Map<EdgeId, SheafEdge>`.
    3. Validate every edge's restriction maps at construction time:
       - `edge.sourceRestriction.sourceDim` must equal `vertices[edge.sourceVertex].stalkSpace.dim`.
       - `edge.sourceRestriction.targetDim` must equal `edge.stalkSpace.dim`.
       - `edge.sourceRestriction.entries.length` must equal `targetDim * sourceDim`.
       - Same checks for `edge.targetRestriction`.
       - Throw `Error` with message matching `/dimension mismatch/i` on any violation.
    4. Validate that every edge references vertices that exist in the vertex list.
    5. Validate that all entries in restriction maps are finite numbers (`isFinite()`).

    Public API (no Laplacian methods yet -- those are Wave 2):
    - `get c0Dimension(): number` -- `Sum of vertex stalk dims`.
    - `get c1Dimension(): number` -- `Sum of edge stalk dims`.
    - `getVertexOffset(vertexId: VertexId): number` -- cumulative sum of preceding vertex stalk dims in insertion order.
    - `getEdgeOffset(edgeId: EdgeId): number` -- cumulative sum of preceding edge stalk dims in insertion order.
    - `getVertexIds(): VertexId[]` -- vertex IDs in insertion order.
    - `getEdgeIds(): EdgeId[]` -- edge IDs in insertion order.
    - `getVertex(vertexId: VertexId): SheafVertex` -- lookup by ID.
    - `getEdge(edgeId: EdgeId): SheafEdge` -- lookup by ID.
    - `getEdgeRestrictions(edgeId: EdgeId): { source: RestrictionMap; target: RestrictionMap }`.
    - `getEdgeDim(edgeId: EdgeId): number` -- convenience for `edge.stalkSpace.dim`.

    Internal state:
    - Precompute and cache vertex offsets and edge offsets at construction time.
    - Store vertex insertion order as an array (Map iteration order in JS is insertion order, but be explicit).

    ADMM forward-compatibility note: The Laplacian and coboundary methods will be added in Wave 2. The class is designed to be extended, not replaced. Do NOT make vertex/edge maps private -- use `protected` or expose via getters, so Wave 2 can access internals without rewriting.
  </description>
  <acceptance>
    - Construction with valid vertices and edges succeeds.
    - Construction with mismatched restriction map dimensions throws with `/dimension mismatch/i`.
    - Construction with edge referencing non-existent vertex throws.
    - Construction with non-finite restriction map entries throws.
    - `c0Dimension` returns correct sum for heterogeneous stalk dims (e.g., 3 + 2 = 5).
    - `c1Dimension` returns correct sum for heterogeneous edge stalk dims.
    - `getVertexOffset('v0')` returns 0 for the first vertex.
    - `getVertexOffset('v1')` returns `dim(F(v0))` for the second vertex.
    - `getEdgeIds()` returns IDs in insertion order.
  </acceptance>
</task>

<task id="w1-t6" title="Create flat sheaf test helper factory">
  <description>
    Create `src/sheaf/helpers/flatSheafFactory.ts`.

    Export `buildFlatSheaf(numVertices: number, stalkDim: number, topology?: 'path' | 'triangle' | 'complete'): CellularSheaf`.

    Default topology: `'path'` (linear chain of edges).

    Behavior:
    - Creates `numVertices` vertices with stalk spaces of dimension `stalkDim`.
    - Edge stalks also have dimension `stalkDim`.
    - ALL restriction maps are identity matrices (`I_{stalkDim}`), stored as row-major `Float64Array`.
    - For `'path'`: edges connect `v0-v1, v1-v2, ..., v(n-2)-v(n-1)`. Total edges = `numVertices - 1`.
    - For `'triangle'`: requires `numVertices = 3`. Edges: `v0-v1, v1-v2, v2-v0`. Total edges = 3.
    - For `'complete'`: edges between all pairs. Total edges = `n*(n-1)/2`.
    - Vertex IDs: `'v0', 'v1', ...`. Edge IDs: `'e01', 'e12', ...` (source-target indices).

    This factory produces FLAT sheaves only. H^1 is always 0 for flat sheaves on trees. H^1 = `d * (|E| - |V| + 1)` for flat sheaves on graphs with cycles (where d = stalkDim).

    IMPORTANT: This factory is used for the FLAT side of the mandatory dual-config test. It must NOT be the only test factory. The three-cycle factory (task w1-t7) provides the non-flat counterpart.
  </description>
  <acceptance>
    - `buildFlatSheaf(2, 2)` returns a CellularSheaf with 2 vertices, 1 edge, all identity restriction maps.
    - `buildFlatSheaf(3, 2, 'path')` returns 3 vertices, 2 edges.
    - `buildFlatSheaf(3, 2, 'triangle')` returns 3 vertices, 3 edges.
    - `buildFlatSheaf(4, 3, 'complete')` returns 4 vertices, 6 edges.
    - All restriction map entries are identity matrices (diagonal 1s, off-diagonal 0s).
    - Returned CellularSheaf passes construction validation.
  </acceptance>
</task>

<task id="w1-t7" title="Create three-cycle inconsistency test helper factory">
  <description>
    Create `src/sheaf/helpers/threeCycleFactory.ts`.

    Export `buildThreeCycleInconsistentSheaf(): CellularSheaf`.

    This is the CANONICAL non-flat sheaf for H^1 testing. It must match the exact specification from 01-RESEARCH.md Section 5.2:

    - Three vertices: `v0, v1, v2`, all with stalk space R^2 (dim=2).
    - Three edges forming a triangle: `e01 (v0->v1), e12 (v1->v2), e20 (v2->v0)`, all with edge stalk R^1 (dim=1).
    - Restriction maps (1x2 row vectors):
      - `F_{v0<-e01} = [1, 0]` (project onto first axis)
      - `F_{v1<-e01} = [0, 1]` (project onto second axis)
      - `F_{v1<-e12} = [1, 0]`
      - `F_{v2<-e12} = [0, 1]`
      - `F_{v2<-e20} = [1, 0]`
      - `F_{v0<-e20} = [0, 1]`

    Mathematical properties of this configuration (verified by hand in research):
    - N_0 = 6, N_1 = 3
    - rank(B) = 2
    - dim(H^0) = N_0 - rank(B) = 6 - 2 = 4  (CORRECTION: this needs careful validation in Wave 2)
    - dim(H^1) = N_1 - rank(B) = 3 - 2 = 1
    - hasObstruction = true

    This configuration is designed so that traveling around the triangle accumulates a non-trivial "holonomy" -- each edge projects onto a DIFFERENT axis, making it impossible for all three edge consistency conditions to be satisfied simultaneously. This guarantees dim(H^1) > 0.

    CRITICAL: This factory MUST exist before any cohomology test is written. It is the non-flat half of the mandatory dual-config test. Without it, the flat sheaf test alone cannot distinguish correct from incorrect Sheaf Laplacian implementations.
  </description>
  <acceptance>
    - Returns a CellularSheaf with 3 vertices (all dim=2), 3 edges (all dim=1).
    - All restriction map entries match the specification exactly.
    - Returned CellularSheaf passes construction validation.
    - `c0Dimension` = 6, `c1Dimension` = 3.
  </acceptance>
</task>

<task id="w1-t8" title="Write CellularSheaf unit tests (T1, T2, T10-partial)">
  <description>
    Create `src/sheaf/CellularSheaf.test.ts` with the following test cases:

    **T1: Dimension assertions on construction**
    - Construct a sheaf with heterogeneous vertex stalk dims (e.g., 3 and 2).
    - Assert `c0Dimension` = 5.
    - Assert `c1Dimension` = correct sum of edge stalk dims.

    **T2: Construction rejects incompatible restriction map dimensions**
    - Test 1: `entries.length != targetDim * sourceDim` -- expect throw.
    - Test 2: `sourceRestriction.sourceDim != vertex.stalkSpace.dim` -- expect throw.
    - Test 3: `sourceRestriction.targetDim != edge.stalkSpace.dim` -- expect throw.
    - Test 4: Edge references non-existent vertex ID -- expect throw.
    - Test 5: Restriction map entry is `NaN` or `Infinity` -- expect throw.
    - All throws must match `/dimension mismatch/i` or an appropriate error pattern.

    **T10-partial: Vertex offset cumulative sum**
    - Construct sheaf with 3 vertices of dims 3, 2, 4.
    - Assert `getVertexOffset('v0') = 0`.
    - Assert `getVertexOffset('v1') = 3`.
    - Assert `getVertexOffset('v2') = 5`.

    **Factory smoke tests**
    - `buildFlatSheaf(3, 2, 'path')` constructs without throwing.
    - `buildFlatSheaf(3, 2, 'triangle')` constructs without throwing.
    - `buildThreeCycleInconsistentSheaf()` constructs without throwing.
    - Verify `c0Dimension` and `c1Dimension` on each factory output.

    Run: `npx vitest run src/sheaf/CellularSheaf.test.ts` -- all tests pass.
  </description>
  <acceptance>
    - All tests pass with `npx vitest run`.
    - T1 validates heterogeneous stalk dimensions.
    - T2 covers all five rejection cases.
    - T10-partial validates cumulative offset computation.
    - Factory smoke tests confirm both flat and non-flat configurations construct successfully.
    - Zero imports from `src/lcm/`, `src/tna/`, `src/soc/`, `src/orchestrator/`.
  </acceptance>
</task>

---

## Verification Criteria

After Wave 1 is complete, the following must all be true:

1. `npx tsc --noEmit` passes with zero errors.
2. `npx vitest run` passes all tests in `CellularSheaf.test.ts`.
3. `src/types/` contains only pure TypeScript interfaces with zero external imports.
4. Both `flatSheafFactory` and `threeCycleFactory` exist and produce valid sheaves.
5. No file in `src/sheaf/` imports from `src/lcm/`, `src/tna/`, `src/soc/`, or `src/orchestrator/`.
6. Phase 2 (LCM) can begin by importing from `src/types/` -- types are stable and committed.

## Must-Haves

- [ ] All 9 types from GraphTypes.ts are defined with `readonly` fields
- [ ] Events.ts discriminated union on `type` field
- [ ] CellularSheaf construction rejects dimension mismatches (5 rejection cases tested)
- [ ] `c0Dimension` and `c1Dimension` are correct for heterogeneous stalks
- [ ] `getVertexOffset` returns correct cumulative sums
- [ ] `flatSheafFactory` produces identity-restriction sheaves for path/triangle/complete topologies
- [ ] `threeCycleFactory` produces the exact 3-cycle inconsistency configuration from research
- [ ] Both factories exist in the same commit (enables Wave 2 pitfall gate)
- [ ] Zero library imports in `src/types/`
- [ ] vitest configuration with `pool: 'forks'`

## What This Wave Does NOT Include

- No Laplacian computation (Wave 2)
- No coboundary operator assembly (Wave 2)
- No SVD or eigenvalue computation (Wave 3)
- No cohomology analysis (Wave 3)
- No ADMM solver (Wave 2)
- No event emission (Wave 3)

## Parallel Work Enabled

Once the types commit (w1-t2 through w1-t4) is merged, Phase 2 (LCM) can begin work. LCM depends only on `VertexId`, `EdgeId`, and general context types. The sheaf-specific types (`StalkSpace`, `RestrictionMap`, etc.) are used only by `src/sheaf/`.
