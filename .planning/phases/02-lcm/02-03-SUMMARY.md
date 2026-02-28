---
phase: 02-lcm
plan: 03
subsystem: context-management
tags: [immutable-store, uuidv7, sha256, gpt-tokenizer, embeddings, tdd, defense-in-depth]

# Dependency graph
requires:
  - phase: 01-sheaf
    provides: TypeScript 5.9.3+NodeNext pattern, vitest 4.0.18 config, branded types pattern
provides:
  - Append-only ImmutableStore with compile-time + runtime immutability (Object.freeze + ReadonlyArray)
  - UUIDv7 time-sortable entry IDs — lexicographic order = insertion order
  - SHA-256 content integrity hash computed at append time
  - GptTokenCounter (deterministic BPE token counting, no LLM)
  - MockEmbedder (deterministic hash-to-384-dim embedding, no model loading)
  - MockCompressor (prefix truncation stub for tests)
  - LCMClient thin coordinator that wires ImmutableStore + EmbeddingCache at append time
  - EmbeddingCache forward declaration (full implementation in plan 02-04)
  - testStoreFactory helpers (createPopulatedStore, createDefaultPopulatedStore) for Wave 2/3 tests
  - IEmbedder, ICompressor, ITokenCounter injectable contracts for all LCM components
  - LCMEntry, EscalationThresholds, ExpandLevel, SummaryNode, MetricUpdate type definitions
affects:
  - 02-04-PLAN.md (EmbeddingCache full implementation — depends on IEmbedder, ImmutableStore)
  - 02-05-PLAN.md (EscalationProtocol — depends on ImmutableStore, ITokenCounter, EscalationThresholds)
  - 02-06-PLAN.md (ContextDAG, lcm_grep, lcm_expand — depends on ImmutableStore, LCMClient, SummaryNode)

# Tech tracking
tech-stack:
  added:
    - "@huggingface/transformers@3.8.1 — production embedding model (all-MiniLM-L6-v2, 384-dim)"
    - "gpt-tokenizer@3.4.0 — deterministic BPE token counting"
    - "uuidv7@1.1.0 — time-sortable UUIDs for entry IDs"
  patterns:
    - "Defense-in-depth immutability: Object.freeze(entry) at runtime + readonly fields at compile time + ReadonlyArray return"
    - "Injectable dependency pattern: ITokenCounter/IEmbedder/ICompressor injected so tests use mocks, production uses real implementations"
    - "Thin coordinator pattern: LCMClient wires two pure components (ImmutableStore + EmbeddingCache) without mixing concerns"
    - "Private class fields (#entries, #idIndex) for true encapsulation preventing subclass access"
    - "Forward declaration pattern: EmbeddingCache stub in Wave 1 enables LCMClient wiring test without Wave 2 dependency"

key-files:
  created:
    - "src/lcm/interfaces.ts — all LCM type definitions and injectable contracts + mock implementations"
    - "src/lcm/ImmutableStore.ts — append-only store, defense-in-depth immutability"
    - "src/lcm/ImmutableStore.test.ts — 14 tests covering all immutability invariants and LCMClient wiring"
    - "src/lcm/LCMClient.ts — thin coordinator wiring ImmutableStore + EmbeddingCache"
    - "src/lcm/EmbeddingCache.ts — forward declaration for Wave 1 (full impl plan 02-04)"
    - "src/lcm/helpers/testStoreFactory.ts — createPopulatedStore + createDefaultPopulatedStore"
  modified:
    - "package.json — added @huggingface/transformers, gpt-tokenizer, uuidv7"

key-decisions:
  - "getAll() returns Object.freeze([...#entries]) — frozen shallow copy ensures runtime mutation throws TypeError without preventing future appends to backing array"
  - "EmbeddingCache forward-declared in Wave 1 as a stub — LCMClient wiring test (T1d) runs now without waiting for plan 02-04"
  - "LCMClient stores embedder as constructor arg (matching plan spec) but delegates embedding to EmbeddingCache.cacheEntry() — single responsibility maintained"
  - "MockEmbedder uses SHA-256 seed + Math.sin(seed+i) + L2-normalize — deterministic, no model loading, consistent with 02-RESEARCH.md spec"

patterns-established:
  - "TDD in LCM: RED (tests fail because files absent) → GREEN (implement until 14 tests pass) → REFACTOR (frozen copy for getAll)"
  - "Fresh store per test: new ImmutableStore(new GptTokenCounter()) — no shared state, no reset()"
  - "Module resolution: .js extensions in all imports (NodeNext moduleResolution)"

# Metrics
duration: 6min
completed: 2026-02-28
---

# Phase 2 Plan 3: ImmutableStore and LCM Interfaces Summary

**Append-only ImmutableStore with UUIDv7 IDs, SHA-256 hashes, and defense-in-depth immutability (Object.freeze + ReadonlyArray), plus LCMClient coordinator wiring ImmutableStore to EmbeddingCache at append time**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-28T10:40:13Z
- **Completed:** 2026-02-28T10:46:22Z
- **Tasks:** 2/2
- **Files modified:** 6 created, 1 modified

