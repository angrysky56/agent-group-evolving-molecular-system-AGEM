# Phase 4: Self-Organized Criticality Tracking - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Compute five SOC metrics from mathematical component outputs:

1. Von Neumann entropy from Sheaf eigenspectrum
2. Embedding entropy from TNA semantic embeddings
3. Critical Discovery Parameter (CDP) composite signal
4. Surprising edge ratio (cross-domain connection tracking)
5. Phase transition detection via structural-semantic correlation

SOC reads inputs from Sheaf (Phase 1) and TNA (Phase 3) and emits metric events. Zero dependencies on LCM or Orchestrator internals. Metrics feed into Phase 5 orchestration decisions.

</domain>

<decisions>
## Implementation Decisions

### Von Neumann Entropy Formula (SOC-01)

- **Approach:** Eigenvalue-based entropy on normalized Laplacian density matrix
- **Formula:** `S = -Σ λ_i * ln(λ_i)` where:
  - Eigenvalues λ_i are from normalized Laplacian `L_norm = I - D^(-1/2) A D^(-1/2)`
  - Density matrix is `ρ = L_norm / trace(L_norm)` (normalized)
  - Zero eigenvalues are skipped in summation (cannot compute `0 * ln(0)`)
- **Validation:** Cross-validate that Von Neumann entropy of complete graph K_n equals `ln(n)`
- **Note:** This is distinct from adjacency-matrix Shannon entropy; implementation must pass the K_n test to confirm correctness

### Embedding Entropy Formula (SOC-02)

- **Approach:** Eigenvalue-based entropy on embedding covariance eigenspectrum
- **Formula:** `S = -Σ λ_i * ln(λ_i)` where:
  - Covariance matrix is `Σ = (1/n) E^T E` for embedding matrix E (rows = nodes, cols = dimensions)
  - Eigenvalues λ_i are from Σ (computed via eigendecomposition)
  - Zero eigenvalues are skipped (cannot compute `0 * ln(0)`)
  - Refresh per-iteration (use fresh embeddings from current TNA state)
- **Validation:** Test edge cases: identical embeddings → entropy ≈ 0; d orthogonal unit vectors → entropy ≈ ln(d)
- **Note:** This is not token-frequency Shannon entropy; implementation must distinguish semantic embedding entropy from token distribution entropy

### Surprising Edge Classification (SOC-04)

- **Definition:** Edges connecting nodes that are far apart in both structural and semantic space
- **Per-iteration tracking:** Edge set for each iteration contains only edges created at that iteration (tagged via `createdAtIteration` in TNA CooccurrenceGraph)
- **Surprising edge criteria:**
  - **Structural:** Edge crosses community boundary (endpoints in different communities per Louvain)
  - **Semantic:** Embedding similarity below threshold (cosine similarity < 0.3, configurable)
  - **Combination:** Both conditions must hold for edge to count as "surprising"
- **Ratio computation:** `surprising_edge_ratio[iteration] = (count of surprising edges added in iteration) / (total edges added in iteration)`
- **Metric:** Per-iteration ratio, NOT cumulative; cumulative ratio introduces temporal bias and violates ROADMAP SC3
- **Calibration:** Target ~12% (per paper); threshold calibration can be adjusted empirically during Phase 4 research if actual corpus differs significantly

### Phase Transition Detection Window (SOC-05)

- **Detection mechanism:** Rolling cross-correlation between structural entropy delta and semantic entropy delta
- **Window size:** 10-iteration rolling window (fixed, not adaptive yet; configurable parameter for research)
- **Correlation computation:** Pearson correlation coefficient between `ΔS_structural[i:i+10]` and `ΔS_semantic[i:i+10]`
- **Event trigger:** Fire `phase:transition` event when correlation sign changes (negative ↔ positive), centered at window middle
- **No hard-coded constants:** Iteration numbers (e.g., 400) never appear in implementation; only configurable parameters and dynamic computation
- **Note:** Window can be tuned empirically; smaller windows detect faster transitions, larger windows reduce noise

### Event Emission and Metric History (SOC-03)

- **Emission frequency:** Per-iteration (every iteration emits a `soc:metrics` event)
- **Event payload:** Single event containing all five metrics (Von Neumann entropy, embedding entropy, CDP, surprising edge ratio, phase transition detection state)
- **History tracking:** SOC instance maintains full time series (array of metric objects per iteration), not rolling-window truncation
- **Time series structure:** `{ iteration, timestamp, vonNeumannEntropy, embeddingEntropy, cdp, surprisingEdgeRatio, correlationCoefficient, isPhaseTransition }`
- **Optional trend analysis:** Compute linear regression slope of Von Neumann entropy over last 5 iterations (available as property, not mandatory)
- **Aggregation strategy:** None at this phase; raw per-iteration values are stored; Phase 6 can add smoothing/rolling averages if needed
- **History access:** Public method `getMetricsHistory()` returns full array; `getLatestMetrics()` returns last entry; `getMetricsTrend(window)` returns mean and slope

### Claude's Discretion

- Exact similarity threshold for "surprising edge" semantic criterion (currently 0.3; can be tuned based on empirical results)
- Window centering strategy for phase transition event (currently middle-aligned; alternative: end-aligned)
- Trend analysis window size (currently 5 iterations; can be configurable)

</decisions>

<specifics>
## Specific Ideas

- Von Neumann entropy should **visually** track graph complexity: fully connected ≈ ln(n), sparse tree ≈ 0, random ≈ intermediate
- Embedding entropy should **increase as semantic diversity grows** — new concepts being introduced to the graph
- Phase transition event should be **sparse and meaningful** — not firing every other iteration; 10-window default should produce transitions every 50-100 iterations in healthy runs
- Surprising edges are a **serendipity signal** — high surprising-edge-ratio suggests the LLM is making novel connections; low ratio suggests convergence or repetition

</specifics>

<deferred>
## Deferred Ideas

- **Adaptive window sizing** — Phase 5 or Phase 6 can dynamically adjust rolling window based on signal variance
- **Cross-correlation statistical significance** — Phase 6 can add p-value threshold instead of just sign-change detection
- **Regime detection** — Identifying NORMAL vs OBSTRUCTED vs CRITICAL using entropy thresholds (belongs in Phase 5 orchestrator, not Phase 4)
- **Historical comparison** — Comparing current metrics to historical baseline from previous runs (Phase 6 enhancement)

</deferred>

---

_Phase: 04-soc_
_Context gathered: 2026-03-01_
