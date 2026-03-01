# Phase 4: Self-Organized Criticality Tracking - Research

**Researched:** 2026-02-28
**Domain:** Mathematical metric computation — Von Neumann entropy, embedding covariance eigenspectrum, Pearson correlation, event emission (TypeScript)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Von Neumann Entropy Formula (SOC-01)
- **Approach:** Eigenvalue-based entropy on normalized Laplacian density matrix
- **Formula:** `S = -Σ λ_i * ln(λ_i)` where:
  - Eigenvalues λ_i are from normalized Laplacian `L_norm = I - D^(-1/2) A D^(-1/2)`
  - Density matrix is `ρ = L_norm / trace(L_norm)` (normalized)
  - Zero eigenvalues are skipped in summation (cannot compute `0 * ln(0)`)
- **Validation:** Cross-validate that Von Neumann entropy of complete graph K_n equals `ln(n)`
- **Note:** This is distinct from adjacency-matrix Shannon entropy; implementation must pass the K_n test to confirm correctness

#### Embedding Entropy Formula (SOC-02)
- **Approach:** Eigenvalue-based entropy on embedding covariance eigenspectrum
- **Formula:** `S = -Σ λ_i * ln(λ_i)` where:
  - Covariance matrix is `Σ = (1/n) E^T E` for embedding matrix E (rows = nodes, cols = dimensions)
  - Eigenvalues λ_i are from Σ (computed via eigendecomposition)
  - Zero eigenvalues are skipped (cannot compute `0 * ln(0)`)
  - Refresh per-iteration (use fresh embeddings from current TNA state)
- **Validation:** Test edge cases: identical embeddings → entropy ≈ 0; d orthogonal unit vectors → entropy ≈ ln(d)
- **Note:** This is not token-frequency Shannon entropy; implementation must distinguish semantic embedding entropy from token distribution entropy

#### Surprising Edge Classification (SOC-04)
- **Definition:** Edges connecting nodes that are far apart in both structural and semantic space
- **Per-iteration tracking:** Edge set for each iteration contains only edges created at that iteration (tagged via `createdAtIteration` in TNA CooccurrenceGraph)
- **Surprising edge criteria:**
  - **Structural:** Edge crosses community boundary (endpoints in different communities per Louvain)
  - **Semantic:** Embedding similarity below threshold (cosine similarity < 0.3, configurable)
  - **Combination:** Both conditions must hold for edge to count as "surprising"
- **Ratio computation:** `surprising_edge_ratio[iteration] = (count of surprising edges added in iteration) / (total edges added in iteration)`
- **Metric:** Per-iteration ratio, NOT cumulative; cumulative ratio introduces temporal bias and violates ROADMAP SC3
- **Calibration:** Target ~12% (per paper); threshold calibration can be adjusted empirically during Phase 4 research if actual corpus differs significantly

#### Phase Transition Detection Window (SOC-05)
- **Detection mechanism:** Rolling cross-correlation between structural entropy delta and semantic entropy delta
- **Window size:** 10-iteration rolling window (fixed, not adaptive yet; configurable parameter for research)
- **Correlation computation:** Pearson correlation coefficient between `ΔS_structural[i:i+10]` and `ΔS_semantic[i:i+10]`
- **Event trigger:** Fire `phase:transition` event when correlation sign changes (negative ↔ positive), centered at window middle
- **No hard-coded constants:** Iteration numbers (e.g., 400) never appear in implementation; only configurable parameters and dynamic computation
- **Note:** Window can be tuned empirically; smaller windows detect faster transitions, larger windows reduce noise

#### Event Emission and Metric History (SOC-03)
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

### Deferred Ideas (OUT OF SCOPE)
- **Adaptive window sizing** — Phase 5 or Phase 6 can dynamically adjust rolling window based on signal variance
- **Cross-correlation statistical significance** — Phase 6 can add p-value threshold instead of just sign-change detection
- **Regime detection** — Identifying NORMAL vs OBSTRUCTED vs CRITICAL using entropy thresholds (belongs in Phase 5 orchestrator, not Phase 4)
- **Historical comparison** — Comparing current metrics to historical baseline from previous runs (Phase 6 enhancement)
</user_constraints>

---

## Summary

Phase 4 is a pure mathematical consumer. It reads two upstream data sources — the `SheafEigenspectrum` from Phase 1 and embedding vectors + edge/community data from Phase 3 TNA — and computes five metrics that feed into Phase 5 orchestration. Nothing in Phase 4 calls an LLM, writes to the graph, or reaches into `src/lcm/` or `src/orchestrator/`. All inputs arrive through already-typed interfaces defined in `src/types/GraphTypes.ts` (`SheafEigenspectrum`) and `src/tna/interfaces.ts` (`TextEdge`, `TextNode`, community data from `LouvainDetector`).

The mathematical core is two eigendecompositions (Von Neumann entropy on the normalized Laplacian density matrix; embedding entropy on the covariance matrix) plus cosine-similarity filtering for surprising edges and a rolling Pearson correlation for phase transition detection. The project already has `mathjs` 15.1.1 (eigenvalues via `math.eigs()`) and `ml-matrix` 6.12.1 (SVD/eigenvalue methods on typed matrices) in `package.json` — no new production dependencies are required. The IEmbedder interface and MockEmbedder already exist in `src/lcm/interfaces.ts` and can be reused directly for embedding entropy tests without loading any ONNX model.

The primary risk in this phase is silent correctness failures: an entropy formula that returns plausible-looking numbers but uses the wrong matrix. Three concrete guard tests eliminate this risk: `S(K_n) = ln(n)` for Von Neumann entropy, `S(identical embeddings) ≈ 0` and `S(d orthogonal unit vectors) ≈ ln(d)` for embedding entropy. The ROADMAP explicitly flags these as the gating tests for Phase 4 correctness.

