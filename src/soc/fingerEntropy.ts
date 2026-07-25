/**
 * fingerEntropy.ts — linear-time von Neumann graph entropy (FINGER).
 *
 * Why
 * ---
 * `vonNeumannEntropy()` in entropy.ts builds a DENSE n×n normalized Laplacian
 * and calls `math.eigs()` on it: O(n²) memory and O(n³) time in pure JS. AGEM's
 * concept graph is persistent and accumulates across every cycle of a session,
 * so this cost is per-cycle and rising. Measured on this repo
 * (`src/orchestrator/phase-timing.bench.ts`):
 *
 *     121 nodes →   0.33 s      382 nodes →  14.5 s
 *     201 nodes →   1.69 s      800 nodes →  ~2.8 min  (extrapolated, n^3.3)
 *
 * A session that ingests a few real corpora stalls.
 *
 * Method
 * ------
 * Chen et al., "Fast Incremental von Neumann Graph Entropy Computation: Theory,
 * Algorithm, and Applications" (ICML 2019) — FINGER. Approximate
 * H = −Σ λᵢ ln λᵢ by replacing the λ ln λ term with its quadratic Taylor
 * expansion, which collapses the whole spectrum into a single trace:
 *
 *     Q = 1 − tr(ρ²)                                            (Lemma 1)
 *     Ĥ = −Q · ln λ_max                                         (Eq. 1)
 *
 * `tr(ρ²)` is a sum over nodes and edges — no eigendecomposition — and λ_max
 * alone comes from power iteration. Both are O(n + m).
 *
 * IMPORTANT — this is a re-derivation, not a transcription
 * -------------------------------------------------------
 * FINGER derives its closed form for the COMBINATORIAL Laplacian scaled by its
 * trace, giving Q = 1 − c²(Σ sᵢ² + 2Σ wᵢⱼ²) with c = 1/Σsᵢ. AGEM does not use
 * that matrix. entropy.ts uses the SYMMETRIC NORMALIZED Laplacian
 * L = I − D^(−1/2) A D^(−1/2), with ρ = L / tr(L). Applying FINGER's published
 * formula directly here would silently compute a different quantity.
 *
 * What generalises is the identity Q = 1 − tr(ρ²); only the closed form for
 * tr(ρ²) is matrix-specific. For AGEM's L:
 *
 *   • L[i][i] = 1 for every node (A has no self-loops), so tr(L) = n exactly,
 *     including isolated nodes.
 *   • L[i][j] = −wᵢⱼ/√(dᵢdⱼ) off-diagonal.
 *   • tr(L²) = Σᵢⱼ L[i][j]² = n + 2·Σ_{(i,j)∈E} wᵢⱼ²/(dᵢdⱼ)
 *   • tr(ρ²) = tr(L²)/n²
 *
 *   ⇒ Q = 1 − [ n + 2·Σ wᵢⱼ²/(dᵢdⱼ) ] / n²
 *
 * Validation on the complete graph Kₙ (the case entropy.ts documents):
 *   dᵢ = n−1, so tr(ρ²) = [n + n/(n−1)]/n² = 1/(n−1), giving Q = (n−2)/(n−1).
 *   λ_max(ρ) = 1/(n−1), so Ĥ = (n−2)/(n−1)·ln(n−1) against the exact
 *   H = ln(n−1) — a relative error of 1/(n−1), which VANISHES as the graph
 *   grows. Approximation quality improves exactly where it is needed.
 *   (`fingerEntropy.test.ts` asserts this against the real exact solver.)
 *
 * Ĥ is a lower bound on H (FINGER Theorem 1), so the metric reads slightly
 * conservative rather than optimistic — the safe direction for a system whose
 * README makes a point of not over-claiming its metrics.
 *
 * Determinism
 * -----------
 * Power iteration starts from a FIXED vector, never Math.random, so the same
 * graph always yields the same entropy. AGEM treats reproducibility as a
 * correctness property (cf. the seeded Louvain detector).
 */

/** Undirected weighted edge, node ids are indices in [0, nodeCount). */
export interface WeightedEdge {
  source: number;
  target: number;
  weight: number;
}

export interface FingerOptions {
  /** Power-iteration cap. */
  maxIterations?: number;
  /**
   * Relative residual ‖Lx − λx‖ / λ at which λ_max is accepted.
   *
   * NOT a delta between successive iterates. The Rayleigh quotient jitters at
   * a noise floor around 1e-5..1e-7 on these graphs and never settles below
   * it, so a successive-delta test with a tight tolerance can never fire and
   * reports spurious non-convergence. The residual is the standard criterion
   * and, because L is symmetric, it is also a genuine ERROR BOUND:
   * |λ_true − λ̂| ≤ ‖Lx − λ̂x‖.
   */
  tolerance?: number;
}

