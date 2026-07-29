# ToM corpus — predicate alias audit

Source of truth: the `logic_check_log` event in
`knowledge_base/runs/2026-07-28T00-10-03-376Z_mwcz1i.jsonl` (847 checks, 10
internal blocks). Symbols below were extracted from the ten `kind: "internal"`
entries, so they are what the prover actually saw — not what the corpus says.

**73 distinct predicate symbols across 10 blocks.** 9 are aliases (merged in
`tom-corpus-ontology.json`), ~20 are genuine distinctions that must never be
merged, and ~25 are not predicates at all.

---

## 1. Merged — `tom-corpus-ontology.json`

| Alias | Canonical | Blocks | Why |
|---|---|---|---|
| `mental_states` | `mental` | 1 | Same block, same concept, two symbols |
| `mental_state` | `mental` | all 10 | Injected witness symbol; must join the merge or the witness misses |
| `causes_anything_physical` | `causes_physical` | 1 | Same block, same relation |
| `broadcast` | `global_broadcast` | 4 | Same block; **this is the IIT/GWT vacuity mechanism** |
| `zombie_inference` | `zombie_argument` | 7 | Same block, same argument |
| `functional_availability` | `access_consciousness` | 0 | Block's own gloss of A-consciousness |
| `experiential_character` | `phenomenal_consciousness` | 0 | Block already bridges these with `<->`; merge makes it explicit |
| `rich_intentionality` | `intentionality` | 6 | Modifier, not a distinct kind |
| `maximally_irreducible_integrated_information` | `phi` | 4 | IIT's identity claim names one property twice |

Note that seven of the nine collide **inside a single block**. An
alias detector keyed on "similar symbols that never co-occur" would miss all
seven. Co-occurrence is not evidence of distinctness.

---

## 2. Never merge — negative test set

`docs/ToM-test/seed-test-theories-of-mind.md` ships an answer key of exactly the
ten pairs the corpus exists to keep apart. It doubles as the regression suite for
any embedding-driven alias pass: **every one of these has high lexical and
embedding similarity and merging any of them destroys the corpus.**

| Must stay distinct | Distinction |
|---|---|
| `hard_problem` / `easy_problems` | #1 |
| `phenomenal_consciousness` / `access_consciousness` | #2 |
| `phi` / `global_broadcast` | #3 |
| `higher_order_thought` / `higher_order_perception` | #4 |
| `prediction_error` / `precision` | #5 |
| `qualia` / `intentionality` | #6 |
| `mental_type` / `physical_type` | #7 |
| `epiphenomenalism` / `interactionist_dualism` | #8 |
| `explanatory_gap` / `zombie_argument` | #9 |
| `multiple_realizability` / `substrate_independence` | #10 |

`higher_order_state` is the genus over #4's two species — keep all three.

---

## 3. Not aliases — drop and re-extract

Roughly a third of the symbol table is not a predicate.

**Metaphors lifted as symbols:** `mind_as_passenger`, `mind_as_gripping_wheel`,
`volume_knob`.

**Whole sentences compressed into one opaque symbol:** `we_cant_explain_it`,
`it_isnt_physical`, `abstract_belief_that_2_2_4`,
`causes_hard_problem_converted_to_hard_easy_problem`,
`difference_driving_predictions_about_misrepresentation`,
`difference_driving_predictions_about_conceptual_requirements`,
`anything_that_plays_the_pain_role`, `pain_identical_to_one_physical_type`,
`biology_necessary_in_practice`, `modest_claim_about_kinds`,
`radically_different_substrates`, `mental_state_target_of_further_mental_state`,
`collapsing_distinction`, `fusion_summary`, `chalmers_distinction`,
`difficulty_ranking`, `same_experience`.

A sentential predicate is a fresh symbol per phrasing that can collide with
nothing. It guarantees satisfiability. No alias map repairs this — it needs an
extraction-side fix (the closed corpus glossary from P4 is the right lever).

---

## 4. Three structural defects the map cannot fix

### 4.1 Block 9 has no content

`community:9 opposite · place · interactionist` submitted 8 formulas. Seven are
the global witness prelude. The eighth is
`exists x (epiphenomenalism(x) & -interactionist_dualism(x))`.

That is the entire block. The distinction with the most genuine logical tension
in the corpus — epiphenomenalism says the mental causes nothing physical,
interactionism says it does — has a block containing zero conditionals. This is
why community 9 measured 10 nodes and internal weight 54: not because the
distinction is isolated, but because nothing was extracted from it.

Block 7 is nearly as thin: one conditional, one compound witness.

### 4.2 The existence witnesses are global, not per-block

Every one of the ten blocks carries the identical prelude:

```
exists x (causation(x))        exists x (mental_state(x))
exists x (consciousness(x))    exists x (multiple_realizability(x))
exists x (epiphenomenalism(x)) exists x (physical(x))
exists x (experience(x))
```

So the prediction-error block asserts that epiphenomenalism exists, and the
hard-problem block asserts that multiple realizability exists. P5 intended
witnesses derived from *each block's own subjects*; this is a fixed list stamped
onto all of them.

Two consequences. It pollutes every block with commitments it never made. And it
gives all ten blocks a shared signature, which independently flattens the
signature graph to one component — a second, more mundane reason the P3 prune
would have bought nothing here even had it been sound.

### 4.3 Attribution is not represented — and this is why the merge will mislead

Applying the map to block 1 yields:

```
all x (mental(x) -> -causes_physical(x))     # was mental_states / causes_anything_physical
all x (mental(x) -> causes_physical(x))
exists x (mental(x))                          # was the mental_state witness
```

**UNSAT.** The merge will produce the contradiction, and the run will finally
report `hasContradiction: true` on this corpus.

That verdict will be wrong. The corpus does not assert both positions — it
*describes* two positions and argues they must not be conflated. The extractor
flattened "epiphenomenalists hold P; interactionists hold ¬P" into "P and ¬P."
The map removes the symbol drift that was masking the flattening; it does not
remove the flattening.

So the merged run swaps one artifact for its mirror image: previously a false
"consistent" caused by aliasing, now a false "contradictory" caused by missing
attribution. Both are encoding defects, not findings about consciousness.

**The real fix is an attributed encoding.** Positions become arguments, not
assertions:

```
holds(epiphenomenalism, m) -> -causes_physical(m)
holds(interactionism, m)   -> causes_physical(m)
-exists t (holds(t, m) & t = epiphenomenalism & t = interactionism)
```

The contradiction then lives where it belongs — in "no single theory holds
both" — and the corpus comes out consistent *for the right reason*, which is the
answer the original analysis reached by luck.

---

## 5. Recommended sequence

1. Run with `tom-corpus-ontology.json` applied. Expect `hasContradiction: true`
   on `{community:1}` at arity 1 (internally inconsistent). **Treat this as a
   pipeline test, not a finding** — it confirms the merged symbols now collide.
2. Confirm IIT/GWT stays consistent after merging `broadcast` → `global_broadcast`.
   `consciousness_as_intrinsic_integration -> -global_broadcast` and
   `global_broadcast -> causes_consciousness` are competing, not contradictory.
   That one *should* remain SAT, now with a non-vacuous model.
3. Fix witnesses to derive per-block, then re-run. Blocks 2 and 8 should stop
   asserting the existence of epiphenomenalism.
4. Re-extract blocks 7 and 9 with the closed corpus glossary. Until then, distinctions
   #8 and #9 have not been tested by anything.
5. Only then attempt the attributed encoding, and treat that run as the first
   one whose verdict is about consciousness studies rather than about AGEM.
