/**
 * ImmutableStore.test.ts
 *
 * Defense-in-depth immutability tests for the append-only ImmutableStore.
 * All tests use fresh ImmutableStore instances — no shared state, no reset().
 *
 * Test coverage:
 *   T1   — append returns frozen entry
 *   T1b  — frozen entry mutation throws TypeError (STATE.md pitfall guard #1)
 *   T2   — entry has valid UUIDv7 id
 *   T2b  — entry IDs are time-sortable (lexicographic = insertion order)
 *   T3   — SHA-256 hash matches content
 *   T3b  — different content produces different hash
 *   T4   — tokenCount is positive integer
 *   T4b  — tokenCount matches gpt-tokenizer encode().length
 *   T5   — sequenceNumber is monotonically increasing
 *   T6   — getAll returns ReadonlyArray (runtime-level mutation guard)
 *   T6b  — get(id) returns correct entry
 *   T6c  — get(nonexistent) returns undefined
 *   T7   — getRange returns entries in time order by sequenceNumber
 *   T1d  — LCMClient.append() caches embedding at append time (wiring gap closure)
 */

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { encode } from "gpt-tokenizer";
import { ImmutableStore } from "./ImmutableStore.js";
import { LCMClient } from "./LCMClient.js";
import {
  GptTokenCounter,
  MockEmbedder,
  type IEmbedder,
  type LCMEntry,
} from "./interfaces.js";

// ---------------------------------------------------------------------------
// Minimal EmbeddingCache stub for T1d
// (EmbeddingCache proper is defined in plan 02-04; we use a stub here so
//  LCMClient wiring can be tested in Wave 1 without forward dependencies.)
// ---------------------------------------------------------------------------

class EmbeddingCacheStub {
  private readonly cache = new Map<string, Float64Array>();

  constructor(private readonly embedder: IEmbedder) {}

  async cacheEntry(entryId: string, content: string): Promise<void> {
    const embedding = await this.embedder.embed(content);
    this.cache.set(entryId, embedding);
  }

  getEmbedding(entryId: string): Float64Array | undefined {
    return this.cache.get(entryId);
  }

