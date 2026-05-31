# Test Corpus: Interpretations of Quantum Mechanics

> **Purpose.** A diagnostic corpus for the two-level sheaf cohomology redesign.
> It is engineered to exhibit *surface agreement with deep conflict*: every
> passage shares dense vocabulary (wavefunction, measurement, state, collapse,
> observer, probability, reality, superposition) so concept centroids sit close
> together and sheaf edges form — but the interpretive passages commit to flatly
> incompatible positions, so their strong-level (PCA) subspaces should conflict
> around cycles and drive H¹ > 0.
>
> **Built-in control.** Passages 1–8 are the conflicting interpretations.
> Passages 9–10 are genuine consensus (shared formalism, shared predictions).
> A correctly working sheaf should show obstruction concentrated among the
> interpretive passages while the consensus passages glue cleanly. H¹ firing
> *everywhere* — or *nowhere* — both indicate a problem.
>
> **What to watch:** `sheaf_energy` (should go > 0), `h1Dimension` /
> `hasObstruction` (should fire), `gap_count` and `agent_count` (should become
> nonzero for the first time — this also exercises the previously-untested
> obstruction-handler and agent-spawning paths).

---

## Copenhagen

The wavefunction is not a physical object inhabiting the world; it is a
computational device that encodes the probabilities of measurement outcomes.
Before measurement, a quantum system has no definite value for an observable —
the question of where the particle "really is" between observations is
meaningless. Measurement is special: it triggers the collapse of the
wavefunction from a superposition into a single definite state, and this collapse
is real, irreversible, and lies outside the unitary Schrödinger evolution. There
is a fundamental cut between the quantum system and the classical measuring
apparatus, which must be described in ordinary classical language. Complementary
properties such as position and momentum cannot be simultaneously well-defined;
the experimental arrangement determines which aspect of reality manifests. The
observer's choice of what to measure is therefore constitutive of the outcome.
Probability here is irreducible and objective: nature itself is indeterministic,
and the state vector exhausts what can be said about a system.

## Many-Worlds

The wavefunction is the complete and real description of physical reality, and it
evolves only and always according to the Schrödinger equation. There is no
collapse — collapse is an illusion. What we call a measurement is simply an
interaction that entangles the observer with the system, branching the universal
wavefunction into decoherent components, each containing a copy of the observer
who sees a definite outcome. Every possible outcome of a measurement actually
occurs, each in its own branch; nothing is selected and nothing is destroyed. The
theory is therefore strictly deterministic: the global state evolves with perfect
predictability, and the appearance of probability arises only from
self-location — an observer's uncertainty about which branch they inhabit. The
observer plays no special role; there is no quantum-classical cut and no
privileged measurement process. Reality is the vast, unitarily evolving,
ever-branching superposition, and the definite world of experience is a parochial
slice of it.

## Bohmian Mechanics

Particles always have definite positions, at every instant, whether or not anyone
is measuring them. The wavefunction is real, but it is not the whole story: it is
a guiding field that determines, through the guidance equation, how the
configuration of particles evolves. The theory is fully deterministic — given the
initial positions and the wavefunction, the entire future trajectory is fixed.
There is no collapse and no special role for the observer or for measurement; a
measurement is just an ordinary physical interaction governed by the same laws as
everything else. The apparent randomness of quantum outcomes reflects our
ignorance of the actual initial positions, distributed according to the squared
amplitude of the wavefunction. The cost is explicit nonlocality: the guiding
field depends instantaneously on the configuration of all particles, however far
apart. Superposition is a property of the wavefunction, never of the particles
themselves, which are always somewhere definite.

## QBism

A quantum state is not a feature of the external world at all; it is an agent's
personal catalogue of degrees of belief about the consequences of their own
actions. The wavefunction represents the expectations of the one who assigns it,
and different agents may rightly assign different states to the same system.
Probability is Bayesian and subjective: the Born rule is a normative addition to
standard probability theory, advising an agent how to align their gambles.
Measurement is an action an agent takes on the world, and its outcome is a fresh
experience for that agent; the consequent updating of the wavefunction is nothing
more than Bayesian belief revision — there is no objective physical collapse
happening out there. The observer is not incidental but central, because the
entire formalism is first-personal. Quantum mechanics does not describe reality
directly; it is a user's manual for acting under uncertainty, and questions about
what the system is "really doing" between measurements fall outside its scope.

## Objective Collapse

