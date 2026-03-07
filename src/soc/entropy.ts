/**
 * entropy.ts — SOC pure entropy functions (SOC-01, SOC-02)
 *
 * Two entropy measures for Self-Organized Criticality tracking:
 *
 * 1. vonNeumannEntropy — structural complexity of the TNA co-occurrence graph
 *    via the normalized Laplacian density matrix eigenspectrum.
 *    Formula: S = -Σ p_i * ln(p_i) where p_i = eigenvalues of ρ = L_norm / trace(L_norm)
 *    L_norm = I - D^(-1/2) A D^(-1/2) (normalized Laplacian)
 *
 * 2. embeddingEntropy — semantic diversity of node embeddings
 *    via the covariance matrix eigenspectrum.
 *    Formula: S = -Σ p_i * ln(p_i) where p_i are normalized eigenvalues of Σ = (1/n) E^T E
 *
 * 3. cosineSimilarity — utility for surprising edge detection (Wave 2)
 *    Copied from LCM module pattern; not imported from src/lcm/ (isolation invariant).
 *
 * Libraries:
 *   - mathjs: math.eigs() for normalized Laplacian eigendecomposition (SOC-01)
 *   - ml-matrix: EigenvalueDecomposition for covariance eigenspectrum (SOC-02)
 *
 * Isolation invariant: ZERO imports from src/tna/, src/lcm/, or src/orchestrator/.
 *
 * Validation results (K_n correctness gate — RESEARCH.md §Pattern 1):
 *   S(K_n) = ln(n-1) for the normalized Laplacian density matrix formula.
 *   CONTEXT.md/ROADMAP state ln(n), but the mathematical derivation gives ln(n-1).
 *   See 04-01-SUMMARY.md §Deviations for full documentation of this difference.
 *   The formula rho = L_norm / trace(L_norm) with K_n:
 *     - L_norm eigenvalues: 0 (once), n/(n-1) (n-1 times); trace = n
 *     - rho eigenvalues: 0 (once), 1/(n-1) (n-1 times)
 *     - S = -(n-1) * (1/(n-1)) * ln(1/(n-1)) = ln(n-1)
 */

import * as math from "mathjs";
import { Matrix as MlMatrix, EigenvalueDecomposition } from "ml-matrix";

// ---------------------------------------------------------------------------
// Von Neumann Entropy (SOC-01)
// ---------------------------------------------------------------------------

/**
 * vonNeumannEntropy — structural complexity of the TNA co-occurrence graph.
 *
 * Builds the normalized Laplacian L_norm = I - D^(-1/2) A D^(-1/2) from the
 * given adjacency list, computes the density matrix rho = L_norm / trace(L_norm),
 * eigendecomposes rho, and returns the Von Neumann entropy S = -Σ p_i * ln(p_i).
 *
 * Algorithm:
 *   a. If nodeCount <= 1 or edges.length === 0, return 0.
 *   b. Build adjacency matrix A (nodeCount x nodeCount) from edges (undirected).
 *   c. Compute degree D[i] = Σ_j A[i][j].
 *   d. Compute D^(-1/2)[i] = 1/sqrt(D[i]) if D[i] > 0, else 0.
 *   e. Build L_norm[i][j] = (i===j ? 1 : 0) - D^(-1/2)[i] * A[i][j] * D^(-1/2)[j].
 *   f. Compute trace(L_norm) = Σ_i L_norm[i][i].
 *   g. Divide L_norm by trace to get density matrix rho = L_norm / trace(L_norm).
 *   h. Eigendecompose rho via math.eigs(). Extract real eigenvalues.
 *   i. Entropy: S = -Σ p_i * ln(p_i) for p_i > 1e-12.
 *
 * Notes on K_n validation:
 *   For K_n (complete graph on n nodes), this formula gives S = ln(n-1).
 *   The maximum achievable entropy for an n-node graph is ln(n-1) (achieved by K_n),
 *   not ln(n) as stated in the ROADMAP. See module-level comment for derivation.
 *
 * @param nodeCount - Number of nodes (0..nodeCount-1 as numeric indices).
 * @param edges - Adjacency list (undirected: each edge listed once).
 * @returns Von Neumann entropy in nats (natural log). Returns 0 for degenerate cases.
 */
