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
