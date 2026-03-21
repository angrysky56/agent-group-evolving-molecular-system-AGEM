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
// ---------------------------------------------------------------------------
// Template patterns
// ---------------------------------------------------------------------------
/**
 * QUESTION_TEMPLATES — the three template patterns for Phase 6 question generation.
 *
 * Index 0: Direct relationship probe
 * Index 1: Bridging concept probe
 * Index 2: Co-occurrence context probe
 */
const QUESTION_TEMPLATES = [
    (a, b) => `How does ${a} relate to ${b}?`,
    (a, b) => `What concept bridges ${a} and ${b}?`,
    (a, b) => `In what context would ${a} and ${b} co-occur?`,
];
// ---------------------------------------------------------------------------
// CatalystQuestionGenerator class
// ---------------------------------------------------------------------------
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
export class CatalystQuestionGenerator {
    #cooccurrenceGraph;
    #centralityAnalyzer;
    #maxRepresentativeNodes;
    #maxQuestionsPerGap;
    /**
     * Cache: gapId → generated questions.
     * Avoids regeneration when same gap is queried multiple times.
     */
    #questionCache = new Map();
    /**
     * Create a CatalystQuestionGenerator.
     *
     * @param cooccurrenceGraph - The TNA co-occurrence graph (source of node metadata).
     * @param centralityAnalyzer - CentralityAnalyzer for representative node selection.
     * @param config - Optional configuration overrides.
     */
    constructor(cooccurrenceGraph, centralityAnalyzer, config) {
        this.#cooccurrenceGraph = cooccurrenceGraph;
        this.#centralityAnalyzer = centralityAnalyzer;
        this.#maxRepresentativeNodes = config?.maxRepresentativeNodes ?? 3;
        this.#maxQuestionsPerGap = config?.maxQuestionsPerGap ?? 3;
    }
    // --------------------------------------------------------------------------
    // Public: generateQuestions()
    // --------------------------------------------------------------------------
    /**
     * generateQuestions — generate catalyst questions for a single gap.
     *
     * Results are cached by gapId. Subsequent calls for the same gap return
     * the cached result without recomputation.
     *
     * @param gap - The structural gap to generate questions for.
     * @returns Array of CatalystQuestion objects (1-3 per gap, empty if no representatives).
     */
    generateQuestions(gap) {
        const gapId = `${gap.communityA}_${gap.communityB}`;
        // Return cached result if available.
        const cached = this.#questionCache.get(gapId);
        if (cached !== undefined) {
            return cached;
        }
        // Extract representative nodes from each community.
        const nodesA = this.#getRepresentativeNodes(gap.communityA, this.#maxRepresentativeNodes);
        const nodesB = this.#getRepresentativeNodes(gap.communityB, this.#maxRepresentativeNodes);
        // If either community has no nodes, return empty (edge case: orphan community).
        if (nodesA.length === 0 || nodesB.length === 0) {
            this.#questionCache.set(gapId, []);
            return [];
        }
        // Compute semantic distance (Phase 6: topology proxy).
        const distance = this.#computeSemanticDistance(nodesA, nodesB);
        // Generate questions from templates.
        const questions = this.#generateFromTemplates(nodesA, nodesB, gap, distance);
        // Cache and return.
        this.#questionCache.set(gapId, questions);
        return questions;
    }
    // --------------------------------------------------------------------------
    // Public: generateBatchQuestions()
    // --------------------------------------------------------------------------
    /**
     * generateBatchQuestions — process multiple gaps in a single call.
     *
     * Useful for batch processing during obstruction handling: after GapDetector
     * finds all gaps, this method generates questions for all of them.
     *
     * @param gaps - Array of structural gaps.
     * @returns Map of gapId → CatalystQuestion array.
     */
    generateBatchQuestions(gaps) {
        const result = new Map();
        for (const gap of gaps) {
            const gapId = `${gap.communityA}_${gap.communityB}`;
            const questions = this.generateQuestions(gap);
            result.set(gapId, questions);
        }
        return result;
    }
    // --------------------------------------------------------------------------
    // Public: getCachedQuestions()
    // --------------------------------------------------------------------------
    /**
     * getCachedQuestions — look up cached questions for a gap without recomputing.
     *
     * @param gapId - The gap identifier (format: "{communityA}_{communityB}").
     * @returns Cached CatalystQuestion array, or undefined if not cached.
     */
    getCachedQuestions(gapId) {
        return this.#questionCache.get(gapId);
    }
    // --------------------------------------------------------------------------
    // Public: invalidateCache()
    // --------------------------------------------------------------------------
    /**
     * invalidateCache — remove stale cache entries when communities merge or gaps disappear.
     *
     * @param gapId - If provided, remove only this gap's entry. If omitted, clear all.
     */
    invalidateCache(gapId) {
        if (gapId !== undefined) {
            this.#questionCache.delete(gapId);
        }
        else {
            this.#questionCache.clear();
        }
    }
    // --------------------------------------------------------------------------
    // Public: getCacheSize()
    // --------------------------------------------------------------------------
    /**
     * getCacheSize — returns the number of cached gap entries.
     */
    getCacheSize() {
        return this.#questionCache.size;
    }
    // --------------------------------------------------------------------------
    // Private: #getRepresentativeNodes()
    // --------------------------------------------------------------------------
    /**
     * #getRepresentativeNodes — extract top N nodes from a community by centrality.
     *
     * Gets all nodes with matching communityId from CooccurrenceGraph, then sorts
     * by betweennessCentrality descending, returning top N.
     *
     * @param communityId - The Louvain community label.
     * @param count - Maximum number of nodes to return.
     * @returns Array of TextNodes sorted by betweennessCentrality descending.
     */
    #getRepresentativeNodes(communityId, count) {
        const allNodes = this.#cooccurrenceGraph.getNodes();
        // Filter nodes belonging to this community.
        const communityNodes = allNodes.filter((node) => node.communityId === communityId);
        if (communityNodes.length === 0) {
            return [];
        }
        // Sort by betweennessCentrality descending.
        // Use CentralityAnalyzer scores as the authoritative source;
        // TextNode.betweennessCentrality may be stale if compute() was called before
        // community assignment.
        const withScores = communityNodes.map((node) => ({
            node,
            score: this.#centralityAnalyzer.getScore(node.lemma),
        }));
        withScores.sort((a, b) => b.score - a.score);
        // Return top N (or all if fewer than N exist).
        return withScores.slice(0, count).map((entry) => entry.node);
    }
    // --------------------------------------------------------------------------
    // Private: #computeSemanticDistance()
    // --------------------------------------------------------------------------
    /**
     * #computeSemanticDistance — compute semantic distance between two communities.
     *
     * Phase 6 approximation: Uses TF-IDF weight variance as a proxy for semantic
     * distance. Communities with similar TF-IDF profiles are "closer" (smaller
     * semantic distance), while communities with divergent profiles are "farther"
     * (larger semantic distance).
     *
     * Formula:
     *   avgWeightA = mean(tfidfWeight for nodes in community A)
     *   avgWeightB = mean(tfidfWeight for nodes in community B)
     *   raw_distance = |avgWeightA - avgWeightB| / max(avgWeightA, avgWeightB, 0.001)
     *   distance = clamp(raw_distance, 0, 1)
     *
     * Phase 7 will replace this with actual cosine similarity:
     *   distance = 1 - cosine_similarity(centroid_A_embedding, centroid_B_embedding)
     *
     * @param nodesA - Representative nodes from community A.
     * @param nodesB - Representative nodes from community B.
     * @returns Semantic distance in [0, 1] (1 = maximum void).
     */
    #computeSemanticDistance(nodesA, nodesB) {
        if (nodesA.length === 0 || nodesB.length === 0) {
            return 1.0; // maximum distance = maximum void
        }
        const avgWeightA = nodesA.reduce((sum, n) => sum + n.tfidfWeight, 0) / nodesA.length;
        const avgWeightB = nodesB.reduce((sum, n) => sum + n.tfidfWeight, 0) / nodesB.length;
        // If both communities have zero weight (e.g., ingestTokens() without TF-IDF),
        // use centrality difference as the proxy instead.
        if (avgWeightA === 0 && avgWeightB === 0) {
            const avgCentralityA = nodesA.reduce((sum, n) => sum + this.#centralityAnalyzer.getScore(n.lemma), 0) / nodesA.length;
            const avgCentralityB = nodesB.reduce((sum, n) => sum + this.#centralityAnalyzer.getScore(n.lemma), 0) / nodesB.length;
            const maxCentrality = Math.max(avgCentralityA, avgCentralityB, 0.001);
            const rawDistance = Math.abs(avgCentralityA - avgCentralityB) / maxCentrality;
            return Math.min(1, Math.max(0, rawDistance));
        }
        const maxWeight = Math.max(avgWeightA, avgWeightB, 0.001);
        const rawDistance = Math.abs(avgWeightA - avgWeightB) / maxWeight;
        // Clamp to [0, 1].
        return Math.min(1, Math.max(0, rawDistance));
    }
    // --------------------------------------------------------------------------
    // Private: #generateFromTemplates()
    // --------------------------------------------------------------------------
    /**
     * #generateFromTemplates — build CatalystQuestion objects using template patterns.
     *
     * For each pair (nodesA[i], nodesB[i]) up to maxQuestionsPerGap:
     *   - Select template based on index (rotate through 3 templates).
     *   - Build CatalystQuestion with gapId, seeds, distance, priority.
     *
     * Priority ordering: lower semantic distance = higher priority (index 0 = most achievable).
     * Within a gap, all questions share the same semantic distance; priority differentiates
     * by template type (direct=0, bridging=1, co-occurrence=2).
     *
     * Special case — identical communities (distance ~= 0):
     *   Use reconciliation-style question: "How does [nodeA] reinforce [nodeB]?"
     *
     * @param nodesA - Representative nodes from community A.
     * @param nodesB - Representative nodes from community B.
     * @param gap - Source gap metrics.
     * @param distance - Pre-computed semantic distance.
     * @returns Array of CatalystQuestion objects.
     */
    #generateFromTemplates(nodesA, nodesB, gap, distance) {
        const gapId = `${gap.communityA}_${gap.communityB}`;
        const questions = [];
        const pairCount = Math.min(this.#maxQuestionsPerGap, nodesA.length, nodesB.length, QUESTION_TEMPLATES.length);
        for (let i = 0; i < pairCount; i++) {
            const nodeA = nodesA[i];
            const nodeB = nodesB[i];
            let questionText;
            if (distance < 0.05) {
                // Reconciliation question for near-identical communities.
                questionText = `How does ${nodeA.lemma} reinforce ${nodeB.lemma}?`;
            }
            else {
                // Rotate through the 3 standard templates.
                const templateFn = QUESTION_TEMPLATES[i % QUESTION_TEMPLATES.length];
                questionText = templateFn(nodeA.lemma, nodeB.lemma);
            }
            questions.push({
                gapId,
                communityA: gap.communityA,
                communityB: gap.communityB,
                questionText,
                seedNodeA: nodeA.lemma,
                seedNodeB: nodeB.lemma,
                semanticDistance: distance,
                priority: i, // lower index = higher priority (0 = most important)
            });
        }
        return questions;
    }
}
//# sourceMappingURL=CatalystQuestionGenerator.js.map