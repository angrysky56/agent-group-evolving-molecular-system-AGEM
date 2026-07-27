"""Measure whether a short natural-language opener triggers finding recall.

Findings are embedded on their VERDICT text (finding-store.ts:184) and a run's
cue is embedded raw with no task prefix (finding-store.ts:250), so this
reproduces the real comparison exactly rather than approximating it.

    python3 scripts/measure-recall-cues.py [floor]
"""

import json
import math
import sys
import urllib.request
from pathlib import Path

FLOOR = float(sys.argv[1]) if len(sys.argv) > 1 else 0.4
TOP_K = 3
ROOT = Path(__file__).resolve().parents[3]
INDEX = ROOT / "knowledge_base" / "findings" / "index.json"


def load_findings() -> list[dict]:
    raw = json.loads(INDEX.read_text())
    if isinstance(raw, dict):
        raw = raw.get("findings", raw)
    if isinstance(raw, dict):
        raw = list(raw.values())
    return [f for f in raw if isinstance(f, dict) and "embedding" in f]


def embed(text: str) -> list[float]:
    req = urllib.request.Request(
        "http://localhost:11434/api/embeddings",
        data=json.dumps(
            {"model": "embeddinggemma:latest", "prompt": text}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req))["embedding"]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


CUES = [
    "Let's continue our work on the origin of the genetic code.",
    "Let's continue our work on the origin of the genetic code, think about "
    "this in connection with error minimisation.",
    "origin of the genetic code",
    "What did we conclude about the genetic code last time?",
    "genetic code codon amino acid assignment",
    "Continue the philosophy of mind work.",
    "Let's talk about sourdough baking.",
]


def main() -> None:
    findings = load_findings()
    print(f"{len(findings)} stored findings (embedded on verdict text):")
    for f in findings:
        print(
            f"  {f['id'][:8]}  {f.get('method',''):16s} "
            f"{f.get('outcome',''):14s} {f['verdict'][:64]}..."
        )

    print(f"\nfloor={FLOOR}  top_k={TOP_K}")
    print(f"{'best':>6}  {'result':<12}  cue")
    for cue in CUES:
        vector = embed(cue)
        sims = sorted(
            (
                (cosine(vector, f["embedding"]), f["id"][:8], f.get("corpusId", ""))
                for f in findings
            ),
            reverse=True,
        )
        over = [s for s in sims if s[0] >= FLOOR][:TOP_K]
        verdict = f"recalls {len(over)}" if over else "NO RECALL"
        print(f"  {sims[0][0]:.3f}  {verdict:<12}  {cue[:70]}")
        if over:
            for score, fid, corpus in over:
                print(f"          {score:.3f}  {fid}  {corpus[:44]}")


if __name__ == "__main__":
    main()
