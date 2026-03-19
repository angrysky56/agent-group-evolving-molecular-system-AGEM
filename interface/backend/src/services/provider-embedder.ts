/**
 * ProviderEmbedder — production IEmbedder that calls Ollama or OpenRouter
 * embedding APIs via the LLM provider layer.
 *
 * Replaces MockEmbedder for real semantic similarity in the AGEM engine.
 * Falls back to hash-based mock if the provider call fails.
 * Tracks the provider's native dimension so fallback vectors match.
 */

import { createHash } from "node:crypto";
import type { IEmbedder } from "../../../../src/lcm/interfaces.js";
import { EMBEDDING_DIM } from "../../../../src/lcm/interfaces.js";
import { createProvider } from "./llm.js";

export class ProviderEmbedder implements IEmbedder {
  #failCount = 0;
  #maxFails = 3;
  /** Tracks the dimension of real embeddings so fallback matches. */
  #knownDim: number = EMBEDDING_DIM;

  async embed(text: string): Promise<Float64Array> {
    if (this.#failCount >= this.#maxFails) {
      return this.#mockFallback(text);
    }

    try {
      const provider = createProvider();
      const embedding = await provider.getEmbedding(text);

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
