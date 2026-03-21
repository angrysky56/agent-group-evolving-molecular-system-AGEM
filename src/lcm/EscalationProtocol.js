/**
 * EscalationProtocol.ts
 *
 * Three-level context compression with guaranteed convergence.
 *
 * Architecture:
 *   Level 1 (nuanced summarization): LLM-backed compressor, full semantic fidelity.
 *   Level 2 (multi-chunk indexing): Input split into segments, each compressed independently.
 *   Level 3 (deterministic chunking + hard truncation): NO LLM inference — pure token slicing.
 *
 * Guaranteed convergence:
 *   L3 is the hard exit path. deterministicChunkCompress() and deterministicTruncate()
 *   operate solely via gpt-tokenizer encode/decode. They NEVER call this.#compressor.
 *   This makes L3 provably terminating and free of LLM inference.
 *
 * CONTEXT.md locked decision implemented here:
 *   "Chunking first, fall back to deterministic truncation at K tokens."
 *   L3 step a: split on \n\n, compress each chunk at 50% (token slicing).
 *   L3 step b: concatenate. If total <= kTokens, done.
 *   L3 step c: else hard-truncate to exactly kTokens tokens.
 *
 * STATE.md pitfall "Escalation L3 missing" — permanently guarded by T9, T9b, T9c, T9d, T9f.
 *
 * Dependencies:
 *   - node:events: EventEmitter for escalation events
 *   - gpt-tokenizer: encode/decode for deterministic token operations
 *   - ICompressor, ITokenCounter, EscalationThresholds, EscalationLevel from interfaces.js
 */
import { EventEmitter } from "node:events";
import { encode, decode } from "gpt-tokenizer";
// ---------------------------------------------------------------------------
// Standalone deterministic helpers (no compressor access possible)
// ---------------------------------------------------------------------------
/**
 * deterministicTruncate(text, kTokens) — hard truncation to exactly kTokens tokens.
 *
 * Uses gpt-tokenizer encode/decode. No LLM inference. Deterministic.
 *
 * Exported for testability.
 *
 * @param text    - Input text to truncate.
 * @param kTokens - Maximum token count for the output.
 * @returns Truncated text with at most kTokens tokens.
 */
export function deterministicTruncate(text, kTokens) {
    const tokens = encode(text);
    if (tokens.length <= kTokens)
        return text;
    return decode(tokens.slice(0, kTokens));
}
/**
 * deterministicChunkCompress(text, kTokens) — chunk-first, then hard-truncate fallback.
 *
 * CONTEXT.md locked decision: "Chunking first, fall back to deterministic truncation at K tokens."
 *
 * Algorithm:
 *   1. Split text on double newlines (\n\n) to get logical chunks.
 *   2. For each chunk: encode → take first 50% of tokens → decode.
 *      (50% deterministic compression ratio — no LLM, no randomness)
 *   3. Concatenate compressed chunks with \n\n.
 *   4. If total token count <= kTokens, return result.
 *   5. Else: apply deterministicTruncate(concatenated, kTokens) as fallback.
 *
 * This function MUST NOT access any ICompressor instance. It is the hard exit path.
 * All compression is done via token slicing — encode + slice + decode.
 *
 * Exported for testability.
 *
 * @param text    - Input text to chunk-compress.
 * @param kTokens - Maximum token count for the final output.
 * @returns Object with compressed output string and chunk count.
 */
export function deterministicChunkCompress(text, kTokens) {
    // Step 1: Split on double newlines for logical chunk boundaries.
    // If no double newlines, treat the whole text as a single chunk.
    const rawChunks = text.split("\n\n").filter((c) => c.length > 0);
    const chunkCount = rawChunks.length === 0 ? 1 : rawChunks.length;
    const chunks = rawChunks.length === 0 ? [text] : rawChunks;
    // Step 2: Compress each chunk to 50% of its tokens (deterministic — token slicing).
    const compressedChunks = [];
    for (const chunk of chunks) {
        const tokens = encode(chunk);
        // 50% ratio: take ceil(tokens.length * 0.5) tokens from each chunk.
        const keepCount = Math.max(1, Math.ceil(tokens.length * 0.5));
        const compressed = decode(tokens.slice(0, keepCount));
        compressedChunks.push(compressed);
    }
    // Step 3: Concatenate with double newline separators.
    const concatenated = compressedChunks.join("\n\n");
    // Step 4: Check total token count.
    const totalTokens = encode(concatenated).length;
    if (totalTokens <= kTokens) {
        return { output: concatenated, chunks: chunkCount };
    }
    // Step 5: Hard truncation fallback — still no LLM involved.
    const truncated = deterministicTruncate(concatenated, kTokens);
    return { output: truncated, chunks: chunkCount };
}
// ---------------------------------------------------------------------------
// EscalationProtocol class
// ---------------------------------------------------------------------------
/**
 * EscalationProtocol — three-level escalation with guaranteed convergence.
 *
 * Extends EventEmitter to emit 'escalation' events with level and metadata
 * whenever escalation occurs.
 *
 * Constructor:
 *   compressor   — ICompressor for L1 and L2 (LLM-backed in production).
 *   tokenCounter — ITokenCounter for counting (gpt-tokenizer in production).
 *   thresholds   — Initial EscalationThresholds (runtime-adjustable via setThresholds).
 */
