# Emergent Bonds & Stateless Reconstruction

> **Status:** Design analysis / architecture proposal. Not yet implemented.
> **Origin:** Triggered by Ding, Matito & Schilling, _"Chemical bonding concepts
> emerge naturally from maximally entangled atomic orbitals"_ (Nature Communications,
> 2026, s41467-026-73527-w), read against the current AGEM codebase.
> **Verdict in one line:** AGEM's "make bonds emergent" goal and its "make the
> system stateless / reconstructable from the graph" goal are **the same
> architectural change**, and the modules that block one are exactly the modules
> that block the other.

---

## 0. Why this document exists

Two questions were on the table:

1. **How deep can the molecular analogy go** if we follow the MEAO paper — where
   bonds are _derived_ from orbital correlation rather than assigned — and where
   does the analogy break down?
2. **Could AGEM be stateless**, reconstructing its working context from the
   current and previous states of its graph?

The answer to (1) turns out to be the _mechanism_ for (2). This document records
the reasoning, a per-module audit grounded in the actual source (not memory), and
a concrete path. It also corrects an earlier verbal claim that ADMM was the hard
case — the code shows otherwise (see §3).

---

## 1. What the MEAO paper actually does

The paper replaces the idea of a _labelled_ chemical bond with a bond that
**emerges from a measurable correlation pattern**:

1. Partition the Hilbert space into localized atomic orbitals (the basis).
2. From the wavefunction, compute the **mutual information** between every pair of
   orbitals: `I(i,j) = S(ρ_i) + S(ρ_j) - S(ρ_ij)`, where `S` is the von Neumann
   entropy of a reduced density matrix.
3. Build a correlation graph weighted by `I(i,j)` and partition it. Two-center
   clusters fall out as **Lewis bonds**; multi-center clusters fall out as
   **beyond-Lewis** bonds.
4. Quantify each bond with quantum-information tools — bipartite entanglement for
   pairs, **genuine multipartite entanglement (GME)** for multi-center clusters.

The bond _type_ is an **output** of the correlation structure, never an input.
The framework is validated not just on equilibrium geometries but on transition
states (Diels-Alder) and aromaticity — i.e. on systems where the bonding pattern
_reorganizes_.

## 2. The mapping — where it goes deep, where it breaks

### Goes deep (structural resonance, not loose metaphor)

- **AGEM already speaks this dialect.** `SOCTracker` already computes von Neumann
  entropy (`vonNeumannEntropy`) and embedding entropy over the graph every
  iteration. The MEAO recipe is _entropy → pairwise mutual information → partition
  → typed clusters_. AGEM does the first and last steps; the missing middle is
  pairwise mutual information between node embeddings.
- **Multi-center bonding ≈ H¹ ≈ synergy.** The paper's deepest claim is that some
  bonding is irreducibly multi-center — not decomposable into pairwise bonds. That
  is exactly what the sheaf layer's **H¹ obstruction** detects (a global
  inconsistency invisible to any local pairwise check) and exactly the situation
  where a conclusion is valid only as a property of a _group_ of premises. Two
  independent formalisms pointing at one phenomenon is a strong signal it's real.
- **Reaction coordinate ≈ phase transition.** The paper tracking bond
  reorganization across a transition state is the chemistry twin of AGEM's
  `phase:transition` detection over a reasoning trajectory.

### Breaks down (do not over-claim)

- **No Hilbert space → no entanglement.** MEAO operates on a real fermionic
  wavefunction with genuine quantum non-separability. AGEM nodes are classical
  embedding vectors. Classical things correlate; they never entangle. The moment
  AGEM says "entanglement," it is decoration. We lose everything
  entanglement-specific: monogamy, convex-roof GME measures, the
  relative-entropy-of-entanglement SDP, the need for pure states and an MPS/DMRG
  solver. None of it ports.
- **No conservation / no fermionic structure.** Pauli exclusion, particle-number
  conservation, the four-state Fock space per orbital — no reasoning analog.
- **No ground-truth optimal basis.** MEAOs are _defined_ by rotating the orbital
  basis to maximize inter-center entanglement against physical ground truth.
  Reasoning has no such uniqueness-forcing optimum.

### The honest port: classical information, not quantum

Treat it as a **classical-information** port. The rigorous, computable analog of
"genuine multi-center bonding" is **synergistic information** —
**O-information** (Rosas/Mediano) or a partial information decomposition. A
synergy-dominated cluster is one whose joint information genuinely exceeds the sum
of its pairwise parts: the classical twin of beyond-Lewis bonding, and a second
numerical signal that should correlate with H¹ flags. Concretely:

- **Edge weight** = pairwise mutual information between node embeddings → bond type
  _emerges_ instead of being labelled.
- **Cluster index** = O-information per community → flags which clusters are
  irreducibly higher-order, cross-validating the sheaf layer.

No quantum claims required, and both quantities are computable from data AGEM
already holds.

---

## 3. Per-module reconstruction audit (grounded in source)

The question for each module: _can its state become a pure projection over a log,
and how hard is it?_ The reference pattern is LCM, which already does this.

| Module                                                 | Current state                                                                   | Reconstructable?                                                                                                                          | Difficulty                       |
| :----------------------------------------------------- | :------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------- |
| `lcm/ImmutableStore` + `EmbeddingCache` + `ContextDAG` | Append-only, content-hashed log + derived projection                            | **Already done** — `rehydrate()` seeds store _and_ embeddings without re-invoking the embedder (asserted in `ContextRehydration.test.ts`) | ✅ reference                     |
| `orchestrator/OrchestratorStateManager`                | In-memory `#currentState`, `#lastStateChangeTime`                               | Yes — `updateMetrics(h1)` is a pure deterministic transition; state is a fold over the H¹ stream                                          | trivial                          |
| `sheaf/ADMMSolver`                                     | None between calls                                                              | Yes — **already pure today** (see below)                                                                                                  | trivial now; _see future caveat_ |
| `soc/SOCTracker`                                       | `#history` + running deltas + `RegimeValidator`/`RegimeAnalyzer` internal state | Yes, but only by **ordered replay** — not from a graph snapshot                                                                           | medium                           |
| `types/MolecularCoT.BondGraph`                         | Mutable `#bonds` map, destructive delete, **caller-assigned types**             | Yes, _if_ bond type is derived (this is the MEAO change)                                                                                  | hard / unifying                  |
| `evolution/PriceEvolver`                               | Mutates the TNA graph in place; path-dependent reinforcement; lossy history     | Only by **event-sourced replay** — never from a snapshot                                                                                  | hard (forcing function)          |

