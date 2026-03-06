# Project State

**Project:** RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)
**Last updated:** 2026-03-06
**Current phase:** Phase 6 (P2 Enhancements) — IN PROGRESS (Plan 03/04 done: CatalystQuestionGenerator + CentralityAnalyzer time-series + 532 tests)

## Status Snapshot

| Phase | Name | Status | Requirements | Success Criteria Met |
|-------|------|--------|--------------|----------------------|
| 1 | Sheaf-Theoretic Coordination | **COMPLETE** | SHEAF-01 through SHEAF-06 | **5 / 5** |
| 2 | LCM Dual-Memory Architecture | **COMPLETE** | LCM-01 through LCM-05 | **5 / 5** |
| 3 | Text Network Analysis + Molecular-CoT | **COMPLETE** (Plan 03/03 done: GapDetector + barrel export) | TNA-01 through TNA-06, ORCH-03 | **6 / 6** (TNA-01–06 + ORCH-03 all satisfied) |
| 4 | Self-Organized Criticality Tracking | **COMPLETE** (Plan 02/02 done: SOCTracker + isolation + barrel) | SOC-01 through SOC-05 | **5 / 5** |
| 5 | Orchestrator Integration | **COMPLETE** (Plan 03/03 done: Composition root + ObstructionHandler + isolation test + 131 orchestrator tests) | ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05 | **5 / 5** (all ROADMAP criteria satisfied) |
| 6 | P2 Enhancements | IN PROGRESS (Plan 03/04 done) | ORCH-06 + v2 requirements | Plan 06-01: RegimeValidator+RegimeAnalyzer done; Plan 06-02: VdWAgentSpawner done; Plan 06-03: CatalystQuestionGenerator+CentralityAnalyzer time-series done |

**Overall v1 requirements:** 25 / 25 implemented (SHEAF-01–06 complete; LCM-01–05 complete; TNA-01–06 + ORCH-03 satisfied; SOC-01–05 all permanently guarded; ORCH-01–05 all complete — Phase 5 DONE with 370 total tests passing; Phase 6 extending with ORCH-06 + SOC-06/07 + TNA-07 + TNA-09, 532 total tests passing)

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
- **Phase 4, Wave 2, Plan 02 complete (2026-03-01):** SOCTracker class extending EventEmitter with CDP computation, per-iteration surprising edge ratio (both cross-community AND low-similarity required, Pitfall 3 guard), rolling Pearson correlation sign-change phase transition detection (configurable window, no hard-coded constants). pearsonCorrelation() and linearSlope() pure utilities. 19 new tests (239 total passing): T-CDP-01/02, T-SE-01..05, T-PT-01/02/04, T-EV-01..05 + T-ISO-01..04. SOC barrel export (src/soc/index.ts). PHASE 4 COMPLETE: SOC-01 through SOC-05 all permanently guarded. Pitfalls RESOLVED: "phase transition hard-coded to 400" (T-ISO-03 + T-PT-01) + "surprising edge ratio cumulative" (T-SE-05).
  - See `.planning/phases/04-soc/04-02-SUMMARY.md` for full details.
- **Phase 5, Wave 1, Plan 01 complete (2026-03-01):** Orchestrator foundation: interfaces.ts (Agent, PoolConfig, Task<T>, TaskResult<T>, AnyEvent, EventSubscriber). EventBus standalone class (Promise.all parallel dispatch, case-sensitive routing, async/sync handler support). AgentPool (Promise.race per-agent heartbeat timeouts — Pitfall 4 guard, idempotent shutdown). OrchestratorStateManager (NORMAL/OBSTRUCTED/CRITICAL state machine driven by H^1 dimension, configurable thresholds, StateChangeEvent emission via EventBus). 36 new tests (275 total passing). Rule 1 auto-fix: EventBus changed from extends EventEmitter to standalone class (emit() signature incompatible with EventEmitter base — TS2416). ORCH-01 and ORCH-04 foundation primitives established.
  - See `.planning/phases/05-orchestrator/05-01-SUMMARY.md` for full details.
