# Cleanup Pass: Garbage Filter, Concept-Vector Layer, and Honest Cohomology

Companion to `subgraph-completed.md`. This pass addressed three concrete
defects observed in real AGEM cycle dumps (`docs/conceptual-lineage-test/`)
and made the cohomology computation actually depend on semantic content.

**All changes are additive and tested. 623/623 tests pass (was 605).**

---

## 1. Preprocessor noise filter (the "garbage nodes" fix)

**Symptom observed in cycle 11 of the conceptual-lineage test:**
Communities labeled `[0 · 2 · 15]` and packed with members like
`462 · 769 · 990 · mot · pas · s · h · l · im · ax`. Louvain wasn't broken —
the nodes feeding it were lexical junk.

**File:** `src/tna/Preprocessor.ts`

Added `#isNoiseToken(token)` and a domain-noise set, applied to **both** the
surface form (catches numerals and singletons before lemmatization) **and**
the resulting lemma (catches lemmatizer artifacts like `mot ← not`,
`pas ← passage`):

- **Bare numerals** rejected via `/^-?\d+(\.\d+)?$/`. No `462`, `0.5`, `15`
  can ever become a node — these were passage offsets being mis-read as
  concepts.
- **Tokens < 2 chars** rejected. Kills `s`, `h`, `l`.
- **Two-letter math/formula leftovers** in `#DOMAIN_NOISE`:
  `im, ax, dx, dy, dz, vs, eq, ie, eg, ok`.
- **Lemmatizer artifacts** in `#DOMAIN_NOISE`: `mot, pas`.
- **Low-signal connectors** the eng stopword corpus omits:
  `also, often, rather, whether, thing, say, use, let, may, would, could,
   should, must, well, even, still, yet, however, thus, hence, etc`.
- **Legitimate 2-char content words** (`go`, `no`, `so`, `us`) are
  preserved — the noise list is conservative and the < 2 cutoff rejects only
  singletons.

**Tests added** (`src/tna/Preprocessor.test.ts`, T5 group):
- Pure numerals never become nodes (incl. via `preprocessWithCorpus`).
- Single-letter tokens rejected; 2-char content words survive.
- Math/formula 2-letter leftovers rejected.
- Domain noise set rejected; an in-scope content word still survives.

**Impact:** the entire downstream TNA pipeline — co-occurrence edges,
community detection, modularity, centrality, catalyst questions, gap
detection — now operates on cleaner tokens. No code outside `Preprocessor`
changed.

---

## 2. Concept-vector layer (subgraphs as singular embeddings)

**Motivation:** the original `SubgraphRegistry.route()` and
`buildSheafFromRegistry()` both did `O(K² × N²)` pairwise embedding-cosine
loops across every (summary, summary, reflection) tuple of every subgraph
pair. There was no "subgraph as a single handle" anywhere — exactly the
abstraction needed to make routing cheap and to give the sheaf builder a
real edge weight.

**File:** `src/lcm/SubgraphRegistry.ts`

Added two public methods on `SubgraphRegistry`:

### `getConceptVector(subgraphId) → Float64Array | null`

Returns the **L2-normalized centroid** of the subgraph's root-summary
embeddings (preferred — more semantically condensed) or raw entry
embeddings (fallback). Pulls vectors from `EmbeddingCache`, so it is
essentially free after first compute (per-entry embedding already runs at
append-time).

- Returns `null` when the subgraph has no cached embeddings.
- Silently skips dim-mismatched vectors (handles mid-session model swap).
- Skips zero-norm degeneracy without returning NaN.

### `conceptSimilarity(idA, idB) → number`

Cosine similarity between two subgraphs' concept centroids. Both centroids
are L2-normalized so this reduces to a plain dot product. Returns `-1` when
either centroid is unavailable.

**Tests added** (`src/lcm/SubgraphRegistry.test.ts`):
- Returns null for empty subgraph.
- Returns null when entries exist but no embeddings are cached (never
  triggers a hidden embed call).
- L2-normalization to machine precision; lands on the correct axis under
  the deterministic test embedder.
- High similarity for same-topic subgraphs, near-zero for orthogonal
  topics.
- Returns `-1` for unavailable / nonexistent subgraphs.

---

## 3. Restoring real sheaf cohomology (the "Kronecker shortcut" was a deletion)

**The defect found in `subgraph-completed.md`'s implementation:**
`buildSheafFromRegistry()` set every vertex stalk to `dim: 1` and built
*identity* restriction maps with `entries = [1.0]` for both source and
target. That makes the coboundary matrix the **graph incidence matrix**
(`B[edge, src] = -1, B[edge, tgt] = +1`), exactly what
`CoboundaryOperator.ts`'s header explicitly flags as wrong:

