# Pitfalls Research

**Domain:** Multi-agent AI frameworks — Sheaf theory, Molecular-CoT reasoning, SOC tracking, Text Network Analysis (TypeScript/JavaScript implementation)
**Researched:** 2026-02-27
**Confidence:** HIGH

---

## Critical Pitfalls

### Pitfall 1: Sheaf Laplacian Computed as Standard Graph Laplacian

**What goes wrong:**
The Sheaf Laplacian `L = B^T B` is structurally similar to the standard combinatorial graph Laplacian but is fundamentally different — it operates over the direct sum of stalk spaces, not over scalar vertex labels. Implementations that substitute `L_graph = D - A` (the ordinary graph Laplacian) produce a matrix that ignores restriction map contributions entirely. Consensus computation silently produces wrong results: the null space of `L_sheaf` (the space of global sections H^0) is not the same as the null space of `L_graph`. The system appears to converge but converges to a mathematically meaningless state.

**Why it happens:**
Both operators share the name "Laplacian" and similar matrix forms. Tutorials on multi-agent consensus almost universally use the graph Laplacian. Developers who are not fluent in sheaf theory substitute the familiar form without realizing stalk dimensions must be embedded into a larger product space.

**How to avoid:**
- Implement the coboundary operator `δ_0 : C^0(G, F) → C^1(G, F)` explicitly: for each oriented edge `(u,v)`, the coboundary maps `x ↦ F_{v←e} x_v - F_{u←e} x_u` where `F_{v←e}` is the restriction map from vertex stalk to edge stalk.
- Assert that `dim(C^0) = Σ_v dim(F(v))` and `dim(C^1) = Σ_e dim(F(e))` before any Laplacian computation.
- Write a unit test: for a two-node sheaf with consistent sections, `L_sheaf x = 0` must hold; verify this passes and that replacing with `L_graph` breaks it.
- Test the rank of `L_sheaf` against the Euler characteristic `χ = |V| - |E|` (only valid for specific stalk dimensions; document the expected rank explicitly).

**Warning signs:**
- Consensus iterations converge in 1-2 steps regardless of initial disagreement — impossibly fast for a distributed optimizer.
- The null space of your computed Laplacian has dimension equal to the number of connected components (graph Laplacian behavior) rather than the dimension of the global section space.
- H^1 (first cohomology) always returns zero even in clearly inconsistent configurations.

**Phase to address:** Phase 1 (Sheaf-Theoretic Multi-Agent Coordination foundation) — must be resolved before any consensus or cohomology work builds on top of it.

---

### Pitfall 2: Von Neumann Entropy Computed from Adjacency Matrix Instead of Density Matrix

**What goes wrong:**
Von Neumann graph entropy `S = -Tr(ρ ln ρ)` uses the normalized graph Laplacian `ρ = L / Tr(L)` as the density matrix — not the adjacency matrix `A`, not the raw Laplacian `L`, and not the degree matrix. Implementations that eigendecompose `A` or use `A / Tr(A)` as the density matrix produce entropy values with no structural interpretation. The CDP (Critical Discovery Parameter) computed from wrong structural entropy is meaningless, and the phase-transition detection at iteration ~400 will never match theoretical predictions.

**Why it happens:**
The term "graph entropy" appears in multiple incompatible contexts in the literature. Shannon entropy over degree distributions is common and easily confused with Von Neumann entropy. The density-matrix formulation requires familiarity with quantum information theory, which many software engineers lack.

**How to avoid:**
- Explicitly compute `L_norm = D^{-1/2} L D^{-1/2}` (normalized Laplacian), then `ρ = L_norm / Tr(L_norm)`.
- Use a numerically stable eigenvalue decomposition: for sparse graphs, `Tr(L_norm) = n` (number of nodes), so `ρ = L_norm / n`. Verify this identity in a unit test.
- For entropy: `S = -Σ λ_i ln(λ_i)` where the sum skips zero eigenvalues (use a small epsilon threshold like `1e-12` to avoid `ln(0)`).
- Cross-validate against a complete graph K_n: `S(K_n) = ln(n)`. Cross-validate against a path graph: entropy should be strictly less than `ln(n)`.
- Document the formula derivation as an inline comment with the source citation (the SOC paper from AIP Chaos, 2025).

**Warning signs:**
- Structural entropy never changes significantly as the graph grows (adjacency matrix eigenvalues shift but not normalized Laplacian eigenvalues).
- Entropy values exceed `ln(n)` (impossible for valid Von Neumann entropy on n-node graph).
- CDP stabilizes at a fixed value from iteration 1 regardless of graph evolution.

