/**
 * CatalystQuestionGenerator.ts
 *
 * TNA-07: Catalyst question generation at structural gaps.
 *
 * Generates targeted questions designed to probe the semantic space between
 * weakly-connected communities. These questions serve as bridging queries for
 * VdW agents (ORCH-06), guiding exploration of semantic voids in the TNA graph.
 *
 * Algorithm:
 *   1. For each structural gap (GapMetrics), extract representative nodes from
 *      each community by betweenness centrality (top 3 by default).
 *   2. Compute semantic distance as a graph-topology proxy (Phase 6).
 *      Phase 7 will use actual embedding cosine similarity.
 *   3. Generate 1-3 template-based questions per gap, rotating through 3 templates.
 *   4. Cache results keyed by gapId to avoid redundant recomputation.
 *
 * Template patterns (Phase 6):
 *   A: "How does [nodeA] relate to [nodeB]?"       — direct relationship probe
 *   B: "What concept bridges [nodeA] and [nodeB]?" — bridging concept probe
 *   C: "In what context would [nodeA] and [nodeB] co-occur?" — co-occurrence probe
 *
 * Design constraints:
 *   - ZERO imports from lcm/, sheaf/, soc/, or orchestrator/.
 *   - No LLM calls in Phase 6 (template-based only).
 *   - Cache uses Map<string, CatalystQuestion[]> (manual invalidation).
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type { CentralityAnalyzer } from "./CentralityAnalyzer.js";
import type { GapMetrics, CatalystQuestion } from "./interfaces.js";
/**
 * CatalystQuestionGenerator — generates targeted bridging questions for structural gaps.
 *
 * Usage:
 *   const generator = new CatalystQuestionGenerator(graph, centralityAnalyzer);
 *   const questions = generator.generateQuestions(gap);
 *
 *   // Batch generation for all gaps:
 *   const allQuestions = generator.generateBatchQuestions(gaps);
 *
 *   // Cache management:
 *   generator.invalidateCache('0_1'); // invalidate specific gap
 *   generator.invalidateCache();      // clear all
 */
export declare class CatalystQuestionGenerator {
    #private;
    /**
     * Create a CatalystQuestionGenerator.
     *
     * @param cooccurrenceGraph - The TNA co-occurrence graph (source of node metadata).
     * @param centralityAnalyzer - CentralityAnalyzer for representative node selection.
     * @param config - Optional configuration overrides.
     */
    constructor(cooccurrenceGraph: CooccurrenceGraph, centralityAnalyzer: CentralityAnalyzer, config?: {
        maxRepresentativeNodes?: number;
        maxQuestionsPerGap?: number;
    });
    /**
     * generateQuestions — generate catalyst questions for a single gap.
     *
     * Results are cached by gapId. Subsequent calls for the same gap return
     * the cached result without recomputation.
     *
     * @param gap - The structural gap to generate questions for.
     * @returns Array of CatalystQuestion objects (1-3 per gap, empty if no representatives).
     */
    generateQuestions(gap: GapMetrics): CatalystQuestion[];
    /**
     * generateBatchQuestions — process multiple gaps in a single call.
     *
     * Useful for batch processing during obstruction handling: after GapDetector
     * finds all gaps, this method generates questions for all of them.
     *
     * @param gaps - Array of structural gaps.
     * @returns Map of gapId → CatalystQuestion array.
     */
    generateBatchQuestions(gaps: ReadonlyArray<GapMetrics>): Map<string, CatalystQuestion[]>;
    /**
     * getCachedQuestions — look up cached questions for a gap without recomputing.
     *
     * @param gapId - The gap identifier (format: "{communityA}_{communityB}").
     * @returns Cached CatalystQuestion array, or undefined if not cached.
     */
    getCachedQuestions(gapId: string): CatalystQuestion[] | undefined;
    /**
     * invalidateCache — remove stale cache entries when communities merge or gaps disappear.
     *
     * @param gapId - If provided, remove only this gap's entry. If omitted, clear all.
     */
    invalidateCache(gapId?: string): void;
    /**
     * getCacheSize — returns the number of cached gap entries.
     */
    getCacheSize(): number;
}
//# sourceMappingURL=CatalystQuestionGenerator.d.ts.map