### Correction on ADMM

An earlier verbal claim named ADMM as "the one hard holdout because it accumulates
dual variables." **The code contradicts this.** `ADMMSolver.solve(initialState)`
is currently a **Phase-1 gradient-descent stub**: `x_{k+1} = x_k − α·L·x_k`, pure
in `(sheaf Laplacian, initialState)`, storing nothing between calls. It is already
a projection — recompute from the graph, done.

The dual-variable concern is **real but future**: the file explicitly notes that
real ADMM (SHEAF-05) will introduce auxiliary variables `z, u` and per-edge
updates. _That_ version becomes path-dependent and forces a decision — persist the
duals per graph-version (warm start) or cold-start consensus on each
reconstruction. Decide it when SHEAF-05 is written, not before. This is exactly
the kind of error thin docs produce: a plausible-sounding claim that the source
falsifies.

### SOCTracker (medium)

`#history` is already shaped like `ImmutableStore` (frozen copy on read,
commented "history is ground truth"), but the running accumulators are not
exposed: `#previousVNE`, `#previousEE`, `#previousCorrelation`, the
`#deltaStructural` / `#deltaSemantic` arrays, plus the `RegimeValidator`'s
"N consecutive same-sign iterations" persistence logic and `trackEntropyPair` /
`detectEarlyConvergence` (System-1) state. These are genuinely sequential, so SOC
cannot be recomputed by jumping to a graph state — only by replaying the
`SOCInputs` stream in order. **Fix:** add `snapshot()` / `restore()` for the
running fields, mirroring LCM. Low risk, mechanical.

### BondGraph — where Q1 and Q2 are literally the same fix (hard / unifying)

Two findings from `types/MolecularCoT.ts`:

1. **Bond type is an input.** `addCovalentBond` / `addHydrogenBond` /
   `addVanDerWaalsBond` — the caller decides the type. This is precisely the
   Lewis-label situation MEAO inverts. _But we're halfway there already:_ the
   hydrogen gate is `semanticDistance <= 0.7` (cosine-based), so a
   correlation-derived classifier already has a threshold to reuse.
2. **It is not on the spine and not ornamental.** `#bonds` is a mutable map with
   destructive `delete`, no `snapshot`/`restore`. And `removeCovalentBond` runs
   `cascadeInvalidate` (DFS over transitive covalent dependents) — bonds drive
   real control flow (step re-derivation), so they cannot be treated as a cosmetic
   recomputed view.

**The change:** replace the three typed `add*` methods with a single
`observe(source, target)` that computes mutual information / synergy / semantic
distance from embeddings (already in the event-sourced `EmbeddingCache`) and
**derives** the bond type. Bonds become a projection at graph-version `k`.
`cascadeInvalidate` becomes a **version diff**: `diff(version_k, version_{k+1})`
→ broken covalent edges → re-derive their targets. That is the reaction-coordinate
idea made concrete, and it preserves the safety invariant (a "hydrogen"
classification _requires_ sub-threshold distance, automatically, because the
classifier uses that threshold).

### PriceEvolver — the genuine hard holdout (forcing function)

From `evolution/PriceEvolver.ts`:

- `evolve()` calls `this.#graph.setEdgeAttribute(key, "weight", newWeight)` — it
  **mutates the TNA graph directly** with Pólya reinforcement
  `w_new = w · (1 + α · fitness)`.
- The learning rate `α` is **regime-dependent** (`#getLearningRate()` switches on
  `nascent` / `stable` / `critical`), so it inherits SOC's path-dependence.
- Current edge weights are therefore a **path integral**,
  `w_k = w_0 · Π_i (1 + α_i · fitness_i)` over the whole run. You cannot recover
  them from a graph snapshot, because the graph **is** the accumulated state —
  circular.
- `#pushHistory` **lossily trims** at `maxHistory` (`splice`), so even its own
  derived log is incomplete. This breaks exact replay and must change.

**The change:** stop mutating the graph as primary state. Log each iteration's
fitness signals + regime as events; edge weights become a derived projection
computed by replaying `evolve()` from initial weights over that event stream.
The fitness signals already arrive as events (`onRegimeChange`,
`onCohomologyUpdate`, `onSOCMetrics`, `onGapClosure`, `onWeakLumpability`) — they
just need to be persisted rather than consumed and discarded.

---

## 4. The root finding

Only the LCM **entries** are event-sourced. The **graph itself** — where edge
weights and bonds live, and where both `PriceEvolver` and `BondGraph` write — is
**mutable primary state**. That single fact is the common cause of the two hard
cases. Both modules treat the graph as ground truth instead of as a projection.

The MEAO discipline is the cure, stated generally:

> The correlation structure (bonds, weights, clusters) is a **recomputed view**.
> The ground truth is the **append-only log of observations** (entries, embeddings,
> fitness signals, regime readings).

This is why the two original questions are inseparable. Making bonds emergent (Q1)
is _the mechanism_ that turns the bond layer from mutable primitive into a
projection (Q2). The work is not two projects — it is one: **promote the graph
substrate to event-sourced**, with `PriceEvolver` as the forcing function.

---

## 5. Concrete approach: an event-sourced graph substrate

### 5.1 The event log

Reuse the `ImmutableStore` pattern (append-only, `Object.freeze`, SHA-256 content
hash, `uuidv7` + `sequenceNumber`) but widen what counts as an event. Today it
stores text entries. Add graph-affecting events:

