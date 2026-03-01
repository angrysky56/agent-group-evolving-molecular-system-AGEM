# Project State

**Project:** RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)
**Last updated:** 2026-03-01
**Current phase:** Phase 4 (SOC) — Unblocked (Phase 3 complete)

## Status Snapshot

| Phase | Name | Status | Requirements | Success Criteria Met |
|-------|------|--------|--------------|----------------------|
| 1 | Sheaf-Theoretic Coordination | **COMPLETE** | SHEAF-01 through SHEAF-06 | **5 / 5** |
| 2 | LCM Dual-Memory Architecture | **COMPLETE** | LCM-01 through LCM-05 | **5 / 5** |
| 3 | Text Network Analysis + Molecular-CoT | **COMPLETE** (Plan 03/03 done: GapDetector + barrel export) | TNA-01 through TNA-06, ORCH-03 | **6 / 6** (TNA-01–06 + ORCH-03 all satisfied) |
| 4 | Self-Organized Criticality Tracking | **IN PROGRESS** (Plan 01/02 done: SOC types + entropy functions) | SOC-01 through SOC-05 | 1 / 5 (SOC-01, SOC-02 guarded) |
| 5 | Orchestrator Integration | Blocked (requires Phases 1, 3, 4) | ORCH-01, ORCH-02, ORCH-04, ORCH-05 | 0 / 5 |
| 6 | P2 Enhancements | Blocked (Phase 5 not done) | v2 requirements | — |

**Overall v1 requirements:** 19 / 25 implemented (SHEAF-01–06 complete; LCM-01–05 complete; TNA-01–06 + ORCH-03 satisfied; SOC-01, SOC-02 mathematical foundations guarded)

## What Has Been Done

- Project initialized (2026-02-27)
- Research completed: stack, architecture, features, pitfalls (2026-02-27)
- All 25 v1 requirements defined and assigned IDs (2026-02-27)
- Roadmap created with 6 phases, requirement mappings, and success criteria (2026-02-27)
- Traceability table in REQUIREMENTS.md updated with phase assignments (2026-02-27)
- **Phase 1, Wave 1 complete (2026-02-27):** Toolchain, shared types, CellularSheaf, test helpers, 24 unit tests passing.
  - See `.planning/phases/01-sheaf/02-SUMMARY.md` for full details.
- **Phase 1, Wave 2 complete (2026-02-27):** Coboundary operator B, Sheaf Laplacian L=B^T B, ADMM solver interface, 55 new tests (79 total passing). Pitfall gate T3c confirmed B shape [3,6] not [3,3]. Discrimination test T5b confirmed L_sheaf differs from L_graph tensor I_2 for non-flat sheaf.
  - See `.planning/phases/01-sheaf/03-SUMMARY.md` for full details.
- **Phase 1, Wave 3 complete (2026-02-27):** SVD-based cohomology analysis, CohomologyAnalyzer with EventEmitter, numerical tolerance calibration, module isolation test, barrel export. 27 new tests (106 total passing). All 5 ROADMAP.md success criteria + 2 extended criteria from 01-RESEARCH.md Section 12 verified.
  - See `.planning/phases/01-sheaf/04-SUMMARY.md` for full details.
  - See `.planning/phases/01-sheaf/VERIFICATION.md` for full verification record.
- **Phase 2, Wave 1 complete (2026-02-28):** ImmutableStore with defense-in-depth immutability (Object.freeze + ReadonlyArray), UUIDv7 time-sortable IDs, SHA-256 content hashes, injectable ITokenCounter. LCMClient thin coordinator wires ImmutableStore + EmbeddingCache at append time (wiring gap closed). All shared LCM interfaces defined (IEmbedder, ICompressor, ITokenCounter, LCMEntry, EscalationThresholds, SummaryNode). MockEmbedder and MockCompressor available for all downstream tests. testStoreFactory helper ready. 14 new tests (120 total passing). LCM store mutable pitfall RESOLVED (T1b + T6 guard permanently).
  - See `.planning/phases/02-lcm/02-03-SUMMARY.md` for full details.
