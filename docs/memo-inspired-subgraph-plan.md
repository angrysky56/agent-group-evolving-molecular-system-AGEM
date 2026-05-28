# MEMO-Inspired Sub-Graph Plan: Create · Persist · Utilize

> Goal: improve AGEM's ability to **create, permanently store, and utilize multiple sub-graphs**,
> taking _structural inspiration_ from MEMO (Memory as a Model) — but keeping memory in the
> auditable graph layer, not in opaque model weights.

## 0. The critical reframe (read this first)

The naive order — "A) persist, B) sub-graphs, C) reflections" — has a hidden dependency
problem that the source-of-truth code reveals:

1. **The summary-DAG layer is built and unit-tested but never wired into production.**
   `ContextDAG`, `SummaryIndex`, and `EscalationProtocol` are only ever instantiated inside
   `*.test.ts` files. `ComposeRootModule.#initLcm()` creates only `ImmutableStore`,
   `EmbeddingCache`, and `LCMClient`. So the very thing we want to make _multiple of_ and
   _persist_ does not run in the live pipeline yet.

2. **Rehydration mints new IDs.** `agem-bridge.ts → restoreFromSnapshot()` restores LCM
   entries by calling `lcmClient.append(entry.content)`, which runs `ImmutableStore.append()`
   → new `uuidv7`, new hash, re-embed. The saved `id`/`timestamp`/`sequenceNumber` are thrown
   away. Any persisted graph that references entry IDs (every summary node does, via
   `originalEntryIds`) will break on reload.

Therefore the real sequence is **P0 → P1 → A → B → C**, where P0 and P1 are prerequisites.

## 1. Ground truth (what exists vs. what's missing)

| Capability                     | Status today                         | File(s)                                              |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------- |
| Append-only raw entry store    | ✅ in-memory                         | `src/lcm/ImmutableStore.ts`                          |
| Per-entry embedding cache      | ✅ in-memory                         | `src/lcm/EmbeddingCache.ts`                          |
| Summary DAG + cycle detection  | ✅ built, ❌ not wired               | `src/lcm/ContextDAG.ts`, `SummaryIndex.ts`           |
| Escalation/compaction          | ✅ built, ❌ not wired               | `src/lcm/EscalationProtocol.ts`                      |
| Disk persistence (per session) | ⚠️ partial                           | `interface/backend/src/services/state/serializer.ts` |
| — persists raw `lcmEntries`    | ✅ (but IDs lost on reload)          | `agem-bridge.ts`                                     |
| — persists summary DAG         | ❌                                   | —                                                    |
| — persists entry embeddings    | ❌ (only TNA node embeddings)        | —                                                    |
| Multiple named sub-graphs      | ❌ (single DAG only)                 | —                                                    |
| Sheaf built from real topology | ❌ placeholder `buildFlatSheaf(2,1)` | `ComposeRootModule.runReasoning()`                   |

**Invariants that must survive every change below:**

- LCM module isolation: no `src/lcm/**` production file may import from `/sheaf/`, `/tna/`,
  `/soc/`, `/orchestrator/` (enforced by `src/lcm/isolation.test.ts`).
- No `@huggingface/transformers` import outside `interfaces.ts`.
- `ImmutableStore` stays append-only (no `update`/`delete`/`clear`).
- Only `ComposeRootModule` imports from multiple modules.

---

## P0 — Wire the summary-DAG layer into production _(prerequisite)_

Without this, there is nothing to persist or replicate. Keep it minimal and additive.

**Changes**

- `src/lcm/index.ts`: confirm `ContextDAG`, `SummaryIndex`, `EscalationProtocol` are exported
  (already imported by tests, so likely yes — verify).
- `src/orchestrator/ComposeRootModule.ts`:
  - In `#initLcm()`, after building `store`/`cache`/`lcmClient`, also build:
    `const summaryIndex = new SummaryIndex();`
    `const dag = new ContextDAG(store, summaryIndex);`
    `const escalation = new EscalationProtocol(...)` (inject `ITokenCounter`, `ICompressor`,
    thresholds, `dag`/`store` per its constructor signature — read the file first).
  - Expose them as readonly fields (`lcmDag`, `lcmEscalation`) like the other components.
  - In `runReasoning()` Step 5, after `lcmClient.append()`, call the escalation check; when it
    produces a `SummaryNode`, route it through the existing `auditCompaction()` hook (already
    present on the Orchestrator) so lumpability auditing fires.

