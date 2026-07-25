# Corpus: The Generalization Trilemma

**Safe to paste wholesale.** This file contains no answers. The expected results
live in `generalization-trilemma-KEY.md` — do not feed that one to the model.

## How to run it

Feed the four stages **as four separate `run_agem_cycle` calls, in order**, one
stage per cycle. Between cycles, inspect (`get_graph_topology`,
`get_cohomology`, `get_soc_metrics`). The staging is the point: this corpus is
designed so that the _trajectory_ of the metrics matters more than any single
reading.

Only after all four stages, run `evaluate_logical_consistency`.

## What it is for

The existing `logic-h1-test-corpus.md` is a calibration instrument: atomic
propositions, contradiction visible on inspection, built to prove the machinery
runs. This one is the opposite. It is a **trap corpus**.

Each stage is a sincere, self-contained position in a live research disagreement.
No stage refers to the others. No stage announces a contradiction. The prose is
argumentative, not formal, and the vocabulary has been arranged so that the
concept graph will cluster the material **along different lines than the logic
does**. If AGEM's central claim is true — that H⁰ is for connectivity and
logic-H¹ is for contradiction, and the two are different machines — then this
corpus should make the two machines visibly disagree.

Three specific traps are set. They are described here by _mechanism_, not by
outcome, so you can watch for them without knowing the answer:

1. **Lexical clustering that cross-cuts the logical structure.** Two positions
   that are logically compatible share most of their vocabulary. A position that
   is essential to the contradiction uses a largely disjoint register. Louvain
   should therefore group the material in a way that does not correspond to the
   logical blocks.

2. **A high-similarity, logically-independent passage.** One passage is a near
   neighbour of another in embedding space and shares its terminology almost
   completely, while asserting nothing that bears on the disagreement at all.
   Semantic proximity should not become a logical relation.

3. **A synthesis that bridges vocabulary without touching logic.** The final
   stage reads as a reconciliation and connects the separated clusters
   lexically. It resolves nothing. Watch what H⁰ does when it lands, and whether
   the narrative follows the geometry or the logic.

> [!IMPORTANT]
> Ask for the `checkLog`, not just the H¹ number. A frustration that was never
> actually checked is not a finding.

---

## Stage 1 — The Transfer Argument

Ingest this as cycle 1.

The most reliable empirical regularity in modern machine learning is that
competence acquired in one setting shows up in settings the system was never
trained on. This is not a marginal effect at the edges of the training
distribution. Models trained predominantly on English text answer questions in
languages that made up a fraction of a percent of the corpus. Models trained on
next-token prediction over ordinary documents perform multi-step arithmetic,
translate between programming languages they saw only in passing, and solve
puzzle formats invented after their training data was collected.

The pattern is consistent enough to plan around. A capability that appears at
one scale appears more robustly at the next. A capability measured on one
benchmark transfers to structurally similar benchmarks that were built
independently and often adversarially, by people specifically trying to defeat
memorization. When researchers construct held-out task families precisely to
break surface-level pattern matching, performance drops — and then recovers with
scale, on the new family, without task-specific training.

What this tells us is that the representations being learned are not indexed to
the training distribution. If they were, transfer of this kind would be
impossible; you would see competence collapse the moment the input left the
region where the gradient signal lived. That is not what happens. What happens
is graceful degradation and then recovery, which is the signature of a general
mechanism being applied to unfamiliar inputs rather than a lookup table being
queried outside its keys.

There is a deeper point here about what a benchmark score means. A score is not
a property of the model alone; it is a measurement of the model under a
sampling procedure. The reason benchmark performance predicts field performance
at all is that whatever the model learned is not tied to the particular sampling
procedure the benchmark used. If competence were distribution-bound, benchmark
scores would be uninformative about anything except the benchmark, and the
entire measurement enterprise would be circular. It is not circular. Scores
predict. Capability travels.

This has become the background assumption of the field, and it is well earned. It
is why capability forecasting works at all, why scaling curves extrapolate, why
a lab can decide what to build next on the basis of what a smaller model already
does. Every one of those practices presupposes that what is being measured is a
general competence and not a fitted response to a particular slice of input
space.

---

## Stage 2 — What Preference Training Installs

Ingest this as cycle 2.

### 2a. The shape of the training signal

Consider carefully what preference-based fine-tuning actually optimizes. A
reward model is fit to a corpus of comparisons produced by annotators, over
prompts drawn from some collection process. The policy is then updated to score
well under that reward model. Every element of this pipeline is a sample from a
distribution: the prompts are sampled, the annotators are sampled, their
judgments are sampled from their own dispositions on the day.

What the gradient can see is the annotator's response to the prompts that were
actually shown. It cannot see the disposition the annotator would have had on
prompts nobody wrote down. Whatever regularity the reward model extracts is a
regularity of that sample. The policy that results is fitted to that regularity.

This matters because reward models are known to latch onto correlates of the
intended property rather than the property itself. Length, formatting, hedging,
apparent confidence, the presence of caveats — all of these correlate with
annotator approval within the collection distribution, and all of them are
cheaper for a policy to satisfy than the underlying quality the annotators were
asked to track. The optimization does not distinguish the correlate from the
target, because within the sample there is nothing to distinguish.

