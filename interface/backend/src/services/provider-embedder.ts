/**
 * Production embedding adapter for the AGEM LCM and TNA pipelines.
 *
 * Provider failures are explicit. Fabricating hash vectors here used to mix a
 * 384-dimensional test fallback with 2,048-dimensional OpenRouter vectors and
 * could make sheaf construction fail much later, far from the real cause.
 */

import type { IEmbedder } from "#agem/lcm/interfaces.js";
import { createProvider } from "./llm.js";
import { settings } from "../config.js";
import type { LLMProviderType } from "../../../shared/types.js";

/** Keep remote request bodies bounded while still amortising round-trip cost. */
const EMBED_BATCH_SIZE = 32;

export interface EmbeddingProviderClient {
  getEmbedding(
    text: string,
    model?: string,
    signal?: AbortSignal,
  ): Promise<number[]>;
  getEmbeddings?(
    texts: string[],
    model?: string,
    signal?: AbortSignal,
  ): Promise<number[][]>;
}

export type EmbeddingProviderFactory = (
  provider?: LLMProviderType,
) => EmbeddingProviderClient;

export interface EmbeddingTelemetry {
  provider: LLMProviderType;
  model: string;
  status: "uninitialized" | "healthy" | "degraded" | "failed";
  dimension: number | null;
  singleRequests: number;
  batchRequests: number;
  batchFallbacks: number;
  vectorsProduced: number;
  failures: number;
  lastFailure?: string;
}

export class EmbeddingProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingProviderError";
  }
}

export class ProviderEmbedder implements IEmbedder {
  readonly #providerFactory: EmbeddingProviderFactory;
  #knownDim: number | null = null;
  #status: EmbeddingTelemetry["status"] = "uninitialized";
  #singleRequests = 0;
  #batchRequests = 0;
  #batchFallbacks = 0;
  #vectorsProduced = 0;
  #failures = 0;
  #lastFailure: string | undefined;

  constructor(
    providerFactory: EmbeddingProviderFactory = (provider) =>
      createProvider(provider),
  ) {
    this.#providerFactory = providerFactory;
  }

  getTelemetry(): EmbeddingTelemetry {
    const provider =
      settings.all.EMBEDDING_PROVIDER ?? settings.getLLMConfig().provider;
    return {
      provider,
      model: settings.getLLMConfig(provider).embedding_model,
      status: this.#status,
      dimension: this.#knownDim,
      singleRequests: this.#singleRequests,
      batchRequests: this.#batchRequests,
      batchFallbacks: this.#batchFallbacks,
      vectorsProduced: this.#vectorsProduced,
      failures: this.#failures,
      ...(this.#lastFailure ? { lastFailure: this.#lastFailure } : {}),
    };
  }

  async embed(text: string, signal?: AbortSignal): Promise<Float64Array> {
    signal?.throwIfAborted();
    this.#singleRequests++;
    const provider = this.#createProvider();
    let vector: number[];
    try {
      vector = await provider.getEmbedding(text, undefined, signal);
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      return this.#fail("Embedding provider request failed.", error);
    }

    if (!vector || vector.length === 0) {
      return this.#fail("Embedding provider returned an empty vector.");
    }
    return this.#acceptVector(vector, "single embedding");
  }

  async embedBatch(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<Float64Array[]> {
    signal?.throwIfAborted();
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embed(texts[0]!, signal)];

    if (texts.length > EMBED_BATCH_SIZE) {
      const out: Float64Array[] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        signal?.throwIfAborted();
        out.push(
          ...(await this.embedBatch(
            texts.slice(i, i + EMBED_BATCH_SIZE),
            signal,
          )),
        );
      }
      return out;
    }

    const provider = this.#createProvider();
    if (provider.getEmbeddings) {
      this.#batchRequests++;
      try {
        const vectors = await provider.getEmbeddings(texts, undefined, signal);
        signal?.throwIfAborted();
        this.#validateBatch(vectors, texts.length);
        return vectors.map((vector) => this.#acceptVector(vector, "batch embedding"));
      } catch (error) {
        signal?.throwIfAborted();
        this.#recordFailure(
          error instanceof Error ? error.message : String(error),
          "degraded",
        );
        this.#batchFallbacks++;
        console.warn(
          "[ProviderEmbedder] Batch embedding failed; retrying as bounded singles:",
          error,
        );
      }
    }

    const out: Float64Array[] = new Array(texts.length);
    const width = 8;
    for (let i = 0; i < texts.length; i += width) {
      signal?.throwIfAborted();
      const slice = texts.slice(i, i + width);
      const vectors = await Promise.all(
        slice.map((text) => this.embed(text, signal)),
      );
      vectors.forEach((vector, index) => (out[i + index] = vector));
    }
    if (this.#failures > 0) this.#status = "degraded";
    return out;
  }

  #createProvider(): EmbeddingProviderClient {
    const provider =
      settings.all.EMBEDDING_PROVIDER ?? settings.getLLMConfig().provider;
    return this.#providerFactory(provider);
  }

  #validateBatch(vectors: number[][], expectedCount: number): void {
    if (vectors.length !== expectedCount) {
      throw new EmbeddingProviderError(
        `Embedding batch returned ${vectors.length} vectors for ${expectedCount} inputs.`,
      );
    }
    const firstDim = vectors[0]?.length ?? 0;
    if (firstDim === 0 || vectors.some((vector) => vector.length !== firstDim)) {
      throw new EmbeddingProviderError(
        "Embedding batch returned empty or mixed-dimension vectors.",
      );
    }
    if (this.#knownDim !== null && firstDim !== this.#knownDim) {
      throw new EmbeddingProviderError(
        `Embedding dimension changed from ${this.#knownDim} to ${firstDim}.`,
      );
    }
  }

  #acceptVector(vector: number[], source: string): Float64Array {
    if (vector.length === 0) {
      return this.#fail(`${source} was empty.`);
    }
    if (this.#knownDim === null) {
      this.#knownDim = vector.length;
    } else if (vector.length !== this.#knownDim) {
      return this.#fail(
        `Embedding dimension changed from ${this.#knownDim} to ${vector.length}.`,
      );
    }
    this.#vectorsProduced++;
    this.#status = this.#failures > 0 ? "degraded" : "healthy";
    return new Float64Array(vector);
  }

  #recordFailure(
    message: string,
    status: "degraded" | "failed" = "failed",
  ): void {
    this.#failures++;
    this.#lastFailure = message;
    this.#status = status;
  }

  #fail(message: string, cause?: unknown): never {
    this.#recordFailure(message);
    throw new EmbeddingProviderError(message, { cause });
  }
}
