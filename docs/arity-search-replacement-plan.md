# Plan: replace the arity ladder in the consistency search

**Target file:** `interface/backend/src/services/logicalCohomology.ts`
**Callers:** `interface/backend/src/routes/chat.ts` (~L1409), `services/claim-blocks.ts`
**Config:** `interface/backend/src/config.ts` (`LOGIC_MAX_ARITY`, `LOGIC_MAX_CHECKS`)

## Context

`computeLogicalCohomology` builds the consistency complex bottom-up: level `k`
tests every `k`-subset whose `(k-1)`-faces are all known consistent, stopping at
`effectiveMaxArity`. Face-pruning gives MUS minimality by construction. On a
10-block corpus this ran 847 checks and still reported
`searchTruncated: true` at arity 6, leaving arities 7–10 unresolved.

The cap is not the real problem, and raising it is not the fix. Three separate
issues are stacked here; they must be fixed in order, because each one makes the
next one's result meaningful.

## Do NOT

- **Do not implement Hidden Variable Encoding** (`wflp2020_final.pdf`). Its
  "arity" is variables-per-constraint in a finite-domain CSP; ours is
  blocks-per-subset in an FOL satisfiability lattice. HVE also blows the dual
  variable's domain up to `|D|^k`, requires finite domains, and has no notion of
  testing a subset of constraints. It does not apply.
- **Do not just raise `LOGIC_MAX_ARITY` to 10.** That buys a more expensive
  confirmation of a verdict that is currently vacuous for other reasons (P3, P4).
- **Do not delete the lattice search.** It is the only thing that enumerates
  *all* MUSes. It becomes the fallback path, not the default path.

---

## P0 — Diagnose why auto-exhaust did not fire (no code change yet)

There is already an auto-exhaust rule in `computeLogicalCohomology`:

```ts
const arityWasExplicit = options.maxArity !== undefined;
const fullLatticeUpperBound = 2 ** vertices.length - vertices.length - 1;
const effectiveMaxArity =
  !arityWasExplicit && fullLatticeUpperBound > 0 &&
  fullLatticeUpperBound <= opts.maxChecks
    ? vertices.length
    : opts.maxArity;
```

With `vertices.length = 10` this is `1013 <= 50000` → `effectiveMaxArity = 10`.
**The run should not have truncated at all.** So exactly one of these is true:

1. The model passed `maxArity: 6` in the tool args. `chat.ts` L1409-1411 sets
   `cohomologyOpts.maxArity` only when supplied — supplying it flips
   `arityWasExplicit` and disables auto-exhaust *by design*.
2. The `extract_and_verify_claims` path (as opposed to
   `evaluate_logical_consistency`) threads `config.LOGIC_MAX_ARITY` through as an
   explicit option. If so, the config default *permanently* disables
   auto-exhaust and every extraction run truncates. This is the likely culprit
   and is a one-line fix.
3. `vertices.length < 10` — some blocks were dropped as internally inconsistent
   or by `LOGIC_MAX_BLOCKS`, changing the bound.

**Task:** read the run's `logic_check_log` event from the run JSONL plus the
recorded tool args, and determine which. Report the answer before writing code.
If it is (2), fix it: config defaults must reach `DEFAULT_COHOMOLOGY_OPTIONS`,
never `options.maxArity`. Add a regression test asserting that a 10-block
extraction run with default config reports `searchTruncated: false`.

**Acceptance:** the consciousness-corpus run reproduces with
`searchedToArity: 10`, or the reason it cannot is documented.

---

## P1 — Top-down first: one check settles the whole lattice

**Principle.** Satisfiability is downward-monotone: a model of `Γ` is a model of
every `Γ' ⊆ Γ`. So if the conjunction of all blocks is SAT, *every one of the
`2^n` subsets is SAT* and the entire ladder is redundant. One check replaces 847.

The ladder is only informative in the UNSAT direction, where it localises the
conflict.

**Implement** in `computeLogicalCohomology`, after step 1 (internal consistency)
and before step 2 (the `for (let k = 2; ...)` loop):

```ts
// Monotonicity shortcut. SAT(⋀ all blocks) ⇒ every subset is SAT.
const allFormulas = vertices.flatMap((n) => propsOf.get(n)!);
const full = await sat(allFormulas);
checksPerformed++;
checkLog.push({ kind: "set", blocks: vertices, formulas: allFormulas,
                verdict: verdictOf(full.consistent), note: "full-set probe" });
```

- `full.consistent === true` → skip the lattice entirely. Set
  `searchedToArity = vertices.length`, `searchTruncated = false`,
  `frustrations = []`, and record a new field
  `fullSetCertificate: { modelFound: true, domainSize?: number }`.
  Still compute `consistentPairs` if H⁰ is needed — but see the note below.
