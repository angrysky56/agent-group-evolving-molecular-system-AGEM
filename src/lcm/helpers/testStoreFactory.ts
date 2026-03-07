/**
 * testStoreFactory.ts
 *
 * Pre-populated ImmutableStore factory for downstream LCM test files.
 *
 * Downstream tests (EmbeddingCache, LCMGrep, EscalationProtocol, etc.) need
 * stores with varied content for realistic testing. This factory provides
 * consistent, deterministic test fixtures.
 *
 * Usage:
 *   import { createPopulatedStore, createDefaultPopulatedStore } from './helpers/testStoreFactory.js';
 */

import { ImmutableStore } from "../ImmutableStore.js";
import { GptTokenCounter } from "../interfaces.js";

/**
 * createPopulatedStore(entries) — creates a fresh ImmutableStore with the given
 * text entries appended in order.
 *
 * @param entries - Array of text strings to append.
 * @returns A new ImmutableStore with all entries appended.
 */
export function createPopulatedStore(entries: string[]): ImmutableStore {
  const store = new ImmutableStore(new GptTokenCounter());
  for (const entry of entries) {
    store.append(entry);
  }
  return store;
}

/**
 * DEFAULT_TEST_ENTRIES — 10 varied entries covering short, medium, and long content.
 * Designed to exercise token counting, hash uniqueness, and range queries realistically.
 */
const DEFAULT_TEST_ENTRIES: string[] = [
  // Short entries
  "Agent initialized.",
  "System ready.",

  // Medium entries
  "The cellular sheaf assigns a vector space to each vertex and edge of the base graph.",
  "Cohomology obstructions arise when local sections cannot be extended to global sections.",
  "The ADMM solver minimizes the total variation functional over the sheaf structure.",

  // Longer entries
  "The LCM dual-memory architecture maintains an append-only ImmutableStore for raw context entries, alongside a ContextDAG that tracks hierarchical relationships between summaries and their source entries. This enables precise escalation through three levels: L1 summarization, L2 compression, and L3 hard truncation.",

  "During escalation level 2, the EscalationProtocol computes cosine similarity between consecutive entry embeddings. When coherence drops below the threshold (default: 0.7), adjacent entries are grouped and compressed via the ICompressor interface, replacing multiple raw entries with a single SummaryNode.",

  "The MockEmbedder produces deterministic 384-dimensional embeddings without loading any model. It uses SHA-256 to derive a seed from the input text, then fills the vector with Math.sin(seed + i) values, and finally L2-normalizes the result. Same text always produces the same embedding.",

  // Very long entry for L3 edge-case testing
  "Context management under the LCM architecture requires careful coordination between the ImmutableStore, EmbeddingCache, and EscalationProtocol. The ImmutableStore is append-only and never mutates its entries. The EmbeddingCache indexes every entry by its UUIDv7 ID at the moment of append, ensuring that lcm_grep can immediately perform cosine-similarity search without lazy embedding on first access. The EscalationProtocol monitors the total token count via ITokenCounter and triggers the appropriate level when thresholds are exceeded. Level 3 is the hardest cutoff — it removes entries beyond the K-token ceiling entirely, preserving only the most recent context.",

  // Edge case: minimal content
  "OK.",
];

/**
 * createDefaultPopulatedStore() — creates a store pre-populated with 10 varied
 * test entries for use in downstream test files.
 *
 * The 10 entries cover: short text, medium text, long paragraphs, and minimal content.
 * Total token count exceeds typical L1 thresholds, making this useful for
 * testing escalation triggers without additional setup.
 *
 * @returns A new ImmutableStore with 10 pre-populated entries.
 */
export function createDefaultPopulatedStore(): ImmutableStore {
  return createPopulatedStore(DEFAULT_TEST_ENTRIES);
}