```
GraphEvent =
  | NodeObserved      { id, contentHash, embeddingRef }
  | EdgeObserved      { source, target, createdAtIteration }
  | FitnessApplied    { iteration, signal, reason, scope }   // from PriceEvolver inputs
  | RegimeAt          { iteration, regime }                  // drives learning rate
  | CohomologyAt      { iteration, h1 }                      // drives orchestrator state
```

Each event is immutable and content-addressed. A **graph version** at sequence `k`
is the hash of the fold over `events[0..k]`. Because versions are content-addressed,
"previous states" get cheap structural sharing (Merkle-style) — you do not copy the
whole graph per step.

### 5.2 Everything else is a pure fold

```
weights(k)   = fold(reinforce, initialWeights, fitnessEvents[0..k])
bonds(k)     = classify(mutualInfo(embeddings, edges(k)))      // derived, not stored
orchState(k) = fold(transition, NORMAL, cohomologyEvents[0..k])
socState(k)  = fold(computeAndEmit, init, socInputs[0..k])
```

- `weights(k)` replaces `PriceEvolver`'s in-place mutation. Same Price math, same
  Pólya rule — but applied during replay, not baked into the substrate.
- `bonds(k)` replaces `BondGraph`'s stored typed edges. Type is derived from
  mutual information / synergy + the existing `0.7` / `5.0` thresholds.

### 5.3 The determinism rule (already proven in LCM)

All nondeterministic outputs — LLM text, embeddings — are **captured as events**,
never recomputed. Reconstruction is **pure replay**. `LCMClient.rehydrate()`
already enforces this for embeddings (the embedder is asserted _never called_
during rehydration). Extend the same rule to the graph layer.

### 5.4 Cost control: CQRS + checkpoints

Folding from genesis every step is `O(n)`. Mitigate with:

- **Materialized views** keyed by version hash, invalidated on append (CQRS read
  model — `ContextDAG` is already this for summaries).
- **Periodic checkpoints** for `PriceEvolver` (a snapshot of weights at version
  `k`, plus replay of `events[k..now]`). This is the only honest way to bound the
  cost of a path-dependent integral — it cannot be made snapshot-pure, only
  replay-pure with checkpoints.

---

## 6. AGEM can validate its own statelessness

The `LumpabilityAuditor` is the right instrument and it already exists. A
reconstruction is faithful iff the projection is **strongly lumpable** (no
information lost between source entries and the rebuilt view); **weak lumpability**
is the signal that a fold dropped something. So the test for "is our stateless
reconstruction correct?" is not a bespoke harness — it is the auditor AGEM already
runs at compaction boundaries, pointed at the replay output. This is a genuinely
elegant property worth leaning on: the system measures its own reconstruction
fidelity with a tool built for a different purpose.

---

## 7. Recommended sequencing

1. **Lock the determinism rule across the graph layer.** Persist embeddings and
   any LLM outputs as events everywhere, not just in LCM. Cheap, and it is the
   precondition for everything else.
2. **Easy wins:** `OrchestratorStateManager` and current `ADMMSolver` — express as
   folds / confirm purity. Mostly tests.
3. **SOCTracker:** add `snapshot()` / `restore()` for running state. Mechanical.
4. **BondGraph → emergent bonds (the MEAO change).** Introduce `observe()` +
   mutual-information classifier; keep the `0.7` / `5.0` thresholds; replace
   `cascadeInvalidate` with version-diff re-derivation. This is the highest-value
   step — it delivers Q1 and unblocks Q2 for the bond layer at once.
5. **PriceEvolver → event-sourced replay.** Stop in-place mutation; remove the
   lossy `maxHistory` trim (or accept windowed exactness); add checkpoints. This is
   the forcing function that makes the graph substrate genuinely event-sourced.
6. **Optional escalation:** O-information per community as a synergy index that
   cross-checks H¹.

This is **not a new project.** It is "extend the LCM pattern from entries to the
graph," sequenced so each step ships independently and the bond work pays for
itself before the harder evolver work begins.

---

## 8. Honest limits & risks

- **"Entanglement" is metaphor here, not mathematics.** AGEM has no Hilbert space.
  Use mutual information and O-information (classical, defensible); do not claim
  entanglement, monogamy, or GME in marketing or in code comments.
- **Reinforcement is a path integral.** `PriceEvolver` cannot be made
  snapshot-pure. Replay + checkpoints is the ceiling. Budget for it.
- **The lossy `maxHistory` trim must go** (or be redefined as an explicit windowed
  guarantee). Silent trimming + "exact reconstruction" cannot both be true.
- **Future real ADMM (SHEAF-05)** reintroduces genuine accumulated state. Decide
  warm-start vs cold-start _when writing it_.
- **Classifier thresholds (`0.7`, `5.0`) become load-bearing.** Once bond type is
  derived, these constants silently define topology. They deserve tests and,
  eventually, justification or learning.
- **Cost of curiosity:** none of the above was knowable from memory. The ADMM
  miscall (§3) is the cautionary example — verdicts must be read off the source.

## 9. Open decisions

1. One unified event log, or per-subsystem logs feeding a shared graph version?
2. Checkpoint cadence for `PriceEvolver` replay.
3. Where the versioned graph lives: in-memory persistent structure vs. a
   Neo4j-backed store (a `neo4j-cypher` tool is available in the environment).
4. Warm-start vs. cold-start policy for future real-ADMM duals.
5. Fixed vs. learned bond-classification thresholds.

---

## 10. References

- Ding, L., Matito, E. & Schilling, C. _Chemical bonding concepts emerge naturally
  from maximally entangled atomic orbitals._ Nature Communications 17, 4732 (2026).
  doi:10.1038/s41467-026-73527-w.
- Rosas, F. et al. _Quantifying high-order interdependencies via multivariate
  extensions of the mutual information_ (O-information) — for the classical synergy
  index proposed in §2.
