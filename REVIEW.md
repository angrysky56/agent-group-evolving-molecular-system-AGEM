# Code Review: AGEM Attribution, Logical Blocking, and Last-Run Correctness

**Scope:** Latest consciousness-corpus run artifacts and the current claim extraction, blocking, finding-memory, cohomology, and community-detection paths.

**Files and artifacts reviewed:** 14

- `knowledge_base/runs/2026-07-28T04-16-56-421Z_df72xf.md`
- `knowledge_base/runs/2026-07-28T04-16-56-421Z_df72xf.jsonl`
- `knowledge_base/findings/index.json`
- `docs/tom-corpus-alias-audit.md`
- `schema/claims.tql`
- `interface/backend/src/services/claim-extractor.ts`
- `interface/backend/src/services/claim-blocks.ts`
- `interface/backend/src/services/claim-blocks.test.ts`
- `interface/backend/src/services/finding-capture.ts`
- `interface/backend/src/services/finding-store.ts`
- `interface/backend/src/services/agem-bridge.ts`
- `interface/backend/src/routes/chat.ts`
- `interface/shared/types.ts`
- `src/orchestrator/ComposeRootModule.ts` and `src/tna/LouvainDetector.ts`

---

## Findings

### HIGH — Bug Risk: Claim Attribution Is Discarded

**Files:** `schema/claims.tql` (lines 61-64, 112-115), `interface/backend/src/services/claim-extractor.ts` (lines 41-48, 250-290, 532-607)

**Issue:** The TypeDB schema already defines `position` and `attribution`, but `ExtractedClaim` has no holder or position field. Claim persistence links a claim only to its source segment, and `claimToPropositions` converts attributed reports into unrestricted first-order assertions.

The exact HOT/HOP source segment generated all three of these unscoped claims:

```text
meta_state <-> thought_like
meta_state <-> perception_like
exists thought_like & -perception_like
```

The source instead reports that HOT theorists advance the first identity and HOP theorists advance the second.

**Why it matters:** The extractor turns a survey of rival theories into a conjunction of corpus assertions. This manufactures contradictions and invalidates logical verdicts even when predicate aliases are correct.

**Suggestion:** Add claim-level scope and attribution, for example:

```ts
type ClaimScope = "corpus" | "position";

interface ExtractedClaim {
  kind: ClaimKind;
  roles: Record<string, string | string[]>;
  scope: ClaimScope;
  positionId?: string;
  // existing modality, polarity, and differenceKind fields
}
```

Persist `positionId` through the existing TypeDB `attribution` relation. Include the holder in the attributed occurrence identity so claims advanced by different positions cannot collapse into the same assertion context.

### HIGH — Bug Risk: Graph Communities Determine Logical Blocks

**Files:** `interface/backend/src/services/claim-blocks.ts` (lines 56-72, 378-414), `interface/backend/src/routes/chat.ts` (lines 1581-1590)

**Issue:** `mapSegmentsToPositions` recognizes only standalone Markdown `##` headings. The numbered consciousness corpus produces no position mapping, so `deriveClaimBlocks` falls back to `community:${community.id}` and conjoins claims according to Louvain membership.

**Why it matters:** Co-occurrence communities answer which terms are topologically close, not who asserts a proposition. Graph input, preprocessing, or partition changes can therefore change MUS arity, membership, and even the final verdict.

Source-segment grouping alone is also insufficient: the HOT and HOP assertions occur in the same segment. Segment grouping would change the observed false arity-2 MUS into a false internally inconsistent arity-1 block.

**Suggestion:** Use `(corpusId, positionId)` as the semantic block key. Keep segment IDs as evidence provenance and community IDs as diagnostic annotations only. Never fall back from missing attribution to a community-based logical block; return an explicit attribution-incomplete result instead.

### HIGH — Bug Risk: Rival-Position Incompatibility Is Reported as Corpus Contradiction

**Files:** `interface/backend/src/services/claim-blocks.ts` (lines 383-414), `interface/backend/src/routes/chat.ts` (lines 1581 onward), `knowledge_base/runs/2026-07-28T04-16-56-421Z_df72xf.md` (lines 1153-1173)

