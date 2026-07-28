# Spike Manifest

## Idea

Determine whether a sheaf of local logical models can produce a reproducible,
graded measure of tension that adds information beyond AGEM's existing MUS and
formula-core enumeration. The spike must not reuse geometric or logical H1 as a
contradiction detector: both are known to collapse for different reasons.

The immediate decision-theory corpus rerun is independent of this research and
should proceed through the attributed-logic and SOC pipeline. Geometric-sheaf
validation waits for the spike verdict.

## Requirements

- Do not put a single Mace4 witness model in a stalk. Model choice, domain size,
  and element labels are non-canonical.
- Build stalk coordinates only from permutation-invariant statistics aggregated
  over multiple solver seeds and domain sizes. Candidate coordinates include
  normalized predicate-extension cardinalities and truth-pattern histograms.
- Order predicate coordinates deterministically and define restriction maps by
  marginalizing onto the explicitly shared predicate signature.
- Prove invariance under domain-element relabeling, model enumeration order, and
  solver seed. Report variance and confidence; do not hide instability behind an
  average.
- Prevent the homogeneous zero solution. Any residual experiment must use a
  declared observation-fidelity term, anchor constraints, or normalization.
- Treat `frustrations` and their minimized formula cores as the logical ground
  truth. H1 may be reported only as a secondary structural statistic.
- Preserve attribution boundaries. Incompatible rival theories must not become
  a corpus contradiction merely because they occupy adjacent vertices.
- The spike is killed unless it distinguishes degrees of tension among sets that
  are all currently satisfiable. Separating SAT from UNSAT alone only repackages
  the existing oracle.
- If a residual localizes tension, it must name the shared predicate coordinate
  responsible rather than only the block pair.

## Falsifiable Target

The new signal must produce a stable, threshold-independent ordering:

1. a robustly satisfiable matched control has the lowest residual;
2. a knife-edge satisfiable set that becomes UNSAT under one fixed, predeclared
   witness has a higher but still sub-obstruction residual;
3. direct contradiction and higher-order frustrated fixtures exceed the
   obstruction criterion or otherwise show a distinct failure-to-glue signal.

The perturbation must be fixed before measurement and applied to a matched
control as well as the near-miss. Otherwise any satisfiable theory can be made
"one formula from UNSAT" by simply adding the negation of one of its consequences,
and the fixture proves nothing.

The candidate earns a build path only if that ordering survives solver seeds,
domain sizes, domain relabelings, and reasonable aggregation choices. If it only
reproduces `frustrations`, changes with witness selection, or collapses to the
zero solution, mark it INVALIDATED.

## Required Fixtures

- robustly satisfiable matched control;
- knife-edge satisfiable near-miss with a fixed perturbing witness;
- direct `P` versus `not P` contradiction;
- pairwise-consistent, jointly-inconsistent frustrated triple;
- arity-4 MUS whose triples are all satisfiable;
- fully consistent independent control;
- accurately attributed rival theories that are mutually incompatible but do
  not make the survey corpus contradictory.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | model-invariant-local-features | standard | Given equivalent finite models under different seeds, domain sizes, and element relabelings, when stalk features are canonicalized and aggregated, then their coordinates and restriction marginals remain stable within a declared tolerance. | PENDING | sheaf, mace4, canonicalization, reproducibility |
| 002 | anchored-tension-ordering | standard | Given the matched control, near-miss, contradiction, frustrated triple, arity-4 MUS, and rival-theory fixtures, when an anchored local-model objective is evaluated, then the residual ordering is stable and adds information beyond the SAT/MUS verdict. | PENDING | residual, spectral-gap, falsification, logical-models |
| 003 | predicate-level-localization | standard | Given a fixture with one load-bearing shared predicate and distractor predicates, when edge tension is decomposed by coordinate, then the highest residual identifies the load-bearing predicate invariantly across model samples. | PENDING | attribution, diagnostics, restriction-maps |

## Kill Order

Run 001 first. Non-canonical features invalidate both later spikes. Run 002 next;
failure to separate robust SAT from knife-edge SAT kills the proposed sheaf as
ornamental. Run 003 only if the graded signal survives.