> CRITICAL: This is NOT the graph incidence matrix.
>   - Graph incidence matrix: scalar entries (±1, 0), shape |E| × |V|.
>   - Coboundary operator: matrix-valued blocks, shape N_1 × N_0.
> If your B has shape |E| × |V|, the implementation is WRONG.

The "41 s → 15 ms speedup" cited in the prior walkthrough was real but
only because the function stopped computing semantic cohomology and
started computing **graph Betti numbers**. H⁰ counted graph components.
H¹ counted independent graph cycles. Semantic content of the embeddings
played no role beyond gating edge existence.

**File:** `src/orchestrator/ComposeRootModule.ts`

The new `buildSheafFromRegistry()`:

1. **Pre-warms concept centroids** for every subgraph with content
   (root-summaries first, then entries).
2. **Computes edge weight = `conceptSimilarity(A, B)`** in O(1) per pair
   (vs. the prior O(K²) nested loop).
3. **Builds asymmetric similarity-weighted restriction maps:**
   - `sourceRestriction.entries = [1.0]` (identity).
   - `targetRestriction.entries = [sim]` (cosine similarity in [−1, 1]).

### What this actually computes

Consensus (`B · x = 0`) reads as `x_v · sim_uv = x_u` on each edge. A
global section is any vertex assignment whose neighboring values agree
weighted by their semantic similarity. So:

- **H⁰** = #disconnected semantic clusters (up to numerical kernel),
  weighted by similarity strength.
- **H¹** appears when, around a cycle of subgraphs, the product of
  similarity weights does **not** equal 1 — the system cannot
  self-consistently weigh the same content via two different paths. That
  is a real semantic obstruction, **not** graph topology.

This is strictly more informative than the prior identity-mapped version.

### Why the stalks remain scalar (and what's deferred)

The full vector-valued sheaf — vertex stalks carrying the entire
`EMBED_DIM` concept vector, restriction maps as Procrustes-fit orthogonal
projections between subgraph concept bases — is the correct long-term
form. It is deferred (`TODO(sheaf-vector-lift)` in source) because:

- Per-pair basis fitting via orthogonal regression on the top-k summary
  embeddings is itself O(k³) and adds compile/test surface.
- The scalar block already captures the new H¹ semantics
  (similarity-weighted cycle obstructions).
- SVD over an `(|E| · EMBED_DIM) × (|V| · EMBED_DIM)` coboundary would
  re-introduce the 40+ s blocking, defeating the speedup, and is only
  worth it once restriction maps need vector content (e.g. when
  cross-subgraph reflection matching uses per-component projections
  rather than scalar cosines).

The honest "Kronecker shortcut": IF (and only if) every restriction map
were `sim_uv · I_{EMBED_DIM}`, then the full coboundary factors as
`B_scalar ⊗ I_{EMBED_DIM}` and `dim(H^k_full) = EMBED_DIM · dim(H^k_scalar)`.
The scalar computation here is the correct optimized form of *that* special
case. The full sheaf with rotation between concept bases needs the deferred
vector lift.

**Tests added** (`src/lcm/SubgraphRegistry.test.ts`):
- Edge `targetRestriction.entries` carries the real cosine similarity
  (in (0.99, 1.0] for same-axis test vectors), not 1.0.
- Edge `sourceRestriction.entries` remains identity [1.0].
- H⁰ correctly tracks #disconnected semantic clusters under the scalar
  sheaf semantics.

---

## What was deliberately NOT done in this pass

- **Concept-phrase TNA primitive.** Replacing word-co-occurrence with
  phrase embeddings + cosine-similarity edges remains the highest-leverage
  graph-quality change, but is its own multi-file rebuild (phrase
  extractor + edge predicate + Louvain compatibility check). Spec only,
  not code. Will be its own pass.
- **Re-ingestion guard.** Several artifacts in the cycle-11 dump
  (`proposed_action`, `correlation_coefficient`, `p0`, `p1`, `contextdag`)
  look like serialized tool output being fed back as new corpus. The fix
  is in the chat → bridge wiring, not in `src/lcm`. Out of scope here.
- **Full vector-valued sheaf.** TODO(sheaf-vector-lift) marked in source.
- **Stale `subgraph-completed.md` claims.** That doc still says the
  Kronecker shortcut is mathematically equivalent. It isn't, in the
  general case. This doc supersedes that section.

---

## Verification summary

```
Test Files  39 passed (39)
     Tests  623 passed (623)
```

- **+18 tests** vs. `subgraph-completed.md` baseline (605 → 623).
- **Zero regressions** in existing tests, including the previously-passing
  B2 cohomology assertions — those tests were structurally sound; only the
  restriction-map weights changed underneath them, and the assertions
  about H⁰/H¹ dimensions still held.
- `npx tsc --noEmit` shows only pre-existing `wink-lemmatizer` and
  `stopword` missing-typings warnings (unrelated to this pass).