**Phase to address:** Phase 4 (SOC Tracking and Criticality) — but the normalization logic must be tested in isolation before integration.

---

### Pitfall 3: Embedding Entropy Conflated with Token Diversity or Vocabulary Entropy

**What goes wrong:**
Embedding entropy is a measure of semantic richness computed over the distribution of embedding vectors in high-dimensional space — conceptually related to differential entropy or the rank/eigenspectrum of the embedding covariance matrix. Implementations that compute Shannon entropy over token frequencies, vocabulary sizes, or even cosine similarity histograms produce a number that correlates weakly with true semantic diversity. The structural-semantic cross-correlation that drives phase-transition detection becomes noise.

**Why it happens:**
"Embedding entropy" is not a single canonical formula across the literature. The SOC paper computes it via the eigenspectrum of the semantic embedding covariance. Developers reaching for an entropy formula often grab the simpler Shannon variant because it is well-understood and already implemented in many ML toolkits.

**How to avoid:**
- Collect all active embedding vectors into a matrix `E` (rows = concepts, cols = embedding dimensions).
- Compute the covariance `Σ = (1/n) E^T E` (or centered covariance).
- Compute eigenvalues `{λ_i}` of `Σ`, normalize to `p_i = λ_i / Σλ_j`.
- Entropy: `H_emb = -Σ p_i ln(p_i)`, skipping zero eigenvalues.
- This is expensive (O(d^2 n) for d-dimensional embeddings). For reference implementations, cap at 512-dim embeddings with periodic (not per-iteration) recomputation.
- Write a test: two identical embeddings should have near-zero entropy; maximally spread orthogonal embeddings should approach `ln(d)`.

**Warning signs:**
- Semantic entropy tracks node count linearly (vocabulary Shannon entropy behavior).
- Adding synonyms to the graph increases entropy (vocabulary-level artifact — true semantic entropy would not change for semantically identical content).
- CDP is always positive (structural entropy dominates), which contradicts the theoretical requirement for `CDP < 0` in the critical regime.

**Phase to address:** Phase 4 (SOC Tracking) — implement and validate the two entropy formulas independently with known test vectors before building the CDP.

---

### Pitfall 4: Restriction Maps Defined as Identity Maps (Flat Sheaf Shortcut)

**What goes wrong:**
The simplest valid sheaf is a flat sheaf where all restriction maps are identity matrices (all stalks are the same dimension, no projection). Implementing flat sheaves as a starting point is reasonable for testing, but shipping a reference implementation where restriction maps are hardcoded to identity matrices eliminates the entire theoretical value of sheaf theory: heterogeneous agent state spaces cannot be modeled, and non-trivial cohomology (H^1 obstructions) can never be detected because flat sheaves on connected graphs have trivial H^1.

**Why it happens:**
Identity restriction maps require no domain knowledge to implement. They produce a working system that passes basic consensus tests. The failure mode — inability to detect real obstructions — only surfaces in multi-agent configurations with genuinely incompatible local objectives, which are hard to construct in synthetic test cases.

**How to avoid:**
- Define at least two test configurations: a flat sheaf (identity restriction maps, trivial H^1) and a non-flat sheaf (projection-based restriction maps, non-trivial H^1).
- For the non-trivial case, construct a simple example: a triangle graph where each agent has 2D state, edge stalks are 1D, and restriction maps are projections onto different axes. The unique-global-section condition fails, producing non-zero H^1.
- Assert in tests that `dim(H^1) > 0` for the non-trivial case.
- Document restriction map design patterns for at least three realistic agent heterogeneity scenarios (different observation dimensions, different objective functions, asymmetric communication).

**Warning signs:**
- All restriction maps in the codebase are `eye(d)` or identity-equivalent.
- H^1 computation always returns an empty vector or zero-dimensional cohomology.
- "Obstruction detection" code path is never triggered in any test scenario.

**Phase to address:** Phase 1 (Sheaf foundation) — the architecture must support non-flat sheaves from the beginning; retrofitting projection-based restriction maps later requires rewriting stalk dimension handling.

---

### Pitfall 5: Louvain Community Detection Treated as Deterministic

**What goes wrong:**
The Louvain algorithm is a heuristic with a random initialization step. Two runs on the same graph can produce different community partitions. If community assignments are used as stable identifiers for structural gap detection, betweenness centrality correlation, or agent role assignment, non-deterministic partitions cause test flakiness, reproducibility failures, and divergent CDP trajectories across simulation runs.

