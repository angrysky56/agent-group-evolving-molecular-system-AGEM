# Project Research Summary

**Project:** RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)
**Domain:** Multi-agent AI framework — Sheaf-theoretic coordination, Lossless Context Management, Molecular Chain-of-Thought, Text Network Analysis (TypeScript reference implementation)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

AGEM is a TypeScript reference implementation of four interacting mathematical frameworks: Lossless Context Management (LCM) for deterministic agent memory, Sheaf-theoretic coordination for decentralized multi-agent consensus, Text Network Analysis (TNA) for semantic graph construction and structural gap detection, and Self-Organized Criticality (SOC) metrics for monitoring whether the agent swarm is operating in a productive discovery regime. The project is a library, not an application — its primary success criterion is that each of the four mathematical properties can be verified in isolation before integration. No comparable framework (LangGraph, AutoGen, CrewAI, Mastra) implements sheaf cohomology obstruction detection, algebraic-topological coordination deadlock detection, or SOC regime monitoring. These are the genuine differentiators, and they require correct mathematical implementations to carry their claims.

The recommended stack centers on `@langchain/langgraph` 1.2.0 for the orchestration layer (its StateGraph semantics map directly to sheaf stalk spaces and its checkpointing satisfies LCM's Immutable Store requirement), `graphology` 0.26.0 with its full algorithm suite for the TNA semantic graph and sheaf base space, and `mathjs` 15.1.1 for the linear algebra driving sheaf Laplacian construction, eigenvalue decomposition, and Von Neumann entropy. The build order is strict: types first, then LCM and Sheaf in parallel, then TNA, then SOC, then the orchestrator as the sole integration layer. No component should import from any sibling component; all cross-component data flows through the orchestrator's event bus.

The primary risks are mathematical, not infrastructural. The Sheaf Laplacian is easily confused with the standard graph Laplacian, producing silently wrong consensus results. Von Neumann entropy must use the normalized Laplacian as a density matrix, not the adjacency matrix. Embedding entropy must be computed from the eigenspectrum of the embedding covariance matrix, not Shannon entropy over token frequencies. Any one of these substitutions produces a plausible-looking number that invalidates the CDP metric and makes phase-transition detection impossible. These three pitfalls have HIGH recovery cost if caught late, and must be addressed with verified unit tests (including cross-validation against known closed-form results) before any dependent code is written.

## Key Findings

### Recommended Stack

The stack is purpose-built for algorithmic correctness over developer convenience. TypeScript 5.9.3 with strict null checks is mandatory because type errors at the Sheaf restriction map boundary represent mathematical inconsistencies, not just API mismatches. Node.js 22 LTS provides `worker_threads` for `llm_map` parallel dispatch and `AsyncLocalStorage` for deterministic LCM context propagation. LangGraph 1.2.0 is the only JS framework with Supervisor and Network topology patterns that map cleanly to Sheaf Laplacian coordination rounds without wrapping. All LLM calls flow exclusively through the `llm_map` primitive and never touch LCM, Sheaf, TNA, or SOC modules directly.

See [STACK.md](.planning/research/STACK.md) for full version table and alternatives considered.

**Core technologies:**

- `TypeScript 5.9.3` + `Node.js 22 LTS`: Implementation language and runtime — strict types enforce mathematical invariants; worker_threads enable llm_map parallelism
- `@langchain/langgraph 1.2.0` + `@langchain/core 1.1.29`: Orchestration and LLM abstraction — StateGraph maps to stalk spaces; checkpointing satisfies LCM persistence
- `graphology 0.26.0` + algorithm suite: Graph data structure for TNA semantic graph and Sheaf base space — the entire Louvain/betweenness/ForceAtlas2 ecosystem targets this exact API
- `mathjs 15.1.1`: Linear algebra for Sheaf Laplacian, eigenvalue decomposition, Von Neumann entropy — `eigs()` handles complex matrices required for cohomology
- `ml-matrix 6.12.1`: Dense matrix operations and SVD — typed arrays (Float64Array) for performance-sensitive entropy computations
- `zod 3.24.2`: Runtime schema validation for agent state, tool I/O, and bond descriptors — LangGraph uses Zod natively; consistent schema layer across all module boundaries
- `better-sqlite3 12.6.2` (dev) / `pg 8.19.0` (prod): Immutable Store persistence — synchronous SQLite for single-process reference; PostgreSQL for multi-process scale-out
- `natural 8.1.0` + `stopword 3.1.5` + `wink-lemmatizer 3.0.4`: NLP preprocessing pipeline — TF-IDF, lemmatization, stopword removal before 4-gram windowing
- `@huggingface/transformers 3.8.1`: Local ONNX embeddings — `all-MiniLM-L6-v2` for high-frequency SOC entropy probes without API cost
- `vitest 4.0.18`: Test runner — native ESM, no CommonJS shims, `--pool=forks` for native module isolation

**What NOT to use:**

- `langchain` monolith v0.x (split package; causes bundle bloat and version conflicts)
- Standard graph Laplacian (`D - A`) as a Sheaf Laplacian substitute (mathematically wrong; silent incorrect consensus)
- `@tensorflow/tfjs-node` for SVD/eigenvalues (300+ MB, native build fragility; use `mathjs` + `ml-matrix`)
- LangChain v0.1.x memory classes (`BufferMemory` etc.) — ad-hoc summarization with no determinism guarantees

### Expected Features

The MVP is defined by the requirement that all four mathematical properties operate together and are independently verifiable. Features are P1 (required to make claims verifiable), P2 (significant value after core works), or P3 (future consideration).

See [FEATURES.md](.planning/research/FEATURES.md) for full dependency graph and prioritization matrix.

**Must have (P1 — table stakes and core differentiators):**

- Immutable append-only Interaction Log + `lcm_grep` + `lcm_expand` — deterministic retrieval foundation; no LLM inference in the retrieval path
- Active Context DAG (SummaryNodes) + Three-level escalation protocol — liveness guarantee for long-horizon sessions; L3 deterministic truncation is the safety valve
- Typed shared interfaces (`ContextState`, `GraphTypes`, `Events`) — must be defined first; everything else depends on these compiling
- Stalk spaces + Restriction maps + Sheaf Laplacian — minimum viable sheaf-theoretic coordination; non-flat restriction maps required from the start
- Sheaf Cohomology H0/H1 — the differentiating mathematical claim; H1 obstruction detection is what distinguishes this from a hub-and-spoke system
- TF-IDF preprocessing + lemmatization + 4-gram sliding window + Weighted semantic graph — TNA pipeline foundation; lemmatization cannot be retrofitted without rebuilding the graph
- Louvain community detection + Structural gap detection — Van der Waals targeting vector; gap coordinates required for GraphRAG catalyst generation
- Von Neumann entropy + Embedding entropy + CDP computation — SOC monitoring; both entropy formulas must be mathematically correct before CDP is meaningful
- Surprising edge ratio tracker (per-iteration, not cumulative) — validates ~12% criticality property
- `llm_map` parallel dispatch + AGEMOrchestrator iteration loop — demonstrates LCM scaling claim and all four components operating together
- Obstruction-driven graph reconfiguration — H1-to-exploration feedback loop; the self-healing pattern is a core architectural claim

**Should have (P2 — add after core validated):**

- ADMM distributed consensus solver — convergence-guaranteed consensus; add after Sheaf Laplacian is unit-tested
- Phase transition detector (dynamic cross-correlation sign change, NOT hard-coded iteration 400) — add after CDP tracking is stable over 400+ iterations
- GraphRAG catalyst question generation at structural gaps — add after gap detection produces correct coordinates
- Force-Atlas layout for semantic graph — required for correct gap coordinate spatial semantics
- Betweenness centrality — conceptual bottleneck identification; add when semantic graph is stable
- Molecular CoT bond type classification (covalent/hydrogen/Van der Waals) with behavioral constraints, not metadata tags
- SQLite persistence for ImmutableStore — swap from in-memory once in-memory proves correct

**Defer (P3 / v2+):**

- Hierarchical compositional reasoning with category-theoretic framing
- Preferential attachment monitoring and scale-free degree distribution verification
- Surprising edge ratio active control (passive tracking in v1; active feedback controller is a separate research problem)
- Multi-session knowledge graph persistence across restarts
- Distributed agent execution across machines

**Anti-features (do not build in v1):**

- Web UI / visualization dashboard (separate application; exposes JSON/event stream for consumers to visualize)
- Centralized consensus controller (defeats the decentralized coordination property)
- LLM inference inside LCM primitives (destroys determinism)
- Shared mutable state between components (destroys independent testability)
- Louvain detection every iteration (performance cliff; run on schedule or threshold)

### Architecture Approach

The architecture enforces a strict layered dependency hierarchy with a single composition root. The four core modules (LCM, Sheaf, TNA, SOC) have zero awareness of each other. The Orchestrator is the only component that imports from all four and is the sole writer to the LCM Immutable Store on behalf of all components. Cross-component signals travel exclusively through a typed event bus. The Sheaf graph (adjacency of agents) and the TNA semantic graph are structurally distinct objects that evolve in parallel — TNA processes agent language; Sheaf processes agent state vectors. SOC reads outputs from both and emits metric events; it has no side effects. LCM provides deterministic memory to all components without inference.

See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for full data flow diagrams, integration boundary table, and build order.

**Major components:**

1. `src/types/` — Shared interfaces (`ContextState`, `GraphTypes`, `Events`); no dependencies; must be defined first
2. `src/lcm/` — Immutable Store, Context DAG, SummaryNodes, EscalationProtocol, `lcm_grep`, `lcm_expand`; deterministic memory foundation
3. `src/sheaf/` — CellularSheaf, Stalk, RestrictionMap, SheafLaplacian, CohomologyAnalyzer, ADMMSolver; depends only on types
4. `src/tna/` — Preprocessor, NgramWindowBuilder, SemanticGraph, LouvainDetector, BetweennessCentrality, GapDetector, GraphRAGGenerator; depends only on types
5. `src/soc/` — VonNeumannEntropy, EmbeddingEntropy, CriticalityTracker, PhaseTransitionDetector, EntropyTimeSeries; depends on Sheaf and TNA outputs
6. `src/orchestrator/` — AGEMOrchestrator, `llm_map`, EventBus, AgentPool; imports from all four modules; integration tests live here

**Critical integration points:**

- Orchestrator -> Sheaf: reads Sheaf graph eigenspectrum; passes to VonNeumannEntropy (Sheaf does not know SOC exists)
- Orchestrator -> TNA: reads SemanticGraph diversity; passes to EmbeddingEntropy (TNA does not know SOC exists)
- CohomologyAnalyzer -> Orchestrator: `h1:non-trivial` event triggers GapDetector lookup and exploratory agent spawn
- SOC -> Orchestrator: `criticality:phase-transition` event; SOC is the only outbound signaler
- All components -> LCM: only Orchestrator writes to LCM; components do not write directly

### Critical Pitfalls

See [PITFALLS.md](.planning/research/PITFALLS.md) for full treatment including warning signs, recovery cost, and verification checklists.

**Phase 1 pitfalls (HIGH recovery cost — must address before dependent code is written):**

1. **Sheaf Laplacian computed as standard graph Laplacian** — Implement coboundary operator `δ_0` explicitly: for each oriented edge `(u,v)`, the map is `x ↦ F_{v←e} x_v - F_{u←e} x_u`. Assert `dim(C^0) = Σ_v dim(F(v))`. Unit test: for a two-node sheaf with consistent sections, `L_sheaf x = 0` must hold, and substituting `D - A` must break it. Warning sign: consensus converges in 1-2 steps regardless of initial disagreement.

2. **Flat sheaf (identity restriction maps) shipped as reference** — Define at least two test configurations from the start: flat (trivial H^1) and non-flat (projection-based restriction maps producing non-trivial H^1). Assert `dim(H^1) > 0` for a triangle graph with incompatible projection axes. Warning sign: H^1 computation always returns zero; obstruction code path never triggers in any test.

3. **Sheaf cohomology H^1 computed with wrong numerical tolerance** — SVD/null-space rank determination tolerance must be calibrated to restriction map magnitude: `tol = max_entry * n * eps_machine`. Construct a synthetic 3-cycle inconsistency test; assert `dim(H^1) = 1` with tight tolerance. Warning sign: tolerance set to `1e-6` or larger without documented justification; no synthetic test for non-trivial cohomology exists.

**Phase 2 pitfalls (HIGH recovery cost):**

4. **LCM Immutable Store implemented as mutable log** — Use TypeScript `readonly`, `Object.freeze()` on insert, and a class with no `update` or `delete` methods. Add a development-mode hash integrity check per record. Warning sign: test isolation requires clearing the store between tests.

5. **LCM Three-Level Escalation Protocol missing Level 3** — Implement L3 (unconditional deterministic truncation to K tokens) as a code path that activates when `len(summary) >= len(input)` after L2. L3 must involve zero LLM inference. Warning sign: context management code has no hard truncation path; while loop with no maximum iteration count.

**Phase 3 pitfall (HIGH recovery cost):**

6. **4-gram sliding window applied without lemmatization** — Lemmatization must be in the preprocessing pipeline from the first graph insertion; retrofitting requires discarding the entire graph and rebuilding. All morphological variants of a concept must map to a single canonical node. Use `wink-lemmatizer` or equivalent with a seeded pipeline. Warning sign: node count grows proportionally to total word count; betweenness centrality of central concepts is low despite high frequency.

**Phase 4 pitfalls (HIGH recovery cost if caught late):**

7. **Von Neumann entropy computed from adjacency matrix instead of density matrix** — Must compute normalized Laplacian `L_norm = D^{-1/2} L D^{-1/2}`, then `ρ = L_norm / n`. Entropy: `S = -Σ λ_i ln(λ_i)` skipping zero eigenvalues. Cross-validate: `S(K_n) = ln(n)`. Warning sign: entropy values exceed `ln(n)`; entropy never changes significantly as graph grows.

8. **Embedding entropy conflated with token/vocabulary Shannon entropy** — Must compute from eigenspectrum of embedding covariance matrix `Σ = (1/n) E^T E`. This is expensive (O(d^2 n)); use random projection to 64-128 dimensions for reference implementation. Cross-validate: identical embeddings yield near-zero entropy; `d` orthogonal unit vectors yield near `ln(d)`. Warning sign: semantic entropy tracks node count linearly; CDP is always positive.

9. **Phase transition detection hard-coded to iteration 400** — Implement dynamic cross-correlation detection: `ρ(k) = corr(ΔS_structural, ΔS_semantic)` over a rolling window of W=20 iterations; transition fires when correlation crosses zero from positive to negative and remains negative for W/2 consecutive windows. The iteration ~400 from the paper is an empirical observation for a specific configuration, not a design constant.

10. **Surprising edge ratio computed cumulatively instead of per-iteration** — Tag every edge with `createdAtIteration` at insertion; compute ratio only over edges added in the current iteration. Track as a sliding window time series, not a global counter. Target: 8–16%; alert on exceedance. Warning sign: ratio is stable at exactly 12% from iteration 1.

**Molecular-CoT pitfall (phase 3, HIGH recovery cost):**

11. **Bond types implemented as metadata tags without behavioral constraints** — Covalent bond removal must trigger `cascade_invalidate` on all transitively dependent steps. Hydrogen bond creation must validate `semanticDistance < threshold_H`. Van der Waals bonds must have `trajectoryLength > 5.0`. Define these as interfaces with enforced invariants in the type system before any reasoning loop code is written.

## Implications for Roadmap

Based on the dependency graph in FEATURES.md and the build order in ARCHITECTURE.md, the natural phase structure is:

### Phase 1: Sheaf-Theoretic Coordination Foundation

**Rationale:** Sheaf is the most mathematically demanding component and has the most dangerous silent failure modes. Validating it first, in isolation, before any other component depends on consensus results, is the only way to catch the graph-Laplacian substitution pitfall before it propagates. Sheaf depends only on types; it can be built immediately after types are defined and has no dependency on LCM, TNA, or SOC.

**Delivers:** `CellularSheaf`, `Stalk`, `RestrictionMap`, `SheafLaplacian`, `CohomologyAnalyzer` — fully unit-tested with both flat and non-flat configurations; synthetic 3-cycle inconsistency test producing `dim(H^1) = 1`; Laplacian convergence test with known global section.

**Addresses:** Typed shared interfaces (required first); Stalk spaces + Restriction maps + Sheaf Laplacian; Sheaf Cohomology H0/H1 (P1 features)

**Avoids:** Pitfalls 1 (wrong Laplacian), 2 (flat sheaf shortcut), 3 (cohomology numerical tolerance), which are all HIGH recovery cost if caught in Phase 4+

### Phase 2: LCM Dual-Memory Architecture

**Rationale:** LCM is the memory foundation that every other component depends on for persistence and retrieval. Its correctness is algorithmic (no LLM inference in the retrieval path) and fully independent of Sheaf, TNA, and SOC. The immutable guarantee and three-level escalation liveness property must be enforced at the type system level from the first commit; retrofitting is high-risk. Can be built in parallel with Phase 1 after types are defined.

**Delivers:** `ImmutableStore` (frozen records, append-only, hash integrity checks), `ContextDAG`, `SummaryNode`, `EscalationProtocol` (all three levels including L3 deterministic truncation), `lcm_grep`, `lcm_expand` — fully unit-tested including mutation-attempt failure tests and verbose-input Level-3 activation test.

**Uses:** `better-sqlite3` (dev) or in-memory; `zod` for record schemas; `pino` for structured logs

**Avoids:** Pitfalls 4 (mutable store) and 5 (missing L3), both HIGH recovery cost

### Phase 3: Text Network Analysis and Molecular-CoT

**Rationale:** TNA is the semantic enrichment layer; its lemmatization step is the highest-cost retrofit in the entire project (graph must be discarded and rebuilt if lemmatization is missing). Louvain determinism must be established before any code depends on community assignments. Molecular-CoT bond type behavioral constraints must be defined in the type system before reasoning loop code is written. TNA depends only on types and text input; it can proceed in parallel with Phase 2.

**Delivers:** `Preprocessor` (lemmatize, TF-IDF, stopword removal), `NgramWindowBuilder` (4-gram sliding window with weighted edges), `SemanticGraph`, `LouvainDetector` (seeded for determinism), `GapDetector` — with structural gap detection verified against two-clique and fully-connected graph edge cases. Molecular-CoT bond type interfaces with enforced behavioral invariants (covalent cascade invalidation, hydrogen distance validation, Van der Waals trajectory threshold).

**Avoids:** Pitfalls 6 (missing lemmatization), 5b (non-deterministic Louvain), 8 (bond types as metadata only)

### Phase 4: SOC Tracking and Criticality

**Rationale:** SOC is a pure consumer: it reads outputs from both Sheaf (eigenspectrum for Von Neumann entropy) and TNA (embedding vectors for semantic entropy) and emits metric events. It cannot be implemented before Sheaf and TNA interfaces are stable. Both entropy formulas must be validated with known closed-form cross-checks before CDP is computed, because wrong entropy produces wrong CDP which produces wrong phase-transition signals with no observable failure mode.

**Delivers:** `VonNeumannEntropy` (normalized Laplacian density matrix, validated against `S(K_n) = ln(n)`), `EmbeddingEntropy` (covariance eigenspectrum with optional random projection, validated against identical/orthogonal embedding edge cases), `CriticalityTracker` (CDP = semantic - structural entropy, per-iteration surprising edge ratio), `PhaseTransitionDetector` (dynamic rolling cross-correlation, no hard-coded iteration 400), `EntropyTimeSeries`.

**Avoids:** Pitfalls 7 (wrong Von Neumann entropy), 8 (wrong embedding entropy), 9 (hard-coded phase transition), 10 (cumulative surprising edge ratio)

### Phase 5: Orchestrator Integration and End-to-End Validation

**Rationale:** The orchestrator is the only component that imports from all four modules. It should only begin once all four modules have passing unit tests independently. Integration tests live here. This is where obstruction-driven graph reconfiguration (the H1-to-exploration feedback loop) is exercised for the first time, and where `llm_map` parallel dispatch is validated against real or stubbed LLM providers.

**Delivers:** `AGEMOrchestrator` (main iteration loop, agent lifecycle, three-mode state machine: NORMAL/OBSTRUCTED/CRITICAL), `llm_map` (parallel sub-task dispatch with worker threads), `EventBus` (typed inter-component events), `AgentPool` (spawn/teardown), `obstruction-driven graph reconfiguration` — end-to-end integration tests demonstrating all four mathematical properties operating together across multiple iterations.

**Uses:** LangGraph StateGraph for orchestration; LangSmith for tracing and validating covalent bond cluster retention (72.56%) and hydrogen bond reconnection rates (81.72%)

### Phase 6: P2 Enhancements (after core validated)

**Rationale:** Add ADMM distributed solver, phase transition detector (now that CDP tracking is stable over 400+ iterations), GraphRAG catalyst question generation at structural gaps, Force-Atlas layout for correct gap spatial coordinates, betweenness centrality, Molecular CoT bond classification, and SQLite persistence for the ImmutableStore. Each of these has an explicit trigger condition documented in FEATURES.md.

### Phase Ordering Rationale

- **Types before everything:** Nothing compiles without `ContextState`, `GraphTypes`, and `Events`. Zero build time lost; maximum dependency clarity.
- **Sheaf and LCM in parallel (both before TNA/SOC):** Sheaf has the highest mathematical failure risk (silent wrong results); LCM has the highest architectural risk (immutable guarantee); both are independent of TNA and SOC and can be verified in isolation.
- **TNA before SOC:** Embedding entropy requires agent text to be processed through the TNA pipeline. SOC is a pure consumer of TNA outputs.
- **SOC before Orchestrator:** SOC metrics must be validated against known test cases before the orchestrator wires them into the iteration loop. An incorrect entropy formula in a running multi-agent session produces misleading signals with no obvious error signal.
- **Orchestrator last:** Integration tests belong here, not in individual component test suites. Cross-component coupling is permitted only at this boundary.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1 (Sheaf):** The ADMM solver (P2) requires distributed optimization theory; may need dedicated research into convergence guarantees for the specific stalk dimension configurations used. The restriction map design for heterogeneous agents (different observation dimensions, asymmetric communication) needs concrete examples before implementation.
- **Phase 4 (SOC):** The random projection approach for embedding entropy reduction (Johnson-Lindenstrauss) needs empirical validation that the entropy approximation error remains bounded for the embedding dimensions and concept counts this project targets.
- **Phase 5 (Orchestrator):** The three-mode state machine (NORMAL/OBSTRUCTED/CRITICAL) transition logic needs precise specification: exact conditions for entering OBSTRUCTED from NORMAL, and whether CRITICAL is re-entrant or terminal.

Phases with standard patterns (skip additional research):

- **Phase 2 (LCM):** The append-only log, DAG structure, and three-level summarization protocol are fully specified in the LCM paper (arXiv:2602.22402) and do not require additional research.
- **Phase 3 (TNA — NLP pipeline):** InfraNodus methodology is thoroughly documented; `natural`, `stopword`, `wink-lemmatizer`, and `graphology-communities-louvain` are well-understood libraries with stable APIs.
- **Phase 6 (P2 enhancements):** Each P2 feature has an explicit trigger condition and is added incrementally; no new research needed beyond what is already in the research files.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                                                                                       |
| ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | All version numbers verified against npm registry 2026-02-27; LangGraph, graphology, mathjs APIs verified via Context7; peer dependency compatibility matrix documented                                     |
| Features     | HIGH       | Feature set derived directly from the primary framework document; competitor analysis confirms differentiators; dependency graph is complete and consistent                                                 |
| Architecture | HIGH       | Layered dependency pattern is a standard TypeScript multi-module pattern; data flow diagrams verified against the four framework paper sources; build order follows strict topological sort of dependencies |
| Pitfalls     | HIGH       | Each pitfall traced to a specific academic source with warning signs and recovery cost estimates; cross-referenced with community reports (Hacker News LCM discussion, LangGraph production experience)     |

**Overall confidence:** HIGH

### Gaps to Address

- **ADMM solver specification:** The distributed consensus optimizer is P2 but the stalk dimension and restriction map choices made in Phase 1 must be compatible with ADMM's update rule. During Phase 1 planning, confirm the restriction map interface can accommodate the ADMM auxiliary variable structure without breaking the sheaf type definitions.
- **Embedding model selection for production:** `all-MiniLM-L6-v2` (384-dim) is recommended for SOC entropy probes; `text-embedding-3-small` (1536-dim) for TNA semantic similarity. Whether to use the same model for both or different models for each purpose should be settled before Phase 4 implementation to avoid schema conflicts in the graph node embedding store.
- **Surprising edge threshold calibration:** The `δ_surprising` threshold for classifying edges as surprising vs. expected is not specified in the SOC paper beyond the 12% target ratio. An empirical calibration run against a known corpus is needed during Phase 4 to set this value before the CDP stabilization monitoring can validate the regime.
- **LangGraph StateGraph vs. Network topology selection:** Phase 5 (Orchestrator) must decide whether to use LangGraph's Supervisor pattern (coordinator-worker for Sheaf Laplacian consensus rounds) or Network pattern (peer-to-peer for Van der Waals exploratory agents) — or both, with the Orchestrator selecting the topology per operating mode. This decision should be made explicit in Phase 5 planning.

## Sources

### Primary (HIGH confidence)

- `/langchain-ai/langgraphjs` (Context7) — LangGraph multi-agent patterns, StateGraph API, Supervisor/Network topologies, Command routing
- `/graphology/graphology` (Context7) — Louvain community detection, betweenness centrality, ForceAtlas2 layout API
- `/josdejong/mathjs` (Context7) — `eigs()` complex matrix support, coboundary operator construction
- `/huggingface/transformers.js` (Context7) — Feature extraction pipeline, local ONNX embedding
- npm registry (live queries 2026-02-27) — All version numbers and peer dependency compatibility verified
- `docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md` — Primary framework specification; all mathematical requirements

### Secondary (MEDIUM confidence)

- arXiv:2602.22402 (Voltropy LCM paper) — LCM three-level escalation, immutable store architecture, llm_map primitive
- arXiv:2504.17700v1 — Applied Sheaf Theory For Multi-Agent AI: Sheaf Laplacian formulation, H^1 obstruction detection
- arXiv:2504.02049 — Distributed Multi-agent Coordination over Cellular Sheaves: ADMM-based diffusion, stalk dimension handling
- arXiv:2503.18852v1 / AIP Chaos 2025 — Self-Organizing Graph Reasoning: Von Neumann entropy, CDP, ~12% surprising edge ratio, iteration ~400 phase transition
- arXiv:2601.06002v2 — Molecular-CoT topology: covalent 72.56% cluster retention, hydrogen 81.72% reconnection, Van der Waals 5.32 t-SNE trajectory
- InfraNodus documentation — 4-gram sliding window, TF-IDF, Louvain, betweenness centrality, structural gap methodology

### Tertiary (LOW confidence)

- OpenReview: "Sheaf Cohomology of Linear Predictive Coding Networks" — H^0/H^1 interpretation, inconsistent cognitive loop detection; non-peer-reviewed at time of research
- Hacker News discussion of LCM paper (item 47038411) — community-identified implementation risks around context compaction failure; anecdotal but corroborates the Level 3 pitfall

---

_Research completed: 2026-02-27_
_Ready for roadmap: yes_
