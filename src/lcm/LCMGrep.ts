/**
 * LCMGrep.ts
 *
 * Semantic search via cosine similarity over cached embeddings.
 *
 * Design:
 *   - Accepts ImmutableStore (entry retrieval), EmbeddingCache (cached embeddings),
 *     and IEmbedder (query embedding) via constructor injection.
 *   - NEVER imports the huggingface transformers library directly — embedding concern
 *     is fully delegated to the injected IEmbedder.
 *   - Ranking is by cosine similarity (dot product of L2-normalized vectors),
 *     NOT keyword matching.
 *   - Hybrid caching: if an entry's embedding is not cached (LCMClient not used),
 *     LCMGrep computes and caches it on first grep.
 *
 * Pitfall guard (STATE.md Pitfall 4): MockEmbedder is injected in all tests —
 * no ONNX model loading ever occurs in the test suite.
 *
 * Dependencies (imports only from interfaces.js and local LCM modules):
 *   - ImmutableStore: entry retrieval
 *   - EmbeddingCache: cached embedding lookup + hybrid caching fallback
 *   - IEmbedder: query embedding only
 *   - LCMEntry, IEmbedder from interfaces.js
 */

import type { LCMEntry, IEmbedder } from './interfaces.js';
import { ImmutableStore } from './ImmutableStore.js';
import { EmbeddingCache } from './EmbeddingCache.js';

// ---------------------------------------------------------------------------
// Result and options types
// ---------------------------------------------------------------------------

/**
 * GrepResult — a single result from lcm_grep.
 */
export interface GrepResult {
  /** The matched LCMEntry from the ImmutableStore. */
  entry: LCMEntry;
  /** Cosine similarity between the query embedding and the entry's embedding. */
  similarity: number;
}

/**
 * GrepOptions — optional parameters for lcm_grep.
 */
export interface GrepOptions {
  /** Maximum number of results to return. Default: all entries. */
  maxResults?: number;
  /** Minimum cosine similarity threshold. Entries below this are excluded. Default: -1 (all). */
  minSimilarity?: number;
}

// ---------------------------------------------------------------------------
// LCMGrep class
// ---------------------------------------------------------------------------

export class LCMGrep {
  readonly #store: ImmutableStore;
  readonly #cache: EmbeddingCache;
  readonly #embedder: IEmbedder;

  constructor(store: ImmutableStore, cache: EmbeddingCache, embedder: IEmbedder) {
    this.#store = store;
    this.#cache = cache;
    this.#embedder = embedder;
  }

  /**
   * grep(query, options?) — performs semantic search over all entries in the store.
   *
   * Algorithm:
   *   1. Embed the query via the injected IEmbedder (one embed() call per grep).
   *   2. For each entry in the store:
   *      a. Get cached embedding from EmbeddingCache.
   *      b. If not cached, compute and cache now (hybrid fallback).
   *   3. Compute cosine similarity: dot(queryVec, entryVec) / (norm(q) * norm(e)).
   *      Since MockEmbedder and all-MiniLM-L6-v2 both L2-normalize outputs,
   *      this simplifies to dot(queryVec, entryVec).
   *   4. Filter by minSimilarity (default: -1, i.e., all entries included).
   *   5. Sort by similarity descending.
   *   6. Return top maxResults (default: all).
   *
   * @param query   - The query string to search for.
   * @param options - Optional parameters (maxResults, minSimilarity).
   * @returns Promise<GrepResult[]> sorted by similarity descending.
   */
  async grep(query: string, options?: GrepOptions): Promise<GrepResult[]> {
    const minSimilarity = options?.minSimilarity ?? -1;
    const maxResults = options?.maxResults;

    // Step 1: embed the query — one call per grep invocation (queries are not cached)
    const queryVec = await this.#embedder.embed(query);

    // Step 2 & 3: get/compute embeddings, compute similarities
    const entries = this.#store.getAll();
    const results: GrepResult[] = [];

    for (const entry of entries) {
      // Hybrid caching: use cached embedding or compute on-demand
      let entryVec = this.#cache.getEmbedding(entry.id);
      if (entryVec === undefined) {
        await this.#cache.cacheEntry(entry.id, entry.content);
        entryVec = this.#cache.getEmbedding(entry.id)!;
      }

      const similarity = cosineSimilarity(queryVec, entryVec);

      // Step 4: filter
      if (similarity >= minSimilarity) {
        results.push({ entry, similarity });
      }
    }

    // Step 5: sort descending by similarity
    results.sort((a, b) => b.similarity - a.similarity);

    // Step 6: limit to maxResults
    if (maxResults !== undefined) {
      return results.slice(0, maxResults);
    }
    return results;
  }

  /**
   * cacheAllEntries() — pre-caches embeddings for all entries in the store.
   *
   * Called during initialization or manually before running many grep queries.
   * Entries already cached are skipped (hybrid strategy — no redundant re-embedding).
   */
  async cacheAllEntries(): Promise<void> {
    const entries = this.#store.getAll();
    for (const entry of entries) {
      if (!this.#cache.has(entry.id)) {
        await this.#cache.cacheEntry(entry.id, entry.content);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * cosineSimilarity(a, b) — computes cosine similarity between two vectors.
 *
 * Formula: dot(a, b) / (norm(a) * norm(b))
 *
 * Since MockEmbedder and all-MiniLM-L6-v2 both L2-normalize their outputs,
 * norm(a) = norm(b) = 1, so this reduces to dot(a, b) for normalized vectors.
 * The full formula is used here for correctness with any embedder.
 *
 * @param a - First vector (Float64Array).
 * @param b - Second vector (Float64Array).
 * @returns Cosine similarity in range [-1, 1]. Returns 0 if either vector is zero.
 */
export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}
