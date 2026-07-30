# Plan: functionalize AGEM

Read against `docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md` (the founding
design) and five rounds of run logs.

## The core finding: AGEM is two systems wearing one pipeline

The founding document describes a **discovery engine**: graph expansion, SOC,
structural gaps, catalyst questions, surprising edges, weak exploratory links.

Nowhere in that document is there a logic layer. No FOL, no prover, no typed
claims, no MUS. `extract_and_verify_claims`, `logicalCohomology`,
Prover9/Mace4 — the entire **verification engine** — was bolted on later.

That drift was correct: verification is the only part producing checkable
results. But the two engines want opposite things.

| | Discovery wants | Verification wants |
|---|---|---|
| Vocabulary | rich, divergent, surprising | canonical, closed, minimal |
| Edges | weak long-range links (~12% surprising) | hard entailments only |
| Similar concepts | keep distinct, they're different angles | merge, they're one predicate |
| Success | novelty, gap-bridging | reproducibility, certificates |

Every collision of the last five rounds sits on this seam. Louvain communities
as logical blocks. Embedding cosine as alias evidence. Sheaf cohomology as
contradiction detector. **All three were discovery-side machinery pressed into
verification-side service, and all three failed for the same reason.**

**P0 — split the modes.** A run declares `mode: "discover" | "verify"`.
Discovery never emits logical verdicts. Verification never uses community
structure, embedding similarity, or sheaf geometry as evidence. They share the
corpus and the claim store; nothing else.

This is the change that stops the recurrence.

---

## Missed from the founding document — genuinely valuable

### M1 — `llm_map` was never built. Build it first.

The document's central primitive: distribute thousands of sub-tasks across
parallel workers so the coordinator never sees raw data. AGEM's extraction runs
**sequentially** — 233s, 511s, 505s in the logs.

Two payoffs, and the second is the important one:

1. Latency collapses with worker count.
2. **It makes extractor nondeterminism measurable and fixable.** Run each
   segment k=5 times in parallel, take the majority typed claim, and report the
   disagreement rate as a first-class quality metric.

Measured today: **60% of exactly-repeated claim texts received conflicting
kinds across runs.** `"theory holding dominance not newcomb adequate"` was typed
`entailment` in one run and `exclusion` in another — the same sentence, two
different logical forms. That single fact explains the role-cardinality
failures, the arity collisions, and the disjoint-predicate islands. They are all
downstream of an extractor that is not a function.

Self-consistency voting over `llm_map` is the standard fix and the document
already specifies the primitive.

### M2 — Hydrogen bonds (self-reflection) were never built

The document models self-reflection as later steps folding back to verify
earlier premises, with a claimed 81.72% reconnection rate. AGEM has no such
mechanism. This is exactly the "it isn't trying to solve the issues it finds"
complaint — and the founding design has a name and a shape for the fix.

The abductive repair loop already scoped is a narrow rediscovery of it.
Generalize: after any failed stage, fold back and attempt repair before
reporting.

### M3 — Betweenness centrality is specified and absent

The document treats it as the primary node-ranking metric — "conceptual
bottlenecks and power brokers." Every run reports community sizes and bridge
weights, never betweenness. `graphology-metrics` is already a dependency. This
names *which concepts* bridge, not just which communities, and it's cheap.

### M4 — Structural gaps have never fired

`detect_gaps` has returned "no structural gaps detected" on every run.
In the founding design, gap identification is the **generative engine** — it's
what dispatches exploration and produces catalyst questions. If it never fires,
the entire discovery loop is inert.

Determine which is true:
- the threshold is miscalibrated, or
- single-source corpora structurally cannot produce gaps (as the reports claim)

If the latter, gaps require multi-source ingestion, and the discovery mode has
never actually been exercised. Test with two corpora from unrelated fields
ingested into one graph.

### M5 — Surprising-edge ratio is unreported

The document's stated health marker: ~12% of new links connecting semantically
distant concepts. AGEM reports VNE, EE, CDP, regime — not this. It is the one
SOC metric that directly measures whether exploration is happening.

---

## The SOC thesis has never been testable

The document's central dynamical claim is a phase transition at **iteration
~400**. AGEM's longest run is **9 iterations**. Every report says "nascent" or
"stable, persistence 4."

We are two orders of magnitude short of the regime the framework is about. The
SOC layer isn't broken — it has never been exercised. Either run long enough to
test the claim, or stop reporting regime as though it means something at n=9.

