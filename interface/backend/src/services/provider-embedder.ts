/**
 * ProviderEmbedder — production IEmbedder that calls Ollama or OpenRouter
 * embedding APIs via the LLM provider layer.
 *
 * Replaces MockEmbedder for real semantic similarity in the AGEM engine.
 * Falls back to hash-based mock if the provider call fails.
 * Tracks the provider's native dimension so fallback vectors match.
 */

import { createHash } from "node:crypto";
import type { IEmbedder } from "#agem/lcm/interfaces.js";
import { EMBEDDING_DIM } from "#agem/lcm/interfaces.js";
import { createProvider, type LLMProvider } from "./llm.js";
import { settings } from "../config.js";

/**
 * Texts per embedding request.
 *
 * Large enough that the per-request overhead is amortised, small enough that a
 * single body stays modest and one failure only costs one chunk. Measured at
 * 40 texts: 32,485 ms sequential vs 898 ms batched.
 */
const EMBED_BATCH_SIZE = 32;

export class ProviderEmbedder implements IEmbedder {
  #failCount = 0;
  #maxFails = 3;
  /** Tracks the dimension of real embeddings so fallback matches. */
  #knownDim: number = EMBEDDING_DIM;

  async embed(text: string, signal?: AbortSignal): Promise<Float64Array> {
    if (signal?.aborted) return this.#mockFallback(text);

    if (this.#failCount >= this.#maxFails) {
      return this.#mockFallback(text);
    }

    try {
      const config = settings.all;
      const provider = createProvider(config.EMBEDDING_PROVIDER);
      const embedding = await provider.getEmbedding(text, undefined, signal);

      if (!embedding || embedding.length === 0) {
        this.#failCount++;
        console.warn(
          `[ProviderEmbedder] Empty result (fail ${this.#failCount}/${this.#maxFails}), fallback`,
        );
        return this.#mockFallback(text);
      }

      this.#failCount = 0;
      this.#knownDim = embedding.length;
      return new Float64Array(embedding);
    } catch (error) {
      this.#failCount++;
      console.error(
        `[ProviderEmbedder] Error (fail ${this.#failCount}/${this.#maxFails}):`,
        error,
      );
      return this.#mockFallback(text);
    }
  }

  /**
   * Embed many texts, using the provider's batch endpoint when it has one.
   *
   * Falls back to bounded-concurrency singles otherwise, so callers can always
   * use this and never need to know which provider is configured. Any text the
   * batch call fails to return a vector for is retried individually rather than
   * silently left as a mock — a hash vector is unrelated to everything, and one
   * of those hiding inside a bulk result is exactly the kind of silent
   * corruption that is hard to notice later.
   */
  async embedBatch(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<Float64Array[]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.embed(texts[0], signal)];

    /*
     * Chunk before sending. An unbounded batch is not a faster request, it is
     * a request that stalls: a graph cycle can hand this hundreds of store
     * entries, and posting them as one array produced a multi-megabyte body
     * that hung well past the sequential time it was meant to replace.
     * Chunking here rather than at the call site means no caller can
     * accidentally reintroduce it.
     */
    if (texts.length > EMBED_BATCH_SIZE) {
      const out: Float64Array[] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        out.push(
          ...(await this.embedBatch(
            texts.slice(i, i + EMBED_BATCH_SIZE),
            signal,
          )),
        );
      }
      return out;
    }

    if (this.#failCount < this.#maxFails) {
      try {
        const config = settings.all;
        const provider = createProvider(config.EMBEDDING_PROVIDER) as
          LLMProvider & {
            getEmbeddings?: (
              texts: string[],
              model?: string,
              signal?: AbortSignal,
            ) => Promise<number[][]>;
          };
        if (typeof provider.getEmbeddings === "function") {
          const vectors = await provider.getEmbeddings(
            texts,
            undefined,
            signal,
          );
          if (vectors.length === texts.length) {
            this.#failCount = 0;
            const dim = vectors.find((v) => v.length > 0)?.length;
            if (dim) this.#knownDim = dim;
            return Promise.all(
              vectors.map((v, i) =>
                v.length > 0
                  ? Promise.resolve(new Float64Array(v))
                  : this.embed(texts[i], signal),
              ),
            );
          }
          console.warn(
            `[ProviderEmbedder] Batch returned ${vectors.length} of ` +
              `${texts.length} vectors — falling back to singles.`,
          );
        }
      } catch (error) {
        console.warn("[ProviderEmbedder] Batch embed failed, using singles:", error);
      }
    }

    // Bounded concurrency: enough to hide latency, not enough to trip limits.
    const out: Float64Array[] = new Array(texts.length);
    const width = 8;
    for (let i = 0; i < texts.length; i += width) {
      const slice = texts.slice(i, i + width);
      const done = await Promise.all(
        slice.map((text) => this.embed(text, signal)),
      );
      done.forEach((vector, j) => (out[i + j] = vector));
    }
    return out;
  }

  /**
   * Hash-based deterministic fallback using the provider's native dimension.
   * Ensures vectors are always the same size within a session.
   */
  #mockFallback(text: string): Float64Array {
    const dim = this.#knownDim;
    const hashHex = createHash("sha256").update(text, "utf8").digest("hex");
    const seed = parseInt(hashHex.slice(0, 8), 16);
    const raw = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
      raw[i] = Math.sin(seed + i);
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += raw[i] * raw[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) raw[i] /= norm;
    }
    return raw;
  }
}
