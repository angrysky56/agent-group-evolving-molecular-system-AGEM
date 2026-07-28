import { describe, expect, it, vi } from "vitest";
import {
  EmbeddingProviderError,
  ProviderEmbedder,
} from "./provider-embedder.js";

describe("ProviderEmbedder failure safety", () => {
  it("fails explicitly instead of seeding a dimension-unsafe hash vector", async () => {
    const provider = {
      getEmbedding: vi.fn(async () => [] as number[]),
    };
    const embedder = new ProviderEmbedder(() => provider);

    await expect(embedder.embed("first concept")).rejects.toBeInstanceOf(
      EmbeddingProviderError,
    );
    expect(embedder.getTelemetry()).toMatchObject({
      status: "failed",
      dimension: null,
      failures: 1,
      vectorsProduced: 0,
    });
  });

  it("keeps one native dimension for the lifetime of the embedder", async () => {
    const provider = {
      getEmbedding: vi
        .fn()
        .mockResolvedValueOnce(new Array(2_048).fill(0.1))
        .mockResolvedValueOnce(new Array(768).fill(0.1)),
    };
    const embedder = new ProviderEmbedder(() => provider);

    await expect(embedder.embed("first")).resolves.toHaveLength(2_048);
    await expect(embedder.embed("second")).rejects.toThrow(
      "Embedding dimension changed from 2048 to 768",
    );
    expect(embedder.getTelemetry()).toMatchObject({
      status: "failed",
      dimension: 2_048,
      failures: 1,
      vectorsProduced: 1,
    });
  });

  it("reports successful native batching without single-request fallback", async () => {
    const provider = {
      getEmbedding: vi.fn(async () => new Array(2_048).fill(0.1)),
      getEmbeddings: vi.fn(async (texts: string[]) =>
        texts.map(() => new Array(2_048).fill(0.1)),
      ),
    };
    const embedder = new ProviderEmbedder(() => provider);

    await expect(embedder.embedBatch(["one", "two", "three"])).resolves.toHaveLength(
      3,
    );
    expect(provider.getEmbeddings).toHaveBeenCalledTimes(1);
    expect(provider.getEmbedding).not.toHaveBeenCalled();
    expect(embedder.getTelemetry()).toMatchObject({
      status: "healthy",
      dimension: 2_048,
      batchRequests: 1,
      singleRequests: 0,
      batchFallbacks: 0,
      failures: 0,
      vectorsProduced: 3,
    });
  });
});