- AGEM source audited: `lcm/ImmutableStore.ts`, `lcm/ContextDAG.ts`,
  `lcm/ContextRehydration.test.ts`, `orchestrator/OrchestratorState.ts`,
  `sheaf/ADMMSolver.ts`, `soc/SOCTracker.ts`, `types/MolecularCoT.ts`,
  `evolution/PriceEvolver.ts`.

---

## 11. Performance: per-cycle recomputation audit (VERIFIED)

> Added after observing slowdown that worsens per-cycle once information has
> accumulated. Every finding below is read off the source, with line references.
> The earlier verbal claim that the _eigenspectrum cache_ was the safest first fix
> was **wrong** and is corrected here (§11.2) — `CohomologyAnalyzer.analyze()` does
> not call `getEigenspectrum` at all; it runs its own SVD. This is logged as a
> second example (after the ADMM miscall in §3) of why fixes are read off source,
> not memory.

### 11.1 The shape of the problem

The slowdown is **growth-dependent**: fine for a few cycles, then progressively
slower as entries/nodes/subgraphs accumulate. That signature points at work that
scales with _cumulative state_ and runs _every cycle with no change-detection_.
The per-cycle loop is `ComposeRootModule.runReasoning` (line ~523). Five distinct
steps each traverse or decompose the entire accumulated state every iteration.

### 11.2 The five offenders (ranked by cost growth)

**#1 — Full-history re-tokenization every cycle (Step 5, ~line 567). PRIME SUSPECT.**
Each cycle does `store.getAll()` → `.map(e => e.content).join("\n\n")` →
`lcmEscalation.escalate(concatenatedText)`. The **first line** of
`EscalationProtocol.escalate` (EscalationProtocol.ts ~line 195) is
`this.#tokenCounter.countTokens(text)` using `gpt-tokenizer`'s `encode`. So **even
on cycles where no compaction is needed** (the `level 0` early return), AGEM
tokenizes the _entire conversation history_ from scratch. Cost grows linearly with
total history length, paid unconditionally, every cycle. This is the cleanest
match to the observed curve.
_Fix:_ maintain a running token count; only build the big string and call
`escalate()` when the running count crosses `level1TokenLimit`. Incremental, no
math risk, biggest expected win.

**#2 — Sheaf rebuilt from scratch + full SVD every cycle (Step 6, ~line 660).**
`buildSheafFromRegistry()` constructs a **new** `CellularSheaf` each cycle (so any
per-object Laplacian/SVD cache is discarded by construction), with an O(S²) loop
over all subgraph pairs. Then `cohomologyAnalyzer.analyze()` runs
`new SingularValueDecomposition(mlB, { autoTranspose: true })` — a full SVD of the
coboundary matrix computing **both** `U` (N₁×N₁) and `V` (N₀×N₀) singular-vector
matrices. But `analyze` only needs (a) singular _values_ for the rank → H⁰/H¹, and
(b) the H¹ basis = columns of `U` past `rank`. The entire `V` matrix is computed
and discarded (the code comment says "H^0 basis not returned").
_Fix:_ (a) only rebuild the sheaf when the subgraph registry changed (dirty flag /
version), and (b) avoid materializing `V`; request thin/values-only where the
ml-matrix API allows. Gate the whole step on registry change.

**#3 — Von Neumann entropy, dense eig every cycle (Step 7, soc/entropy.ts).**
`vonNeumannEntropy` builds the n×n normalized Laplacian and runs `math.eigs` —
O(n³) — every cycle. Note: gating alone helps little here, because the TNA graph
_does_ change every cycle (each `ingest` adds tokens), so VNE genuinely needs
recomputing. The lever is algorithmic + bounded working set, not memoization.
_Fix:_ eigenvalues-only routine (no eigenvectors), or stochastic trace estimation
(Hutchinson) for large n; and/or compute over a bounded working set (see §6/ETE)
so n stops growing.

**#4 — Embedding entropy, the un-implemented Phase-4 TODO (Step 7, soc/entropy.ts).**
`embeddingEntropy` builds a d×d covariance (O(n·d²)) and eigendecomposes it
(O(d³)) every cycle. The file's own comment: _"Acceptable for Phase 4. Phase 6 can
add random projection if n or d grows large."_ That projection was never added;
d=384 ⇒ ~56M ops fixed cost per cycle.
_Fix:_ implement the promised random projection (Johnson–Lindenstrauss) to shrink d
before the covariance build.

**#5 — Louvain every cycle, ungated (Step 4, ~line 545).**
`tnaLouvain.detect()` runs over the full graph unconditionally — superlinear in
graph size. Directly adjacent, `tnaCentrality.computeIfDue()` and
`tnaLayout.computeIfDue()` are **already interval-gated**. Someone solved this
pattern once and did not propagate it to Louvain.
_Fix:_ gate Louvain with the same `computeIfDue` interval pattern.

### 11.3 The single root cause

All five are the same disease: **recompute over all accumulated state with no
"did my input change?" check.** Two levers fix all of them:

- **Incremental accumulation** where a running total is valid (token count #1,
  edge-list construction).