export interface FingerResult {
  /** Ĥ — the approximate von Neumann entropy, in nats. */
  entropy: number;
  /** Q = 1 − tr(ρ²). */
  q: number;
  /** Largest eigenvalue of ρ. */
  lambdaMax: number;
  /** Power-iteration steps actually taken. */
  iterations: number;
  /** True when the residual bound was met before the iteration cap. */
  converged: boolean;
  /**
   * Relative residual at exit — an upper bound on the relative error in
   * λ_max, and hence (to first order) on the absolute error in ln λ_max.
   * Multiply by Q for the entropy error bound.
   */
  relativeResidual: number;
  nodeCount: number;
  edgeCount: number;
}

const DEFAULTS: Required<FingerOptions> = {
  maxIterations: 1000,
  /*
   * 1e-4 relative residual ⇒ entropy error ≤ Q·1e-4 ≈ 1e-4 nats, against a
   * metric whose useful range is 0–7 nats and which feeds a three-way regime
   * classifier. Measured behaviour that set this number:
   *
   *   hub-heavy graph (realistic for word co-occurrence), n=1500:
   *     200 iters → residual 2.0e-3   H = 6.69163
   *    5000 iters → residual 4.3e-10  H = 6.69104
   *   near-regular graph (pathological, clustered spectrum), n=500:
   *     200 iters → residual 1.3e-3   H = 5.65247
   *    5000 iters → residual 8.6e-5   H = 5.65201
   *
   * H is stable to ~5 decimal places from a couple of hundred iterations in
   * BOTH cases. Chasing a tighter residual buys precision the metric cannot
   * use. Note that on near-regular graphs plain power iteration plateaus at a
   * noise floor around 1e-4 and `converged` may stay false — that flag means
   * "residual target not met", NOT "result unusable"; `relativeResidual`
   * still bounds the error and stays around 2e-4 in the worst case observed.
   * A Lanczos solver would converge faster on clustered spectra if this ever
   * needs to be tighter.
   */
  tolerance: 1e-4,
};

/** Compact adjacency built once and shared by both phases. */
export interface Adjacency {
  /** Deduplicated undirected edges with accumulated weights. */
  edges: WeightedEdge[];
  /** Weighted degree per node. */
  degrees: Float64Array;
  /** 1/sqrt(degree), or 0 for isolated nodes. */
  invSqrtDeg: Float64Array;
}

/**
 * Accumulate the edge list exactly as the dense builder in entropy.ts does:
 * skip self-loops and out-of-range ids, and SUM the weights of repeated pairs.
 * Any divergence here would make the two implementations disagree on the same
 * input for reasons that have nothing to do with the approximation.
 */
export function buildAdjacency(
  nodeCount: number,
  edges: ReadonlyArray<WeightedEdge>,
): Adjacency {
  const merged = new Map<number, WeightedEdge>();
  for (const e of edges) {
    const { source, target, weight } = e;
    if (source < 0 || source >= nodeCount) continue;
    if (target < 0 || target >= nodeCount) continue;
    if (source === target) continue;
    const lo = source < target ? source : target;
    const hi = source < target ? target : source;
    const key = lo * nodeCount + hi;
    const existing = merged.get(key);
    if (existing) existing.weight += weight;
    else merged.set(key, { source: lo, target: hi, weight });
  }

  const list = [...merged.values()];
  const degrees = new Float64Array(nodeCount);
  for (const e of list) {
    degrees[e.source] += e.weight;
    degrees[e.target] += e.weight;
  }

  const invSqrtDeg = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    invSqrtDeg[i] = degrees[i] > 0 ? 1 / Math.sqrt(degrees[i]) : 0;
  }

  return { edges: list, degrees, invSqrtDeg };
}

/**
 * Q = 1 − tr(ρ²) for ρ = L/n, L = I − D^(−1/2) A D^(−1/2).
 *
 * Exported so the incremental path and the tests can use it directly.
 */
export function computeQ(
  nodeCount: number,
  adjacency: Adjacency,
): number {
  const n = nodeCount;
  // tr(L²) = n (the unit diagonal) + both orientations of every off-diagonal.
  let offDiagonal = 0;
  for (const e of adjacency.edges) {
    const di = adjacency.degrees[e.source];
    const dj = adjacency.degrees[e.target];
    if (di <= 0 || dj <= 0) continue;
    offDiagonal += (e.weight * e.weight) / (di * dj);
  }
  const traceLSquared = n + 2 * offDiagonal;
  return 1 - traceLSquared / (n * n);
}

/**
 * λ_max of ρ by power iteration — O(n + m) per step, no dense matrix.
 *
 * L is positive semi-definite, so its largest-magnitude eigenvalue IS λ_max
 * and plain power iteration suffices (no shifting or deflation needed).
 */
