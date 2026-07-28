# Reverse mathematics — which axioms does a theorem actually need?

> **Ingestion:** `sectionPattern: "^## "`. 4 sections, one cycle each into a named
> subgraph. For a deliberately finer-grained follow-up, the bold theorem groups
> can be split with a properly escaped `^\*\*` pattern. See
> `docs/multi-cycle-sectioning-plan.md`.
>
> Reverse mathematics asks, for a theorem T, what is the *weakest* subsystem of
> second-order arithmetic that proves T. The surprising empirical fact is that
> almost every theorem of classical mathematics turns out to be equivalent, over
> a weak base theory, to one of five subsystems. This corpus states those
> equivalences and the one famous exception.
>
> This is a **calibration corpus**: the ground truth is unusually solid, because
> logicians established it by hand over fifty years. If AGEM cannot reproduce it,
> nothing it says about a contested field should be believed.

## The Big Five

**RCA₀** — recursive comprehension. The base theory. Δ⁰₁ comprehension plus Σ⁰₁
induction. Roughly: computable mathematics. All reductions below are proved
*over* RCA₀.

**WKL₀** — weak König's lemma: every infinite subtree of the full binary tree has
an infinite path. Strictly stronger than RCA₀. Captures a form of compactness.

**ACA₀** — arithmetical comprehension: sets definable by arithmetical formulas
exist. Equivalent in strength to Peano arithmetic. Captures the existence of
ranges of functions and limits of sequences.

**ATR₀** — arithmetical transfinite recursion: arithmetical comprehension can be
iterated along any countable well-ordering. Captures comparability of well-orderings.

**Π¹₁-CA₀** — comprehension for Π¹₁ formulas. The strongest of the five. Captures
perfect-kernel and Cantor–Bendixson style results.

They form a strict linear hierarchy:
RCA₀ ⊊ WKL₀ ⊊ ACA₀ ⊊ ATR₀ ⊊ Π¹₁-CA₀.

## Equivalences claimed by the reverse-mathematics literature

The literature asserts that **WKL₀** is equivalent over RCA₀ to: the Heine–Borel
covering lemma for the closed unit interval; the Gödel completeness theorem for
countable languages; the existence of prime ideals in countable commutative
rings; the Brouwer fixed point theorem; the separable Hahn–Banach theorem; and
the extreme value theorem for continuous functions on [0,1].

The literature asserts that **ACA₀** is equivalent over RCA₀ to: the
Bolzano–Weierstrass theorem; the existence of the range of any function from ℕ to
ℕ; sequential completeness of the reals; König's lemma for arbitrary
finitely-branching trees; the existence of a maximal ideal in a countable
commutative ring; and Ramsey's theorem for exponent n whenever n ≥ 3.

The literature asserts that **ATR₀** is equivalent over RCA₀ to: comparability of
countable well-orderings; Σ¹₁ separation; the perfect set theorem; and open
(Σ⁰₁) determinacy.

The literature asserts that **Π¹₁-CA₀** is equivalent over RCA₀ to: the
Cantor–Bendixson theorem; the statement that every tree has a perfect kernel; and
Σ⁰₁ ∧ Π⁰₁ determinacy.

## The exception the literature insists on

Ramsey's theorem for pairs and two colours, **RT²₂**, is *not* equivalent to any
of the Big Five. Seetapun proved RT²₂ does not imply ACA₀. Fifteen years later
Liu proved RT²₂ does not imply WKL₀. Cholak, Jockusch and Slaman together with
Liu's result establish that RT²₂ and WKL₀ are **incomparable**: neither implies
the other over RCA₀. RT²₂ is strictly above RCA₀ and strictly below ACA₀ while
being incomparable with WKL₀ — it sits in its own place in the hierarchy.

This is the most celebrated counterexample to the Big Five phenomenon and the
reason the phenomenon is described as empirical rather than theorematic.

## The generalisation the literature denies

It is *not* the case that Ramsey's theorem is uniformly equivalent to ACA₀ across
exponents. RT^n_k for n ≥ 3 is equivalent to ACA₀; RT²₂ is not. Any encoding that
treats "Ramsey's theorem" as a single statement with a single strength has erased
the one result this corpus exists to test.
