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
import type { AbstractGraph } from "graphology-types";
import { Preprocessor } from "./Preprocessor.js";
import type { TextNode, TNAConfig } from "./interfaces.js";
type GraphInstance = AbstractGraph;
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
export declare class CooccurrenceGraph {
    #private;
    constructor(preprocessor: Preprocessor, config?: TNAConfig);
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
    ingest(text: string, iteration?: number): void;
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
    ingestTokens(tokens: string[], iteration?: number): void;
    /**
     * getGraph — returns the underlying graphology Graph instance.
     * Used by LouvainDetector, CentralityAnalyzer, and Phase 4 SOC.
     */
    getGraph(): GraphInstance;
    /**
     * getNode — retrieves TextNode metadata for a given lemma.
     *
     * Returns a frozen TextNode snapshot with surfaceForms as a readonly array.
     *
     * @param lemma - The canonical lemma string (node ID).
     * @returns TextNode or undefined if the node doesn't exist.
     */
    getNode(lemma: string): TextNode | undefined;
    /**
     * getNodes — returns all TextNodes in the graph.
     */
    getNodes(): ReadonlyArray<TextNode>;
    /**
     * getEdgeWeight — returns the accumulated co-occurrence weight between two nodes.
     *
     * @param source - Source node lemma.
     * @param target - Target node lemma.
     * @returns Edge weight, or 0 if no edge exists.
     */
    getEdgeWeight(source: string, target: string): number;
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
    updateNodeCentrality(nodeId: string, score: number): void;
    /**
     * updateNodeCommunity — sets the community ID for a node in the metadata.
     *
     * Called by LouvainDetector after community detection to populate
     * TextNode.communityId.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @param communityId - Community label assigned by Louvain.
     */
    updateNodeCommunity(nodeId: string, communityId: number): void;
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
    updateNodePosition(nodeId: string, x: number, y: number): void;
    /**
     * getNodePosition — returns the cached layout position for a node.
     *
     * Returns undefined if LayoutComputer has not yet computed positions
     * or if the node does not exist.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @returns { x, y } or undefined.
     */
    getNodePosition(nodeId: string): {
        x: number;
        y: number;
    } | undefined;
    /**
     * order — total number of nodes (unique lemma concepts) in the graph.
     */
    get order(): number;
    /**
     * size — total number of edges in the graph.
     */
    get size(): number;
}
export {};
//# sourceMappingURL=CooccurrenceGraph.d.ts.map