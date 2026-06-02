#!/usr/bin/env python3
"""Minimal-pair probe: maximally opposed atomic content, minimal lexical overlap."""

from sheaf_real_embeddings import build_sheaf_and_cohomology, show

# Each "subgraph" is a single atomic concept repeated as near-synonyms so the
# PCA has a tiny bit of spread but the centroid is a sharp point in concept space.

# D — color opposition (red vs blue vs green). Atomic, low lexical overlap.
colors = {
    "red":   ["red", "the color red", "crimson scarlet red"],
    "blue":  ["blue", "the color blue", "azure cobalt blue"],
    "green": ["green", "the color green", "emerald jade green"],
}

# E — numeric truth vs falsehood. "1=2" is the canonical contradiction.
numbers = {
    "one_eq_one": ["one equals one", "1 = 1", "a number equals itself"],
    "one_eq_two": ["one equals two", "1 = 2", "one is the same as two"],
    "two_eq_three": ["two equals three", "2 = 3", "two is the same as three"],
}

# F — direct boolean negation, single token apart.
truth = {
    "true":  ["true", "this statement is true", "it is the case"],
    "false": ["false", "this statement is false", "it is not the case"],
    "unknown": ["unknown", "this statement is undetermined", "it is uncertain"],
}

# G — antonym triangle (hot/cold/warm) — opposition along one axis.
temp = {
    "hot":  ["hot", "extremely hot", "burning hot"],
    "cold": ["cold", "extremely cold", "freezing cold"],
    "warm": ["warm", "mildly warm", "pleasantly warm"],
}

if __name__ == "__main__":
    print("Minimal-pair probe — atomic opposition, real embeddings")
    print("=" * 64)
    show("D: colors (red/blue/green)", build_sheaf_and_cohomology(colors))
    show("E: numbers (1=1 / 1=2 / 2=3)", build_sheaf_and_cohomology(numbers))
    show("F: boolean (true/false/unknown)", build_sheaf_and_cohomology(truth))
    show("G: temperature (hot/cold/warm)", build_sheaf_and_cohomology(temp))
