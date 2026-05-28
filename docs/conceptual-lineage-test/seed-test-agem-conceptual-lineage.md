# Seed & Test Corpus — AGEM Conceptual Lineage

> **Type:** test fixture + memory seed. **Not a skill.**
> **Purpose:** stress the live P0/P1/Move-A spine — LLM-backed compaction
> (`ProviderCompressor`), lumpability auditing, and v2 persistence — using a corpus
> whose vocabulary is full of *true near-synonyms that must not be merged*.

## How to run it

1. **Accumulate.** Feed the passages below through chat (or load them) turn by turn until
   the store crosses your L1/L2/L3 thresholds. Watch the event log for escalation +
   `lumpability:audit-complete`. The goal is to *force at least one compaction*.
2. **Watch the traps.** Each compaction produces a `SummaryNode`. For every protected pair in
   the Answer Key below, check whether the summary preserved the distinction. A summary that
   collapses a pair *should* raise `lumpability:weak-compression` (entropy ratio drop). If it
   collapses the pair and the auditor stays silent, that's a real finding — the auditor's
   sensitivity is too low for semantically-adjacent merges.
3. **Persist round-trip.** After building summaries: save the session, start fresh, reload.
   Confirm (a) entry IDs/hashes survive, (b) `EmbeddingCache` re-embeds **nothing** (model tag
   matches), (c) the summary DAG resolves `getEntriesForSummary()` correctly.
4. **Side benefit.** This is AGEM reasoning about its own foundations — it tends to surface
   genuinely interesting cross-concept links, which is also a preview of what Move B/C will
   formalize as cross-subgraph synthesis.

## Answer key — distinctions the auditor must protect

A faithful summary keeps each pair *distinct*. Collapsing one is a weak-lumpability event.

1. **von Neumann entropy** (spectral/structural) ≠ **embedding entropy** (semantic distribution).
2. **H⁰** (consensus / global sections) ≠ **H¹** (obstruction / inconsistency).
3. **Covalent** (logical dependency) ≠ **hydrogen** (self-reflection) ≠ **Van der Waals** (exploration) bonds.
4. **Strong lumpability** (exact) ≠ **weak lumpability** (initial-distribution-dependent / lossy).
5. **Selection term** (covariance) ≠ **transmission term** (within-group expectation) in the Price equation.
6. **SOC** (the self-tuning process) ≠ **phase transition** (the event at criticality).
7. **Restriction map** (per-edge morphism) ≠ **coboundary operator** (global assembly δ).
8. **ADMM** (the iterative solver) ≠ **Sheaf Laplacian spectrum** (the structure it descends).
9. **SEEKING** ≠ the other Panksepp primary systems (FEAR, RAGE, CARE, PANIC/GRIEF, PLAY, LUST).
10. **Reflection** (query-agnostic QA pair) ≠ **summary** (compression of source spans).

---

## Corpus

### 1. Two entropies, two jobs

AGEM's Self-Organized Criticality tracker computes several quantities that all wear the word
"entropy," and conflating them defeats the System-1 override detector. **Von Neumann entropy
(VNE)** is spectral: it is computed from a density matrix derived from the graph Laplacian's
eigenspectrum, S = −Tr(ρ log ρ), and it measures the *structural* dispersion of the reasoning
topology — how spread-out the connectivity is across modes. **Embedding entropy (EE)** is
distributional: it measures the dispersion of the *semantic* embedding cloud, independent of
graph wiring. The two can move in opposite directions. The System-1 signature — "conclusion
precedes logic" — is precisely the case where EE *stabilizes* (semantics have settled) while
structural entropy has not yet developed: the model has committed to an answer before the
reasoning graph earned it. A summary that flattens VNE and EE into "the system's entropy"
erases the very gap the detector watches for.

### 2. H⁰ is agreement; H¹ is the crack