export function vonNeumannEntropy(
  nodeCount: number,
  edges: ReadonlyArray<{ source: number; target: number; weight: number }>,
): number {
  // Degenerate cases
  if (nodeCount <= 1 || edges.length === 0) return 0;

  const n = nodeCount;

  // Step b: Build adjacency matrix A (n x n) using 2D array
  const A: number[][] = Array.from(
    { length: n },
    () => new Array(n).fill(0) as number[],
  );
  for (const edge of edges) {
    const { source, target, weight } = edge;
    if (source < 0 || source >= n || target < 0 || target >= n) continue;
    if (source === target) continue; // skip self-loops
    A[source]![target] = (A[source]![target] ?? 0) + weight;
    A[target]![source] = (A[target]![source] ?? 0) + weight;
  }

  // Step c: Compute degree vector D[i] = Σ_j A[i][j]
  const D = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      D[i] = (D[i] ?? 0) + (A[i]![j] ?? 0);
    }
  }

  // Step d: Compute D^(-1/2)[i] = 1/sqrt(D[i]) if D[i] > 0, else 0
  const D_inv_sqrt = D.map((d) => (d > 0 ? 1 / Math.sqrt(d) : 0));

  // Step e: Build normalized Laplacian L_norm[i][j]
  // L_norm = I - D^(-1/2) A D^(-1/2)
  const L_norm: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      const identity = i === j ? 1 : 0;
      const normalized =
        (D_inv_sqrt[i] ?? 0) * (A[i]![j] ?? 0) * (D_inv_sqrt[j] ?? 0);
      return identity - normalized;
    }),
  );

  // Step f: trace(L_norm) = Σ L_norm[i][i]
  // For a connected graph with no isolated nodes: trace = n (algebraic property of L_norm).
  // We compute it directly to handle disconnected components correctly.
  let traceL = 0;
  for (let i = 0; i < n; i++) {
    traceL += L_norm[i]![i] ?? 0;
  }

  if (traceL < 1e-12) return 0; // degenerate: no structure

  // Step g: density matrix rho = L_norm / trace(L_norm)
  const rho: number[][] = L_norm.map((row) => row.map((val) => val / traceL));

  // Step h: Eigendecompose rho using math.eigs()
  // math.eigs() returns eigenvalues for symmetric matrices
  const mathRho = math.matrix(rho);
  let eigenvalues: number[];
  try {
    const result = math.eigs(mathRho);
    const vals = result.values;
    if (Array.isArray(vals)) {
      eigenvalues = vals as number[];
    } else {
      eigenvalues = (vals as math.Matrix).toArray() as number[];
    }
  } catch {
    // Fallback: eigendecomposition failed (e.g., all-zero matrix)
    return 0;
  }

  // Step i: Entropy S = -Σ p_i * ln(p_i) for p_i > 1e-12
  // Eigenvalues of rho are the probability weights (they sum to 1 by construction).
  // Clamp small negatives to zero (numerical artifact of floating-point arithmetic).
  let entropy = 0;
  for (const rawLambda of eigenvalues) {
    const lambda = typeof rawLambda === "number" ? rawLambda : 0;
    const p = Math.max(0, lambda);
    if (p > 1e-12) {
      entropy -= p * Math.log(p);
    }
  }

  return entropy;
}

// ---------------------------------------------------------------------------
// Embedding Entropy (SOC-02)
// ---------------------------------------------------------------------------

