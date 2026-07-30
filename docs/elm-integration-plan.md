# ELM integration plan — measured, not speculative

Two experiments run against real AGEM data. One proposed use **failed**. One
succeeded and contradicts current behaviour. Two bugs found in the MCP.

Scripts: `scripts/elm-canon-probe.py`, `../agem-elm-ceiling.py`

---

## Experiment 1 — claim-kind classifier: FAILED

Mined 187 typed claims from all run JSONLs (4 usable classes; `dissociation`
had 1 example). Trained `agem-claim-kind-v1` on the astermind MCP (130 train /
57 test), then replicated locally to get a score once MCP `predict` proved
unusable.

| | Accuracy |
|---|---|
| Majority-class baseline | 36.8% |
| ELM | **40.4%** |
| Label-noise ceiling | ~96% |

A 3.6-point lift over "always guess `exclusion`", well inside noise at n=57.
Confusion is total: true `exclusion` was predicted `identity-claim` 12 times
versus 6 correct.

**Crucially, label noise is not the excuse** — the ceiling is 96%. The task as
posed is unlearnable because the labels are not a function of the input.

### Why, and the fix

I trained on **role values**, because that is all the logs store. Role values
are the *output* of the typing decision with the syntax that determined it
already discarded. `"fdt pays"` carries no signal about whether the extractor
called it `causal-claim` or `identity-claim` — that depended on the verb
structure of the source sentence, which was thrown away.

> **The run logs do not store the source segment text alongside each claim.**
> Without that pairing, no classifier for any extraction decision can ever be
> trained. This is a cheap logging change and it gates all ML work in AGEM.

Do not conclude claim kind is unlearnable. Conclude it is unlearnable *from the
data currently retained*.

---

## Experiment 2 — predicate canonicalization: cosine similarity is unsafe

24 real pairs from run logs and answer keys: 12 that must merge (inflectional
variants), 12 that must not (lexically similar, semantically distinct).
Embedded with `embeddinggemma:latest`, the same model AGEM uses.

| Method | Accuracy | Dangerous errors |
|---|---|---|
| Best single cosine threshold (0.77) | 87.5% | **2 catastrophic** |
| Deterministic morphology | 75.0% | **0** |

The overlap is fatal: MERGE spans 0.730–0.972, KEEP spans 0.493–0.948.

The two highest-scoring false merges are the worst possible ones:

| Pair | Cosine | Consequence if merged |
|---|---|---|
| `collapse_is_real` / `collapse_is_not_real` | **0.948** | destroys the QM corpus |
| `selection_for` / `selection_of` | **0.939** | destroys quantum-mind-genesis |

Both score higher than 10 of the 12 pairs that *should* merge. **A cosine
threshold cannot be set that keeps them apart.** This is §14's finding
reappearing at the predicate level — negation is nearly invisible to embeddings.

Morphology's 25% error rate is entirely *missed* merges (`perception_like` /
`perception`, `mental_states` / `mental`, `broadcast` / `global_broadcast`,
`zombie_inference` / `zombie_argument`). Those fail safe: the symbols stay
separate and get flagged for audit.

### Required change

AGEM currently proposes aliases by embedding cosine (0.876, 0.895, 0.958 in the
logs). Replace with a three-stage pipeline:

1. **Polarity guard (deterministic, runs first).** Reject any pair whose members
   differ in polarity: `not_`/`non_`/`un_`/`in_` prefix asymmetry, `_for`/`_of`
   suffix asymmetry, or one containing the other plus a negation token. Kills
   both catastrophic cases before similarity is ever computed.
2. **Morphology (deterministic, auto-apply).** Stem, drop `being`/`that`/`the`,
   normalise `-acy`/`-ate`, `-ing`, `-ness`, plurals, sort tokens. Zero false
   merges measured. Safe to apply without audit.
3. **Cosine (suggestion only, never auto-applied).** Rank the residual for human
   audit, and display the polarity flag alongside the score so a reviewer sees
   *why* a high score may be misleading.

---

## Where ELM belongs — and why not yet

The honest answer from the measurements: **nowhere, until the logging gap is
closed.**

The one place a classifier is genuinely needed is the residual merge/keep
decision after stages 1–2 — a tabular problem over
`[morph_match, cosine, polarity_conflict, shared_stems, len_ratio,
same_block_cooccurrence]`. That is squarely ELM-shaped: small data, tabular
features, millisecond CPU training, no GPU (relevant given the 3060's cooling).

But there are **6 residual examples**. Six. Training anything on that is
theatre. And the astermind MCP is text-only (`{text, label}`), so tabular
features would have to be smuggled through as strings.

Sequence:

1. **Log source segment text with every claim** (gates everything)
2. **Log every alias suggestion and its accept/refuse outcome** — that is the
   merge/keep training set, and it accumulates for free on every run
3. Ship the polarity guard + morphology normaliser (deterministic, no ML)
4. When the merge/keep set reaches ~200 labelled pairs, revisit ELM
5. **Kill criterion:** an ELM must beat *morphology's zero false merges*, not
   just its accuracy. A model at 95% accuracy that merges `selection_for` with
   `selection_of` once is a regression, not an improvement.

---

## MCP bugs found

**1. `predict` has a hard SurrealDB dependency even with logging disabled.**
`train_classifier` succeeds in-memory; every `predict` call fails. Inference
should never require the database. This makes the server unusable for its
primary purpose without persistence configured.

**2. Port collision.** Default `SURREALDB_URL` is `ws://127.0.0.1:8000/rpc`, and
on this machine port 8000 is held by an Express app returning
`Cannot GET /version` HTML. The version check then fails with the HTML body
interpolated into the error string. Two fixes: move SurrealDB off 8000, and
validate that the endpoint is SurrealDB before parsing a version from it.

**3. Documentation is accurate and unusually honest** — the README's warning
that `generate_embedding` returns task-specific hidden features and "should not
be described as a semantic embedding" is correct and saved a wrong turn. For
canonicalization, use `embeddinggemma` vectors placed *into*
`store_embeddings`/`search_similar`, never `generate_embedding`.

---

## Unrelated but more urgent: the Bell encoding is wrong

Found in `2026-07-29T18-38-25-991Z_ajovtf.jsonl` while mining:

```
all x (bell_theorem(x) -> -locality(x))
all x (bell_theorem(x) -> -hidden_variables(x))
all x (bell_theorem(x) -> -measurement_independence(x))
all x (bell_theorem(x) -> -empirical_adequacy(x))
empirical_adequacy(entity_bell_theorem)          <- contradicts the line above
verdict: "consistent"
```

The n-ary no-go was **distributed into four unary negations**, asserting each
conjunct is individually false — including that quantum mechanics is empirically
inadequate. Bell's theorem says no position holds *all four*. Same pattern for
Kochen–Specker and PBR.

Also present: `all x (hidden_variables(x) -> noncontextuality(x))` — inverted.
Kochen–Specker entails hidden variables must be *contextual*.

And it returned **consistent**, satisfiable only by making
`bell_theorem(entity_bell_theorem)` false — vacuous satisfaction of the kind the
existence-witness check was built to catch, in a form it does not cover.

The blocked-pairwise-split fix does not catch the unary-distribution variant.
This outranks all ELM work.
