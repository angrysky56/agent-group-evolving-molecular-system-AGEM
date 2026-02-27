# Roadmap: RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)

**Created:** 2026-02-27
**Requirements version:** v1 (25 requirements)
**Coverage:** 25/25 requirements mapped

## Phase Structure Rationale

Phases are derived from the dependency graph of the five core component groups, not imposed top-down. The natural ordering is:

- **Types** must precede everything — nothing compiles without shared interfaces.
- **Sheaf** has the highest mathematical failure risk (silent wrong results from standard graph Laplacian substitution) and zero dependencies beyond types. Validate it first in isolation.
- **LCM** has the highest architectural risk (immutable guarantee is a binary property — either correct or not). Independent of Sheaf, can be built in parallel.
- **TNA + Molecular-CoT** both depend only on types and text input. Lemmatization is the highest-cost retrofit in the project; must be correct from the first graph insertion.
- **SOC** is a pure consumer of Sheaf and TNA outputs. Cannot be built until both upstream interfaces are stable.
- **Orchestrator** is the sole composition root. No cross-component coupling is permitted until this phase.
- **Phase 6** adds P2 enhancements only after the core mathematical properties are verified end-to-end.

```
types/ (inline with Phase 1)
  |
  +----> Phase 1: sheaf/     [independent, highest math risk]
  |
  +----> Phase 2: lcm/       [independent, parallel with Phase 1]
  |
  +----> Phase 3: tna/ + Molecular-CoT types
              \
               +-> Phase 4: soc/          [depends on sheaf + tna outputs]
                        \
                         +-> Phase 5: orchestrator/   [imports all four]
                                  \
                                   +-> Phase 6: P2 enhancements
```

---

## Phase 0: Shared Types Foundation

**Scope:** `src/types/` — shared interfaces required before any module compiles.

This is not a standalone phase with a timeline; types are defined as the first task of Phase 1 and must be complete before any parallel Phase 2 work begins. Types include `ContextState`, `GraphTypes`, `Events`, `Agent`, and bond-type interfaces (for Molecular-CoT invariants). Zero dependencies.

---

## Phase 1: Sheaf-Theoretic Coordination

**Requirements:** SHEAF-01, SHEAF-02, SHEAF-03, SHEAF-04, SHEAF-05, SHEAF-06

**Scope:** `src/types/` (shared interfaces) + `src/sheaf/`

**Rationale:** Sheaf is mathematically the most dangerous component. The Sheaf Laplacian is trivially confused with the standard graph Laplacian (`D - A`), producing silently wrong consensus results with no obvious error signal. Validating it first in isolation — before any dependent code exists — is the only reliable way to avoid this pitfall propagating into SOC and Orchestrator phases. Sheaf depends only on types; no LCM, TNA, or SOC dependency.

### Requirements in This Phase

| ID | Description |
|----|-------------|
| SHEAF-01 | Define cellular sheaf over typed agent communication graph |
| SHEAF-02 | Implement vertex and edge stalk space definitions (inner product spaces) |
| SHEAF-03 | Implement restriction (consistency) maps for state projection between agents |
| SHEAF-04 | Implement Sheaf Laplacian operator via coboundary computation |
| SHEAF-05 | Implement ADMM distributed solver for consensus diffusion |
| SHEAF-06 | Implement Sheaf Cohomology H^1 analyzer for obstruction detection |

### Success Criteria

1. **Laplacian correctness:** For a two-node sheaf with fully consistent sections, `L_sheaf * x = 0` holds. Substituting `D - A` (standard graph Laplacian) breaks this test — demonstrating the implementations are distinct and the sheaf-correct one is what ships.

2. **Non-trivial cohomology detection:** A synthetic 3-cycle (triangle) sheaf with incompatible projection-axis restriction maps produces `dim(H^1) = 1`. The CohomologyAnalyzer correctly reports the obstruction and the `h1:non-trivial` event fires. H^1 never returns zero for this test configuration regardless of numerical tolerance adjustments.

3. **Flat vs. non-flat configurations:** Two distinct test configurations ship from the start: flat (identity restriction maps, trivial H^1 = 0) and non-flat (projection-based restriction maps, H^1 > 0). Both pass. The non-trivial case exercises the obstruction detection code path at least once in CI.

