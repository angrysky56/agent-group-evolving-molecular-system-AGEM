# Plan: functionalize AGEM

Read against `docs/RLM-LCM-Molecular-CoT-Group-Evolving-Agents.md`, the current
implementation, and the recorded run logs.

## Decision

AGEM has two different epistemic jobs:

1. **Discovery** expands a graph, identifies structural gaps, asks catalyst
   questions, and proposes weak or surprising connections.
2. **Verification** converts source-grounded claims into a closed formal
   vocabulary and returns scoped, reproducible logical results.

They may share infrastructure: the source corpus, immutable storage, providers,
telemetry, embeddings for retrieval, and the typed claim store. They must not
share **evidentiary semantics**. A community, cosine score, centrality value, or
sheaf statistic may guide discovery; none may establish a logical claim.

This is an artifact boundary rather than a prohibition on combined workflows.
A run may declare:

```text
intent: "discover" | "verify" | "discover-then-verify"
```

`discover-then-verify` is the backward-compatible default. Discovery produces
candidate hypotheses. Verification may promote a candidate only after fresh,
source-grounded typed extraction and formal checking. Discovery output never
silently becomes a verified claim.

Verification does not want similar concepts merged. It wants stable identities
and explicit, audited equivalences. Similar concepts remain distinct by default.

---

## Current baseline — do not rebuild it

Several capabilities described as missing in earlier notes already exist:

- `llm_map` exists as a tested worker-thread primitive, although its worker
  executor is still a deterministic stub and it is not the extraction runtime.
- Claim extraction already batches four segments per call and runs four batches
  concurrently with bounded sequential fallbacks.
- TypeDB stores verbatim source segments, and every stored claim must link to at
  least one source segment.
- Extraction first proposes a closed corpus-wide glossary, then either reuses it
  exactly or reports an unmappable claim.
- Deterministic morphology may normalize inflections. Embedding similarity is
  suggestion-only and never silently rewrites a predicate.
- Betweenness centrality and surprising-edge ratio are implemented. Their
  scheduling, provenance, reporting, and interpretation need repair.
- Typed verification groups claims by corpus assertion or attributed position,
  not by graph community. H¹ is not the logical verdict.
- Incomplete extraction now aborts before Prover9/Mace4 and reports
  `INCONCLUSIVE` with `proverCalls: 0`.
- Abductive extraction repairs are bounded, source-derived, `propose-only`, and
  `applied: false`, but their current oracle query does not validate that the
  proposed patch repairs the real failure.

The work below integrates, repairs, and validates these pieces. It does not
reimplement them under new names.

---

## Confirmed priority defects

### V1 — n-ary source semantics can still escape through the wrong claim kind

The current source guard catches a statement such as “No position can hold all
of A, B, C” only when the extractor emits an `exclusion`. The same source can
still be distributed into negative `property-assertion` or `entailment` claims.

Until the n-ary type exists, the guard must operate on the **source
construction**, independently of the model-selected claim kind. Any attempted
binary or unary decomposition makes extraction incomplete and stops before the
prover.

### D1 — gap detection caches its first result across graph mutations

`GapDetector.findGaps()` sets a private computed flag and has no invalidation
path. Once the first cycle caches `[]`, later ingestion and Louvain changes are
not observed. This is a confirmed reason the discovery loop can remain inert.

Invalidate gap results whenever graph topology or community assignments change.
Add a graph/community revision key so stale results are impossible by
construction, rather than relying on callers to remember a reset method.

### O1 — SOC scalars hide missing denominators and the wrong edge population

`surprisingEdgeRatio: 0` currently means either:

- eligible new edges existed and none were surprising, or
- no eligible edge existed at all.

The metric also observes new TNA co-occurrence edges, while the founding claim
concerns newly generated discovery connections. Report numerator, denominator,
edge origin, and an explicit `no-eligible-edges` status. Do not optimize toward
12%; treat it as an observed quantity, not a target.

### P1 — source pairing is complete in storage but incomplete in run output

TypeDB retains source text, and conclusive supporting evidence includes it, but
accepted, rejected, and unmappable extraction outcomes do not all carry an
auditable source pairing in the JSONL.

