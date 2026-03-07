# Phase 6: P2 Enhancements — Planning & Verification Index

**Phase Status:** PLANS VERIFIED READY FOR EXECUTION

---

## Phase 6 Documents

### Research & Context

- **[06-RESEARCH.md](./06-RESEARCH.md)** — Complete research on all 6 Phase 6 features
  - SOC-06: Dynamic phase transition detector with regime persistence
  - SOC-07: Regime validation and stability metrics
  - ORCH-06: Obstruction-driven agent spawning (VdW)
  - TNA-07: Catalyst question generation for gaps
  - TNA-08: Force-Atlas layout for visualization
  - TNA-09: Betweenness centrality time-series tracking

### Implementation Plans

#### Wave 1 (Parallel or Sequential)

- **[06-01-PLAN.md](./06-01-PLAN.md)** — SOC Module Enhancements
  - Feature: SOC-06 (RegimeValidator) + SOC-07 (RegimeAnalyzer)
  - 5 tasks | 8 files | ~46 tests
  - Status: Ready for execution

- **[06-02-PLAN.md](./06-02-PLAN.md)** — Orchestrator VdW Agent Spawning
  - Feature: ORCH-06 (VdWAgentSpawner)
  - 5 tasks | 9 files | ~45 tests
  - Depends on: 06-01
  - Status: Ready for execution

#### Wave 2

- **[06-03-PLAN.md](./06-03-PLAN.md)** — TNA Semantic Analysis
  - Features: TNA-07 (CatalystQuestionGenerator) + TNA-09 (CentralityTimeSeries)
  - 5 tasks | 9 files | ~60 tests
  - Depends on: 06-01, 06-02
  - Status: Ready for execution

#### Wave 3

- **[06-04-PLAN.md](./06-04-PLAN.md)** — TNA Visualization Layout
  - Feature: TNA-08 (LayoutComputer with ForceAtlas2)
  - 6 tasks | 11 files | ~40 tests
  - Depends on: 06-03
  - Status: Ready for execution

### Verification & Sign-Off

- **[06-PLAN-VERIFICATION.md](./06-PLAN-VERIFICATION.md)** — VERIFICATION REPORT
  - All 10 validation gates: **PASS**
  - Detailed analysis of each plan against success criteria
  - Integration constraints verified
  - Module isolation confirmed
  - Test strategy validated
  - **Overall Status: VERIFIED READY FOR EXECUTION**

---

## Phase 6 Summary at a Glance

### Feature Coverage (6/6 Features)

| Feature | Plan | Component                     | Purpose                                                |
| ------- | ---- | ----------------------------- | ------------------------------------------------------ |
| SOC-06  | 01   | RegimeValidator               | Persistence validation for phase transitions           |
| SOC-07  | 01   | RegimeAnalyzer                | Four-state regime classification                       |
| ORCH-06 | 02   | VdWAgentSpawner               | Adaptive agent spawning driven by H^1 obstruction      |
| TNA-07  | 03   | CatalystQuestionGenerator     | Template-based question generation for structural gaps |
| TNA-09  | 03   | CentralityAnalyzer.timeSeries | Centrality trend detection and rapid change events     |
| TNA-08  | 04   | LayoutComputer                | Force-directed graph layout for visualization          |

### Execution Plan (6-8 Days)

```
Day 1-2:  Execute Plan 01 (SOC-06/SOC-07)
          └─ RegimeValidator, RegimeAnalyzer, ~46 tests

Day 2-3:  Execute Plan 02 (ORCH-06)
          └─ VdWAgentSpawner, VdWAgent, ~45 tests
          (After Plan 01 completes)

Day 4-5:  Execute Plan 03 (TNA-07/TNA-09)
          └─ CatalystQuestionGenerator, CentralityTimeSeries, ~60 tests
          (After Plans 01 & 02 complete)

Day 6-7:  Execute Plan 04 (TNA-08)
          └─ LayoutComputer, ForceAtlas2 integration, ~40 tests
          (After Plan 03 completes)

Day 8:    Final verification, sign-off
          └─ ~560+ total tests, all Phase 5 + Phase 6 features
```

### Success Metrics

After Phase 6 completion:

- ✅ **Test Suite:** ~560+ tests passing (Phase 5: 370 + Phase 6: 191)
- ✅ **Feature Completeness:** All 6 features fully implemented and integration-tested
- ✅ **Module Isolation:** Zero new cross-module import violations
- ✅ **Backward Compatibility:** All Phase 5 tests continue to pass
- ✅ **Must-Haves:** All user-observable behaviors confirmed working
- ✅ **Performance:** Regime detection within 1-3 iterations, layout converges in 100 iterations

---

## Key Architecture Patterns Used

### 1. Regime-Driven Decision Making (SOC-06/07 → ORCH-06 → TNA-09)

Cascade of regime events propagated through EventBus to affect spawning, layout computation, and centrality analysis frequency.

### 2. H^1 Coupling (Sheaf → SOC-06 → ORCH-06)

Sheaf H^1 obstruction magnitude directly parameterizes VdW agent spawn behavior (token budget, agent count).

