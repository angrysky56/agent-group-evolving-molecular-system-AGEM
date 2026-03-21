/**
 * EmbeddingCache.ts
 *
 * Hybrid embedding cache — precomputed at append via LCMClient, force-refresh available.
 *
 * Strategy:
 *   - Primary: entries are cached at append time by LCMClient.append().
 *     This ensures lcm_grep never suffers cold-start embedding on first query.
 *   - Fallback: LCMGrep.grep() will call cacheEntry() for any entry not yet cached
 *     (hybrid strategy per user decision — handles entries appended before EmbeddingCache
 *     was attached, or test scenarios where LCMClient is not used directly).
 *   - Force-refresh: refreshEntry() recomputes and overwrites a cached embedding.
 *
 * Design:
 *   - Accepts IEmbedder via constructor injection — never imports @huggingface/transformers.
 *   - Private Map<string, Float64Array> for O(1) lookup by entry ID.
 *   - All embedding vectors are EMBEDDING_DIM (384) dimensional Float64Array.
 *
 * Dependencies:
 *   - IEmbedder (injected): embedding computation (MockEmbedder in tests, model in prod)
 *   - No ImmutableStore dependency — pure embedding concern, storage-agnostic.
 */
import type { IEmbedder } from "./interfaces.js";
export declare class EmbeddingCache {
    #private;
    constructor(embedder: IEmbedder);
    /**
     * cacheEntry(entryId, content) — computes and caches the embedding for an entry.
     *
     * Called by LCMClient.append() at append time so embeddings are always precomputed.
     * LCMGrep also calls this as a fallback for any entry without a cached embedding.
     *
     * @param entryId - The UUIDv7 ID of the LCMEntry.
     * @param content - The text content to embed.
     */
    cacheEntry(entryId: string, content: string): Promise<void>;
    /**
     * getEmbedding(entryId) — retrieves the cached embedding for an entry.
     *
     * @param entryId - The UUIDv7 ID of the LCMEntry.
     * @returns The cached Float64Array embedding, or undefined if not cached.
     */
    getEmbedding(entryId: string): Float64Array | undefined;
    /**
     * refreshEntry(entryId, content) — forces recomputation of an entry's embedding.
     *
     * Overwrites the cached embedding with a freshly computed one.
     * Useful after content deduplication or embedding model upgrades.
     *
     * @param entryId - The UUIDv7 ID of the LCMEntry.
     * @param content - The text content to re-embed.
     */
    refreshEntry(entryId: string, content: string): Promise<void>;
    /**
     * has(entryId) — checks whether an embedding exists in the cache.
     *
     * @param entryId - The UUIDv7 ID to check.
     * @returns True if the entry has a cached embedding, false otherwise.
     */
    has(entryId: string): boolean;
    /**
     * size — number of entries currently cached.
     */
    get size(): number;
}
//# sourceMappingURL=EmbeddingCache.d.ts.map