# AGEM — Engineering Handoff

Written for an agent with no prior context on this repo. Every number below was
measured, not estimated; the command that produced it is given so you can
re-measure rather than trust.

---

## 0. Orientation — read before touching anything

**Build gotcha.** `interface/backend/package.json` maps `#agem/*` to
`agent-group-evolving-molecular-system/dist/*`. Editing anything under the ROOT
`src/` has no effect until you run `npm run build` in the repo root. `tsx watch`
on the backend does NOT rebuild it. Symptom: your change appears to do nothing.

**Two separate typecheck/test surfaces:**

```bash
npm run typecheck                        # root engine (src/)
cd interface/backend && npm run typecheck && npm test
cd interface/frontend && npx tsc --noEmit # no "typecheck" script exists
```

**The test suite must never write `.env`.** It used to: `config.test.ts` called
`settings.update({ EMBEDDING_PROVIDER: "ollama" })` and `update()` persists to
the real project-root `.env`. Every `npm test` silently reverted the developer's
provider. Fixed in `config.ts#persistToEnv` (early-return under `VITEST` /
`NODE_ENV=test`) and pinned by `config-persist.test.ts`. **Do not remove that
guard.** If you add a config test, assert in-memory state, never file state.

**Config precedence.** `dotenvConfig(..., { override: true })` — the `.env` file
beats an inherited shell environment, deliberately. The settings UI writes
`.env`, so the file is the source of truth. A stale exported var previously
outranked the UI with no indication anywhere.

**Long tool calls.** Chat responses send an SSE keepalive comment every 15s
(`chat.ts`). Without it, undici aborts the response body at 300s and the client
dies mid-run while the server completes normally — producing a truncated report
with no error in it.

---

## 1. PRIORITY 1 — The typed-claim path cannot find contradictions

This is the main work. Everything else is smaller.

### 1.1 What a block is

`LogicalBlock { name: string; propositions: string[] }`
(`interface/backend/src/services/logicalCohomology.ts`)

A block is one vertex in the consistency complex. A **frustration** is a minimal
set of blocks that cannot all be true together — that is the product of the
whole system. The search tests every subset up to `LOGIC_MAX_ARITY`, delegating
each satisfiability check to mcp-logic (Prover9/Mace4) as an external process.

### 1.2 How blocks are formed today

`claim-extractor.ts → deriveClaimBlocks() → claimToPropositions()` emits one
block per assertion context (the corpus or an attributed position):

```
causal(stereochemical-affinity -/->assignment)
    all x (stereochemical_affinity(x) -> -causes_assignment(x))
    exists x (stereochemical_affinity(x))
```

Pipeline: corpus text → closed corpus vocabulary proposal → typed claims forced
onto that vocabulary (kind + named roles, schema-validated into TypeDB) → one
block per assertion context → subset search. Any claim that cannot map is
reported instead of minting a surface-derived symbol.

### 1.3 The defect, measured

```bash
cd interface/backend
KNOWLEDGE_BASE_PATH=../../knowledge_base \
  npx tsx scripts/audit-derived-blocks.ts 2026-07-27T20-52-14-766Z_jrr9cp
```

```
derived blocks:                          48
introducing their own witness:        48/48
sharing a subject with any other:     13/48
CANNOT contradict anything:           35/48
```

Every block asserts `exists x (its_own_subject(x))`, and each subject predicate
is minted from that claim's own role label. Blocks therefore populate private,
disjoint domains: the prover satisfies them by choosing different witnesses.
**35 of 48 blocks could not contradict anything at any arity.** That run's
verdict — "no contradiction up to arity 3", 18,520 checks — was largely
guaranteed by the encoding rather than discovered.

`analyzeFormalization` now flags this as a critical `disjoint_predicates`
warning, so the condition is detected. It is not yet *prevented*.

### 1.4 Compounding problem: block count

Block count = claim count (48 and 65 in the two real runs). Subsets to arity 4:

| blocks | subsets | at ~26 ms/check |
|--------|---------|-----------------|
| 5      | 30      | 0.0 min |
| 10     | 385     | 0.2 min |
| 20     | 6,195   | 2.7 min |
| 48     | 213,052 | 92 min |
| 65     | 722,865 | 313 min |

`LOGIC_MAX_CHECKS` defaults to 50,000, so arity 4 is unreachable and runs return
`inconclusive`. **Do not "fix" this by raising the budget** — that converts an
honest inconclusive into a 92-minute tool call reaching the same place. Reduce
block count instead. 48 → 10 blocks is a ~500× reduction in prover calls, far
better than any per-check speedup.

Note this is unrelated to FINGER. FINGER makes von Neumann entropy on the TNA
co-occurrence graph O(n+m) instead of O(n³) — that is graph math, and it is why
large graphs are feasible. The consistency search is `C(n,k)` external prover
processes; no entropy approximation touches it.

### 1.5 What to build

**(a) Canonicalise predicate symbols onto a shared vocabulary.**

`docs/origin-of-genetic-code-corpus-manifest.md` already specifies the intended
shape: a neutral shared ontology (`codon(x)`, `amino_acid(x)`,
`assignment(c, a)`, …) that all extracted blocks quantify over. The extractor
ignores it and mints a new predicate per role label. Two positions arguing about
the same thing must resolve to the **same symbol** or they cannot meet.

Suggested approach — decide for yourself, but justify it:
- accept an optional caller-supplied ontology (alias → canonical symbol);
- cluster role labels by embedding similarity, then map each cluster to one
  canonical symbol, preferring a supplied alias when one matches;
- record the mapping in the tool result so a reader can audit what was merged.

Hard requirement: merging must be **reported, not silent**. A canonicalisation
that quietly identifies two distinct concepts manufactures contradictions, which
is worse than missing them.

**(b) Group claims into position-level blocks.**

One block per *position*, not per claim — keyed on the concept communities the
graph already produces (`get_graph_topology`), which is what the manifest
assumes. A block then holds all formulas for that position.

**Acceptance criteria:**

1. `audit-derived-blocks.ts` on a re-run of the genetic-code corpus reports
   **0 blocks that cannot contradict anything** (or names why any remain).
2. Derived block count lands in the 5–20 range for that corpus.
3. `analyzeFormalization` emits no critical warning on the derived blocks.
4. The search completes to arity 4 within the default 50,000-check budget.
5. `docs/logic-corpus/logic-h1-test-corpus.md` still passes: section A′ gives
   H¹ = 1 with the right frustrated triple. Grouping must not destroy a real
   frustration.

---

## 2. PRIORITY 2 — Findings can hold contradictory conclusions undetected

`knowledge_base/findings/index.json` currently holds, about the same corpus:

- `060d33ac`, `2780f5fa` — `hand-authored` / **contradiction** (5 minimal sets)
- run-4 findings — `derived-from-claims` / **inconclusive** (no contradiction)

No conflict candidate is raised. `finding-store.ts` requires **exact shared
supporting-claim keys** plus opposite conclusive outcomes, and the two methods
produce different key spaces by construction — hand-authored keys are
`fol:<sha256>` of formula text, typed keys are claim keys. So the method known
to be unreliable can never be flagged as superseded by the method that isn't.

The hand-authored contradictions are now believed to be artifacts of paraphrase
(see §5). They are still in memory, still recallable, and still assert the
opposite of the better-founded result.

**Work:** design cross-method conflict detection. Options include corpus-id
overlap plus opposite outcome, or projecting both methods onto a shared claim
identity. Do not weaken the existing exact-overlap rule for same-method
conflicts — it exists so embedding resemblance never manufactures a conflict.

---

## 3. PRIORITY 3 — Frontend chat history does not append until reload

The backend is correct: the final assistant message is persisted to
`knowledge_base/sessions/<id>.json` (verified — a 7,120-char message was on disk
while the UI showed nothing). The view does not append on the `done` SSE event;
the message appears only after a reload.