Log each source segment once in a deduplicated segment table. Every outcome must
reference its segment ID. Do not duplicate the full sentence under every claim,
and do not attempt to log hidden chain-of-thought; the lossless contract applies
to observable inputs, outputs, tool calls, and system events.

### R1 — the current abductive repair query proves a tautology

`proposeExtractionRepairs()` replaces every concrete patch with an opaque atom
such as `repair_0`, sets the observation to `failure_resolved`, and supplies
`repair_0 -> failure_resolved` as background knowledge. Every candidate therefore
explains the synthetic observation by construction. The resulting
`explainsFailure: true` does not mean that the patch repairs the extraction,
source-semantic, or vocabulary failure that produced it.

Repair selection must become counterfactual and validator-backed before adding
more elaborate abductive scoring. Until then, call these items unvalidated
repair candidates rather than explanations.

---

## Sheaf decision: retain provisionally, constrain its meaning

The embedding-derived registry sheaf has not demonstrated value as a logical
obstruction detector. That interpretation is retired now. The implementation is
not deleted yet because it may still have a functional discovery role:

- describing overlap and cycle structure among registered subgraphs;
- coordinating where exploratory agents should inspect;
- summarizing the subject of a subgraph through concept vectors/subspaces; and
- supplying a discovery-side signal whose incremental value can be measured.

Rules while it is retained:

1. Sheaf/cohomology values are discovery diagnostics only.
2. They never determine contradiction, entailment, consistency, claim identity,
   or whether a finding is stored.
3. UI and logs call the value `registry cycle topology`, not “logical
   obstruction”.
4. Gap detection and catalyst dispatch must work without a sheaf event.
5. VdW spawning is driven by persistent, source-grounded structural gaps and a
   bounded exploration budget, not by H¹.

After discovery is functional, run the small A/B described below. Keep the
sheaf only if it predicts productive gap exploration beyond simpler graph
signals such as density, modularity delta, centrality, and edge provenance. If
it adds no incremental value, then remove `ADMMSolver`, `CellularSheaf`,
`CoboundaryOperator`, `CohomologyAnalyzer`, `SheafLaplacian`, registry-sheaf
construction, and their state/UI dependencies in a separately scoped cleanup.

---

## Hypergraph and abductive-reasoning decisions

### Use a claim hypergraph, but do not add a second storage system

The typed claim model is already hypergraph-shaped: a claim is a typed hyperedge
whose role players are concepts, positions, and source segments. Make that shape
explicit through a lossless incidence view:

- one stable claim node per typed claim;
- role-labelled incidence links from the claim to every participant;
- full claim kind, scope, attribution, polarity, and provenance on the claim;
  and
- no clique expansion of an n-ary claim into pairwise logical edges.

Ordinary graph algorithms may consume a clearly labelled projection for
discovery diagnostics. Verification must consume the typed hyperedge or its
incidence representation, never the projection. In particular, a
`joint-incompatibility(A, B, C)` edge cannot become three pairwise exclusions.
TypeDB remains the authoritative store; the first implementation is an adapter
and round-trip contract, not a new hypergraph database or library.

### Use abduction for bounded proposals, not for manufacturing evidence

An abducible is a closed, typed operation such as selecting an existing glossary
term, restoring a source-supported role value, or adding explicit attribution.
Do not generate arbitrary predicates or facts. Each candidate must carry its
source span, preconditions, patch, expected validator effect, and edit cost.

Apply candidates only to an isolated copy and rerun the exact validator that
raised the failure. A candidate becomes `counterfactually-validated` only when
the target failure clears and no new critical or incomplete result appears. It
remains `applied: false` in the real corpus until explicitly accepted. Once this
works, counter-abduction may compare a small number of rival valid repairs; it
must not substitute narrative plausibility for source support.

### Treat discourse structure as soft proposal-ordering metadata

Keep these axes separate:

```text
discourse role != evidential support != epistemic status != logical validity
```

RST nuclearity describes communicative prominence. A satellite can contain the
decisive condition, exception, provenance qualifier, or counterexample. AGEM
therefore preserves and verifies every extracted EDU regardless of discourse
weight. Discourse metadata may only order discovery or repair candidates after
source, schema, and logical constraints have passed.

