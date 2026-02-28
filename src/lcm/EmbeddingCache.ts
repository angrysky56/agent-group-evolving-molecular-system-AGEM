/**
 * EmbeddingCache.ts — forward declaration for Wave 1.
 *
 * This is a minimal forward-declaration used by LCMClient.ts (Wave 1) so
 * TypeScript can resolve the import. The full implementation is in plan 02-04.
 *
 * The EmbeddingCacheStub in ImmutableStore.test.ts is cast to this type for T1d.
 */

import type { IEmbedder } from './interfaces.js';

/**
 * EmbeddingCache — caches per-entry embeddings so lcm_grep can perform
 * cosine-similarity search without re-embedding on every query.
 *
 * Full implementation: plan 02-04.
 * Wave 1 forward declaration: provides just enough interface for LCMClient.
 */
export class EmbeddingCache {
  constructor(_embedder: IEmbedder) {}

  async cacheEntry(_entryId: string, _content: string): Promise<void> {
    throw new Error('EmbeddingCache: not implemented — use plan 02-04');
  }

  getEmbedding(_entryId: string): Float64Array | undefined {
    return undefined;
  }

  hasEntry(_entryId: string): boolean {
    return false;
  }
}
