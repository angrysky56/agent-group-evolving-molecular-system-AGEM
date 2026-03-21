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
import type { LumpabilityConfig, AuditResult } from "./interfaces.js";
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
export declare class LumpabilityAuditor extends EventEmitter {
    #private;
    constructor(embedder: IEmbedder, tokenCounter: ITokenCounter, config?: Partial<LumpabilityConfig>);
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
    audit(summaryNode: SummaryNode, sourceEntries: readonly LCMEntry[], escalationLevel: EscalationLevel): Promise<AuditResult>;
    /**
     * getHistory — returns the rolling audit history.
     * Used by SOCTracker integration and monitoring dashboards.
     */
    getHistory(): readonly AuditResult[];
    /**
     * getWeakCompressionRate — fraction of recent audits classified as 'weak'.
     * Returns 0 if no audits have been performed.
     */
    getWeakCompressionRate(): number;
    /**
     * getAverageEntropyPreservation — mean entropy preservation ratio
     * across all non-degenerate audits in history.
     */
    getAverageEntropyPreservation(): number;
    /**
     * getConfig — returns a copy of the current configuration.
     */
    getConfig(): LumpabilityConfig;
}
//# sourceMappingURL=LumpabilityAuditor.d.ts.map