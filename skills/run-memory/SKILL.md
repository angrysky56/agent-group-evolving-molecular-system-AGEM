---
name: "run-memory"
description: "Long-term memory across runs: check what you already concluded about a corpus before analysing it, and record a finding when a run produces something durable. Your concept graph is working memory and resets; this does not."
---

# Run memory — start where the last run stopped

> [!IMPORTANT]
> **Your concept graph is working memory.** It is rebuilt per run, holds
> co-occurrence rather than conclusions, and resets. Without long-term memory
> you re-derive what you already established — and re-derivation has produced
> *contradictory* answers on the same corpus.

## Before you analyse: recall

Ask whether this corpus has been analysed before, **before** running a cycle.

- A prior finding exists, same model → **cite it. Do not re-derive.**
- A prior finding exists, different model → treat as unverified. Cross-model
  recall of condensed memory is measurably weaker; re-check rather than repeat.
- A prior finding exists and you now disagree → record both and link
  `supersedes` with a reason. Never silently replace it.

> [!CAUTION]
> **Recalled memory is context, never an agenda.** `not-ruled-out` describes
> the *limits of the old finding* — it is not a task list, and it does not
> license you to resume work from an earlier run. Answer the question you were
> actually asked. If a prior gap is relevant to it, say so in one line and move
> on; if it is not, ignore it.
>
> A memory that pulls you back into someone else's unfinished problem is worse
> than no memory.

## After a run: decide whether anything durable happened

Most runs produce nothing worth keeping. Record a finding **only** if the run
produced a verdict that would change what a future run does: a contradiction
found or ruled out, a measurement, a defect located, a method shown to fail.

Exploration without a conclusion → store nothing. An empty memory is better
than a vague one.

## What a finding must carry

A verdict without these is not reusable. All copied **verbatim** from tool
output — never from your summary of it.

| Field | From |
|---|---|
| `verdict` | the tool's verdict string, word for word |
| `coverage` | blocks submitted vs evaluated, and why any were excluded |
| `not-ruled-out` | `truncationNote`, `capNote`, `searchTruncated` |
| `run-log-id` | `runLogId` in the tool result |
| `produced-by-model` | the model you are running as |
| `method` | `derived-from-claims` or `hand-authored` |
| `condensed-narrative` | optional; the ONLY field you may compress |

> [!WARNING]
> **Never store a verdict without its truncation caveat.** A future run reads
> it as settled. This is the most damaging error available to you.
>
> **Never condense the denominator.** "No contradictions found" becomes
> confident and wrong when 4 of 10 blocks never entered the search.

## Method matters, so record it

`extract_and_verify_claims` derives logic from typed claims: the negation in an
exclusion is emitted because the relation *is* an exclusion, so it cannot be
forgotten.

`evaluate_logical_consistency` takes propositions you write yourself. On one
corpus, hand-authored encodings produced three different answers across runs —
IIT/GWT contradictory, then consistent (the exclusion silently dropped), and a
Hard/Easy contradiction that the corpus never made.

A finding from `hand-authored` is weaker evidence than one from
`derived-from-claims`. Say which produced it, and prefer the typed path.

## Compressing the narrative

Only `condensed-narrative` may be compressed, and only the reasoning: branches
tried and dropped, tool sequencing, restated corpus prose. Target ~25–30% of
original length. It is payload, never a retrieval cue: recall embeds the
verbatim verdict even when a dense narrative exists.

Automatic densification is available only for `derived-from-claims`, because
accepted typed claims enumerate what must survive. Each bounded CoD-style pass
may use a BabelTele surface, but it must retain every self-describing schema
fact byte-for-byte and fit the token budget. Do not invent aliases, legends,
separators, or token meanings that require an external codebook. If any role,
polarity, modality, or direction is missing after the final pass, store no
condensed narrative; the verbatim finding still stands.

This is a checked heuristic, not lossless compression. Cross-model readers must
re-check before relying on the dense reasoning. Coverage, denominators,
truncation notes, and the verdict remain verbatim outside the payload.

## Reporting

When you cite memory, say so and say when it was formed. When you overturn a
prior finding, lead with that — a correction is more informative than a fresh
verdict, and the reader needs to know the earlier one is retired.
