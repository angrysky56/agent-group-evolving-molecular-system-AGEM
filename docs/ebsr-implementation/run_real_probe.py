#!/usr/bin/env python3
"""Driver for sheaf_real_embeddings — three corpora, real Ollama embeddings."""

from sheaf_real_embeddings import build_sheaf_and_cohomology, show

# CORPUS A — empirically-equivalent QM interpretations (low conflict expected).
# They share vocabulary and predictions; disagreement is interpretive, not
# contradictory. Prediction: edges form (high sim), but no holonomy twist.
qm = {
    "copenhagen": [
        "The wavefunction encodes probabilities of measurement outcomes, not a real object.",
        "Measurement causes a real collapse from superposition to a definite state.",
        "Between observations a system has no definite value for an observable.",
    ],
    "many_worlds": [
        "The wavefunction is real and always evolves unitarily; collapse never happens.",
        "Every measurement outcome occurs, each in its own branch of the universe.",
        "Apparent probability is just self-location uncertainty across branches.",
    ],
    "bohmian": [
        "Particles always have definite positions guided by a real pilot wave.",
        "The theory is deterministic; randomness reflects ignorance of initial positions.",
        "There is no collapse and no special role for measurement.",
    ],
}

# CORPUS B — direct contradictions (flat negations on shared propositions).
# Each pair asserts P and not-P about the same subject. Prediction: this is
# the real test of whether negation-conflict twists the sheaf.
contra = {
    "collapse_real": [
        "Wavefunction collapse is a real physical process that actually occurs.",
        "Collapse is objective, observer-independent, and irreversible.",
        "The state genuinely changes when a measurement happens.",
    ],
    "collapse_unreal": [
        "Wavefunction collapse never happens and is not a real process.",
        "Collapse is an illusion; evolution is always smooth and unitary.",
        "The state never genuinely changes; nothing physical collapses.",
    ],
    "collapse_subjective": [
        "Collapse is merely an observer updating personal beliefs, not physical.",
        "Nothing objective happens; only the agent's information changes.",
        "The state is knowledge, and updating it is Bayesian revision.",
    ],
}

# CORPUS C — engineered circular inconsistency (A says B-true, B says C-true,
# C says A-false). The closest natural analogue to a holonomy twist.
cyclic = {
    "claimA": [
        "Position B is entirely correct and should be accepted.",
        "Whatever B asserts about the matter is true.",
        "We endorse B's conclusion without reservation.",
    ],
    "claimB": [
        "Position C is entirely correct and should be accepted.",
        "Whatever C asserts about the matter is true.",
        "We endorse C's conclusion without reservation.",
    ],
    "claimC": [
        "Position A is entirely wrong and should be rejected.",
        "Whatever A asserts about the matter is false.",
        "We reject A's conclusion without reservation.",
    ],
}

if __name__ == "__main__":
    print("AGEM sheaf — REAL embeddings (embeddinggemma) — does conflict twist?")
    print("=" * 64)
    show("CORPUS A: QM interpretations (empirically equivalent)",
         build_sheaf_and_cohomology(qm))
    show("CORPUS B: direct contradictions (P vs not-P)",
         build_sheaf_and_cohomology(contra))
    show("CORPUS C: circular inconsistency (A->B->C->not-A)",
         build_sheaf_and_cohomology(cyclic))
    print("\n" + "=" * 64)
    print("Reading: H1>0 requires cycles in the subgraph graph AND the")
    print("right rank structure. Watch whether semantic conflict (B,C)")
    print("changes H1 vs mere interpretive difference (A). If all three")
    print("give the same H1, the sheaf is responding to TOPOLOGY (how many")
    print("edges/cycles form from similarity), NOT to conflict content.")
