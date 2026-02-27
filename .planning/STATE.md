# Project State

**Project:** RLM-LCM Molecular-CoT Group Evolving Agents (AGEM)
**Last updated:** 2026-02-27
**Current phase:** Pre-implementation (planning complete)

## Status Snapshot

| Phase | Name | Status | Requirements | Success Criteria Met |
|-------|------|--------|--------------|----------------------|
| 1 | Sheaf-Theoretic Coordination | Not started | SHEAF-01 through SHEAF-06 | 0 / 5 |
| 2 | LCM Dual-Memory Architecture | Not started | LCM-01 through LCM-05 | 0 / 5 |
| 3 | Text Network Analysis + Molecular-CoT | Not started | TNA-01 through TNA-06, ORCH-03 | 0 / 5 |
| 4 | Self-Organized Criticality Tracking | Not started | SOC-01 through SOC-05 | 0 / 5 |
| 5 | Orchestrator Integration | Not started | ORCH-01, ORCH-02, ORCH-04, ORCH-05 | 0 / 5 |
| 6 | P2 Enhancements | Blocked (Phase 5 not done) | v2 requirements | — |

**Overall v1 requirements:** 0 / 25 implemented

## What Has Been Done

- Project initialized (2026-02-27)
- Research completed: stack, architecture, features, pitfalls (2026-02-27)
- All 25 v1 requirements defined and assigned IDs (2026-02-27)
- Roadmap created with 6 phases, requirement mappings, and success criteria (2026-02-27)
- Traceability table in REQUIREMENTS.md updated with phase assignments (2026-02-27)

## What Is Next

**Start Phase 1 (Sheaf) and Phase 2 (LCM) in parallel** — both depend only on shared types:

1. Define `src/types/` — `ContextState`, `GraphTypes`, `Events`, `Agent` interfaces. Required before Phase 1 or Phase 2 work begins.
2. Begin `src/sheaf/` — `CellularSheaf`, `Stalk`, `RestrictionMap`, `SheafLaplacian`, `CohomologyAnalyzer`. Include both flat and non-flat test configurations from the first commit.
3. Begin `src/lcm/` — `ImmutableStore`, `ContextDAG`, `SummaryNode`, `EscalationProtocol`, `lcm_grep`, `lcm_expand`. Immutability enforcement first; L3 before LLM-calling paths.

## Active Decisions

| Decision | Date | Detail |
|----------|------|--------|
| TypeScript 5.9.3 + Node.js 22 LTS | 2026-02-27 | Strict null checks mandatory; worker_threads for llm_map |
| graphology 0.26.0 | 2026-02-27 | TNA semantic graph and Sheaf base space |
| mathjs 15.1.1 | 2026-02-27 | Sheaf Laplacian, eigenvalue decomposition, Von Neumann entropy |
| vitest 4.0.18 | 2026-02-27 | Native ESM test runner; --pool=forks for native module isolation |
| Phase 1 = Sheaf (not LCM) | 2026-02-27 | Highest mathematical failure risk; silent wrong results if done late |
| ORCH-03 in Phase 3 | 2026-02-27 | Bond type invariants must be in type system before reasoning loop code exists |
| No LLM inference in LCM primitives | 2026-02-27 | Determinism guarantee; retrieval path must be pure data operations |
| Zero cross-imports between core modules | 2026-02-27 | Only orchestrator imports from multiple modules; enforced by lint |

## Open Questions

These must be resolved before the relevant phase starts:

| Question | Needed By | Notes |
|----------|-----------|-------|
| ADMM restriction map interface compatibility | Before Phase 1 ends | Stalk dimension and restriction map choices in Phase 1 must be compatible with ADMM auxiliary variable structure; ADMM is P2 but the interface must be forward-compatible |
| Embedding model selection: same or different for SOC/TNA | Before Phase 4 starts | `all-MiniLM-L6-v2` (384-dim) for SOC entropy probes vs. `text-embedding-3-small` (1536-dim) for TNA semantic similarity; schema conflicts if mixed |
| Surprising edge threshold calibration (`δ_surprising`) | Before Phase 4 SOC-04 | Not specified in paper beyond 12% target; empirical calibration against known corpus needed |
| LangGraph StateGraph vs. Network topology | Before Phase 5 starts | Supervisor (coordinator-worker for Sheaf rounds) vs. Network (peer-to-peer for Van der Waals agents); may be both depending on operating mode |
| Three-mode state machine transition conditions | Before Phase 5 starts | Exact conditions for NORMAL → OBSTRUCTED, and whether CRITICAL is re-entrant or terminal |

## Pitfall Watch

High-priority pitfalls to catch early. See `.planning/research/PITFALLS.md` for full treatment.

| Pitfall | Phase | Warning Sign |
|---------|-------|--------------|
| Sheaf Laplacian = standard graph Laplacian | 1 | Consensus converges in 1-2 steps regardless of initial disagreement |
| Flat sheaf (H^1 always zero) | 1 | Obstruction code path never triggers in any test |
| H^1 wrong numerical tolerance | 1 | Tolerance set to 1e-6+ without documented justification |
| LCM store is mutable | 2 | Test isolation requires clearing store between tests |
| Escalation L3 missing | 2 | Context management has no hard truncation path |
| 4-gram window without lemmatization | 3 | Node count grows proportionally to total word count |
| Bond types as metadata only | 3 | Bond invariants checked at runtime rather than type-system level |
| Von Neumann entropy from adjacency matrix | 4 | Entropy exceeds `ln(n)`; entropy barely changes as graph grows |
| Embedding entropy = token Shannon entropy | 4 | Semantic entropy tracks node count linearly; CDP always positive |
| Phase transition hard-coded to iteration 400 | 4 | Literal `400` appears in production code path |
| Surprising edge ratio cumulative | 4 | Ratio is stable at exactly 12% from iteration 1 |

## File Map

```
.planning/
├── PROJECT.md          — Project overview, goals, constraints, key decisions
├── REQUIREMENTS.md     — 25 v1 requirements with IDs and traceability table
├── ROADMAP.md          — Phase breakdown, requirement mappings, success criteria
├── STATE.md            — This file: current project memory
├── config.json         — Planning configuration
└── research/
    ├── SUMMARY.md      — Executive research summary, stack, features, pitfalls overview
    ├── ARCHITECTURE.md — Component structure, data flow, build order, anti-patterns
    ├── FEATURES.md     — Full feature dependency graph and P1/P2/P3 prioritization
    ├── PITFALLS.md     — Full pitfall treatment with warning signs and recovery costs
    └── STACK.md        — Version table and alternatives considered
```

---
*State initialized: 2026-02-27*
*Update this file at the start and end of each work session*