Cohomology in AGEM is computed by SVD of the coboundary operator over the cellular sheaf.
The two degrees mean opposite things. **H⁰** is the space of *global consistent sections* — the
assignments on which all agents already agree across their shared edges; a large, healthy H⁰ is
consensus (Kernel 1 closure). **H¹** is the space of *obstructions* — local data that cannot be
glued into any global section; a nonzero H¹ is the mathematical fingerprint of an
inconsistency no amount of local agreement can paper over. They are not "two measures of
consistency": one counts what fits together, the other counts what *cannot*. Recovery
strategies (kernel retreat, re-partition, soft relax) are triggered by H¹, never by H⁰.

### 3. Three bonds, three behaviors

Molecular Chain-of-Thought types its reasoning edges by analogy to chemical bonds, and the
three are behaviorally distinct invariants, not decorative labels. A **covalent bond** is a
strong logical dependency: the child claim cannot stand if the parent falls. A **hydrogen bond**
is self-reflection: a weaker, reversible link a thought makes back onto itself or a sibling to
check coherence. A **Van der Waals force** is exploration: a faint, opportunistic attraction
that lets the system drift toward loosely-related material, and it is the bond type the
obstruction handler spawns agents to exploit when H¹ opens a gap. Merging these into "types of
reasoning links" discards the enforced invariant that covalent dependencies propagate failure
while Van der Waals links do not.

### 4. Lumpability: the exact and the approximate

Lumpability comes from Markov chain theory (Kemeny–Snell): a partition of states is **strongly
lumpable** if the aggregated chain is itself Markov *for every* initial distribution — the
coarse-graining loses nothing about future dynamics. It is **weakly lumpable** if that holds
only for *particular* initial distributions — the aggregation is conditionally valid and, in
general, lossy. AGEM repurposes the distinction as its compaction audit: a summary that
preserves the source's information profile is strongly lumpable; one that drops structure
that mattered is weakly lumpable, and the auditor flags it by comparing the embedding-entropy
profile of the source spans against the summary. The two are not points on a smooth dial of
"how good the summary is" — strong lumpability is a categorical guarantee, weak lumpability is
its conditional, failure-prone cousin. Calling a weakly-lumpable compaction "mostly lumpable"
is itself the error the auditor should catch.

### 5. The Price equation splits change in two

AGEM's evolutionary feedback uses the Price equation to decompose change in a trait's mean
across the reasoning population into exactly two terms. The **selection term** is a covariance:
Cov(fitness, trait) / mean-fitness — it captures how much the trait shifts because fitter
variants carry it. The **transmission term** is an expectation: E(fitness · Δtrait) /
mean-fitness — it captures how much the trait shifts *within* lineages as they reproduce,
independent of selection. Selection is "the fit are chosen"; transmission is "the chosen
change as they pass on." Collapsing them into "evolutionary pressure" destroys the diagnostic
value: a system can show large total change with near-zero selection (pure drift/transmission)
or large selection cancelled by opposing transmission, and only the split tells them apart.

### 6. Criticality is a state you tune toward; a transition is an event

Self-Organized Criticality (SOC) names a *process*: a system that, without external tuning,
drives itself to the neighborhood of a critical point and lingers there, poised between order
and disorder. A **phase transition** is the *event* that occurs at criticality — the abrupt
reorganization the SOC tracker flags via a spike in the correlation coefficient between
structural and semantic change. SOC is the standing disposition; the phase transition is the
discrete crossing. AGEM wants the former as a regime (the productive edge where innovation is
possible) and monitors the latter as punctuation. A summary that says "the system reaches
criticality and transitions" without separating the maintained regime from the momentary event
loses the regime-classification the dashboard reports continuously.

### 7. Restriction maps are local; the coboundary is global

A **restriction map** is a per-edge object: given an edge between two agent stalks, it specifies
how one agent's local section is to be read in the other's frame — a single morphism on a
single edge, and both directions of a bidirectional edge must agree on their target keys. The
**coboundary operator** (δ) is the global assembly of *all* restriction maps into one linear
operator over the whole sheaf; its image and kernel are what cohomology is computed from
(H⁰ = ker δ at degree 0; H¹ from the cokernel / SVD at degree 1). One restriction map is a tile;
the coboundary is the whole mosaic's difference operator. Editing a restriction map is a local
act; it changes δ, which changes the cohomology globally. Treating "restriction map" and
"coboundary operator" as synonyms hides that a single bad edge map can flip the global H¹.