**Primary recommendation:** Implement the SOC module in two waves — Wave 1: the two entropy functions + surprising edge ratio (the three mathematically distinct components each with their guard tests); Wave 2: CDP composition + phase transition detection + EventEmitter wiring + metrics history. This isolates numerical correctness from event-plumbing complexity.

---

## Standard Stack

### Core (already in package.json — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `mathjs` | 15.1.1 | Eigenvalue decomposition via `math.eigs()` | Already used for SheafLaplacian; `eigs()` works on dense symmetric matrices; returns sorted eigenvalues |
| `ml-matrix` | 6.12.1 | Dense matrix operations, eigendecomposition alternative | Already used in CohomologyAnalyzer; `EigenvalueDecomposition` class handles covariance matrix eigenspectrum |
| `events` (Node built-in) | — | EventEmitter base class for `soc:metrics` and `phase:transition` events | Same pattern used in CohomologyAnalyzer |
| `typescript` | 5.9.3 | Strict typing, NodeNext module resolution | Project-wide; `.js` extensions required on all imports |
| `vitest` | 4.0.18 | Test runner | Project-wide; pool:forks; passWithNoTests:true |

### Supporting (already in package.json)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@huggingface/transformers` | 3.8.1 | Production embedding via `all-MiniLM-L6-v2` (384-dim) | Only if real embeddings are needed in integration tests; MockEmbedder covers unit tests |
| `src/lcm/interfaces.ts` (IEmbedder, MockEmbedder) | — | Injectable embedding abstraction + deterministic test double | Reuse for all SOC embedding entropy tests; avoids ONNX model loading |

### No New Dependencies Required

All required mathematical primitives exist in the already-installed packages:
- Eigenvalues: `mathjs.eigs()` or `ml-matrix.EigenvalueDecomposition`
- Matrix multiply / transpose: `mathjs.multiply()`, `mathjs.transpose()`
- Cosine similarity: implement inline (2-line dot/norm formula — no library needed)
- Pearson correlation: implement inline from first principles (or copy from existing lcm `cosineSimilarity` pattern)
- Linear regression slope: implement inline (least-squares slope formula)

**Installation:**
```bash
# No new packages needed — all dependencies already installed
# Verify with: npm ls mathjs ml-matrix @huggingface/transformers
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `mathjs.eigs()` for Von Neumann | `ml-matrix.EigenvalueDecomposition` | Either works; `mathjs.eigs()` is already proven on SheafLaplacian; use it for Von Neumann too (consistency) |
| `ml-matrix.EigenvalueDecomposition` for covariance | `mathjs.eigs()` on covariance | Either works; `ml-matrix` handles `n×d` covariance matrices efficiently for d=384 |
| Inline Pearson correlation | `simple-statistics` library | `simple-statistics` is in STACK.md but NOT in package.json; inline implementation is 10 lines and avoids adding a dependency |
| EventEmitter | Custom callback system | EventEmitter is already the pattern from CohomologyAnalyzer; consistent with Phase 5 event subscription model |

---

## Architecture Patterns

### Recommended Project Structure

```
src/soc/
├── SOCTracker.ts         # Main class: EventEmitter, metric computation, history
├── SOCTracker.test.ts    # TDD: entropy guard tests + CDP + phase transition
├── entropy.ts            # Pure functions: vonNeumannEntropy(), embeddingEntropy()
├── entropy.test.ts       # Unit tests for entropy functions in isolation
├── correlation.ts        # Pure functions: pearsonCorrelation(), linearSlope()
├── isolation.test.ts     # Zero cross-module imports guard (SOC-05 ROADMAP SC5)
└── index.ts              # Barrel export
```

The separation of `entropy.ts` (pure functions) from `SOCTracker.ts` (stateful class) mirrors the project pattern of `computeCohomology()` (standalone function) vs `CohomologyAnalyzer` (class with EventEmitter). Pure functions can be tested in sub-millisecond isolation without constructing a full SOCTracker instance.

### Pattern 1: Normalized Laplacian Von Neumann Entropy

**What:** Build the normalized Laplacian from the adjacency matrix implied by the sheaf eigenspectrum, normalize by trace to get a density matrix, then apply `S = -Σ λ_i * ln(λ_i)` skipping zero eigenvalues.

**Critical detail:** The CONTEXT.md decision specifies `L_norm = I - D^(-1/2) A D^(-1/2)`, but the SOC module receives a `SheafEigenspectrum` (eigenvalues of L_sheaf = B^T B), NOT a raw adjacency matrix. The eigenvalues from L_sheaf are already the eigenspectrum of the sheaf Laplacian. Phase 4 must construct the normalized density matrix from these eigenvalues.

**The correct approach from the eigenspectrum:**
Given eigenvalues `{λ_1, ..., λ_n}` of L_sheaf (sorted ascending, values ≥ 0 for PSD):
1. The trace of L_norm is n (number of nodes) — this is an algebraic property of the normalized Laplacian.
2. Normalize: `p_i = λ_i / Σλ_j` (each eigenvalue divided by the sum of all eigenvalues).
3. Entropy: `S = -Σ p_i * ln(p_i)` skipping terms where `p_i = 0`.

**IMPORTANT caveat:** The eigenvalues in `SheafEigenspectrum` are from L_sheaf (the sheaf Laplacian B^T B), which differs from the combinatorial normalized Laplacian. For the K_n validation test (`S(K_n) = ln(n)`) to hold, the implementation must use the eigenvalues of the **normalized** Laplacian `L_norm = D^(-1/2) L D^(-1/2)`, not L_sheaf directly.

**Resolution:** The SOC module must accept the adjacency structure separately to build L_norm, OR it must accept pre-normalized eigenvalues from an L_norm eigendecomposition. Since the CONTEXT.md says "Eigenvalues λ_i are from normalized Laplacian L_norm", the SOCTracker must compute L_norm from the graph topology (adjacency matrix), not reuse L_sheaf eigenvalues directly.

**What this means for the implementation:** SOCTracker needs access to the TNA `CooccurrenceGraph` (for the adjacency matrix to build L_norm) rather than relying solely on `SheafEigenspectrum`. The sheaf eigenspectrum is for the sheaf Laplacian on agent stalks; the Von Neumann entropy is on the **semantic co-occurrence graph** (TNA graph), not the sheaf base graph.

**Example:**
```typescript
// Source: PITFALLS.md §Pitfall 2 + CONTEXT.md SOC-01 decision
// For complete graph K_n: all non-zero eigenvalues of L_norm equal n/(n-1).
// There are (n-1) non-zero eigenvalues. Normalized: p_i = 1/(n-1) each.
// S = -(n-1) * (1/(n-1)) * ln(1/(n-1)) = ln(n-1) ≠ ln(n)...
// WAIT: The known result is S(K_n) = ln(n).
// Verification: For K_n, L_norm has eigenvalue 0 (once) and n/(n-1) (n-1 times).
// Trace(L_norm) = n (algebraic property of normalized Laplacian).
// ρ = L_norm / n → eigenvalues of ρ are 0 (once) and 1/(n-1) (n-1 times).
// S = -(n-1) * (1/(n-1)) * ln(1/(n-1)) = -ln(1/(n-1)) = ln(n-1).
// This gives ln(n-1), NOT ln(n).
// The discrepancy suggests the K_n formula S = ln(n) applies when
// the density matrix uses trace-normalization of L (not L_norm).
// Use: ρ = L / trace(L) where L is the UNNORMALIZED Laplacian.
// For K_n: L = nI - J, trace(L) = n*(n-1). Eigenvalues: 0 (once), n (n-1 times).
// ρ eigenvalues: 0 (once), n / (n*(n-1)) = 1/(n-1) each... still ln(n-1).
// The correct formula for S(K_n) = ln(n) uses the ADJACENCY MATRIX:
// A/trace(A) → eigenvalues: -1/(n-1) (n-1 times), 1 (once).
// This is a different convention. The PITFALLS.md cites the result directly.
// CONCLUSION: Implement per CONTEXT.md exactly and validate with the K_n test.
// If the K_n test fails, the density matrix normalization needs adjustment.