## Accomplishments

- Installed three LCM npm packages: @huggingface/transformers@3.8.1, gpt-tokenizer@3.4.0, uuidv7@1.1.0
- Built ImmutableStore with defense-in-depth immutability: readonly TypeScript fields + Object.freeze at runtime + frozen ReadonlyArray from getAll()
- Defined all shared LCM interfaces and type system (LCMEntry, EscalationThresholds, ExpandLevel, SummaryNode, IEmbedder, ICompressor, ITokenCounter) plus three implementations (GptTokenCounter, MockEmbedder, MockCompressor)
- Implemented LCMClient thin coordinator — embedding is cached at append time, closing the STATE.md wiring gap
- All 14 tests green, 120 total tests passing (no Phase 1 regressions)
- Created testStoreFactory helper with 10 varied default entries for Wave 2/3 downstream tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Install npm packages and create LCM interfaces** — `fc7e7cf` (feat)
2. **Task 2: TDD ImmutableStore with defense-in-depth immutability** — `b400779` (feat)

## Files Created/Modified

- `src/lcm/interfaces.ts` — LCMEntry, EMBEDDING_DIM, EscalationThresholds, EscalationLevel, ExpandLevel, SummaryNode, MetricUpdate; IEmbedder, ICompressor, ITokenCounter; GptTokenCounter, MockEmbedder, MockCompressor
- `src/lcm/ImmutableStore.ts` — Append-only store: uuidv7() IDs, SHA-256 hash, Object.freeze at append, frozen ReadonlyArray from getAll(), private #entries + #idIndex, no update/delete/clear/reset
- `src/lcm/ImmutableStore.test.ts` — 14 tests: T1 freeze, T1b TypeError, T2 UUIDv7, T2b time-sort, T3 hash, T3b hash-diff, T4 tokenCount, T4b gpt-tokenizer match, T5 sequenceNumber, T6 ReadonlyArray runtime, T6b get(id), T6c get(nonexistent), T7 getRange, T1d LCMClient wiring
- `src/lcm/LCMClient.ts` — Thin coordinator: append() calls store.append() then cache.cacheEntry(), exposes store getter
- `src/lcm/EmbeddingCache.ts` — Forward declaration stub (full implementation in plan 02-04)
- `src/lcm/helpers/testStoreFactory.ts` — createPopulatedStore(entries[]), createDefaultPopulatedStore() with 10 varied entries
- `package.json` — Added three new dependencies

## Decisions Made

- `getAll()` returns `Object.freeze([...#entries])` — a frozen shallow copy so runtime mutation throws TypeError while the backing array can still grow on append. This was an auto-fix (Rule 1) when the initial implementation returned the live reference and T6 showed push() succeeded.
- `EmbeddingCache.ts` forward-declared as Wave 1 stub — allows LCMClient to import and T1d to run without waiting for plan 02-04.
- `LCMClient` embedder stored as constructor arg per plan spec but the actual embedding is done by `EmbeddingCache.cacheEntry()` internally — preserves single responsibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] getAll() returned live mutable array reference**
- **Found during:** Task 2 (GREEN phase, T6 test failure)
- **Issue:** `getAll()` returned `this.#entries as ReadonlyArray<LCMEntry>` — at runtime this is still a mutable JS array. T6 cast and pushed to it, and the push succeeded, causing `store.getAll().length` to be 3 instead of 2.
- **Fix:** Changed to return `Object.freeze([...this.#entries]) as ReadonlyArray<LCMEntry>` — a frozen shallow copy. Push now throws TypeError, T6 catches it and store size stays at 2.
- **Files modified:** `src/lcm/ImmutableStore.ts`
- **Verification:** T6 and all 14 tests pass after fix.
- **Committed in:** `b400779` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Auto-fix was necessary for the defense-in-depth immutability guarantee. ReadonlyArray without Object.freeze gives only compile-time protection; the fix adds runtime protection matching the must_have truth "getAll() returns ReadonlyArray — no push/pop/splice at compile time".

## Issues Encountered

None — plan executed cleanly after the auto-fix.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Plan 02-04 (EmbeddingCache):** IEmbedder interface and MockEmbedder ready. EmbeddingCache.ts has a forward declaration with the method signatures. createDefaultPopulatedStore() available for realistic test setup.
- **Plan 02-05 (EscalationProtocol):** ITokenCounter, GptTokenCounter, EscalationThresholds, EscalationLevel, SummaryNode all defined. ImmutableStore.totalTokens getter available.
- **Pitfall resolved:** "LCM store is mutable" (STATE.md watch) — T1b (TypeError on mutation) and T6 (frozen getAll snapshot) guard this permanently.

---
*Phase: 02-lcm*
*Completed: 2026-02-28*