- **Phase 2, Wave 2 complete (2026-02-28):** ContextDAG with DFS acyclicity enforcement and lineage tracking. SummaryIndex with Object.defineProperties content freeze and full MetricUpdate audit trail. EmbeddingCache full implementation (replacing Wave 1 stub). LCMGrep cosine-similarity semantic search with IEmbedder injection and hybrid caching strategy. 17 new tests (137 total passing). LCM-02 and LCM-04 RESOLVED.
  - See `.planning/phases/02-lcm/02-04-SUMMARY.md` for full details.
- **Phase 2, Wave 3 complete (2026-02-28):** EscalationProtocol with three-level compression and deterministic L3 convergence (encode+slice+decode, zero ICompressor in L3). lcm_expand async generator with lazy streaming traversal. Module isolation test (T14+T14b). LCM barrel export. 22 new tests (159 total passing). All 5 ROADMAP Phase 2 success criteria RESOLVED.
  - See `.planning/phases/02-lcm/02-05-SUMMARY.md` for full details.
- **Phase 3, Wave 1, Plan 01 complete (2026-02-28):** TNA foundation types (TextNodeId, TextNode, TextEdge, GapMetrics, TNAConfig, PreprocessResult, DetailedPreprocessResult), MolecularCoT bond types (BondGraph with behavioral invariants for covalent/hydrogen/VdW). Preprocessor (TF-IDF + wink-lemmatizer POS-aware, no Porter stemmer fallback). CooccurrenceGraph (4-gram sliding window, surface form tracking via preprocessDetailed()). 22 new tests (181 total passing). PRIMARY PITFALL GUARD: T6b confirmed — 80 analyze-variant tokens → ≤2 nodes. Pitfalls RESOLVED: "4-gram without lemmatization" (T6b) + "bond types as metadata only" (BondGraph class).
  - See `.planning/phases/03-tna-molecular-cot/03-01-SUMMARY.md` for full details.
- **Phase 3, Wave 2, Plan 02 complete (2026-02-28):** LouvainDetector (deterministic Louvain via Mulberry32 PRNG rng option) + CentralityAnalyzer (normalized betweenness centrality, bridge node identification). CooccurrenceGraph extended with updateNodeCentrality() + updateNodeCommunity(). 16 new tests (197 total passing, but 38 in TNA module). LOUVAIN DETERMINISM PITFALL RESOLVED: T9 (10 runs same seed = identical) is a permanent regression guard. TNA-03 (Louvain community detection with seeding) + TNA-04 (betweenness centrality for bridge nodes) SATISFIED.
  - See `.planning/phases/03-tna-molecular-cot/03-02-SUMMARY.md` for full details.
- **Phase 3, Wave 3, Plan 03 complete (2026-03-01):** GapDetector (inter-community structural gap detection with topological metrics: density, shortest path, modularity delta, bridge nodes). TNA isolation test (T20–T21: zero cross-module imports, synthetic input only). TNA barrel export (Preprocessor, CooccurrenceGraph, LouvainDetector, CentralityAnalyzer, GapDetector + all types). 12 new tests (209 total passing, 50 in TNA module). ROADMAP success criteria 3 + 5 guarded: T16 (zero gaps in fully connected) + T16b (one gap in bridge) + T20 (isolation). TNA-05 (structural gap detection) + TNA-06 (topological metrics) SATISFIED.
  - See `.planning/phases/03-tna-molecular-cot/03-03-SUMMARY.md` for full details.
- **Phase 4, Wave 1, Plan 01 complete (2026-02-28):** SOC types and event definitions (SOCMetricsEvent, SOCPhaseTransitionEvent, SOCEventType, SOCEvent in Events.ts; SOCInputs, SOCMetrics, SOCConfig, MetricsTrend in soc/interfaces.ts). Von Neumann entropy pure function (normalized Laplacian density matrix via math.eigs()) and embedding entropy pure function (covariance eigenspectrum via ml-matrix EigenvalueDecomposition). 11 new tests (220 total passing). PRIMARY CORRECTNESS GATES: T-VN-01..05 guard S(K_n) = ln(n-1) for normalized Laplacian; T-EE-01..05 guard identical→0 and orthogonal→ln(d). SOC-01 and SOC-02 permanently guarded. Rule 1 auto-fix: corrected K_n criterion from ln(n) to ln(n-1) per mathematical derivation.
  - See `.planning/phases/04-soc/04-01-SUMMARY.md` for full details.