Do not adopt `sum((1 - weight) * penalty)` as AGEM's objective: it makes a
nucleus-derived assumption free at weight 1. Use lexicographic selection instead:

1. satisfy the source and typed-schema constraints;
2. clear the observed validator failure without introducing a new one;
3. maximize exact source coverage;
4. minimize the number and complexity of abducibles/edits; and
5. use discourse compatibility only as a bounded tie-breaker.

Do not hard-prune to an RST tree. A bounded off-tree fallback preserves recall,
and newer discourse work explicitly represents concurrent and tree-breaking
relations. If no discourse analysis is available, the baseline ordering remains
valid.

Evidence caution: the supplied 21%, 19% to 7%, and 1.00 s to 0.79 s figures are
not results for discourse-weighted ALP alone. In the reported ablation, pure
discourse abduction is 12% / 0.88 s / 13% defeated hypotheses, information-gain
abduction is 18% / 0.82 s / 7%, and information-gain plus counter-abduction is
21% / 0.79 s / 6%. These numbers first appeared in a December 2025 preprint and
the work was published in *Entropy* in February 2026; they still describe a
different hallucination-detection pipeline and are not AGEM acceptance targets.
See <https://www.mdpi.com/1099-4300/28/2/173>, the earlier version at
<https://www.preprints.org/manuscript/202512.0598>, and the graph-based eRST
model at <https://aclanthology.org/2025.cl-1.3/>.

---

## Ordered implementation plan

### Phase 0 — restore trustworthy instrumentation and fail-closed behavior

These tasks are independent and may proceed in parallel.

#### 0.1 Add a reproducible run manifest

For every measurement used to justify this plan, record:

- exact JSONL run ID and relevant event;
- git commit;
- provider, model, prompt/schema version, and extraction settings;
- corpus hash and segmentation version; and
- whether the result came from current code or historical code.

The historical “60% disagreement” remains a reason to measure the current
extractor. It is not treated as the current extractor’s error rate or as proof
that one cause explains every formalization defect.

#### 0.2 Complete source/outcome provenance

Add a deduplicated `sourceSegments` table to extraction output and JSONL. Every
accepted, rejected, parse-failed, and unmappable outcome references a segment
ID. Preserve the existing TypeDB `claim -> source segment` link.

Acceptance:

- every extraction outcome resolves to exact source text;
- repeated source text is stored once per run;
- corpus and segment hashes make replay identity explicit; and
- truncation or redaction is reported, never silent.

#### 0.3 Close the n-ary unary-distribution escape

Detect n-ary no-go language before interpreting proposed claims. With the
current binary schema, the only valid extraction result for that segment is one
unmappable item and zero claims.

Acceptance:

- pairwise exclusions, unary negative properties, and chained binary
  entailments from the same n-ary source are all rejected;
- incomplete extraction returns `preflightStage: "extraction"` and
  `proverCalls: 0`; and
- the current decision-theory universal rule is not falsely rejected as an
  n-ary no-go.

#### 0.4 Make gap detection revision-aware

Cache gaps only under a key containing the graph topology revision and Louvain
assignment revision. Recompute on mismatch.

Acceptance:

- an empty first-cycle result does not survive a topology mutation;
- repeated reads without mutation reuse the cache;
- community reassignment invalidates the cache even when node/edge counts are
  unchanged; and
- reset/rehydration cannot restore a cache under the wrong revision.

#### 0.5 Make SOC telemetry non-vacuous

Return, for each iteration:

- `eligibleNewEdgeCount`;
- `surprisingEdgeCount`;
- `surprisingEdgeRatio: number | null`;
- `surprisingEdgeStatus: "measured" | "no-eligible-edges"`; and
- counts grouped by edge origin.

Do the same for regime classification: below the configured minimum history and
growth, report `insufficient-history`, not a mature-sounding stable regime.

#### 0.6 Make repair validation counterfactual and honest

Replace the synthetic `repair_i -> failure_resolved` query with this bounded
procedure:

1. deterministically order source-derived candidates by edit count, exact label
   reuse, and source-span distance;
