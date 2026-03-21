/**
 * CooccurrenceGraph.ts
 *
 * 4-gram sliding window weighted co-occurrence graph via graphology.
 *
 * The CRITICAL design invariant: ingest() calls Preprocessor.preprocessDetailed()
 * internally — raw text NEVER touches the graph without lemmatization.
 * This prevents the primary TNA pitfall (node count explosion from morphological
 * variants — Pitfall: 4-gram window without lemmatization).
 *
 * 4-gram sliding window edge weighting:
 *   For each token at position i, tokens at positions i+1 through i+(windowSize-1)
 *   get edges with weight = windowSize - distance.
 *   Default windowSize=4: dist-1 → weight 3, dist-2 → weight 2, dist-3 → weight 1.
 *
 * Dependencies:
 *   - graphology (undirected graph with weighted edges)
 *   - src/tna/Preprocessor.ts (TF-IDF + lemmatization pipeline)
 *   - src/tna/interfaces.ts (TextNode, TextEdge, TextNodeId, TNAConfig)
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import GraphologyLib from "graphology";
// Graphology TypeScript pattern for NodeNext ESM:
// Use the default import as a VALUE (constructor), AbstractGraph as the TYPE.
// The "Cannot use namespace as a type" error occurs when the same identifier
// is used as both constructor and type annotation in strict NodeNext mode.
const GraphConstructor = GraphologyLib;
// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------
const DEFAULT_WINDOW_SIZE = 4;
// ---------------------------------------------------------------------------
// CooccurrenceGraph class
// ---------------------------------------------------------------------------
/**
 * CooccurrenceGraph — builds a weighted undirected co-occurrence graph using
 * a sliding window over lemmatized tokens.
 *
 * Usage:
 *   const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
 *   const graph = new CooccurrenceGraph(preprocessor);
 *
 *   // Ingest raw text (lemmatization happens automatically, surface forms tracked):
 *   graph.ingest('The cats are running and dogs ran', iteration);
 *
 *   // Or ingest pre-lemmatized tokens directly (for unit testing window logic):
 *   graph.ingestTokens(['cat', 'run', 'dog'], iteration);
 *
 *   // Access graph metrics:
 *   graph.order     // node count (unique lemma concepts)
 *   graph.size      // edge count
 *   graph.getNode('run')   // TextNode with surfaceForms
 *   graph.getGraph()       // underlying graphology instance
 */