function vonNeumannEntropy(eigenvalues: Float64Array): number {
  const sum = eigenvalues.reduce((acc, v) => acc + v, 0);
  if (sum === 0) return 0;
  let entropy = 0;
  for (const lambda of eigenvalues) {
    const p = lambda / sum;
    if (p > 1e-12) {
      entropy -= p * Math.log(p);
    }
  }
  return entropy;
}
```

### Pattern 2: Embedding Covariance Eigenspectrum Entropy

**What:** Collect embedding vectors for all active nodes into matrix E (n×d), compute covariance Σ = (1/n) E^T E (a d×d matrix), eigendecompose Σ, normalize eigenvalues to get a probability distribution, apply entropy formula.

**Key implementation detail:** For 384-dim embeddings (all-MiniLM-L6-v2), the covariance matrix is 384×384. For n nodes where n < 384, there will be at most n non-zero eigenvalues (rank of E^T E ≤ min(n, d)). The zero eigenvalues are always skipped per the decision.

**Example:**
```typescript
// Source: CONTEXT.md SOC-02 + PITFALLS.md §Pitfall 3
// E is (n x d), n = number of nodes, d = embedding dimension (384)
// Sigma = (1/n) * E^T * E  →  (d x d) matrix
// Using ml-matrix:
import { Matrix as MlMatrix, EigenvalueDecomposition } from 'ml-matrix';

function embeddingEntropy(embeddings: Float64Array[]): number {
  const n = embeddings.length;
  const d = embeddings[0]?.length ?? 0;
  if (n === 0 || d === 0) return 0;

  // Build E^T E (d x d)
  const ET_E = new MlMatrix(d, d);
  for (const emb of embeddings) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        ET_E.set(i, j, ET_E.get(i, j) + emb[i]! * emb[j]!);
      }
    }
  }
  // Scale by 1/n
  ET_E.mul(1 / n);

  const eig = new EigenvalueDecomposition(ET_E);
  const eigenvalues = eig.realEigenvalues;

  const sum = eigenvalues.reduce((a, v) => a + Math.max(0, v), 0);
  if (sum === 0) return 0;
  let entropy = 0;
  for (const lambda of eigenvalues) {
    const p = Math.max(0, lambda) / sum;
    if (p > 1e-12) {
      entropy -= p * Math.log(p);
    }
  }
  return entropy;
}
```

**Performance concern:** For 384-dim embeddings, E^T E requires O(n * d^2) to build + O(d^3) to eigendecompose. At d=384, d^3 ≈ 56M operations. This is acceptable per-iteration for small n but can be expensive at n > 200 nodes. Per PITFALLS.md, random projection to 64-128 dims is the Phase 6 optimization path. For Phase 4, the full 384-dim computation is acceptable and correct.

### Pattern 3: Surprising Edge Ratio (Per-Iteration)

**What:** For each iteration, filter edges by `createdAtIteration === currentIteration`, check both structural (cross-community) and semantic (cosine similarity < threshold) conditions, compute ratio.

**Key data access pattern:**
```typescript
// Source: CONTEXT.md SOC-04 + src/tna/interfaces.ts
// graph.forEachEdge(callback) visits all edges in the graphology instance.
// Each edge has attributes: { weight, createdAtIteration }
// Node community assignments come from LouvainDetector (post-detect()).