### 8. ADMM is the solver; the Laplacian spectrum is the structure

The **Sheaf Laplacian** is L = δᵀδ (the README's BᵀB) — a structural object whose kernel is the
consensus space and whose eigenspectrum characterizes how far the configuration sits from
agreement. **ADMM** (alternating direction method of multipliers) is the *iterative algorithm*
that descends toward that consensus, exchanging dual variables across edges until primal and
dual residuals converge. The Laplacian is where the system *is*; ADMM is how it *moves*. The
distinction matters operationally: a large H¹ is a statement about the spectrum (a structural
obstruction that no solver can dissolve), whereas slow ADMM convergence with eventual success
is merely a dynamics problem. A summary conflating "the Laplacian converges via ADMM" misattributes a structural obstruction to a solver hiccup, sending recovery down the wrong path.

### 9. SEEKING is not the others

The ASEKE/compass module draws on Panksepp's affective neuroscience, in which the mammalian
brain has several *distinct* primary emotional systems, each a separable neural circuit:
**SEEKING** (appetitive anticipation, the engine of curiosity and approach), **FEAR**,
**RAGE**, **LUST**, **CARE**, **PANIC/GRIEF** (separation distress), and **PLAY**. SEEKING is
the dopaminergic foraging-and-wanting system and is *not* pleasure (consummatory reward), *not*
fear-avoidance, and *not* care-bonding; it is the generalized "go find out" drive that often
gets misread as a single positive-affect blob. A summary that compresses the taxonomy into
"emotional drives" or fuses SEEKING with reward erases the circuit-level separations the
behavioral pattern-matcher relies on to map situations to systems.

### 10. Reflections are not summaries

Looking ahead to the MEMO-inspired memory work: a **summary** is a compression of specific
source spans — it points back at the entries it condensed and is indexed by what it covers. A
**reflection** is a *query-agnostic compositional unit* — a question→answer pair (often spanning
multiple sources, sometimes inferring beyond any single one) constructed so that an unseen
future query can reach the underlying knowledge without ever seeing the source. A summary
answers "what did these passages say?"; a reflection answers "what could someone later need to
ask, and what's the answer?" They are different artifacts with different indexing and different
failure modes, and the planned Move-C work stores reflections *alongside* summaries rather than
replacing them. Collapsing the two would erase the whole reason reflections generalize where
summaries do not.

---

## Calibration note (mid, vigorous, cheap compressor)

A mid model tends to fail in two characteristic ways on this corpus, both of which are
*useful* signal:
- **Over-merging adjacent terms** (e.g. VNE≈EE, H⁰≈H¹, strong≈weak lumpability). This is the
  primary thing you're testing — it *should* trip `lumpability:weak-compression`.
- **Vigorous padding** — a verbose model may produce long summaries that *look* faithful while
  quietly dropping a distinction. Don't judge by length; judge by whether each Answer-Key pair
  survives. The entropy-ratio audit is supposed to see through padding; verify that it does.

If a pair gets merged and the auditor stays silent, log it — that's a sensitivity-tuning task
for `LumpabilityAuditor` (entropy-ratio threshold or VK-checker), not a failure of the test.

## Genuinely-interesting cross-links to watch for

This corpus is built so real conceptual bridges exist; a good run may surface them, and they
preview what Move-B cross-subgraph synthesis should formalize:
- **H¹ ↔ weak lumpability ↔ EE/VNE gap** are three views of the same underlying event: local
  data that won't glue, a compaction that loses structure, and semantics outrunning topology.
- **SEEKING ↔ Van der Waals ↔ SOC regime**: the exploratory drive, the exploratory bond, and
  the critical regime that makes exploration productive — an affect/topology/dynamics triangle.
- **Price selection/transmission ↔ explore/exploit**: the decomposition is a principled handle
  on the same trade-off the regime classifier governs.