export class CooccurrenceGraph {
    #preprocessor;
    #windowSize;
    #graph;
    /**
     * nodeMetadata — maps lemma string to full TextNode data.
     * Tracks: canonical lemma, all surface forms observed, TF-IDF weight,
     * community assignment, centrality score, and Phase 6 layout position.
     */
    #nodeMetadata = new Map();
    #currentIteration = 0;
    constructor(preprocessor, config) {
        this.#preprocessor = preprocessor;
        this.#windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
        this.#graph = new GraphConstructor({ type: "undirected", multi: false });
    }
    // --------------------------------------------------------------------------
    // Public: ingest() — raw text path (lemmatization enforced)
    // --------------------------------------------------------------------------
    /**
     * ingest — preprocess raw text and insert lemmatized tokens into the graph.
     *
     * Raw text → Preprocessor.preprocessDetailed() → lemmatized tokens + surface mapping → graph.
     * No surface form ever enters the graph directly.
     * Surface forms are tracked in TextNode.surfaceForms for morphological variant reporting.
     *
     * @param text - Raw input text.
     * @param iteration - Optional reasoning iteration number for edge tracking.
     */
    ingest(text, iteration) {
        if (iteration !== undefined) {
            this.#currentIteration = iteration;
        }
        const result = this.#preprocessor.preprocessDetailed(text);
        // Build a surface-to-lemma map for this ingestion batch.
        // result.surfaceToLemma contains the mapping for all non-stopword tokens.
        const surfaceToLemma = result.surfaceToLemma;
        this.#insertTokensWithSurfaces(result.tokens, result.tfidfScores, surfaceToLemma);
    }
    // --------------------------------------------------------------------------
    // Public: ingestTokens() — pre-lemmatized tokens path (for testing window logic)
    // --------------------------------------------------------------------------
    /**
     * ingestTokens — insert pre-lemmatized tokens directly into the graph.
     *
     * Used in tests where we want exact control over the tokens inserted
     * to verify the sliding window logic without text preprocessing noise.
     * Tokens are treated as already lemmatized — no further lemmatization occurs.
     *
     * @param tokens - Array of pre-lemmatized tokens.
     * @param iteration - Optional reasoning iteration number for edge tracking.
     */
    ingestTokens(tokens, iteration) {
        if (iteration !== undefined) {
            this.#currentIteration = iteration;
        }
        // For pre-lemmatized tokens, the surface form IS the lemma.
        const surfaceToLemma = new Map();
        for (const token of tokens) {
            surfaceToLemma.set(token, token);
        }
        this.#insertTokensWithSurfaces(tokens, new Map(), surfaceToLemma);
    }
    // --------------------------------------------------------------------------
    // Private: core graph insertion logic
    // --------------------------------------------------------------------------
    /**
     * #insertTokensWithSurfaces — applies 4-gram sliding window and inserts nodes/edges.
     *
     * For each token at position i:
     *   - Creates graph node if not already present.
     *   - Updates node's surfaceForms with any new surface forms observed.
     *   - For each j in [i+1, i+windowSize-1]: creates/updates edge (i, j)
     *     with weight += (windowSize - (j - i)).
     *
     * @param tokens - Lemmatized tokens in order.
     * @param tfidfScores - TF-IDF scores for this document's tokens.
     * @param surfaceToLemma - Map of surface form → lemma for tracking.
     */
    #insertTokensWithSurfaces(tokens, tfidfScores, surfaceToLemma) {
        if (tokens.length === 0)
            return;
        // Build a reverse map: lemma → [surface forms] for this batch.
        const lemmaToSurfaces = new Map();
        for (const [surface, lemma] of surfaceToLemma) {
            const existing = lemmaToSurfaces.get(lemma) ?? [];
            existing.push(surface);
            lemmaToSurfaces.set(lemma, existing);
        }
        // Step 1: Ensure all token nodes exist in the graph.
        for (const token of tokens) {
            const newSurfaces = lemmaToSurfaces.get(token) ?? [token];
            if (!this.#graph.hasNode(token)) {
                this.#graph.addNode(token);
                // Create new node metadata.
                this.#nodeMetadata.set(token, {
                    id: token,
                    lemma: token,
                    surfaceForms: new Set(newSurfaces),
                    tfidfWeight: tfidfScores.get(token) ?? 0,
                });
            }
            else {
                // Node exists: add any new surface forms observed in this batch.
                const existing = this.#nodeMetadata.get(token);
                for (const sf of newSurfaces) {
                    existing.surfaceForms.add(sf);
                }
                // Update TF-IDF weight if we have a new score.
                if (tfidfScores.get(token) !== undefined) {
                    existing.tfidfWeight = tfidfScores.get(token);
                }
            }
        }
        // Step 2: Apply 4-gram sliding window — create/accumulate edges.
        for (let i = 0; i < tokens.length; i++) {
            const tokenI = tokens[i];
            for (let d = 1; d < this.#windowSize && i + d < tokens.length; d++) {
                const tokenJ = tokens[i + d];
                // Skip self-loops (same lemma appearing adjacently).
                if (tokenI === tokenJ)
                    continue;
                const weight = this.#windowSize - d; // dist=1 → weight=3, dist=2 → weight=2, dist=3 → weight=1
                if (this.#graph.hasEdge(tokenI, tokenJ)) {
                    // Accumulate weight on existing edge.
                    const existingEdge = this.#graph.edge(tokenI, tokenJ);
                    const existingWeight = this.#graph.getEdgeAttribute(existingEdge, "weight");
                    this.#graph.setEdgeAttribute(existingEdge, "weight", existingWeight + weight);
                }
                else {
                    // Create new edge with weight and iteration tracking.
                    // Build a consistent edge key: always use lexicographic order to avoid
                    // duplicate key conflicts (graphology undirected: a:b = b:a logically).
                    const [n1, n2] = tokenI < tokenJ ? [tokenI, tokenJ] : [tokenJ, tokenI];
                    const edgeKey = `${n1}:${n2}`;
                    try {
                        this.#graph.addEdgeWithKey(edgeKey, tokenI, tokenJ, {
                            weight,
                            createdAtIteration: this.#currentIteration,
                        });
                    }
                    catch {
                        // Edge already exists under a different key direction — accumulate weight.
                        const existingEdge = this.#graph.edge(tokenI, tokenJ);
                        if (existingEdge) {
                            const existingWeight = this.#graph.getEdgeAttribute(existingEdge, "weight");
                            this.#graph.setEdgeAttribute(existingEdge, "weight", existingWeight + weight);
                        }
                    }
                }
            }
        }
    }
    // --------------------------------------------------------------------------
    // Public read API
    // --------------------------------------------------------------------------
    /**
     * getGraph — returns the underlying graphology Graph instance.
     * Used by LouvainDetector, CentralityAnalyzer, and Phase 4 SOC.
     */
    getGraph() {
        return this.#graph;
    }
    /**
     * getNode — retrieves TextNode metadata for a given lemma.
     *
     * Returns a frozen TextNode snapshot with surfaceForms as a readonly array.
     *
     * @param lemma - The canonical lemma string (node ID).
     * @returns TextNode or undefined if the node doesn't exist.
     */
    getNode(lemma) {
        const meta = this.#nodeMetadata.get(lemma);
        if (!meta)
            return undefined;
        return {
            id: meta.id,
            lemma: meta.lemma,
            surfaceForms: Array.from(meta.surfaceForms),
            tfidfWeight: meta.tfidfWeight,
            communityId: meta.communityId,
            betweennessCentrality: meta.betweennessCentrality,
            x: meta.x,
            y: meta.y,
        };
    }
    /**
     * getNodes — returns all TextNodes in the graph.
     */
    getNodes() {
        return Array.from(this.#nodeMetadata.values()).map((meta) => ({
            id: meta.id,
            lemma: meta.lemma,
            surfaceForms: Array.from(meta.surfaceForms),
            tfidfWeight: meta.tfidfWeight,
            communityId: meta.communityId,
            betweennessCentrality: meta.betweennessCentrality,
            x: meta.x,
            y: meta.y,
        }));
    }
    /**
     * getEdgeWeight — returns the accumulated co-occurrence weight between two nodes.
     *
     * @param source - Source node lemma.
     * @param target - Target node lemma.
     * @returns Edge weight, or 0 if no edge exists.
     */
    getEdgeWeight(source, target) {
        if (!this.#graph.hasEdge(source, target))
            return 0;
        const edge = this.#graph.edge(source, target);
        return this.#graph.getEdgeAttribute(edge, "weight") ?? 0;
    }
    // --------------------------------------------------------------------------
    // Public: node attribute updates (used by CentralityAnalyzer and LouvainDetector)
    // --------------------------------------------------------------------------
    /**
     * updateNodeCentrality — sets the betweenness centrality for a node in the metadata.
     *
     * Called by CentralityAnalyzer after computing betweenness centrality to populate
     * TextNode.betweennessCentrality. This is required for T15 (centrality results
     * assigned back to TextNode metadata).
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @param score - Betweenness centrality score in [0, 1].
     */
    updateNodeCentrality(nodeId, score) {
        const meta = this.#nodeMetadata.get(nodeId);
        if (meta) {
            meta.betweennessCentrality = score;
        }
    }
    /**
     * updateNodeCommunity — sets the community ID for a node in the metadata.
     *
     * Called by LouvainDetector after community detection to populate
     * TextNode.communityId.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @param communityId - Community label assigned by Louvain.
     */
    updateNodeCommunity(nodeId, communityId) {
        const meta = this.#nodeMetadata.get(nodeId);
        if (meta) {
            meta.communityId = communityId;
        }
    }
    // --------------------------------------------------------------------------
    // Phase 6: node position methods (used by LayoutComputer — TNA-08)
    // --------------------------------------------------------------------------
    /**
     * updateNodePosition — stores the ForceAtlas2 layout position for a node.
     *
     * Called by LayoutComputer after each ForceAtlas2 simulation to cache
     * the computed (x, y) coordinates in node metadata. These coordinates
     * are exposed via getNode() and getNodePosition() for downstream consumers.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @param x - Horizontal layout position (ForceAtlas2 coordinate space).
     * @param y - Vertical layout position (ForceAtlas2 coordinate space).
     */
    updateNodePosition(nodeId, x, y) {
        const meta = this.#nodeMetadata.get(nodeId);
        if (meta) {
            meta.x = x;
            meta.y = y;
        }
    }
    /**
     * getNodePosition — returns the cached layout position for a node.
     *
     * Returns undefined if LayoutComputer has not yet computed positions
     * or if the node does not exist.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @returns { x, y } or undefined.
     */
    getNodePosition(nodeId) {
        const meta = this.#nodeMetadata.get(nodeId);
        if (meta !== undefined && meta.x !== undefined && meta.y !== undefined) {
            return { x: meta.x, y: meta.y };
        }
        return undefined;
    }
    /**
     * order — total number of nodes (unique lemma concepts) in the graph.
     */
    get order() {
        return this.#graph.order;
    }
    /**
     * size — total number of edges in the graph.
     */
    get size() {
        return this.#graph.size;
    }
}
//# sourceMappingURL=CooccurrenceGraph.js.map