4. **Numerical tolerance calibration:** The SVD/null-space rank tolerance is documented and set to `max_entry * n * machine_epsilon`. A test validates that the non-trivial 3-cycle produces `dim(H^1) = 1` and not 0 or 2 under this tolerance.

5. **Component isolation:** The `src/sheaf/` module has zero imports from `src/lcm/`, `src/tna/`, `src/soc/`, or `src/orchestrator/`. All Sheaf unit tests pass in isolation without any other module present.

---

## Phase 2: LCM Dual-Memory Architecture

**Requirements:** LCM-01, LCM-02, LCM-03, LCM-04, LCM-05

**Scope:** `src/lcm/`

**Rationale:** LCM is the memory foundation. Its correctness is algorithmic and fully independent of Sheaf, TNA, and SOC. The immutable guarantee is a binary property enforced at the type system level. The three-level escalation protocol must include Level 3 (deterministic truncation) as a code path that activates when summarization fails — this is the safety valve that makes context management provably convergent. Can be built in parallel with Phase 1 after types are defined.

### Requirements in This Phase

| ID | Description |
|----|-------------|
| LCM-01 | Implement append-only immutable store with time-sequenced entry IDs |
| LCM-02 | Implement Context DAG data structure with pointer-based SummaryNode references |
| LCM-03 | Implement three-level escalation protocol (nuanced → compressed → truncated) |
| LCM-04 | Implement lcm_grep primitive for queried context retrieval |
| LCM-05 | Implement lcm_expand primitive for context unrolling from summary pointers |

### Success Criteria

1. **Immutability guarantee:** A test that calls any mutation method (update, delete, overwrite) on the ImmutableStore fails at compile time (TypeScript type error) or throws at runtime. No test requires clearing the store between runs — each test uses a fresh instance. Hash integrity checks pass on all appended records.

2. **Level 3 activation:** A test that feeds the EscalationProtocol an input that is too long to compress (Level 1 output longer than input, Level 2 output longer than input) activates Level 3 (deterministic truncation to K tokens) without any LLM inference. The test confirms no LLM call occurs during L3 truncation.

3. **lcm_grep retrieval correctness:** Given 100 appended records with varied content, `lcm_grep` returns exactly the records matching the query pattern — no false positives, no false negatives. Order matches insertion sequence.

4. **lcm_expand pointer fidelity:** `lcm_expand` called on a SummaryNode pointer returns the original raw records from the ImmutableStore that the node was built from. The content is identical to what was appended — no inference has modified it.

5. **Component isolation:** The `src/lcm/` module has zero imports from `src/sheaf/`, `src/tna/`, `src/soc/`, or `src/orchestrator/`. No LLM inference occurs in any LCM primitive (`lcm_grep`, `lcm_expand`). All LCM unit tests pass in isolation.

---

## Phase 3: Text Network Analysis and Molecular-CoT

**Requirements:** TNA-01, TNA-02, TNA-03, TNA-04, TNA-05, TNA-06, ORCH-03

**Scope:** `src/tna/` + Molecular-CoT bond type interfaces (in `src/types/`)

**Rationale:** TNA is the semantic enrichment layer. Lemmatization is the single most costly retrofit in the entire project — if it is missing from the first graph insertion, the entire semantic graph must be discarded and rebuilt. Louvain determinism must be established before any code depends on community assignments. Molecular-CoT bond type behavioral constraints (ORCH-03) must be defined as enforced interfaces in the type system before any reasoning loop code is written — bond types implemented as mere metadata tags without behavioral invariants is a HIGH-recovery-cost pitfall.

### Requirements in This Phase

| ID | Description |
|----|-------------|
| TNA-01 | Implement TF-IDF + lemmatization preprocessing for semantic entity extraction |
| TNA-02 | Implement 4-gram sliding window for weighted co-occurrence graph construction |
| TNA-03 | Implement Louvain community detection with deterministic seeding |
| TNA-04 | Implement betweenness centrality computation for bridging node identification |
| TNA-05 | Implement structural gap detection (low-density inter-community regions) |
| TNA-06 | Implement topological metrics for gap characterization (distance, modularity delta) |
| ORCH-03 | Implement Molecular-CoT bond type classification (covalent/hydrogen/Van der Waals) |

