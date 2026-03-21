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
export declare function vonNeumannEntropy(nodeCount: number, edges: ReadonlyArray<{
    source: number;
    target: number;
    weight: number;
}>): number;
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
export declare function embeddingEntropy(embeddings: Float64Array[]): number;
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
export declare function cosineSimilarity(a: Float64Array, b: Float64Array): number;
//# sourceMappingURL=entropy.d.ts.map