export class EscalationProtocol extends EventEmitter {
    #compressor;
    #tokenCounter;
    #thresholds;
    constructor(compressor, tokenCounter, thresholds) {
        super();
        this.#compressor = compressor;
        this.#tokenCounter = tokenCounter;
        this.#thresholds = { ...thresholds };
    }
    /**
     * setThresholds(partial) — merges partial threshold updates into current thresholds.
     *
     * Runtime-adjustable per user decision. Allows per-agent tuning without
     * reconstructing the protocol instance.
     *
     * @param partial - Partial EscalationThresholds to merge.
     */
    setThresholds(partial) {
        this.#thresholds = { ...this.#thresholds, ...partial };
    }
    /**
     * escalate(text) — attempts three-level escalation on the given text.
     *
     * Returns immediately (no escalation) if inputTokens <= level1TokenLimit.
     *
     * Escalation flow:
     *   Level 1: LLM compression to target ratio. If ratio achieved, return.
     *   Level 2: Chunk input, compress each segment independently. If ratio achieved, return.
     *   Level 3: deterministicChunkCompress (NO LLM). Guaranteed to return <= kTokens.
     *
     * @param text - The input text to escalate.
     * @returns EscalationResult with level, output, token counts, and metadata.
     */
    async escalate(text) {
        const inputTokens = this.#tokenCounter.countTokens(text);
        const { level1TokenLimit, level2MinRatio, level3KTokens } = this.#thresholds;
        // No escalation needed — return as-is.
        if (inputTokens <= level1TokenLimit) {
            return {
                level: 0,
                output: text,
                inputTokens,
                outputTokens: inputTokens,
                compressorUsed: false,
            };
        }
        // -------------------------------------------------------------------------
        // Level 1: Nuanced compression — attempt single-pass LLM summarization.
        // -------------------------------------------------------------------------
        const targetRatio = level1TokenLimit / inputTokens;
        const l1Output = await this.#compressor.compress(text, targetRatio);
        const l1Tokens = this.#tokenCounter.countTokens(l1Output);
        const l1Ratio = l1Tokens / inputTokens;
        // If L1 achieved sufficient compression, return L1 result.
        if (l1Ratio <= level2MinRatio) {
            const result = {
                level: 1,
                output: l1Output,
                inputTokens,
                outputTokens: l1Tokens,
                compressorUsed: true,
            };
            this.emit("escalation", {
                level: 1,
                inputTokens,
                outputTokens: l1Tokens,
            });
            return result;
        }
        // -------------------------------------------------------------------------
        // Level 2: Multi-chunk indexing — compress each logical segment independently.
        // -------------------------------------------------------------------------
        const l2Chunks = text.split("\n\n").filter((c) => c.length > 0);
        const segments = l2Chunks.length > 0 ? l2Chunks : [text];
        // Compress each segment independently (multiple compress() calls = multi-compression indexing).
        const compressedSegments = [];
        for (const segment of segments) {
            const segTokens = this.#tokenCounter.countTokens(segment);
            const segTargetRatio = Math.min(1.0, level1TokenLimit / Math.max(segTokens, 1));
            const compressed = await this.#compressor.compress(segment, segTargetRatio);
            compressedSegments.push(compressed);
        }
        const l2Output = compressedSegments.join("\n\n");
        const l2Tokens = this.#tokenCounter.countTokens(l2Output);
        const l2Ratio = l2Tokens / inputTokens;
        // If L2 achieved sufficient compression, return L2 result.
        if (l2Ratio <= level2MinRatio) {
            const result = {
                level: 2,
                output: l2Output,
                inputTokens,
                outputTokens: l2Tokens,
                compressorUsed: true,
            };
            this.emit("escalation", {
                level: 2,
                inputTokens,
                outputTokens: l2Tokens,
            });
            return result;
        }
        // -------------------------------------------------------------------------
        // Level 3: Deterministic chunking + hard truncation fallback.
        //
        // THIS IS THE HARD EXIT PATH. No calls to this.#compressor occur here.
        // All compression is via deterministicChunkCompress (token slicing only).
        //
        // Implements CONTEXT.md locked decision: "Chunking first, fall back to
        // deterministic truncation at K tokens."
        // -------------------------------------------------------------------------
        const { output: l3Output, chunks: l3ChunkCount } = deterministicChunkCompress(text, level3KTokens);
        const l3Tokens = this.#tokenCounter.countTokens(l3Output);
        const result = {
            level: 3,
            output: l3Output,
            inputTokens,
            outputTokens: l3Tokens,
            compressorUsed: false, // L3 NEVER uses the compressor — deterministic only
            chunks: l3ChunkCount,
        };
        this.emit("escalation", { level: 3, inputTokens, outputTokens: l3Tokens });
        return result;
    }
}
//# sourceMappingURL=EscalationProtocol.js.map