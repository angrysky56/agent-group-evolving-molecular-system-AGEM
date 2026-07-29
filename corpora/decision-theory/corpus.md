# Decision theory — three theories, eight problems

> **Ingestion:** one cycle per `##` section, each into its own named subgraph.
> Nine sections. See `docs/multi-cycle-sectioning-plan.md`. A single-cycle run of
> this file cannot produce sheaf cohomology and will report `Nascent` forever.
>
> Every verdict below is **attributed** to a theory. The corpus asserts only that
> these are the verdicts, that certain entailments hold, and that certain
> desiderata cannot be jointly satisfied.

## Section 1 — The three theories

**Causal Decision Theory (CDT)** evaluates an act by the utility it *causes*. It
uses causal counterfactuals: the value of act A is expected utility across
states, weighted by the probability those states would obtain *if A were
performed*. CDT holds the **dominance** principle: if A does at least as well as
B in every causally independent state and better in some, choose A.

**Evidential Decision Theory (EDT)** evaluates an act by the utility it is
*evidence for*. The value of A is expected utility conditional on observing
yourself do A. EDT holds **evidential responsiveness**: if performing A is strong
evidence for a better outcome, that counts in favour of A, whether or not A
causes it.

**Functional Decision Theory (FDT)** evaluates not the act but the *decision
procedure*. It asks which output of your algorithm produces the best outcome,
given that every instance of that algorithm — including any accurate model of you
inside a predictor — produces the same output. FDT does not treat acts as the
objects of evaluation, and therefore does not hold dominance, while asserting an
analogue of it over policies.

## Section 2 — Newcomb's problem, and what dominance entails there

An accurate predictor has put $1,000,000 in box B if and only if it predicted you
would take only B. Box A transparently holds $1,000.

**The payoff structure is such that two-boxing dominates.** If B is full,
two-boxing yields $1,001,000 against one-boxing's $1,000,000. If B is empty,
two-boxing yields $1,000 against one-boxing's $0. Two-boxing is better in *every*
state, and the states are causally independent of the act because the prediction
is already fixed.

Therefore **any theory holding dominance recommends two-boxing in Newcomb.** CDT
holds dominance and two-boxes.

**Newcomb-adequacy** is the property of recommending the act that reliably makes
agents richer in Newcomb. One-boxers reliably end up with $1,000,000; two-boxers
reliably end up with $1,000. So **a theory that recommends two-boxing is not
Newcomb-adequate.**

Combining: **any theory that holds dominance is not Newcomb-adequate.** CDT concedes the
reliably-richer fact and denies it is a reason.

EDT holds evidential responsiveness. One-boxing is strong evidence that B is
full, so EDT one-boxes and is Newcomb-adequate. FDT one-boxes and is
Newcomb-adequate.

## Section 3 — The smoking lesion, and what evidential responsiveness entails there

A genetic lesion causes both a desire to smoke and cancer. Smoking itself does
not cause cancer.

**The correlation structure is confounded, not causal.** Smoking is evidence of
the lesion, and the lesion is evidence of cancer, but smoking does not cause
cancer.

Therefore **any theory holding evidential responsiveness recommends refraining**,
because refraining is evidence against the lesion. EDT holds evidential
responsiveness and refrains.

**Lesion-adequacy** is the property of recommending smoking, since smoking is
harmless and pleasant and the correlation is confounded. So **a theory that
recommends refraining is not lesion-adequate.**

Combining: **any theory that holds evidential responsiveness is not
lesion-adequate.** This verdict
of EDT's is widely held to be wrong, and it is the mirror image of CDT's Newcomb
failure — the same structural question, whether correlation without causation is
decision-relevant, seen from the opposite side.

CDT holds dominance; smoking dominates refraining in every state; CDT smokes and
is lesion-adequate. FDT smokes and is lesion-adequate.

## Section 4 — The four desiderata are jointly unsatisfiable

Four properties one might want:

1. **Dominance** — as stated in Section 1.
2. **Evidential responsiveness** — as stated in Section 1.
3. **Newcomb-adequacy** — recommends the reliably-richer act in Newcomb.
4. **Lesion-adequacy** — recommends smoking in the smoking lesion.

From Section 2: any theory holding dominance is not Newcomb-adequate, so **dominance and
Newcomb-adequacy are incompatible.**

From Section 3: any theory holding evidential responsiveness is not lesion-adequate, so
**evidential responsiveness and lesion-adequacy are incompatible.**