/**
 * embeddingEntropy — semantic diversity of node embedding vectors.
 *
 * Constructs the embedding covariance matrix Σ = (1/n) E^T E where E is the
 * n×d matrix of embedding vectors (rows = nodes, cols = dimensions), then
 * computes the Von Neumann entropy of the normalized eigenspectrum of Σ.
 *
 * Algorithm:
 *   a. If embeddings.length <= 1, return 0.
 *   b. Get n = embeddings.length, d = embeddings[0].length.
 *   c. Build covariance Σ = (1/n) * Σ_k (emb_k ⊗ emb_k^T) — d×d matrix.
 *   d. Eigendecompose Σ via EigenvalueDecomposition. Extract realEigenvalues.
 *   e. Clamp negative eigenvalues to 0 (numerical artifact guard — RESEARCH.md Pitfall 5).
 *   f. Normalize: p_i = max(0, λ_i) / Σ_j max(0, λ_j). If sum=0, return 0.
 *   g. Entropy: S = -Σ p_i * ln(p_i) for p_i > 1e-12.
 *
 * Validation:
 *   - Identical embeddings: rank-1 covariance → normalized eigenspectrum [1, 0, ...] → S ≈ 0
 *   - d orthogonal unit vectors: Σ = (1/d)I_d → equal eigenvalues → S = ln(d)
 *   - Single embedding: returns 0 (handled by early return at step a)
 *   - Empty: returns 0 (handled by early return at step a)
 *
 * Performance note:
 *   Building Σ is O(n * d^2). For d=384 and n=200 nodes, this is ~28M operations.
 *   Eigendecomposition of Σ is O(d^3) ≈ 56M operations for d=384.
 *   Acceptable for Phase 4. Phase 6 can add random projection if n or d grows large.
 *   See RESEARCH.md §Pattern 2 performance note.
 *
 * @param embeddings - Array of embedding vectors (Float64Array[]).
 *                     All vectors must have the same dimension.
 * @returns Embedding entropy in nats (natural log). Returns 0 for degenerate cases.
 */
export function embeddingEntropy(embeddings: Float64Array[]): number {
  // Step a: Degenerate cases
  if (embeddings.length <= 1) return 0;

  const n = embeddings.length;
  const d = embeddings[0]!.length;

  if (d === 0) return 0;

  // Step c: Build covariance matrix Σ = (1/n) * E^T * E (d x d)
  // Σ[i][j] = (1/n) * Σ_k emb_k[i] * emb_k[j]
  const Sigma = new MlMatrix(d, d);
  for (const emb of embeddings) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        Sigma.set(i, j, Sigma.get(i, j) + (emb[i] ?? 0) * (emb[j] ?? 0));
      }
    }
  }
  // Scale by 1/n
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      Sigma.set(i, j, Sigma.get(i, j) / n);
    }
  }

  // Step d: Eigendecompose Σ using ml-matrix EigenvalueDecomposition
  const eig = new EigenvalueDecomposition(Sigma);
  const rawEigenvalues: number[] = eig.realEigenvalues;

  // Step e: Clamp negative eigenvalues to 0 (numerical artifacts from floating point)
  // Step f: Normalize to probability distribution
  let sum = 0;
  for (const lambda of rawEigenvalues) {
    sum += Math.max(0, lambda);
  }

  if (sum < 1e-12) return 0; // all eigenvalues effectively zero → no diversity

  // Step g: Entropy S = -Σ p_i * ln(p_i)
  let entropy = 0;
  for (const lambda of rawEigenvalues) {
    const p = Math.max(0, lambda) / sum;
    if (p > 1e-12) {
      entropy -= p * Math.log(p);
    }
  }

  return entropy;
}

// ---------------------------------------------------------------------------
// Cosine Similarity utility (for Wave 2 surprising edge detection)
// ---------------------------------------------------------------------------

/**
 * cosineSimilarity(a, b) — computes cosine similarity between two vectors.
 *
 * Formula: dot(a, b) / (norm(a) * norm(b))
 *
 * Copied from src/lcm/LCMGrep.ts pattern without importing from that module
 * (isolation invariant: SOC module has zero cross-module imports).
 *
 * @param a - First vector (Float64Array).
 * @param b - Second vector (Float64Array).
 * @returns Cosine similarity in range [-1, 1]. Returns 0 if either vector is zero-norm.
 */
export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA < 1e-12 || normB < 1e-12) return 0;
  return dot / (normA * normB);
}
