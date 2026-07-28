# Plan: replace the arity ladder in the consistency search

**Target files:** `interface/backend/src/services/logicalCohomology.ts`,
`services/claim-blocks.ts`, `services/claim-extractor.ts`
**Caller:** `interface/backend/src/routes/chat.ts`
**Config:** `interface/backend/src/config.ts` (`LOGIC_MAX_ARITY`, `LOGIC_MAX_CHECKS`)

## Implementation outcome (2026-07-27)

This plan is implemented with two scientific corrections to the original
design: UNSAT localisation now enumerates every MUS with monotone
branch-and-bound instead of returning one QuickXplain core, and signature
components are reported but are not used as a search prune. The latter is not
sound from predicate overlap alone because equality/domain-cardinality
constraints can couple otherwise disjoint signatures.

| Concern | Implemented behavior |
|---|---|
| Configured arity | `defaultMaxArity` is distinct from caller-supplied `maxArity`; extraction defaults no longer disable auto-exhaust. |
| Full set is SAT | One positive model certifies every subset. Pairs and homology are derived analytically; triangles and dense boundary matrices are not materialized. |
| Full set is UNSAT | Deletion minimization plus monotone branch-and-bound enumerates all MUSes when the oracle and budget are conclusive. |
| Homology memory | Complete 2-skeletons use closed-form ranks; other complexes use sparse incremental triangle-boundary elimination. No path allocates the former `edges × triangles` dense matrix. |
| Oracle/budget uncertainty | `frustrationsComplete`, `uncheckedBlocks`, `searchTruncated`, and explicit notes prevent partial work from being reported as success. `maxChecks` caps every oracle call, including internal and formula-core probes. |
| Predicate similarity | Embeddings produce `predicateAliasSuggestions`; they never rewrite formulas. Only an audited ontology map and deterministic clause-label repair are applied. |
| Non-vacuity | Typed extraction injects existence commitments and returns them in `injectedAxioms`. Empty-model-only results remain critical failures. |

The original recorded run
`knowledge_base/runs/2026-07-28T00-10-03-376Z_mwcz1i.jsonl` confirmed P0 case
2: `extract_and_verify_claims` passed `LOGIC_MAX_ARITY=6` as an explicit cap.
Its audit log contained 847 oracle calls (10 internal plus 837 subset calls),
searched only through arity 6, and reported truncation. Replaying the exact 10
derived blocks through the local Mace4 oracle after this implementation took
11 calls (10 internal plus one full-set model), searched through arity 10, and
reported `searchTruncated: false` in 0.1 seconds. The verdict remained
`hasContradiction: false`; suspected predicate aliasing was explicitly reported
instead of silently merged.

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
- **Do not delete the lattice search.** It remains the explicit-arity and
  verification fallback even though the default branch-and-bound path also
  enumerates all MUSes.

---

## P0 — Diagnose why auto-exhaust did not fire — complete

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

The run proved case 2. The extraction caller converted the configured default
into `options.maxArity`, making it indistinguishable from a deliberate caller
cap. `configuredCohomologyOptions()` now supplies `defaultMaxArity` instead,
while the hand-authored tool still sets `maxArity` only when its argument is
present. A 10-block regression covers this distinction.

**Acceptance result:** real-Mace4 replay produced `searchedToArity: 10` and
`searchTruncated: false`.

---

## P1 — Top-down first: one check settles the whole lattice — complete

**Principle.** Satisfiability is downward-monotone: a model of `Γ` is a model of
every `Γ' ⊆ Γ`. So if the conjunction of all blocks is SAT, *every one of the
`2^n` subsets is SAT* and the entire ladder is redundant. One check replaces 847.

The ladder is only informative in the UNSAT direction, where it localises the
conflict.

**Implemented** in `computeLogicalCohomology`, after step 1 (internal consistency)
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
  Populate the public `consistentPairs` projection in O(n²), but do not
  materialize triangles or boundary matrices.
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

**Acceptance result:** the recorded corpus dropped from 847 total calls to 11
(10 internal + 1 full) with the same `hasContradiction: false`. The new
`homologyDerivedAnalytically` field proves the bounded path was used.

---

## P2 — Complete block-level MUS localisation — complete

When the full-set probe returns UNSAT, the implementation uses a monotone
branch-and-bound enumerator:

1. Deletion-minimize the UNSAT candidate to one block-level MUS.
2. Remove each member of that MUS to create branches covering every location
   in which another MUS could exist.
3. Prune a branch when a known MUS is contained in it, or when a SAT superset
   has already certified it and all its subsets.
4. Continue until all branches are covered.

This preserves the existing `Frustration[]` completeness contract without
walking the full lattice. `frustrationsComplete` is true only when enumeration
finishes with conclusive oracle results inside the hard call budget;
`frustrationSearchNote` explains every incomplete outcome. The original lattice
remains available through `forceExhaustive` for equivalence testing and through
the explicit-arity path for deliberately bounded searches.

Formula-level core minimization still runs after block localization, and every
real oracle invocation is represented by a `core-probe` audit entry. A MUS with
one formula per block needs no redundant formula-core calls.

