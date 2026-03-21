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
import type { ICompressor, ITokenCounter, EscalationThresholds, EscalationLevel } from "./interfaces.js";
/**
 * EscalationResult — the output of a single escalate() call.
 *
 * Fields:
 *   level         — which escalation level was reached (0 = no escalation needed).
 *   output        — the compressed/truncated text.
 *   inputTokens   — token count of the original input.
 *   outputTokens  — token count of the output.
 *   compressorUsed — true if the injected ICompressor was called at any point.
 *   chunks         — number of logical chunks used in L3 (only present for level 3).
 */
export interface EscalationResult {
    level: EscalationLevel | 0;
    output: string;
    inputTokens: number;
    outputTokens: number;
    compressorUsed: boolean;
    chunks?: number;
}
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
export declare function deterministicTruncate(text: string, kTokens: number): string;
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
export declare function deterministicChunkCompress(text: string, kTokens: number): {
    output: string;
    chunks: number;
};
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
export declare class EscalationProtocol extends EventEmitter {
    #private;
    constructor(compressor: ICompressor, tokenCounter: ITokenCounter, thresholds: EscalationThresholds);
    /**
     * setThresholds(partial) — merges partial threshold updates into current thresholds.
     *
     * Runtime-adjustable per user decision. Allows per-agent tuning without
     * reconstructing the protocol instance.
     *
     * @param partial - Partial EscalationThresholds to merge.
     */
    setThresholds(partial: Partial<EscalationThresholds>): void;
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
    escalate(text: string): Promise<EscalationResult>;
}
//# sourceMappingURL=EscalationProtocol.d.ts.map