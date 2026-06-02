#!/usr/bin/env python3
"""
consistency_homology.py — logic-based H^0 / H^1 for AGEM.

The geometric sheaf (CellularSheaf) cannot detect logical contradiction (see
docs §14): projections of real embeddings saturate the coboundary rank, so H^1
is always 0 regardless of content. This module computes a DIFFERENT object — the
homology of the CONSISTENCY COMPLEX — which is genuinely logic-based.

Construction:
  - vertices  = blocks that are INTERNALLY consistent (self-consistent).
  - 1-simplex (edge) {i,j}      present iff blocks i,j are JOINTLY consistent.
  - 2-simplex (triangle) {i,j,k} present iff blocks i,j,k are JOINTLY consistent.

Every "present?" decision is a satisfiability check delegated to mcp-logic
(Prover9/Mace4) — no geometry, no embeddings.

Meaning of the invariants:
  - H^0 = number of connected components of the pairwise-consistency graph
          (groups of blocks that cannot even pairwise reconcile split off).
  - H^1 = independent cycles of pairwise-consistent blocks that are NOT filled
          by joint (triple+) consistency. H^1 > 0 is the GENUINE obstruction:
          positions that are fine in every pair but impossible all together.
          This is exactly what pairwise checking alone CANNOT detect.

Blind-men-and-the-elephant (all pairwise AND jointly consistent) -> H^1 = 0.
Genuine frustration (pairwise consistent, jointly inconsistent)  -> H^1 > 0.
"""

from itertools import combinations
import numpy as np


def homology(
    vertices: list[str],
    consistent_pairs: set[frozenset],
    consistent_triples: set[frozenset],
) -> dict:
    """Compute H^0 and H^1 of the consistency complex.

    Args:
        vertices: internally-consistent block names (0-simplices).
        consistent_pairs: frozensets {i,j} that are jointly consistent (edges).
        consistent_triples: frozensets {i,j,k} jointly consistent (filled tris).

    Returns:
        dict with h0, h1, and the simplex counts / boundary ranks.
    """
    vidx = {v: i for i, v in enumerate(vertices)}
    edges = sorted(tuple(sorted(p)) for p in consistent_pairs)
    eidx = {e: i for i, e in enumerate(edges)}
    # A triangle only lives in the complex if all 3 of its edges are present
    # (downward closure). Joint consistency of a triple implies pairwise
    # consistency, so this is automatic — but we guard anyway.
    triangles = sorted(
        t for t in (tuple(sorted(tr)) for tr in consistent_triples)
        if all(frozenset(pair) in consistent_pairs
               for pair in combinations(t, 2))
    )

    n_v, n_e, n_t = len(vertices), len(edges), len(triangles)

    # Boundary matrix d1: C_1 -> C_0.  d1(edge (a,b)) = b - a   (a<b)
    d1 = np.zeros((n_v, n_e))
    for j, (a, b) in enumerate(edges):
        d1[vidx[a], j] -= 1.0
        d1[vidx[b], j] += 1.0

    # Boundary matrix d2: C_2 -> C_1.  d2(tri (a,b,c)) = (b,c) - (a,c) + (a,b)
    d2 = np.zeros((n_e, n_t))
    for j, (a, b, c) in enumerate(triangles):
        d2[eidx[(b, c)], j] += 1.0
        d2[eidx[(a, c)], j] -= 1.0
        d2[eidx[(a, b)], j] += 1.0

    rank_d1 = int(np.linalg.matrix_rank(d1)) if n_e and n_v else 0
    rank_d2 = int(np.linalg.matrix_rank(d2)) if n_t and n_e else 0

    h0 = n_v - rank_d1
    h1 = (n_e - rank_d1) - rank_d2

    return {
        "h0": h0,
        "h1": h1,
        "vertices": n_v,
        "edges": n_e,
        "filled_triangles": n_t,
        "rank_d1": rank_d1,
        "rank_d2": rank_d2,
        "has_obstruction": h1 > 0,
    }


def needed_checks(vertices: list[str], pairs_consistent: set[frozenset]) -> list:
    """Which triples need a joint-consistency check: only 3-cliques in the
    pairwise-consistency graph (others are auto-excluded by downward closure).
    Returns list of sorted 3-tuples to test with mcp-logic."""
    out = []
    for tri in combinations(sorted(vertices), 3):
        if all(frozenset(p) in pairs_consistent for p in combinations(tri, 2)):
            out.append(tri)
    return out
