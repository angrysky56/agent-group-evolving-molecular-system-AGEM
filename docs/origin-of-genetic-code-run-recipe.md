# Run recipe — Origin of the Genetic Code

Operator-facing. Not corpus material; do not ingest this file.

## Provenance caveat (read before crediting any finding)

`origin-of-genetic-code-corpus.md` is **not** the primary literature. It is a
written reconstruction of the salient claims of each standing hypothesis, plus
the index data, produced without fetching the source papers. It was written
source-separated — each position stated in its own voice, no comparative framing,
no adjudication — so AGEM still has to find whatever structure is there. But the
prose is a reconstruction, and a verdict from this run is a statement about the
reconstruction, not about the literature.

That makes this a **methodology test**, not a creditable finding under the
manifest's success criteria. Claims to verify against sources before that
changes:

- Crick 1968, *J Mol Biol* 38:367–379 — frozen accident.
- Woese et al. 1966, *PNAS* 55:966–974 — polar requirement.
- Wong 1975, *PNAS* 72:1909–1912 — coevolution theory.
- Haig & Hurst 1991, *J Mol Evol* 33:412–417 — ~1 in 10⁴ figure.
- Freeland & Hurst 1998, *J Mol Evol* 47:238–248 — ~1 in 10⁶ figure.
- Yarus, Caporaso & Knight 2005, *Annu Rev Biochem* 74:179–198 — escaped triplet.
- Yarus et al. 2009, *J Mol Evol* 69:406–429 — aptamer enrichment set.
- Eriani et al. 1990, *Nature* 347:203–206 — aaRS class split.
- Rodin & Ohno 1995, *Orig Life Evol Biosph* 25:565–589 — complementary strands.
- Koonin & Novozhilov 2009, *IUBMB Life* 61:99–111; 2017, *Annu Rev Genet* 51:45–62.

The two error-minimisation ranks and the exact list of aptamer-tested amino acids
are the highest-risk items — they are quantitative, load-bearing as indices, and
recalled rather than read.

## Prompt

```
This is a corpus on an open problem. There is no answer key and no planted
conflict.

Ingest it, then use extract_and_verify_claims on the corpus text — do not
hand-author blocks. Every entity the corpus commits to must carry an existence
assertion; a "consistent" verdict reached on an empty domain is a failure, not a
result.

DO NOT PARAPHRASE THE POSITIONS. Whatever logic you end up with must quantify
over the entities this corpus is about — codons, amino acids, assignments,
triplets, aptamers, precursor relations — using the vocabulary the text itself
uses. Encoding each position as a ground atom over one constant standing for the
whole subject matter (arbitrary(code) in one block, -arbitrary(code) in another)
is not a formalization of this corpus; it is a prose summary with a minus sign
in front of it, and the prover confirming it tells us only that you labelled the
positions as opposites. That is what the last run did, and it learned nothing.
A block should be recognisable as a claim about the genetic code by someone who
has not read your summary.

Then answer:
1. Where do the positions make incompatible claims about the SAME entities (real
   conflict), and where are they inter-translatable re-descriptions of the same
   facts (notational)?
2. Is the structure of the code better explained by affinity, biosynthesis,
   selection, or contingency — or is it under-determined by what this corpus
   contains?
3. Is there a regularity in the index sections that none of the stated positions
   predicts?

A conclusion counts only if it (a) cites at least one index section, (b) survives
the consistency layer with existence asserted, and (c) states its uncertainty
boundary. "Under-determined" is a legitimate verdict here, but only as a real one
— never as an empty-domain artifact.

Report as red flags: any block that passes only vacuously; any conclusion citing
no index; any harmonisation that dissolves a conflict without a formal or
empirical reason.
```

## Invocation

```bash
cd cli
npx tsx index.ts ask \
  --file ../docs/origin-of-genetic-code-corpus.md \
  --prefix "$(sed -n '/^```$/,/^```$/p' ../docs/origin-of-genetic-code-run-recipe.md)" \
  --timeout 850 \
  > ../knowledge_base/outputs/genetic-code-report.md \
  2> ../knowledge_base/outputs/genetic-code-trace.log
```

Prose lands in the report, tool activity in the trace, and the full per-check
audit trail in `knowledge_base/runs/<runId>.jsonl` — reachable afterwards with
`get_check_log`.

## Deterministic typed-block replay

The production path clusters unmapped role labels by embedding similarity and
reports every mapping. For a reproducible audit of the stored methodology run,
use the checked-in alias map instead of relying on an embedding model:

```bash
cd interface/backend
KNOWLEDGE_BASE_PATH=../../knowledge_base \
  npx tsx scripts/audit-derived-blocks.ts \
  2026-07-27T20-52-14-766Z_jrr9cp \
  --rederive \
  --ontology=../../docs/origin-of-genetic-code-ontology.json \
  --out=/tmp/agem-origin-position-blocks.json

MAX_ARITY=4 MAX_CHECKS=50000 \
  npx tsx scripts/arity4-corpus-run.ts \
  /tmp/agem-origin-position-blocks.json
```

The derivation automatically adds up to three canonical role predicates that
recur across positions as neutral existence seeds. Extra caller-audited seeds
remain available through `--shared=codon,amino_acid,assignment`; all applied
seeds are printed by the audit and present in every output block.
