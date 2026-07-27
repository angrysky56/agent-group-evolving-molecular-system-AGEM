"""Calibrate FINDING_RECALL_SIMILARITY_FLOOR for a given embedding model.

A cosine floor is not portable between models. Each model has its own scale:
what counts as "clearly related" for one sits below the other's threshold.
Carrying 0.4 across a model swap silently turns recall off (or, worse, on for
everything). So the floor is measured, not inherited.

Method: embed the real stored topic keys, embed cues that SHOULD hit and cues
that should NOT, and report the gap. A usable floor sits inside that gap with
margin on both sides.

    python3 scripts/calibrate-recall-floor.py <provider-model>
"""

import json
import math
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INDEX = ROOT / "knowledge_base" / "findings" / "index.json"
MODEL = sys.argv[1] if len(sys.argv) > 1 else "nvidia/nemotron-3-embed-1b:free"


def api_key() -> str:
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("No OPENROUTER_API_KEY found.")


KEY = api_key()


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/embeddings",
        data=json.dumps({"model": MODEL, "input": text}).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)["data"][0]["embedding"]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


# (cue, id-prefix it should match, or None if it should match nothing)
CASES = [
    ("Let's continue our work on the origin of the genetic code.", "060d33ac"),
    ("origin of the genetic code", "060d33ac"),
    ("What did we conclude about the genetic code last time?", "060d33ac"),
    ("genetic code codon amino acid assignment", "060d33ac"),
    ("Continue the philosophy of mind work.", "4dc82584"),
    ("phenomenal versus access consciousness", "4dc82584"),
    ("Let's talk about sourdough baking.", None),
    ("How do I rotate a PDF on the command line?", None),
    ("quarterly revenue forecast for the sales team", None),
]


def main() -> None:
    raw = json.loads(INDEX.read_text())
    findings = raw.get("findings", raw) if isinstance(raw, dict) else raw
    keys = {
        f["id"][:8]: embed(f.get("topicKey") or f["verdict"]) for f in findings
    }
    print(f"model: {MODEL}\nkeys embedded: {len(keys)}\n")

    hits: list[float] = []
    misses: list[float] = []
    print(f"{'best':>6} {'target':>8}  verdict   cue")
    for cue, expected in CASES:
        vector = embed(cue)
        scored = sorted(
            ((cosine(vector, v), k) for k, v in keys.items()), reverse=True
        )
        best, best_id = scored[0]
        if expected is None:
            misses.append(best)
            ok = "should miss"
        else:
            # Score against the intended target, not merely the best.
            best = cosine(vector, keys[expected])
            hits.append(best)
            ok = "should hit " + ("" if best_id == expected else f"(top={best_id})")
        print(f"{best:>6.3f} {str(expected):>8}  {ok:<12} {cue[:44]}")

    lo_hit, hi_miss = min(hits), max(misses)
    print(f"\nlowest  SHOULD-HIT : {lo_hit:.3f}")
    print(f"highest SHOULD-MISS: {hi_miss:.3f}")
    if lo_hit <= hi_miss:
        print("\nNO SEPARATION — no floor can divide these. Do not adopt.")
        return
    floor = round((lo_hit + hi_miss) / 2, 2)
    print(f"gap: {lo_hit - hi_miss:.3f}")
    print(f"\nsuggested FINDING_RECALL_SIMILARITY_FLOOR = {floor}")


if __name__ == "__main__":
    main()