- **Change-gated memoization** elsewhere (#2, #5) — key derived values to a
  version/hash of their input; skip when unchanged. The `computeIfDue` pattern
  already in the orchestrator (centrality, layout) is the in-repo template.
- For the two that genuinely change every cycle (#3, #4), the lever is
  **algorithmic** (values-only / projection) plus a **bounded working set** so the
  size driving the cubic terms stops growing.

This is the same versioning the stateless refactor (§5) needs. The performance
work is a down payment on statelessness, not a detour.

### 11.4 Changes applied in this pass (review before relying on them)

**APPLIED — Fix #1, behaviour-preserving (the prime suspect).**

- `src/lcm/EscalationProtocol.ts`: added a read-only `get level1TokenLimit()`
  accessor.
- `src/orchestrator/ComposeRootModule.ts` (Step 5): before escalating, sum the
  per-entry `tokenCount` (already cached on every `LCMEntry` at append) plus an
  8-token-per-gap separator allowance. This sum is an **upper bound** on the true
  concatenated token count. Only when it exceeds `level1TokenLimit` do we build
  the big string and call `escalate()` (which then tokenizes). Below the limit,
  `escalate()` would have returned `level: 0` regardless, so behaviour is
  identical — we simply skip the wasted full-history `gpt-tokenizer` encode on
  every sub-threshold cycle. Added `EscalationResult` to the type imports.
- Why this is safe: the gate can only ever _skip_ work that would have been a
  no-op. The separator allowance is generous (double-newline is 1–2 tokens, we
  budget 8), so the estimate never under-counts enough to skip a real escalation.
- Expected effect: removes the dominant growth-with-history cost on the common
  path. This is the one to measure first.

**NOT APPLIED — deliberately deferred because they change semantics or carry
math/API risk. These are your calls, not mine to bake in silently.**

- **#5 Louvain gating.** Gating `detect()` to an interval would make community
  assignments _lag_. `#buildCommunityMap` reads `communityId` off node attributes,
  so stale assignments are valid (new nodes correctly skipped), but SOC's
  surprising-edge ratio compares _cross-community_ edges — so lagged communities
  shift a real metric. This is a tuning tradeoff (freshness vs. cost), not a free
  win. Recommend: add `computeIfDue`-style gating to `LouvainDetector` and expose
  the interval as config, then tune with eyes open.
- **#2 Sheaf SVD.** Two sub-fixes: (a) only rebuild the sheaf when the subgraph
  registry changed (needs a dirty flag/version on `SubgraphRegistry`), and (b)
  avoid materialising the discarded `V` matrix in `CohomologyAnalyzer` (needs an
  ml-matrix API check for a values/thin variant — verify before editing). Both
  safe in principle; both need a verification step first.
- **#3 / #4 entropy decompositions.** Algorithmic changes (eigenvalues-only;
  Johnson–Lindenstrauss projection for embedding entropy). Correct direction but
  they touch numerical code with correctness tests (K_n gives ln(n−1), etc.) —
  must be done against those tests, not blind.

### 11.5 Verification note

These edits were read off source and type-checked by inspection (imports,
accessor, `EscalationResult` shape). They have **not** been run. The dev server
hot-reloads on change (per project convention, not restarted here). Suggested
check: run a multi-cycle session that previously slowed down and compare
per-cycle wall-time, and run the LCM/escalation test suite to confirm the gate
did not change compaction behaviour at the threshold boundary.

---

## 12. Why the obstruction never fires — and a two-level sheaf redesign

> **Status:** Design proposal. Diagnosis is confirmed from a real run log
> (`docs/conceptual-lineage-test/minimax-m2.7/final-cycle.md`); the construction
> is proposed, not yet implemented.
> **Conceptual basis:** Frauenfelder & Weber, _Hilbert Manifold Structures on
> Path Spaces_ (arXiv:2507.03782) — specifically the **two-level manifold** motif,
> NOT the Floer/Hilbert-manifold analysis, which does not transfer to a discrete
> system. See §12.4 for the honest scope of the borrowing.

### 12.1 The evidence

From the iteration-11 state dump of a 705-node / 5263-edge run:

```
"sheaf_energy": 0,
"gap_count": 0,
"agent_count": 0,
"communities": 10
```

`sheaf_energy: 0` means the Dirichlet energy `x^T L x` is exactly zero — the
system sits at a perfect global section, so there is nothing for H¹ to detect.
`gap_count: 0` and `agent_count: 0` across the whole run mean the obstruction
handler and its agent-spawning path were **never once exercised**. The entire
consensus/obstruction/agent machinery has been decorative in practice.

### 12.2 Why it is structurally impossible as currently built

The sheaf is constructed by `ComposeRootModule.buildSheafFromRegistry()` over the
**subgraph registry** (≈10 vertices), not the concept graph. Three independent
properties each force H¹ = 0, and all three must be fixed together:

1. **Stalk dimension 1.** Every vertex and edge gets `stalkSpace: { dim: 1 }`. A
   1-D stalk holds a scalar. Sheaf cohomology measures _multi-dimensional_
   disagreement that cannot be reconciled around a cycle; a scalar cannot carry it.
2. **Trivial restriction maps.** Each edge uses `entries: [1.0]` on the source
   side and `[weight]` on the target side — i.e. scalar multiplication. Restriction
   maps that are scalar multiples essentially never _conflict_: a global section
   almost always exists, so the coboundary B has full rank and `h1 = N1 − rank = 0`.
3. **Acyclic base graph.** An edge is emitted only when concept similarity > 0.7.
   That high threshold makes the subgraph graph sparse — a forest or near-forest.
   A graph with no independent cycles has H¹ = 0 _by topology alone_, regardless of
   stalk/restriction content. (`b1 = E − V + C` cycles; if E ≲ V the cycle space is
   empty.)

**Good news from reading the code:** `CellularSheaf`, `SheafVertex`, `SheafEdge`,
and `RestrictionMap` already fully support arbitrary stalk dimensions and arbitrary
row-major restriction matrices (`entries.length === targetDim * sourceDim`). The
core data structure is **not** the limitation. The fix is confined to
`buildSheafFromRegistry()` — no surgery to the sheaf/cohomology core.

### 12.3 The two-level construction (the proposed fix)

The paper's transferable idea: a system carrying **two coupled levels** — a _weak_
level (coarse, always defined) and a _strong_ level (fine, densely embedded in the
weak one) — where the interesting object lives in the gap between them. Mapped to
AGEM:

- **Weak level** = each subgraph's concept _centroid_ (the L2-normalized mean
  embedding already used to compute the 0.7 similarity edges). Coarse semantic
  position.
- **Strong level** = each subgraph's _internal embedding structure_ — not the mean
  but the spread: the top-k principal directions of its node-embedding covariance
  (a small k, e.g. 3–8). Fine structure.
