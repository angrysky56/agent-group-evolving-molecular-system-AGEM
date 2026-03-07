# Phase 2: LCM Dual-Memory Architecture - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the Lossless Context Management (LCM) system — a deterministic, append-only context storage and retrieval framework that preserves information without loss across multi-agent interactions. This includes:

- Immutable append-only store with time-sequenced entry IDs
- Context DAG structure with pointer-based summary nodes
- Three-level escalation protocol (nuanced → compressed → chunked/truncated)
- lcm_grep semantic search primitive for context retrieval
- lcm_expand primitive for hierarchical context unrolling

Determinism and zero LLM inference in the store itself are foundational constraints (LLM calls happen at escalation levels 1-2 only; Level 3 is always programmatic).

</domain>

<decisions>
## Implementation Decisions

### Immutability Enforcement

- **Enforcement:** Both compile-time (TypeScript readonly) and runtime (Object.freeze) for defense-in-depth
- **Test isolation:** Claude's discretion — fresh instances per test OR reset() method. Both approaches work.
- **Integrity verification:** Claude's discretion — SHA-256 hashing OR lightweight checksum. Choose most practical for the use case.
- **API surface:** Claude's discretion — expose readonly array directly OR only accessor methods (get, getAll, getRange). Either works.

### Escalation Protocol

- **Level 1 → Level 2 trigger:** Event-driven escalation with **variable compression % based on token count**
  - Uses **multi-compression indexing** — compress at strategic points in the hierarchy, not all entries at once
  - Verify coherence by chunking through original entries and checking information containment
  - Prevents loss of semantic flavor (e.g., complex works like "War and Peace" retain structure across compressions)
- **Level 2 → Level 3 trigger:** When compression fails or achieves insufficient ratio
  - **Level 3 strategy:** Chunking first (keep multiple compressed summaries), fall back to **deterministic truncation at K tokens**
  - Always deterministic—no LLM inference in L3
- **Thresholds:** Runtime-adjustable (can be changed during a session), not hardcoded
- **LLM usage:** Levels 1-2 can use LLM for smart compression/summarization; Level 3 is guaranteed deterministic

### Summary Node Design

- **Purpose:** Both lineage tracking (pointers to original entries) AND optimization metrics (compression stats)
- **Metadata:** Creation timestamp + version tracking (for debugging drift over time)
- **Mutability:** Mutable but tracked — summary content is immutable, but metrics/tags can be updated and changes are auditable
- **Storage location:** Separate SummaryIndex structure (not appended to ImmutableStore)

### Grep/Expand Interface

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

</decisions>

<specifics>
## Specific Ideas

- **Multi-compression indexing philosophy:** "You aren't going to get War and Peace condensed much and retain any flavor" — this captures the requirement to preserve semantic structure through multiple compression levels, not lose complexity in early aggressive compression.
- **Hierarchical table of contents:** Summary provides a structural overview; LLM can traverse the hierarchy and drill into specific intermediate compressions to examine original entries as needed. This balances context preservation with token efficiency.
- **Deterministic fallback:** Level 3 hard truncation ensures the system never deadlocks on escalation (paradoxically longer summaries). Guarantees algorithmic convergence.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 2 scope. (LLM inference models for TNA/SOC embedding selection are out of scope for Phase 2; those decisions happen in Phase 3-4.)

</deferred>

---

_Phase: 02-lcm_
_Context gathered: 2026-02-27_
