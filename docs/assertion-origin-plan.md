# Assertion Origin — who is speaking

> **Status: proposal, not implemented.** Written 2026-07-30 after two live runs
> aborted on attribution. Requires review before any code changes: the schema
> bump invalidates typed-finding fingerprints.

## The gap

AGEM tracks the origin of an assertion at two layers and not at the third.

| Layer | Type | Distinguishes AGEM's own contribution? |
|---|---|---|
| Graph edges | `EdgeOrigin` — `corpus-cooccurrence`, `phrase`, `catalyst-proposal`, `vdw-proposal`, `accepted-discovery` | **Yes** |
| Artifacts | `ReasoningArtifactStatus` — `observation` → `discovery-candidate` → `typed-claim` → `verified-finding` | **Yes** |
| Claims | `ClaimScope` — `corpus` \| `position` | **No** |

`corpus` means *this document asserts it as fact*. `position` means *a named
holder inside the document asserts it*. Both presuppose an ingested external
document. There is no way to say **the author observed it**, **the reasoner
proposed it**, or **AGEM established it in an earlier run**.

The consequence is worst in the case with no external source at all. When AGEM
is thinking rather than reading, every claim it forms is agent-origin — and the
only scope available that will pass the attribution guard is `corpus`. The
system's own speculation is then recorded with the standing of an ingested
source. Nothing in the current schema prevents that.

## What the live runs showed

**`2026-07-30T19-27-27` (quantum-mind-genesis).** Segments 8 and 9 are the
survey speaking in its own voice — "the corpus notes the asymmetry". The
attribution guard correctly refused to flatten them into `corpus` scope, and
there was nowhere else to put them. Segment 20 carries "Evolutionary theory
holds that a trait is selected for only if causally responsible": a real named
holder that the glossary pass never minted, because that pass builds a
vocabulary of *concepts*, not of *speakers*.

Three repair proposals were generated. All three had zero candidates, because
`attributionCandidates` can only propose a holder the segment text already
names. The route was closed before it opened.

## Proposed taxonomy

Replace the binary `ClaimScope` with an origin, mirroring the discipline
`EdgeOrigin` already applies one layer down.

| Origin | Meaning |
|---|---|
| `source-corpus` | The ingested document asserts this in its own voice, as fact |
| `source-position` | A named holder inside the document asserts it (Orch-OR, evolutionary theory) |
| `source-narrator` | The document's author, speaking as themselves — a survey's own observations |
| `agent-reasoning` | The reasoner's assertion in this session. Not from any source |
| `agem-finding` | A stored, verified finding from AGEM's own earlier run |

## Epistemic privileges

The taxonomy is worthless without different privileges attached. This table is
the actual proposal; the labels are just how it is addressed.

| Origin | May enter the prover | May be stored as a typed claim | Satisfies `verify`/`derive` | Contradiction means |
|---|---|---|---|---|
| `source-corpus` | Yes | Yes | Yes | Corpus contradiction |
| `source-position` | Yes | Yes | Yes | Positions incompatible — *not* a corpus contradiction |
| `source-narrator` | Yes | Yes | Yes | Narrator vs. a surveyed position is **not** a corpus contradiction. A survey may accurately report a view it argues against |
| `agent-reasoning` | **No** — never as a premise | **Never** | **Never** | n/a — quarantined |
| `agem-finding` | Only if `semanticsValidated` | As background, tagged | **No** — a prior verdict is not this corpus's verdict | Cross-run conflict, already handled by `conflictEvidence` |

Two rows carry most of the weight:

**`source-narrator` fixes the survey case.** A survey that reports a position
and then disagrees with it is not self-contradictory, and today it looks that
way or it fails extraction. This row is the whole reason segments 8 and 9 had
nowhere to go.

**`agent-reasoning` is the quarantine.** The prohibition on hand-authored logic
becoming corpus evidence currently lives in prose — in `run-termination.ts`'s
instruction, in `finding-capture.ts`'s refusal of every tool but the typed path.
Prose is enforced by whoever reads it. As an origin it becomes structural: the
formalizer refuses it as a premise and the store refuses it outright, in the
same way `EdgeOrigin` already keeps a `catalyst-proposal` edge from being
mistaken for a corpus co-occurrence.

## The pre-pass change

The existing glossary pass already reasons over the document before extraction —
it builds the closed vocabulary. Extend it to also census the **voices**:

1. Enumerate holders the text names ("Orch-OR", "evolutionary theory", "Tegmark").
2. Identify the narrator — the document's own voice — as a first-class holder.
3. Emit both as glossary entities, so `positionId` has something to bind to.

This is a widening of a pass that already exists, and it stays inside the closed
vocabulary discipline: pass two still cannot mint a holder pass one did not
find.

## What must NOT be generated

**Claim kinds stay closed.** The pre-pass must not propose new `ClaimKind`
values. The closed glossary exists so pass two cannot invent labels; letting
pass zero invent kinds moves the freedom up a level rather than removing it.
`ROLE_SPEC` maps kind → roles → FOL, so an invented kind has no formalizer and
cannot reach the prover regardless.

There is a worked failure already on record: the QM run put `wavefunction-status`
— a category heading, not a predicate — into the vocabulary, and the apparent
Consistent Histories contradiction was the invalid pair
`wavefunction_status(entity_consistent_histories)` and its negation. Not a
corpus finding. Generated structure manufactured it.

A relation the schema cannot express is not a schema gap to fill. It is the
signal that the material is evidential rather than formal, which is what
`build_defensible_claim` is for.

## Known defect in the abductive engine under this model

`abduce_best_explanation` takes `background` as bare formulas with no origin.
Under this proposal that is unsound: AGEM's own prior findings could be passed
as background, and the engine would report a hypothesis as cohering with "the
corpus" when it actually coheres with AGEM's earlier conclusions. Background
must carry origin, and `agent-reasoning` must be refused there as it is
everywhere else. This is a bug in code written today, not a hypothetical.

## Migration cost — stated honestly

- `CLAIM_SCHEMA_VERSION` bumps. It is part of `verificationDependencies`, so
  **every existing typed finding becomes `revalidation-required`.** They are not
  deleted, and history is kept, but they leave active recall until re-derived.
- `schema/claims.tql` needs a `redefine` migration. TypeDB 3.x `define` is
  add-only and fails DEX15 on a changed annotation — see
  `scripts/widen-finding-method-typedb.ts`, which hit exactly this.
- `classifyClaimVerdict` gains a narrator case. `ClaimVerdictKind` may need a
  `narrator-dissents` value distinct from `positions-incompatible`.
- The attribution guard's `ATTRIBUTED_ASSERTION_CUE` logic needs narrator cues
  ("the corpus notes", "we observe", "this paper argues").

## Smallest version that tests the idea

If the full migration is too much to take on at once: add **`source-narrator`
only**, as a `positionId` convention rather than a new scope value — mint the
narrator as a glossary entity in the pre-pass and attribute its observations to
it with the existing `scope: "position"`. No schema bump, no finding
invalidation, and it resolves both attribution failures from the
quantum-mind-genesis run. It does not solve the no-external-source case, which
needs `agent-reasoning` to be real.