2. apply each candidate to an isolated copy and rerun the exact failed
   extraction validator;
3. reject any candidate that leaves the target failure, reduces source coverage,
   or introduces a new critical/incomplete result; and
4. report the before/after validator evidence for each surviving candidate.

An abductive oracle may rank multiple candidates only when given their real
typed consequences and integrity constraints. Opaque candidate IDs and a
tautological background are insufficient.

Acceptance:

- the original extraction context is byte-for-byte unchanged;
- `explainsFailure` is retired or remains false unless counterfactual validation
  succeeds;
- an unavailable, malformed, or ambiguous oracle produces `unresolved`, not a
  default selection;
- the candidate and validator budgets have exact termination bounds; and
- every returned proposal remains `mode: "propose-only"` and `applied: false`.

### Phase 1 — implement n-ary joint incompatibility end to end

This is a cross-surface feature, not a one-file schema edit. Use
`skills/typeql/SKILL.md`; TypeDB 2.x syntax is not acceptable.

#### 1.1 Extend the TypeDB 3.x schema

The intended additive shape is:

```typeql
relation joint-incompatibility sub claim,
  relates incompatible @card(2..);

entity concept,
  plays joint-incompatibility:incompatible;
```

The inherited `claim:source` role retains mandatory provenance. `claim-scope`
and attribution retain the distinction between a corpus constraint and a
position’s commitment.

Validate the schema by loading `schema/claims.tql` into a scratch database using
a schema transaction and committing it. Add contract probes showing:

- two or more distinct incompatible concepts commit successfully;
- a missing source fails at commit;
- fewer than two incompatible role players fail at commit; and
- ordinary existing claims still commit.

Use a sourced query file for probes; do not pass raw TypeQL as a console command.
`typeql-check` is optional developer convenience only: it previously failed to
install in this environment and is not a dependency or acceptance gate. The
authoritative validation is a successful scratch TypeDB schema commit followed
by commit-time positive and negative contract probes against the running TypeDB
version.

#### 1.2 Extend the typed extraction contract

Update every affected surface:

- `ClaimKind` and role/cardinality validation;
- closed-glossary prompts and parsers;
- source semantic validation;
- TypeQL persistence and stable claim identity;
- offline re-derivation/audit scripts;
- finding evidence and conflict comparison; and
- frontend/backend result types where the kind is enumerated.

One n-ary source emits one `joint-incompatibility` claim containing the complete
set. It must never be expanded into pairwise exclusions.

#### 1.3 Define one canonical formal semantics

Convert a set `{A, B, C}` into the universal statement that no subject can
satisfy all members simultaneously. Preserve the whole member set in the claim
key and in any minimal core.

Verify the generated formula against actual `mcp-logic`/Mace4 behavior. Include
tests proving:

- every proper subset can be satisfiable while the full set is forbidden;
- no individual member is forced false;
- role order does not change claim identity; and
- arity is preserved through storage, retrieval, conversion, and proof logging.

#### 1.4 Replay all six quantum no-go constraints

Cover Bell, Kochen–Specker, PBR, Frauchiger–Renner, Leggett–Garg, and Brukner.
Restart the backend and reload the TypeDB schema before the live replay.

Success requires full source coverage, `semanticsValidated: true`, no unary or
pairwise decomposition, and a proof/model result whose scope is explicit. A
locally passing parser test is not corpus verification.

#### 1.5 Expose a lossless claim-incidence hypergraph

Add an internal adapter from typed claims to a role-labelled incidence graph and
back. It must represent binary and n-ary claims uniformly without changing
their semantics or stable IDs.

Acceptance:

- typed claim -> incidence view -> typed claim is identity-preserving;
- repeated roles and n-ary cardinality survive the round trip;
- participant order does not change claim identity;
- every incidence edge resolves to the original claim and source provenance;
  and
- pairwise/clique projections are marked `diagnostic-only` and are rejected as
  verifier input.

### Phase 2 — make the discovery/verification contract explicit

#### 2.1 Add run intent and artifact types

Add `intent` to run configuration and JSONL. Define artifact states:

```text
observation -> discovery-candidate -> typed-claim -> verified-finding
```

