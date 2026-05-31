# Implementation Plan - Emergent Bonds & Stateless Reconstruction

This plan outlines the implementation of the MEAO-inspired emergent bonding structure, a fully event-sourced stateless graph substrate, and a two-level sheaf cohomology model carrying multi-dimensional conflict.

## Goal Description

Currently, the AGEM codebase has a few gaps that prevent it from achieving its ultimate vision:
1. **Bonds are caller-assigned**: The `BondGraph` module relies on the caller to decide if a bond is covalent, hydrogen, or Van der Waals. This is a "Lewis-label" approach instead of letting bonds **emerge** naturally from correlation (mutual information/semantic distance) as described in the 2026 MEAO paper.
2. **The graph substrate is mutable primary state**: The co-occurrence graph and edge weights are mutated in place by `PriceEvolver`, which prevents exact stateless reconstruction and rehydration of the reasoning graph from a clean event log.
3. **The sheaf obstruction never fires**: Stalk dimensions are 1 (scalars), similarity restriction maps are trivial multiples, and cycle spaces are empty due to a high threshold (acyclic base graphs). Cohomology has been decorative rather than active.
4. **SOCTracker state is lossy**: Running metrics, deltas, and regime validation candidates are not serializable or snapshotted, preventing rehydration.

To address these, we will promote the graph substrate to event-sourced, transition the bond graph to emerge from semantic distances/correlation, redesign the sheaf base graph and restriction maps using a two-level PCA projection motif, and implement full `snapshot` / `restore` across the stateful modules (`SOCTracker`, `OrchestratorStateManager`, `BondGraph`).

---

## User Review Required

> [!IMPORTANT]
> **Change in Sheaf Stalk Dimensions (1-D → Multidimensional PCA)**
> We are transitioning from simple 1-D scalar stalks representing activation levels to multidimensional stalks (`k = 3`) representing the principal subspace directions of each subgraph's semantic cloud. This will allow the sheaf layers to detect actual deep-level incompatibilities (H¹ obstructions) when centroids align but subspaces disagree.

> [!TIP]
> **Base Graph Cycle Space Guarantee**
> Instead of a sparse similarity cutoff (which forms trees), the sheaf base graph will connect each subgraph to its top `m_neighbors = 2` most similar subgraphs, guaranteeing independent cycles (and therefore active H¹ potential) once 3 or more subgraphs exist.

---

## Proposed Changes

### 1. Types & Emergent Bonds

We will update the `BondGraph` to use a list of observations from which bonds are derived.

#### [MODIFY] [MolecularCoT.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/types/MolecularCoT.ts)
- Add an `Observation` interface tracking `source`, `target`, and `options` (strength, trajectoryLength, isLogicalDependency).
- Redesign `BondGraph` to hold an append-only array of observations `#observations`.
- Implement `observe(source, target, options)`: computes semantic distance (if embeddings are provided) and derives the bond type:
  - If `isLogicalDependency === true` → Covalent.
  - If `semanticDistance <= hydrogenThreshold` (derived from cosine similarity) → Hydrogen.
  - If `trajectoryLength >= vdwMinTrajectory` → VanDerWaals.
- Re-derive `#bonds` map dynamically from observations during `observe()` or on request.
- Keep standard `add*` methods as wrappers for backward compatibility.
- Implement `snapshot()` and `restore(snapshot)` for `BondGraph`.

---

### 2. Subgraph PCA & Concept Subspaces

We will add a new method to `SubgraphRegistry` to extract the principal components of each subgraph's semantic space.

#### [MODIFY] [SubgraphRegistry.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/lcm/SubgraphRegistry.ts)
- Add `getConceptSubspace(subgraphId, k): Float64Array[] | null`.
- Implement the **Adaptive-Rank Ladder** to handle differing numbers of embeddings:
  - N = 1 → returns `[centroid]` (1-D stalk fallback).
  - 1 < N <= k → sets `k_eff = N - 1`, centers the embeddings by subtracting the centroid, runs SVD via `ml-matrix`'s `SingularValueDecomposition`, and returns the first `k_eff` columns of the right singular vectors (`V`).
  - N > k → sets `k_eff = k`, mean-centers, runs SVD, and returns the first `k` columns of `V`.

---

### 3. Two-Level Sheaf Redesign

We will lift the sheaf base graph construction in `ComposeRootModule` to use multidimensional stalks and projective restriction maps.

#### [MODIFY] [ComposeRootModule.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/orchestrator/ComposeRootModule.ts)
- Update `buildSheafFromRegistry()`:
  - Base Graph: Connect each subgraph to its top `m_neighbors = 2` most concept-similar subgraphs (with similarity >= 0.4). This ensures cycle space topology.
  - Vertices: Stalk dimension `k_A` equals the length of the subgraph's concept subspace (extracted via `getConceptSubspace(id, k = 3)`).
  - Edges: Stalk dimension `m = min(k_A, k_B)`.
  - Restriction Maps:
    - Combine `P_A` and `P_B` bases to define a shared edge frame basis of dimension `m` (via SVD).
    - `sourceRestriction`: `m x k_A` matrix containing `dotProduct(P_A[c], E[r])`.
    - `targetRestriction`: `m x k_B` matrix containing `dotProduct(P_B[c], E[r]) * weight` (where `weight = clamp(sim)`).
  - Validates perfectly with existing `CellularSheaf` constraints.
- Widen `getNodeEmbeddings` and expose serialization hooks for whole-system rehydration.

---

### 4. Stateless Rehydration & Snapshots

We will add snapshot and restore methods to the stateful components of the orchestrator, enabling exact rehydration.

#### [MODIFY] [SOCTracker.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/soc/SOCTracker.ts)
- Add public `snapshot()`:
  - Returns raw JS object containing `history`, `previousVNE`, `previousEE`, `previousCorrelation`, `deltaStructural`, `deltaSemantic`, `currentH1Dimension`, `latestRegimeMetrics`, and nested validator/analyzer snapshots.
- Add public `restore(snapshot)`:
  - Restores all private accumulators and delegates validator/analyzer restoration.

#### [MODIFY] [RegimeValidator.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/soc/RegimeValidator.ts)
- Add `snapshot()` and `restore()` for `signHistory`, `candidateStartIteration`, `candidateSign`, `lastSign`, `lastConfirmedIteration`, and `entropyPairs`.

#### [MODIFY] [RegimeAnalyzer.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/soc/RegimeAnalyzer.ts)
- Add `snapshot()` and `restore()` for `currentRegime`, `regimeStartIteration`, `metricsWindow`, and `totalIterations`.

#### [MODIFY] [OrchestratorState.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/orchestrator/OrchestratorState.ts)
- Add `snapshot()` and `restore()` to `OrchestratorStateManager` for `currentState` and `lastStateChangeTime`.

---

## Verification Plan

### Automated Tests
- Create a new unit test suite: [MolecularCoT.test.ts](file:///home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM/src/types/MolecularCoT.test.ts) to verify:
  - `observe(source, target, options)` emergent classification (Covalent, Hydrogen, VanDerWaals).
  - Dependency cascade invalidation works correctly via Derived/Emergent observations.
  - `snapshot()` / `restore()` verbatim rehydration.
- Add tests in `src/lcm/SubgraphRegistry.test.ts` to assert:
  - `getConceptSubspace()` PCA correctness and adaptive-rank ladder levels.
- Add tests in `src/orchestrator/ComposeRootModule.test.ts` to assert:
  - Two-level sheaf construction builds non-scalar stalks and projections.
  - Full-system state rehydration works cleanly.
- Run `npm test` to verify zero regression across the existing test suites.