### 3. Event Emission Pattern

All Phase 6 components extend EventEmitter and emit domain events through ComposeRootModule to EventBus (no direct cross-module dependencies).

### 4. Additive Extension (No Breaking Changes)

All Phase 6 features extend existing Phase 1-5 modules (SOCTracker, ObstructionHandler, CentralityAnalyzer) with optional new functionality. No API changes.

### 5. Template-Based Stubs (Phase 6 → Phase 7 Ready)

LLM-dependent features (TNA-07 catalyst questions, VdW agent reasoning) use template stubs in Phase 6, ready for real LLM integration in Phase 7.

---

## Key Files Created/Modified

### New Files (8)

- src/soc/RegimeValidator.ts
- src/soc/RegimeValidator.test.ts
- src/orchestrator/VdWAgentSpawner.ts
- src/orchestrator/VdWAgentSpawner.test.ts
- src/tna/CatalystQuestionGenerator.ts
- src/tna/CatalystQuestionGenerator.test.ts
- src/tna/LayoutComputer.ts
- src/tna/LayoutComputer.test.ts

### Extended Files (14)

- src/soc/SOCTracker.ts (regime integration)
- src/soc/interfaces.ts (new types)
- src/soc/index.ts (exports)
- src/orchestrator/ObstructionHandler.ts (VdW spawning)
- src/orchestrator/ComposeRootModule.ts (wiring)
- src/orchestrator/interfaces.ts (AnyEvent expansion)
- src/orchestrator/index.ts (exports)
- src/tna/CentralityAnalyzer.ts (time-series)
- src/tna/CooccurrenceGraph.ts (position storage)
- src/tna/interfaces.ts (new types)
- src/tna/index.ts (exports)
- src/types/Events.ts (new event types)
- package.json (graphology-layout-forceatlas2)
- src/vendor-types.d.ts (type declarations)

---

## Verification Report Summary

**Verification Date:** 2026-03-01  
**Verified Against:** 10 comprehensive validation gates  
**Overall Result:** ✅ VERIFIED READY FOR EXECUTION

All gates passed:

1. Plan Structure: Valid YAML, proper wave/dependency setup
2. Task Decomposition: 20 specific, actionable tasks
3. Dependency Correctness: Valid DAG, no cycles
4. Feature Coverage: All 6 features mapped to tasks
5. File List Accuracy: All new/modified files necessary
6. Test Strategy: ~191 tests planned, comprehensive coverage
7. Integration Constraints: Module isolation verified
8. Must-Haves Derivation: User-observable, testable truths
9. Wave Assignment: Proper execution precedence
10. Estimated Effort: 6-8 days, reasonable scope

**Minor Note:** Plan 02 wave/depends_on labeling is cosmetic (non-blocking).

---

## Phase Readiness Checklist

Before starting Phase 6 execution:

- [ ] Read 06-RESEARCH.md for context and feature rationale
- [ ] Review 06-PLAN-VERIFICATION.md for detailed validation
- [ ] Ensure all Phase 5 tests (370+) are passing
- [ ] Confirm development environment has:
  - Node.js with npm (for graphology-layout-forceatlas2)
  - TypeScript compiler (tsc --noEmit)
  - Test runner configured (npm test)
- [ ] Allocate 6-8 days for phase execution
- [ ] Have Phase 5 code base ready (master branch clean)

---

## Phase 6 Execution Order

Execute in this sequence to respect dependencies:

1. **06-01 (SOC-06/SOC-07)** — No prerequisites
   - Creates foundation: RegimeValidator, RegimeAnalyzer
   - Emits: phase:transition-confirmed, regime:classification events
   - Tests: ~46 tests

2. **06-02 (ORCH-06)** — After 06-01 complete
   - Uses: regime:classification events from 06-01
   - Creates: VdWAgentSpawner, VdWAgent
   - Emits: orch:vdw-agent-spawned, orch:vdw-agent-complete events
   - Tests: ~45 tests

3. **06-03 (TNA-07/TNA-09)** — After 06-01 AND 06-02 complete
   - Uses: regime:classification from 06-01
   - Creates: CatalystQuestionGenerator, CentralityTimeSeries
   - Emits: tna:catalyst-questions-generated, tna:centrality-change-detected events
   - Tests: ~60 tests

4. **06-04 (TNA-08)** — After 06-03 complete
   - Uses: Community structure + centrality data from TNA
   - Creates: LayoutComputer with ForceAtlas2
   - Emits: tna:layout-updated events
   - Tests: ~40 tests

---

## Questions or Issues?

If you encounter issues during execution, check:

1. **Plan specificity:** Each task has `<files>`, `<action>`, `<verify>`, `<done>` sections
2. **Dependencies:** Ensure prior plans completed before executing dependent plan
3. **Module isolation:** If adding imports, verify no cross-module violations
4. **Test strategy:** Unit tests verify individual methods; integration tests verify wiring
5. **Backward compatibility:** Existing Phase 5 tests must still pass

---

**Document Last Updated:** 2026-03-01  
**Status:** VERIFIED READY FOR EXECUTION