Collapse is a real, physical, observer-independent process, and the Schrödinger
equation is only approximately true. The correct dynamics adds spontaneous,
random localization events to the unitary evolution: a wavefunction spread over
many positions undergoes occasional sudden jumps that concentrate it, with a rate
calibrated so microscopic systems almost never collapse while macroscopic ones do
so almost instantly. This dissolves the measurement problem without invoking
observers at all — definite outcomes occur because collapse is built into the law
of nature, not because someone looks. In some versions the trigger is
gravitational: the superposition of substantially different mass distributions is
intrinsically unstable and decays on a timescale set by the gravitational
self-energy of the difference. The wavefunction is real and collapse is real, but
collapse is a stochastic dynamical effect, a genuine modification of physics that
is in principle experimentally testable against standard quantum mechanics.

## Relational Quantum Mechanics

There is no absolute, observer-independent state of a system. A quantum state is
always relative to a particular observer or physical system with which the system
in question has interacted. Values of observables are not intrinsic properties but
are actualized only in the interaction between two systems, and they hold only
relative to that second system. Consequently a system can be in a superposition
relative to one observer while simultaneously possessing a definite value relative
to another — both descriptions are correct, each in its own relational frame, and
there is no privileged frame that adjudicates between them. Collapse is not a
physical process but the updating of the relation when an interaction occurs. The
observer carries no special status and need not be conscious or classical; any
physical system serves equally well as the system relative to which states are
defined. The wavefunction does not describe the world absolutely; it describes how
one system would find another upon interacting.

## Consistent Histories

Quantum mechanics is a theory of the probabilities of histories — sequences of
properties of a system at successive times — and not a theory about measurements
or observers. One selects a framework of mutually exclusive, exhaustive histories,
and provided the framework satisfies the consistency conditions that suppress
quantum interference between its members, ordinary probabilities can be assigned
to the histories within it. There is no collapse; the formalism speaks only of
probabilities of sequences. The observer plays no fundamental role and the
quantum-classical cut disappears, since measurement is just one kind of physical
interaction describable as a history. A central and uncomfortable feature is that
many incompatible frameworks exist, each internally consistent, and the theory
does not single one out; statements about a system are meaningful only once a
framework is fixed. Reality, on this view, is not a single narrative but a choice
of consistent narrative within which probabilistic claims become well-defined.

## Statistical Ensemble

The wavefunction does not describe an individual system at all; it describes an
ensemble of similarly prepared systems. Statements about probability are
statements about relative frequencies across this ensemble, and asking what a
single electron is "really doing" is asking the formalism for something it was
never meant to provide. Because the wavefunction refers only to ensembles, there
is no need for collapse: nothing physical changes in an individual upon
measurement, since the formalism made no claim about the individual to begin with.
The measurement problem is therefore dissolved by modesty rather than solved by
new mechanics. The observer has no special role; the apparatus is just another
physical system, and a measurement merely selects a subensemble. This
interpretation is deliberately minimal and agnostic — it declines to assert that
the wavefunction is real, declines to assert that it is mere knowledge, and
refuses to populate the world between measurements with definite or indefinite
properties.

## Shared Formalism (consensus)

Every interpretation employs the identical mathematical machinery, and on the math
there is no dispute. A physical system is associated with a Hilbert space; its
state is a unit vector, or more generally a density operator, within that space.
Observables correspond to self-adjoint operators, whose eigenvalues are the
possible measured values and whose eigenvectors form bases for expansion. Between
measurements the state evolves by the unitary group generated by the Hamiltonian
through the Schrödinger equation, a linear and deterministic evolution of the
vector. The Born rule supplies the numbers: the probability of an outcome is the
squared magnitude of the corresponding amplitude. Composite systems are described
by tensor products, giving rise to entangled states that cannot be factored.
Whatever one believes about reality, collapse, or observers, these structures —
Hilbert space, operators, unitary evolution, the Born rule, tensor products — are
common ground, used in exactly the same way to generate exactly the same numbers.

## Shared Predictions (consensus)

The interpretations are, for all practical purposes, empirically equivalent: they
predict the same outcomes for every experiment yet performed. In the double-slit
experiment all agree that an interference pattern builds up from individual
detections and vanishes when which-path information is available. For entangled
pairs all predict the correlations that violate Bell inequalities, ruling out
local hidden variables, and all agree no usable signal travels faster than light.
All reproduce atomic spectra, tunneling rates, and the statistics of photon
counting to the same precision, because all compute with the same Born rule
applied to the same evolved state. The disputes among them concern what is
happening beneath the predictions — whether the wavefunction is real, whether
collapse occurs, whether the observer matters — not what the predictions are.
Where a proposed interpretation does make a different prediction, as some
objective-collapse models do, that is precisely where it ceases to be mere
interpretation and becomes testable physics.
