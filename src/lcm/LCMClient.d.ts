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
import type { IEmbedder } from "./interfaces.js";
import { ImmutableStore } from "./ImmutableStore.js";
import { EmbeddingCache } from "./EmbeddingCache.js";
export declare class LCMClient {
    #private;
    constructor(store: ImmutableStore, cache: EmbeddingCache, embedder: IEmbedder);
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
    append(content: string): Promise<string>;
    /**
     * store — exposes the underlying ImmutableStore for direct reads.
     * Callers may read from the store but must write through LCMClient.append().
     */
    get store(): ImmutableStore;
}
//# sourceMappingURL=LCMClient.d.ts.map