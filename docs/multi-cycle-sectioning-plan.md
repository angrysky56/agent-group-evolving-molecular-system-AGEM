# Plan: multi-cycle sectioned ingestion, and why the sheaf layer is dead code

**Implementation status (2026-07-28):** P1-P5 are implemented or validated. The claim and
finding schemas pass both the driver verifier and rejection contract against an
isolated TypeDB CE 3.12.1 database. No live deployment database was mutated.

**Target files**
`src/orchestrator/ComposeRootModule.ts` (~L813 `buildSheafFromRegistry`, ~L1070 registry construction)
`src/lcm/SubgraphRegistry.ts` (complete and now production-routed)
`interface/backend/src/services/agem-bridge.ts` (~L427 `runCycle`)
`interface/backend/src/routes/chat.ts` (`run_agem_cycle` tool contract)

## The finding

`grep -rn 'registry.create' --exclude='*.test.ts'` returns **nothing** outside
the `SubgraphRegistry` constructor.

Before this implementation, production never created a second subgraph. Every cycle wrote into the
auto-created `default`. `buildSheafFromRegistry()` therefore builds a sheaf with
**one vertex and zero edges**, on every run, forever.

Consequences, all three observed in the run logs:

- `H¹ = 0` is not a finding. With no edges there is no cycle space. It is
  arithmetically forced.
- `H⁰ = 3` is a stalk dimension — the rank of one vertex's concept subspace. It
  has never once been a fragmentation count.
- `CoboundaryOperator`, `SheafLaplacian`, `CohomologyAnalyzer` and the
  concept-subspace adaptive-rank ladder were unreachable in production.
  `ADMMSolver` is a separate wiring gap: no production caller supplies its local
  section vectors, so named subgraphs alone cannot honestly activate it.

That is the entire explanation for three consecutive runs reporting cohomology
as an artifact or as not-computed. The P6 fix (return `not-computed` instead of
misleading numbers) was correct and honest, and it papered over this.

## Two axes, and they are not the same axis

Ty's diagnosis — "we get 1 cycle when it should be broken into concepts with
multiple cycles" — is right about the symptom and needs splitting, because more
cycles alone fixes only half of it.

**Axis A — iterations.** SOC metrics (VNE, EE, CDP, regime, phase transition)
are functions of the iteration counter and edge deltas. More cycles moves the
run off `Nascent` and makes phase-transition detection possible at all. Fixed by
running N cycles.

**Axis B — subgraphs.** The sheaf's vertex set *is* the subgraph list. More
cycles into `default` gives N iterations on **one vertex**: SOC advances, the
sheaf does not move. Fixed only by routing each section into its own *named*
subgraph.

Running ten cycles on ten sections of one document, all landing in `default`,
would leave H⁰/H¹ exactly as dead as they are now. **Axis B is the one that
unlocks the dead code, and it is not what "run more cycles" gets you.**

---

## P1 — Route cycles into named subgraphs

The `run_agem_cycle` tool contract now has an optional `subgraph` argument:

```ts
{ prompt: string, subgraph?: string }   // default: "default", preserving current behaviour
```

In `runCycle`, before ingestion, the orchestrator resolves and activates the
name. The first explicit name claims the empty backwards-compatible `default`
slot, preventing a content-free phantom vertex:

```ts
const target = args.subgraph ?? "default";
orch.activateOrCreateSubgraph(target);
```

`activateSubgraph` already exists and is already called on restore
(`agem-bridge.ts` ~L968), so the plumbing is present — it has simply never been
driven with more than one subgraph.

**Acceptance:** two cycles with distinct `subgraph` values produce
`subgraphRegistry.list().length === 2`, and `buildSheafFromRegistry()` returns a
sheaf with 2 vertices and — if their concept centroids clear the similarity
threshold — 1 edge. The deterministic integration test pins routing and edge
construction; provider-specific threshold calibration remains an opt-in live
probe because it requires the configured external embedding service.

## P2 — Section-aware corpus ingestion

The tool `run_agem_cycles_sectioned` accepts:

```ts
{ text: string, sectionPattern?: string, maxSections?: number }
```

Split on `sectionPattern` (default: markdown `^## ` headings), then run one cycle
per section with `subgraph` set to a slug of the heading. Return an array of
per-section cycle results plus one combined post-run analysis.

Ordering matters: sheaf edges are only computed after ≥2 vertices exist, so
cohomology should be analysed **after the last section**, not per-section. Emit
per-section SOC but corpus-level cohomology.

Guard rails:

- `maxSections` default 24. A corpus with 200 headings should error, not run for
  an hour.
- Preserve authored headings. Only genuinely tiny fragments (under 32 tokens)
  merge forward. The earlier ~200-token proposal was wrong: it collapsed the
  9-section decision corpus to 7, and merging strings still creates one entry.
- Write paragraph-level LCM entries within each section cycle. This is what
  prevents every section from degrading to the N=1 weak-level stalk while
  keeping the required one-SOC-iteration-per-section contract.
- Fail loudly if the split yields 1 section: that is the current broken
  behaviour and should be reported, not silently accepted.

## P3 — Make the degenerate case impossible to misread

The orchestrator refuses to hand a vertex- or edge-degenerate registry sheaf to
the analyzer. The public snapshot returns:

```ts
{ status: "not-computed",
  notComputed: "sheaf has 1 vertex (single subgraph) — cohomology requires >= 2",
  remedy: "ingest with run_agem_cycles_sectioned, or pass distinct `subgraph` values" }
```

The prior fix already suppressed the misleading numbers. This adds the *remedy*, so
the next agent to hit it knows the action rather than treating it as a fact
about the corpus. Every run so far has treated it as a fact about the corpus.

## P4 — Tool-description fix (cheapest, do it first)

The reason the model runs one cycle is that `run_agem_cycle`'s description
invites exactly that. It should say:

> Ingests one conceptual section into one named subgraph. **A corpus with
> multiple distinct topics should be ingested as multiple cycles with distinct
> `subgraph` values** — sheaf cohomology requires at least two subgraphs and is
> not computable from a single cycle. For a structured document, prefer
> `run_agem_cycles_sectioned`.

Model behaviour is downstream of tool descriptions. This is a one-line change
that would have prevented all three single-cycle runs.

---

## P5 — Claim-store schema failure (separate blocker)

The decision-theory run fell back to hand-authored
`evaluate_logical_consistency` because "the claim store had a schema issue".

**Historical hypothesis, not a current live-db observation:** the previous handoff recorded that *"the live
TypeDB contract probe was not run because it writes to a live database; schema
changes were covered statically and through application tests."* So the code
expects the new schema and the live database still has the old one. Nothing in
the test suite could catch this by construction.

**Completed safely:** `scripts/verify-claim-store.ts` and
`schema/contract-probe.sh` pass against an isolated TypeDB CE 3.12.1 database.
The probe now exits non-zero on an expectation mismatch. Deployment still needs
to initialize or migrate its own live database; this implementation pass did
not mutate one that was not running.

**This gates everything.** Your own `run-memory` skill records that
hand-authored encodings produced three different answers across runs on one
corpus. Until the typed path works, every verdict — including a future QM result
— is non-reproducible, and the answer keys cannot do their job.

## Ordering

| Step | Effort | Why this order |
|---|---|---|
| P5 claim-store migration | S | Gates verdict reproducibility |
| P4 tool description | XS | One line; prevents recurrence immediately |
| P1 named-subgraph routing | S | Unlocks the sheaf layer |
| P3 degenerate-case remedy | XS | Stops the misreading recurring |
| P2 sectioned ingestion | M | The ergonomic win, once P1 works |
