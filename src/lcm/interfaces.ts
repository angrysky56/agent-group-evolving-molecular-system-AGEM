/**
 * interfaces.ts
 *
 * Shared LCM type definitions and injectable contracts.
 * All types defined here are the dependency root for every LCM component:
 *   ImmutableStore, ContextDAG, EmbeddingCache, EscalationProtocol, lcm_grep, lcm_expand.
 *
 * ZERO LLM inference occurs in this file — pure types and deterministic implementations only.
 */

import { createHash } from 'node:crypto';
import { encode } from 'gpt-tokenizer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * EMBEDDING_DIM — output dimension of all-MiniLM-L6-v2.
 * All embedding vectors in this system are exactly 384-dimensional.
 */
export const EMBEDDING_DIM = 384 as const;

// ---------------------------------------------------------------------------
// Core LCM entry type
// ---------------------------------------------------------------------------

/**
 * LCMEntry — a single immutable context entry stored in ImmutableStore.
 *
 * All fields are readonly. ImmutableStore additionally freezes every entry
 * at runtime with Object.freeze() for defense-in-depth immutability.
 */
export interface LCMEntry {
  /** UUIDv7 — time-sortable identifier; lexicographic order = insertion order. */
  readonly id: string;
  /** The raw text content of this context entry. */
  readonly content: string;
  /** Token count as computed by gpt-tokenizer. */
  readonly tokenCount: number;
  /** SHA-256 hex digest of `content` — verifies content integrity. */
  readonly hash: string;
  /** Unix timestamp (ms) at time of append. */
  readonly timestamp: number;
  /** Zero-based monotonic counter — position in insertion sequence. */
  readonly sequenceNumber: number;
}

// ---------------------------------------------------------------------------
// Escalation types
// ---------------------------------------------------------------------------

/**
 * EscalationLevel — which compression/summarization tier is active.
 *   1 = light summarization (token budget exceeded by minor margin)
 *   2 = aggressive compression (token budget exceeded by major margin)
 *   3 = hard truncation (L3 K-token hard cap reached)
 */
export type EscalationLevel = 1 | 2 | 3;

/**
 * EscalationThresholds — runtime-adjustable thresholds for the EscalationProtocol.
 * All fields intentionally non-readonly to allow per-agent tuning.
 */
export interface EscalationThresholds {
  /** Token count that triggers L1 summarization. */
  level1TokenLimit: number;
  /** Ratio of current/max tokens that triggers L2 compression (e.g. 0.85). */
  level2MinRatio: number;
  /** Hard K-token ceiling — triggers L3 when totalTokens > level3KTokens * 1000. */
  level3KTokens: number;
  /** Cosine similarity threshold below which coherence is flagged (default: 0.7). */
  coherenceSimilarityThreshold: number;
}

// ---------------------------------------------------------------------------
// Expand result discriminated union
// ---------------------------------------------------------------------------

/**
 * ExpandLevel — discriminated union returned by lcm_expand.
 * Each variant carries the content relevant to that expansion level.
 */
export type ExpandLevel =
  | { kind: 'summary'; nodeId: string; content: string }
  | { kind: 'compression'; level: number; content: string; pointsTo: string[] }
  | { kind: 'entry'; entryId: string; content: string; tokenCount: number };

// ---------------------------------------------------------------------------
// Metric update and summary node
// ---------------------------------------------------------------------------

/**
 * MetricUpdate — a single recorded change to a SummaryNode metric field.
 */
export interface MetricUpdate {
  timestamp: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * SummaryNode — a compressed/summarized representation of a set of LCMEntries.
 * Created by EscalationProtocol when the context grows beyond L1 threshold.
 */
export interface SummaryNode {
  readonly id: string;
  readonly content: string;
  readonly originalEntryIds: readonly string[];
  readonly createdAt: number;
  version: number;
  metrics: Record<string, unknown>;
  metricHistory: readonly MetricUpdate[];
  intermediateCompressions: readonly { level: number; content: string; childIds: string[] }[];
}

// ---------------------------------------------------------------------------
// Injectable interfaces
// ---------------------------------------------------------------------------

/**
 * IEmbedder — injectable embedding interface.
 * Production: @huggingface/transformers all-MiniLM-L6-v2.
 * Tests: MockEmbedder (deterministic, no model loading).
 */
export interface IEmbedder {
  embed(text: string): Promise<Float64Array>;
}

/**
 * ICompressor — injectable text compression interface.
 * Production: LLM-backed compressor (L1/L2 escalation).
 * Tests: MockCompressor (prefix truncation, deterministic).
 */
export interface ICompressor {
  compress(text: string, targetRatio: number): Promise<string>;
}

/**
 * ITokenCounter — injectable token counting interface.
 * Wraps gpt-tokenizer for deterministic, LLM-free counting.
 */
export interface ITokenCounter {
  countTokens(text: string): number;
}

// ---------------------------------------------------------------------------
// Default / mock implementations
// ---------------------------------------------------------------------------

/**
 * GptTokenCounter — production ITokenCounter implementation.
 * Uses gpt-tokenizer's `encode()` for deterministic BPE token counts.
 * No LLM inference — pure deterministic computation.
 */
export class GptTokenCounter implements ITokenCounter {
  countTokens(text: string): number {
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
export class MockEmbedder implements IEmbedder {
  async embed(text: string): Promise<Float64Array> {
    // Derive a numeric seed from the text content via SHA-256.
    const hashHex = createHash('sha256').update(text, 'utf8').digest('hex');
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
export class MockCompressor implements ICompressor {
  async compress(text: string, targetRatio: number): Promise<string> {
    const targetLength = Math.max(1, Math.floor(text.length * targetRatio));
    return text.slice(0, targetLength);
  }
}
