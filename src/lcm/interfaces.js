/**
 * interfaces.ts
 *
 * Shared LCM type definitions and injectable contracts.
 * All types defined here are the dependency root for every LCM component:
 *   ImmutableStore, ContextDAG, EmbeddingCache, EscalationProtocol, lcm_grep, lcm_expand.
 *
 * ZERO LLM inference occurs in this file — pure types and deterministic implementations only.
 */
import { createHash } from "node:crypto";
import { encode } from "gpt-tokenizer";
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/**
 * EMBEDDING_DIM — output dimension of all-MiniLM-L6-v2.
 * All embedding vectors in this system are exactly 384-dimensional.
 */
export const EMBEDDING_DIM = 384;
// ---------------------------------------------------------------------------
// Default / mock implementations
// ---------------------------------------------------------------------------
/**
 * GptTokenCounter — production ITokenCounter implementation.
 * Uses gpt-tokenizer's `encode()` for deterministic BPE token counts.
 * No LLM inference — pure deterministic computation.
 */
export class GptTokenCounter {
    countTokens(text) {
        return encode(text).length;
    }
}
/**
 * MockEmbedder — deterministic test double for IEmbedder.
 * Produces a 384-dimensional embedding from the input text using a
 * hash-derived seed and Math.sin, then L2-normalizes the result.
 *
 * Same approach documented in 02-RESEARCH.md: Math.sin(seed + i) → normalize.
 * No model loading, no async I/O, fully deterministic.
 */
export class MockEmbedder {
    async embed(text) {
        // Derive a numeric seed from the text content via SHA-256.
        const hashHex = createHash("sha256").update(text, "utf8").digest("hex");
        const seed = parseInt(hashHex.slice(0, 8), 16);
        // Produce EMBEDDING_DIM floats using Math.sin for pseudo-randomness.
        const raw = new Float64Array(EMBEDDING_DIM);
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            raw[i] = Math.sin(seed + i);
        }
        // L2-normalize so cosine similarity = dot product.
        let norm = 0;
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            norm += raw[i] * raw[i];
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < EMBEDDING_DIM; i++) {
                raw[i] /= norm;
            }
        }
        return raw;
    }
}
/**
 * MockCompressor — deterministic test double for ICompressor.
 * Returns the first `targetRatio * text.length` characters of the input.
 * No LLM inference — pure string truncation.
 */
export class MockCompressor {
    async compress(text, targetRatio) {
        const targetLength = Math.max(1, Math.floor(text.length * targetRatio));
        return text.slice(0, targetLength);
    }
}
//# sourceMappingURL=interfaces.js.map