  hasEntry(entryId: string): boolean {
    return this.cache.has(entryId);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshStore(): ImmutableStore {
  return new ImmutableStore(new GptTokenCounter());
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// T1: append returns a frozen entry
// ---------------------------------------------------------------------------

describe("T1: append returns frozen entry", () => {
  it("Object.isFrozen(entry) is true", () => {
    const store = freshStore();
    const entry: LCMEntry = store.append("hello world");
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1b: mutating a frozen entry throws TypeError
// This is the STATE.md pitfall guard — if the store is mutable, tests would
// share corrupted state across test runs.
// ---------------------------------------------------------------------------

describe("T1b: frozen entry mutation throws TypeError", () => {
  it("assigning to entry.content throws TypeError in strict mode", () => {
    const store = freshStore();
    const entry = store.append("original content");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as unknown as Record<string, unknown>)["content"] = "modified";
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// T2: entry has a valid UUIDv7 id
// ---------------------------------------------------------------------------

describe("T2: entry has valid UUIDv7 id", () => {
  it("id matches UUIDv7 pattern (version digit = 7)", () => {
    const store = freshStore();
    const entry = store.append("test content");
    // UUIDv7: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(entry.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ---------------------------------------------------------------------------
// T2b: entry IDs are time-sortable
// ---------------------------------------------------------------------------

describe("T2b: entry IDs are time-sortable", () => {
  it("lexicographic order of IDs matches insertion order for 10 entries", () => {
    const store = freshStore();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(store.append(`entry ${i}`).id);
    }
    for (let i = 0; i < ids.length - 1; i++) {
      expect(ids[i] < ids[i + 1]).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// T3: SHA-256 hash matches content
// ---------------------------------------------------------------------------

describe("T3: SHA-256 hash matches content", () => {
  it("entry.hash equals independent SHA-256 computation of entry.content", () => {
    const store = freshStore();
    const content = "The quick brown fox jumps over the lazy dog";
    const entry = store.append(content);
    expect(entry.hash).toBe(sha256(content));
  });
});

// ---------------------------------------------------------------------------
// T3b: different content produces different hash
// ---------------------------------------------------------------------------

describe("T3b: different content produces different hash", () => {
  it("two entries with different content have different hashes", () => {
    const store = freshStore();
    const e1 = store.append("content A");
    const e2 = store.append("content B");
    expect(e1.hash).not.toBe(e2.hash);
  });
});

// ---------------------------------------------------------------------------
// T4: tokenCount is a positive integer
// ---------------------------------------------------------------------------

describe("T4: tokenCount is positive integer", () => {
  it("tokenCount > 0 and is an integer", () => {
    const store = freshStore();
    const entry = store.append("hello there");
    expect(entry.tokenCount).toBeGreaterThan(0);
    expect(Number.isInteger(entry.tokenCount)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T4b: tokenCount matches gpt-tokenizer encode().length
// ---------------------------------------------------------------------------

describe("T4b: tokenCount matches gpt-tokenizer", () => {
  it("entry.tokenCount === encode(content).length", () => {
    const store = freshStore();
    const content =
      "Testing token counting with multiple words and punctuation!";
    const entry = store.append(content);
    expect(entry.tokenCount).toBe(encode(content).length);
  });
});

// ---------------------------------------------------------------------------
// T5: sequenceNumber is monotonically increasing
// ---------------------------------------------------------------------------

describe("T5: sequenceNumber is monotonically increasing", () => {
  it("5 entries have sequenceNumbers 0, 1, 2, 3, 4", () => {
    const store = freshStore();
    for (let i = 0; i < 5; i++) {
      const entry = store.append(`entry ${i}`);
      expect(entry.sequenceNumber).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// T6: getAll returns ReadonlyArray (runtime mutation guard)
// ---------------------------------------------------------------------------

describe("T6: getAll returns ReadonlyArray", () => {
  it("pushing to the returned array does not change store size", () => {
    const store = freshStore();
    store.append("a");
    store.append("b");
    const all = store.getAll();
    expect(all.length).toBe(2);
    // Attempt runtime mutation — should throw TypeError (frozen array in strict mode)
    // or at minimum must not change store.getAll().length.
    try {
      (all as unknown as LCMEntry[]).push({} as LCMEntry);
    } catch {
      // Expected: TypeError from frozen array or ReadonlyArray
    }
    expect(store.getAll().length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T6b: get(id) returns the correct entry
// ---------------------------------------------------------------------------

describe("T6b: get(id) returns correct entry", () => {
  it("retrieving each of 3 entries by ID returns matching content", () => {
    const store = freshStore();
    const contents = ["first", "second", "third"];
    const entries = contents.map((c) => store.append(c));
    for (let i = 0; i < entries.length; i++) {
      const retrieved = store.get(entries[i].id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe(contents[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// T6c: get(nonexistent) returns undefined
// ---------------------------------------------------------------------------

describe("T6c: get(nonexistent) returns undefined", () => {
  it("get with unknown id returns undefined", () => {
    const store = freshStore();
    expect(store.get("nonexistent-id")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T7: getRange returns entries in time order by sequenceNumber
// ---------------------------------------------------------------------------

describe("T7: getRange returns entries in time order", () => {
  it("getRange(1, 3) returns exactly entries at indices 1, 2, 3", () => {
    const store = freshStore();
    const entries = [
      store.append("entry 0"),
      store.append("entry 1"),
      store.append("entry 2"),
      store.append("entry 3"),
      store.append("entry 4"),
    ];
    const range = store.getRange(1, 3);
    expect(range.length).toBe(3);
    expect(range[0].sequenceNumber).toBe(1);
    expect(range[1].sequenceNumber).toBe(2);
    expect(range[2].sequenceNumber).toBe(3);
    expect(range[0].content).toBe(entries[1].content);
    expect(range[1].content).toBe(entries[2].content);
    expect(range[2].content).toBe(entries[3].content);
  });
});

// ---------------------------------------------------------------------------
// T1d: LCMClient.append() caches embedding at append time
//
// This test closes the wiring gap: embedding is cached synchronously at
// append time by LCMClient, not lazily on first grep.
//
// Verifies:
//   (1) ImmutableStore has one entry after client.append()
//   (2) EmbeddingCache has a cached embedding for that entry's ID
//   (3) MockEmbedder.embed() was called exactly once
// ---------------------------------------------------------------------------

describe("T1d: LCMClient.append() caches embedding at append time", () => {
  it("store has entry, cache has embedding, embedder called once", async () => {
    const tokenCounter = new GptTokenCounter();
    const store = new ImmutableStore(tokenCounter);

    // Spy-wrapped MockEmbedder to count embed() calls.
    const mockEmbedder = new MockEmbedder();
    const embedSpy = vi.spyOn(mockEmbedder, "embed");

    const cache = new EmbeddingCacheStub(mockEmbedder);
    const client = new LCMClient(
      store,
      cache as unknown as import("./EmbeddingCache.js").EmbeddingCache,
      mockEmbedder,
    );

    const entryId = await client.append("test content for wiring verification");

    // (1) ImmutableStore has one entry
    expect(store.size).toBe(1);
    expect(store.get(entryId)).toBeDefined();

    // (2) EmbeddingCache has a cached embedding for the entry ID
    expect(cache.hasEntry(entryId)).toBe(true);
    const embedding = cache.getEmbedding(entryId);
    expect(embedding).toBeInstanceOf(Float64Array);
    expect(embedding!.length).toBe(384);

    // (3) MockEmbedder was called exactly once
    expect(embedSpy).toHaveBeenCalledTimes(1);
  });
});