**The compressor.** `EscalationProtocol` needs an `ICompressor`. Production should wrap the
local LLM (Ollama via the backend's `llm.ts`) behind the `ICompressor` interface. For a first
pass, inject `MockCompressor` to get wiring green, then swap to an LLM-backed compressor.

**Tests**

- New `ComposeRootModule` test: after N `runReasoning()` calls past the L1 token threshold, a
  `SummaryNode` exists in `SummaryIndex` and `lumpability:audit-complete` fired.
- Isolation tests must still pass (no new cross-imports inside `src/lcm`).

**Effort:** S–M. **Risk:** low (additive). **Unblocks:** A (DAG persistence), B, C.

---

## P1 — ID-preserving rehydration _(prerequisite)_

Stop minting new IDs on reload so persisted graphs keep their references.

**Changes**

- `src/lcm/ImmutableStore.ts`: add a single new method (still append-only in spirit):
  `rehydrate(entries: readonly LCMEntry[]): void` — pushes pre-existing frozen entries
  _verbatim_ (preserving `id`, `hash`, `timestamp`, `sequenceNumber`), rebuilding `#idIndex`.
  Guard: throw if the store is non-empty, or if `sequenceNumber` ordering is violated, so it
  can only be used for a clean load, never to mutate a live store.
- `src/lcm/LCMClient.ts`: add `rehydrate(entries, embeddings?)` that calls
  `store.rehydrate(entries)` and, when embeddings are supplied, seeds `EmbeddingCache`
  directly (new `EmbeddingCache.seed(id, vector)` method) instead of re-embedding.
- `interface/backend/src/services/agem-bridge.ts → restoreFromSnapshot()`: replace the
  `for (...) await lcmClient.append(entry.content)` loop with a single
  `lcmClient.rehydrate(snapshot.lcmEntries, snapshot.lcmEmbeddings)` call.

**Why a guarded `rehydrate` and not `append`:** `append` is correct for _new_ knowledge; load
is a different operation (restore known, frozen facts). Separating them preserves the
append-only guarantee while making reload lossless and embedding-free.

**Tests**

- Save → load round-trip preserves entry `id`, `hash`, `sequenceNumber` exactly.
- `rehydrate` on a non-empty store throws.
- After load with embeddings supplied, `EmbeddingCache.has(id)` is true with **zero** embedder
  calls (assert via a counting mock embedder).

**Effort:** S. **Risk:** low. **Unblocks:** A, B (both persist ID-referencing graphs).

---

## Move A — Permanently store the memory (extend, don't rebuild)

A real persistence layer already exists (`StateSerializer`, atomic tmp-then-rename, versioned,
per-session). Extend it; do not start over. **Key design rule:** keep all `fs` I/O in the
backend. The `src/lcm` classes only expose **pure snapshot/restore of plain objects** (no disk,
no other-module imports) — mirroring the existing `IEmbedder`/`ITokenCounter` injection style.

**Engine-side (pure, isolation-safe)**

- `ContextDAG` / `SummaryIndex`: add `snapshot(): SummaryNode[]` and
  `restore(nodes: SummaryNode[]): void` (plain JSON-safe objects; `SummaryNode` is already
  all-serializable). `SummaryIndex.restore` re-runs `add()` so the frozen-content wrapper is
  rebuilt identically.
- `EmbeddingCache`: add `snapshot(): Record<string, number[]>` and `seed(id, number[])`
  (from P1). Store as plain arrays; reconstruct `Float64Array` on load.

**Snapshot format — bump `EngineSnapshot` to `version: 2`**
Add to `serializer.ts`:

- `lcmSummaryNodes: SummaryNode[]` — the summary DAG.
- `lcmEmbeddings: { model: string; dim: number; vectors: Record<string, number[]> }` —
  per-entry embeddings **tagged with embedding model + dimension**. On load, if the configured
  embedder's model/dim differs (e.g. switched `nomic-embed-text` 768 ↔ `all-MiniLM` 384 ↔
  `gemini-embedding-001`), **discard and lazily recompute** rather than mixing dimensions.
- Keep a `version: 1` migration path: load v1 → treat summary nodes as empty, embeddings as
  absent (current behavior), then re-save as v2.

**Backend wiring**