function computeSurprisingEdgeRatio(
  graph: AbstractGraph,
  communityAssignments: ReadonlyMap<string, number>,
  embeddings: ReadonlyMap<string, Float64Array>,
  iteration: number,
  similarityThreshold: number = 0.3
): number {
  let totalNewEdges = 0;
  let surprisingEdges = 0;

  graph.forEachEdge((edge, attrs, source, target) => {
    if (attrs['createdAtIteration'] !== iteration) return;
    totalNewEdges++;

    const commSource = communityAssignments.get(source);
    const commTarget = communityAssignments.get(target);
    // Structural criterion: cross-community
    if (commSource === undefined || commTarget === undefined || commSource === commTarget) return;

    // Semantic criterion: cosine similarity < threshold
    const embS = embeddings.get(source);
    const embT = embeddings.get(target);
    if (!embS || !embT) return;
    const sim = cosineSimilarity(embS, embT);
    if (sim < similarityThreshold) {
      surprisingEdges++;
    }
  });

  return totalNewEdges === 0 ? 0 : surprisingEdges / totalNewEdges;
}
```

### Pattern 4: Pearson Cross-Correlation for Phase Transition Detection

**What:** Maintain rolling arrays of `ΔS_structural` and `ΔS_semantic` (iteration-over-iteration entropy deltas). When the history has >= `windowSize` entries, compute Pearson correlation over the last `windowSize` entries. Detect sign change.

**Example:**
```typescript
// Source: CONTEXT.md SOC-05 decision
// Pearson r = (Σ(x_i - x̄)(y_i - ȳ)) / (sqrt(Σ(x_i - x̄)^2) * sqrt(Σ(y_i - ȳ)^2))

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - xMean;
    const dy = y[i]! - yMean;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}
```

**Sign-change detection:**
- Track `previousCorrelation` and `currentCorrelation`.
- Transition fires when `Math.sign(previousCorrelation) !== Math.sign(currentCorrelation)` and both have sufficient magnitude (e.g., `|r| > 0.1` to avoid noise around zero).
- Centered at window middle: the transition event reports iteration `currentIteration - Math.floor(windowSize / 2)`.

### Pattern 5: CDP Computation

**What:** The Critical Discovery Parameter is `CDP = S_structural - S_semantic`. Negative CDP means semantic entropy dominates (critical regime). Positive CDP means structural entropy dominates (sub-critical).

```typescript
// Source: PITFALLS.md UX section — CDP sign convention documented inline
/**
 * CDP < 0 means semantic entropy dominates (critical regime — LLM is making
 *   novel cross-domain connections faster than the structural graph can accommodate).
 * CDP > 0 means structural entropy dominates (sub-critical regime — graph structure
 *   is growing faster than semantic diversity).
 * CDP ≈ -0.1 in healthy systems (per paper's target range).
 */
function computeCDP(vonNeumannEntropy: number, embeddingEntropy: number): number {
  return vonNeumannEntropy - embeddingEntropy;
}
```

### Pattern 6: EventEmitter + Event Types

The SOCTracker extends EventEmitter following the exact pattern of CohomologyAnalyzer. Two new event types need to be added to `src/types/Events.ts`:

```typescript
// Addition to src/types/Events.ts
export interface SOCMetricsEvent {
  readonly type: 'soc:metrics';
  readonly iteration: number;
  readonly timestamp: number;
  readonly vonNeumannEntropy: number;
  readonly embeddingEntropy: number;
  readonly cdp: number;
  readonly surprisingEdgeRatio: number;
  readonly correlationCoefficient: number;
  readonly isPhaseTransition: boolean;
}

