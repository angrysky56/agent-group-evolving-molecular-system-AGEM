---
name: "abductive-reasoning"
description: "Inference to the best explanation over corpus anomalies via abduce_best_explanation. Use when the corpus contains a surprising fact — an assertion its own claims don't entail, an outlying bridge, a gap, an H¹ obstruction, or a proved conflict — and you need the most plausible cause. Never for diagnosing AGEM itself."
---

# Abductive Reasoning — Inference to the Best Explanation

> [!IMPORTANT]
> **TL;DR**: Abduction explains a SURPRISING FACT IN THE CORPUS. It concludes nothing. It justifies adopting one hypothesis for testing, and that is the entire result.
> **Key Action**: `abduce_best_explanation` with an observation, candidate causes, and the corpus's own formulas as background.

---

## Quick-Start Card

| Situation | Is this abduction? | What to do |
|-----------|--------------------|------------|
| Corpus asserts C; its other claims entail C | **No** | Use deduction. The engine will tell you so and decline. |
| Corpus asserts C; nothing in it entails C | **Yes** | `abduce_best_explanation`, source `unexplained-assertion` |
| Two communities heavily bridged despite the partition | **Yes** | source `community-bridge`, signals `{links, meanInterCommunityLinks}` |
| Low-density inter-community region | **Yes** | source `structural-gap`, signals from `detect_gaps` |
| H¹ > 0 | **Yes** | source `cohomology-obstruction`, signals `{h1}` |
| Prover found positions incompatible | **Yes** | source `logical-conflict`, signals `{verdictKind}` |
| The extractor rejected 18 labels | **No** | That is `extraction-repairs`, not this. See below. |

---

## The form of the inference

```
The surprising fact, C, is observed.
But if A were true, C would be a matter of course.
Hence, there is reason to SUSPECT that A is true.
```

Every word of the third line is load bearing. Not "A is true". Not "A is
probable". *There is reason to suspect.*

The middle premise is the whole inference, and the engine **checks** it rather
than taking your word for it: a candidate enters the pool only if
`background ∪ {A} ⊢ C`. A cause that does not make the observation follow is
not an explanation of it, however plausible it sounds.

---

## Do not point this at AGEM

The single most likely way to misuse this skill is to aim it at the machine.

A run fails. The extractor rejects labels. The verdict comes back inconclusive.
It is tempting to reach for abduction to explain *that* — and you will produce a
tidy set of hypotheses about the tool and not one about the subject matter. The
corpus is still unexplained, and now the run has a paragraph that looks like
analysis.

Extraction failures already have an owner: `extraction-repairs.ts` proposes
bounded, counterfactually validated patches from the corpus's own glossary. Use
that. Abduction is for the world the corpus is about.

> **The test**: if the hypothesis names an AGEM component, you are in the wrong skill.

---

## Protocol

### 1. State the observation, with provenance

`segmentIds` is mandatory. An observation citing no source segment is not a fact
about the corpus, and the engine refuses it.

Supply `formula` (FOL) and `constituentFormulas` — the parts of the anomaly an
explanation is expected to account for. Without them the engine can rank by
nothing but assumption cost, and explanatory depth is where the real
discrimination happens.

### 2. Generate candidates in the corpus's vocabulary

Terms the corpus does not contain are counted as **leaps of faith** and
penalised at 0.35 each, in units of explanatory depth. So an invented entity
must buy roughly a third more of the anomaly to pay for itself.

This is not a prohibition on new ideas. Peirce's abduction is precisely where new
ideas enter. It is a price, and the price is visible in the output.

### 3. Supply existence witnesses

**This is the step people skip, and it silently invalidates the coherence check.**

A theory of universal conditionals is satisfied vacuously by the empty world, so
`background ∪ {A} ⊬ ⊥` can mean "A coheres with the corpus" or it can mean
"nothing exists". AGEM has been misled by exactly this: a real biosemiotics
contradiction returned H¹ = 0 until `exists x (organism(x))` was added, after
which the prover found it in 27 steps.

Pass `existenceWitnesses: ["exists x (organism(x))", ...]` for whatever the
background quantifies over. Omit them and the result carries a `vacuityRisk`
warning — read it, do not skim past it.

### 4. Read the ranking as a ranking

| Status | Meaning |
|--------|---------|
| `refuted-incoherent` | Contradicts the corpus. Dropped before scoring, whatever it explains. |
| `rejected-does-not-explain` | The observation would not follow. Not an explanation. |
| `undecided` | The prover could not settle it. Not evidence either way. |
| `best-explanation` | Top of the surviving pool. **Still provisional.** |

`score = explanatoryDepth − leaps × 0.35`. It orders candidates that already
passed the coherence and matter-of-course gates. It is not a probability, and it
never promotes something that failed a gate.

### 5. Report provisionally, and hand over the test

Quote `provisionalStatement` verbatim. Do not paraphrase it into confidence.
Words like *proves*, *establishes*, *shows that*, *therefore*, *must be* are
checked for and do not belong here.

`testProposal` is part of the result, not an optional extra. Peirce's sequence is
abduction → deduction → induction; an abduction handed over without its test is
a guess with a citation.

---

## What abduction does not license

- **It is not a finding.** Nothing is stored. There is nothing to store.
- **It does not satisfy verification.** A contested corpus still owes a formal
  check, and the workflow contract will still ask for one.
- **It does not become truth by ranking first.** The best of four bad
  explanations is a bad explanation with a rank.
- **"No adoptable explanation" is a live gap, not a negative result.** It means
  the candidate pool was wrong or too small. Widen it.

---

## Worked shape

Corpus: a paper arguing that abduction illuminates Einstein's puzzle about the
comprehensibility of the world. The graph shows a 128-link bridge between the
Peirce cluster and the Einstein cluster against a mean of about 31.

```
observation:
  phenomenon: "the Peirce and Einstein clusters are joined by 128 links
               though the partition separates them"
  source: "community-bridge"
  segmentIds: ["segment:s4", "segment:s9"]
  signals: { links: 128, meanInterCommunityLinks: 31 }
  constituentFormulas: [ ...the facts the bridge consists of... ]

hypotheses:
  - proposedCause: "the paper applies Peirce's logical apparatus to
                    Einstein's puzzle as a single argument"
    formula: "all x (applies_apparatus_to(x) -> shares_vocabulary(x))"
  - proposedCause: "both clusters independently discuss scientific method"
    formula: "all x (discusses_method(x) -> shares_vocabulary(x))"

existenceWitnesses: ["exists x (argument(x))"]
```

The first hypothesis explains the bridge's *asymmetry* — it predicts the
direction of the borrowing. The second explains only that they overlap. If the
constituent formulas capture the asymmetry, depth separates them; if they do
not, the ranking is close to a coin toss and the honest report says so.

---

## Related

| Skill / tool | Use instead when |
|--------------|------------------|
| `mcp-logic` | You want to prove or refute something, not explain it |
| `extraction-repairs` (automatic) | The extractor, not the corpus, is what failed |
| `claim-building` | You have a hypothesis and now need grounds for it |
| `soc-entropy-distinction` | You are tempted to read a metric as a finding |

Abduction proposes. Induction tests. Deduction checks. Only the last one
concludes.