- `agem-bridge.ts → captureSnapshot()`: add `orch.lcmDag.snapshot()` and
  `orch.lcmEmbeddingCache.snapshot()` to the returned object.
- `agem-bridge.ts → restoreFromSnapshot()`: after `lcmClient.rehydrate(...)` (P1), call
  `orch.lcmDag.restore(snapshot.lcmSummaryNodes)`.

**Tests**

- Round-trip: build entries + force a summary, save, new orchestrator, load → identical entry
  IDs, identical summary node `originalEntryIds`, `getEntriesForSummary()` resolves correctly.
- Model-mismatch: load a snapshot whose `lcmEmbeddings.model` differs → cache empty, no crash.

**Effort:** M. **Risk:** low–med (format migration). **Payoff:** AGEM stops being amnesiac.

---

## Move B — Multiple sub-graphs (the MEMO "composable memories" idea, in graph space)

MEMO composes independently-trained per-corpus memories by **merging task vectors** (TIES/DARE)
in _parameter_ space. We do the equivalent in _graph_ space — where it stays auditable and where
AGEM already owns the machinery (sheaf restriction maps + cohomology). Each sub-graph =
one domain/corpus/topic; composition = sheaf edges between sub-graphs.

### B1. `SubgraphRegistry` (lives in `src/lcm/`, isolation-safe)

A registry of **named** memory units, generalizing today's single DAG. New file
`src/lcm/SubgraphRegistry.ts`:

- A `Subgraph` bundles its own `ImmutableStore` + `SummaryIndex` + `ContextDAG` +
  `EmbeddingCache`, plus metadata `{ id, name, createdAt, rootSummaryIds, embeddingModel }`.
- API: `create(name)`, `get(id)`, `list()`, `activate(id)` (the "current" write target),
  `route(query, embedder)` → ranked sub-graph IDs by cosine similarity of the query embedding
  against each sub-graph's **summary-root embeddings** (this is the cheap, auditable analog of
  MEMO's Stage-1 "grounding": pick which memory to ask).
- `snapshot()` / `restore()` for the whole registry (delegates to each sub-graph's Move-A
  snapshot). Persist as `state/{session}/subgraphs/{subgraphId}.json` — one file per sub-graph,
  so a new corpus is an O(1) add, never a rebuild (the MEMO "streaming update" property,
  achieved without retraining).

This mirrors the `advanced-reasoning` MCP's `create_memory_library` / `switch_memory_library`,
but **inside the engine** so sheaf/cohomology can see across libraries — which the external MCP
cannot.

### B2. Cross-sub-graph sheaf edges (lives in `ComposeRootModule`, the only multi-module file)

- Treat each sub-graph as a **cell/stalk** in the `CellularSheaf`; its section = its
  summary-root embedding(s).
- Define `set_restriction_map` between two sub-graphs when they share entities/topics
  (detected via embedding similarity over their roots, or explicit user labels). This edge is
  the auditable equivalent of MEMO's **"converging clues" / "parallel properties"
  cross-document synthesis** — but as an explicit, inspectable morphism, not a hidden weight.
- `CohomologyAnalyzer` then detects **H¹ obstructions across sub-graphs**, not just within one:
  i.e. it flags when two memories disagree. That is a capability MEMO's opaque weights
  _cannot_ provide and is squarely on-brand for AGEM.
- All of this wires in `ComposeRootModule` (replacing the placeholder `buildFlatSheaf(2,1)`
  with a sheaf built from the registry), so LCM isolation is preserved.

### B3. Utilization in `runReasoning()`

- On a query: `registry.route(query)` → select top sub-graph(s) → query their DAGs →
  if multiple selected, build/refresh the cross-edges and run cohomology before synthesis.
- Default sub-graph = a `"default"` unit so single-graph behavior is unchanged when the user
  never creates others (backward compatible).

**Tests:** create 2 sub-graphs with overlapping entity, assert `route()` ranks the right one;
assert a cross-edge with conflicting facts raises H¹; registry save/load round-trip.

**Effort:** L. **Risk:** med (sheaf wiring is currently a placeholder — see Risks).
**Payoff:** the actual feature requested — many memories, composed and conflict-checked.

---

## Move C — Borrow MEMO's two good _design_ patterns (not its training)

We never train a model. We steal the two ideas that translate cheaply to a local RTX 3060 setup.