- **Phase 5, Wave 2, Plan 02 complete (2026-03-01):** llm_map primitive (ORCH-02): round-robin dispatch to worker pool, AsyncLocalStorage contextStorage for context propagation (serialized as plain object via postMessage), ORDER PRESERVATION via sort-by-original-index (Pitfall 5 guard). TaskWorker.ts ESM worker entry point with worker-local contextStorage, stub executor (shouldFail/value/prompt), full error sandboxing. TaskWorker.mock.mjs pure JavaScript mock worker for vitest isolation (avoids tsx ESM cross-thread resolution). 33 new tests (308 total passing): T1-T15 covering dispatch, T2 ORDER PRESERVATION guard, T4 partial failures, T5 context propagation, T10 worker cleanup. Rule 1 auto-fixes: TaskWorker uses worker-local AsyncLocalStorage (not cross-thread import); mixed-payload test arrays typed as Task<unknown>[]. ORCH-02 primitive established.
  - See `.planning/phases/05-orchestrator/05-02-SUMMARY.md` for full details.
- **Phase 5, Wave 3, Plan 03 complete (2026-03-01):** Orchestrator composition root (ORCH-05): ComposeRootModule.ts wires all four AGEM modules (Sheaf, LCM, TNA, SOC) with shared IEmbedder dependency. EventBus wired to receive events from CohomologyAnalyzer (via .on() forwarding) and SOCTracker (same pattern). runReasoning() executes full TNA→Sheaf→SOC pipeline per iteration with LCM append and Louvain detection. ObstructionHandler implements ROADMAP criteria #3: H^1 obstruction → FIFO queue → GapDetectorAgent spawn → findGaps() → ingestTokens() → orch:obstruction-filled event. Isolation test confirms zero cross-imports between sheaf/lcm/tna/soc (via from-clause regex extraction). Barrel export complete. 62 new tests (370 total passing): 37 ComposeRootModule integration, 18 ObstructionHandler, 7 isolation. Rule 1 auto-fixes: ImmutableStore requires ITokenCounter; CellularSheaf requires (vertices, edges); Preprocessor.process() → preprocess(); multiline import regex fix in isolation test. PHASE 5 COMPLETE: all 5 ROADMAP criteria + ORCH-01–05 satisfied.
  - See `.planning/phases/05-orchestrator/05-03-SUMMARY.md` for full details.
- **Phase 6, Plan 01 complete (2026-03-06):** RegimeValidator (SOC-06) and RegimeAnalyzer (SOC-07) implemented. SOCTracker extended with updateH1Dimension(), updateCdp(), getRegimeMetrics() and integration with RegimeValidator+RegimeAnalyzer. New event types: phase:transition-confirmed, regime:classification. RegimeValidator validates transitions via persistence+coherence+H^1 gating. RegimeAnalyzer classifies system into nascent/stable/critical/transitioning using CDP variance and correlation consistency. 44 new tests (414 total). SOC-06 and SOC-07 SATISFIED.
  - See `.planning/phases/06-p2-enhancements/06-01-SUMMARY.md` for full details.
- **Phase 6, Plan 02 complete (2026-03-06):** VdWAgentSpawner (ORCH-06) implemented. VdWAgent ephemeral reasoning agent with bounded lifecycle (spawning→active→terminated), synthetic bridging queries, self-termination at maxIterations. VdWAgentSpawner with regime-gated H^1-parameterized spawning: 2-iteration hysteresis, stable suppresses/nascent limits/transitioning-critical enables, inverse token budget max(500,5000/h1), 10-agent cap, 3-iteration cooldown per gap. Integrated into ObstructionHandler (optional injection) and ComposeRootModule (event wiring). New events: orch:vdw-agent-spawned, orch:vdw-agent-complete. 57 new tests (471 total passing): 42 unit + 6 integration + 9 additional. ORCH-06 SATISFIED.
  - See `.planning/phases/06-p2-enhancements/06-02-SUMMARY.md` for full details.
- **Phase 6, Plan 03 complete (2026-03-06):** CatalystQuestionGenerator (TNA-07) and CentralityAnalyzer time-series (TNA-09) implemented. CatalystQuestionGenerator generates 1-3 template-based catalyst questions per structural gap using top-centrality representative nodes from each community; TF-IDF proxy for semantic distance; gapId cache with invalidation; batch generation. CentralityAnalyzer extended with EventEmitter, time-series tracking (50 entries/node), trend detection (rising/falling/stable/oscillating from 3+ points), peak/valley identification, rapid change events (3x multiplier), topology reorganization events (>3 major rank changes), regime-adaptive intervals (5/10/20). New event types: tna:catalyst-questions-generated, tna:centrality-change-detected, tna:topology-reorganized. TNAEvent added to AnyEvent. Orchestrator wires CentralityAnalyzer events to EventBus; computeIfDue() called each iteration. 61 new tests (532 total passing). TNA-07 and TNA-09 SATISFIED.
  - See `.planning/phases/06-p2-enhancements/06-03-SUMMARY.md` for full details.