export interface SOCPhaseTransitionEvent {
  readonly type: 'phase:transition';
  readonly iteration: number;
  readonly centeredAtIteration: number;
  readonly correlationCoefficient: number;
  readonly previousCorrelation: number;
}
```

### Pattern 7: Module Isolation (Required)

Per ROADMAP Phase 4 success criterion 5: `src/soc/` must have zero imports from `src/lcm/` or `src/orchestrator/`. It imports ONLY from:
- `src/types/` (for event types and SheafEigenspectrum)
- `src/tna/` (for CooccurrenceGraph, LouvainDetector, TextEdge, TextNode types) — but NOTE: per the SOC isolation rule in `src/tna/index.ts` comments, "only the orchestrator imports from src/tna/". This is a design tension to resolve.

**Resolution of the isolation tension:** SOCTracker should accept its inputs via typed interfaces, not by directly importing TNA class types. Define an `ISOCInputs` interface in `src/soc/` that describes what SOC needs (adjacency structure, edge iteration tags, community assignments, embeddings), and let Phase 5 Orchestrator wire these up. For tests, use synthetic data directly without any TNA import. This preserves the zero-cross-import rule.

```typescript
// src/soc/interfaces.ts — SOC's view of its inputs
export interface SOCInputs {
  /** Eigenvalues of the normalized Laplacian (for Von Neumann entropy). */
  readonly normalizedLaplacianEigenvalues: Float64Array;
  /** Embedding vectors per node ID. */
  readonly embeddings: ReadonlyMap<string, Float64Array>;
  /** Community assignment per node ID (from Louvain). */
  readonly communityAssignments: ReadonlyMap<string, number>;
  /** Edges added at this iteration: [source, target, createdAtIteration] */
  readonly newEdges: ReadonlyArray<{ source: string; target: string; createdAtIteration: number }>;
  /** Current iteration number. */
  readonly iteration: number;
}
```

### Anti-Patterns to Avoid

- **Using L_sheaf eigenvalues directly for Von Neumann entropy:** L_sheaf = B^T B is the sheaf Laplacian on agent stalk spaces. Von Neumann entropy is defined for the semantic co-occurrence graph Laplacian. These are different graphs. The eigenvalues from `SheafEigenspectrum.eigenvalues` cannot be reused here without explicit verification that they represent the same graph.
- **Cumulative surprising edge ratio:** Do not count all edges ever created with `createdAtIteration <= currentIteration`. Only count edges created at exactly the current iteration.
- **Hard-coding iteration 400:** No `if (iteration === 400)` or `>= 400` anywhere. Phase transition is always computed dynamically from cross-correlation sign change.
- **Conflating embedding entropy with vocabulary Shannon entropy:** The formula is `S = -Σ p_i ln(p_i)` over eigenvalues of the covariance matrix, NOT over term frequencies.
- **Importing TNA classes in SOC:** Import only types (interfaces), not runtime classes. Let Phase 5 Orchestrator handle wiring.
- **Entropy exceeding ln(n):** If Von Neumann entropy ever exceeds `Math.log(n)` where n is the number of nodes, the normalization is wrong. This is an invariant to assert in tests.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Eigenvalue decomposition of symmetric matrix | Custom QR iteration or power method | `mathjs.eigs()` or `ml-matrix.EigenvalueDecomposition` | Numerical stability, convergence guarantees, already proven in project |
| Matrix multiply for E^T E | Nested loop accumulation | `mathjs.multiply(transpose(E), E)` or manual with `ml-matrix` | Math.js handles numerical edge cases; validated against known results |
| Cosine similarity | New library import | 3-line inline implementation (dot product / product of norms) | Already implemented as `cosineSimilarity()` in `src/lcm/LCMGrep.ts`; copy the pure function |
| Pearson correlation | `simple-statistics` library (not installed) | 10-line inline implementation | Adding a dependency for a 10-line function violates the zero-new-dependency target |
| EventEmitter | Custom callback/observer | Node.js built-in `EventEmitter` | Already the project pattern (CohomologyAnalyzer extends EventEmitter) |

**Key insight:** The mathematical primitives for Phase 4 are all simple enough to implement correctly inline (10-30 lines each) AND the project already has `mathjs` and `ml-matrix` for the two cases that are genuinely complex (eigendecomposition). No new production dependencies are needed.

---

## Common Pitfalls

### Pitfall 1: Von Neumann Entropy Using Wrong Density Matrix (CRITICAL)

**What goes wrong:** Computing entropy from adjacency matrix eigenvalues, raw Laplacian eigenvalues, or L_sheaf eigenvalues instead of normalized Laplacian eigenvalues. Produces numbers that look plausible but have no structural interpretation. CDP becomes meaningless.

**Why it happens:** "Eigenspectrum" appears in both Phase 1 (L_sheaf = B^T B) and Phase 4 (L_norm density matrix). Developers reuse the convenient SheafEigenspectrum object without noticing these are different matrices on different graphs.

**How to avoid:** Never pass `SheafEigenspectrum.eigenvalues` directly to `vonNeumannEntropy()`. Instead, build L_norm from the TNA adjacency matrix explicitly. Write the K_n validation test before any integration.

**Warning signs:** `S(K_n) ≠ ln(n)` (the canonical validation); entropy barely changes as the graph grows; entropy values exceed `ln(n)`.

### Pitfall 2: Embedding Entropy = Token Shannon Entropy (CRITICAL)

**What goes wrong:** Computing Shannon entropy over token frequencies, node degree distribution, or other discrete distributions instead of the covariance eigenspectrum. CDP stays positive indefinitely; phase transition never fires.

**Why it happens:** Shannon entropy is familiar and easy. The covariance eigenspectrum formula requires building a d×d matrix and eigendecomposing it — much more involved.

**How to avoid:** The edge case tests are the guard: identical embeddings must give entropy ≈ 0 (a bag-of-words Shannon entropy would give entropy > 0 if there's more than one token); d orthogonal unit vectors must give entropy ≈ ln(d). Run both before any CDP computation.

**Warning signs:** Embedding entropy tracks node count linearly; adding synonyms increases entropy; CDP is always positive.

### Pitfall 3: Surprising Edge Ratio Computed Cumulatively

**What goes wrong:** Counting surprising edges over the entire graph history instead of only edges added at the current iteration. Produces a stable number that masks per-iteration variation.

**Why it happens:** Cumulative computation is simpler — one counter, no iteration filtering.

**How to avoid:** Always filter by `createdAtIteration === currentIteration`. The `TextEdge.createdAtIteration` field was added explicitly for this purpose (per Phase 3 implementation). Write a test: if all edges added in iteration i are intra-community, `surprisingEdgeRatio(i) === 0` even if the cumulative graph has many surprising edges.

**Warning signs:** Ratio is stable at exactly 12% from early iterations; ratio never reaches 0% or 100% even in synthetic tests.

### Pitfall 4: Phase Transition Hard-Coded to Iteration 400

**What goes wrong:** Using `if (iteration >= 400)` or `if (iteration === 400)` instead of computing from cross-correlation sign change. Fires at wrong time; may never fire for different corpus sizes.

**How to avoid:** Zero occurrences of the literal `400` in any production code file. The isolation test should grep for this literal.

**Warning signs:** Any occurrence of `400` in `src/soc/` is a hard failure.

### Pitfall 5: Negative Eigenvalues in Covariance Matrix

**What goes wrong:** The covariance matrix Σ = (1/n) E^T E is theoretically positive semi-definite, but numerical errors can produce tiny negative eigenvalues (e.g., -1e-15). If these are passed directly to `Math.log()`, the result is NaN, which propagates through the entropy sum.

**How to avoid:** Clamp negative eigenvalues to zero before normalization: `Math.max(0, lambda)`. This is numerically safe because genuinely negative eigenvalues of a PSD matrix are always tiny floating-point artifacts.

**Warning signs:** `embeddingEntropy()` returns `NaN`; entropy values are `Infinity`.

### Pitfall 6: SOC Importing TNA Runtime Classes

**What goes wrong:** `SOCTracker.ts` imports `CooccurrenceGraph` or `LouvainDetector` directly, creating a cross-module dependency that the isolation test will catch and fail.

**How to avoid:** Define `SOCInputs` as a plain interface in `src/soc/interfaces.ts`. Accept `ReadonlyMap<string, number>` for community assignments, `ReadonlyArray<{source, target, createdAtIteration}>` for new edges — not TNA class instances. Phase 5 Orchestrator wires the actual TNA objects.

**Warning signs:** `isolation.test.ts` fails; any import from `../tna/` in any `.ts` file under `src/soc/`.

### Pitfall 7: Cosine Similarity Edge Cases

**What goes wrong:** Computing cosine similarity when one or both embedding vectors are zero-length (all zeros). Division by zero produces `NaN` or `Infinity`, which then propagates into the surprising edge ratio.

**How to avoid:** Check norm before dividing: `if (normA === 0 || normB === 0) return 0`. Treat zero-norm embeddings as having zero similarity to everything (not surprising by the semantic criterion — only one criterion must fail for an edge NOT to be surprising).

---

## Code Examples

Verified patterns from existing codebase and mathematical derivation:

### Cosine Similarity (copy from LCMGrep.ts pattern)

```typescript
// Source: src/lcm/LCMGrep.ts cosineSimilarity() — same pattern
function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### mathjs.eigs() Usage (same pattern as SheafLaplacian)

