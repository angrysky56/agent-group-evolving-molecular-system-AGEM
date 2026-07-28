# Answer key — QM interpretations

Six published impossibilities. Each is a MUS over stances; each named
interpretation survives by dropping exactly one conjunct.

| Theorem | Incompatible stances | Who escapes, and how |
|---|---|---|
| **Bell** (1964) | locality + definite_prior_values + measurement_independence + empirically_adequate | Bohm drops locality · Copenhagen/QBism drop definite values · superdeterminism drops measurement independence · Everett drops single outcomes |
| **Kochen–Specker** (1967) | noncontextuality + value_definiteness + empirically_adequate | Any hidden-variable theory must be contextual. Bohm accepts this explicitly. |
| **PBR** (2012) | psi_epistemic + preparation_independence + empirically_adequate | ψ must be ontic, *or* preparation independence fails. QBism escapes by denying there is a λ at all. |
| **Frauchiger–Renner** (2018) | universal_quantum_theory (Q) + agent_consistency (C) + single_outcome (S) | Everett drops S · QBism/RQM drop C · Copenhagen drops Q |
| **Leggett–Garg** (1985) | macrorealism + noninvasive_measurability + empirically_adequate | The temporal analogue of Bell. |
| **Brukner / Local Friendliness** (2018, 2020) | observer_independent_facts + locality + measurement_independence + universal_quantum_theory | RQM and QBism drop observer-independent facts. |

## Scoring

**Pass** requires all six in `mustFind` reproduced *and* all five `mustNotFind`
entries reported consistent. Reproducing Bell while also calling Bohm
contradictory is a fail — it means the escape routes aren't encoded and the
engine is just detecting negation.

## The two traps

**Trap 1 — axis opposition is not impossibility.** ψ-ontic and ψ-epistemic are
opposed stances on one axis. A correct run reports these as
*positions-incompatible*, never as a corpus contradiction. This is the exact
failure mode the ToM corpus produced with HOT/HOP, and this corpus is built to
catch it: `mustNotFind.ontic_vs_epistemic_alone` is the tripwire.

**Trap 2 — contested premises.** PBR's preparation-independence assumption is
disputed (Gao 2025). The corpus states the objection as an attributed challenge.
AGEM should surface the dispute, not adjudicate it. A run that silently drops the
objection to get a cleaner MUS has lost the thing that makes this corpus useful.

## What a real result would look like

Enumerate **all** MUSes over the nine axes, diff against the six known. Surplus
MUSes are candidate findings — combinations ruled out by the conjunction of
separately-proved theorems that nobody has named because nobody enumerated the
space. Each survivor then needs a hand check against the literature before it's
a claim.

The negative space is equally interesting: cells in the 2⁹ stance-space that no
named interpretation occupies but that no theorem forbids. Unoccupied and
permitted is where a new interpretation would live.

## Sources

- Bell, *Physics* 1 (1964) 195; Hensen et al., *Nature* 526 (2015) 682 — loophole-free
- Kochen & Specker, *J. Math. Mech.* 17 (1967) 59
- Pusey, Barrett & Rudolph, *Nature Physics* 8 (2012) 475
- Gao, "The PBR Theorem Requires No Preparation Independence", PhilSci Archive 25955 (2025)
- Frauchiger & Renner, *Nature Communications* 9 (2018) 3711
- Leggett & Garg, *PRL* 54 (1985) 857
- Brukner, *Entropy* 20 (2018) 350; Bong et al., *Nature Physics* 16 (2020) 1199