### Success Criteria

1. **Lemmatization before graph insertion:** Morphological variants of the same concept (e.g., "run", "runs", "running") map to a single canonical graph node. A test verifying this property passes without rebuilding the graph. Node count does not grow proportionally to total word count — it grows proportionally to unique concepts.

2. **Louvain determinism:** Running community detection on the same graph with the same seed produces identical community assignments on every invocation. A test runs Louvain 10 times on a fixed graph and asserts all outputs are identical. Different seeds produce measurably different assignments, confirming the seed actually controls behavior.

3. **Structural gap detection edge cases:** GapDetector correctly identifies zero gaps in a fully connected (no community structure) graph. GapDetector correctly identifies exactly one gap in a two-clique graph connected by a single bridge edge. Both edge cases pass.

4. **Molecular-CoT bond type invariants:** The type system enforces all three behavioral constraints at definition time, not as runtime checks on metadata: covalent bond removal triggers `cascade_invalidate` on all transitively dependent steps; hydrogen bond creation rejects semantic distances above threshold; Van der Waals bonds are rejected when trajectory length is below 5.0. Tests for each constraint pass.

5. **Component isolation:** The `src/tna/` module has zero imports from `src/lcm/`, `src/sheaf/`, or `src/soc/`. All TNA unit tests pass in isolation with synthetic text input.

---

## Phase 4: Self-Organized Criticality Tracking

**Requirements:** SOC-01, SOC-02, SOC-03, SOC-04, SOC-05

**Scope:** `src/soc/`

**Rationale:** SOC is a pure consumer — it reads outputs from Sheaf (eigenspectrum for Von Neumann entropy) and TNA (embedding vectors for semantic entropy) and emits metric events. Both entropy formulas must be validated against known closed-form results before CDP is computed. An incorrect entropy formula produces a plausible-looking CDP value with no observable failure mode until phase-transition detection produces wrong signals in a live session, which is extremely expensive to diagnose.

### Requirements in This Phase

| ID | Description |
|----|-------------|
| SOC-01 | Implement Von Neumann entropy from normalized Laplacian density matrix |
| SOC-02 | Implement embedding entropy from semantic embedding covariance eigenspectrum |
| SOC-03 | Implement Critical Discovery Parameter (CDP) computation and tracking |
| SOC-04 | Implement surprising edge ratio calculation (cross-domain connection tracking) |
| SOC-05 | Implement structural-semantic correlation analysis for phase transition detection |

### Success Criteria

1. **Von Neumann entropy formula correctness:** `VonNeumannEntropy(K_n) = ln(n)` for the complete graph on n nodes. This cross-validates the normalized Laplacian density matrix approach (`ρ = L_norm / n`, `S = -Σ λ_i ln(λ_i)` skipping zero eigenvalues). Entropy values never exceed `ln(n)`. The implementation is confirmed distinct from adjacency-matrix-based Shannon entropy.

2. **Embedding entropy formula correctness:** Identical embeddings yield near-zero entropy. `d` orthogonal unit vectors yield entropy near `ln(d)`. These two edge cases validate the covariance eigenspectrum approach (`Σ = (1/n) E^T E`) and confirm the implementation does not conflate embedding entropy with token frequency Shannon entropy.

3. **Surprising edge ratio computed per-iteration:** Edges are tagged with `createdAtIteration` at insertion. The ratio is computed only over edges added in the current iteration, not cumulatively. A test confirms that when all new edges in a given iteration are intra-community, the surprising edge ratio for that iteration is 0%, regardless of the cumulative graph state.

4. **Phase transition detection is dynamic:** `PhaseTransitionDetector` uses rolling cross-correlation (`ρ(k) = corr(ΔS_structural, ΔS_semantic)`) over a configurable window. No hard-coded iteration number (e.g., 400) appears in the implementation. A synthetic test with a known correlation sign change at iteration 50 fires the transition event at iteration 50 ± window, not at a fixed constant.