## What Is Next

**Phase 6 IN PROGRESS — Plan 03/04 done, 532 total tests passing.** Phase 6 plans remaining:

1. ~~Phase 6 Plan 01: RegimeValidator + RegimeAnalyzer (SOC-06/07) — regime classification events~~ DONE
2. ~~Phase 6 Plan 02: VdWAgentSpawner (ORCH-06) — regime-gated H^1-parameterized agent spawning~~ DONE
3. ~~Phase 6 Plan 03: TNA-07 Catalyst Question Generation + TNA-09 Centrality time-series~~ DONE
4. Phase 6 Plan 04: Dynamic sheaf topology construction from TNA community structure

**Phase 6 VdW entry point:** VdW agents receive regime:classification → VdWAgentSpawner.evaluateAndSpawn() → VdWAgent.executeStep() → orch:vdw-agent-complete events

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
| SOCTracker phase transition noise filter |r|>0.1 | 2026-03-01 | Sign change on near-zero correlations (e.g., 0.001→-0.001) is false positive; both |prevR| and |currR| must exceed 0.1 threshold |
| previousCorrelation only updated when r !== 0 | 2026-03-01 | Avoids overwriting meaningful correlation with 0 (insufficient data) during window warmup period |
| T-PT-01 uses blended embeddings for independent VNE/EE control | 2026-03-01 | v[0]=sqrt(1-t) (shared) + v[k]=sqrt(t) (unique), normalized; path-graph length controls VNE independently; verified sign change fires at iter 9 (r: +0.906 to -0.664) |
| EventBus is standalone class (not extends EventEmitter) | 2026-03-01 | emit() signature incompatible with EventEmitter base (TS2416); composition used instead — private #emitter field held for future Node.js integration |
| CRITICAL → NORMAL (not CRITICAL → OBSTRUCTED) | 2026-03-01 | When H^1 drops below obs threshold from CRITICAL, state returns to NORMAL directly; OBSTRUCTED is only entered from NORMAL going up |
| AgentPool heartbeat skips terminated agents | 2026-03-01 | #runHeartbeat filters agents by status !== 'terminated' before issuing heartbeat; avoids calling heartbeat() on dead agents |
| TaskWorker uses worker-local AsyncLocalStorage | 2026-03-01 | Worker threads have separate module graphs; cross-thread AsyncLocalStorage sharing is impossible; workers restore context from postMessage plain object using their own local AsyncLocalStorage instance |
| TaskWorker.mock.mjs is pure JavaScript (.mjs) | 2026-03-01 | tsx/esm loader does not resolve .js→.ts for imports inside worker threads spawned from vitest; pure JS mock avoids compilation dependency in tests |
| effectivePoolSize clamped to [1, tasks.length] | 2026-03-01 | No excess workers spawned for small task batches; prevents unnecessary thread overhead when poolSize > task count |
| buildFlatSheaf(2, 1) as Phase 5 test sheaf | 2026-03-01 | 2-vertex path sheaf with 1-dim identity restrictions: H^0=1, H^1=0 (consensus fires every iteration); in Phase 6 sheaf topology would be dynamically constructed from TNA graph |
| GptTokenCounter injected into ImmutableStore | 2026-03-01 | ImmutableStore(tokenCounter) requires ITokenCounter arg — plan pseudocode showed no-arg constructor; fixed by injecting GptTokenCounter in Orchestrator |
| Isolation test uses from-clause regex extraction | 2026-03-01 | `\bfrom\s+['"]([^'"]+)['"]` handles TypeScript multiline import blocks; segment equality check (`path.split('/').some(seg => seg === module)`) correctly matches all relative path styles |
| ObstructionHandler stores subscription callback as class field | 2026-03-01 | `#obstructionHandler` field stores the arrow function reference for EventBus.unsubscribe() in shutdown() — required since unsubscribe uses reference equality |
| RegimeAnalyzer persistence gate applies only in initial nascent state | 2026-03-06 | persistence < persistenceThreshold returns 'nascent' ONLY while #currentRegime === 'nascent'; prevents oscillation bug where every regime change reset persistence to 1, causing system to never graduate from nascent |
| H^1 coupling via updateH1Dimension() (no sheaf import in SOC) | 2026-03-06 | SOCTracker.updateH1Dimension(h1Dim) receives H^1 from orchestrator; SOC module never imports sheaf; maintains strict module isolation invariant |
| Phase 6 regime events are additive (not replacements) | 2026-03-06 | 'phase:transition-confirmed' and 'regime:classification' emit alongside existing 'phase:transition' and 'soc:metrics'; zero backward-compatibility breaks |
| VdWAgentSpawner receives regime as string (not RegimeStability import) | 2026-03-06 | VdWAgentSpawner.updateRegime(regime: string) receives regime as plain string — never imports from soc/; maintains module isolation (at-most-1-module rule) |
| AnyEvent union extended to include OrchestratorEvent | 2026-03-06 | AnyEvent = SheafEvent | SOCEvent | OrchestratorEvent in interfaces.ts; enables VdW events to flow through EventBus type system |
| VdW agents serialized in runAgents() (not parallel) | 2026-03-06 | runAgents() processes agents one at a time to avoid graph mutation races when integrating entity results into TNA graph |
| Token budget inverse scaling: max(500, 5000/h1Dimension) | 2026-03-06 | Higher obstruction → more exploratory agents → smaller budget each; H^1=2→2500, H^1=10→500, capped at 500 minimum |
| Phase 6 TNA-07 semantic distance = TF-IDF weight proxy | 2026-03-06 | Deterministic, no LLM required; Phase 7 replaces with 1 - cosine_similarity(centroid_A_embedding, centroid_B_embedding) |
| computeIfDue() gates O(n^3) betweenness centrality | 2026-03-06 | Regime-adaptive intervals: critical/transitioning=5, default=10, stable=20; direct compute() still available for tests |
| CatalystQuestionGenerator gapId format: communityA_communityB | 2026-03-06 | Consistent with VdWAgentSpawner gap tracking; cache invalidation uses same key; batch map keyed by gapId |
| CentralityTimeSeries capped at 50 entries per node | 2026-03-06 | Circular buffer via splice(); prevents unbounded memory growth; sufficient for trend/peak/valley detection |
| Rapid change multiplier 3x (rapidChangeMultiplier default) | 2026-03-06 | Calibrated to avoid noise from minor graph updates; configurable for regime-specific tuning |

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
| Phase transition hard-coded to iteration 400 | 4 | Literal `400` appears in production code path | **RESOLVED: T-ISO-03 (no literal 400) + T-PT-01 (dynamic sign change) guard permanently** |
| Surprising edge ratio cumulative | 4 | Ratio is stable at exactly 12% from iteration 1 | **RESOLVED: T-SE-05 (per-iteration isolation, Pitfall 3 guard) permanently enforced** |

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
| 04 | 02 | 9 min | 2/2 | 5 created | 2026-03-01 |
| Phase 04 P02 | 9 | 2 tasks | 5 files |
| 05 | 01 | ~7 min | 4/4 | 7 created | 2026-03-01 |
| 05 | 02 | 6 min | 2/2 | 4 created | 2026-03-01 |
| Phase 05 P02 | 6 | 2 tasks | 4 files |
| 05 | 03 | ~25 min | 3/3 | 6 created | 2026-03-01 |
| 06 | 01 | 9 min | 5/5 | 5 created, 2 modified | 2026-03-06 |
| 06 | 02 | 9 min | 5/5 | 2 created, 6 modified | 2026-03-06 |
| 06 | 03 | 11 min | 5/5 | 2 created, 7 modified | 2026-03-06 |
| Phase 06 P03 | 11 | 5 tasks | 9 files |

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
    ├── entropy.test.ts            — 11 tests: T-VN-01..05 (K_n correctness, path < K_n, degenerate=0, upper-bound), T-EE-01..05 (identical→0, orthogonal→ln(d), degenerate cases)
    ├── correlation.ts             — pearsonCorrelation() (standard Pearson r), linearSlope() (OLS direct formula)
    ├── SOCTracker.ts              — SOCTracker class extending EventEmitter: computeAndEmit(), getMetricsHistory(), getLatestMetrics(), getMetricsTrend(); emits soc:metrics and phase:transition
    ├── SOCTracker.test.ts         — 15 tests: T-CDP-01/02, T-SE-01..05, T-PT-01/02/04, T-EV-01..05
    ├── isolation.test.ts          — 4 tests: T-ISO-01 (zero cross-module imports), T-ISO-02 (no test imports), T-ISO-03 (no literal 400), T-ISO-04 (synthetic only)
    └── index.ts                   — Public barrel export: SOCTracker, vonNeumannEntropy, embeddingEntropy, cosineSimilarity, pearsonCorrelation, linearSlope + all types