- **The obstruction lives in the gap.** Two subgraphs can **agree at the weak
  level** (centroids close ⇒ an edge exists) while **disagreeing at the strong
  level** (their principal subspaces are oriented incompatibly). That surface-
  agreement-with-deep-conflict is a _meaningful_ reasoning failure: two lines of
  argument that sound compatible but rest on incompatible commitments. It is
  exactly the multi-dimensional, around-a-cycle conflict H¹ exists to find — and it
  is invisible to a scalar stalk.

Concretely, per the three failure modes:

1. **Stalk dim k > 1.** Vertex stalk = the subgraph's top-k principal directions
   (or the k-dim projection of its centroid into a shared basis). `dim: k`.
2. **Non-trivial restriction maps.** For edge (A,B), the restriction map to the
   edge stalk is the **linear map relating A's strong-level basis to the shared
   edge frame** — e.g. the projection of A's principal subspace onto the edge's
   reference subspace. When A's and B's subspaces disagree, the two restriction
   maps cannot be simultaneously satisfied around a cycle ⇒ nonzero coboundary
   residual ⇒ H¹ > 0. These are genuine k×k (or k×m) matrices, not scalars.
3. **Cycles in the base graph.** Lower the edge threshold (or use k-nearest-
   subgraph instead of a hard 0.7 cutoff) so the subgraph graph contains
   independent cycles. No cycles ⇒ no H¹, so this is non-negotiable. A simple,
   tunable rule: connect each subgraph to its m most weak-level-similar neighbors
   (m ≥ 2), which guarantees a cycle space once there are ≥ 3 mutually-near
   subgraphs.

### 12.4 Honest scope of the borrowing

- **Transferred:** the _two-level motif_ (weak/strong coupling; the obstruction
  lives in the gap). This gives the redesign a principled target instead of "make
  the stalks bigger and hope."
- **NOT transferred:** the Hilbert-manifold analysis, the exponential-map failure,
  Sobolev embeddings, Fredholm theory, and the tameness _estimate_ itself. AGEM is
  discrete and finite-dimensional; none of that has a computable analog here.
- **Tameness-closed-under-composition** is attractive (AGEM builds sheaves
  incrementally, and one would _like_ "well-behaved pieces ⇒ well-behaved whole").
  But the discrete analog is not derivable from this paper. Do **not** claim the
  AGEM construction is "tame" — that would be the same borrowed-rigor overclaim we
  rejected for "entanglement" in §2. The motif tells us _where_ obstructions should
  come from; it does not prove they are well-defined.

### 12.5 Open dependency before implementing — RESOLVED

The construction needs the per-subgraph strong-level data. Verified in
`SubgraphRegistry.getConceptVector()` / `conceptSimilarity()`:

- **Weak level EXISTS.** `getConceptVector(id)` gathers a subgraph's item
  embeddings (root summaries, or raw entries as fallback), sums → averages →
  **L2-normalizes** into a single centroid. `conceptSimilarity` is the cosine of
  two centroids. This is the weak level, already cached and proven.
- **Strong level DOES NOT EXIST.** Only the mean survives the loop. The spread /
  covariance / principal directions are computed and stored nowhere. The raw
  material _is_ present — `sub.cache.getEmbedding(id)` yields each item's
  embedding — but nothing captures their distribution.

**Implication — clean, low-risk add.** Add a sibling method, e.g.
`getConceptSubspace(id, k): Float64Array /* k×d */`, that reuses the exact same
id-collection + cache-lookup loop as `getConceptVector`, but ends in a truncated
PCA instead of a mean:

1. Collect the same embeddings (reuse existing logic).
2. **Subtract the centroid** (center the cloud) — the strong-level signal is the
   variation _around_ the mean, not the mean. (Weak level = normalized mean;
   strong level = principal axes of the mean-subtracted cloud. Do not conflate.)
3. Take the **top-k principal directions** via a truncated/randomized SVD of the
   stacked `count × d` matrix — never form the `d × d` covariance (avoids the d³
   trap from §11.4 #4). k small (3–8); count is modest (often single-digit summary
   roots), so this is cheap.
4. Runs only on sheaf rebuild, which is itself gated on registry change (§11.4
   #2) — so it is not a per-cycle cost.

**Edge case that must be handled deliberately (else H¹ silently returns to 0):**
when a subgraph has fewer than k+1 embeddings (common on the root-summary path —
possibly 1–2 vectors), the covariance is rank-deficient and k principal directions
do not exist. Define behaviour explicitly: reduce k to the available rank, or fall
back to raw entries when summaries are too few. An unhandled low-count case
produces degenerate stalks → trivial restriction maps → H¹ = 0, i.e. exactly the
failure being fixed.

**Adaptive-rank ladder (the correct handling).** With N = embedding count for the
subgraph:

- **N > k** → extract top-k principal components (the normal path).
- **1 < N ≤ k** → set `k_eff = N − 1` and extract that many. The `−1` is exact,
  not a safety margin: centering the cloud (subtracting the mean) spends one degree
  of freedom, so N centered points span an at-most-(N−1)-dim subspace; the N-th
  direction is numerically zero and extracting it yields noise.
- **N = 1** → no spread to measure. Vertex degrades to a weak-level-only stalk
  (the single embedding). This is a non-crashing fallback, NOT a preservation of
  topological signal — a 1-D stalk cannot carry rich conflict. Such vertices simply
  do not contribute obstruction structure; the richer vertices do.

**CRITICAL — do NOT zero-pad heterogeneous stalks to a uniform width k.** This is
the seductive-but-wrong fix. `CellularSheaf` already supports per-vertex stalk
dimensions: its constructor sums `stalkSpace.dim` per vertex into `_c0Dimension`,
so a `k_eff = 2` vertex should simply have `dim: 2`. Padding such a stalk up to k
with zeros injects fake directions; when two vertices share zero-padded slots their
restriction maps agree _trivially_ in those slots, manufacturing false consensus
and pushing H¹ back toward 0 — a quieter rerun of the original failure. The SVD of
the coboundary cannot tell a padded zero row from a genuine satisfiable constraint.
**Let stalk dimensions vary; do not pad.**

**Restriction maps across differing dimensions — projection, NOT padding/truncation.**
For edge (A,B) with vertex stalk dims k_A, k_B (possibly unequal), choose an edge
stalk dim m (e.g. `min(k_A, k_B)` or a fixed small m). Each restriction map is the
genuine linear map from that vertex's principal subspace into the shared edge frame
— an `m × k_A` matrix that projects A's directions onto the edge reference (and
likewise `m × k_B` for B). A and B never need matched dimension because they meet
_in the edge stalk_, not directly. The obstruction arises when A's and B's
projections into that shared frame cannot be simultaneously satisfied around a
cycle. (Padding/truncating A and B to equal width before comparing is the same
false-consensus trap as stalk padding — avoid it.)