**Issue:** The evaluator treats an unsatisfiable union of claims from different theoretical positions as proof that the corpus is contradictory.

**Why it matters:** A survey can consistently report that two theories are mutually incompatible. Combining both theories and finding UNSAT establishes disagreement between positions, not falsity or inconsistency of the source corpus.

**Suggestion:** Separate result semantics into:

1. `position-contradiction` — one attributed position is internally inconsistent.
2. `corpus-contradiction` — direct corpus-level assertions are inconsistent.
3. `positions-incompatible` — distinct attributed positions cannot jointly hold.

Only the first two may support a contradiction verdict. The third is a relationship among positions and must not be presented or stored as a contradictory corpus.

### HIGH — Bug Risk: False Contradictions Are Automatically Stored as Durable Findings

**Files:** `interface/backend/src/services/finding-capture.ts` (lines 47-78), `interface/backend/src/routes/chat.ts` (lines 2242-2315), `knowledge_base/findings/index.json`

**Issue:** Finding capture treats every successful tool result with `hasContradiction: true` as conclusive. It has no attribution-completeness or semantic-verdict gate. The false consciousness result was stored automatically as finding `158798d3-ea85-43cc-875f-2eb2e9c58936`.

**Why it matters:** One extraction error becomes persistent memory and can contaminate future runs through automatic recall. The system converts a transient false positive into durable false knowledge.

**Suggestion:** Require all of the following before automatic storage:

- `attributionComplete === true`
- `semanticsValidated === true`
- a conclusive result status
- verdict kind is `position-contradiction` or `corpus-contradiction`

Missing attribution must produce an explicit inconclusive status and must not be stored as a verified finding.

### HIGH — Bug Risk: Recurring Predicates Are Injected Into Every Block

**Files:** `interface/backend/src/services/claim-blocks.ts` (lines 420-457), `interface/backend/src/services/claim-blocks.test.ts` (lines 299 onward)

**Issue:** The three most frequently recurring canonical role labels are converted into existential witnesses and inserted into every block. In the reviewed run, every block received `consciousness`, `pain`, and `perception_like`, including blocks that never asserted them.

**Why it matters:** This adds logical commitments not made by a position, can manufacture contradictions, and artificially connects the signature graph. The current test codifies this unsound behavior.

**Suggestion:** Remove automatically inferred cross-block witnesses. Retain:

- witnesses emitted from each claim's own subject;
- explicitly supplied, caller-audited shared seeds when their semantics are documented.

Replace the recurring-role test with a test proving that unrelated blocks do not inherit each other's existence commitments.

### MEDIUM — Bug Risk: Semantic Recall Is Not Corpus-Scoped

**Files:** `interface/backend/src/services/finding-store.ts` (lines 275-316), `interface/backend/src/routes/chat.ts` (lines 296-313, 528-532)

**Issue:** `FindingStore.recall` filters only for active findings before ranking by cosine similarity. The incoming chat request has no memory namespace, and the optional tool `corpusId` is explicitly provenance-only. The consciousness run therefore recalled a genetic-code finding at similarity `0.24180524088932334`.

**Why it matters:** Unrelated findings enter model context and can bias tool selection, interpretation, or summaries. Embedding distance is not a reliable tenancy or corpus boundary.

**Suggestion:** Add an explicit `memoryNamespace` or `corpusId` to the chat request/session and pass it into `recall`. Default to same-namespace recall. If cross-domain research is useful, expose it as an explicit opt-in or as a separately labeled secondary result set.

### MEDIUM — Bug Risk: Degenerate Cohomology Emits Meaningful-Looking Numbers

**Files:** `interface/backend/src/services/agem-bridge.ts` (lines 576-635), `interface/shared/types.ts` (lines 130-156), `knowledge_base/runs/2026-07-28T04-16-56-421Z_df72xf.md` (lines 781-794)