Each promotion records the producer, source references, transformation, and
validation status. No implicit promotion is allowed.

Track repair artifacts separately:

```text
repair-candidate -> counterfactually-validated-repair -> accepted-patch
```

The first two states are always `applied: false`. Acceptance is an explicit
operation and triggers a fresh extraction/verification run rather than mutating
an already reported result.

#### 2.2 Separate tool and output contracts

For `discover`:

- expose graph, gap, catalyst, registry-topology, and retrieval tools;
- label outputs as hypotheses/candidates;
- do not emit logical verdict language.

For `verify`:

- accept raw corpus text, audited ontology, or already-audited formulas;
- derive assertion contexts only from corpus scope or named holders;
- do not consume community IDs, cosine scores, centrality, or sheaf values as
  logical evidence; and
- preserve current fail-closed finalization.

For `discover-then-verify`, discovery candidates must re-enter through the same
typed extraction boundary as any other source material.

#### 2.3 Make mixed-mode reporting impossible

Every headline result states:

- run intent;
- artifact status;
- corpus/evidence scope;
- coverage and unmappable counts;
- whether a formal certificate exists; and
- whether the claim is a discovery proposal or verified finding.

#### 2.4 Add a lightweight revalidation ledger

Do not add a full assumption-based truth-maintenance system. Existing
`evidences` and `supersedes` relations already provide the useful core: exact
support sets and append-only correction. Extend them with a verification
fingerprint over:

- corpus and segmentation hashes;
- supporting claim IDs and normalized claim keys;
- glossary/ontology and extraction-schema versions;
- source-semantic validator version; and
- formalizer, prover, and relevant solver settings.

When a semantic dependency changes, mark the finding `revalidation-required`
and exclude it from ordinary active recall. Preserve it as historical evidence;
do not silently delete or supersede it. A fresh successful verification creates
a new finding and an explicit relationship to the older one.

Acceptance:

- unchanged dependencies retain the same verification fingerprint;
- changing any semantic dependency makes the old finding ineligible as current
  evidence and names the changed dependency;
- presentation-only configuration changes do not invalidate findings;
- recall may show stale findings only when clearly labelled historical; and
- revalidation is bounded and explicit, never triggered as an unbounded cascade.

### Phase 3 — measure and improve current extractor consistency

Do not begin with blanket `k=5` sampling.

#### 3.1 Establish a current-version baseline

Use a frozen commit, provider/model, prompt version, glossary, corpus hash, and
segmentation. Run three small answer-keyed corpora three times each. Measure:

- exact normalized claim-set agreement per segment;
- kind, role, scope, polarity, and omission disagreement;
- unmappable disagreement;
- must-find recall, must-not-find violations, and vacuity;
- cost, latency, truncation, and provider failure rate.

Historical cross-version outputs are reported separately.

#### 3.2 Add adaptive self-consistency only where it helps

If the baseline shows material within-version disagreement:

1. sample `k=3` only for unstable or high-risk segments;
2. compare schema-normalized claim sets, including missing claims;
3. require a defined quorum for the complete typed structure;
4. take two additional samples only when `k=3` has no quorum; and
5. mark unresolved segments unmappable/inconclusive.

Majority agreement does not override a schema or source-semantic rejection.
Report both raw disagreement and the post-quorum result.

Use the existing bounded provider concurrency unless a benchmark demonstrates
that a production `llm_map` executor improves throughput without losing request
deadlines, provider configuration, cancellation, or telemetry. Worker threads
are not presumed useful for network-bound calls.

### Phase 4 — make discovery produce auditable work

#### 4.1 Test gaps with discriminating fixtures

Use three deterministic fixtures:

1. two communities with sparse cross-links — a gap must be detected;
2. two disconnected communities — no gap under the current definition; and
3. two densely connected communities — no gap.

Then use two related but distinct source corpora with a small shared vocabulary.
Two completely unrelated corpora are not a valid first test because the current
gap definition intentionally excludes zero-density pairs.

#### 4.2 Expose useful centrality, not just community summaries

Return the top central nodes with scores, their communities, trend, and
calculation revision. Compute on demand after mutation or according to the
existing schedule; do not recalculate expensively merely because state was
read.