- `full.consistent === false` → fall through to P2 (localisation).
- `full.consistent === null` (undetermined / timeout) → **fall through to the
  existing lattice.** An undetermined full-set probe licenses nothing. This
  asymmetry is the whole reason the ladder still has to exist: FOL
  satisfiability is only semi-decidable, and small subsets often have finite
  models when the whole set does not.

**H⁰ cost note.** H⁰ is the connected-component count of the *pairwise*
consistency graph, so it needs all `C(n,2)` pair checks. Under the shortcut every
pair is known SAT, so the graph is complete and `h0 = 1` analytically — derive
it, do not measure it. Guard this with a test.

**Certificate discipline.** "No contradiction found" from a prover timeout is not
"consistent". Only an exhibited model is a positive certificate. Prefer the
`find_model`/Mace4 branch of the oracle for the full-set probe and record the
model's domain size in `fullSetCertificate`. If only a `prove`-style refutation
failure is available, the verdict is `null`, not `true`.

**Acceptance:** on a corpus with no contradiction, `checksPerformed` drops from
847 to ~11 (10 internal + 1 full) with identical `hasContradiction`. Existing
tests in `logicalCohomology.test.ts` must all still pass unchanged.

---

## P2 — QuickXplain for block-level MUS localisation

When the full-set probe returns UNSAT, find the conflict without enumerating.

`minimizeCore` (same file, ~L660) already does deletion-based minimisation at the
**formula** level. Generalise the same idea to **blocks** and add the
divide-and-conquer variant:

- **Deletion-based:** `n` oracle calls. Simple, already proven in this codebase.
- **QuickXplain** (Junker 2004): `~2k·log₂(n/k) + 2k` calls for a core of size
  `k`; averages `~1.5·log₂(n)`. For `n=10` that is a handful.

Ship deletion-based first (it reuses `minimizeCore`'s exact structure and its
`consistent === null ⇒ keep the element, set truncated` rule, which is the
correctness-critical part). Add QuickXplain behind the same interface once the
deletion path has tests.

**Critical semantic change — surface it, do not hide it.**
The lattice returns **every** MUS. QuickXplain and deletion return **one**. The
`Frustration[]` contract currently implies completeness. Options:

- Add `frustrationsComplete: boolean` to `LogicalCohomologyResult`, false on the
  QuickXplain path, and a `truncationNote`-style string explaining it.
- For full enumeration, implement MARCO-style iteration: find a MUS, add a
  blocking clause excluding supersets, repeat until the powerset is covered.
  Still far cheaper than exhaustive, and it degrades gracefully under a budget.

Keep `Frustration.core` populated by the existing `minimizeCore` — block-level
localisation narrows *which blocks*, formula-level narrows *which claims*, and
the run reports need both.

**Note on FOL.** MUS extraction is far better developed for SAT than for FOL;
DFS-Finder is roughly the reference point. At `n ≲ 50` blocks, deletion-based is
entirely adequate and there is no reason to reach for anything exotic.

**Acceptance:** the existing planted-4-wise-MUS test
(`regression: frustrations above arity 3`, blocks A/B/C/D) must still return
`arity: 4, blocks: [A,B,C,D]` via the new path, in ≤ 8 checks instead of 15.

---

## P3 — Promote signature disjointness from warning to pruning

**Principle (Robinson joint consistency).** If `Γ₁` and `Γ₂` are each satisfiable
and share no non-logical symbols, `Γ₁ ∪ Γ₂` is satisfiable. Cross-signature
subsets can *never* be a MUS. This is exact, not heuristic.

`subjectSymbols()` (~L190) already computes exactly the right thing, and
`analyzeFormalization` already emits a `disjoint_predicates` warning from it. The
information is being reported and then thrown away.

**Implement:** before the search, build a graph over blocks with an edge iff
their `subjectSymbols` sets intersect. Take connected components. Run the
consistency search independently per component. Union the results.

- A component of size 1 can only be internally inconsistent — already checked.
- Total work drops from `2^n` to `Σ 2^{nᵢ}`, which on a corpus with real
  ontological separation is a large constant factor even after P1.
- Add `signatureComponents: string[][]` to the result. It is a genuinely
  interesting output in its own right: it says which parts of the corpus are
  *about* the same things.

**Warning that must accompany this.** Component separation is only sound if the
predicate symbols are *correctly* separated. If the extractor invented
`mental_states` and `mental` as two symbols for one concept, this pass will
happily split them into different components and prove consistency faster and
more wrongly. **P3 must not ship before P4.** Gate it behind P4's alias check.