**Implementation note.** AGEM is TypeScript; the sheaf layer already uses
`ml-matrix` (`SingularValueDecomposition` in `CohomologyAnalyzer`) and `mathjs`.
`getConceptSubspace` should use `ml-matrix`'s SVD on the `count × d` stacked,
mean-centered embedding matrix — no new dependency. The truncated SVD on a small
`count × d` matrix is cheap and avoids forming the `d × d` covariance (§11.4 #4).

### 12.6 Relationship to the rest of this document

This is the same theme as §2 (emergent bonds) and §4 (the graph as ground truth):
the current sheaf is the Lewis-label situation again — structure assigned trivially
rather than derived from real correlation. The two-level construction derives the
restriction maps from actual embedding structure, exactly as emergent bonds derive
bond type from mutual information. If both are built, the H¹ obstruction and the
synergy/O-information cluster index (§2) become two independent detectors of the
same "irreducible higher-order conflict," which is a strong cross-check.

---

## 13. VERIFIED: the sheaf analyzer is sound (offline harness result)

> Settled by direct offline computation (`docs/ebsr-implementation/sheaf-harness.ts`),
> bypassing the server, the MCP layer, and the LLM. This answers the question open
> since §12: is the H¹ machinery real, and were the quantum-run H¹=0 readings
> truthful?

### 13.1 What the T3/conscience/hipai noise actually was

`grep` of `src/` for `TIMEOUT|conscience|hipai` returns **nothing** — those terms
exist only as unrelated module-isolation test labels (T1–T5 import-boundary tests).
The "T3 TIMEOUT", "conscience-servitor KERNEL1", etc. in the run logs come from the
**MCP servers** (conscience-servitor, hipai-montague) and/or LLM narration, NOT from
AGEM's sheaf code. The sheaf numbers (H⁰/H¹) are AGEM's; the PASS/TIMEOUT framing
around them was external. So a "T3 TIMEOUT" never corrupted a cohomology value — it
was a broken-MCP artifact, consistent with the reported hipai error.

### 13.2 The one legitimate silent-zero path (not a bug)

`computeCohomology` early-returns `h1=0, h0=N0` when `N1 === 0` (no edge stalks =
no edges). This is correct: with no edges there is nothing to carry an obstruction.
This is the only short-circuit; there is no timeout, no catch-swallows-zero, no
cache-returns-stale path in the analyzer.

### 13.3 The coboundary convention (read from CoboundaryOperator.ts)

B row for edge (u→v): `−srcEntries` on u's block, `+tgtEntries` on v's block.
Constraint: `−src·s_u + tgt·s_v = 0`. Holonomy around a loop = ∏(src/tgt).

### 13.4 Harness results — all four correct

| Test | Topology | H⁰ | H¹ | Meaning |
| :-- | :-- | :-: | :-: | :-- |
| 1 | tree (A–B) | 1 | 0 | connected, no cycle |
| 2 | no edges | 2 | 0 | two components; legitimate N1=0 early return |
| 3 | twisted triangle (holonomy −1) | 0 | 0 | twist saturates rank: no global section |
| 4 | untwisted triangle (holonomy +1) | 1 | 1 | consistent section AND loop carries H¹=1 |

**The analyzer provably produces H¹ > 0** (Test 4) and correctly distinguishes the
four cases. The machinery is sound — not decorative (the minimax run was flat-zero
only because the *old* sheaf had no cycles), not buggy.

### 13.5 Correction to an earlier prediction (logged, like the ADMM miss in §3)

The first harness draft predicted Test 3 (twisted) → H¹=1 and Test 4 (untwisted) →
H¹=0. **Both were backwards**, caught only by running the math. The subtlety:

- A triangle has Betti number b₁ = E−V+1 = 1. An **untwisted** flat sheaf on it has
  H⁰=1 *and* H¹=1 — the H¹ is the **cohomology of the loop itself**, present even
  under full agreement. H¹>0 here is *topological*, not a contradiction.
- A **twist** (holonomy ≠ 1) makes all edge constraints independent, raising rank,
  which *drops* H¹ to 0 and kills the global section (H⁰=0).

This is the crucial interpretive point: **for 1-D real stalks, H¹ counts independent
cycles, and a twist removes rather than creates H¹.** "Disagreement" in the everyday
sense is not a holonomy twist.

### 13.6 Implication for the quantum-interpretations run

The QM run's H¹=0 (and H⁰ moving 1→2→3→1→1) was **truthful**. The interpretations
are empirically equivalent — there is no holonomy twist among them, so no obstruction.
This is exactly the blind-men-and-the-elephant structure: locally consistent partial
views of one consistent object produce **no** cohomological obstruction. The H⁰
trajectory (fragmentation as Bohmian/QBism stake out distinct ground, reunification
as Objective Collapse/RQM bridge) is the sheaf doing real topological work.

### 13.7 What this does and does not establish

- **Establishes:** the analyzer is correct; H¹ can fire; H⁰ tracks semantic
  components; the redesigned multi-dim-stalk builder produces non-trivial sheaves.
- **Does NOT establish:** that AGEM's *higher-dimensional PCA stalks with projective
  restriction maps* (the §12 builder, as opposed to these 1-D test stalks) will
  produce a holonomy twist on naturally-conflicting reasoning. That is the next
  open question — whether real strong-level subspace conflict manifests as nonzero
  holonomy. It requires feeding `buildSheafFromRegistry` real embeddings offline and
  inspecting the resulting B, not just the scalar test sheaves here.

### 13.8 Loose end

The harness's closing print block still contains two stale guide lines ("Test 3 =
the real probe (H¹ must be 1)") from the pre-correction draft. Cosmetic only; the
per-test EXPECTED strings and results are correct.

---

## 14. VERIFIED: the sheaf responds to topology, not to conflict (real-embedding probe)

> Settled by `docs/ebsr-implementation/sheaf_real_embeddings.py` +
> `run_real_probe.py`, which replicate AGEM's REAL `buildSheafFromRegistry` and
> `computeCohomology` math (read line-by-line from `ComposeRootModule.ts` and
> `CoboundaryOperator.ts`) but feed them REAL embeddings from the same model AGEM
> uses in production (`embeddinggemma:latest` via local Ollama), instead of the
> hash-random `MockEmbedder` that makes any semantic test meaningless.

### 14.1 Why this probe was necessary

`MockEmbedder` is `Math.sin(sha256(text)+i)` — every string maps to a random
point on the sphere, with zero semantic structure. So no in-repo test, and no
MockEmbedder-based harness, can tell whether semantic conflict affects the sheaf.
Real embeddings are required. AGEM's production embedder (`ProviderEmbedder`)
calls Ollama; the probe hits the same Ollama model directly.

Separately confirmed during this probe: in the M3 "hard problem" run the sheaf
had only ONE subgraph (the active one). One vertex ⇒ no edges ⇒ H¹=0 trivially.
The "challenger" the agent described registering was a conscience-servitor MCP
call, NOT an AGEM subgraph — and sheaf vertices ARE subgraphs
(`subgraphRegistry.list()`). So that run could never have produced an obstruction
regardless of agent behaviour.

### 14.2 Result — three corpora, identical cohomology

Each corpus = 3 subgraphs × 3 sentences, embedded with embeddinggemma:

| Corpus | Character | sims (centroid cosine) | N0 | N1 | rank | H⁰ | H¹ |
| :-- | :-- | :-- | :-: | :-: | :-: | :-: | :-: |
| A | QM interps (empirically equivalent) | 0.74–0.75 | 6 | 6 | 6 | 0 | 0 |
| B | direct contradictions (P vs ¬P) | 0.67–0.84 | 6 | 6 | 6 | 0 | 0 |
| C | circular inconsistency (A→B→C→¬A) | 0.63–0.77 | 6 | 6 | 6 | 0 | 0 |

**All three identical.** Semantic conflict (B, C) produced exactly the same
cohomology as interpretive-only difference (A). Note B's *contradiction* pair
scored the HIGHEST similarity (0.844) — "collapse is real" and "collapse is not
real" are lexically near-identical — and the cohomology did not care.

### 14.3 Mechanism — generic real vectors saturate the coboundary rank

With real embeddings:
1. Related passages all score cosine ≥ 0.4, so the subgraph graph is near-complete
   and always has cycles. Topology is saturated by similarity alone.
2. Restriction maps are PROJECTIONS of one subgraph's principal directions onto a
   shared basis. Projections of generic high-dimensional real vectors are almost
   always linearly independent.
3. Independent projections ⇒ coboundary B reaches FULL RANK (rank = N1 = N0 = 6)
   ⇒ H⁰ = N0 − rank = 0 and H¹ = N1 − rank = 0, every time, regardless of content.

H¹ being nonzero requires rank-DEFICIENCY (restriction maps that fail to compose
consistently around a loop — a holonomy twist). The §13 harness produced H¹>0
only with hand-built degenerate SCALAR stalks. Real high-dimensional embeddings
never produce that degeneracy under projection-based maps.

### 14.4 What this establishes (and its boundary)

**Establishes:** As currently built, the two-level sheaf does NOT detect semantic
conflict. It detects whether enough subgraphs are similar enough to form cycles —
a connectivity/topology signal — which is real but is NOT the intended meaning of
"H¹ obstruction = irreconcilable disagreement." The restriction maps encode
GEOMETRY (subspace projection) weighted by SIMILARITY; nothing in them encodes
CONTRADICTION. Two subgraphs that flatly negate each other are, geometrically,
just two different subspaces — and "different" is not "frustrated around a loop."
The weight-on-target asymmetry scales but does not rotate, so it does not create
frustration either.

**Does NOT establish / boundary of the claim:**
- Three tiny symmetric triangles (N0=N1=6, square B). Full-rank saturation is most
  forced exactly when B is square. A different regime — many subgraphs, higher k,
  SPARSE similarity so the graph is not near-complete (N1 ≠ N0) — was not tested
  and could differ. This is a sharp probe, not a survey.
- It does NOT overturn §13 (the analyzer is correct). It shows the CONSTRUCTION
  feeding the analyzer does not translate conflict into rank-deficiency. Different
  layers; both findings stand.

### 14.5 The real design question this surfaces

What would a restriction map have to encode for CONFLICT (not mere difference) to
produce a holonomy twist? This is not a tuning fix — it is whether the sheaf
formalism is the right tool for "detect contradictory reasoning" at all. Two
honest options:
- **Reframe the sheaf's job** as what it actually measures: semantic
  connectivity / fragmentation. That is the H⁰ signal, which DID move meaningfully
  (1→2→3→1→1) in the earlier quantum run. H⁰, not H¹, may be the sheaf's real
  contribution.
- **Detect contradiction elsewhere.** The logic layer already does this correctly:
  in the M3 run, Mace4 genuinely found the `FunctionalComplete ∧ ¬Experience`
  counterexample. Contradiction may belong to the logic/SAT layer, with the sheaf
  reserved for connectivity.

Designing a restriction map that encodes contradiction as holonomy (e.g. a signed
or rotational map derived from entailment/negation relations rather than cosine
geometry) is possible in principle but is a research task, not a fix, and risks
re-introducing the "decoration" problem if the signing rule is arbitrary.