#### 4.3 Track generated edges separately

Give every edge an origin such as:

```text
corpus-cooccurrence | phrase | catalyst-proposal | vdw-proposal | accepted-discovery
```

The surprising-edge health measure uses eligible discovery-origin edges, not
ordinary word-window co-occurrence. Every proposed edge carries a rationale,
source/candidate provenance, creator, and verification status.

Synthetic placeholders such as `vdw-bridge-*` do not count as discoveries.

#### 4.4 Turn catalyst questions into bounded proposals

When a persistent gap is detected:

1. generate a catalyst question;
2. perform a bounded exploration using available corpus/retrieval context;
3. return proposed nodes/edges with rationale and provenance;
4. leave them `propose-only` until accepted; and
5. if accepted for verification, route them through typed extraction.

No gap may trigger an unbounded retry or recursive agent cascade.

#### 4.5 Evaluate the sheaf’s incremental discovery value

On the same saved graph states, rank exploration targets using:

- graph-only signals; and
- graph signals plus registry cycle topology.

Use 10–20 deterministic replayed cycles and judge whether the sheaf improves:

- recovery of known held-out bridges;
- useful catalyst-question ranking;
- stability under harmless embedding perturbation; and
- cost per additional useful proposal.

Keep it if it adds repeatable value. Otherwise execute the separately scoped
retirement after all discovery triggers and UI/state dependencies have migrated.

#### 4.6 Pilot discourse-guided ordering only after repair validation works

Start with 8–12 short, answer-keyed paired fixtures in which rhetorical form is
changed without changing the facts, including cases where a decisive condition,
exception, or counterexample is a satellite. Hand-annotate EDUs and discourse
relations for this pilot; do not add a production parser yet.

Compare the deterministic baseline ordering with discourse used only as the
final tie-breaker. Measure:

- valid-candidate recall and source coverage;
- number of candidates evaluated before the first counterfactually valid one;
- ranking stability under rhetorical paraphrase;
- false pruning, which must remain zero because the pilot does not hard-prune;
  and
- added latency and provider calls.

Keep discourse ordering only if it reduces candidate evaluations without losing
any answer-keyed valid candidate or source claim. Otherwise retain discourse
annotations as inspectable metadata and stop there. A production parser is a
later decision requiring its own cross-domain accuracy benchmark and explicit
fallback to the unweighted baseline.

### Phase 5 — stage the SOC experiment instead of requiring 400 iterations

Iteration 400 is a claim from the founding document, not a product acceptance
threshold. Do not spend that budget until the instrument works at small scale.

#### Stage A — instrumentation sanity, 10–20 iterations

- deterministic saved inputs;
- graph grows on every planned mutation;
- gap and centrality revisions refresh correctly;
- surprising-edge numerator and denominator are observable;
- cached embeddings are reused; and
- checkpoints allow exact resume.

Stage A is the product acceptance run for SOC instrumentation. It should use
saved inputs and cached provider outputs where possible, so it is cheap and
repeatable.

#### Stage B — optional pilot, 20–30 iterations

- one growing related multi-source corpus;
- one shuffled or non-growing control;
- one fixed seed for the first comparison;
- fixed cost/time ceiling and early-stop conditions; and
- no regime claim before the minimum-history gate.

If the first comparison shows a signal, repeat it with one additional seed. Do
not pay for repeated null results merely to satisfy a trial count.

#### Stage C — optional confirmation, 50–100 iterations

Run only if the small Stage B repeat shows a non-vacuous signal in the same
direction. Pre-register the transition criterion and compare against the
control. Persist raw metrics and graph revisions, not only a narrative report.

A 400+ iteration experiment becomes optional research replication. Attempt it
only if the 100-iteration result suggests a transition, the run is resumable,
and the expected cost is explicitly approved. Failure to run 400 iterations is
not a failure to functionalize AGEM.

---

## Dependency and sizing summary