---

## P4 — Predicate normalisation (the actual scientific defect)

This is the real bug and it outranks everything above in importance.

From the consciousness run, the engine's own report:

> *"note the different predicates (`mental_states` vs `mental`), which makes
> these consistent in FOL even though conceptually opposed"*

Also `zombie_argument` vs `zombie_inference`. By P3's theorem, distinct symbols
⇒ trivially jointly satisfiable. **The pipeline currently cannot find a
cross-block contradiction on any corpus, at any arity**, whenever the extractor
mints a fresh symbol per phrasing. The verdict is an artifact of the encoding.

**Implement:**

1. A normalisation pass between `claim-extractor` and the consistency search:
   collect every predicate symbol, cluster by lemma + embedding similarity
   (the `provider-embedder` service is already available), and propose merges.
2. Merges are **proposed, not applied silently**. Emit the alias map in the
   result (`predicateAliases: Record<string, string>`) so any verdict is
   auditable and reversible.
3. New `FormalizationWarning` code: `predicate_aliasing_suspected`, severity
   `critical` when two symbols above the similarity threshold appear in
   different blocks and never co-occur in any block — that is the exact
   signature of extractor drift, and it makes `resultIsVacuous` true.
4. Prompt-side: instruct the extractor to reuse symbols from a running glossary
   across blocks rather than coining per-block. Cheapest half of the fix.

**Acceptance:** re-run the consciousness corpus. The epiphenomenalism vs
interactionism pair must either produce a genuine MUS under a merged `mental`
predicate, or be explicitly reported as `predicate_aliasing_suspected`. A silent
"consistent" is a test failure.

---

## P5 — Non-vacuity: reject models that satisfy by being empty

The IIT-vs-GWT `find_model` result was satisfied by making `broadcast` **false
everywhere**. Finite model finders love empty extensions; "consistent because
nothing exists" is not a finding.

`no_existential_witness` already exists as a warning code. Escalate it into an
enforced precondition:

- For every subject symbol a block quantifies over, auto-inject
  `exists x subject(x)` into the submitted formula set.
- Record the injected axioms in the result so the encoding stays inspectable.
- If the set is SAT only *without* the witnesses, that is a `critical` warning
  and `resultIsVacuous = true`.
- Report the model's domain size alongside the verdict. Domain size 1 with all
  predicates empty is a red flag, not a green light.

`docs/origin-of-genetic-code-run-recipe.md` already states this rule for
hand-authored blocks ("every entity the corpus commits to must carry an
existence assertion"). This makes it automatic for the extraction path.

---

## P6 — Verification

Add to `logicalCohomology.test.ts`:

1. **Monotonicity equivalence.** For every existing test corpus, the new path
   and the old exhaustive path agree on `hasContradiction` and on the MUS set.
   Run the old path behind a `forceExhaustive: true` option retained for this.
2. **Planted high-arity MUS.** Build 8 blocks whose every 7-subset is SAT and
   whose union is UNSAT. Old path at cap 6 must miss it (documenting the bug);
   new path must find it.
3. **Undetermined full-set probe falls through.** Oracle returns `null` for the
   full set, `false` for a specific triple. Must still report the triple.
4. **Empty-extension rejection (P5).** A block set satisfiable only on an empty
   domain must set `resultIsVacuous`.
5. **Alias detection (P4).** Blocks using `mental` and `mental_states` must
   raise `predicate_aliasing_suspected`.
6. **Component soundness (P3).** A planted MUS spanning two components that were
   split by an *aliased* predicate must be caught by P4 before P3 splits it.

Benchmark before/after `checksPerformed` on the consciousness corpus and record
it in the run log. Expected: 847 → ~11 on the consistent path.

---

## Ordering and rationale

| Phase | Effort | Unblocks | Ship order |
|---|---|---|---|
| P0 diagnose | XS | everything | 1st |
| P4 predicate normalisation | L | P3, all verdicts | 2nd |
| P1 top-down probe | S | the cost problem | 3rd |
| P5 non-vacuity | S | verdict validity | 4th |
| P2 QuickXplain | M | UNSAT localisation | 5th |
| P3 component pruning | M | scale beyond ~30 blocks | 6th |

P4 before P1 is deliberate. Making a wrong verdict 80× cheaper to compute is not
progress. Fix what the verdict *means*, then fix what it costs.

After P1+P2, block count is no longer the binding constraint: cost is one probe
plus a logarithmic shrink, so 50 or 200 blocks is tractable. The binding
constraint becomes extraction quality — which is P4, which is where it belongs.