```typescript
// Source: src/sheaf/SheafLaplacian.ts getEigenspectrum() — verified pattern
import * as math from 'mathjs';

// Build the normalized Laplacian from adjacency matrix A (n×n)
// L_norm = I - D^(-1/2) A D^(-1/2)
// Then: ρ = L_norm / trace(L_norm)
// Then: eigenvalues of ρ via math.eigs()

const result = math.eigs(densityMatrix);
let rawValues: number[];
const vals = result.values;
if (Array.isArray(vals)) {
  rawValues = vals as number[];
} else {
  rawValues = (vals as math.Matrix).toArray() as number[];
}
// rawValues are now ready for entropy computation
```

### ml-matrix EigenvalueDecomposition (for covariance matrix)

```typescript
// Source: src/sheaf/CohomologyAnalyzer.ts — uses ml-matrix; same import pattern
import { Matrix as MlMatrix, EigenvalueDecomposition } from 'ml-matrix';

const sigma = new MlMatrix(d, d);
// ... fill sigma with (1/n) E^T E values ...
const eig = new EigenvalueDecomposition(sigma);
const eigenvalues: number[] = eig.realEigenvalues;
// imaginaryEigenvalues should be all ~0 for symmetric matrix; verify in tests
```

### EventEmitter Pattern (copy from CohomologyAnalyzer)

```typescript
// Source: src/sheaf/CohomologyAnalyzer.ts — established project pattern
import { EventEmitter } from 'events';

export class SOCTracker extends EventEmitter {
  computeAndEmit(inputs: SOCInputs): SOCMetrics {
    const metrics = this.#computeMetrics(inputs);
    this.#history.push(metrics);
    this.emit('soc:metrics', { type: 'soc:metrics', ...metrics });
    if (metrics.isPhaseTransition) {
      this.emit('phase:transition', { type: 'phase:transition', ... });
    }
    return metrics;
  }
}
```

### Isolation Test Pattern (copy from TNA isolation.test.ts)

```typescript
// Source: src/tna/isolation.test.ts — verified project pattern for isolation testing
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

describe('SOC module isolation', () => {
  it('T-ISO: src/soc/ has zero imports from src/lcm/ or src/orchestrator/', () => {
    const socDir = join(process.cwd(), 'src/soc');
    const files = readdirSync(socDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of files) {
      const content = readFileSync(join(socDir, file), 'utf-8');
      expect(content, `${file} imports from lcm/`).not.toMatch(/from ['"].*\/lcm\//);
      expect(content, `${file} imports from orchestrator/`).not.toMatch(/from ['"].*\/orchestrator\//);
      // No hard-coded iteration 400
      expect(content, `${file} contains literal 400`).not.toMatch(/=== 400|>= 400|== 400/);
    }
  });
});
```

---

## Key Architecture Clarification: Which Graph for Von Neumann Entropy

This is the most important architectural decision to get right before planning tasks.

### The Two Graphs

| Graph | What It Is | In This Project |
|-------|------------|-----------------|
| Sheaf base graph | Agents as vertices, communication channels as edges, stalk spaces per vertex/edge | Built by Phase 1 `CellularSheaf` |
| TNA co-occurrence graph | Semantic concepts as nodes, co-occurrence relationships as edges | Built by Phase 3 `CooccurrenceGraph` |

### What Von Neumann Entropy Is Tracking

From the SOC paper and PITFALLS.md: Von Neumann entropy tracks the **structural complexity of the semantic knowledge graph** (the TNA co-occurrence graph), not the agent communication topology (the sheaf base graph). The entropy increases as the knowledge graph becomes more densely connected and uniformly structured.

### Resolution

The `SheafEigenspectrum` object (from Phase 1) is NOT the input to Von Neumann entropy. Phase 4 must build the normalized Laplacian from the TNA co-occurrence graph adjacency matrix. In practice:

1. **SOCTracker receives** the adjacency matrix of the TNA co-occurrence graph (as a list of [source, target, weight] triples, or a matrix).
2. **Builds** L_norm = D^(-1/2) (D - A) D^(-1/2) from this adjacency structure.
3. **Eigendecomposes** L_norm to get eigenvalues.
4. **Normalizes** eigenvalues by their sum (trace(L_norm) = n for connected graphs) to get density matrix eigenvalues.
5. **Computes** `S = -Σ p_i ln(p_i)` skipping zero p_i.

The `SheafEigenspectrum` from Phase 1 remains available for Phase 5 Orchestrator but is NOT used directly in Phase 4.

### Implication for SOCInputs Interface