Therefore **every theory fails at least one of the four properties**: a theory
that holds dominance is not Newcomb-adequate, and a theory that holds evidential
responsiveness is not lesion-adequate. This is not merely a fact about the three
named theories; it follows from the payoff structure of the two problems together
with the definitions of the four properties. In fact, **no three of the four are
jointly satisfiable**: every three-property subset contains either dominance +
Newcomb-adequacy or evidential responsiveness + lesion-adequacy.

The maximal satisfiable subsets under these two incompatibility rules are pairs:

- dominance + evidential responsiveness.
- dominance + lesion-adequacy, as exemplified by CDT.
- evidential responsiveness + Newcomb-adequacy, as exemplified by EDT.
- Newcomb-adequacy + lesion-adequacy, as exemplified by FDT.

FDT's escape is distinctive: it does not weaken a desideratum, it changes the
object of evaluation from acts to policies. Whether policy-dominance counts as
satisfying dominance is disputed.

## Section 5 — Ratifiability and Death in Damascus

Death is in Damascus tonight and will be wherever you are tomorrow. You may stay
or flee to Aleppo. Whichever you choose, on learning your own choice you wish you
had chosen otherwise.

An act is **ratifiable** if, conditional on having decided to perform it, it
remains the recommended act. In Death in Damascus **staying is not ratifiable and
fleeing is not ratifiable**: each option is one the theory itself, once settled
upon, disprefers. Staying and fleeing are the only available acts. So in Death in
Damascus **CDT does not recommend any act.** CDT is not incorrect here; CDT is
not total here — it returns no recommendation at all.

Death in Damascus is a well-posed decision problem in which **no available act is
ratifiable**. Therefore **a theory that requires every recommendation to be
ratifiable is not total over well-posed problems.** So a theory cannot both
require ratifiability and be total over well-posed problems.

## Section 6 — Transparent Newcomb and Parfit's hitchhiker

**Transparent Newcomb.** As Newcomb, but box B is transparent and you see it full.
CDT two-boxes. EDT's verdict here is not ratifiable, because the observation
screens off the evidential link that drove its Newcomb answer. FDT one-boxes:
seeing B full is already conditional on being the kind of agent who one-boxes.

**Parfit's hitchhiker.** A driver rescues you from the desert only if he predicts
you will pay $100 once safely in town. Once in town, payment causes nothing
further and is evidence for nothing further, so CDT and EDT both decline.
Predicting this, the driver leaves them in the desert. FDT pays, because the
policy of paying is what gets the ride.

Both cases favour FDT, and both turn on the same feature: an agent's disposition
is causally upstream of the predictor's behaviour even when the act is not.

## Section 7 — XOR blackmail, and evidential responsiveness again

A letter reads: "I have sent this if and only if exactly one of (your house has
termites) or (you will pay me) is true."

Paying is evidence against termites. **Evidential responsiveness therefore
recommends paying**, and EDT pays. This is widely held to be wrong: the letter
does not give you any influence over the termites.

Refusing requires not holding act-conditional evaluation — evaluating the act by
what it is evidence for. So **a theory that refuses XOR blackmail does not hold
both evidential responsiveness and act-conditional evaluation.** CDT refuses and
holds neither of the two. FDT refuses and holds evidential responsiveness in a
form restricted to logically-dependent outcomes.

## Section 8 — Twin prisoner's dilemma and counterfactual mugging

**Psychological twin prisoner's dilemma.** Your opponent is an exact copy of you
running the same decision procedure. CDT defects: your choice cannot cause theirs.
EDT cooperates. FDT cooperates, because both instances compute the same output.

**Counterfactual mugging.** A predictor flipped a fair coin; on tails it would
have given you $10,000 if it predicted you would pay $100 on heads. It came up
heads. CDT and EDT decline. FDT pays, because the policy of paying has higher
expected value ex ante. This one is genuinely contested even among FDT's
proponents.

## Section 9 — Egan's counterexamples

Egan argues that CDT's verdicts diverge from intuition in cases where the act
itself is evidence about which state obtains — the "Psycho Button" and related
constructions. An agent presses a button that kills all psychopaths; pressing is
evidence that the agent is a psychopath; CDT's dominance reasoning recommends
pressing anyway.

So **dominance reasoning is not intuitively safe even within CDT's home
territory**, where the states are causally independent of the act. This weakens
the case for dominance as a desideratum without providing an alternative, and it
is the reason the Section 4 impossibility is usually presented as a genuine
trilemma rather than as an argument for CDT.
