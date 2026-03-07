---
phase: 03-tna-molecular-cot
plan: 01
subsystem: tna
tags:
  [
    graphology,
    natural,
    wink-lemmatizer,
    stopword,
    tfidf,
    lemmatization,
    co-occurrence-graph,
    molecular-cot,
    bond-types,
  ]

# Dependency graph
requires:
  - phase: 01-sheaf
    provides: GraphTypes.ts branded type patterns (VertexId/EdgeId) used for TextNodeId and StepId
  - phase: 02-lcm
    provides: LCM barrel export and interface patterns used as modeling reference

provides:
  - src/tna/interfaces.ts — all TNA domain types (TextNodeId, TextNode, TextEdge, GapMetrics, CommunityAssignment, TNAConfig, PreprocessResult, DetailedPreprocessResult)
  - src/types/MolecularCoT.ts — BondGraph class enforcing CovalentBond/HydrogenBond/VanDerWaalsBond behavioral invariants
  - src/tna/Preprocessor.ts — TF-IDF + wink-lemmatizer pipeline with surface form tracking
  - src/tna/CooccurrenceGraph.ts — 4-gram sliding window weighted co-occurrence graph via graphology
  - src/vendor-types.d.ts — TypeScript declarations for wink-lemmatizer and stopword (no @types/* packages exist)

affects:
  - 03-02 (LouvainDetector needs CooccurrenceGraph.getGraph())
  - 03-03 (CentralityAnalyzer needs CooccurrenceGraph nodes/edges)
  - 03-04 (GapDetector needs GapMetrics interface and CooccurrenceGraph)
  - 05-orchestrator (MolecularBond/BondGraph types for reasoning loop)
  - 04-soc (CooccurrenceGraph edges have createdAtIteration for surprising-edge-ratio)

# Tech tracking
tech-stack:
  added:
    - graphology@0.26.0 (undirected weighted graph with node/edge attributes)
    - natural@8.1.0 (TfIdf, WordTokenizer for TF-IDF computation)
    - wink-lemmatizer@3.0.4 (POS-aware morphological lemmatization: verb/noun/adjective)
    - stopword@3.1.5 (English stopword corpus removal)
    - graphology-communities-louvain@2.0.2 (Louvain community detection, used in Phase 3 Wave 2)
    - graphology-metrics@2.4.0 (betweenness centrality, used in Phase 3 Wave 3)
  patterns:
    - Lemmatize-before-insert invariant: ingest() calls preprocessDetailed() internally — no raw surface form reaches graph
    - POS-aware shortest-form lemmatization: try verb/noun/adjective, pick shortest; avoids Porter stemmer inconsistency
    - Surface form tracking: DetailedPreprocessResult.surfaceToLemma maps original tokens to lemmas for TextNode.surfaceForms
    - Type-system-enforced behavioral invariants: BondGraph class throws on constraint violation at creation time
    - AbstractGraph as type annotation: NodeNext ESM graphology import pattern to avoid namespace-as-type error

key-files:
  created:
    - src/tna/interfaces.ts
    - src/tna/Preprocessor.ts
    - src/tna/Preprocessor.test.ts
    - src/tna/CooccurrenceGraph.ts
    - src/tna/CooccurrenceGraph.test.ts
    - src/types/MolecularCoT.ts
    - src/vendor-types.d.ts
  modified:
    - src/types/index.ts (added MolecularCoT re-export)
    - package.json (added 5 new dependencies)

key-decisions:
  - "No Porter stemmer fallback in lemmatize(): wink result returned as-is if unchanged — prevents 'analyze'→'analyz' vs 'analyzing'→'analyze' inconsistency that would create phantom extra graph nodes"
  - "DetailedPreprocessResult extends PreprocessResult with surfaceToLemma map — enables CooccurrenceGraph to track surfaceForms without re-tokenizing asynchronously"
  - "GraphConstructor pattern for graphology: cast default import via AbstractGraph to avoid NodeNext ESM 'namespace as type' error"
  - "BondGraph enforces behavioral invariants at runtime with thrown Error — not metadata tags that could be bypassed"
  - "VAN_DER_WAALS_MIN_TRAJECTORY = 5.0 (based on paper's 5.32 average), HYDROGEN_DISTANCE_THRESHOLD = 0.7"
  - "ingestTokens() treats tokens as pre-lemmatized (no additional lemmatization) — used for unit testing window logic with exact token control"

patterns-established:
  - "Lemmatize-before-insert: raw text NEVER reaches graph; ingest() enforces this via internal preprocessDetailed() call"
  - "TextNodeId branded string = canonical lemma: the ID is the lemma, surfaceForms tracks all surface variants"
  - "createdAtIteration on every edge: set at ingest() time, required for Phase 4 SOC per-iteration surprising-edge-ratio"
  - "BondGraph class = behavioral invariants at construction time, not metadata tagging"

# Metrics
duration: 20min
completed: 2026-02-28
---

# Phase 3 Plan 01: TNA Foundation + MolecularCoT Bond Types Summary

**TF-IDF lemmatization pipeline (wink-lemmatizer POS-aware) + 4-gram weighted co-occurrence graph via graphology + BondGraph class enforcing covalent/hydrogen/VdW behavioral invariants at creation time**

## Performance

- **Duration:** 20 min
- **Started:** 2026-02-28T18:04:28Z
- **Completed:** 2026-02-28T18:24:54Z
- **Tasks:** 2/2
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments

- Installed 5 TNA npm packages (graphology, natural, wink-lemmatizer, stopword, graphology-communities-louvain, graphology-metrics)
- Defined all TNA domain types: TextNodeId branded type, TextNode with surfaceForms, TextEdge with createdAtIteration, GapMetrics, TNAConfig, PreprocessResult, DetailedPreprocessResult
- Defined MolecularCoT types: BondGraph class enforces hydrogen distance threshold (semanticDistance ≤ 0.7), VdW trajectory minimum (trajectoryLength ≥ 5.0), and covalent cascade invalidation via DFS
- Implemented Preprocessor with 11 tests: stopword removal, POS-aware lemmatization, TF-IDF scoring, case normalization, surface form mapping
- Implemented CooccurrenceGraph with 11 tests: 4-gram window weights (adj-1=3, adj-2=2, adj-3=1), edge accumulation, createdAtIteration tracking, surfaceForms population
- PRIMARY PITFALL GUARD: T6b confirmed — 80 word-occurrences (20x4 morphological variants of "analyze") collapse to ≤2 lemma nodes, not 80 nodes
- 22 new tests added; full suite 181 tests passing (159 existing + 22 new)

## Task Commits

1. **Task 1: Install TNA packages + TNA interfaces + MolecularCoT types** - `4d27ac3` (feat)
2. **Task 2: TDD Preprocessor + CooccurrenceGraph** - `b29625d` (feat)

## Files Created/Modified

- `src/tna/interfaces.ts` — TextNodeId, TextNode, TextEdge, GapMetrics, CommunityAssignment, TNAConfig, PreprocessResult, DetailedPreprocessResult
- `src/types/MolecularCoT.ts` — StepId, BondType, CovalentBond, HydrogenBond, VanDerWaalsBond, MolecularBond, BondGraph class with enforced behavioral invariants
- `src/tna/Preprocessor.ts` — Preprocessor class: lemmatize(), preprocess(), preprocessDetailed(), addDocument(), preprocessWithCorpus()
- `src/tna/Preprocessor.test.ts` — 11 tests: T1 (verb morphology), T1b (irregular verbs), T2 (stopwords), T2b (TF-IDF), T3/T3b (edge cases), T4 (case normalization), lemmatize() direct tests
- `src/tna/CooccurrenceGraph.ts` — CooccurrenceGraph class: ingest(), ingestTokens(), getGraph(), getNode(), getNodes(), getEdgeWeight(), order, size
- `src/tna/CooccurrenceGraph.test.ts` — 11 tests: T5 (4-gram weights), T5b (accumulation), T6 (lemmatization enforced), T6b (PRIMARY pitfall guard), T7 (graphology), T7b (positive weights), T8 (iteration tracking), T8b (surfaceForms)
- `src/vendor-types.d.ts` — TypeScript declarations for wink-lemmatizer and stopword (no @types/\* available)
- `src/types/index.ts` — Added MolecularCoT.js re-export
- `package.json` — Added graphology, natural, wink-lemmatizer, stopword, graphology-communities-louvain, graphology-metrics

## Decisions Made

1. **No Porter stemmer fallback in lemmatize()**: wink-lemmatizer's result is used if different from input; if unchanged, word is returned as-is. Porter stemmer would cause "analyze" → "analyz" while "analyzing" → "analyze" via wink, producing two graph nodes for the same concept. This inconsistency IS the node-count-explosion pitfall.

2. **DetailedPreprocessResult with surfaceToLemma**: Extended PreprocessResult to carry the surface-to-lemma mapping synchronously. Async tokenization workaround in original CooccurrenceGraph design was unreliable; the Preprocessor naturally has this data from pipeline step 4.

3. **GraphConstructor cast for graphology NodeNext ESM**: `const GraphConstructor = GraphologyLib as unknown as new(...) => AbstractGraph` — avoids TypeScript "Cannot use namespace as a type" error that occurs with NodeNext module resolution when the same identifier is used as constructor and type annotation.

4. **BondGraph class not interface**: Behavioral invariants (cascade invalidate, distance threshold, trajectory minimum) require runtime enforcement. Pure interfaces cannot enforce these. The class makes violations impossible at the API level, not just documented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed Porter stemmer fallback in lemmatize() to prevent node-count inconsistency**

- **Found during:** Task 2 (T6b test debugging)
- **Issue:** Porter.stem("analyze") = "analyz" while wink.verb("analyzing") = "analyze". Same concept, two different graph nodes. This is exactly the lemmatization pitfall.
- **Fix:** Removed Porter fallback entirely. Words where wink-lemmatizer returns unchanged input (already canonical) are kept as-is.
- **Files modified:** src/tna/Preprocessor.ts
- **Verification:** T6b passes — 80 analyze-variant tokens collapse to ≤2 nodes.
- **Committed in:** b29625d (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added DetailedPreprocessResult interface for synchronous surface form tracking**

- **Found during:** Task 2 (T8b test for surfaceForms)
- **Issue:** Original CooccurrenceGraph design used async import() to re-tokenize for surface form mapping. This is non-deterministic and fails in test environments.
- **Fix:** Added DetailedPreprocessResult to interfaces.ts and preprocessDetailed() to Preprocessor. Surface-to-lemma map computed synchronously during the pipeline.
- **Files modified:** src/tna/interfaces.ts, src/tna/Preprocessor.ts, src/tna/CooccurrenceGraph.ts
- **Verification:** T8b passes — surfaceForms contains "running" and "runs" for the "run" node.
- **Committed in:** b29625d (Task 2 commit)

**3. [Rule 1 - Bug] Fixed graphology import pattern for TypeScript NodeNext ESM**

- **Found during:** Task 1 (npx tsc --noEmit check)
- **Issue:** `import Graph from 'graphology'` → TypeScript error "Cannot use namespace as a type" in NodeNext mode.
- **Fix:** Import as `GraphologyLib`, cast via `AbstractGraph` for type annotation.
- **Files modified:** src/tna/CooccurrenceGraph.ts, src/vendor-types.d.ts
- **Verification:** Zero TypeScript errors after fix.
- **Committed in:** b29625d (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug — Porter inconsistency, 1 missing critical — surface form tracking, 1 bug — TypeScript import)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep. The Porter stemmer removal is the most important: without it, T6b (PRIMARY pitfall guard) fails, meaning lemmatization is broken for the exact "analyze/analyzing/analyzed" case documented in the pitfall research.

## Issues Encountered

- **graphology @types/\* not on npm**: The plan specified `npm install -D @types/graphology@0.26.0` but this package doesn't exist (404). Graphology ships its own types in the main package — no @types/\* needed.
- **wink-lemmatizer and stopword have no @types/\***: Created `src/vendor-types.d.ts` with handwritten shims for both packages.

## Next Phase Readiness

Phase 3 Wave 1 foundation is complete:

- CooccurrenceGraph is ready for LouvainDetector (03-02: `getGraph()` returns graphology instance)
- CooccurrenceGraph is ready for CentralityAnalyzer (03-03: `getNodes()` and `getGraph()`)
- GapMetrics interface ready for GapDetector (03-04)
- BondGraph class ready for Orchestrator reasoning loop (Phase 5)
- createdAtIteration on all edges enables Phase 4 SOC per-iteration surprising-edge-ratio (Pitfall 9 prevention confirmed)

Pitfall watch updates:

- "4-gram window without lemmatization" → **RESOLVED: T6b guards permanently**
- "Bond types as metadata only" → **RESOLVED: BondGraph class enforces invariants at creation time**

---

_Phase: 03-tna-molecular-cot_
_Completed: 2026-02-28_
