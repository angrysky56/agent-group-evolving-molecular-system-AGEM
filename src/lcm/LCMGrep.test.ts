/**
 * LCMGrep.test.ts
 *
 * Tests for LCMGrep semantic search (T10 series) and EmbeddingCache (T11 series).
 *
 * All tests inject MockEmbedder — zero ONNX model loading.
 * Pitfall 4 (embedding cold start in tests) permanently guarded.
 *
 * Test coverage:
 *   T10  — grep returns entries ranked by similarity (descending)
 *   T10b — grep returns empty array when no entries exceed similarity threshold
 *   T10c — grep respects maxResults parameter
 *   T10d — grep result includes similarity score between -1 and 1
 *   T11  — embeddings cached at append time via LCMClient; entry not re-embedded per query
 *   T11b — forceRefresh (refreshEntry) recomputes the entry's embedding
 *   T11c — LCMGrep.ts source does NOT import @huggingface/transformers
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImmutableStore } from './ImmutableStore.js';
import { LCMClient } from './LCMClient.js';
import { EmbeddingCache } from './EmbeddingCache.js';
import { LCMGrep } from './LCMGrep.js';
import { GptTokenCounter, MockEmbedder } from './interfaces.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshStore(): ImmutableStore {
  return new ImmutableStore(new GptTokenCounter());
}

function freshCache(embedder: MockEmbedder): EmbeddingCache {
  return new EmbeddingCache(embedder);
}

// ---------------------------------------------------------------------------
// T10: grep returns entries ranked by similarity descending
// ---------------------------------------------------------------------------

describe('T10: grep returns entries ranked by similarity', () => {
  it('top result is most semantically similar; results sorted descending', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const cache = freshCache(embedder);

    // Append 5 entries with varied content
    const contents = [
      'quantum physics research',
      'cooking recipe for pasta',
      'machine learning algorithms',
      'garden flower arrangement',
      'neural network training',
    ];
    for (const c of contents) {
      const entry = store.append(c);
      await cache.cacheEntry(entry.id, c);
    }

    const grep = new LCMGrep(store, cache, embedder);
    const results = await grep.grep('deep learning models');

    // Should return all 5 entries
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);

    // Results must be sorted by similarity descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.similarity).toBeGreaterThanOrEqual(results[i + 1]!.similarity);
    }
  });
});

// ---------------------------------------------------------------------------
// T10b: grep returns empty array when no entries exceed similarity threshold
// ---------------------------------------------------------------------------

describe('T10b: grep returns empty array below threshold', () => {
  it('minSimilarity=1.0 returns empty array (no entry has perfect similarity to query)', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const cache = freshCache(embedder);

    const e1 = store.append('completely unrelated content alpha');
    await cache.cacheEntry(e1.id, 'completely unrelated content alpha');

    const grep = new LCMGrep(store, cache, embedder);

    // Similarity 1.0 means exact same embedding — only possible with exact same text.
    // A query 'completely different query' will NOT produce similarity 1.0.
    const results = await grep.grep('completely different query', { minSimilarity: 1.0 });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T10c: grep respects maxResults parameter
// ---------------------------------------------------------------------------

describe('T10c: grep respects maxResults', () => {
  it('grep with maxResults:3 returns at most 3 results from 10 entries', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const cache = freshCache(embedder);

    for (let i = 0; i < 10; i++) {
      const entry = store.append(`entry content number ${i}`);
      await cache.cacheEntry(entry.id, `entry content number ${i}`);
    }

    const grep = new LCMGrep(store, cache, embedder);
    const results = await grep.grep('some query', { maxResults: 3 });
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// T10d: grep result includes similarity score between -1 and 1
// ---------------------------------------------------------------------------

describe('T10d: grep result includes similarity score', () => {
  it('each result has similarity field in range [-1, 1]', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const cache = freshCache(embedder);

    const entry = store.append('some content for similarity scoring');
    await cache.cacheEntry(entry.id, 'some content for similarity scoring');

    const grep = new LCMGrep(store, cache, embedder);
    const results = await grep.grep('query for scoring');

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.similarity).toBeGreaterThanOrEqual(-1);
      expect(result.similarity).toBeLessThanOrEqual(1);
      expect(typeof result.similarity).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// T11: embeddings cached at append time via LCMClient
// ---------------------------------------------------------------------------

describe('T11: embeddings are cached at append time via LCMClient', () => {
  it('embed() called once at append; not re-called per grep query', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const embedSpy = vi.spyOn(embedder, 'embed');

    const cache = new EmbeddingCache(embedder);
    const client = new LCMClient(store, cache, embedder);

    // Append via LCMClient — this should call embed() once for the entry
    const entryId = await client.append('cached entry content');

    // Reset spy count to only track future calls (LCMClient.append called embed once)
    const callsAtAppend = embedSpy.mock.calls.length;
    expect(callsAtAppend).toBe(1);

    // Now grep twice with different queries
    const grep = new LCMGrep(store, cache, embedder);
    await grep.grep('first query');
    await grep.grep('second query');

    // Entry embedding should NOT be re-computed (was cached at append time)
    // Only the query embeddings (2 calls) should be new
    const callsAfterGrep = embedSpy.mock.calls.length;
    expect(callsAfterGrep).toBe(callsAtAppend + 2); // +2 for the two query embeddings

    // Verify the entry is still cached
    expect(cache.has(entryId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T11b: forceRefresh recomputes entry embeddings
// ---------------------------------------------------------------------------

describe('T11b: forceRefresh recomputes entry embedding', () => {
  it('refreshEntry calls embedder again for that entry', async () => {
    const store = freshStore();
    const embedder = new MockEmbedder();
    const cache = freshCache(embedder);
    const embedSpy = vi.spyOn(embedder, 'embed');

    const entry = store.append('entry to be refreshed');
    await cache.cacheEntry(entry.id, 'entry to be refreshed');

    const callsAfterCache = embedSpy.mock.calls.length;
    expect(callsAfterCache).toBe(1);

    // Force refresh — should call embed() again
    await cache.refreshEntry(entry.id, 'entry to be refreshed');

    expect(embedSpy.mock.calls.length).toBe(callsAfterCache + 1);

    // Cache still has the entry
    expect(cache.has(entry.id)).toBe(true);
    const embedding = cache.getEmbedding(entry.id);
    expect(embedding).toBeInstanceOf(Float64Array);
    expect(embedding!.length).toBe(384);
  });
});

// ---------------------------------------------------------------------------
// T11c: LCMGrep.ts does NOT import @huggingface/transformers
// ---------------------------------------------------------------------------

describe('T11c: LCMGrep uses IEmbedder injection', () => {
  it('LCMGrep.ts source does not contain import of @huggingface/transformers', () => {
    const filePath = join(
      '/home/ty/Repositories/ai_workspace/agent-group-evolving-molecular-system-AGEM',
      'src/lcm/LCMGrep.ts',
    );
    const source = readFileSync(filePath, 'utf8');
    expect(source).not.toMatch(/@huggingface\/transformers/);
  });
});
