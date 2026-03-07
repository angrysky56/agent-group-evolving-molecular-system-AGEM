---
phase: 04-soc
plan: 02
subsystem: soc
tags:
  [
    EventEmitter,
    pearson-correlation,
    phase-transition,
    surprising-edge-ratio,
    cdp,
    isolation,
    barrel-export,
    tdd,
  ]

# Dependency graph
requires:
  - phase: 04-01
    provides: vonNeumannEntropy, embeddingEntropy, cosineSimilarity, SOCInputs/SOCMetrics/SOCConfig/MetricsTrend interfaces, SOCMetricsEvent/SOCPhaseTransitionEvent event types
  - phase: 01-sheaf
    provides: EventEmitter pattern from CohomologyAnalyzer.ts
  - phase: 02-lcm
    provides: ImmutableStore frozen-copy getAll() pattern for getMetricsHistory()
provides:
  - SOCTracker class extending EventEmitter in src/soc/SOCTracker.ts
  - pearsonCorrelation() and linearSlope() pure functions in src/soc/correlation.ts
  - Full metric history via getMetricsHistory() / getLatestMetrics() / getMetricsTrend()
  - Phase transition detection via rolling Pearson correlation sign change (no hard-coded constants)
  - Per-iteration surprising edge ratio with both structural and semantic criteria
  - SOC module isolation guards in src/soc/isolation.test.ts (T-ISO-01..04)
  - Public barrel export in src/soc/index.ts ready for Phase 5 orchestrator
affects:
  - phase 05-orchestrator: imports from src/soc/index.ts, subscribes to soc:metrics and phase:transition events
  - ROADMAP SC-3, SC-4, SC-5: all permanently guarded by T-SE-01/T-SE-05, T-PT-01/T-ISO-03, T-ISO-01

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SOCTracker extends EventEmitter (same pattern as CohomologyAnalyzer.ts): emits soc:metrics every iteration with all 8 fields, emits phase:transition on sign change"
    - "Rolling Pearson correlation over delta arrays: push deltaVNE and deltaEE per iteration, correlate last N entries when len >= windowSize"
    - "Sign change detection with noise filter: Math.sign(curr) !== Math.sign(prev) AND both |r| > 0.1 to avoid false positives from near-zero correlations"
    - "Per-iteration surprising edge filter: edges.filter(e => e.createdAtIteration === inputs.iteration) before ratio computation (Pitfall 3 guard)"
    - "Both criteria required for surprising edge: (a) cross-community AND (b) cosineSimilarity < threshold"
    - "Defensive frozen copy for getMetricsHistory(): Object.freeze([...this.#history]) same as LCM ImmutableStore.getAll()"
    - "T-PT-01 uses blended embeddings for controlled sign change: v[0]=sqrt(1-t) (shared), v[k]=sqrt(t) (unique) normalized — independent control of EE vs VNE"

key-files:
  created:
    - src/soc/correlation.ts
    - src/soc/SOCTracker.ts
    - src/soc/SOCTracker.test.ts
    - src/soc/isolation.test.ts
    - src/soc/index.ts
  modified: []

key-decisions:
  - "Phase transition sign change uses noise filter |r| > 0.1: pure sign change on near-zero correlations (e.g., 0.001 to -0.001) would be a false positive — both magnitudes must be above noise floor"
  - "previousCorrelation only updated when correlationCoefficient !== 0: avoids overwriting a meaningful correlation with a zero (insufficient data) value"
  - "T-PT-01 redesigned with blended embeddings: original test used static inputs per phase (deltas all 0 except at boundary) — replaced with independent VNE/EE control via path-graph length and t-blend parameter"
  - "linearSlope uses direct OLS formula rather than pearsonCorrelation * (stddev ratio): self-contained, avoids chain of degenerate cases"
  - "SOCTracker #deltaStructural and #deltaSemantic use entropy deltas (current - previous), not raw entropy values: correlation over differences detects change in relationship between the two entropy signals"

patterns-established:
  - "Pattern: blended embeddings for independent entropy control in TDD tests: v[0]=sqrt(1-t) shared, v[k]=sqrt(t) unique — avoids covariance between VNE and EE"
  - "Pattern: per-iteration edge filtering by createdAtIteration field — all edge arrays carry the iteration tag for precise filtering"
  - "Pattern: EventEmitter metrics emission with typed event objects (SOCMetricsEvent, SOCPhaseTransitionEvent) matching src/types/Events.ts discriminated unions"

# Metrics
duration: 9min
completed: 2026-03-01
---

# Phase 4 Plan 02: SOCTracker + Isolation + Barrel Export Summary

**SOCTracker with CDP computation, per-iteration surprising edge ratio, rolling Pearson phase transition detection, and EventEmitter wiring — completing all 5 SOC requirements and permanently guarding ROADMAP SC-3, SC-4, SC-5 with test gates**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-01T04:15:46Z
- **Completed:** 2026-03-01T04:25:04Z
- **Tasks:** 2/2 complete
- **Files modified:** 5 (5 created)

## Accomplishments

