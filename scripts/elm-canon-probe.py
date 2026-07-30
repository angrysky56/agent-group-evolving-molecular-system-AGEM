"""Probe: can embedding cosine separate must-merge from must-not-merge predicates?

Pairs are REAL cases from AGEM run logs and corpora answer keys.
MERGE   = inflectional/morphological variants of one concept (safe to canonicalize)
KEEP    = lexically similar but semantically distinct (merging destroys the corpus)
"""

import json
import urllib.request
import math

OLLAMA = "http://localhost:11434/api/embed"
MODEL = "embeddinggemma:latest"

MERGE = [
    ("lesion_adequate", "lesion_adequacy"),
    ("newcomb_adequate", "newcomb_adequacy"),
    ("recommends_refraining", "recommending_refraining"),
    ("being_total_over_well_posed_problems", "total_over_well_posed_problems"),
    ("theory_that_holds_dominance", "theory_holding_dominance"),
    ("theory_that_holds_evidential_responsiveness", "theory_holding_evidential_responsiveness"),
    ("perception_like", "perception"),
    ("solving_easy_problems", "easy_problems"),
    ("mental_states", "mental"),
    ("broadcast", "global_broadcast"),
    ("zombie_inference", "zombie_argument"),
    ("noncomputable", "not_computable"),
]

KEEP = [
    ("rt22", "rt_n_k"),
    ("prediction_error", "precision"),
    ("multiple_realizability", "substrate_independence"),
    ("hard_problem", "easy_problems"),
    ("selection_for", "selection_of"),
    ("psi_ontic", "psi_epistemic"),
    ("higher_order_thought", "higher_order_perception"),
    ("locality", "nonlocality"),
    ("dominance", "evidential_responsiveness"),
    ("wkl0", "aca0"),
    ("newcomb_adequacy", "lesion_adequacy"),
    ("collapse_is_real", "collapse_is_not_real"),
]


def embed(texts: list[str]) -> list[list[float]]:
    req = urllib.request.Request(
        OLLAMA,
        data=json.dumps({"model": MODEL, "input": texts}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())["embeddings"]


def cos(a: list[float], b: list[float]) -> float:
    d = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return d / (na * nb)


def norm_morph(s: str) -> str:
    """Cheap deterministic morphological normalizer — no ML."""
    s = s.replace("-", "_").lower()
    parts = [p for p in s.split("_") if p not in ("being", "that", "the", "a")]
    out = []
    for p in parts:
        for suf, rep in (
            ("acy", "ate"), ("ility", "le"), ("iness", "y"),
            ("ing", ""), ("ness", ""), ("s", ""),
        ):
            if p.endswith(suf) and len(p) - len(suf) >= 4:
                p = p[: len(p) - len(suf)] + rep
                break
        out.append(p)
    return "_".join(sorted(out))


def main() -> None:
    vocab = sorted({w for pair in MERGE + KEEP for w in pair})
    vecs = dict(zip(vocab, embed([w.replace("_", " ") for w in vocab])))

    rows = []
    for label, pairs in (("MERGE", MERGE), ("KEEP", KEEP)):
        for a, b in pairs:
            rows.append((label, a, b, cos(vecs[a], vecs[b]),
                         norm_morph(a) == norm_morph(b)))

    print(f"{'want':6} {'cos':>6}  {'morph':5}  pair")
    print("-" * 78)
    for label, a, b, c, m in sorted(rows, key=lambda r: -r[3]):
        print(f"{label:6} {c:6.3f}  {str(m):5}  {a} | {b}")

    mc = [c for lab, _, _, c, _ in rows if lab == "MERGE"]
    kc = [c for lab, _, _, c, _ in rows if lab == "KEEP"]
    print("\n--- cosine separability ---")
    print(f"MERGE cos: min {min(mc):.3f}  max {max(mc):.3f}")
    print(f"KEEP  cos: min {min(kc):.3f}  max {max(kc):.3f}")
    print(f"OVERLAP: KEEP max ({max(kc):.3f}) >= MERGE min ({min(mc):.3f}) "
          f"-> {max(kc) >= min(mc)}")

    best_t, best_acc = None, -1.0
    for i in range(50, 100):
        t = i / 100
        acc = sum(
            (c >= t) == (lab == "MERGE") for lab, _, _, c, _ in rows
        ) / len(rows)
        if acc > best_acc:
            best_acc, best_t = acc, t
    print(f"best single cosine threshold: {best_t:.2f} -> acc {best_acc:.1%}")

    morph_acc = sum(
        m == (lab == "MERGE") for lab, _, _, _, m in rows
    ) / len(rows)
    print(f"deterministic morphology     -> acc {morph_acc:.1%}")

    fp = [(a, b) for lab, a, b, _, m in rows if m and lab == "KEEP"]
    fn = [(a, b) for lab, a, b, _, m in rows if not m and lab == "MERGE"]
    print(f"morphology false merges (dangerous): {fp}")
    print(f"morphology missed merges (safe):     {fn}")


if __name__ == "__main__":
    main()