**Why it happens:**
Most documentation presents Louvain as "the modularity algorithm" without emphasizing the stochastic component. TypeScript/JavaScript implementations rarely expose a seed parameter. Developers testing with small graphs may not observe variation because small dense graphs produce stable optima.

**How to avoid:**
- Use a seeded random number generator for Louvain initialization. If the chosen library does not expose a seed, fork it or implement a seedable wrapper.
- For structural gap detection: do not rely on community IDs across iterations. Use modularity class membership derived from the current iteration's graph state only. Gap detection should be a function of inter-community edge density, not of persistent community labels.
- Run Louvain 5 times per graph state and take the partition with maximum modularity Q as the canonical result.
- Write a determinism test: same graph + same seed → same community partition 100% of the time.

**Warning signs:**
- Tests pass on some runs and fail on others for the same graph input.
- CDP trajectory varies significantly across identical simulation restarts.
- Structural gap count fluctuates without graph changes between iterations.

**Phase to address:** Phase 3 (Text Network Analysis and Semantic Dynamics) — establish seeded Louvain before any code depends on community assignments.

---

### Pitfall 6: LCM Immutable Store Implemented as Mutable Log

**What goes wrong:**
The Lossless Context Management immutable store is meant to be an append-only ledger where no record is ever modified or deleted. Implementations that use a standard array, in-memory Map, or database table without append-only constraints allow accidental or intentional record mutation. If the active context DAG's Summary Nodes hold references that become stale (because the immutable store was modified), `lcm_expand` operations return corrupted historical data, and the deterministic guarantees of LCM are lost.

**Why it happens:**
In JavaScript/TypeScript, `Map` and `Array` are mutable by default. Developers reach for the most familiar data structure. The failure only surfaces when a bug elsewhere accidentally overwrites a stored record, which may not happen during early testing.

**How to avoid:**
- Use TypeScript `readonly` on all immutable store record types: `Readonly<InteractionRecord>`.
- Implement the store as a class with no `update` or `delete` methods — only `append` and `query`.
- Use `Object.freeze()` on records when they are inserted.
- Add a runtime invariant check (development mode only): hash each record on insert and re-verify on retrieval. Any hash mismatch is a fatal error.
- In tests: attempt to modify a stored record after insertion and assert that TypeScript compilation fails (type-level protection) and that a runtime error is thrown (defensive copy protection).

**Warning signs:**
- Active context Summary Nodes return different data on repeated `lcm_expand` calls for the same node ID.
- Test isolation requires clearing the store between tests (suggests the store is stateful in ways that should not be possible).
- Any code path that calls `.set()`, `.update()`, or `DELETE` on store records.

**Phase to address:** Phase 2 (LCM Dual-Memory Architecture) — the immutable guarantee must be enforced at the type system level from the first commit; retrofitting is high-risk.

---

### Pitfall 7: Three-Level LCM Escalation Protocol Implemented Without Convergence Guarantee

**What goes wrong:**
Level 3 of the escalation protocol is deterministic programmatic truncation — a hard guarantee that prevents summary generation from looping forever. Implementations that skip Level 3 or make it conditional create a scenario where compaction failure (a summary longer than its input) causes an infinite escalation loop. This is a liveness failure: the system deadlocks on large context windows.

**Why it happens:**
Developers assume Level 1 and Level 2 will always produce acceptable summaries for reasonable inputs. The edge case — where a language model generates a summary with significant preamble or meta-commentary that inflates token count — is hard to trigger synthetically and easy to miss in testing.

**How to avoid:**
- Implement Level 3 as an unconditional code path that activates when `len(summary) >= len(input)` after Level 2.
- Level 3 implementation: take the first K tokens of the input where K is the target context budget. This is O(1) and always terminates.
- Assert in tests: feed an input where the LLM is prompted to generate a longer output. Verify Level 3 activates and the output is exactly K tokens.
- Never make Level 3 contingent on model behavior — it must be pure string/token manipulation in the engine.

**Warning signs:**
- Context management code has no hard truncation path.
- `while (summaryLength > inputLength)` loops without a maximum iteration count.
- Integration tests with large inputs take disproportionately long (silent infinite loop indicator).

**Phase to address:** Phase 2 (LCM) — implement all three levels in the same sprint; do not defer Level 3.

---

### Pitfall 8: Molecular-CoT Bond Types Implemented as Metadata Tags Rather Than Topological Constraints

