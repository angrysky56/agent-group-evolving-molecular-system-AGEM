# Task: Emergent Bonds & Stateless Reconstruction

## Todo List

- `[x]` 1. Types & Emergent Bonds
  - `[x]` Update `BondGraph` in `src/types/MolecularCoT.ts` to support observations and derived emergent bonds
  - `[x]` Expose `snapshot` and `restore` on `BondGraph`
  - `[x]` Add a comprehensive unit test suite `src/types/MolecularCoT.test.ts`
- `[x]` 2. PCA Subgraph Spaces & Subspace Registry
  - `[x]` Add `getConceptSubspace()` to `src/lcm/SubgraphRegistry.ts` with the adaptive-rank ladder
  - `[x]` Widen existing tests in `src/lcm/SubgraphRegistry.test.ts` to cover the new PCA/subspace logic
- `[x]` 3. Stateless Rehydration (SOC & State Snapshots)
  - `[x]` Add `snapshot` and `restore` to `RegimeValidator` and `RegimeAnalyzer` in `src/soc/RegimeValidator.ts`
  - `[x]` Add `snapshot` and `restore` to `SOCTracker` in `src/soc/SOCTracker.ts`
  - `[x]` Add `snapshot` and `restore` to `OrchestratorStateManager` in `src/orchestrator/OrchestratorState.ts`
- `[x]` 4. Two-Level Sheaf Redesign
  - `[x]` Update `buildSheafFromRegistry()` in `src/orchestrator/ComposeRootModule.ts` to use top-2 neighbors, multidimensional stalks, and projective restriction maps
  - `[x]` Add whole-system rehydration and re-integration assertions in orchestrator tests
- `[x]` 5. Verification & Audit
  - `[x]` Run full test suite using `npm test`
  - `[x]` Create final `walkthrough.md` artifact
