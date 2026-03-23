/**
 * LumpabilityAuditor.ts
 *
 * Core lumpability auditing at LCM compaction boundaries.
 *
 * Intercepts SummaryNode creation, computes entropy profiles for the source
 * entries and the summary content, classifies the compression as strongly or
 * weakly lumpable, and emits events through the AGEM EventBus.
 *
 * When weak lumpability is detected, the existing ObstructionHandler feedback
 * loop can trigger lcm_expand recovery to re-inject lost context.
 *
 * Theoretical basis (Geiger & Temmel, 2014):
 *   A lumping is strongly k-lumpable iff the lumped process is a k-th order
 *   Markov chain for EACH starting distribution. We approximate this by
 *   checking whether the compressed state's entropy profile generalizes
 *   beyond the specific distribution that produced it — measured via
 *   entropy preservation ratio and centroid drift.
 *
 * Isolation: imports from src/lcm/ (interfaces), src/soc/ (entropy),
 * and local ./interfaces and ./entropyProfile only.
 */

import { EventEmitter } from "node:events";
import type { IEmbedder, ITokenCounter, SummaryNode, LCMEntry, EscalationLevel } from "../lcm/interfaces.js";
import type { LumpabilityConfig, AuditResult, LumpabilityClassification, IValueKernelChecker, VKCheckResult } from "./interfaces.js";
import { DEFAULT_LUMPABILITY_CONFIG, AxiomLossError } from "./interfaces.js";
import { computeEntropyProfile, computeCentroidSimilarity } from "./entropyProfile.js";

// ---------------------------------------------------------------------------
// LumpabilityAuditor class
// ---------------------------------------------------------------------------

/**
 * LumpabilityAuditor — monitors LCM compaction for information loss.
 *
 * Extends EventEmitter for forward-compatibility with AGEM EventBus.
 * Emits:
 *   'lumpability:audit-complete'         — every audit (strong or weak).
 *   'lumpability:weak-compression'       — only when classification = 'weak'.
 *
 * Usage:
 *   const auditor = new LumpabilityAuditor(embedder, tokenCounter);
 *   auditor.on('lumpability:weak-compression', (result) => { ... });
 *   const result = await auditor.audit(summaryNode, sourceEntries, escalationLevel);
 */
export class LumpabilityAuditor extends EventEmitter {
  readonly #embedder: IEmbedder;
  readonly #tokenCounter: ITokenCounter;
  readonly #config: LumpabilityConfig;
  #vkChecker: IValueKernelChecker | null = null;

  /** Rolling history of audit results for trend analysis. */
  readonly #history: AuditResult[] = [];
  readonly #maxHistorySize: number = 100;

  constructor(
    embedder: IEmbedder,
    tokenCounter: ITokenCounter,
    config?: Partial<LumpabilityConfig>,
  ) {
    super();
    this.#embedder = embedder;
    this.#tokenCounter = tokenCounter;
    this.#config = { ...DEFAULT_LUMPABILITY_CONFIG, ...config };
  }

  /**
   * setVKChecker — attach a Value Kernel checker for axiom preservation auditing.
   * Called after construction since the checker may need dependencies not available at init.
   */
  setVKChecker(checker: IValueKernelChecker): void {
    this.#vkChecker = checker;
  }

  // -------------------------------------------------------------------------
  // Core audit method
  // -------------------------------------------------------------------------

