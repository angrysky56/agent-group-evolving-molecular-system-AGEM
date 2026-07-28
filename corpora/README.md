# corpora/ — exploration corpora with answer keys

Diagnostic fixtures live in `docs/`. These are different: **real fields with real
open questions**, chosen because AGEM's actual capability — enumerating which
combinations of stances in a discourse are jointly impossible — has never been
applied to them systematically.

## The contract: answer key first

Every corpus ships with `expected-mus.json`: impossibilities that are *already
known*, from published theorems. A novel MUS from a corpus whose known MUSes were
not reproduced is not a finding. It is an encoding artifact until proven otherwise.

This is the whole discipline. The engine has produced two confidently wrong
verdicts on the ToM corpus so far — a false "consistent" from alias drift, then a
false "contradictory" from attribution loss. Both looked like findings. The only
defence is a domain where someone else already did the work and we can check.

## Layout

```
<corpus>/
  corpus.md          prose the extractor ingests — positions stated and attributed
  answer-key.md      the known impossibilities, with citations, in human terms
  ontology.json      predicate alias map, flat {alias: canonical}
  expected-mus.json  machine-checkable regression: MUSes AGEM must find
```

`expected-mus.json` schema:

```json
{
  "corpus": "<id>",
  "mustFind":    [ { "id", "arity", "stances": [], "source", "note" } ],
  "mustNotFind": [ { "id", "stances": [], "why" } ],
  "openQuestions":[ { "id", "stances": [], "status" } ]
}
```

`mustNotFind` matters as much as `mustFind`. A pipeline that calls everything
contradictory scores perfectly on `mustFind` alone.

## The corpora

| Corpus | Why it's here | Ground truth |
|---|---|---|
| `qm-interpretations` | ~15 interpretations, 9 stance axes, joint-coherence map never enumerated | Bell, Kochen–Specker, PBR, Frauchiger–Renner, Leggett–Garg, Brukner |
| `decision-theory` | CDT/EDT/FDT over 8 problems; tiny axis set, vicious tensions | Newcomb/smoking-lesion tension, Death in Damascus instability, Egan's counterexamples |
| `reverse-math` | "which axioms does this theorem need" *is* MUS enumeration | Big Five equivalences; RT²₂ as the known anomaly |
| `quantum-mind-genesis` | A three-field synthesis, formalized so it can fail honestly | Tegmark's decoherence bound vs Orch-OR; cross-links to ToM substrate independence |

## Ingestion: one cycle per section, into a NAMED subgraph

Every `corpus.md` carries an ingestion header naming its `sectionPattern` and
expected section count. Follow it.

A single-cycle run of any of these corpora is a broken run. The sheaf's vertex set
*is* the subgraph list, so one cycle means one vertex, zero edges, and cohomology
that is arithmetically forced to be trivial regardless of content. Three
consecutive runs reported this as a fact about the corpus. It is a fact about the
ingestion.

Passing `subgraph` per cycle is what unlocks it — not simply running more cycles,
since N cycles into `default` still leaves one vertex. See
`docs/multi-cycle-sectioning-plan.md`.

`run_agem_cycles_sectioned` also writes paragraph-level LCM entries inside each
section subgraph. That distinction matters: merging two short sections into one
string still creates one LCM entry and therefore does not cure a rank-1 stalk.
Authored headings are preserved unless a fragment is genuinely tiny (under the
32-token guard); per-section SOC remains one iteration per heading.

## Cross-corpus ambition

Once two or more are mapped, the question no literature review can ask: **do the
same MUS shapes recur across unrelated fields?** Is ψ-ontic/ψ-epistemic the same
choice-structure as phenomenal/access? The persistent claim graph is the
infrastructure for detecting that two fields share a forbidden region.

Do not chase this before the individual answer keys pass.