---

## Where the founding document is wrong for this application

**§3.1, sheaf cohomology as obstruction detector.** The cited literature
(multi-agent coordination, multi-target tracking) uses sheaves where stalks are
genuine state spaces and restriction maps are **known and engineered** — robot
poses, sensor models, observation matrices.

AGEM substituted *embedding projections* for those maps. §14 of
`emergent-bonds-and-stateless-reconstruction.md` proved with real embeddings
that this destroys the content signal: three corpora (interpretive difference,
direct P/¬P, circular inconsistency) produced identical H⁰/H¹.

**The literature assumes you know the restriction maps. AGEM guessed them.**
That is the whole error, and it is not repairable by better embeddings —
measured today, `collapse_is_real`/`collapse_is_not_real` embed at cosine
0.948, higher than 10 of 12 pairs that genuinely should merge. Embeddings encode
distributional similarity; negation is not distributional. Sentence- or
paragraph-level embeddings change resolution, not objective, and would likely
score *higher* on shared context.

**Retire:** `ADMMSolver`, `CellularSheaf`, `CoboundaryOperator`,
`CohomologyAnalyzer`, `SheafLaplacian`, registry-sheaf construction.
**Keep:** concept subspaces (`getConceptVector`/`getConceptSubspace`) as
*descriptions* of what a subgraph is about. Useful summary, dead as geometry.

---

## The lossless promise is violated where it matters

The document specifies an Immutable Store recording "every interaction, internal
thought process, tool execution and environmental observation verbatim," never
truncated, queryable via `lcm_grep`.

**The run logs do not store the source segment text alongside each extracted
claim.** Only the derived role values survive. That is precisely the pairing
needed to (a) audit a claim against its source, (b) train any classifier on any
extraction decision, and (c) run the self-consistency voting in M1.

Measured consequence: an ELM trained on the available data scored **40.4%**
against a **36.8%** majority baseline, with a label-noise ceiling of 96%. The
task is unlearnable not because it's hard but because the input that determined
the label was discarded. See `docs/elm-integration-plan.md`.

---

## Ordered plan

| # | Task | Why now | Size |
|---|---|---|---|
| 1 | **Log source segment text with every claim** | Gates M1, all learning, and all auditing. Cheap. | XS |
| 2 | **Fix the unary-distribution bug** | Bell is currently encoded as four *unary* negations asserting QM is empirically inadequate, and returns "consistent" vacuously. Actively wrong output. See `elm-integration-plan.md` §Bell. | S |
| 3 | **N-ary joint-incompatibility relation in `schema/claims.tql`** | Six of six QM answer-key entries are irreducibly n-ary. Route via the `agem-typeql` skill — 3.x syntax. | M |
| 4 | **Split discover/verify modes (P0)** | Stops the recurring seam failures | M |
| 5 | **Build `llm_map`** | Founding primitive, never built; unlocks #6 | M |
| 6 | **Self-consistency voting, k=5, report disagreement rate** | Directly attacks the 60% conflict rate — the root cause of most downstream failures | S (after #5) |
| 7 | **Polarity guard → morphology → cosine-as-suggestion** | Replaces cosine-based aliasing, which measured 2 catastrophic false merges | S |
| 8 | **Retire the sheaf layer** | Three independent confirmations it carries no content; removes a whole class of misreading | S |
| 9 | **Betweenness centrality + surprising-edge ratio** | Specified in the founding doc, absent, cheap | S |
| 10 | **Diagnose why `detect_gaps` never fires** | The discovery engine's generative loop is currently inert | S |
| 11 | **Run 400+ iterations on a growing multi-source graph** | The SOC thesis has never been testable at n=9 | L |

Items 1–3 are strictly sequential and everything else depends on them. Items
4–8 can proceed in parallel once 1–3 land.

## Acceptance

Not "produces a verdict." The instrument is working when a run on a document
**neither Ty nor Claude wrote** returns:

- N claims formalized with provenance and a satisfiability certificate
- M unmappable, each with a reason and an abductive repair proposal
- extractor disagreement rate reported as a number
- no cohomology, no community-derived logical blocks, no cosine-derived aliases

Partial coverage with an honest boundary is the product. A full verdict is what
you get on corpora that happen to be fully formalizable, and that will always be
a subset.

## Standing rule

Everything above is measured or cited. Two of the last five rounds' headline
diagnoses — including one of mine — came from reading a summary instead of the
log. Check the log.