**What goes wrong:**
Covalent, hydrogen, and Van der Waals bonds are not decorative labels — they encode structural constraints on the reasoning graph that determine valid topology reconfiguration behaviors. Implementations that tag reasoning steps with bond types but do not enforce the corresponding constraints (e.g., that breaking a covalent bond invalidates downstream steps, that hydrogen bonds must fold back to semantically similar clusters within a distance threshold) produce a system where the bond metaphor is cosmetic and cohomology signals never trigger the correct topology changes.

**Why it happens:**
The bond metaphor is conceptually intuitive but mathematically underspecified in most accessible descriptions. Developers implement the labeling layer first (easy) and defer the constraint enforcement layer (hard). The defer becomes permanent.

**How to avoid:**
- Define each bond type as an interface with enforced invariants:
  - Covalent: `{ type: 'covalent', source: StepId, target: StepId, strength: number }` — removal triggers a `cascade_invalidate(target)` that marks all transitively dependent steps as requiring re-derivation.
  - Hydrogen: `{ type: 'hydrogen', source: StepId, target: StepId, semanticDistance: number }` — must satisfy `semanticDistance < threshold_H` at creation time; validate at creation.
  - VanDerWaals: `{ type: 'vanderwaalse', source: StepId, target: StepId, trajectoryLength: number }` — expected `trajectoryLength > 5.0` based on paper (average 5.32 in t-SNE projection).
- Write tests that break a covalent bond and assert that dependent steps are flagged.
- Write tests that attempt to create a hydrogen bond with `semanticDistance > threshold_H` and assert rejection.

**Warning signs:**
- Bond type is stored as a string enum with no behavioral difference between types.
- Cohomology obstruction signals do not trigger Van der Waals bond deployment.
- All bonds have the same traversal logic in the reasoning graph.

**Phase to address:** Phase 3 (Molecular-CoT reasoning implementation) — constraint interfaces must be defined in the type system before any reasoning loop code is written.

---

### Pitfall 9: Surprising Edge Ratio Computed Globally Rather Than Per-Iteration

**What goes wrong:**
The ~12% surprising edge ratio is a per-iteration invariant that must be actively maintained. Implementations that compute the ratio over the cumulative history of all edges (rather than over newly added edges in the current iteration) mask drift: the system may generate 0% surprising edges for 50 iterations followed by a burst, which averages to 12% but represents the system oscillating between stagnation and chaos rather than operating at criticality.

**Why it happens:**
Global ratio computation is simpler and more stable. The per-iteration version requires tracking which edges were added in each iteration, which is bookkeeping overhead that developers skip when under time pressure.

**How to avoid:**
- Tag every edge with `createdAtIteration: number` at insertion time.
- Define "surprising edge" as an edge whose `semanticDistance(source, target) > δ_surprising` where `δ_surprising` is a threshold calibrated to represent cross-domain novelty (not just high distance within one domain).
- Compute `surprisingEdgeRatio(iteration i) = |{e : e.createdAt == i && e.isSurprising}| / |{e : e.createdAt == i}|`.
- Track this ratio over a sliding window (e.g., 10 iterations) and alert when it falls below 8% or rises above 16%.

**Warning signs:**
- Surprising edge ratio is a single global counter, not a time series.
- Ratio is stable at exactly 12% from iteration 1 (suspiciously perfect — likely computed incorrectly).
- No edge has a `createdAtIteration` field in the data model.

**Phase to address:** Phase 4 (SOC Tracking) — define the edge schema in Phase 3 (graph construction) so the iteration tag is present from the start.

---

### Pitfall 10: Sheaf Cohomology H^1 Computed Without Checking Exactness of the Cochain Complex

**What goes wrong:**
H^1 = ker(δ_1) / im(δ_0). Implementations that compute `ker(δ_1)` correctly but use the wrong `im(δ_0)` (e.g., compute image over a different set of cochains, or use numerical rank estimation with a tolerance that absorbs non-trivial cohomology) report H^1 = 0 even when genuine obstructions exist. The Van der Waals topology reconfiguration mechanism never triggers, and the system silently fails to detect coordination deadlocks.

**Why it happens:**
Numerical linear algebra (SVD, null space computation) requires a tolerance parameter for rank determination. Choosing too large a tolerance (e.g., `1e-6` in a system with restriction maps near-unit in magnitude) rounds small but structurally significant cohomology classes to zero.