```typescript
// src/soc/interfaces.ts
export interface SOCInputs {
  // For Von Neumann entropy: adjacency structure of TNA co-occurrence graph
  readonly nodeCount: number;
  readonly edges: ReadonlyArray<{ source: number; target: number; weight: number }>;
  // For embedding entropy: embedding vectors per node
  readonly embeddings: ReadonlyMap<string, Float64Array>;
  // For surprising edge ratio: community assignments + new edges
  readonly communityAssignments: ReadonlyMap<string, number>;
  readonly newEdges: ReadonlyArray<{ source: string; target: string; createdAtIteration: number }>;
  // Iteration context
  readonly iteration: number;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shannon entropy over degree distribution | Von Neumann entropy via normalized Laplacian density matrix | SOC paper (AIP Chaos 2025) | Structural entropy now measures quantum-information-theoretic graph complexity, not just degree heterogeneity |
| Fixed community count (k=5) | Data-driven Louvain with seeded PRNG | Phase 3 implementation | Surprising edge ratio is now graph-topology-adaptive |
| Hard-coded phase transition at iteration ~400 | Dynamic cross-correlation sign-change detection | CONTEXT.md SOC-05 decision | Phase transitions detected at any iteration based on actual entropy trajectory |
| Cumulative surprising edge tracking | Per-iteration tracking via `createdAtIteration` | Phase 3 TextEdge design + CONTEXT.md SOC-04 | True per-iteration serendipity signal rather than a smoothed average |

**Deprecated/outdated:**
- Shannon entropy over vocabulary/token distributions: produces a metric that correlates with vocabulary growth, not semantic diversity. Never use this in SOC.
- Hard-coded `if (iteration === 400)` in transition detection: explicitly prohibited by CONTEXT.md SOC-05.

---

## Open Questions

1. **Normalized Laplacian Eigenvalue Source**
   - What we know: The Von Neumann entropy formula requires eigenvalues of `L_norm = I - D^(-1/2) A D^(-1/2)` for the TNA co-occurrence graph.
   - What's unclear: The `CooccurrenceGraph.getGraph()` returns a graphology `AbstractGraph`. Building L_norm requires iterating over nodes and edges to construct degree matrix D and adjacency matrix A as a dense array, then using `mathjs.eigs()`.
   - Recommendation: In `vonNeumannEntropy()`, accept the graphology graph as input, iterate `graph.forEachNode()` and `graph.forEachEdge()` to build L_norm as a mathjs matrix, then eigendecompose. This avoids adding any matrix library to the SOC inputs interface.

2. **K_n Validation of Von Neumann Entropy Formula**
   - What we know: CONTEXT.md states `S(K_n) = ln(n)`. PITFALLS.md confirms this as the canonical cross-validation.
   - What's unclear: The exact matrix normalization that yields `ln(n)` rather than `ln(n-1)` depends on whether the density matrix is `L_norm / trace(L_norm)` or `L_norm / n`. For K_n, trace(L_norm) = n (since all diagonal entries of L_norm are 1 for the normalized Laplacian), so these are equivalent. But the claim `S(K_n) = ln(n)` needs empirical verification on a small K_3 or K_4 during test authoring.
   - Recommendation: Write the K_n test first, run it, and if it fails, adjust the density matrix normalization. This is the highest-priority correctness test.

3. **Edge Iteration Numbering in Tests**
   - What we know: `createdAtIteration` is set at CooccurrenceGraph ingest time; the field is on graphology edge attributes (not on the `TextEdge` interface, which is a static type — the actual runtime data lives in `graph.getEdgeAttribute(edge, 'createdAtIteration')`).
   - What's unclear: SOCTracker receives new edge data as an input interface. Should it receive a reference to the live graphology graph and filter by iteration attribute, or a pre-filtered edge list?
   - Recommendation: Pre-filter (pass `ReadonlyArray<{source, target}>` of new edges only). This keeps SOCTracker a pure consumer with no graphology dependency. Phase 5 Orchestrator extracts new edges by filtering `graph.edges()` by `createdAtIteration === currentIteration`.

---

## Test Plan by Requirement

### SOC-01: Von Neumann Entropy Tests

| Test ID | What | Expected |
|---------|------|----------|
| T-VN-01 | `vonNeumannEntropy(K_3)` | `≈ ln(3) ≈ 1.0986` |
| T-VN-02 | `vonNeumannEntropy(K_n)` generalized for n=4,5 | `≈ ln(n)` within 1e-10 |
| T-VN-03 | `vonNeumannEntropy(path graph P_n)` | `< ln(n)` (strictly less) |
| T-VN-04 | `vonNeumannEntropy(single node, no edges)` | `0` (no edges → L_norm = 0 → zero entropy) |
| T-VN-05 | Entropy never exceeds `ln(n)` for any valid graph | Invariant holds across 10 random graphs |

### SOC-02: Embedding Entropy Tests

| Test ID | What | Expected |
|---------|------|----------|
| T-EE-01 | Identical embeddings (all same vector) | `≈ 0` |
| T-EE-02 | d orthogonal unit vectors | `≈ ln(d)` within 1e-8 |
| T-EE-03 | Two embeddings at 90° | `= ln(2) ≈ 0.693` |
| T-EE-04 | Empty embedding set | `= 0` |
| T-EE-05 | Single embedding | `= 0` |

### SOC-03: Event Emission Tests

| Test ID | What | Expected |
|---------|------|----------|
| T-EV-01 | `computeAndEmit()` fires `soc:metrics` event | Event listener called once per iteration |
| T-EV-02 | Event payload contains all 8 fields | `{ iteration, timestamp, vonNeumannEntropy, embeddingEntropy, cdp, surprisingEdgeRatio, correlationCoefficient, isPhaseTransition }` |
| T-EV-03 | `getMetricsHistory()` grows by 1 per call | History length = call count |
| T-EV-04 | `getLatestMetrics()` returns last entry | Matches last `computeAndEmit()` inputs |
| T-EV-05 | `getMetricsTrend(5)` returns `{ mean, slope }` | slope > 0 if entropy is growing |

### SOC-04: Surprising Edge Ratio Tests

| Test ID | What | Expected |
|---------|------|----------|
| T-SE-01 | All new edges are intra-community → ratio = 0 | `surprisingEdgeRatio = 0.0` |
| T-SE-02 | All new edges are cross-community AND low similarity → ratio = 1 | `surprisingEdgeRatio = 1.0` |
| T-SE-03 | Cross-community but HIGH similarity → not surprising | Ratio = 0 (semantic criterion fails) |
| T-SE-04 | No new edges this iteration → ratio = 0 | `surprisingEdgeRatio = 0` (no division by zero) |
| T-SE-05 | Per-iteration isolation: surprising edges from prior iterations don't count | Ratio reflects current iteration only |

### SOC-05: Phase Transition Detection Tests

| Test ID | What | Expected |
|---------|------|----------|
| T-PT-01 | Synthetic trajectory: ΔS_struct and ΔS_sem correlate positively for 10 iterations, then negatively | `phase:transition` fires at the sign change |
| T-PT-02 | Stable trajectory (both deltas always same sign) | No `phase:transition` event |
| T-PT-03 | No hard-coded `400` in source | Grep test passes |
| T-PT-04 | Window size is configurable | Smaller window → earlier detection on same trajectory |

### SOC Isolation Test

| Test ID | What | Expected |
|---------|------|----------|
| T-ISO-01 | `src/soc/` has zero imports from `src/lcm/` | Grep test passes |
| T-ISO-02 | `src/soc/` has zero imports from `src/orchestrator/` | Grep test passes |
| T-ISO-03 | No literal `400` in production SOC files | Grep test passes |

---

## Sources

### Primary (HIGH confidence)

- `src/types/GraphTypes.ts` — `SheafEigenspectrum` interface (eigenvalues: Float64Array, computedAtIteration: number)
- `src/tna/interfaces.ts` — `TextEdge.createdAtIteration` field; `TextNode.communityId`; `CommunityAssignment`
- `src/tna/CooccurrenceGraph.ts` — `getGraph()` returns graphology `AbstractGraph`; edges have `{ weight, createdAtIteration }` attributes
- `src/tna/LouvainDetector.ts` — `LouvainResult.assignments: ReadonlyMap<string, number>`
- `src/lcm/interfaces.ts` — `IEmbedder`, `MockEmbedder`, `EMBEDDING_DIM = 384`
- `src/sheaf/CohomologyAnalyzer.ts` — EventEmitter pattern; `ml-matrix.SingularValueDecomposition` usage
- `src/sheaf/SheafLaplacian.ts` — `math.eigs()` pattern with `toArray()` extraction
- `.planning/research/PITFALLS.md` — Pitfalls 2, 3, 9, 11 directly address SOC-01 through SOC-05
- `.planning/ROADMAP.md` — Phase 4 success criteria (5 items); ROADMAP SC-3, SC-5 requirements
- `.planning/phases/04-soc/04-CONTEXT.md` — All locked decisions for this phase
- `package.json` — Confirmed: `mathjs@15.1.1`, `ml-matrix@6.12.1`, `@huggingface/transformers@3.8.1` installed; NO new dependencies needed

### Secondary (MEDIUM confidence)

- `.planning/research/STACK.md` — SOC metrics stack recommendation (`simple-statistics` listed but not installed; inline implementation preferred)
- `.planning/STATE.md` — Open question: embedding model selection (all-MiniLM-L6-v2 384-dim confirmed for LCM; same for SOC per STACK.md recommendation)
- "Self-Organizing Graph Reasoning Evolves into a Critical State" (AIP Chaos, 2025; arXiv:2503.18852v1) — cited in PITFALLS.md as the source for CDP definition, ~12% surprising edge ratio, iteration ~400 phase transition

### Tertiary (LOW confidence — flag for validation)

- K_n Von Neumann entropy result `S(K_n) = ln(n)`: cited in PITFALLS.md and CONTEXT.md as the canonical test. The mathematical derivation shows `S = ln(n-1)` for one normalization convention. The correct result `ln(n)` may depend on the specific density matrix construction. **MUST be verified empirically before any entropy code is shipped** — write the K_n test first.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified in `package.json`; no new installs required
- Architecture: HIGH — patterns directly taken from Phase 1 and Phase 3 existing code
- Mathematical formulas: HIGH for the entropy formulas themselves; MEDIUM for the K_n normalization (see Open Question 2)
- Pitfalls: HIGH — drawn from PITFALLS.md which was authored with HIGH confidence and verified against the codebase
- Test plan: HIGH — each test derives directly from a locked decision in CONTEXT.md

**Research date:** 2026-02-28
**Valid until:** 2026-04-01 (stable mathematical domain; dependencies are locked versions)

---

## Wave Decomposition Recommendation

Based on the CONTEXT.md decisions and the isolation patterns established in prior phases, Phase 4 should be implemented in two waves:

**Wave 1 (04-01-PLAN.md):** Pure mathematical functions + types
- `src/types/Events.ts` additions: `SOCMetricsEvent`, `SOCPhaseTransitionEvent`
- `src/soc/interfaces.ts`: `SOCInputs`, `SOCMetrics` types
- `src/soc/entropy.ts`: `vonNeumannEntropy()`, `embeddingEntropy()` pure functions
- `src/soc/entropy.test.ts`: All T-VN-* and T-EE-* guard tests
- Files modified: `src/types/Events.ts`, new `src/soc/entropy.ts`, new `src/soc/entropy.test.ts`, new `src/soc/interfaces.ts`
- Tests pass: 10+ entropy guard tests (the two formulas, validated independently)

**Wave 2 (04-02-PLAN.md):** SOCTracker class + event emission + isolation
- `src/soc/correlation.ts`: `pearsonCorrelation()`, `linearSlope()` pure functions
- `src/soc/SOCTracker.ts`: Main class extending EventEmitter; full metric history; all five metrics computed per-iteration
- `src/soc/SOCTracker.test.ts`: CDP, surprising edge ratio, phase transition detection, event emission, history access
- `src/soc/isolation.test.ts`: Zero cross-module imports + no literal 400
- `src/soc/index.ts`: Barrel export
- Tests pass: All ROADMAP Phase 4 success criteria (SOC-01 through SOC-05)