function lambdaMaxOfRho(
  nodeCount: number,
  adjacency: Adjacency,
  opts: Required<FingerOptions>,
): {
  lambdaMax: number;
  iterations: number;
  converged: boolean;
  relativeResidual: number;
} {
  const n = nodeCount;
  let x = new Float64Array(n);
  // Fixed, non-uniform start. A uniform vector can be orthogonal to the
  // dominant eigenvector on symmetric graphs and stall the iteration.
  for (let i = 0; i < n; i++) x[i] = 1 + ((i * 2654435761) % 1000) / 1000;
  normalize(x);

  let y = new Float64Array(n);
  let lambda = 0;
  let iterations = 0;
  let converged = false;
  let relativeResidual = Number.POSITIVE_INFINITY;

  for (let it = 1; it <= opts.maxIterations; it++) {
    iterations = it;
    // y = L·x = x − D^(−1/2) A D^(−1/2) x
    for (let i = 0; i < n; i++) y[i] = x[i];
    for (const e of adjacency.edges) {
      const i = e.source;
      const j = e.target;
      const scaled = e.weight * adjacency.invSqrtDeg[i] * adjacency.invSqrtDeg[j];
      if (scaled === 0) continue;
      y[i] -= scaled * x[j];
      y[j] -= scaled * x[i];
    }

    // Rayleigh quotient (x is unit-norm, so this is just x·y).
    let rayleigh = 0;
    for (let i = 0; i < n; i++) rayleigh += x[i] * y[i];
    lambda = rayleigh;

    // Residual ‖Lx − λx‖. For symmetric L this bounds |λ_true − λ̂|, so it is
    // both a stopping rule and a reportable error bound.
    let residualSq = 0;
    for (let i = 0; i < n; i++) {
      const d = y[i] - lambda * x[i];
      residualSq += d * d;
    }
    relativeResidual =
      lambda > 0 ? Math.sqrt(residualSq) / lambda : Number.POSITIVE_INFINITY;

    if (relativeResidual <= opts.tolerance) {
      converged = true;
      break;
    }

    const norm = normalize(y);
    if (norm === 0) {
      lambda = 0;
      converged = true;
      relativeResidual = 0;
      break;
    }

    const swap = x;
    x = y;
    y = swap;
  }

  // ρ = L/tr(L) and tr(L) = n, so scale the eigenvalue accordingly.
  return { lambdaMax: lambda / n, iterations, converged, relativeResidual };
}

/** In-place L2 normalisation. Returns the pre-normalisation norm. */
function normalize(v: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return norm;
}

/**
 * fingerVonNeumannEntropy — Ĥ = −Q ln λ_max, in O(n + m).
 *
 * Drop-in replacement for `vonNeumannEntropy(nodeCount, edges)` with the same
 * signature and the same degenerate-case behaviour (returns 0).
 */
export function fingerVonNeumannEntropy(
  nodeCount: number,
  edges: ReadonlyArray<WeightedEdge>,
  options: FingerOptions = {},
): FingerResult {
  const opts = { ...DEFAULTS, ...options };
  const empty: FingerResult = {
    entropy: 0,
    q: 0,
    lambdaMax: 0,
    iterations: 0,
    converged: true,
    relativeResidual: 0,
    nodeCount,
    edgeCount: 0,
  };

  if (nodeCount <= 1 || edges.length === 0) return empty;

  const adjacency = buildAdjacency(nodeCount, edges);
  if (adjacency.edges.length === 0) return empty;

  const q = computeQ(nodeCount, adjacency);
  const { lambdaMax, iterations, converged, relativeResidual } = lambdaMaxOfRho(
    nodeCount,
    adjacency,
    opts,
  );

  // λ_max ≥ 1 would mean ρ is a pure state (H = 0); λ_max ≤ 0 means no
  // structure. FINGER's Theorem 1 excludes both as trivial.
  if (!(lambdaMax > 0) || lambdaMax >= 1 || !(q > 0)) {
    return {
      ...empty,
      q,
      lambdaMax,
      iterations,
      converged,
      relativeResidual,
      edgeCount: adjacency.edges.length,
    };
  }

  return {
    entropy: -q * Math.log(lambdaMax),
    q,
    lambdaMax,
    iterations,
    converged,
    relativeResidual,
    nodeCount,
    edgeCount: adjacency.edges.length,
  };
}

/**
 * Closed-form variant with NO eigensolver at all — FINGER's H̃.
 *
 * Uses the standard bound λ_max(L) ≤ 2 for the normalized Laplacian, hence
 * λ_max(ρ) ≤ 2/n. Cheaper than Ĥ but markedly looser (on Kₙ it is ~12% low at
 * n≈400 where Ĥ is ~0.26% low), because the bound is slack for anything but a
 * graph with a near-degree-n hub. Provided as a fallback for the case where
 * power iteration fails to converge.
 */
export function fingerVonNeumannEntropyClosedForm(
  nodeCount: number,
  edges: ReadonlyArray<WeightedEdge>,
): number {
  if (nodeCount <= 2 || edges.length === 0) return 0;
  const adjacency = buildAdjacency(nodeCount, edges);
  if (adjacency.edges.length === 0) return 0;
  const q = computeQ(nodeCount, adjacency);
  const lambdaMaxBound = 2 / nodeCount;
  if (!(q > 0) || lambdaMaxBound >= 1) return 0;
  return -q * Math.log(lambdaMaxBound);
}
