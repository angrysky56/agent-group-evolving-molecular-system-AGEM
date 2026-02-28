# Phase 2: LCM Dual-Memory Architecture - Research

**Researched:** 2026-02-27
**Domain:** Append-only context management, semantic search, async streaming, TypeScript immutability
**Confidence:** HIGH (stack), MEDIUM (escalation algorithm), HIGH (architecture patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Immutability Enforcement
- **Enforcement:** Both compile-time (TypeScript readonly) and runtime (Object.freeze) for defense-in-depth
- **Test isolation:** Claude's discretion — fresh instances per test OR reset() method. Both approaches work.
- **Integrity verification:** Claude's discretion — SHA-256 hashing OR lightweight checksum. Choose most practical for the use case.
- **API surface:** Claude's discretion — expose readonly array directly OR only accessor methods (get, getAll, getRange). Either works.

#### Escalation Protocol
- **Level 1 → Level 2 trigger:** Event-driven escalation with **variable compression % based on token count**
  - Uses **multi-compression indexing** — compress at strategic points in the hierarchy, not all entries at once
  - Verify coherence by chunking through original entries and checking information containment
  - Prevents loss of semantic flavor (e.g., complex works like "War and Peace" retain structure across compressions)
- **Level 2 → Level 3 trigger:** When compression fails or achieves insufficient ratio
  - **Level 3 strategy:** Chunking first (keep multiple compressed summaries), fall back to **deterministic truncation at K tokens**
  - Always deterministic—no LLM inference in L3
- **Thresholds:** Runtime-adjustable (can be changed during a session), not hardcoded
- **LLM usage:** Levels 1-2 can use LLM for smart compression/summarization; Level 3 is guaranteed deterministic

#### Summary Node Design
- **Purpose:** Both lineage tracking (pointers to original entries) AND optimization metrics (compression stats)
- **Metadata:** Creation timestamp + version tracking (for debugging drift over time)
- **Mutability:** Mutable but tracked — summary content is immutable, but metrics/tags can be updated and changes are auditable
- **Storage location:** Separate SummaryIndex structure (not appended to ImmutableStore)

#### Grep/Expand Interface
- **lcm_grep query method:** Semantic search via embedding-based similarity (not keyword matching or regex)
  - Embedding caching strategy: Hybrid — precomputed and cached at append time, but recomputation can be forced
- **lcm_expand return value:** Hierarchical table of contents structure: Summary → Intermediate Compressions → Original Entries
  - Summary acts as a table of contents
  - Each intermediate compression points to the next level down
  - LLM can traverse and sample specific original entries on-demand
- **Data retrieval pattern:** Lazy/streaming — lcm_expand returns async generator/iterator
  - LLM requests next level of detail as needed
  - Memory-efficient for deep hierarchies
  - No need to eagerly load the entire table of contents

### Claude's Discretion
- Test isolation strategy for ImmutableStore (fresh instances vs. reset())
- Hash integrity verification approach and algorithm choice
- API surface for store access (direct readonly array vs. accessor methods only)
- Exact embedding model for semantic search (consistency with TNA embeddings or separate?)
- Exact async generator implementation for lcm_expand

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within Phase 2 scope. (LLM inference models for TNA/SOC embedding selection are out of scope for Phase 2; those decisions happen in Phase 3-4.)
</user_constraints>

---

## Summary

Phase 2 builds a deterministic, append-only context management system. Unlike the Sheaf phase (highest mathematical risk), LCM's primary risk is architectural: once the ImmutableStore ships without proper defense-in-depth immutability, every subsequent phase that depends on context storage will silently corrupt state. The immutability guarantee is binary — either the store enforces it completely or it doesn't. The three-level escalation protocol has a convergence guarantee only if Level 3 (deterministic truncation) exists as a hard exit path.

The embedding requirement (@huggingface/transformers v3 with all-MiniLM-L6-v2) brings native bindings (onnxruntime-node) into the project for the first time. This has important implications for test isolation: the embedding pipeline must be injectable via an interface so unit tests can run without loading ONNX weights. All LCM primitives (lcm_grep, lcm_expand) must accept an `IEmbedder` interface rather than hardcoding the HuggingFace dependency. This keeps tests fast and avoids native-binding issues in Vitest's `pool: 'forks'` environment.

The async generator pattern for `lcm_expand` is natively supported in TypeScript targeting ES2022 (the project's current target) and requires no additional libraries. Token counting uses `gpt-tokenizer` (pure JS, synchronous, no WASM, zero dependencies), which is the only reliable library for counting tokens without native bindings.

**Primary recommendation:** Build ImmutableStore first with both compile-time readonly and runtime Object.freeze, use fresh instances for test isolation (no reset() needed), define IEmbedder as an injectable interface, wire real embeddings via @huggingface/transformers, and use gpt-tokenizer for all token counting. Keep SummaryIndex separate from ImmutableStore exactly as decided.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@huggingface/transformers` | 3.8.1 | ONNX-based text embeddings via `feature-extraction` pipeline | Only JS-native transformer inference library with verified Node.js ESM support; wraps onnxruntime-node automatically |
| `gpt-tokenizer` | 3.4.0 | Synchronous token counting for escalation thresholds | Pure JS/TypeScript, no WASM, no native bindings, synchronous, ESM-compatible; zero deps |
| `uuidv7` | 1.1.0 | Time-sortable entry IDs for ImmutableStore | Embeds monotonic timestamp in UUID; entries sort lexicographically by creation time with no collision risk |
| `node:crypto` (built-in) | Node 22 LTS | SHA-256 hash for entry integrity | Zero-dependency; `createHash('sha256').update(content).digest('hex')` is synchronous and stable |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:events` (built-in) | Node 22 LTS | EventEmitter base class for escalation events | Escalation protocol notifies callers when threshold crossed; same pattern as Phase 1 CohomologyAnalyzer |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@huggingface/transformers` | `embeddings.js`, OpenAI API | embeddings.js is simpler but offline-only; OpenAI requires network + API key; HF transformers works offline and models are standard |
| `gpt-tokenizer` | `tiktoken` (WASM), `js-tiktoken` | tiktoken ships WASM binaries; gpt-tokenizer is pure JS + synchronous — critical for determinism in L3 escalation |
| `uuidv7` | `ulid` (3.0.2), `Date.now()` counter | ulid is fine alternative; `Date.now()` risks collisions in same millisecond; uuidv7 has monotonic guarantee |
| `node:crypto` SHA-256 | MurmurHash, xxHash | SHA-256 needs zero extra packages; MurmurHash/xxHash require npm installs; integrity is not hot path |

**Installation:**
```bash
npm install @huggingface/transformers gpt-tokenizer uuidv7
```
`node:crypto` and `node:events` are Node.js built-ins — no install needed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/lcm/
├── ImmutableStore.ts         # LCM-01: append-only store, time-sequenced IDs, SHA-256 integrity
├── ContextDAG.ts             # LCM-02: DAG with SummaryNode pointer references
├── SummaryIndex.ts           # Summary node storage (separate from ImmutableStore)
├── EscalationProtocol.ts     # LCM-03: three-level escalation coordinator
├── LCMGrep.ts                # LCM-04: lcm_grep semantic search via embedding similarity
├── LCMExpand.ts              # LCM-05: lcm_expand async generator, hierarchical unrolling
├── EmbeddingCache.ts         # Hybrid cache: precomputed at append, force-refresh on demand
├── interfaces.ts             # IEmbedder, ICompressor, ITokenCounter — injectable contracts
├── index.ts                  # Public barrel export
├── ImmutableStore.test.ts    # T1-T4: immutability, entry IDs, hash integrity, append semantics
├── ContextDAG.test.ts        # T5-T6: DAG structure, SummaryNode pointers, lineage
├── EscalationProtocol.test.ts# T7-T9: L1/L2/L3 triggers, threshold config, L3 determinism
├── LCMGrep.test.ts           # T10-T11: semantic search, cosine similarity ranking, caching
├── LCMExpand.test.ts         # T12-T13: async generator, hierarchical traversal, lazy loading
├── isolation.test.ts         # T14: zero cross-module imports (mirrors sheaf/isolation.test.ts)
└── helpers/
    └── testStoreFactory.ts   # Build pre-populated ImmutableStore instances for tests
```

### Pattern 1: Defense-in-Depth Immutability

**What:** Compile-time `readonly` blocks mutation at TypeScript level. Runtime `Object.freeze` blocks mutation in JavaScript if types are bypassed (e.g., via `as any`).

**When to use:** Every entry appended to ImmutableStore.

```typescript
// Source: MDN Object.freeze + TypeScript readonly combination
export interface LCMEntry {
  readonly id: string;           // UUIDv7 — time-sortable
  readonly content: string;
  readonly tokenCount: number;
  readonly hash: string;         // SHA-256 of content
  readonly timestamp: number;    // Date.now() at append time
  readonly sequenceNumber: number; // monotonically increasing counter
}

class ImmutableStore {
  // Private mutable backing array — never exposed directly
  readonly #entries: LCMEntry[] = [];

  append(content: string): LCMEntry {
    const entry: LCMEntry = Object.freeze({
      id: uuidv7(),
      content,
      tokenCount: countTokens(content),
      hash: createHash('sha256').update(content).digest('hex'),
      timestamp: Date.now(),
      sequenceNumber: this.#entries.length,
    });
    this.#entries.push(entry);
    return entry;
  }

  // Expose only ReadonlyArray — compile-time: no push/pop/splice
  getAll(): ReadonlyArray<LCMEntry> {
    return this.#entries;
  }
}
```

**Anti-pattern:** Do NOT use `public readonly entries: LCMEntry[] = []`. That exposes the mutable array reference behind a readonly binding — callers can still call `.push()` on it because `readonly` only prevents reassignment of the array reference, not mutation of the array contents.

### Pattern 2: Injectable IEmbedder Interface

**What:** LCMGrep depends on an `IEmbedder` interface, not on `@huggingface/transformers` directly. Tests inject a fast synchronous mock. Production wires the real pipeline.

**When to use:** Everywhere embeddings are needed (LCMGrep, EmbeddingCache).

```typescript
// Source: Dependency injection pattern for testability
export interface IEmbedder {
  embed(text: string): Promise<Float64Array>;
}

// Production implementation — in EmbeddingCache.ts
import { pipeline } from '@huggingface/transformers';

export class TransformersEmbedder implements IEmbedder {
  private static instance: TransformersEmbedder | null = null;
  private extractor: Awaited<ReturnType<typeof pipeline>> | null = null;

  static async getInstance(): Promise<TransformersEmbedder> {
    if (!TransformersEmbedder.instance) {
      TransformersEmbedder.instance = new TransformersEmbedder();
    }
    return TransformersEmbedder.instance;
  }

  async embed(text: string): Promise<Float64Array> {
    if (!this.extractor) {
      this.extractor = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2'
      );
    }
    const result = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float64Array(result.tolist()[0]);
  }
}

// Test stub — synchronous, zero latency
export class MockEmbedder implements IEmbedder {
  async embed(text: string): Promise<Float64Array> {
    // Deterministic: hash text to 384-dim vector
    const vec = new Float64Array(384);
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed += text.charCodeAt(i);
    for (let i = 0; i < 384; i++) vec[i] = Math.sin(seed + i);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return vec.map(v => v / norm);
  }
}
```

### Pattern 3: Async Generator for lcm_expand

**What:** `lcm_expand` returns an `AsyncGenerator` that lazily yields levels of the hierarchy. Consumer uses `for await...of` and stops when it has enough context.

**When to use:** LCMExpand, any hierarchical traversal.

```typescript
// Source: TypeScript async generator — ES2022 target supports natively
export type ExpandLevel =
  | { kind: 'summary'; nodeId: string; content: string }
  | { kind: 'compression'; level: number; content: string; pointsTo: string[] }
  | { kind: 'entry'; entryId: string; content: string; tokenCount: number };

export async function* lcm_expand(
  summaryNodeId: string,
  dag: ContextDAG
): AsyncGenerator<ExpandLevel> {
  // Level 0: yield the summary (table of contents)
  const summary = dag.getSummaryNode(summaryNodeId);
  yield { kind: 'summary', nodeId: summaryNodeId, content: summary.content };

  // Level 1+: yield intermediate compressions lazily
  for (const compression of summary.intermediateCompressions) {
    yield {
      kind: 'compression',
      level: compression.level,
      content: compression.content,
      pointsTo: compression.childIds,
    };
  }

  // Level N: yield original entries (most expensive — only if consumer asks)
  for (const entryId of summary.originalEntryIds) {
    const entry = dag.getEntry(entryId);
    yield { kind: 'entry', entryId, content: entry.content, tokenCount: entry.tokenCount };
  }
}

// Consumer pattern:
for await (const level of lcm_expand(nodeId, dag)) {
  if (level.kind === 'summary') {
    // Use summary for overview
  } else if (level.kind === 'entry') {
    // Drill into specific entry
    break; // Stop early — no need to load rest
  }
}
```

### Pattern 4: Escalation Protocol with Injectable ICompressor

**What:** EscalationProtocol orchestrates three levels. Level 1 and 2 accept an `ICompressor` interface (LLM-backed or stub). Level 3 is always deterministic token truncation using `gpt-tokenizer`.

**When to use:** EscalationProtocol, triggered when store token count exceeds runtime-adjustable threshold.

```typescript
export interface ICompressor {
  compress(text: string, targetRatio: number): Promise<string>;
}

export interface EscalationThresholds {
  level1TokenLimit: number;     // trigger L1 (nuanced compression)
  level2MinRatio: number;       // L2 if L1 output/input ratio > this (insufficient compression)
  level3KTokens: number;        // L3 hard truncation target
}

// Level 3 — deterministic, no LLM inference
function deterministicTruncate(text: string, kTokens: number): string {
  // gpt-tokenizer encode + slice + decode — no LLM call ever
  const tokens = encode(text);
  if (tokens.length <= kTokens) return text;
  return decode(tokens.slice(0, kTokens));
}
```

### Pattern 5: Test Isolation — Fresh Instances (Not reset())

**Recommendation:** Use fresh `ImmutableStore` instances in each test. The `Object.freeze` pattern means reset() would need to create a new backing array anyway (you can't un-freeze). Fresh instances are simpler and more composable.

```typescript
// Recommended test pattern (mirrors Phase 1 sheaf tests)
describe('ImmutableStore', () => {
  it('T1: append returns frozen entry', () => {
    const store = new ImmutableStore();  // fresh each test
    const entry = store.append('hello');
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('T2: mutation throws in strict mode', () => {
    const store = new ImmutableStore();
    const entry = store.append('hello');
    expect(() => {
      (entry as any).content = 'modified';
    }).toThrow(TypeError);
  });
});
```

### Anti-Patterns to Avoid

- **Exposing mutable backing array:** `public entries: LCMEntry[]` — callers can call `.push()`, breaking immutability completely.
- **Resetting a frozen store:** Adding a `reset()` method creates a false sense that "the store was empty" in tests while old entries may linger in refs.
- **Hardcoding LLM inference in Level 3:** Any `await llm.compress()` in the L3 path breaks the determinism guarantee and can deadlock (if the LLM is unavailable, L3 never exits).
- **Storing SummaryNodes inside ImmutableStore:** Summary nodes are mutable (metrics/tags can be updated). Mixing mutable SummaryIndex data into the append-only ImmutableStore violates the separation of concerns — keep them strictly separate.
- **Eager embedding on lcm_grep startup:** Loading the ONNX model at module import time causes 1-3 second delays in every test file that imports LCMGrep. Use the singleton pattern with lazy initialization.
- **Synchronous embedding API:** Embeddings via @huggingface/transformers are async. Any `IEmbedder` that returns `Float64Array` (not `Promise<Float64Array>`) will be wrong and force awkward workarounds.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom whitespace-splitting heuristic | `gpt-tokenizer@3.4.0` | BPE tokenization is non-trivial; whitespace splitting is wrong for GPT models by 30-50% |
| Time-sortable unique IDs | `Date.now() + Math.random()` | `uuidv7@1.1.0` | Collision risk in same millisecond; UUIDv7 has monotonic generation with guaranteed ordering |
| Text embeddings | TF-IDF cosine similarity | `@huggingface/transformers@3.8.1` + all-MiniLM-L6-v2 | TF-IDF misses semantic similarity ("happy" vs "joyful"); sentence embeddings capture meaning |
| SHA-256 hashing | CRC32, Adler-32, or string length | `node:crypto` built-in | CRC32/Adler are for error detection, not integrity; SHA-256 is collision-resistant with zero extra deps |
| Async generator streaming | Manual queue + polling | Native `async function*` | ES2022 target supports it natively; no library needed; standard, well-understood protocol |

**Key insight:** The LCM stack is deliberately lean. The only new npm packages are `@huggingface/transformers`, `gpt-tokenizer`, and `uuidv7`. Everything else (crypto, events, async generators) is native Node.js or TypeScript. This keeps the dependency surface small and all packages above are zero-transitive-dependency or have stable, audited deps.

---

## Common Pitfalls

### Pitfall 1: Shallow Object.freeze on Nested Structures
**What goes wrong:** `Object.freeze(entry)` freezes the top-level `LCMEntry` object but not nested objects. If `content` were an object (e.g., `{ text: string; metadata: object }`), the `metadata` field would still be mutable.
**Why it happens:** `Object.freeze` is shallow by design.
**How to avoid:** Keep `LCMEntry` fields to primitives only (string, number, boolean). Avoid nested objects in the entry schema. If nested objects are needed in future, apply `Object.freeze` recursively.
**Warning signs:** Tests use nested objects in entry content; a mutation test on a nested field passes when it should fail.

### Pitfall 2: LCM Store Is Mutable (Highest Priority Pitfall from STATE.md)
**What goes wrong:** ImmutableStore allows mutation — test isolation then requires clearing the store between tests, which is a red flag.
**Why it happens:** Using `public entries: LCMEntry[]` (mutable array) instead of `readonly #entries: LCMEntry[]` with `ReadonlyArray<LCMEntry>` exposure.
**How to avoid:** Two tests that must pass from day 1: (a) `Object.isFrozen(entry) === true` immediately after `append()`, and (b) attempting `(entry as any).content = 'x'` throws `TypeError` in strict mode. If either fails, the store is broken.
**Warning signs:** Tests need to call `store.clear()` or create a new store factory to reset state between tests.

### Pitfall 3: Escalation L3 Missing (Second Priority Pitfall from STATE.md)
**What goes wrong:** The escalation protocol has no hard truncation path. When L1 and L2 both produce outputs longer than their inputs (this can happen with verbose LLMs), the protocol loops indefinitely or throws.
**Why it happens:** Assuming LLM compression always reduces token count — it doesn't for dense technical content.
**How to avoid:** The L3 path must exist as unreachable-in-practice but always-present code. A test must force activation: feed the protocol an input where L1 output > input AND L2 output > input. Verify L3 activates deterministically (no LLM call) and the output token count is exactly `≤ kTokens`.
**Warning signs:** EscalationProtocol has no `deterministicTruncate` function; all three levels use `await compressor.compress()`.

### Pitfall 4: Embedding Model Cold Start in Tests
**What goes wrong:** Tests import `LCMGrep` which loads `@huggingface/transformers` which downloads and initializes a 90MB ONNX model. Test suite takes 30+ seconds.
**Why it happens:** Not using the `IEmbedder` interface injection pattern — hardcoding the real embedder.
**How to avoid:** All test files inject `MockEmbedder`. Only integration tests (opt-in) use the real model. The isolation test (T14) verifies that production LCM files import from `interfaces.ts`, not from `@huggingface/transformers` directly.
**Warning signs:** Running the test suite without network access fails; or running it the first time takes >10 seconds per test file.

### Pitfall 5: Context DAG Cycles via Pointer Mismanagement
**What goes wrong:** A SummaryNode is given a pointer back to itself or creates a reference cycle through two summary nodes.
**Why it happens:** DAG acyclicity is not enforced — just assumed.
**How to avoid:** On every `SummaryIndex.add(node)`, verify no path from the new node's `originalEntryIds` leads back to the node itself. For Phase 2's use case (linear append + summarize), a simple check suffices: a summary node cannot point to another summary node that points back to it. A cycle test in ContextDAG.test.ts using `toThrow()` is the guard.
**Warning signs:** `lcm_expand` on a cyclic graph hangs forever (infinite async generator loop).

### Pitfall 6: Token Counter Mismatch Between Escalation and LLM
**What goes wrong:** EscalationProtocol counts tokens with `gpt-tokenizer` (cl100k_base or o200k_base encoding) but the LLM compressor uses a different model with a different tokenizer. A threshold of 4096 tokens may mean 5500 tokens by the LLM's count.
**Why it happens:** Token counting is treated as a simple word count. Different models tokenize differently.
**How to avoid:** Document that thresholds in `EscalationThresholds` are denominated in `gpt-tokenizer` tokens (o200k_base, the default). Callers who use non-OpenAI LLMs should calibrate thresholds empirically. This is a known limitation, not a bug — document it in a code comment.
**Warning signs:** L1 triggers at 4096 tokens but the LLM receives 6000+ tokens and responds with a compressed version that is still 5000 tokens (still over threshold).

### Pitfall 7: SummaryNode Metrics Mutation Not Audited
**What goes wrong:** `SummaryNode.compressionRatio` is updated after the fact (correct per decision), but the update is not logged. Over time it becomes impossible to reconstruct the compression history.
**Why it happens:** Treating SummaryNode as a plain mutable object with no audit trail.
**How to avoid:** SummaryNode metrics should use a versioned update pattern: each update appends a `MetricUpdate` record (timestamp + field + old + new) to a log. The `compressionRatio` getter returns the latest value; the `metricHistory` array provides the full audit trail.
**Warning signs:** SummaryNode has `compressionRatio: number` as a plain writable field with no update history.

---

## Code Examples

Verified patterns from official sources and current stack:

### Token Counting with gpt-tokenizer
```typescript
// Source: github.com/niieani/gpt-tokenizer — synchronous, no async needed
import { encode, countTokens } from 'gpt-tokenizer';

// Fast path: count only
const count = countTokens('hello world');  // returns number directly

// Full path: encode to token array, then truncate
const tokens = encode(longText);
const truncated = decode(tokens.slice(0, 4096));
```

### Text Embedding with @huggingface/transformers v3
```typescript
// Source: Context7 — /huggingface/transformers.js, feature-extraction pattern
import { pipeline, cos_sim } from '@huggingface/transformers';

const extractor = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

const embedding = await extractor('This is a context entry.', {
  pooling: 'mean',
  normalize: true,  // required for cosine similarity to work correctly
});

const vector = new Float64Array(embedding.tolist()[0]);  // 384-dim

// Cosine similarity between two embeddings
const similarity = cos_sim(vec1, vec2);  // returns [-1, 1]
```

### Integrity Hash with node:crypto
```typescript
// Source: Node.js built-in crypto, verified synchronous pattern
import { createHash } from 'node:crypto';

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
```

### Async Generator for Hierarchical Traversal
```typescript
// Source: TypeScript async generator — ES2022 target, no polyfill needed
async function* lcm_expand(
  summaryId: string,
  dag: ContextDAG
): AsyncGenerator<ExpandLevel, void, unknown> {
  const summary = dag.getSummaryNode(summaryId);
  yield { kind: 'summary', nodeId: summaryId, content: summary.content };

  for (const comp of await summary.getCompressions()) {
    yield { kind: 'compression', ...comp };
  }

  for (const entryId of summary.originalEntryIds) {
    const entry = dag.getEntry(entryId);
    yield { kind: 'entry', entryId, content: entry.content };
  }
}

// Test pattern for async generators:
it('T12: lcm_expand yields summary first', async () => {
  const gen = lcm_expand(testNodeId, dag);
  const first = await gen.next();
  expect(first.value.kind).toBe('summary');
  await gen.return(undefined);  // clean up
});
```

### UUIDv7 Time-Sortable IDs
```typescript
// Source: npm info uuidv7 — Apache-2.0, zero deps
import { uuidv7 } from 'uuidv7';

const id1 = uuidv7();  // e.g., '01936c58-b000-7000-...'
const id2 = uuidv7();  // guaranteed: id1 < id2 lexicographically (monotonic)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` (v2) | `@huggingface/transformers` (v3) | 2024 (v3 release) | Package was renamed/moved to official HF org; old package still works but v3 is the canonical |
| `tiktoken` (WASM) | `gpt-tokenizer` (pure JS) | 2023-2024 | WASM caused bundling issues in many environments; pure JS alternative is now faster per benchmarks |
| UUID v4 (random) | UUID v7 (time-sorted) | RFC 9562, 2024 | v7 embeds timestamp for lexicographic sort; eliminates need for separate sequence number in some designs |
| In-memory rolling window | Append-only log + DAG summarization | 2024-2025 | Rolling window loses history; DAG with pointer-based summary preserves full lineage while controlling token budget |

**Deprecated/outdated:**
- `@xenova/transformers`: Superseded by `@huggingface/transformers`. Both work, but only the latter is actively maintained. Install `@huggingface/transformers`.
- Synchronous `crypto.subtle.digest()` calls: `SubtleCrypto.digest()` is async (Promise-based). Use `createHash` from `node:crypto` for synchronous integrity hashing in the hot path.

---

## Open Questions

1. **Embedding model for lcm_grep: share with TNA (Phase 3) or separate?**
   - What we know: Phase 3 (TNA) will also use embeddings for semantic similarity. The project's STATE.md flags "Embedding model selection: same or different for SOC/TNA" as an open question before Phase 4. All embeddings in this project must be consistent or the cosine similarity comparisons across modules will be meaningless.
   - What's unclear: Whether lcm_grep in Phase 2 should reserve `all-MiniLM-L6-v2` (384-dim) as the canonical embedding model for all phases, or leave the door open for TNA to use a different model.
   - Recommendation: Commit `all-MiniLM-L6-v2` (384-dim) as the Phase 2 embedding model via `TransformersEmbedder`. Define the output dimension as a constant `EMBEDDING_DIM = 384` in `interfaces.ts`. When Phase 3 starts, it can either reuse the same model or the `IEmbedder` interface allows swapping without touching LCM code.

2. **Runtime-adjustable thresholds: session-local or process-global?**
   - What we know: Thresholds "can be changed during a session." The EscalationProtocol must accept thresholds at construction time or via a setter.
   - What's unclear: Whether the Phase 5 Orchestrator needs to change thresholds mid-session without recreating the protocol instance.
   - Recommendation: Accept `thresholds` as a constructor parameter AND provide a `setThresholds(thresholds: EscalationThresholds): void` setter. This covers both cases. Setters are straightforward and avoid complex re-initialization logic.

3. **Coherence verification: what counts as "sufficient information containment"?**
   - What we know: The escalation protocol should "verify coherence by chunking through original entries and checking information containment." This is for multi-compression indexing.
   - What's unclear: What metric is used for information containment? Embedding similarity? Token overlap? Exact substring match?
   - Recommendation: Use cosine similarity between the embedding of the original chunk and the embedding of the compressed version. Threshold: similarity >= 0.7 (empirical; this is a Claude's-discretion area). Document the threshold in code comments. Make it configurable via `EscalationThresholds`.

---

## Sources

### Primary (HIGH confidence)
- `/huggingface/transformers.js` (Context7) — feature-extraction pipeline API, pooling/normalization options, cos_sim utility
- `https://huggingface.co/docs/transformers.js/tutorials/node` — Node.js ESM usage, singleton pattern, environment config
- MDN `Object.freeze()` — shallow freeze behavior, TypeError on strict-mode mutation
- Node.js docs `node:crypto` — createHash synchronous API

### Secondary (MEDIUM confidence)
- `npm info gpt-tokenizer` — version 3.4.0, zero deps, synchronous operation confirmed
- `npm info uuidv7` — version 1.1.0, Apache-2.0, zero deps confirmed
- `npm info @huggingface/transformers` — version 3.8.1, onnxruntime-node dependency confirmed
- WebSearch: "TypeScript readonly array push compile error" — verified ReadonlyArray removes push/pop from type
- WebSearch: "node:crypto createHash sha256 synchronous" — verified synchronous pattern
- arxiv.org/html/2602.22402 — CMV paper (2026): DAG memory architecture, snapshot/branch primitives, deterministic structural trimming

### Tertiary (LOW confidence — flag for validation)
- WebSearch: "LCM multi-level context compression escalation algorithm" — general pattern confirmed but specific threshold values (0.7 coherence similarity) are empirical estimates, not from authoritative source
- gpt-tokenizer: o200k_base default encoding matches GPT-4o; if Claude models are the target LLM, Claude's tokenizer is different — token counts will be approximate. This is acceptable for escalation thresholds but should be documented.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via npm info, Context7, official docs
- Architecture: HIGH — patterns derived from Phase 1 conventions + verified TypeScript/Node.js primitives
- Escalation algorithm: MEDIUM — three-level structure is well-reasoned but coherence thresholds (0.7 similarity) are empirical estimates needing calibration
- Pitfalls: HIGH — two highest-priority pitfalls ("store is mutable", "L3 missing") come directly from STATE.md; others derived from known TypeScript/embedding gotchas

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (stable stack, 30-day window; only @huggingface/transformers v3.x updates frequently)
