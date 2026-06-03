# Logic-H¹ test corpus

Three sections, each a set of "blocks" for `evaluate_logical_consistency`.
Engineered to exercise the logic-based H¹ pipeline end-to-end and to be
distinguishable in the output. Propositions are deliberately **atomic** (single
predicate over a constant, `-` for negation, no nested operators) so the test
exercises the cohomology, not the Prover9 parser.

Read the `checkLog` in each result to confirm the relevant checks actually ran —
don't infer success from the H¹ number alone.

---

## Section A′ — propositional 3-wise inconsistency (expect H¹ = 1)

The anchor case: pairwise consistent, jointly impossible. Verified against real
Mace4 in docs §15.

- **Block P:** `p(a)`
- **Block PQ:** `p(a) -> q(a)`
- **Block NQ:** `-q(a)`

Every pair is satisfiable; all three force `q(a) & -q(a)` → no model.

Expected: **H⁰ = 1, H¹ = 1**, `frustratedTriples` = [[P, PQ, NQ]],
`internallyInconsistent` = [], `checkFailures` = []. The `checkLog` triple entry
for {P, PQ, NQ} must read `contradictory`.

---

## Section B — pairwise contradiction control (expect an edge failure, NOT H¹)

- **Block T:** `light_on(a)`
- **Block F:** `-light_on(a)`

These flatly negate each other; the pair is unsatisfiable, so the edge never
forms.

Expected: `consistentPairs` does NOT contain [T, F]; the two blocks are separate
components (**H⁰ = 2**), **H¹ = 0**. Pairwise contradiction is an edge-level fact,
not a higher-order obstruction. If this yields H¹ > 0 the pipeline is conflating
the two failure modes. The `checkLog` pair entry for {T, F} must read
`contradictory`.

---

## Section C — fully consistent control (blind men & elephant; expect H¹ = 0 for the right reason)

Three partial descriptions of one consistent object.

- **Block Trunk:** `haspart(elephant, trunk)`
- **Block Leg:** `haspart(elephant, leg)`
- **Block Ear:** `haspart(elephant, ear)`

Expected: all internal/pairwise/triple checks **consistent**, triangle filled,
**H⁰ = 1, H¹ = 0**, `frustratedTriples` = []. This disambiguates a true zero from
a "didn't check" zero — the `checkLog` triple entry for {Trunk, Leg, Ear} must
read `consistent`.

---

## Optional Section A — graph-coloring 3-wise case (only if a domain cap is expressible)

The "three people, two rooms" coloring obstruction is the most natural-language
form of a 3-wise inconsistency, but it only bites if the world is capped at two
values; Mace4 will otherwise find a 3-element model and report consistency.

- **Block A1:** `differ(alice, bob)`
- **Block A2:** `differ(bob, carol)`
- **Block A3:** `differ(alice, carol)`

with `differ` constrained to be irreflexive and the domain bounded to two
"rooms". If a clean two-room cap can be expressed in the formalization, this
should also give H¹ = 1. If not, rely on Section A′ — it needs no domain
assumption. Documented here as the "real domain" stretch goal, not the primary
test.

---

## How to run

Feed each section's blocks to `evaluate_logical_consistency` as
`blocks = [{name, propositions: [...]}, ...]`. Use the block names above so the
output is legible. For Section B, include both blocks in one call so the
component split shows in H⁰.

## What to bring back

1. Each section's full result (H⁰, H¹, `frustratedTriples`,
   `internallyInconsistent`, `consistentPairs`, `checkFailures`).
2. The `checkLog`, to confirm the triple/pair checks executed with the expected
   verdicts.
3. The run-log id (emitted as `[run-log: ...]`), so graph-ingest text and tool
   I/O can be inspected from `knowledge_base/runs/`.

Pass criteria: A′ → H¹=1 with the right frustrated triple; B → H¹=0 with T/F in
separate components; C → H¹=0 with a filled triangle. That confirms logic-based
H¹ works in the wild — the last open question from docs §15.
