---
name: "claim-building"
description: "Build evidential (defeasible) claims anchored to checkable grounds via build_defensible_claim. Use when a corpus supports a recommendation without supporting a theorem — the third path alongside graph discovery and formal verification. Requires a real disconfirming search and shrinks scope rather than hedging wording."
---

# Claim Building — Anchoring Claims to Checkable Reality

> [!IMPORTANT]
> **TL;DR**: An evidential claim is DEFEASIBLE, not a weak proof. It never satisfies formal verification. Its two teeth are a mandatory disconfirming search and scope calibration.
> **Key Action**: Run the disconfirming search FIRST, then `build_defensible_claim`. The tool refuses to run without the receipt.

---

## Quick-Start Card

| Situation | Path |
|-----------|------|
| Corpus positions can be formalised and checked | `extract_and_verify_claims` — use the prover |
| Corpus argues for a thesis, reading, or interpretation | **This skill** |
| Corpus supports a practical recommendation | **This skill** |
| You have a hypothesis and need grounds | `abductive-reasoning` first, then this |
| You have an opinion and want it to look grounded | Neither. That is what the filter removes. |

> [!WARNING]
> **"Recommendation" does not mean "action".** The field is named that way
> because the source specification came from decision-support, and a live run on
> a philosophy essay declined this tool with *"the corpus does not ground a
> specific decision-recommendation"* — reading the parameter name as the scope.
>
> A thesis is a claim. "Abduction dissolves Einstein's puzzle" is exactly the
> kind of point that has checkable grounds (what the texts say, where) and no
> proof. Philosophical, historical and interpretive corpora are the **primary**
> use of this skill, not an edge case. Pass `claim` instead of `recommendation`
> if the wording helps.

---

## Why this exists

AGEM used to have exactly two ways to say something about a corpus: derive typed
claims and ask a prover, or say nothing. Most of what a corpus supports is not a
theorem. The result was runs that ingested a paper, mapped its structure, and
then reported only that the formal path had aborted — with everything the corpus
actually showed left on the floor.

This is the third path. It is not a fallback for when the prover fails; it is a
different instrument, and it can be the right one even on a corpus the prover
handles fine.

---

## The two mechanisms that give it teeth

### 1. The disconfirming search is mandatory

Confirmation bias is not corrected downstream by weighting. It is prevented at
the gather step or not at all. So `build_defensible_claim` requires a receipt:

```
disconfirmingSearch: {
  query: "what evidence would show this recommendation is false?",
  searchedIn: ["segment:s3", "segment:s7", "search_context:optimality"],
  found: 0
}
```

`found: 0` is a legitimate result — and the engine then names *search coverage
itself* as the strongest objection, which is honest. Not looking is not a
result, and the tool throws.

**On a single-document corpus, search the text against itself.** A live run
stalled here: `search_context` returned the same whole essay for all three
queries, because a one-cycle ingest leaves one LCM entry. The model concluded
there were "no distinct disconfirming sources" and declined.

That was the wrong inference. A good argument disconfirms itself in writing —
in its concessions, caveats, hedges, and the objections it raises to answer. The
Peirce/Einstein essay ends *"The miracle is relocated, not removed: what remains
unexplained is why the process converges at all."* That sentence is
disconfirming evidence against the thesis that abduction dissolves the puzzle.
Cite it as a `segment:` locator with `bearing: "contradicts"`; the segment ids
are the `searchedIn`.

If the text makes no concession anywhere, that is itself a finding about the
text, and `found: 0` with the segments you read is the honest receipt.

### 2. Scope shrinks; wording does not hedge

> A wild claim with a qualifier is still a wild claim.

So the remedy is never softer language. The scope walks down a ladder until the
claim fits inside what the grounds carry:

`universal → general → typical → some → at-least-one`

and only when scope is exhausted does certainty follow:

`is → indicates → appears → is-consistent-with`

Every step is reported in `calibration.steps` with the reason. If the claim
still does not fit at the bottom of both ladders, the result is
`cannotStand: true` and `INSUFFICIENT GROUNDS` — a report about the evidence,
not a claim.