Start at the chat store's SSE handling in `interface/frontend/src`.

---

## 4. Smaller items

**4.1 `check_well_formed` cannot see cross-formula defects.** Verified against
the live mcp-logic server: it returns `valid: true` for both
`exists x (biosynthetic_precursor(x))` and
`exists x (biosynthetic_precursor(glutamate, glutamine))`. Together they are
invalid — Prover9 requires consistent arity — and the whole block is rejected
with the unhelpful message "Syntax error or invalid input". A real run asked the
validator, was told the logic was fine, and retried the identical block three
times before the block was dropped from the search.

AGEM now catches this locally (`inconsistent_arity`). The upstream fix belongs
in mcp-logic: validate the statement SET, not each statement in isolation.

**4.2 Extraction produced junk predicates (closed vocabulary plus axis guard implemented).** Seen in real output:
`all x (this(x) -> contiguous_codon_domains(x))` — a pronoun promoted to a
predicate — and `causes_makes_the_comparison_quantitative(x)`. Pass one now
resolves coreference over the whole corpus; pass two can use only its closed
labels. Any escaped label is deterministically rejected, and unmappable claims
are surfaced as an inconclusive extraction rather than silently accepted.

The QM run `2026-07-29T18-38-25-991Z_ajovtf` exposed two follow-on defects. The
model flattened required roles beside an empty `roles` object and emitted
position scope as `{positionId: ...}`; the normalizer now repairs that envelope
mechanically. More importantly, pass one put category headings such as
`wavefunction-status` in the predicate vocabulary. Glossary entries now type
categorical or signed-property axes, and metadata-only axis labels are forbidden
in claim roles. The apparent Consistent Histories contradiction was exactly the
invalid pair `wavefunction_status(entity_consistent_histories)` and its
negation—not a corpus finding.

That run did make 7 logic-engine checks (2 internal checks and 5 core probes),
despite its incomplete extraction. Incomplete extraction now aborts before
cohomology with `proverCalls: 0`; a propose-only repair loop can rank bounded
same-segment candidates through `mcp-logic.abductive_explain`, but never applies
them. Joint no-go statements such as “no position can hold all of A, B, C” are
also rejected rather than falsely split into three pairwise exclusions. The
current binary claim schema still needs an n-ary joint-incompatibility relation
before the QM `mustFind` contract can pass.

**4.3 Output token cap is not exposed in the UI.** `OPENROUTER_MAX_TOKENS` is
now 32768 in `.env` (was a hardcoded-feeling 16384 default). The configured
model advertises 393,216 completion tokens against a 1,048,576 context, so there
is a lot of headroom. `ANTHROPIC_MAX_TOKENS` was previously hardcoded to 8192 in
`AnthropicProvider` with no override; it is now config. Neither is editable from
the settings panel.

**4.4 Revisit `LOGIC_MAX_ARITY` / `LOGIC_MAX_CHECKS` after §1.** Current
defaults are 6 and 50,000. Once block counts are sane these are probably
generous; do not tune them before the grouping work, or you will be tuning
against the wrong distribution.

---

## 5. Do not regress — fixed this session, each with a pinning test