**Acceptance results:** the planted 4-wise MUS is preserved, two independent
MUSes are both enumerated, and an 8-wise MUS is found in 17 total calls while
the old arity-6 path misses it.

---

## P3 — Report signature components; do not prune — revised and complete

The initial pruning proposal was too strong. Disjoint predicate vocabularies do
not by themselves guarantee that two FOL theories have compatible models:
shared equality and cardinality constraints can still make their union UNSAT,
and alias drift can make a shared concept appear disjoint. `subjectSymbols()`
is also intentionally narrower than the full non-logical signature.

The engine therefore returns `signatureComponents` computed from full predicate
symbols as an informational topology, but never uses those components to skip a
satisfiability check. This retains the useful corpus structure without making a
scientifically unsound inference.

---

## P4 — Predicate normalisation (the actual scientific defect) — complete

This is the real bug and it outranks everything above in importance.

From the consciousness run, the engine's own report:

> *"note the different predicates (`mental_states` vs `mental`), which makes
> these consistent in FOL even though conceptually opposed"*

Also `zombie_argument` vs `zombie_inference`. Distinct symbols are independent
to the prover unless other formulas connect them, so extractor-coined synonyms
can hide the very cross-block contradiction being tested. Before this change,
the resulting clean verdict could therefore be an artifact of the encoding.

**Implemented:**

1. The claim-block derivation collects typed role labels and compares their
   provider embeddings. Similarities above the threshold become structured
   `predicateAliasSuggestions` with source, target, proposed canonical symbol,
   cosine score, and severity.
2. Suggestions are **never applied silently**. `predicateAliases` contains only
   rewrites already applied through the audited ontology/repair path; formulas,
   mappings, and suggestions are all returned for audit.
3. New `FormalizationWarning` code: `predicate_aliasing_suspected`, severity
   `critical` when two symbols above the similarity threshold appear in
   different blocks and never co-occur in any block — that is the exact
   signature of extractor drift, and it makes `resultIsVacuous` true.
4. Prompt-side, extraction maintains a running predicate glossary across
   concurrency waves and instructs later batches to reuse its role labels.

**Acceptance result:** re-running the consciousness corpus either preserves an
audited ontology merge or reports a predicate alias candidate. The recorded
10-block replay returned `predicate_aliasing_suspected`; it did not silently
report a complete clean result.

The epiphenomenalism-vs-interactionism requirement is now enforced: the pair
must either produce a genuine MUS under an audited `mental` alias or be
explicitly reported as `predicate_aliasing_suspected`. A silent "consistent"
is a test failure.

---

## P5 — Non-vacuity: reject models that satisfy by being empty — complete

The IIT-vs-GWT `find_model` result was satisfied by making `broadcast` **false
everywhere**. Finite model finders love empty extensions; "consistent because
nothing exists" is not a finding.

`no_existential_witness` remains an enforced validity condition:

- Typed claim conversion injects subject witnesses, and the block derivation
  adds shared neutral witnesses where roles recur across positions.
- Every generated existence commitment is returned by block in
  `injectedAxioms`, so the encoding stays inspectable.
- A missing static witness or a runtime model flagged as empty-only is a
  `critical` warning and sets `resultIsVacuous = true`.
- Report the model's domain size alongside the verdict. Domain size 1 with all
  predicates empty is a red flag, not a green light.

`docs/origin-of-genetic-code-run-recipe.md` already states this rule for
hand-authored blocks ("every entity the corpus commits to must carry an
existence assertion"). This makes it automatic for the extraction path.

---

## P6 — Verification — complete

Covered in `logicalCohomology.test.ts`:

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

Additional regressions cover exact hard-budget exhaustion, incomplete MUS
enumeration, suggestion-only embeddings, critical alias drift coexisting with
an unrelated contradiction, analytical homology at the 120-block cap, and
sparse homology for a pair MUS at that same cap.

Benchmark result on the exact recorded 10-block corpus: 847 → 11 total oracle
calls on the consistent path, with the full set certified by real Mace4.

---

## Ordering and rationale

| Phase | Final decision | Status |
|---|---|---|
| P0 | Separate configured defaults from explicit caps | Complete |
| P4 | Audited aliases plus suggestion-only embeddings | Complete |
| P1 | Positive full-set certificate and analytical homology | Complete |
| P5 | Automatic, auditable existence witnesses | Complete |
| P2 | Complete monotone branch-and-bound MUS enumeration | Complete |
| P3 | Informational signature components, no pruning | Revised/complete |

P4 before P1 is deliberate. Making a wrong verdict 80× cheaper to compute is not
progress. Fix what the verdict *means*, then fix what it costs.

After P1+P2, a consistent corpus costs one full-set probe after its internal
checks. UNSAT cost remains output-sensitive: it depends on the number and shape
of MUSes, and is always bounded by `maxChecks`. Extraction quality remains the
binding scientific constraint, which is why suggestions are surfaced as
validity warnings instead of being optimized away.