**How to avoid:**
- Use a tolerance calibrated to the magnitude of restriction map entries: `tol = max_entry * n * eps_machine` where `eps_machine ≈ 2.2e-16` for float64.
- For exact rational sheaves (integer restriction maps), use exact integer arithmetic or a rational number library to compute cohomology without numerical error.
- Construct a synthetic "3-cycle inconsistency" test: three agents forming a triangle, restriction maps chosen to create a non-trivial 1-cocycle. Assert `dim(H^1) = 1` with tight tolerance.
- Log `dim(H^0)` and `dim(H^1)` at each coordination cycle. A system operating correctly should show non-zero H^1 during conflicting reasoning phases.

**Warning signs:**
- `dim(H^1)` is always 0 in all tests and all simulation runs.
- The tolerance in SVD/null-space computation is set to `1e-6` or larger without documented justification.
- No synthetic test case exists for non-trivial cohomology.

**Phase to address:** Phase 1 (Sheaf foundation) — the cohomology computation must be validated with known-ground-truth examples before the coordination layer depends on it.

---

### Pitfall 11: Phase Transition Detection Hard-Coded to Iteration 400

**What goes wrong:**
The structural-semantic cross-correlation phase transition occurs "near iteration ~400" in the original paper's experimental setup. A reference implementation that hard-codes a transition check at exactly iteration 400 (rather than detecting the transition dynamically via cross-correlation sign change) will miss transitions that occur earlier or later due to different graph densities, topic domains, or agent counts. Worse, it may report a false transition at iteration 400 regardless of whether the structural-semantic decoupling has actually occurred.

**Why it happens:**
The "iteration 400" number is memorable and appears prominently in the paper. Developers treat it as a design parameter rather than an emergent measurement. Hard-coding is faster than implementing rolling cross-correlation.

**How to avoid:**
- Compute cross-correlation `ρ(k) = corr(ΔS_structural(k), ΔS_semantic(k))` over a rolling window of W iterations (W = 20 is a reasonable starting value).
- Define phase transition as: `ρ(k) crosses zero from positive to negative and remains negative for at least W/2 consecutive windows`.
- Emit a `PHASE_TRANSITION` event with the actual iteration number. In tests, verify that a simulated trajectory with known cross-correlation trajectory triggers the event at the correct iteration.
- Log the cross-correlation time series for post-hoc analysis.

**Warning signs:**
- Code contains `if (iteration === 400)` or `iteration >= 400` as a transition trigger.
- Phase transition is not validated in any test.
- The transition detection logic has no dependency on actual entropy values.

**Phase to address:** Phase 4 (SOC Tracking) — implement dynamic detection from day one; do not use the magic number as a placeholder.

---

### Pitfall 12: 4-Gram Sliding Window Applied to Raw Text Without Lemmatization

**What goes wrong:**
The InfraNodus 4-gram sliding window establishes co-occurrence edges based on contextual proximity. Without lemmatization, "analyzes", "analyzing", "analyzed", and "analysis" become four separate nodes that are semantically identical. The graph fragments around morphological variants, producing artificially high node counts, artificially low betweenness centrality for key concepts, and spurious structural gaps between semantically identical clusters.

**Why it happens:**
Lemmatization requires a natural language processing library with significant dependency overhead. Developers building a TypeScript implementation often reach for simple tokenization (split on whitespace) rather than integrating a full NLP pipeline.

**How to avoid:**
- Use an established lemmatizer with TypeScript bindings (e.g., `wink-nlp` with `wink-eng-lite-web-model`, or a WebAssembly-compiled `compromise` library).
- Apply TF-IDF stopword removal before lemmatization to avoid lemmatizing high-frequency function words.
- Write a test: insert a paragraph containing "running", "runs", "ran", "run". Assert that all map to the same lemma node.
- For performance: pre-lemmatize all agent outputs before graph insertion, not during similarity queries.

**Warning signs:**
- Node count grows proportionally to total word count (lemmatization collapses variants; no lemmatization means every surface form is a node).
- Betweenness centrality of domain-central concepts is low despite appearing frequently in many forms.
- Structural gap detection identifies "gaps" between morphologically related clusters.