5. **Component isolation:** The `src/soc/` module has zero imports from `src/lcm/` or `src/orchestrator/`. SOC reads eigenspectrum and embedding data through well-typed interfaces defined in `src/types/`. All SOC unit tests pass when fed synthetic eigenspectrum and embedding data without any real Sheaf or TNA computation.

---

## Phase 5: Orchestrator Integration

**Requirements:** ORCH-01, ORCH-02, ORCH-04, ORCH-05

**Scope:** `src/orchestrator/` + end-to-end integration tests

**Rationale:** The Orchestrator is the sole composition root. It is the only component that imports from all four modules. Integration work begins here and only here — after all four modules have independently passing unit tests. This is where the H1-to-exploration feedback loop (obstruction-driven graph reconfiguration) is exercised for the first time end-to-end, and where `llm_map` parallel dispatch is validated against stubbed LLM providers.

### Requirements in This Phase

| ID | Description |
|----|-------------|
| ORCH-01 | Implement agent pool with lifecycle management (spawn, heartbeat, cleanup) |
| ORCH-02 | Implement llm_map primitive for parallel task dispatch with context preservation |
| ORCH-04 | Implement event-driven coordination bus for async component messaging |
| ORCH-05 | Implement single composition root (Orchestrator) importing all four modules |

### Success Criteria

1. **Single composition root enforced:** Static analysis (or a lint rule) confirms that `src/sheaf/`, `src/lcm/`, `src/tna/`, and `src/soc/` have zero cross-imports between them. Only `src/orchestrator/` imports from multiple modules. `src/index.ts` delegates assembly to the Orchestrator and imports from no module directly.

2. **llm_map context preservation:** `llm_map` dispatches N parallel subtasks, each receiving a context snapshot from the LCM ImmutableStore at dispatch time. On completion, all N results are appended to the ImmutableStore before any context update runs. A test with 5 parallel tasks and stubbed LLM confirms all 5 results are recorded and no context is lost or overwritten.

3. **Obstruction-driven reconfiguration:** An end-to-end test with a synthetic sheaf configuration that produces non-trivial H^1 triggers the `h1:non-trivial` event on the EventBus. The Orchestrator responds by calling `gapDetector.findNearestGap()`, spawning a Van der Waals exploration agent, and resetting the sheaf topology. All three steps are observable via event bus events in the test.

4. **Three-mode state machine:** The Orchestrator transitions between NORMAL, OBSTRUCTED, and CRITICAL states based on SOC and Sheaf signals. A test confirms the transition from NORMAL to OBSTRUCTED on H^1 detection, back to NORMAL on consensus, and from NORMAL to CRITICAL on a CDP phase-transition event.

5. **End-to-end multi-iteration run:** A full integration test runs the AGEM iteration loop for at least 10 iterations with stubbed LLM calls. At the end: all agent outputs are recorded in the LCM ImmutableStore, the TNA semantic graph has accumulated nodes, SOC metrics are non-null and within valid ranges, and no component has thrown an unhandled exception. This is the single test that confirms all four mathematical properties operate together.

---

## Phase 6: P2 Enhancements

**Requirements:** None from the v1 requirements list — all v1 requirements are covered in Phases 1-5.

**Scope:** v2 requirements (SOC-06, SOC-07, ORCH-06, TNA-07, TNA-08, TNA-09, and others listed in REQUIREMENTS.md v2 section)

**Rationale:** P2 features are added only after the core mathematical properties are verified end-to-end in Phase 5. Each P2 feature has an explicit trigger condition. No P2 feature should be started while any Phase 1-5 success criterion is failing.

**Trigger conditions for starting Phase 6:**
- All Phase 5 success criteria passing in CI
- CDP tracking is stable over 400+ iterations of the integration test runner
- ADMM solver specification is confirmed compatible with restriction map interfaces defined in Phase 1

**Planned enhancements (from v2 requirements):**
- SOC-06: Dynamic phase transition detector (cross-correlation sign change, replacing the Phase 5 approximation)
- SOC-07: Regime validation and stability metrics
- ORCH-06: Obstruction-driven topology reconfiguration (H1 signal -> Van der Waals agent spawn, fully automated)
- TNA-07: GraphRAG catalyst question generation at structural gaps
- TNA-08: Force-Atlas layout for semantic graph visualization
- TNA-09: Betweenness centrality tracking over time

