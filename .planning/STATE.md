# Project State

**Project:** RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)
**Last updated:** 2026-02-27
**Current phase:** PHASE 1 COMPLETE — Ready for Phase 2 (LCM) or Phase 3 (TNA)

## Status Snapshot

| Phase | Name | Status | Requirements | Success Criteria Met |
|-------|------|--------|--------------|----------------------|
| 1 | Sheaf-Theoretic Coordination | **COMPLETE** | SHEAF-01 through SHEAF-06 | **5 / 5** |
| 2 | LCM Dual-Memory Architecture | Unblocked (types ready since Wave 1) | LCM-01 through LCM-05 | 0 / 5 |
| 3 | Text Network Analysis + Molecular-CoT | Unblocked (types ready) | TNA-01 through TNA-06, ORCH-03 | 0 / 5 |
| 4 | Self-Organized Criticality Tracking | Unblocked (Phase 1 complete, eigenspectrum ready) | SOC-01 through SOC-05 | 0 / 5 |
| 5 | Orchestrator Integration | Blocked (requires Phases 1, 3, 4) | ORCH-01, ORCH-02, ORCH-04, ORCH-05 | 0 / 5 |
| 6 | P2 Enhancements | Blocked (Phase 5 not done) | v2 requirements | — |

**Overall v1 requirements:** 6 / 25 implemented (SHEAF-01 through SHEAF-06 complete)

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

## What Is Next

**Phase 2 (LCM) and Phase 3 (TNA) can begin in parallel** — both unblocked.
**Phase 4 (SOC)** is now unblocked (SheafEigenspectrum ready for Von Neumann entropy).

Recommended order based on risk and dependency:
1. Phase 2 (LCM): dual-memory architecture, context management, L3 escalation
2. Phase 3 (TNA): text network analysis, Molecular-CoT, bond type invariants (ORCH-03)
3. Phase 4 (SOC): Von Neumann entropy, surprising edge detection (depends on eigenspectrum from Phase 1)
4. Phase 5 (Orchestrator): three-mode state machine, EventBus, event subscriptions (depends on 1, 3, 4)

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
| LCM store is mutable | 2 | Test isolation requires clearing store between tests | Not started |
| Escalation L3 missing | 2 | Context management has no hard truncation path | Not started |
| 4-gram window without lemmatization | 3 | Node count grows proportionally to total word count | Not started |
| Bond types as metadata only | 3 | Bond invariants checked at runtime rather than type-system level | Not started |
| Von Neumann entropy from adjacency matrix | 4 | Entropy exceeds `ln(n)`; entropy barely changes as graph grows | Not started |
| Embedding entropy = token Shannon entropy | 4 | Semantic entropy tracks node count linearly; CDP always positive | Not started |
| Phase transition hard-coded to iteration 400 | 4 | Literal `400` appears in production code path | Not started |
| Surprising edge ratio cumulative | 4 | Ratio is stable at exactly 12% from iteration 1 | Not started |

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files | Date |
|-------|------|----------|-------|-------|------|
| 01 | 02 | ~5 min | 8/8 | 11 created | 2026-02-27 |
| 01 | 03 | ~7 min | 7/7 | 6 created, 1 modified | 2026-02-27 |
| 01 | 04 | ~15 min | 7/7 | 5 created | 2026-02-27 |

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
    └── 01-sheaf/
        ├── 01-RESEARCH.md  — Sheaf theory research and implementation spec
        ├── 02-PLAN.md      — Wave 1: Foundation (DONE)
        ├── 02-SUMMARY.md   — Wave 1 execution summary
        ├── 03-PLAN.md      — Wave 2: Laplacian and Coboundary (DONE)
        ├── 03-SUMMARY.md   — Wave 2 execution summary
        ├── 04-PLAN.md      — Wave 3: Cohomology and CohomologyAnalyzer (DONE)
        ├── 04-SUMMARY.md   — Wave 3 execution summary
        └── VERIFICATION.md — Phase 1 complete verification record

src/
├── index.ts            — Placeholder entry point
├── types/
│   ├── GraphTypes.ts   — VertexId, EdgeId, StalkSpace, RestrictionMap, SheafVertex, SheafEdge, CohomologyResult, SheafEigenspectrum
│   ├── Events.ts       — SheafEventType, SheafConsensusReachedEvent, SheafH1ObstructionEvent, SheafEvent
│   └── index.ts        — Barrel export
└── sheaf/
    ├── CellularSheaf.ts           — Core sheaf data structure + Laplacian delegate methods
    ├── CellularSheaf.test.ts      — 24 unit tests (T1, T2, T10-partial, factory smoke tests)
    ├── CoboundaryOperator.ts      — buildCoboundaryMatrix(sheaf) → N_1 x N_0 matrix
    ├── CoboundaryOperator.test.ts — 13 tests (T3, T3b, T3c pitfall gate, T3d)
    ├── SheafLaplacian.ts          — SheafLaplacian class (getCoboundaryMatrix, getSheafLaplacian, getEigenspectrum)
    ├── SheafLaplacian.test.ts     — 21 tests (T4, T5, T5b, T6, T6b)
    ├── ADMMSolver.ts              — ADMMSolver class (Phase 1: gradient descent stub)
    ├── ADMMInterface.test.ts      — 21 tests (T10, T10b, T10c)
    ├── CohomologyAnalyzer.ts      — computeCohomology() (SVD via ml-matrix) + CohomologyAnalyzer (EventEmitter)
    ├── CohomologyAnalyzer.test.ts — 17 tests (T7, T7b, T7c, T7d dual gate, T8, T8b, T8c)
    ├── NumericalTolerance.test.ts — 10 tests (tolerance calibration and sensitivity)
    ├── isolation.test.ts          — 3 tests (T9: zero cross-module imports)
    ├── index.ts                   — Public barrel export for the sheaf module
    └── helpers/
        ├── flatSheafFactory.ts          — Identity-restriction sheaves (path/triangle/complete)
        └── threeCycleFactory.ts         — Non-flat sheaf: L_sheaf != L_graph tensor I_d (used in T5b)
```

---
*State initialized: 2026-02-27*
*Last session: 2026-02-27 — Stopped at: Completed Phase 1, Plan 04-PLAN.md (Wave 3: Cohomology Analysis) — PHASE 1 COMPLETE*
*Update this file at the start and end of each work session*