**Phase to address:** Phase 3 (Text Network Analysis) — lemmatization must be in the preprocessing pipeline from the first graph insertion. Retrofitting requires rebuilding the graph from scratch.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Flat sheaf (identity restriction maps) | Sheaf Laplacian compiles and runs immediately | Cannot detect non-trivial H^1; obstruction mechanism is dead code | Only during initial Laplacian unit tests — must be replaced before Phase 1 complete |
| Scalar node stalks (1D state per agent) | Consensus math is just scalar averaging | Heterogeneous agents with different state dimensions cannot be represented | Never in the reference implementation — defeats the purpose of sheaf theory |
| Shannon entropy over vocabulary as proxy for semantic entropy | Single `Math.log` formula, no embeddings required | CDP is meaningless; phase transition cannot be detected | Never — the CDP is core to the framework's value |
| Hard-code Louvain k=5 communities | Skip community detection dependency | Structural gap detection gives wrong results for graphs with more or fewer natural communities | Never — community count must be data-driven |
| Skip LCM Level 3 escalation | Simpler code, fewer edge cases to test | System deadlocks on large context; no liveness guarantee | Never — liveness is a correctness requirement |
| Store entire agent history in active context (no summarization) | No summarization logic needed | Context window saturation defeats the purpose of LCM | Only in toy demos with fewer than 10 agent turns |
| Compute betweenness centrality naively O(VE) | No external library needed | Unusable at 1000+ nodes (structural gap detection becomes a bottleneck) | Only for graphs under 200 nodes in testing |
| Mock restriction maps as random matrices | Sheaf cohomology path is exercised | Restriction maps must be semantically meaningful; random maps produce meaningless H^1 | Only in stress tests of numerical computation, never in integration tests |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LLM embedding API for semantic entropy | Batch embed all concepts once at graph construction; never re-embed | Re-embed concepts periodically as their semantic context evolves in the graph (edge updates shift meaning); cache with content-addressed keys |
| Graph library (e.g., graphology, ngraph) | Store restriction maps as edge metadata in the graph library's edge attributes | Maintain restriction maps in a separate Map keyed on edge ID; graph library edge attributes are for display metadata, not for linear algebra |
| NLP lemmatization library | Call lemmatizer per-concept during graph queries (O(query_cost * concept_count)) | Pre-lemmatize at ingestion time; store canonical lemma form as node ID; surface forms stored as aliases |
| Louvain implementation | Use a library that returns community IDs as integers (0, 1, 2...) and assume these are stable across runs | Treat community IDs as opaque identifiers valid only within one Louvain execution; use modularity class membership, not integer ID, for cross-run analysis |
| LLM for LCM summarization | Summarize the full active context in one call | Summarize individual DAG branches independently; the hierarchical structure must be preserved in the summary DAG, not flattened |
| TypeScript number type for entropy | Use `number` (float64) for all entropy computations | Entropy sums can be numerically unstable; use Kahan summation for the `Σ λ_i ln(λ_i)` term, especially for large graphs |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recomputing full sheaf Laplacian on every edge addition | Consensus iteration slows proportionally to graph edge count | Maintain incremental Laplacian updates: `L_new = L_old + δL` for each edge addition | ~500 edges (computation exceeds 100ms per consensus step) |
| Computing pairwise cosine similarity for all node pairs to find structural gaps | Graph analysis freezes after a few hundred iterations | Use community-level gap detection: compute inter-community edge density (O(communities^2)) not all-pairs similarity | ~300 nodes (O(n^2) becomes 90,000 similarity computations per gap scan) |
| Full covariance matrix for embedding entropy in high-dimensional space | Entropy computation dominates simulation wall time | Use random projection to reduce embedding dimension to 64-128 before covariance; error is bounded by Johnson-Lindenstrauss | 1024-dim embeddings with 200+ active concepts (single entropy call takes seconds) |
| Running Louvain to convergence on every graph mutation | Community detection is called O(edges) times per iteration | Run Louvain only when graph structure changes significantly (e.g., node count increases by 5%, or edge count increases by 10%) | ~1000 edges (Louvain takes >200ms per run; calling per-mutation causes iteration latency) |
| Naive betweenness centrality recomputation | Structural gap detection is slow; CDP updates lag | Use approximate betweenness (Brandes algorithm with sampling, or incremental updates for small graph changes) | ~500 nodes (exact betweenness O(VE) with E~3V takes seconds) |
| Storing all iteration snapshots of the full graph in memory | Memory usage grows linearly with iteration count | Store only the delta (added nodes/edges) per iteration; reconstruct snapshots on demand | ~200 iterations with 1000-node graphs (several GB of redundant graph copies) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| LLM output inserted directly into graph as node IDs without sanitization | Prompt injection: adversarial content in agent output creates graph nodes with special characters that break serialization or inject code into downstream GraphRAG queries | Sanitize all agent outputs before lemmatization; use content-addressed hashing (SHA-256 of lemmatized form) as internal node IDs; store raw output separately |
| Restriction maps loaded from external configuration files without validation | Malformed restriction maps (wrong dimensions, non-finite values) cause silent numerical failures in Laplacian computation | Validate restriction map dimensions against declared stalk dimensions at load time; check for finite values; reject configurations that fail validation with explicit error |
| LCM immutable store backed by a writable file path with no access control | If the store file is writable by other processes, the immutable guarantee can be violated externally | Use file locking and append-only file mode at the OS level; consider a database with row-level immutability (PostgreSQL INSERT-only table with no UPDATE/DELETE grants) |
| GraphRAG catalyst questions passed directly to LLM without prompt boundary enforcement | Structural gap coordinates (node identifiers) may contain adversarial content if derived from external agent outputs | Wrap all GraphRAG context in explicit XML or JSON delimiters; instruct the LLM to treat graph content as data, not as instructions |