### C1. Reflection-style summaries at compaction

Today's compaction produces a flat summary. MEMO's insight is that a _reflection_ — a small set
of compositional Q→A pairs that expose the same facts under varied phrasings — generalizes far
better to unseen queries (their ablation shows cross-document synthesis is the single most
important step; removing it collapses accuracy).

- When `EscalationProtocol` (P0) builds a `SummaryNode`, have the LLM-backed `ICompressor`
  additionally emit a few reflection QA pairs (direct + indirect/inferred, plus 1–2 that span
  multiple source entries — the "cross-document synthesis" flavor).
- Store them in `SummaryNode.metrics.reflections` (the `metrics` field is already a free-form
  `Record<string, unknown>` and is mutable-but-tracked, so this needs **no type change** and
  is captured by metric history automatically).
- These reflections become the matchable surface for `route()`/grounding in B1, giving much
  better sub-graph selection than embedding the flat summary alone.

Cost note: this is local-LLM inference at compaction time only (not per token, not training) —
well within a 3060 + Ollama budget.

### C2. Staged query protocol (grounding → entity → synthesis)

Mirror MEMO's 3-stage inference as the _protocol an agent uses to query memory_ — AGEM already
has the pieces (query decomposition exists in the molecular-CoT / escalation paths).

- **Stage 1 Grounding:** decompose the query into atomic sub-questions; answer each against the
  selected sub-graph's reflections (B1 `route()` does the selection).
- **Stage 2 Entity ID:** narrow to the key entity/summary node using the entity-style
  reflections from C1.
- **Stage 3 Synthesis:** gather supporting facts from that node's `originalEntryIds` (resolved
  via `ContextDAG.getEntriesForSummary`) and synthesize.

Implement as a thin orchestration helper that reuses existing components; keep stage budgets
small and configurable. This is a refinement, not a rewrite — ship it last.

**Effort:** C1 = M, C2 = M. **Risk:** low (additive, behind the existing compaction hook).

---

## Sequencing & dependency graph

```
P0 (wire DAG) ──┬──> A (persist DAG + embeddings) ──┐
P1 (rehydrate) ─┘                                    ├──> B (sub-graphs) ──> C2 (staged query)
                                                     │
                          C1 (reflections) <─────────┘  (C1 needs P0's compaction hook;
                                                          C1 strongly improves B's routing)
```

Recommended ship order: **P0 → P1 → A → C1 → B → C2.**
(C1 before B because reflections are what make sub-graph routing actually good. If you want the
headline feature fastest, do P0 → P1 → B-minimal with summary-embedding routing, then add C1.)

## Risks & honest caveats

- **The sheaf is a placeholder.** `runReasoning()` runs `CohomologyAnalyzer.analyze()` on a
  hardcoded `buildFlatSheaf(2,1)`, not on real topology. Move B's cross-sub-graph cohomology is
  only meaningful once the sheaf is built from actual data. Treat "build sheaf from registry"
  as part of B2, and validate H¹ behavior with a deliberately conflicting test fixture before
  trusting it.
- **Embedding dimension drift.** Provider embedders differ (384 / 768 / 3072). Always tag
  persisted vectors with model+dim and invalidate on mismatch (Move A). Do not silently mix.
- **Reflection cost & quality.** LLM-generated reflections vary with the local model
  (`gemma3` default). Cap pairs per summary; keep the flat summary as the always-present
  fallback so a weak generator never degrades retrieval below today's baseline.
- **Scope creep into MEMO's training.** Resist it. A LoRA "memory adapter" on a 1–1.5B model is
  the only 3060-viable slice of MEMO's actual method, and the paper's own ablation shows LoRA
  badly underperforms full SFT. Keep memory in the auditable graph layer.

## Test checklist (gates per phase)

- [ ] All existing `npm test` green after each phase (esp. `src/lcm/isolation.test.ts`).
- [ ] P1: ID/hash/sequence preserved on round-trip; zero re-embeds on load.
- [ ] A: v1→v2 snapshot migration loads without error; summary nodes resolve post-load.
- [ ] B: `route()` ranks correct sub-graph; cross-edge conflict raises H¹; per-sub-graph
      files add in O(1).
- [ ] C1: reflections present in `SummaryNode.metrics`; flat summary still present as fallback.
- [ ] C2: staged query returns synthesized answer with traceable `originalEntryIds`.
