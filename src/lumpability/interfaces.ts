/**
 * interfaces.ts — Lumpability Auditor type definitions
 *
 * Shared contracts for the lumpability auditing subsystem.
 * Detects information loss (weak lumpability) at LCM compaction boundaries
 * by comparing embedding entropy profiles of source entries vs summary nodes.
 *
 * Isolation invariant: Imports ONLY from src/lcm/interfaces (IEmbedder, EscalationLevel)
 * and src/types/ (event types). ZERO imports from src/tna/, src/sheaf/, src/orchestrator/.
 *
 * Theoretical basis:
 *   Strong lumpability: compressed state preserves Markov property for ALL initial distributions.
 *   Weak lumpability: compressed state preserves Markov property only for SPECIFIC distributions.
 *   Detection: if entropy preservation ratio falls below escalation-level-specific thresholds,
 *   the compression is likely weakly lumpable — critical hidden variables were dropped.
 */

import type { EscalationLevel } from "../lcm/interfaces.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * LumpabilityConfig — tunable parameters for the auditor.
 *
 * Threshold calibration rationale:
 *   L1 (preserve_details) should retain ~85%+ of semantic information.
 *   L2 (bullet_points) aggressive compression, ~50%+ acceptable.
 *   L3 (deterministic truncation) no semantic guarantee — audit is informational only.
 *   counterfactualProbeCount: number of random probes injected at each boundary.
 */
export interface LumpabilityConfig {
  /**
   * Minimum entropy preservation ratio for L1 compaction.
   * If H(summary) / H(sources) < this threshold, flag as weakly lumpable.
   * Default: 0.70
   */
  readonly l1EntropyThreshold: number;

  /**
   * Minimum entropy preservation ratio for L2 compaction.
   * Default: 0.40
   */
  readonly l2EntropyThreshold: number;

  /**
   * Minimum entropy preservation ratio for L3 compaction.
   * L3 is deterministic truncation — lower threshold, primarily informational.
   * Default: 0.15
   */
  readonly l3EntropyThreshold: number;

  /**
   * Number of counterfactual probes to inject at each compaction boundary.
   * Probes test whether the summary can answer questions derivable from source entries.
   * 0 = disabled (entropy-only auditing). Default: 0 (Phase 1).
   */
  readonly counterfactualProbeCount: number;

  /**
   * Minimum cosine similarity between source centroid and summary embedding.
   * Below this threshold, the summary has semantically drifted from the source.
   * Default: 0.60
   */
  readonly minCentroidSimilarity: number;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * DEFAULT_LUMPABILITY_CONFIG — production defaults.
 * Calibrated to flag genuine information loss while tolerating normal compression artifacts.
 */
export const DEFAULT_LUMPABILITY_CONFIG: LumpabilityConfig = {
  l1EntropyThreshold: 0.70,
  l2EntropyThreshold: 0.40,
  l3EntropyThreshold: 0.15,
  counterfactualProbeCount: 0,
  minCentroidSimilarity: 0.60,
} as const;

// ---------------------------------------------------------------------------
// Entropy profile
// ---------------------------------------------------------------------------

/**
 * EntropyProfile — embedding entropy snapshot of a set of text entries.
 *
 * Computed by embedding each text entry individually, then running
 * embeddingEntropy() from src/soc/entropy.ts over the embedding matrix.
 */
export interface EntropyProfile {
  /** Embedding entropy (nats) of the text set. */
  readonly entropy: number;
  /** Centroid embedding (mean of all individual embeddings). */
  readonly centroid: Float64Array;
  /** Number of texts embedded. */
  readonly count: number;
  /** Total token count across all texts. */
  readonly totalTokens: number;
}

// ---------------------------------------------------------------------------
// Audit result
// ---------------------------------------------------------------------------

/**
 * LumpabilityClassification — the verdict of a single compaction audit.
 *
 * 'strong': entropy preservation ratio above threshold for the escalation level.
 *           Compression is information-preserving under distribution shift.
 * 'weak':   entropy ratio below threshold. Critical hidden variables may be lost.
 *           The compressed state only works for the specific query distribution
 *           that produced it — it will fail under counterfactual probing.
 * 'degenerate': source or summary has zero or near-zero entropy (e.g., empty input).
 *               Not classifiable — audit result is informational only.
 */
export type LumpabilityClassification = "strong" | "weak" | "degenerate";

/**
 * AuditResult — full output of a lumpability audit at one compaction boundary.
 */
export interface AuditResult {
  /** Summary node ID that was audited. */
  readonly summaryNodeId: string;
  /** IDs of the original entries that were compacted. */
  readonly sourceEntryIds: readonly string[];
  /** Escalation level that produced this summary (1, 2, or 3). */
  readonly escalationLevel: EscalationLevel;
  /** Entropy profile of the source entries. */
  readonly sourceProfile: EntropyProfile;
  /** Entropy profile of the summary content. */
  readonly summaryProfile: EntropyProfile;
  /** H(summary) / H(sources). NaN if source entropy is 0. */
  readonly entropyPreservationRatio: number;
  /** Cosine similarity between source centroid and summary centroid. */
  readonly centroidSimilarity: number;
  /** Threshold that was applied for this escalation level. */
  readonly threshold: number;
  /** Final classification. */
  readonly classification: LumpabilityClassification;
  /** Unix timestamp (ms) when audit completed. */
  readonly timestamp: number;