**Issue:** `CohomologySnapshot` requires numeric dimensions. The bridge returns numeric zeros when the sheaf is unbuilt and computes `H0 = 3`, `H1 = 0` for a one-vertex, zero-edge sheaf, then explains in a note that the values are not meaningful for corpus interpretation.

**Why it matters:** Downstream models and users still read emitted numbers as results. A warning does not undo the semantic implication of a numeric field.

**Suggestion:** Use a discriminated union and omit dimensions when cohomology is not meaningful:

```ts
type CohomologySnapshot =
  | {
      status: "not-computed";
      notComputed: string;
      domain: "lcm-subgraph-registry";
      sheaf_vertices: number;
      sheaf_edges: number;
    }
  | {
      status: "computed";
      h0_dimension: number;
      h1_dimension: number;
      has_obstruction: boolean;
      coboundary_rank: number;
      tolerance: number;
      domain: "lcm-subgraph-registry";
      sheaf_vertices: number;
      sheaf_edges: number;
    };
```

Return `not-computed` for an unbuilt sheaf, fewer than two registry vertices, or an edgeless sheaf. Use "single registry vertex" rather than "single-source corpus" unless the construction formally guarantees one corpus per sheaf vertex.

---

## Graph-Algorithm Assessment

The priority ordering is correct: attribution and verdict semantics must be fixed before community detection is upgraded.

The current orchestrator calls Louvain with fixed seed `42`, and `LouvainDetector` injects a seeded PRNG. Therefore, the observed 10-versus-12 community difference does not by itself prove seed nondeterminism; same graph plus the same seed is intended to be deterministic. Graph input and state can still differ, and the reviewed run ingested a model-produced summary rather than the raw user corpus. None of this changes the central conclusion that graph partitions cannot define logical assertion contexts.

After logical blocking is independent of topology:

1. Evaluate Leiden for connected-community guarantees and bounded execution.
2. Run a resolution sweep and report partition stability rather than presenting one resolution as canonical.
3. Consider consensus clustering only for graph-analysis confidence, never for logical block formation.

References:

- Traag, Waltman, and van Eck, "From Louvain to Leiden: guaranteeing well-connected communities": https://www.nature.com/articles/s41598-019-41695-z
- Graphology Leiden implementation: https://github.com/aflsolutions/graphology-communities-leiden
- FastEnsemble: https://journals.plos.org/complexsystems/article?id=10.1371/journal.pcsy.0000069
- Multiresolution Consensus Clustering: https://www.nature.com/articles/s41598-018-21352-7

---

## Required Regression Tests

1. The exact HOT/HOP paragraph yields two attributed position claims plus a corpus-level distinction.
2. HOT is internally satisfiable and HOP is internally satisfiable.
3. The survey corpus is not reported as contradictory merely because HOT and HOP are incompatible.
4. Reassigning every claim to arbitrary graph community IDs leaves all logical verdicts unchanged.
5. Two rival assertions in one source segment remain separated by holder.
6. One position asserting both identities produces a real internal contradiction.
7. Direct corpus-level assertion of both identities produces a real corpus contradiction.
8. Attribution-incomplete extraction is inconclusive and creates no finding.
9. Blocks do not inherit automatically inferred witnesses from other positions.
10. Default recall cannot return findings from another namespace.
11. Unbuilt, single-vertex, and edgeless sheaves return `not-computed` without `H0` or `H1` fields.

---

## Summary

| Severity | Count |
|----------|------:|
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 2 |
| LOW | 0 |

## Recommended Actions

1. Wire claim-level attribution through extraction, TypeDB persistence, claim identity, and deterministic logical encoding.
2. Replace community/segment fallback blocking with position-scoped blocks and explicit attribution-incomplete failure.
3. Separate corpus contradiction, position contradiction, and rival-position incompatibility.
4. Gate automatic finding capture on attribution and semantic validation; retire or supersede the false stored consciousness finding after the corrected run establishes the replacement result.
5. Remove inferred global witnesses and update their tests.
6. Add request-level memory namespaces and a discriminated cohomology result.
7. Consider Leiden, resolution sweeps, and consensus clustering only after logical semantics no longer depend on graph communities.