## What Is Next

**Phase 4 (SOC) Wave 1 complete — SOC-01 and SOC-02 mathematical foundations guarded.** Phase 4 Wave 2 is next:

1. Phase 4 Wave 2 (04-02-PLAN.md): SOCTracker class + EventEmitter wiring + correlationCoefficient + isPhaseTransition + metrics history + isolation test + barrel export

**Open question resolved:** SOCInputs accepts plain types (not TNA class instances) — embedding model selection question deferred to Phase 5 integration.

## Active Decisions

| Decision | Date | Detail |
|----------|------|--------|
| TypeScript 5.9.3 + Node.js 22 LTS | 2026-02-27 | Strict null checks mandatory; worker_threads for llm_map |
| graphology 0.26.0 | 2026-02-27 | TNA semantic graph and Sheaf base space |
| mathjs 15.1.1 | 2026-02-27 | Sheaf Laplacian, eigenvalue decomposition, Von Neumann entropy |
| vitest 4.0.18 | 2026-02-27 | Native ESM test runner; pool:forks for native module isolation; passWithNoTests:true |
| Phase 1 = Sheaf (not LCM) | 2026-02-27 | Highest mathematical failure risk; silent wrong results if done late |
| ORCH-03 in Phase 3 | 2026-02-27 | Bond type invariants must be in type system before reasoning loop code exists |
| No LLM inference in LCM primitives | 2026-02-27 | Determinism guarantee; retrieval path must be pure data operations |
| Zero cross-imports between core modules | 2026-02-27 | Only orchestrator imports from multiple modules; enforced by lint |
| Branded string types for VertexId/EdgeId | 2026-02-27 | Catches ID misuse at compile time; zero runtime cost |
| CellularSheaf internals are protected (not private) | 2026-02-27 | Allows Wave 2 Laplacian methods to extend without rewriting the class |
| RestrictionMap entries: row-major Float64Array | 2026-02-27 | entry[r*sourceDim+c] = row r, col c; consistent with ml-matrix SVD input format |
| Coboundary orientation: source=NEGATIVE, target=POSITIVE | 2026-02-27 | B[eRow, srcCol] = -F_{u<-e}, B[eRow, tgtCol] = +F_{v<-e}; enforced by T3d |
| ADMM Phase 1 stub = gradient descent | 2026-02-27 | alpha = 0.5/max_eigenvalue; replacing with true ADMM requires no test changes |
| B assembly via 2D array (not math.subset) | 2026-02-27 | Avoids mathjs indexing quirks; simpler to verify against hand computation |
| ml-matrix SVD boundary: CohomologyAnalyzer.ts only | 2026-02-27 | mathjs for matrix assembly (Waves 1-2), ml-matrix for SVD (Wave 3 only); interop via B.toArray() |
| Tolerance formula: MATLAB rank() default | 2026-02-27 | max(S)*max(N0,N1)*Number.EPSILON; not hardcoded 1e-6; documented in code comments |
| T7 canonical H^1=1 sheaf: flat 1D triangle | 2026-02-27 | threeCycleInconsistentSheaf has rank(B)=3 (full row rank), h1=0; research doc had wrong rank=2 claim; flat 1D triangle (incidence matrix of cycle) gives rank=2, h1=1 |
| getAll() returns Object.freeze([...#entries]) | 2026-02-28 | Frozen shallow copy: runtime mutation throws TypeError without preventing future appends to backing array; compile-time ReadonlyArray not sufficient alone |
| EmbeddingCache forward-declared in Wave 1 | 2026-02-28 | LCMClient wiring test (T1d) runs in Wave 1; full EmbeddingCache implementation in plan 02-04 (Wave 2) |
| MockEmbedder: SHA-256 seed + Math.sin(seed+i) + L2-normalize | 2026-02-28 | Deterministic 384-dim embeddings without model loading; consistent with 02-RESEARCH.md spec |
| SummaryNode content frozen via Object.defineProperties | 2026-02-28 | Non-writable/configurable on content+id; metrics mutable-but-tracked via updateMetric() with MetricUpdate audit trail |
| ContextDAG cycle detection via DFS over intermediateCompressions.childIds | 2026-02-28 | Simple visited-set DFS sufficient for Phase 2 linear summarization; self-references caught immediately |
| cosineSimilarity() uses full dot/(normA*normB) formula | 2026-02-28 | Correct for any embedder (not simplified dot-only which assumes L2-normalized inputs) |
| getParentSummary() is O(n) scan | 2026-02-28 | Acceptable for Phase 2 linear summarization; Wave 3 can optimize if needed |
| L3 uses 50% per-chunk token slicing — no ICompressor calls | 2026-02-28 | Hard convergence guarantee; L3 path uses encode+slice+decode only; CONTEXT.md locked decision: chunk first, hard-truncate as fallback |
| EscalationResult.level: 0 for no escalation | 2026-02-28 | Distinguishes no-escalation from levels 1-3; 0 means input was under threshold, no action taken |
| Test token helper uses "cat" (1 BPE token each) | 2026-02-28 | gpt-tokenizer BPE for "cat" is exactly 1 token — gives predictable counts for threshold-sensitive tests |
| No Porter stemmer fallback in lemmatize() | 2026-02-28 | Porter("analyze")="analyz" vs wink.verb("analyzing")="analyze" — two nodes for one concept; wink result or identity used instead |
| DetailedPreprocessResult with surfaceToLemma | 2026-02-28 | Synchronous surface form tracking in Preprocessor pipeline; avoids async re-tokenization in CooccurrenceGraph |
| GraphConstructor cast for graphology NodeNext ESM | 2026-02-28 | cast via AbstractGraph as type annotation — avoids "Cannot use namespace as a type" in strict NodeNext mode |
| BondGraph class (not interface) for behavioral invariants | 2026-02-28 | Covalent cascade invalidate + hydrogen distance threshold + VdW trajectory minimum enforced at creation time, not as runtime metadata |
| Mulberry32 PRNG seeded via rng option (Louvain determinism) | 2026-02-28 | graphology-communities-louvain natively supports rng parameter; Mulberry32(seed) passed as rng — no Math.random patching needed |
| createRequire CJS interop for graphology-metrics + louvain | 2026-02-28 | graphology-metrics has no package.json exports (NodeNext subpath fails); louvain.detailed() needs CJS require to expose attached methods; createRequire(import.meta.url) is the established pattern |
| S(K_n) = ln(n-1) for normalized Laplacian density matrix | 2026-02-28 | rho = L_norm/trace(L_norm) gives eigenvalues [0, 1/(n-1) x (n-1 times)]; S = ln(n-1). ROADMAP stated ln(n) but math gives ln(n-1); RESEARCH.md §Pattern 1 acknowledged discrepancy. Tests corrected to ln(n-1). |
| SOCInputs uses plain types (not TNA class instances) | 2026-02-28 | ReadonlyMap<string, Float64Array> and ReadonlyArray for edges — zero compile-time SOC-to-TNA dependency; enables synthetic testing |
| SOCEvent / SOCEventType separate from SheafEventType | 2026-02-28 | SOC events (soc:metrics, phase:transition) have their own discriminated union; not merged into SheafEventType |

## Resolved Questions

| Question | Resolution | Date |
|----------|------------|------|
| ADMM restriction map interface compatibility | Resolved: getCoboundaryMatrix, getSheafLaplacian, getVertexOffset, getEdgeOffset, getEdgeDim, getEdgeRestrictions all public on CellularSheaf | 2026-02-27 |
| threeCycleInconsistentSheaf h1 value | Resolved: h1=0 (rank(B)=3, full row rank). Research doc claimed rank=2 incorrectly. T7 uses flat 1D triangle instead (rank=2, h1=1). | 2026-02-27 |

## Open Questions

These must be resolved before the relevant phase starts:

| Question | Needed By | Notes |
|----------|-----------|-------|
| Embedding model selection: same or different for SOC/TNA | Before Phase 4 starts | `all-MiniLM-L6-v2` (384-dim) for SOC entropy probes vs. `text-embedding-3-small` (1536-dim) for TNA semantic similarity; schema conflicts if mixed |
| Surprising edge threshold calibration (`δ_surprising`) | Before Phase 4 SOC-04 | Not specified in paper beyond 12% target; empirical calibration against known corpus needed |
| LangGraph StateGraph vs. Network topology | Before Phase 5 starts | Supervisor (coordinator-worker for Sheaf rounds) vs. Network (peer-to-peer for Van der Waals agents); may be both depending on operating mode |
| Three-mode state machine transition conditions | Before Phase 5 starts | Exact conditions for NORMAL → OBSTRUCTED, and whether CRITICAL is re-entrant or terminal |

## Pitfall Watch

High-priority pitfalls to catch early. See `.planning/research/PITFALLS.md` for full treatment.

| Pitfall | Phase | Warning Sign | Status |
|---------|-------|--------------|--------|
| Sheaf Laplacian = standard graph Laplacian | 1 | Consensus converges in 1-2 steps regardless of initial disagreement | **RESOLVED: T5b discrimination test guards this permanently** |
| Flat sheaf (H^1 always zero) | 1 | Obstruction code path never triggers in any test | **RESOLVED: T7 (h1=1) and T7c (h1=2) guard this permanently** |
| H^1 wrong numerical tolerance | 1 | Tolerance set to 1e-6+ without documented justification | **RESOLVED: MATLAB formula + NumericalTolerance.test.ts validates calibration** |
| LCM store is mutable | 2 | Test isolation requires clearing store between tests | **RESOLVED: T1b (TypeError on mutation) + T6 (frozen getAll snapshot) guard permanently** |
| Embedding cold start in tests | 2 | ONNX model loading occurs during test suite | **RESOLVED: MockEmbedder injected everywhere; T11c source-level guard in LCMGrep.ts** |
| Escalation L3 missing | 2 | Context management has no hard truncation path | **RESOLVED: T9 (L3 activation) + T9b (zero LLM) + T9c (chunking) + T9d (kToken bound) + T9f (hard fallback) guard permanently** |
| 4-gram window without lemmatization | 3 | Node count grows proportionally to total word count | **RESOLVED: T6b (80 tokens → ≤2 nodes) guards permanently** |
| Bond types as metadata only | 3 | Bond invariants checked at runtime rather than type-system level | **RESOLVED: BondGraph class enforces invariants at creation time; creation throws on violation** |
| Non-deterministic Louvain (Pitfall 5) | 3 | Different runs produce different community assignments for same graph | **RESOLVED: T9 (10 runs same seed = identical) guards permanently; Mulberry32 PRNG via rng option** |
| Von Neumann entropy from adjacency matrix | 4 | Entropy exceeds `ln(n)`; entropy barely changes as graph grows | **RESOLVED: T-VN-01..05 guard S(K_n)=ln(n-1) for normalized Laplacian density matrix; T-VN-05 confirms entropy <= ln(n)** |
| Embedding entropy = token Shannon entropy | 4 | Semantic entropy tracks node count linearly; CDP always positive | **RESOLVED: T-EE-01 (identical→0) + T-EE-02 (orthogonal→ln(d)) guard permanently** |
| Phase transition hard-coded to iteration 400 | 4 | Literal `400` appears in production code path | Not started (Wave 2) |
| Surprising edge ratio cumulative | 4 | Ratio is stable at exactly 12% from iteration 1 | Not started (Wave 2) |

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files | Date |
|-------|------|----------|-------|-------|------|
| 01 | 02 | ~5 min | 8/8 | 11 created | 2026-02-27 |
| 01 | 03 | ~7 min | 7/7 | 6 created, 1 modified | 2026-02-27 |
| 01 | 04 | ~15 min | 7/7 | 5 created | 2026-02-27 |
| 02 | 03 | ~6 min | 2/2 | 6 created, 1 modified | 2026-02-28 |
| 02 | 04 | ~5 min | 2/2 | 5 created, 1 modified | 2026-02-28 |
| 02 | 05 | ~6 min | 3/3 | 6 created | 2026-02-28 |
| 03 | 01 | ~20 min | 2/2 | 7 created, 2 modified | 2026-02-28 |
| 03 | 02 | ~8 min | 2/2 | 4 created, 1 modified | 2026-02-28 |
| 03 | 03 | ~8 min | 2/2 | 4 created | 2026-03-01 |
| 04 | 01 | ~7 min | 2/2 | 3 created, 1 modified | 2026-02-28 |
| Phase 04 P01 | 7min | 2 tasks | 4 files |

## File Map

```
.planning/
├── PROJECT.md          — Project overview, goals, constraints, key decisions
├── REQUIREMENTS.md     — 25 v1 requirements with IDs and traceability table
├── ROADMAP.md          — Phase breakdown, requirement mappings, success criteria
├── STATE.md            — This file: current project memory
├── config.json         — Planning configuration
├── research/
│   ├── SUMMARY.md      — Executive research summary, stack, features, pitfalls overview
│   ├── ARCHITECTURE.md — Component structure, data flow, build order, anti-patterns
│   ├── FEATURES.md     — Full feature dependency graph and P1/P2/P3 prioritization
│   ├── PITFALLS.md     — Full pitfall treatment with warning signs and recovery costs
│   └── STACK.md        — Version table and alternatives considered
└── phases/
    ├── 01-sheaf/
    │   ├── 01-RESEARCH.md  — Sheaf theory research and implementation spec
    │   ├── 02-PLAN.md      — Wave 1: Foundation (DONE)
    │   ├── 02-SUMMARY.md   — Wave 1 execution summary
    │   ├── 03-PLAN.md      — Wave 2: Laplacian and Coboundary (DONE)
    │   ├── 03-SUMMARY.md   — Wave 2 execution summary
    │   ├── 04-PLAN.md      — Wave 3: Cohomology and CohomologyAnalyzer (DONE)
    │   ├── 04-SUMMARY.md   — Wave 3 execution summary
    │   └── VERIFICATION.md — Phase 1 complete verification record
    ├── 02-lcm/
    │   ├── 02-RESEARCH.md    — LCM dual-memory architecture research
    │   ├── 02-03-PLAN.md     — Wave 1: ImmutableStore + LCM interfaces (DONE)
    │   ├── 02-03-SUMMARY.md  — Wave 1 execution summary
    │   ├── 02-04-PLAN.md     — Wave 2: ContextDAG + EmbeddingCache + LCMGrep (DONE)
    │   ├── 02-04-SUMMARY.md  — Wave 2 execution summary
    │   ├── 02-05-PLAN.md     — Wave 3: EscalationProtocol + lcm_expand + barrel (DONE)
    │   └── 02-05-SUMMARY.md  — Wave 3 execution summary
    └── 03-tna-molecular-cot/
        ├── 03-01-PLAN.md     — Wave 1: TNA types + MolecularCoT + Preprocessor + CooccurrenceGraph (DONE)
        ├── 03-01-SUMMARY.md  — Wave 1 execution summary
        ├── 03-02-PLAN.md     — Wave 2: LouvainDetector + CentralityAnalyzer (DONE)
        ├── 03-02-SUMMARY.md  — Wave 2 execution summary
        ├── 03-03-PLAN.md     — Wave 3: GapDetector + TNA barrel export (DONE)
        └── 03-03-SUMMARY.md  — Wave 3 execution summary

src/
├── index.ts            — Placeholder entry point
├── vendor-types.d.ts   — TypeScript declarations for wink-lemmatizer and stopword (no @types/* available)
├── types/
│   ├── GraphTypes.ts   — VertexId, EdgeId, StalkSpace, RestrictionMap, SheafVertex, SheafEdge, CohomologyResult, SheafEigenspectrum
│   ├── Events.ts       — SheafEventType, SheafConsensusReachedEvent, SheafH1ObstructionEvent, SheafEvent
│   ├── MolecularCoT.ts — StepId, BondType, CovalentBond, HydrogenBond, VanDerWaalsBond, MolecularBond; BondGraph class with behavioral invariants
│   └── index.ts        — Barrel export (includes MolecularCoT)
├── sheaf/
│   ├── CellularSheaf.ts           — Core sheaf data structure + Laplacian delegate methods
│   ├── CellularSheaf.test.ts      — 24 unit tests (T1, T2, T10-partial, factory smoke tests)
│   ├── CoboundaryOperator.ts      — buildCoboundaryMatrix(sheaf) → N_1 x N_0 matrix
│   ├── CoboundaryOperator.test.ts — 13 tests (T3, T3b, T3c pitfall gate, T3d)
│   ├── SheafLaplacian.ts          — SheafLaplacian class (getCoboundaryMatrix, getSheafLaplacian, getEigenspectrum)
│   ├── SheafLaplacian.test.ts     — 21 tests (T4, T5, T5b, T6, T6b)
│   ├── ADMMSolver.ts              — ADMMSolver class (Phase 1: gradient descent stub)
│   ├── ADMMInterface.test.ts      — 21 tests (T10, T10b, T10c)
│   ├── CohomologyAnalyzer.ts      — computeCohomology() (SVD via ml-matrix) + CohomologyAnalyzer (EventEmitter)
│   ├── CohomologyAnalyzer.test.ts — 17 tests (T7, T7b, T7c, T7d dual gate, T8, T8b, T8c)
│   ├── NumericalTolerance.test.ts — 10 tests (tolerance calibration and sensitivity)
│   ├── isolation.test.ts          — 3 tests (T9: zero cross-module imports)
│   ├── index.ts                   — Public barrel export for the sheaf module
│   └── helpers/
│       ├── flatSheafFactory.ts          — Identity-restriction sheaves (path/triangle/complete)
│       └── threeCycleFactory.ts         — Non-flat sheaf: L_sheaf != L_graph tensor I_d (used in T5b)
└── lcm/
    ├── interfaces.ts              — LCMEntry, EMBEDDING_DIM, EscalationThresholds, EscalationLevel, ExpandLevel, SummaryNode, MetricUpdate; IEmbedder, ICompressor, ITokenCounter; GptTokenCounter, MockEmbedder, MockCompressor
    ├── ImmutableStore.ts          — Append-only store: uuidv7() IDs, SHA-256 hash, Object.freeze, frozen ReadonlyArray, private #entries + #idIndex
    ├── ImmutableStore.test.ts     — 14 tests: T1 freeze, T1b TypeError, T2-T2b UUID, T3-T3b hash, T4-T4b tokenCount, T5 sequenceNumber, T6-T6c ReadonlyArray+get, T7 getRange, T1d LCMClient wiring
    ├── LCMClient.ts               — Thin coordinator: append() wires ImmutableStore + EmbeddingCache at append time
    ├── EmbeddingCache.ts          — Hybrid cache: cacheEntry() precompute, getEmbedding() O(1), refreshEntry() force-refresh, has()
    ├── SummaryIndex.ts            — Mutable-but-tracked SummaryNode storage; content frozen via Object.defineProperties; MetricUpdate audit trail
    ├── ContextDAG.ts              — DAG: addSummaryNode() with DFS cycle detection, getEntry()/getSummaryNode() delegation, getEntriesForSummary(), getParentSummary()
    ├── ContextDAG.test.ts         — 10 tests: T5-T5e (SummaryIndex) + T6-T6e (ContextDAG)
    ├── LCMGrep.ts                 — Semantic search: grep() cosine similarity, GrepResult/GrepOptions, cosineSimilarity() pure fn, cacheAllEntries()
    ├── LCMGrep.test.ts            — 7 tests: T10-T10d (grep results) + T11-T11c (caching + no-transformers guard)
    ├── EscalationProtocol.ts      — Three-level escalation: L1 (compressor), L2 (multi-chunk), L3 (deterministic only); EventEmitter; setThresholds()
    ├── EscalationProtocol.test.ts — 13 tests: T7-T9h including L3 pitfall guards and EventEmitter events
    ├── LCMExpand.ts               — async function* lcm_expand(summaryNodeId, dag) → ExpandLevel items (lazy)
    ├── LCMExpand.test.ts          — 7 tests: T12-T13c including T12d pointer fidelity and T13 laziness
    ├── isolation.test.ts          — 2 tests: T14 (zero cross-module imports) + T14b (no @huggingface/transformers)
    ├── index.ts                   — Public barrel export for entire LCM module
    └── helpers/
        └── testStoreFactory.ts    — createPopulatedStore(entries[]), createDefaultPopulatedStore() with 10 varied entries
└── tna/
    ├── interfaces.ts              — TextNodeId, TextNode, TextEdge, GapMetrics, CommunityAssignment, TNAConfig, PreprocessResult, DetailedPreprocessResult
    ├── Preprocessor.ts            — Preprocessor class: lemmatize() (wink POS-aware), preprocess(), preprocessDetailed(), addDocument(), preprocessWithCorpus()
    ├── Preprocessor.test.ts       — 11 tests: T1-T4 lemmatization/stopwords/TF-IDF/case, lemmatize() direct
    ├── CooccurrenceGraph.ts       — CooccurrenceGraph class: ingest(), ingestTokens(), getGraph(), getNode(), getNodes(), getEdgeWeight(), updateNodeCentrality(), updateNodeCommunity(), order, size
    ├── CooccurrenceGraph.test.ts  — 11 tests: T5-T8b including T6b PRIMARY pitfall guard
    ├── LouvainDetector.ts         — Louvain community detection: detect(seed?), getAssignment(), getCommunityMembers(), getCommunityCount(), getModularity()
    ├── LouvainDetector.test.ts    — 8 tests: T9 (determinism 10-run), T9b, T10/T10b (two-clique 2 communities), T11/T11b (complete graph 1 community), T12/T12b
    ├── CentralityAnalyzer.ts      — Betweenness centrality: compute(), getScore(), getTopNodes(n), getBridgeNodes(threshold)
    ├── CentralityAnalyzer.test.ts — 8 tests: T13 (bridge highest), T13b (peripheral low), T14/T14b (normalized [0,1]), T15/T15b (metadata writeback + top-N)
    ├── GapDetector.ts             — Structural gap detection: findGaps(), findNearestGap(), getGapCount(), getGapBetween(communityA, communityB); metrics: density, shortest-path, modularity-delta, bridge-nodes
    ├── GapDetector.test.ts        — 9 tests: T16 (zero gaps fully connected), T16b (one gap bridge), T17-T17c (metrics), T18-T18b (bridge nodes + 3-cluster), T19-T19b (nearest + idempotence)
    ├── isolation.test.ts          — 3 tests: T20 (zero cross-module imports), T20b (no test-file imports), T21 (synthetic input only)
    └── index.ts                   — Public barrel export: Preprocessor, CooccurrenceGraph, LouvainDetector, CentralityAnalyzer, GapDetector + all types
└── soc/
    ├── interfaces.ts              — SOCInputs, SOCMetrics, SOCConfig, MetricsTrend (plain types; zero cross-module imports)
    ├── entropy.ts                 — vonNeumannEntropy() (mathjs eigs on L_norm density matrix), embeddingEntropy() (ml-matrix EigenvalueDecomposition on covariance), cosineSimilarity()
    └── entropy.test.ts            — 11 tests: T-VN-01..05 (K_n correctness, path < K_n, degenerate=0, upper-bound), T-EE-01..05 (identical→0, orthogonal→ln(d), degenerate cases)
```

---
*State initialized: 2026-02-27*
*Last session: 2026-02-28 — Completed Phase 4, Plan 04-01-PLAN.md (Wave 1: SOC types + entropy pure functions — SOC-01, SOC-02 mathematical correctness permanently guarded by 11 tests)*
*Update this file at the start and end of each work session*
