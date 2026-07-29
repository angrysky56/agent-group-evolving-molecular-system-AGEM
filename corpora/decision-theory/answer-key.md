# Answer key — decision theory

Use this corpus as the **smoke test**. Three theories, eight problems, four
desiderata — small enough to run in seconds, structured enough to catch every
failure mode the ToM corpus exposed.

## The verdict table (ground truth)

| Problem | CDT | EDT | FDT | Who's right, by consensus |
|---|---|---|---|---|
| Newcomb | two-box | one-box | one-box | EDT/FDT |
| Smoking lesion | smoke | refrain | smoke | CDT/FDT |
| Transparent Newcomb | two-box | unstable | one-box | FDT |
| Parfit's hitchhiker | don't pay | don't pay | pay | FDT |
| XOR blackmail | refuse | pay | refuse | CDT/FDT |
| Death in Damascus | *no ratifiable act* | flee | mixed | — |
| Psycho twin PD | defect | cooperate | cooperate | EDT/FDT |
| Counterfactual mugging | don't pay | don't pay | pay | contested |

Note the shape: CDT and EDT each fail on the problem the other handles, and each
failure is the *same* structural feature seen from opposite sides — whether
correlation without causation is decision-relevant.

## The impossibility

No theory satisfies all four of **dominance**, **evidential responsiveness**,
**Newcomb-adequacy**, **lesion-adequacy**. The minimal conflicts are the two
pairs **dominance + Newcomb-adequacy** and **evidential responsiveness +
lesion-adequacy**. Therefore no three of the four are jointly satisfiable.

The maximal satisfiable pairs are:

- dominance + evidential responsiveness
- dominance + lesion-adequacy (CDT)
- evidential responsiveness + Newcomb-adequacy (EDT)
- Newcomb-adequacy + lesion-adequacy (FDT)

FDT's escape is the interesting one and the reason to run this corpus: it does not
weaken a desideratum, it changes the object of evaluation from acts to policies.
Whether that counts as satisfying dominance is a genuinely open question, listed
in `openQuestions.fdt_minimal_sacrifice`.

## Scoring

**Pass** = all four `mustFind` reproduced, all four `mustNotFind` reported
consistent.

`ratifiability_impossible` is arity 2 and nearly trivial. If AGEM misses it, the
problem is in extraction or attribution, not in the search — check there before
touching anything else.

`one_box_vs_two_box` is the tripwire. CDT says two-box, EDT says one-box; these
are *different theories' verdicts on the same problem*. A run that reports this
as a corpus contradiction has reproduced the ToM HOT/HOP failure exactly, and the
attributed-block fix did not take.

## What a real result would look like

Enumerate every **maximal satisfiable subset** of the desiderata, not just the
MUSes. Each MSS is a coherent decision-theoretic position — including positions
no named theory currently occupies. If the enumeration turns up an MSS that isn't
CDT, EDT, or FDT, that's a decision theory nobody has written down, described by
which desiderata it keeps.

That is a small, concrete, checkable result, and this is the corpus most likely
to produce one quickly.

## Sources

- Nozick, "Newcomb's Problem and Two Principles of Choice" (1969)
- Gibbard & Harper, "Counterfactuals and Two Kinds of Expected Utility" (1978) — Death in Damascus
- Egan, "Some Counterexamples to Causal Decision Theory", *Phil. Review* 116 (2007)
- Ahmed, *Evidence, Decision and Causality* (CUP 2014)
- Yudkowsky & Soares, "Functional Decision Theory" (arXiv 1710.05060)
- Soares & Fallenstein, "Toward Idealized Decision Theory" (2015) — XOR blackmail
