# Answer key — reverse mathematics

**This corpus is a calibration instrument, not a discovery target.** Fifty years
of hand-verified results. Its job is to fail loudly when the pipeline is broken.

Inverted scoring: on the other three corpora a surplus MUS is a candidate
finding. Here a surplus MUS is almost certainly an encoding bug.

## The hierarchy

```
RCA₀  ⊊  WKL₀  ⊊  ACA₀  ⊊  ATR₀  ⊊  Π¹₁-CA₀
              ╲
               ╲  incomparable
                ╲
                RT²₂     (strictly above RCA₀, strictly below ACA₀)
```

RT²₂ is the reason the picture is a **partial order**, not a chain.

## What must be reproduced

| ID | Content | Source |
|---|---|---|
| `rt22_not_aca0` | RT²₂ does not imply ACA₀ | Seetapun & Slaman 1995 |
| `rt22_not_wkl0` | RT²₂ does not imply WKL₀ | Liu 2012, *JSL* |
| `ramsey_uniform_strength` | "Ramsey's theorem" is not one statement with one strength — RT^n_k ≡ ACA₀ for n ≥ 3, RT²₂ is not | Cholak–Jockusch–Slaman 2001 + Liu |
| `hierarchy_strictness` | WKL₀ ≢ ACA₀ | Simpson, *SOSOA* |

`ramsey_uniform_strength` is **the** test. If the extractor aliases `rt22` to
`rt_n_k` — and an embedding pass will absolutely propose that merge, the strings
are nearly identical — this MUS vanishes and the run passes while being wrong.
That is the exact shape of the ToM alias failure, transplanted to a domain where
we can prove it happened. `ontology.json` carries an explicit `_DO_NOT_MERGE`
block for a human to read.

## The design trap: partial orders

The Big Five are linearly ordered. RT²₂ is not in the chain. If the FOL encoding
assumes implication is total — that any two subsystems are comparable — then
`mustNotFind.rt22_position_is_coherent` will fire, and **that is the pipeline's
fault, not the corpus's.**

Settle this before running: `implies`, `equivalent_to` and `incomparable_with`
must be three distinct relations, and the encoding must not derive comparability
from their absence.

## Scoring

**Pass** = 4 `mustFind` reproduced, 3 `mustNotFind` clean, **zero surplus MUSes**.

Surplus here means the encoding has invented an impossibility in a domain where
none exists. Chase it down before touching the QM corpus, because the same bug
will produce a plausible-looking "discovery" there that nobody can refute.

## Why bother, if there's nothing to discover

Two reasons.

One: it is the only corpus in the set where a wrong answer is *provably* wrong.
The others can absorb a bad verdict as "contested". This one can't.

Two: reverse mathematics is *structurally* the same problem AGEM solves — "which
minimal set of commitments does this claim require" is MUS extraction with the
sign flipped. If the engine works at all, this is the domain where the fit is
tightest. A clean pass here is the strongest evidence available that the QM
results mean anything.

## Sources

- Simpson, *Subsystems of Second Order Arithmetic*, 2nd ed. (CUP 2009)
- Seetapun & Slaman, "On the strength of Ramsey's theorem", *NDJFL* 36 (1995)
- Cholak, Jockusch & Slaman, "On the strength of Ramsey's theorem for pairs", *JSL* 66 (2001)
- Liu, "RT²₂ does not imply WKL₀", *JSL* 77 (2012)
- Hirschfeldt, *Slicing the Truth* (2014) — the readable survey of the RT²₂ story
