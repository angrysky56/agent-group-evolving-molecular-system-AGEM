#!/usr/bin/env python3
"""
sheaf_real_embeddings.py — does genuine semantic conflict twist AGEM's sheaf?

This replicates AGEM's REAL buildSheafFromRegistry + computeCohomology math
(read directly from ComposeRootModule.ts and CoboundaryOperator.ts) but feeds
it REAL embeddings from the same Ollama model AGEM uses (embeddinggemma:latest),
instead of the hash-random MockEmbedder that makes semantic tests meaningless.

Question: the M3 run showed H1=0, but it had only ONE subgraph (one vertex,
no edges) so H1=0 was trivial. Here we build MULTIPLE subgraphs holding
conflicting positions and ask whether real conceptual conflict produces a
holonomy twist (H1 behaviour) in the actual construction.

Replicated faithfully from source:
  - getConceptSubspace(id, k=3): mean-center the subgraph's embeddings,
    truncated SVD, top-k right singular vectors; adaptive rank k_eff=N-1
    when N<=k; 1-D fallback when rank<=0.
  - conceptSimilarity: cosine of L2-normalized centroids.
  - edge rule: each vertex connects to its top-2 neighbors with sim>=0.4.
  - edge stalk dim m = min(k_A, k_B); shared basis E = top-m right singular
    vectors of stacked [P_A; P_B]; sign-aligned to P_A[0].
  - restriction maps: source[r,c]=dot(P_A[c],E[r]);
    target[r,c]=dot(P_B[c],E[r]) * weight, weight=clamp(sim,-1,1).
  - coboundary B: -source block on u's columns, +target block on v's columns.
  - H0 = N0 - rank(B); H1 = N1 - rank(B); tolerance = max_sv*max(N0,N1)*eps.
"""

import json
import urllib.request
import numpy as np

OLLAMA = "http://localhost:11434/api/embeddings"
MODEL = "embeddinggemma:latest"
EPS = np.finfo(np.float64).eps


def embed(text: str) -> np.ndarray:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": MODEL, "prompt": text}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        v = np.array(json.load(r)["embedding"], dtype=np.float64)
    return v


def centroid(embs: np.ndarray) -> np.ndarray:
    """L2-normalized mean (weak level)."""
    m = embs.mean(axis=0)
    n = np.linalg.norm(m)
    return m / n if n > 0 else m


def concept_subspace(embs: np.ndarray, k: int = 3) -> np.ndarray:
    """Strong level: top-k principal directions of mean-centered cloud.
    Adaptive rank: k_eff = min(k, N-1). Returns (k_eff, dim) array.
    Mirrors getConceptSubspace + the verified adaptive-rank ladder."""
    N = embs.shape[0]
    if N == 1:
        v = embs[0]
        n = np.linalg.norm(v)
        return (v / n if n > 0 else v).reshape(1, -1)
    centered = embs - embs.mean(axis=0)
    k_eff = min(k, N - 1)
    # SVD of centered cloud; right singular vectors = principal directions.
    _, _, Vt = np.linalg.svd(centered, full_matrices=False)
    if k_eff <= 0:
        return centroid(embs).reshape(1, -1)
    return Vt[:k_eff]  # (k_eff, dim), each row unit-norm


def cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def build_sheaf_and_cohomology(subgraphs: dict[str, list[str]], k: int = 3):
    """subgraphs: name -> list of texts. Returns dict of results."""
    names = list(subgraphs.keys())
    embs = {n: np.array([embed(t) for t in subgraphs[n]]) for n in names}
    dim = next(iter(embs.values())).shape[1]
    cents = {n: centroid(embs[n]) for n in names}
    subs = {n: concept_subspace(embs[n], k) for n in names}  # (k_eff, dim)

    # Vertex stalk dims and offsets
    vorder = names
    vdim = {n: subs[n].shape[0] for n in names}
    voff, acc = {}, 0
    for n in vorder:
        voff[n] = acc
        acc += vdim[n]
    N0 = acc

    # Edges: top-2 neighbors with sim>=0.4 (replicates source)
    added = set()
    edges = []
    for a in names:
        nbrs = sorted(
            [(b, cos(cents[a], cents[b])) for b in names if b != a],
            key=lambda x: -x[1],
        )
        nbrs = [(b, s) for b, s in nbrs if s >= 0.4][:2]
        for b, sim in nbrs:
            s1, s2 = (a, b) if a < b else (b, a)
            eid = f"e-{s1}-{s2}"
            if eid in added:
                continue
            added.add(eid)
            P_A, P_B = subs[s1], subs[s2]
            kA, kB = P_A.shape[0], P_B.shape[0]
            m = min(kA, kB)
            stacked = np.vstack([P_A, P_B])
            _, _, Vt = np.linalg.svd(stacked, full_matrices=False)
            E = Vt[:m].copy()  # (m, dim)
            # sign-align each E[r] to P_A[0]
            for r in range(m):
                if np.dot(P_A[0], E[r]) < 0:
                    E[r] = -E[r]
            weight = max(-1.0, min(1.0, sim))
            src = np.zeros((m, kA))
            tgt = np.zeros((m, kB))
            for r in range(m):
                for c in range(kA):
                    src[r, c] = np.dot(P_A[c], E[r])
                for c in range(kB):
                    tgt[r, c] = np.dot(P_B[c], E[r]) * weight
            edges.append((s1, s2, m, src, tgt))

    # Edge offsets
    eoff, acc = {}, 0
    for (s1, s2, m, _, _) in edges:
        eoff[(s1, s2)] = acc
        acc += m
    N1 = acc

    # Build coboundary B (N1 x N0): -src on u block, +tgt on v block
    B = np.zeros((N1, N0))
    for (s1, s2, m, src, tgt) in edges:
        er = eoff[(s1, s2)]
        B[er:er + m, voff[s1]:voff[s1] + src.shape[1]] = -src
        B[er:er + m, voff[s2]:voff[s2] + tgt.shape[1]] = tgt

    if N1 == 0:
        return dict(N0=N0, N1=0, rank=0, h0=N0, h1=0, has_obstruction=False,
                    edges=0, vdims=vdim,
                    sims={f"{a}|{b}": round(cos(cents[a], cents[b]), 3)
                          for i, a in enumerate(names) for b in names[i+1:]})

    sv = np.linalg.svd(B, compute_uv=False)
    tol = (sv.max() * max(N0, N1) * EPS) if sv.size else 0.0
    rank = int((sv > tol).sum())
    return dict(
        N0=N0, N1=N1, rank=rank, h0=N0 - rank, h1=N1 - rank,
        has_obstruction=(N1 - rank) > 0, edges=len(edges), vdims=vdim,
        sims={f"{a}|{b}": round(cos(cents[a], cents[b]), 3)
              for i, a in enumerate(names) for b in names[i+1:]},
    )


def show(title, res):
    print(f"\n=== {title} ===")
    print(f"  vertices (stalk dims): {res['vdims']}")
    print(f"  edges:                 {res['edges']}")
    print(f"  N0={res['N0']}  N1={res['N1']}  rank={res['rank']}")
    print(f"  H0 (consensus):        {res['h0']}")
    print(f"  H1 (obstruction):      {res['h1']}")
    print(f"  hasObstruction:        {res['has_obstruction']}")
    print(f"  centroid cosine sims:")
    for k, v in res["sims"].items():
        print(f"      {k}: {v}")