| Area | What was wrong | Test |
|---|---|---|
| Tool payload | `evaluate_logical_consistency` returned 1,799,602 chars (~450k tokens); 99.7% was `checkLog` re-serialising 51 unique formulas into 1.24 MB. Now digest + signal-carrying entries only, ~11 KB. | `checkLogProjection.test.ts` |
| Audit trail | Full check log moved to a `logic_check_log` event in the run JSONL, retrievable via the `get_check_log` tool. | `check-log-reader.test.ts` |
| Workflow contract | `verify` was satisfied by hand-authored FOL and its hint named that tool by name, steering away from the typed path. New `derive` requirement, suppressed when the claim store is down. | `workflow-contract-derive.test.ts` |
| Finding recall | Findings were indexed on `verdict` (prover register). "let's continue our work on the origin of the genetic code" scored 0.199 against a 0.4 floor — *below* "let's talk about sourdough baking" at 0.208. Now keyed on `topicKey`. | `topic-key.test.ts` |
| Embedding failure | Cues over ~12k chars made ollama return HTTP 500; `ProviderEmbedder` fell back to a hash vector, so recall silently returned nothing. Cue now bounded. | — (see `MAX_CUE_CHARS`) |
| TypeDB schema | Live DB held `created-at value datetime` from an older `findings.tql`; the current file says `datetime-tz`, so every startup define aborted with DEX14 and took the **entire claim store offline**. `extract_and_verify_claims` had never once run. | `scripts/fix-created-at-typedb.ts` |
| `.env` clobbering | `config.test.ts` rewrote the real `.env` on every test run. | `config-persist.test.ts` |
| Frontend config | Settings store persisted its own defaults to localStorage and never hydrated from the server, so the panel could show Ollama while the server ran OpenRouter — and the next click wrote that stale view to `.env`. | — (`hydrateFromServer`) |
| Embedding throughput | One HTTP round-trip per store entry. Now batched, chunked at 32. Measured 5.0× at 300 texts (33,002 ms → 6,638 ms). An earlier unbounded version sent the whole array as one request and stalled. | `scripts/bench-embed-batch.ts` |
| Formalization | `inconsistent_arity` and `disjoint_predicates` critical warnings. | `arity-warning.test.ts`, `disjoint-predicates.test.ts` |

**Two traps worth knowing before you edit `analyzeFormalization`:**

- `all x (p(x)` matches the regex `[a-z_]\w*\s*\(` at `x (` — the bound
  *variable* gets captured as a predicate. Strip
  `\b(all|exists)\s+[a-zA-Z_][\w]*` first.
- `disjoint_predicates` must NOT fire on `p(x)`, `p(x) -> q(x)`, `-q(x)`. Those
  share no subject either, yet are a genuine contradiction: the free variable
  ranges over a shared domain. The check is deliberately narrowed to blocks that
  introduce their **own** existential witness. My first version flagged the
  frustrated triple the engine is calibrated against.

---

## 6. Verification checklist

```bash
# engine + backend + frontend all clean
npm run typecheck
cd interface/backend && npm run typecheck && npm test   # 178 tests
cd ../frontend && npx tsc --noEmit

# .env survived the suite (this has regressed before)
md5sum .env    # compare before/after `npm test`

# embedding model reality check after any provider change
cd interface/backend
python3 scripts/probe-embedding-model.py <model>
python3 scripts/calibrate-recall-floor.py <model>   # the cosine floor is NOT portable
npx tsx scripts/bench-embed-batch.ts 300

# what a fresh process reads vs what the server believes
npx tsx scripts/show-effective-config.ts
curl -s localhost:8000/api/v1/system/config
```

**Embedding model changes invalidate stored vectors.** Dimensions differ
(embeddinggemma 768, nemotron 2048) and `cosine()` returns `-1` on mismatch — so
recall does not degrade, it switches off silently. After any change:

```bash
npx tsx scripts/reindex-finding-topics.ts --apply --force
```

And re-derive the floor: it is calibrated per model. For nemotron, should-hit
cues measured 0.220–0.545 and should-miss 0.002–0.040, giving
`FINDING_RECALL_SIMILARITY_FLOOR=0.13`. Carrying embeddinggemma's 0.4 across the
swap would have rejected almost every genuine hit.

---

## 7. Standing caveat on the genetic-code corpus

`docs/origin-of-genetic-code-corpus.md` is **not** primary literature. It is a
written reconstruction of each hypothesis, produced without fetching the source
papers, and it is a methodology fixture rather than evidence about biology. The
quantitative index values (error-minimisation ranks, the aptamer-tested amino
acid list) are recalled, not read, and are flagged in
`docs/origin-of-genetic-code-run-recipe.md` as the highest-risk items. Do not
let any conclusion drawn from it be reported as a claim about the literature.
