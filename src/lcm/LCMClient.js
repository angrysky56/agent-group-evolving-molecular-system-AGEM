/**
 * LCMClient.ts
 *
 * Thin coordinator that wires ImmutableStore.append() with EmbeddingCache.cacheEntry().
 *
 * Responsibility: ensure that every context entry appended to the store has its
 * embedding cached at append time — not lazily on first grep. This closes the
 * wiring gap that was identified during Phase 2 planning (see STATE.md pitfalls).
 *
 * Architecture:
 *   - ImmutableStore: synchronous, pure, no embedding concerns.
 *   - EmbeddingCache: async, embedding-aware, no storage concerns.
 *   - LCMClient: coordinates the two, is the single write path for downstream code.
 *
 * Downstream components (LCMGrep, tests) MUST use LCMClient.append() rather than
 * calling ImmutableStore.append() directly, so embedding caching is guaranteed.
 */
export class LCMClient {
    #store;
    #cache;
    #embedder;
    constructor(store, cache, embedder) {
        this.#store = store;
        this.#cache = cache;
        this.#embedder = embedder;
    }
    /**
     * append(content) — the primary write path.
     *
     * Steps:
     *   1. Synchronously append content to ImmutableStore (gets frozen LCMEntry).
     *   2. Asynchronously cache the embedding for this entry via EmbeddingCache.
     *   3. Return the entry's UUIDv7 id.
     *
     * Embedding is cached at append time so lcm_grep never needs lazy embedding.
     */
    async append(content) {
        // Step 1: synchronous store append (ImmutableStore has no async operations).
        const entry = this.#store.append(content);
        // Step 2: cache embedding immediately — the embedding concern stays in EmbeddingCache,
        // the storage concern stays in ImmutableStore, and LCMClient wires both.
        await this.#cache.cacheEntry(entry.id, content);
        // Step 3: return the entry ID for caller reference.
        return entry.id;
    }
    /**
     * store — exposes the underlying ImmutableStore for direct reads.
     * Callers may read from the store but must write through LCMClient.append().
     */
    get store() {
        return this.#store;
    }
}
//# sourceMappingURL=LCMClient.js.map