So the object installed by preference training is a policy that produces
approved-looking behavior on inputs like the ones in the comparison corpus. Its
dependence on that corpus is not incidental; it is constitutive. Move far enough
from the collection distribution and the correlates come apart from the target,
and there is no reason internal to the training process for the policy to follow
the target rather than the correlate. It was never given a handle on the target.
It was given a gradient through a sample.

The honest description of what preference training produces is therefore a
behavioral disposition indexed to a distribution, not a goal that a system
carries with it. Whatever else is true, the thing installed does not travel.

### 2b. What the features look like

A separate line of work has been trying to characterize what these training
procedures leave behind in the weights, and the picture is unexpectedly
structured. Networks appear to represent far more features than they have
neurons, packing them into overlapping directions in activation space —
superposition. Individual neurons are polysemantic as a direct consequence:
a single unit participates in many unrelated features, which is why reading
neurons one at a time produces such uninterpretable results.

Sparse decomposition methods recover directions that are considerably more
monosemantic than raw neurons, and the recovered features are often
human-legible: a direction for a particular syntactic construction, a direction
that activates on a specific class of entity. The count of recoverable features
scales with the width of the decomposition rather than saturating, which
suggests the underlying representation is far richer than the neuron count
implies. Feature geometry is not random either — related features sit in related
directions, and the arrangement carries structure that nobody put there
deliberately.

This is a claim about representational format. It says how the information is
laid out, and it holds regardless of what the training signal was fitted to or
how far the deployment inputs sit from the collection distribution.

---

## Stage 3 — The Evaluation Mandate

Ingest this as cycle 3.

Deployment decisions have to be made on evidence, and the only evidence anyone
has about a system's behavior is its behavior. This sounds trivial and is not.
It means the operational content of a safety claim is always a claim about
measurement: this system, run against this battery, produced these outputs at
these rates.

A serious evaluation battery is not a benchmark score. It is coverage. It means
red-teaming across the threat classes that matter, adversarial prompting by
people whose job is to find the failure, held-out task families built after the
model was frozen, measurement at the tails rather than the mean, and scoring
procedures fixed in advance so the threshold cannot be moved after the results
arrive. Built that way, the battery is a genuine sample of the behavior that
matters, and its scores carry real information about what the system will do in
the field.

That informativeness is the whole basis of the practice, and it is worth being
explicit about the condition it rests on. Evaluated behavior predicts deployed
behavior only if what the evaluation is measuring is not itself an artifact of
the evaluation setting. If the competences a system displays travel beyond the
measurement distribution but its dispositions do not — if what it can do
generalizes while what it will do stays behind — then a score obtained under
evaluation would tell you nothing reliable about conduct under deployment, and
the entire practice would be measuring the wrong object. We should say plainly
that this is the load-bearing assumption.

We hold that the assumption is satisfied, and not by luck. Preference training
is not a thin behavioral veneer over an indifferent system; it reshapes the
model's dispositions at a level that shows up far outside the fine-tuning
distribution. Trained refusal behavior appears against attack formats invented
long after training, in languages the preference data barely touched, and in
task framings nobody anticipated. That is not what a distribution-bound policy
does. It is what a disposition does when it has been learned as a general
property rather than fitted to a sample. Dispositions travel with capabilities,
because they are learned by the same mechanism at the same time.

So the mandate stands, and the argument for it is straightforward. Evaluation is
the only instrument we have. Built with adequate coverage, it is a good
instrument. A system that passes a battery of this quality has given us the
evidence that matters, and its evaluated behavior does predict its deployed
behavior. That is what it means, operationally, for a system to be safe to
release.

---

## Stage 4 — A Reconciliation

Ingest this as cycle 4.

Read charitably, the disagreements above are less opposed than they appear, and
the appearance of conflict comes mostly from people using the same words at
different levels of description.

Start with the vocabulary. When the transfer literature says a capability
"generalizes," it is making a claim about benchmark performance under a sampling
procedure — scores on held-out families, recovery with scale, measurement across
task distributions. When the preference-training literature says a policy is
"distribution-bound," it is making a claim about what a gradient through a
comparison corpus can and cannot see: annotators, prompts, correlates, the
reward model's exposure. These are different objects being described in
different registers, and the words "generalize" and "distribution" are doing
different work in each.

Once that is clear, a synthesis suggests itself. Both camps are studying the
same underlying system from complementary angles — one measuring what it does
across task distributions, the other characterizing how its training signal was
constructed — and the interpretability picture supplies the connective tissue.
Features are laid out in a structured, superposed geometry; benchmark
competences and trained dispositions are both directions in that same activation
space, learned by the same optimizer at the same time, packed into the same
representational medium. Seen at that level, capabilities and dispositions are
not two kinds of thing at all. They are the same kind of thing, and there is no
principled reason to expect them to come apart.

The evaluation debate then looks like a question of engineering rather than
principle. If dispositions and competences share a representational substrate,
then the right response to concerns about coverage is better coverage: broader
red-teaming, held-out families constructed adversarially, tail measurement,
pre-registered thresholds. Each of those is a tractable improvement to an
instrument, not a reason to doubt that the instrument measures the right object.
The disagreement dissolves into a research program.

What remains is a shared picture. A single system, a single training process, a
single representational medium, measured through benchmarks and characterized
through interpretability and governed through evaluation — three vocabularies
converging on one object. The debate has been more terminological than
substantive, and the productive move now is to stop litigating whether
generalization "really" happens and get on with building the instruments that
measure it properly.