  /**
   * audit — evaluate a single compaction boundary for lumpability.
   *
   * Algorithm:
   *   1. Extract text content from source entries.
   *   2. Compute entropy profile of source entries.
   *   3. Compute entropy profile of summary content (treated as single text).
   *   4. Compute entropy preservation ratio = H(summary) / H(sources).
   *   5. Compute centroid similarity.
   *   6. Select threshold based on escalation level.
   *   7. Classify: strong if ratio >= threshold AND centroidSim >= minCentroidSimilarity.
   *   8. Emit events.
   *   9. Store in history.
   *
   * @param summaryNode  - The SummaryNode produced by EscalationProtocol.
   * @param sourceEntries - The original LCMEntries that were compacted.
   * @param escalationLevel - Which escalation level produced this summary (1, 2, or 3).
   * @returns AuditResult with classification, metrics, and provenance.
   */
  async audit(
    summaryNode: SummaryNode,
    sourceEntries: readonly LCMEntry[],
    escalationLevel: EscalationLevel,
  ): Promise<AuditResult> {
    // Step 1: Extract source texts.
    const sourceTexts = sourceEntries.map((e) => e.content);

    // Step 1.5: Value Kernel constraint check (FAIL-FAST).
    // Runs BEFORE entropy computation — if axioms are lost, no point computing entropy.
    let vkCheck: VKCheckResult | undefined;
    if (this.#vkChecker) {
      vkCheck = await this.#vkChecker.verifyConstraints(summaryNode.content, sourceTexts);

      if (!vkCheck.isValid) {
        this.emit("lumpability:axiom-loss", {
          summaryNodeId: summaryNode.id,
          lostAxioms: vkCheck.lostAxioms,
          axiomScores: vkCheck.axiomScores,
          preservationScore: vkCheck.preservationScore,
        });

        // Throw AxiomLossError — ObstructionHandler catches this and triggers
        // lcm_expand recovery with the lost axioms injected into the retry prompt.
        throw new AxiomLossError(
          summaryNode.id,
          vkCheck.lostAxioms,
          vkCheck.preservationScore,
        );
      }
    }

    // Step 2: Compute source entropy profile.
    const sourceProfile = await computeEntropyProfile(
      sourceTexts,
      this.#embedder,
      this.#tokenCounter,
    );

    // Step 3: Compute summary entropy profile.
    // Treat summary as a single text for embedding.
    const summaryProfile = await computeEntropyProfile(
      [summaryNode.content],
      this.#embedder,
      this.#tokenCounter,
    );

    // Step 4: Entropy preservation ratio.
    const entropyPreservationRatio =
      sourceProfile.entropy > 1e-12
        ? summaryProfile.entropy / sourceProfile.entropy
        : NaN;

    // Step 5: Centroid similarity.
    const centroidSimilarity = computeCentroidSimilarity(
      sourceProfile,
      summaryProfile,
    );

    // Step 6: Select threshold for this escalation level.
    const threshold = this.#getThreshold(escalationLevel);

    // Step 7: Classify.
    const classification = this.#classify(
      entropyPreservationRatio,
      centroidSimilarity,
      threshold,
    );

    // Step 8: Build result.
    const result: AuditResult = {
      summaryNodeId: summaryNode.id,
      sourceEntryIds: summaryNode.originalEntryIds,
      escalationLevel,
      sourceProfile,
      summaryProfile,
      entropyPreservationRatio,
      centroidSimilarity,
      threshold,
      classification,
      timestamp: Date.now(),
      vkCheck,
    };

    // Step 9: Emit events.
    this.emit("lumpability:audit-complete", result);
    if (classification === "weak") {
      this.emit("lumpability:weak-compression", result);
    }

    // Step 10: Store in history (ring buffer).
    this.#history.push(result);
    if (this.#history.length > this.#maxHistorySize) {
      this.#history.shift();
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * #getThreshold — select entropy preservation threshold for the given escalation level.
   */
  #getThreshold(level: EscalationLevel): number {
    switch (level) {
      case 1: return this.#config.l1EntropyThreshold;
      case 2: return this.#config.l2EntropyThreshold;
      case 3: return this.#config.l3EntropyThreshold;
    }
  }

  /**
   * #classify — determine lumpability classification from metrics.
   *
   * Classification logic:
   *   - NaN ratio (source entropy ~0) → degenerate
   *   - ratio >= threshold AND centroidSimilarity >= minCentroidSimilarity → strong
   *   - otherwise → weak
   */
  #classify(
    ratio: number,
    centroidSim: number,
    threshold: number,
  ): LumpabilityClassification {
    if (isNaN(ratio)) return "degenerate";
    if (ratio >= threshold && centroidSim >= this.#config.minCentroidSimilarity) {
      return "strong";
    }
    return "weak";
  }

  // -------------------------------------------------------------------------
  // Public query API
  // -------------------------------------------------------------------------

  /**
   * getHistory — returns the rolling audit history.
   * Used by SOCTracker integration and monitoring dashboards.
   */
  getHistory(): readonly AuditResult[] {
    return [...this.#history];
  }

  /**
   * getWeakCompressionRate — fraction of recent audits classified as 'weak'.
   * Returns 0 if no audits have been performed.
   */
  getWeakCompressionRate(): number {
    if (this.#history.length === 0) return 0;
    const weakCount = this.#history.filter(
      (r) => r.classification === "weak",
    ).length;
    return weakCount / this.#history.length;
  }

  /**
   * getAverageEntropyPreservation — mean entropy preservation ratio
   * across all non-degenerate audits in history.
   */
  getAverageEntropyPreservation(): number {
    const valid = this.#history.filter(
      (r) => !isNaN(r.entropyPreservationRatio),
    );
    if (valid.length === 0) return NaN;
    const sum = valid.reduce(
      (acc, r) => acc + r.entropyPreservationRatio, 0,
    );
    return sum / valid.length;
  }

  /**
   * getConfig — returns a copy of the current configuration.
   */
  getConfig(): LumpabilityConfig {
    return { ...this.#config };
  }
}