└── orchestrator/
    ├── interfaces.ts              — Agent (5-stage lifecycle), PoolConfig, Task<T>, TaskResult<T>, AnyEvent = SheafEvent | SOCEvent | OrchestratorEvent, EventSubscriber type alias
    ├── EventBus.ts                — EventBus class: subscribe/emit/unsubscribe/getSubscriberCount; Promise.all parallel dispatch; #subscribers Map<string, EventSubscriber[]>
    ├── EventBus.test.ts           — 12 tests: T1-T10 (routing, parallel, unsubscribe, async, case-sensitive) + 2 additional
    ├── AgentPool.ts               — AgentPool class: initialize/shutdown (idempotent)/getAgents/getIdleAgents/getAgentCount; Promise.race per-agent heartbeat timeout
    ├── AgentPool.test.ts          — 12 tests: T1-T10 (spawn, idle, heartbeat interval, timeout, shutdown, lifecycle) + 2 additional
    ├── OrchestratorState.ts       — OrchestratorState enum (NORMAL/OBSTRUCTED/CRITICAL), StateChangeEvent, OrchestratorStateManager with updateMetrics(h1Dimension)
    ├── OrchestratorState.test.ts  — 12 tests: T1-T8 (state transitions, event payloads, thresholds, H1=0) + 4 additional
    ├── llm_map.ts                 — llm_map<T>() parallel dispatch, contextStorage AsyncLocalStorage, formatTaskForWorker(), WorkerInboundMessage/WorkerOutboundMessage types
    ├── llm_map.test.ts            — 33 tests: T1-T15 (dispatch, ORDER PRESERVATION guard, partial failures, context propagation, cleanup, round-robin, edge cases)
    ├── VdWAgentSpawner.ts         — VdWAgent (bounded lifecycle; spawning→active→terminated; maxIterations self-terminate) + VdWAgentSpawner (ORCH-06 regime-gated H^1-parameterized spawning)
    ├── VdWAgentSpawner.test.ts    — 42 unit tests: T1-T9 (VdWAgent), T10-T14 (H^1 hysteresis), T15-T19 (regime gating), T20-T24 (spawn count), T25-T28 (token budget), T29-T31 (cooldown), T32-T40 (events+cleanup)
    ├── ComposeRootModule.ts       — Orchestrator class: VdWAgentSpawner instantiated and injected into ObstructionHandler; regime:classification + H^1 event wiring added
    ├── ComposeRootModule.test.ts  — 37 integration tests: instantiation, event wiring, state transitions, 10-iteration loop (T6), LCM/TNA/SOC integration, edge cases
    ├── ObstructionHandler.ts      — H^1 → FIFO → GapDetectorAgent + Phase 6 VdW spawn pipeline; optional vdwSpawner injection; updateRegime()/updateH1ForSpawner() public methods
    ├── ObstructionHandler.test.ts — 24 tests: 18 original + 6 VdW integration tests (T-INT-1..T-INT-5 + backward compat)
    ├── isolation.test.ts          — 7 tests: T1-T4 per-module isolation (zero cross-imports sheaf/lcm/tna/soc), T5 only ComposeRootModule.ts has multi-module imports
    ├── index.ts                   — Barrel export: Orchestrator, ObstructionHandler, VdWAgentSpawner, VdWAgent, OrchestratorState, EventBus, AgentPool, llm_map + all types
    └── workers/
        ├── TaskWorker.ts          — ESM worker entry point: worker-local AsyncLocalStorage, stub executor (shouldFail/value/prompt), error sandboxing, parentPort guard
        └── TaskWorker.mock.mjs    — Pure JavaScript mock worker for tests: delay support, shouldFail injection, _context echo, workerMessageCount tracking
```

---
*State initialized: 2026-02-27*
*Last session: 2026-03-06 — Completed Phase 6, Plan 06-03 (TNA-07 CatalystQuestionGenerator + TNA-09 CentralityAnalyzer time-series + 61 new tests — 532 total passing, tsc --noEmit clean, all isolation tests pass)*
*Update this file at the start and end of each work session*