  /** Value Kernel constraint check result (if VK checker was provided). */
  readonly vkCheck?: VKCheckResult;
}

// ---------------------------------------------------------------------------
// Value Kernel Constraint Preservation
// ---------------------------------------------------------------------------

/**
 * IValueKernelChecker — interface for checking VK axiom preservation
 * across LCM compaction boundaries.
 *
 * The entropy-based audit catches INFORMATION loss (distributional).
 * This catches AXIOM loss (categorical) — a compression can preserve
 * entropy while dropping specific ethical constraints.
 *
 * Implementations:
 *   Phase 1: EmbeddingVKChecker — cosine similarity between axiom embeddings
 *            and summary embedding. Practical, works with existing infrastructure.
 *   Phase 2: SheafVKChecker — project into C⁰ state space, compute Dirichlet
 *            energy. Requires content-aware sheaf (not yet built).
 */
export interface IValueKernelChecker {
  /**
   * Verify that all VK-relevant constraints present in source texts
   * survive compression into the summary.
   *
   * @param summaryText - The compressed summary text.
   * @param sourceTexts - The original source texts before compression.
   * @returns Check result with validity status and any lost axioms.
   */
  verifyConstraints(summaryText: string, sourceTexts: string[]): Promise<VKCheckResult>;
}

/** Result of a VK constraint preservation check. */
export interface VKCheckResult {
  /** Whether all detected axioms were preserved. */
  readonly isValid: boolean;
  /** Axiom IDs that were present in sources but missing from summary. */
  readonly lostAxioms: string[];
  /** Per-axiom similarity scores (axiomId → similarity to summary). */
  readonly axiomScores: Record<string, number>;
  /** Overall constraint preservation score (0-1). */
  readonly preservationScore: number;
}

/**
 * AxiomLossError — thrown when VK axioms are lost during compaction.
 *
 * The ObstructionHandler catches this and triggers lcm_expand recovery,
 * explicitly injecting the lost axioms into the re-summarization prompt.
 */
export class AxiomLossError extends Error {
  readonly summaryNodeId: string;
  readonly lostAxioms: string[];
  readonly preservationScore: number;

  constructor(summaryNodeId: string, lostAxioms: string[], preservationScore: number) {
    super(
      `Axiom loss detected in compaction of ${summaryNodeId}: ` +
      `lost [${lostAxioms.join(", ")}] (preservation=${preservationScore.toFixed(3)})`,
    );
    this.name = "AxiomLossError";
    this.summaryNodeId = summaryNodeId;
    this.lostAxioms = lostAxioms;
    this.preservationScore = preservationScore;
  }
}