---

## What gets dropped

| Verdict | Fate | Why |
|---------|------|-----|
| **Opinion** | Dropped | Expresses a preference about what should be, not a fact about what is |
| **Assertion** | Dropped | No backing stated; a skeptic has nothing to check |
| **Anecdote** | Kept, flagged | One instance. Admissible — but cannot carry a claim alone |
| **Checkable** | Kept | Has a resolvable locator |

Everything dropped is returned in `dropped` with its reason. A filter whose
removals are invisible is indistinguishable from one that discarded inconvenient
material.

**Supply the structured fields.** `sourceRef`, `instanceCount`, `isNormative`,
`reliabilityTier` make classification a fact about the statement's structure.
Omit them and a lexical fallback fires — it works, but the output records
`basis: "lexical"` so a reader knows a guess was involved.

---

## The four-question filter

Each piece of evidence is weighed **against this specific decision**. Strength is
a spectrum, not a category; the same study is strong for one question and weak
for its neighbour, so a weight computed elsewhere is not reusable.

| Question | What raises it |
|----------|----------------|
| **Relevant?** | Similarity to the decision question (cosine when an embedder is available, token overlap otherwise — the output says which) |
| **Reliable?** | `reliabilityTier`: primary 1.0, peer-reviewed 0.9, secondary 0.6, self-reported 0.35, anonymous 0.15. Undeclared scores 0.5 — the midpoint, not a benefit of the doubt |
| **Covers?** | Fraction of `subQuestions` it addresses. Break the decision up, or this cannot be measured |
| **Verifiable?** | A locator a skeptic can open — `segment:s12`, a DOI, a URL. A named-but-unfindable source scores 0.4 |

Total is 0–4. It is an ordering device, not a probability.

---

## Contradicting evidence is never filtered out

Pass counter-evidence in with `bearing: "contradicts"`. It stays in the result,
it reduces grounds strength, and the strongest item becomes the objection the
`reasoning` field must answer.

The bridge from grounds to recommendation has to do heavy lifting: it states the
strongest objection in its own terms *first*, then explains what the claim can
still carry against it. A reasoning field that restates the grounds in a
confident tone has not done its job.

---

## Boundaries — the part that matters most

- **It is stored as `method: "evidential"`.** Not `derived-from-claims`. Not
  `hand-authored`.
- **It never satisfies `verify` or `derive`.** On a contested corpus the
  workflow contract will still demand a formal check, and it should.
- **It cannot carry verification receipts.** The store rejects an evidential
  finding that arrives with `semanticsValidated` or a `semanticVerdictKind`.
- **It raises no conflict against a logical verdict.** They are incommensurable:
  a proof that a corpus is consistent and a defeasible claim about what its
  evidence favours can both be right. Flagging them as rival would invite
  retiring one on the strength of the other.
- **The statement says all of this out loud.** Quote it verbatim; do not
  paraphrase `EVIDENTIAL (defeasible)` into something that sounds settled.

---

## Protocol

1. **Name the decision.** `{question, subQuestions}`. Coverage is unmeasurable
   without the sub-questions, and it will score 0.5 by default.
2. **Gather supporting material** from the corpus, with segment ids.
3. **Ask what would prove you wrong**, and search for it. Record the query and
   where you looked.
4. **Gather the disconfirming material too**, marked `bearing: "contradicts"`.
5. **Call `build_defensible_claim`** with everything, including what you expect
   to be filtered — the drops are part of the audit trail.
6. **Report the calibrated statement**, the strongest objection, and what was
   dropped. If `cannotStand`, say the evidence does not carry it. That is a
   result.

---

## Related

| Skill / tool | Use when |
|--------------|----------|
| `extract_and_verify_claims` | The corpus can be formalised — prefer the prover |
| `abductive-reasoning` | You need a hypothesis before you can have a claim |
| `framework-humility` | The claim is about grief, loss, or anything the framework should stay small in front of |
| `mcp-logic` | You want to know whether something follows, not whether it is supported |

Evidence anchors a claim. It does not prove one. Keep the two words apart and
this instrument stays honest.