---

## UX Pitfalls

*Note: This is a library/reference implementation, not a user-facing UI. UX concerns apply to developer experience (DX) — the experience of engineers using this framework.*

| Pitfall | Developer Impact | Better Approach |
|---------|-------------|-----------------|
| Sheaf configuration requires specifying stalk dimensions and restriction maps in raw matrix form | Developers cannot configure agents without understanding linear algebra | Provide factory functions for common agent types: `createHomogeneousAgent(dim)`, `createProjectionAgent(fullDim, observedDim, projectionAxes)`; document what each factory creates mathematically |
| Entropy values returned without units or normalization context | Developers cannot interpret whether `S = 2.3` is "high" or "low" structural entropy | Return entropy values alongside their theoretical maximum (`S_max = ln(n)`) and the normalized ratio `S / S_max`; log warnings when values are at boundaries |
| Phase transition event emitted as a raw iteration number with no context | Downstream consumers do not know whether the transition was detected correctly or via fallback | Include in the event: current iteration, cross-correlation value at transition, rolling window values for the preceding W iterations, and whether the detection was dynamic or fallback |
| CDP value returned without the sign convention documented inline | Developers misinterpret negative CDP as an error state | Document at the type level: `/** CDP < 0 means semantic entropy dominates (critical regime). CDP > 0 means structural entropy dominates (sub-critical). CDP stabilizes near -0.1 in healthy systems. */` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Sheaf Laplacian:** Appears to converge — verify that `H^0` dimension matches expected global section space, and that `H^1 > 0` for a known-inconsistent configuration.
- [ ] **Von Neumann entropy:** Returns a number — verify it equals `ln(n)` for the complete graph `K_n` and is strictly less than `ln(n)` for any non-complete graph.
- [ ] **Embedding entropy:** Returns a number — verify it is near zero for a set of identical embeddings and approaches `ln(d)` for `d` maximally orthogonal unit vectors.
- [ ] **LCM immutable store:** Accepts writes — verify that a second write attempt to an existing record ID either throws an error or creates a new record (never overwrites).
- [ ] **LCM Level 3 escalation:** Code path exists — verify it is triggered for an input where the LLM is prompted to produce verbose output.
- [ ] **Molecular-CoT covalent bonds:** Bond removal removes the bond entry — verify that it also marks all transitively dependent steps as requiring re-derivation.
- [ ] **Hydrogen bond validation:** Bond is created — verify that a bond creation attempt with `semanticDistance > threshold` is rejected at creation time, not silently accepted.
- [ ] **Louvain community detection:** Returns communities — verify that two runs with the same seed return identical results, and that two runs without a seed may differ.
- [ ] **Structural gap detection:** Returns a list of gaps — verify that a graph with two isolated cliques produces at least one gap, and that a fully connected graph produces zero gaps.
- [ ] **Surprising edge ratio:** Returns a ratio — verify it is computed per-iteration (not cumulative) by checking that adding only non-surprising edges in one iteration returns 0.0 for that iteration.
- [ ] **Phase transition detection:** Fires an event — verify it fires at the correct iteration for a synthetic entropy trajectory that crosses correlation zero at a known point.
- [ ] **CDP computation:** Returns a value near -0.1 for a stable system — verify it is positive (sub-critical) for a graph where structural entropy was manually inflated above semantic entropy.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong Sheaf Laplacian (graph Laplacian used) | HIGH | Rewrite coboundary operator; all consensus tests fail and must be rebuilt; cohomology results are invalid and must be recomputed |
| Von Neumann entropy using wrong density matrix | MEDIUM | Replace eigendecomposition target; rerun all entropy time series; re-calibrate CDP thresholds |
| Embedding entropy using vocabulary Shannon entropy | HIGH | Implement covariance-based computation; all historical CDP values are invalid; phase transition history must be re-derived |
| Flat sheaf (identity restriction maps) | MEDIUM | Implement projection-based restriction map factory; existing tests using flat sheaf remain valid; add non-flat tests alongside |
| Non-deterministic Louvain | MEDIUM | Add seeding; re-run all community detection; structural gap history may be inconsistent and should be discarded |
| LCM store allows mutation | HIGH | Freeze all records; audit existing tests for accidental mutation; any historical analysis built on potentially mutated data must be invalidated |
| Missing LCM Level 3 | LOW | Add truncation fallback; existing code paths remain valid; add regression test for the new path |
| Bond types as metadata only | HIGH | Rewrite bond data model with behavioral interfaces; all Molecular-CoT reasoning graph logic must be re-tested |
| Surprising edge ratio computed cumulatively | LOW | Add per-iteration edge tracking; historical ratios are invalid but calculation is localized |
| Hard-coded iteration 400 phase transition | LOW | Replace with dynamic cross-correlation; existing transition reports are unreliable |
| Lemmatization missing | HIGH | Add NLP preprocessing pipeline; existing graph must be discarded and rebuilt from raw text; all node-based analyses (betweenness, communities, gaps) are invalid |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Wrong Sheaf Laplacian | Phase 1: Sheaf-Theoretic Coordination | Unit test: `L_sheaf x = 0` for known global section; `dim(H^0)` matches expected |
| Wrong Von Neumann entropy | Phase 4: SOC Tracking | Unit test: `S(K_n) = ln(n)`; `S < ln(n)` for path graph |
| Wrong embedding entropy | Phase 4: SOC Tracking | Unit test: near-zero for identical embeddings; near `ln(d)` for orthogonal set |
| Flat sheaf shortcut | Phase 1: Sheaf-Theoretic Coordination | Integration test: 3-cycle inconsistency produces `dim(H^1) = 1` |
| Non-deterministic Louvain | Phase 3: Text Network Analysis | Determinism test: same seed → same partition 10/10 runs |
| Mutable LCM store | Phase 2: LCM Dual-Memory | Type-level test: record modification causes compile error; runtime test: mutation attempt throws |
| Missing LCM Level 3 | Phase 2: LCM Dual-Memory | Stress test: verbose LLM output triggers Level 3; output length exactly K tokens |
| Bond types as metadata | Phase 3: Molecular-CoT Reasoning | Behavioral test: covalent bond removal triggers cascade invalidation |
| Cumulative surprising edge ratio | Phase 4: SOC Tracking | Per-iteration test: all non-surprising edges in iteration i → ratio(i) = 0.0 |
| Hard-coded phase transition | Phase 4: SOC Tracking | Synthetic trajectory test: transition fires at known iteration, not at 400 |
| Missing lemmatization | Phase 3: Text Network Analysis | NLP test: morphological variants map to single node |
| Cohomology exactness with wrong tolerance | Phase 1: Sheaf-Theoretic Coordination | Numerical test: 3-cycle sheaf with known H^1; tight tolerance detects it, loose tolerance misses it |

