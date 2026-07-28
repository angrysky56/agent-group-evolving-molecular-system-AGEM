import { describe, expect, it, vi } from "vitest";
import { EmbeddingCache } from "./EmbeddingCache.js";
import { ImmutableStore } from "./ImmutableStore.js";
import { LCMClient } from "./LCMClient.js";
import { GptTokenCounter, type IEmbedder } from "./interfaces.js";

describe("LCMClient.appendBatch", () => {
  it("stores paragraph entries and embeds them in one ordered batch", async () => {
    const embed = vi.fn(async () => new Float64Array([9, 9]));
    const embedBatch = vi.fn(async () => [
      new Float64Array([1, 0]),
      new Float64Array([0, 1]),
    ]);
    const embedder: IEmbedder = { embed, embedBatch };
    const store = new ImmutableStore(new GptTokenCounter());
    const cache = new EmbeddingCache(embedder);
    const client = new LCMClient(store, cache, embedder);

    const ids = await client.appendBatch(["first paragraph", "second paragraph"]);

    expect(store.getAll().map((entry) => entry.content)).toEqual([
      "first paragraph",
      "second paragraph",
    ]);
    expect(ids).toHaveLength(2);
    expect(cache.getEmbedding(ids[0]!)).toEqual(new Float64Array([1, 0]));
    expect(cache.getEmbedding(ids[1]!)).toEqual(new Float64Array([0, 1]));
    expect(embedBatch).toHaveBeenCalledWith(
      ["first paragraph", "second paragraph"],
      undefined,
    );
    expect(embed).not.toHaveBeenCalled();
  });
});
