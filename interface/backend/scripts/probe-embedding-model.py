"""Probe an embedding model before adopting it.

Three things decide whether a model can replace the current one, and none of
them can be read off a model card:

  1. Does the provider actually serve it on /embeddings at all?
  2. What dimension does it return? A change invalidates every stored vector.
  3. Where does it actually stop accepting input? The advertised context is a
     token count; what matters here is the character length at which the call
     starts failing, because a failure degrades silently to a hash vector.

    python3 scripts/probe-embedding-model.py [model ...]
"""

import json
import math
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV = Path(__file__).resolve().parents[3] / ".env"
MODELS = sys.argv[1:] or ["nvidia/nemotron-3-embed-1b:free"]


def api_key() -> str:
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    for line in ENV.read_text().splitlines():
        if line.startswith("OPENROUTER_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("No OPENROUTER_API_KEY found.")


KEY = api_key()


def embed(model: str, text: str) -> list[float]:
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/embeddings",
        data=json.dumps({"model": model, "input": text}).encode(),
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


def main() -> None:
    for model in MODELS:
        print(f"\n=== {model}")
        try:
            base = embed(model, "the origin of the genetic code")
        except urllib.error.HTTPError as error:
            print(f"  UNAVAILABLE: HTTP {error.code} {error.read()[:300]!r}")
            continue
        except Exception as error:  # noqa: BLE001
            print(f"  UNAVAILABLE: {error}")
            continue
        print(f"  dimension: {len(base)}")

        # Does it separate a relevant cue from an irrelevant one at all?
        pairs = [
            ("origin of the genetic code", "codon amino acid assignment"),
            ("origin of the genetic code", "sourdough bread baking"),
        ]
        for left, right in pairs:
            print(f"  cos({left[:28]!r}, {right[:26]!r}) = "
                  f"{cosine(embed(model, left), embed(model, right)):.3f}")

        # Where does it actually stop accepting input?
        print("  max input:")
        last_ok = 0
        for chars in (8_000, 16_000, 32_000, 64_000, 128_000):
            try:
                embed(model, "codon amino acid assignment. " * (chars // 29))
                print(f"    {chars:>7,} chars  ok")
                last_ok = chars
            except Exception as error:  # noqa: BLE001
                code = getattr(error, "code", "?")
                print(f"    {chars:>7,} chars  FAILED (HTTP {code})")
                break
        print(f"  -> safe cue bound: {last_ok:,} chars")


if __name__ == "__main__":
    main()
