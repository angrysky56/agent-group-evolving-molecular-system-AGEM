/**
 * entropyProfile.ts — Compute embedding entropy profiles for text sets.
 *
 * Pure functions that bridge IEmbedder (from src/lcm/) with embeddingEntropy
 * (from src/soc/entropy.ts) to produce EntropyProfile snapshots.
 *
 * Used by LumpabilityAuditor to compare source entries vs summary nodes.
 *
 * Isolation invariant: imports from src/lcm/interfaces (IEmbedder, ITokenCounter)
 * and src/soc/entropy (embeddingEntropy, cosineSimilarity) only.
 */

import type { IEmbedder, ITokenCounter } from "../lcm/interfaces.js";
import { embeddingEntropy, cosineSimilarity } from "../soc/entropy.js";
import { EMBEDDING_DIM } from "../lcm/interfaces.js";
import type { EntropyProfile } from "./interfaces.js";

// ---------------------------------------------------------------------------
// computeEntropyProfile
// ---------------------------------------------------------------------------

/**
 * computeEntropyProfile — embed a set of texts and compute their entropy profile.
 *
 * Algorithm:
 *   1. Embed each text individually via IEmbedder.embed().
 *   2. Compute centroid = mean of all embeddings (element-wise average).
 *   3. Compute embedding entropy of the embedding matrix via embeddingEntropy().
 *   4. Count total tokens across all texts via ITokenCounter.
 *   5. Return EntropyProfile.
 *
 * @param texts - Array of text strings to profile.
 * @param embedder - Injectable IEmbedder (production: HF transformers, test: MockEmbedder).
 * @param tokenCounter - Injectable ITokenCounter (production: GptTokenCounter).
 * @returns EntropyProfile with entropy, centroid, count, totalTokens.
 */
export async function computeEntropyProfile(
  texts: readonly string[],
  embedder: IEmbedder,
  tokenCounter: ITokenCounter,
): Promise<EntropyProfile> {
  if (texts.length === 0) {
    return {
      entropy: 0,
      centroid: new Float64Array(EMBEDDING_DIM),
      count: 0,
      totalTokens: 0,
    };
  }

  // Step 1: Embed each text individually.
  const embeddings: Float64Array[] = [];
  for (const text of texts) {
    const embedding = await embedder.embed(text);
    embeddings.push(embedding);
  }

  // Step 2: Compute centroid (element-wise mean).
  const centroid = new Float64Array(EMBEDDING_DIM);
  for (const emb of embeddings) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      centroid[i]! += emb[i]!;
    }
  }
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    centroid[i]! /= embeddings.length;
  }

  // Step 3: Compute embedding entropy.
  const entropy = embeddingEntropy(embeddings);

  // Step 4: Count total tokens.
  let totalTokens = 0;
  for (const text of texts) {
    totalTokens += tokenCounter.countTokens(text);
  }

  return { entropy, centroid, count: texts.length, totalTokens };
}

// ---------------------------------------------------------------------------
// computeCentroidSimilarity
// ---------------------------------------------------------------------------

/**
 * computeCentroidSimilarity — cosine similarity between two EntropyProfile centroids.
 *
 * Measures semantic drift: how far the summary's "center of mass" has shifted
 * from the source entries' center of mass in embedding space.
 *
 * @param source - EntropyProfile of the source entries.
 * @param summary - EntropyProfile of the summary.
 * @returns Cosine similarity in [-1, 1]. 1.0 = no drift.
 */
export function computeCentroidSimilarity(
  source: EntropyProfile,
  summary: EntropyProfile,
): number {
  return cosineSimilarity(source.centroid, summary.centroid);
}