- `correlation.ts`: `pearsonCorrelation(x, y)` (Pearson r) and `linearSlope(values)` (OLS direct formula) pure math utilities for phase transition detection and metric trend computation
- `SOCTracker.ts`: EventEmitter subclass computing all 5 SOC metrics per-iteration — VNE, EE, CDP=VNE-EE, per-iteration surprising edge ratio (both cross-community AND low-similarity required), rolling Pearson correlation sign change for phase transition. Private `#` fields, frozen history copy, configurable window sizes.
- 15 SOCTracker tests: T-CDP-01/02 (CDP formula + sign convention), T-SE-01..05 (surprising edge ratio including Pitfall 3 guard), T-PT-01/02/04 (sign change trajectory, stable no-fire, configurable window), T-EV-01..05 (event emission, payload fields, history growth, trend)
- 4 isolation tests: T-ISO-01 (zero cross-module imports), T-ISO-02 (no test-file imports), T-ISO-03 (no hard-coded 400), T-ISO-04 (synthetic-only test data)
- `index.ts`: barrel export for Phase 5 orchestrator — SOCTracker, entropy functions, correlation utilities, all types
- Full test suite: 239/239 tests passing (19 new SOC Wave 2 tests, zero regressions)

## Task Commits

1. **Task 1 RED: Failing SOCTracker tests** — `e9aa564` (test)
2. **Task 1 GREEN+REFACTOR: correlation.ts + SOCTracker.ts implementation** — `1c87455` (feat)
3. **Task 2: isolation.test.ts + index.ts** — `a844784` (feat)

## Files Created/Modified

- `src/soc/correlation.ts` — pearsonCorrelation() and linearSlope() pure functions (72 lines)
- `src/soc/SOCTracker.ts` — SOCTracker class extending EventEmitter with all 5 SOC metrics (238 lines)
- `src/soc/SOCTracker.test.ts` — 15 tests with synthetic blended-embedding trajectory helpers (656 lines)
- `src/soc/isolation.test.ts` — 4 isolation guard tests (163 lines)
- `src/soc/index.ts` — public barrel export for Phase 5 orchestrator (40 lines)

## Decisions Made

- **Noise filter |r| > 0.1 for sign change**: Pure sign change on near-zero correlations (e.g., 0.001 → -0.001) would be false positive. Both |previousCorrelation| and |correlationCoefficient| must exceed 0.1 before the transition fires.
- **previousCorrelation only updated when correlation !== 0**: Avoids overwriting a meaningful correlation value with 0 (which represents "insufficient data"), preventing false positives in the warmup period.
- **T-PT-01 blended embedding design**: Rewrite from static dense/sparse phases (all deltas = 0) to independent VNE/EE control via path-graph length (VNE) and blend parameter t (EE). Empirically verified: sign change fires at iteration 9 with r going from +0.906 to -0.664.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Redesigned T-PT-01 test trajectory to produce actual sign change**

- **Found during:** Task 1 (GREEN phase — first run of SOCTracker tests)
- **Issue:** Original T-PT-01 test design used static inputs (same graph + same embeddings each iteration within each phase). This produced entropy deltas of 0 across all iterations except the phase boundary, making Pearson correlation undefined (0/0). The test never fired the phase:transition event.
- **Fix:** Replaced with blended-embedding approach: nodeCount=8 fixed, VNE controlled via path-graph edge count (0→7 increasing, then 6→0 decreasing), EE controlled via blend parameter t (0→0.7 increasing in both phases, but rate differs). This produces: Phase A: dVNE > 0, dEE > 0 → positive Pearson ~0.9; Phase B: dVNE < 0, dEE > 0 → negative Pearson ~-0.7 → sign change fires.
- **Files modified:** src/soc/SOCTracker.test.ts
- **Verification:** T-PT-01 passes. T-PT-02 (stable trajectory) still passes — no false positives. All 15 tests green.
- **Committed in:** `1c87455` (Task 1 GREEN+REFACTOR commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — incorrect test design that would never trigger the tested behavior)
**Impact on plan:** The SOCTracker implementation itself is correct. The test case needed a better synthetic trajectory design to actually exercise the sign-change detection code. The fix is a test improvement, not a production code change. No architectural impact.

## Issues Encountered

None beyond the T-PT-01 trajectory design issue documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 5 (Orchestrator Integration) can proceed immediately:

- `SOCTracker` is ready for Phase 5 wiring — accepts SOCInputs plain-type struct, emits typed events
- `soc:metrics` and `phase:transition` events are defined in `src/types/Events.ts`
- `src/soc/index.ts` barrel export is the only import point Phase 5 needs
- SOCInputs accepts `ReadonlyMap<string, Float64Array>` for embeddings and `ReadonlyMap<string, number>` for community assignments — both satisfy TNA's LouvainDetector.getAssignment() output type
- All SOC success criteria verified (SOC-01 through SOC-05) and permanently guarded by 30 tests

**Phase 4 COMPLETE:** SOC-01 through SOC-05 fully satisfied.

## Self-Check: PASSED

| Item                                          | Status                   |
| --------------------------------------------- | ------------------------ |
| src/soc/correlation.ts                        | FOUND                    |
| src/soc/SOCTracker.ts                         | FOUND                    |
| src/soc/SOCTracker.test.ts                    | FOUND                    |
| src/soc/isolation.test.ts                     | FOUND                    |
| src/soc/index.ts                              | FOUND                    |
| Commit e9aa564 (Task 1 RED: failing tests)    | FOUND                    |
| Commit 1c87455 (Task 1 GREEN: implementation) | FOUND                    |
| Commit a844784 (Task 2: isolation + barrel)   | FOUND                    |
| npx tsc --noEmit                              | PASSED (0 errors)        |
| npx vitest run src/soc/                       | PASSED (30/30 tests)     |
| Full suite: npx vitest run                    | PASSED (239/239 tests)   |
| No literal 400 in production code             | PASSED (only in comment) |
| Zero imports from lcm/orchestrator/tna/sheaf  | PASSED                   |

---

_Phase: 04-soc_
_Completed: 2026-03-01_