---

## Sources

- Lossless Context Management paper (Voltropy/LCM, arXiv, Feb 2026) — LCM three-level escalation protocol, immutable store architecture, llm_map primitive
- "Mapping the Topology of Long Chain-of-Thought Reasoning" (arXiv:2601.06002v2) — Molecular-CoT bond type empirical data (72.56% covalent clustering, 81.72% hydrogen reconnection, 5.32 Van der Waals trajectory)
- "Applied Sheaf Theory For Multi-Agent AI" (arXiv:2504.17700v1) — Sheaf Laplacian formulation, H^1 obstruction detection, coboundary operator definition
- "Distributed Multi-agent Coordination over Cellular Sheaves" (arXiv:2504.02049) — ADMM-based Laplacian diffusion, stalk dimension handling
- "Self-Organizing Graph Reasoning Evolves into a Critical State" (AIP Chaos, 2025; arXiv:2503.18852v1) — Von Neumann entropy formula, embedding entropy, CDP definition, ~12% surprising edge ratio, iteration ~400 phase transition
- InfraNodus TNA methodology documentation — 4-gram sliding window, TF-IDF stopword removal, Louvain community detection, betweenness centrality, structural gap identification
- "Sheaf Cohomology of Linear Predictive Coding Networks" (OpenReview) — H^0/H^1 cohomology group interpretation, inconsistent cognitive loop detection
- Hacker News discussion of LCM paper (news.ycombinator.com/item?id=47038411) — community-identified implementation risks around context compaction failure

---
*Pitfalls research for: RLM-LCM Molecular-CoT multi-agent framework — TypeScript/JavaScript reference implementation*
*Researched: 2026-02-27*