| Work | Depends on | Size |
|---|---|---:|
| Provenance completion | current extraction report | S |
| N-ary fail-closed guard | current source validator | S |
| Gap revision cache | graph/Louvain revisions | S |
| Non-vacuous SOC telemetry | current SOC output | S |
| Counterfactual repair validation | current source validators | S/M |
| N-ary end-to-end support | fail-closed guard, TypeDB available | L |
| Claim-incidence hypergraph | n-ary typed claim contract | M |
| Run intent/artifact contract | current workflow contract | M |
| Finding revalidation ledger | run manifest + artifact contract | M |
| Current extractor baseline | provenance + frozen manifest | M |
| Adaptive self-consistency | baseline demonstrates need | M |
| Discovery edge provenance and catalyst proposals | gap revision cache | L |
| Sheaf A/B | functional discovery loop | M |
| Discourse-ordering pilot | counterfactual repair validation | optional S/M |
| 10–20 iteration SOC acceptance | telemetry + discovery loop | S/M |
| 20–30 iteration pilot | successful acceptance run | optional M |
| 50–100 iteration confirmation | successful pilot repeat | optional M/L |
| 400+ replication | explicit later decision | optional XL |

Phase 0 tasks may proceed in parallel. Phase 1 does not block the gap-cache and
SOC repairs. Hypergraph algorithms wait for the lossless incidence contract.
Discourse ordering waits for real counterfactual repair validation. The sheaf
decision occurs after discovery is usable, not before.

---

## Implementation status — 2026-07-30

The functionalization work is implemented through the deterministic and local
live-validation gates available in this workspace.

Completed and verified:

- Phase 0 now records replayable run/source manifests, rejects every tested
  decomposition of n-ary source semantics, keys gap caches by topology and
  community revisions, reports non-vacuous SOC denominators and origins, and
  validates repair proposals counterfactually under exact proposal/validator
  bounds.
- `joint-incompatibility` is implemented across extraction, TypeDB 3.x schema,
  persistence/retrieval, stable identity, formalization, finding evidence, and a
  lossless role-labelled incidence adapter. Clique projection is explicitly
  diagnostic-only and cannot be supplied to verification.
- The TypeDB schema and positive/negative contract probes passed against a live
  TypeDB 3.12.1 scratch database. A live persistence/retrieval round trip
  preserved a three-member claim, stable key, and source identity. The scratch
  database was removed after validation. `typeql-check` was neither installed
  nor used as a gate.
- Real local Mace4 checks showed every tested proper subset and member is
  satisfiable while the complete n-ary conjunction is forbidden.
- Run intent, artifact provenance/promotion rules, and finding dependency
  fingerprints are enforced. Semantically stale findings become
  `revalidation-required` and are excluded from active recall without deleting
  their history.
- Discovery now invalidates stale gap/centrality results, labels edge origin,
  and emits bounded, source-referenced catalyst/VdW proposals instead of
  synthetic discoveries. Discovery artifacts do not silently enter the typed
  claim store.
- The deterministic SOC Stage A replay covers 12 growing iterations, measures
  an eligible accepted-discovery edge on each iteration, and proves exact
  checkpoint/resume equivalence.
- Counterfactual repair validation is operational. An eight-fixture,
  hand-annotated discourse pilot exists only as a final tie-breaker and performs
  no pruning. A three-corpus extractor-baseline evaluator reports must-find,
  must-not-find, coverage, vacuity, normalized agreement, disagreement
  dimensions, cost, latency, and provider failure.
- Root verification passes 53 test files / 779 tests; backend verification
  passes 37 files / 332 tests. Root and backend TypeScript builds, frontend lint
  and production build, shell syntax checks, and `git diff --check` pass. The
  frontend build retains its pre-existing Vite chunk-size and mixed-import
  warnings.

Evidence gates deliberately not claimed:

- ~~The current provider is OpenRouter with no configured API key. Therefore the
  live three-by-three extractor baseline was not run, and adaptive `k=3`
  sampling was not enabled without evidence of current within-version
  disagreement.~~

  **CORRECTED 2026-07-30 — the premise was false.** An OpenRouter key is
  configured in `.env` and exported from the user's shell as
  `OPENROUTER_API_KEY`. `GET /api/v1/system/config` reports
  `"has_api_key": true` with provider `openrouter`, model
  `deepseek/deepseek-v4-flash`. Live provider sampling was **available and not
  attempted**, which is a different and less defensible statement than "blocked
  on a credential". The three-by-three extractor baseline and adaptive `k=3`
  sampling remain un-run, but nothing external prevents them.

  Anyone reading this section: verify a claimed blocker before inheriting it.
  This one was load-bearing enough that a later session deferred every live
  evidence gate on the strength of it.
