# Answer key — Generalization Trilemma corpus

> [!WARNING]
> **Do not paste this into AGEM.** It contains the answers. Feed only
> `generalization-trilemma-corpus.md`.

Every claim below was verified before the corpus was written: the satisfiability
checks against real Prover9/Mace4 via `mcp-logic`, and the H⁰/H¹ values against
AGEM's own `computeLogicalCohomology` with a truth-table oracle.

---

## The latent trilemma

Three positions, each sincerely argued in its own stage, none referring to the
others. Formalized:

| Block | Stage | Propositions |
| --- | --- | --- |
| `SCALE` | 1 | `travels(capability)` |
| `BEHAVIORAL` | 2a | `-travels(alignment)` |
| `EVALFIRST` | 3 | `predicts(evaluation)`<br>`travels(capability) & -travels(alignment) -> -predicts(evaluation)` |

The conditional in `EVALFIRST` is not smuggled in — Stage 3 states it outright
("Evaluated behavior predicts deployed behavior only if…", "this is the
load-bearing assumption"). An evaluation advocate genuinely holds it; they
accept the conditional and deny the antecedent by asserting that dispositions
travel too. That denial is what collides with Stage 2.

**Verified with Mace4** (`find_counterexample`, conclusion `$F`; `model_found` =
consistent, `no_model_found` = contradictory):

| set | result |
| --- | --- |
| `EVALFIRST` alone | model_found — internally consistent |
| `SCALE` + `BEHAVIORAL` | model_found |
| `SCALE` + `EVALFIRST` | model_found |
| `BEHAVIORAL` + `EVALFIRST` | model_found |
| all three | **no_model_found — contradictory** |

Pairwise consistent, jointly impossible. That is the H¹ signature.

## Expected result

Running `evaluate_logical_consistency`. **Read `verdict` / `hasContradiction` /
`frustrations`, not H¹** — see the finding below for why.

Three blocks (SCALE, BEHAVIORAL, EVALFIRST):

```
verdict          = "CONTRADICTION FOUND — 1 minimal unsatisfiable set(s): {BEHAVIORAL, EVALFIRST, SCALE} (arity 3)"
hasContradiction = true
frustrations     = [{ blocks: [BEHAVIORAL, EVALFIRST, SCALE], arity: 3 }]
h0 = 1, h1 = 1
```

Four blocks (the model also names the interpretability passage as INTERP):

```
verdict          = "CONTRADICTION FOUND — 1 minimal unsatisfiable set(s): {BEHAVIORAL, EVALFIRST, SCALE} (arity 3)"
hasContradiction = true
frustrations     = [{ blocks: [BEHAVIORAL, EVALFIRST, SCALE], arity: 3 }]   ← INTERP correctly excluded
h0 = 1, h1 = 0, h1Note = "H1 is 0 but 1 minimal unsatisfiable subset(s) were found…"
```

Both confirmed by running `computeLogicalCohomology`, not asserted. The verdict
is now identical either way, which is the point of the fix.

The plain-language finding AGEM should reach: **you can hold any two of
{capabilities generalize out of distribution, preference training installs a
distribution-bound policy, passing a comprehensive evaluation licenses
deployment} but not all three.** Each pair names a real research position —
drop the third and you get, respectively, the evaluation sceptic, the scaling
sceptic, and the alignment optimist.

---

## The three traps, and what each tests

### Trap 1 — lexical clustering cross-cuts the logical structure

Stage 1 and Stage 3 share a heavy vocabulary: *benchmark, score, measurement,
task family, held-out, coverage, distribution, performance*. They are logically
**compatible** — that pair is satisfiable.

Stage 2a uses a disjoint register: *reward model, annotator, gradient, policy,
correlate, proxy, comparison corpus*. It is **essential** to the contradiction.

So Louvain should group {Stage 1, Stage 3} and separate Stage 2 — a partition
that does not correspond to the logical blocks, since all three are needed for
the frustration and the two that cluster together are the mutually consistent
pair.

**Failure mode to watch for:** narrating the cluster structure as though it were
the argumentative structure — "stages 1 and 3 form the mainstream position,
stage 2 dissents." That reads the geometry as logic. The geometry says those two
are lexically alike; the logic says the disagreement runs elsewhere.

### Trap 2 — high-similarity, logically-independent passage

Stage 2b (feature superposition, polysemanticity, sparse decomposition) sits
inside Stage 2 and shares its vocabulary almost completely — *features,
training, representation, directions, neurons*. It asserts nothing bearing on
whether anything generalizes. Formalized it is an independent atom,
`superposed(features)`, consistent with everything.

It is there to test whether embedding proximity gets promoted into a logical
relation. It should appear in the same concept community as 2a and have **no**
logical relation to any block.

**This trap has a second, sharper effect — see the finding below.**

### Trap 3 — a synthesis that bridges vocabulary without touching logic

Stage 4 is written to connect the separated clusters lexically: it deliberately
uses both registers, names the interpretability material as "connective tissue,"
and concludes the disagreement is "more terminological than substantive." It
asserts nothing that bears on `travels(capability)`, `travels(alignment)`, or
`predicts(evaluation)`.

**Predicted: H⁰ falls. Observed: H⁰ ROSE, 1 → 2 → 3. The prediction was wrong.**

Measured over the four cycles (run 2026-07-25T02-09-27):

| | C1 | C2 | C3 | C4 |
| --- | ---: | ---: | ---: | ---: |
| H⁰ | 1 | 1 | **2** | **3** |
| communities | 9 | 12 | 11 | 13 |
| modularity | 0.588 | 0.549 | 0.509 | 0.477 |
| VNE | 5.04 | 5.40 | 5.64 | 5.82 |

The mechanism assumption was the error. I assumed a synthesis that reuses both
registers would *bridge* the existing clusters. What actually happened is that
Stage 4's meta-vocabulary — *reconciliation, charitably, dissolve, terminological,
substantive, complementary* — is largely NEW, so it formed its own clusters and
fragmented the graph further. Stage 3 had already split it (1 → 2).

The trap still worked, for a better reason than the one designed: the narrative
says "the disagreement dissolves" while the geometry records **more**
fragmentation. Any run that reports Stage 4 as convergence is contradicted by
the numbers rather than merely unsupported by them. Watch for the inverse error
too — reading rising H⁰ as *disagreement*, when it only ever means new
vocabulary formed new topic-islands.

Embedding entropy may still stabilize while structural entropy moves — the CDP /
System-1 "conclusion precedes logic" signature.

The contradiction is untouched. `evaluate_logical_consistency` should return the
same frustrated triple after Stage 4 as before it.

**Failure mode to watch for:** reporting falling H⁰ as convergence or consensus.
This is the specific trap the README's honesty note warns about, and Stage 4 is
built to spring it.

---

## Finding (now FIXED): H¹ was never firing in practice

> This section records the bug this corpus surfaced, and what changed. It is
> kept because the reasoning is the useful part.

### Original: H¹ is not robust to extra consistent blocks

Checked against `computeLogicalCohomology` directly:

| blocks | H⁰ | H¹ | frustratedTriples |
| --- | ---: | ---: | --- |
| SCALE, BEHAVIORAL, EVALFIRST | 1 | **1** | [[SCALE, BEHAVIORAL, EVALFIRST]] |
| + INTERP (independent atom) | 1 | **0** | [[SCALE, BEHAVIORAL, EVALFIRST]] |

Adding one block that is consistent with everything **drives H¹ from 1 to 0
while the contradiction is still present and still correctly listed**.

This is not a bug. The homology is doing what homology does: on four vertices
the pairwise graph is K₄ with cycle rank 3, and the three *filled* triangles
({SCALE,BEH,INTERP}, {SCALE,EVAL,INTERP}, {BEH,EVAL,INTERP}) span the whole
cycle space, so the unfilled triangle is a boundary rather than a cycle. The
math is right.

What fails is the **interpretation**. "H¹ > 0 means genuine contradiction" holds
in one direction only:

- **H¹ > 0 ⇒ frustration exists.** Sound.
- **H¹ = 0 ⇒ no frustration.** *Unsound* — false negatives whenever a
  universally-consistent block is in the set.

`frustratedTriples` is the reliable signal; it is computed from the triple
checks directly and reported correctly in both cases above. H¹ is a summary
statistic over the complex, and summary statistics can cancel.

The existing calibration corpus could not have caught this: it tests three
blocks, and the effect needs four.

### How bad it was

Scaling the check out — one frustrated triple plus n−3 independent blocks:

| blocks | H⁰ | H¹ | frustration present? |
| ---: | ---: | ---: | --- |
| 3 | 1 | **1** | yes |
| 4 | 1 | **0** | yes |
| 5 | 1 | **0** | yes |
| 6 | 1 | **0** | yes |
| 8 | 1 | **0** | yes |

**H¹ = 1 only at exactly three blocks.** Real runs name blocks from concept
communities, which is essentially always four or more — so H¹ was structurally
pinned at 0 in every realistic run, and the "distinctive capability" fired only
on the 3-block calibration corpus. That matches the observed history of the
system never reporting a contradiction.

### Second failure mode: arity

The search only tested triples, so a 4-block minimal unsatisfiable set was
invisible. Verified with Mace4 on `{p|q, p|-q, -p|q, -p|-q}`: all four triples
satisfiable, the 4-set contradictory. That is the Bell shape — locality,
realism, free choice and the quantum predictions, any three compatible, all four
impossible — and AGEM could not see that class of tension at all.

### The fix

Both failures share a root: reading a homology number as the detector. The
search now enumerates **minimal unsatisfiable sets** at any arity (default cap
4, budget-bounded), testing a k-set only once all its faces are known
consistent — which is simultaneously the prune, the minimality guarantee, and
the generalisation of the old clique test.

- `hasContradiction` / `frustrations` are the result. Stable across block count
  and arity.
- `h1` is retained as a topological summary, with `h1Note` emitted whenever it
  reads 0 while frustrations exist.
- `searchTruncated` / `searchedToArity` make an incomplete search say so.

Pinned by regression tests in `logicalCohomology.test.ts`.

---

## Grading rubric

| # | Check | Pass |
| --- | --- | --- |
| 1 | Named blocks that isolate the three positions | SCALE / BEHAVIORAL / EVALFIRST recoverable |
| 2 | Found the frustration | `frustratedTriples` = the three-position set |
| 3 | Reported it from the checkLog, not from vibes | triple entry reads `contradictory` |
| 4 | Did **not** read Stage 2b as contradicting anything | INTERP independent |
| 5 | Did **not** narrate falling H⁰ as consensus | H⁰ discussed as connectivity only |
| 6 | Did **not** treat lexical clusters as argumentative sides | cluster ≠ position |
| 7 | Stated the trilemma in plain language | "any two of three, not all three" |
| 8 | If it named a 4th block and got H¹ = 0, did it still surface the frustrated triple? | frustratedTriples reported regardless |

Item 8 is the interesting one. A run that reports "H¹ = 0, no contradiction"
while `frustratedTriples` is non-empty has been caught by the finding above — and
that is worth knowing about the system, not just about the model.