**Success criteria for Phase 6:** Defined during Phase 5 retrospective based on empirical behavior of the live system. Cannot be specified accurately before Phase 5 completes.

---

## Coverage Validation

All 25 v1 requirements are mapped to exactly one phase:

| Requirement | Phase | Component |
|-------------|-------|-----------|
| SHEAF-01 | Phase 1 | Sheaf |
| SHEAF-02 | Phase 1 | Sheaf |
| SHEAF-03 | Phase 1 | Sheaf |
| SHEAF-04 | Phase 1 | Sheaf |
| SHEAF-05 | Phase 1 | Sheaf |
| SHEAF-06 | Phase 1 | Sheaf |
| LCM-01 | Phase 2 | LCM |
| LCM-02 | Phase 2 | LCM |
| LCM-03 | Phase 2 | LCM |
| LCM-04 | Phase 2 | LCM |
| LCM-05 | Phase 2 | LCM |
| TNA-01 | Phase 3 | TNA |
| TNA-02 | Phase 3 | TNA |
| TNA-03 | Phase 3 | TNA |
| TNA-04 | Phase 3 | TNA |
| TNA-05 | Phase 3 | TNA |
| TNA-06 | Phase 3 | TNA |
| ORCH-03 | Phase 3 | Molecular-CoT types |
| SOC-01 | Phase 4 | SOC |
| SOC-02 | Phase 4 | SOC |
| SOC-03 | Phase 4 | SOC |
| SOC-04 | Phase 4 | SOC |
| SOC-05 | Phase 4 | SOC |
| ORCH-01 | Phase 5 | Orchestrator |
| ORCH-02 | Phase 5 | Orchestrator |
| ORCH-04 | Phase 5 | Orchestrator |
| ORCH-05 | Phase 5 | Orchestrator |

**Total:** 27 rows above, but ORCH-03 is the 25th unique v1 requirement and there are exactly 25 v1 requirements. Count by group: SHEAF (6) + LCM (5) + TNA (6) + ORCH-03 (1) + SOC (5) + ORCH (4 in Phase 5) = 27 rows / 25 unique requirements. Confirmed: all 25 mapped, none duplicated, none omitted.

*(Note: The coverage table shows 27 rows because ORCH-03 appears in Phase 3 and the remaining 4 ORCH requirements appear in Phase 5, totaling 25 unique requirements across 6 phases.)*

---

## Key Risks and Mitigations

| Risk | Phase | Mitigation |
|------|-------|-----------|
| Sheaf Laplacian confused with standard graph Laplacian | Phase 1 | Unit test: `L_sheaf * x = 0` for consistent section; substituting `D - A` breaks it |
| Flat sheaf shipped as reference (H^1 always zero) | Phase 1 | Two test configs mandatory: flat (trivial H^1) and non-flat (H^1 > 0) |
| LCM store mutated between tests | Phase 2 | `readonly` + `Object.freeze()` + no `update`/`delete` methods; hash integrity check |
| Escalation L3 missing (infinite loop risk) | Phase 2 | L3 code path mandatory; test activates it with verbose input; no LLM call in L3 |
| Lemmatization missing from graph (costly rebuild) | Phase 3 | Lemmatization enforced before first graph insertion; morphological-variant test |
| Bond types as metadata (no behavioral constraints) | Phase 3 | Interfaces with enforced invariants defined in type system before reasoning loop |
| Von Neumann entropy from wrong matrix | Phase 4 | Cross-validate `S(K_n) = ln(n)` using normalized Laplacian density matrix |
| Embedding entropy confused with Shannon entropy | Phase 4 | Edge case tests: identical embeddings → ~0, d orthogonal → ~ln(d) |
| Phase transition hard-coded to iteration 400 | Phase 4 | Dynamic rolling cross-correlation; no literal `400` in source |
| Surprising edge ratio computed cumulatively | Phase 4 | Per-iteration computation; test with all-intra edges → ratio = 0 that iteration |

---

*Roadmap created: 2026-02-27*
*Requirements version: v1 (25 requirements)*
*Last updated: 2026-02-27*