- The backend was not restarted for a live replay of all six quantum corpora.
  The answer-keyed six-constraint fixture, source-semantic guard, real Mace4
  semantics, and live TypeDB storage contract pass, but these are not presented
  as a successful live corpus extraction run.
- The sheaf A/B evaluator passes a deterministic 12-fixture contract, not a
  replay over real saved graph states. Registry cycle topology remains an
  isolated discovery diagnostic pending that measurement; retention is
  provisional.
- No production discourse parser was added. The manual pilot cannot establish
  cross-domain discourse accuracy.
- Optional SOC Stages B/C and the 400-iteration research replication were not
  run. By design, they are conditional experiments rather than product
  acceptance gates.

---

## Final acceptance

### Verification acceptance

On held-out, independently authored, answer-keyed corpora:

- every extraction outcome resolves to exact source text;
- `mustFind`, `mustNotFind`, coverage, and vacuity are reported first;
- all six quantum no-go constraints remain n-ary end to end;
- typed claims round-trip through the incidence hypergraph without information
  loss;
- no n-ary source becomes pairwise or unary negation;
- any critical or incomplete extraction aborts before the prover;
- no community, embedding, centrality, or sheaf value acts as logical evidence;
- no discourse role or salience weight acts as logical evidence;
- a finding with a changed semantic dependency is `revalidation-required`, not
  active evidence;
- semantic aliases require audited ontology approval;
- satisfiable results include model/certificate metadata and non-vacuity checks;
- contradictory results include the exact source-grounded minimal core; and
- no-quorum self-consistency results remain inconclusive.

### Discovery acceptance

- graph/community mutation cannot return stale gaps or centrality;
- discriminating gap fixtures behave as specified;
- catalyst exploration produces source-bounded proposals, not placeholder IDs;
- proposed edges carry origin, rationale, provenance, and status;
- surprising-edge telemetry exposes counts and eligibility;
- discovery proposals never silently enter the verified claim store; and
- the sheaf is retained only with measured incremental discovery value.

If the optional discourse pilot runs, it must preserve answer-keyed candidate
recall and source coverage, with zero hard-pruned candidates.

### Operational acceptance

- every loop and repair path has a documented bound;
- repair candidates are called validated only after the actual failing validator
  passes on an isolated copy;
- finding revalidation has an exact dependency fingerprint and a bounded path;
- deadlines and cancellation propagate through concurrent extraction;
- empty provider output, missing vectors, no eligible edges, and budget
  exhaustion have explicit non-success statuses;
- TypeDB schema and contract probes pass against a scratch TypeDB 3.x database;
- missing or broken `typeql-check` installation does not block validation;
- root, backend, and frontend surfaces are verified separately; and
- a restarted live replay is required before claiming corpus success.

---

## Non-goals

- Do not optimize the system to manufacture a 12% surprising-edge ratio.
- Do not call nine iterations “stable” evidence of SOC maturity.
- Do not require 400 iterations to ship a functional discovery loop.
- Do not use blanket `k=5` sampling before measuring current disagreement.
- Do not silently apply abductive, embedding, or discovery proposals.
- Do not accept a tautological abductive query as evidence that a patch works.
- Do not give any abducible zero base cost because it appears in a nucleus.
- Do not hard-prune source claims or candidates by discourse role.
- Do not clique-expand an n-ary typed claim for verification.
- Do not add a second hypergraph store before the incidence adapter demonstrates
  a need for one.
- Do not adopt external D-ALP benchmark numbers as AGEM targets.
- Do not delete the sheaf before its discovery role is isolated and measured.
- Do not log hidden model chain-of-thought.
- Do not replace failed typed extraction with hand-authored premises.

## Standing rule

Every headline diagnosis names the exact run log, code version, configuration,
and raw event that supports it. Summaries are navigation aids, not evidence.
