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
import GraphologyLib from 'graphology';
import type { AbstractGraph } from 'graphology-types';
import { Preprocessor } from './Preprocessor.js';
import type { TextNode, TextNodeId, TNAConfig } from './interfaces.js';

// Graphology TypeScript pattern for NodeNext ESM:
// Use the default import as a VALUE (constructor), AbstractGraph as the TYPE.
// The "Cannot use namespace as a type" error occurs when the same identifier
// is used as both constructor and type annotation in strict NodeNext mode.
const GraphConstructor = GraphologyLib as unknown as new (options?: Record<string, unknown>) => AbstractGraph;
type GraphInstance = AbstractGraph;

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
  readonly #preprocessor: Preprocessor;
  readonly #windowSize: number;
  readonly #graph: GraphInstance;

  /**
   * nodeMetadata — maps lemma string to full TextNode data.
   * Tracks: canonical lemma, all surface forms observed, TF-IDF weight.
   */
  readonly #nodeMetadata: Map<string, {
    id: TextNodeId;
    lemma: string;
    surfaceForms: Set<string>;
    tfidfWeight: number;
    communityId?: number;
    betweennessCentrality?: number;
  }> = new Map();

  #currentIteration: number = 0;

  constructor(preprocessor: Preprocessor, config?: TNAConfig) {
    this.#preprocessor = preprocessor;
    this.#windowSize = config?.windowSize ?? DEFAULT_WINDOW_SIZE;
    this.#graph = new GraphConstructor({ type: 'undirected', multi: false });
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
  ingest(text: string, iteration?: number): void {
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
  ingestTokens(tokens: string[], iteration?: number): void {
    if (iteration !== undefined) {
      this.#currentIteration = iteration;
    }

    // For pre-lemmatized tokens, the surface form IS the lemma.
    const surfaceToLemma = new Map<string, string>();
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
  #insertTokensWithSurfaces(
    tokens: readonly string[],
    tfidfScores: ReadonlyMap<string, number>,
    surfaceToLemma: ReadonlyMap<string, string>
  ): void {
    if (tokens.length === 0) return;

    // Build a reverse map: lemma → [surface forms] for this batch.
    const lemmaToSurfaces = new Map<string, string[]>();
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
          id: token as TextNodeId,
          lemma: token,
          surfaceForms: new Set(newSurfaces),
          tfidfWeight: tfidfScores.get(token) ?? 0,
        });
      } else {
        // Node exists: add any new surface forms observed in this batch.
        const existing = this.#nodeMetadata.get(token)!;
        for (const sf of newSurfaces) {
          existing.surfaceForms.add(sf);
        }
        // Update TF-IDF weight if we have a new score.
        if (tfidfScores.get(token) !== undefined) {
          existing.tfidfWeight = tfidfScores.get(token)!;
        }
      }
    }

    // Step 2: Apply 4-gram sliding window — create/accumulate edges.
    for (let i = 0; i < tokens.length; i++) {
      const tokenI = tokens[i];

      for (let d = 1; d < this.#windowSize && i + d < tokens.length; d++) {
        const tokenJ = tokens[i + d];

        // Skip self-loops (same lemma appearing adjacently).
        if (tokenI === tokenJ) continue;

        const weight = this.#windowSize - d; // dist=1 → weight=3, dist=2 → weight=2, dist=3 → weight=1

        if (this.#graph.hasEdge(tokenI, tokenJ)) {
          // Accumulate weight on existing edge.
          const existingEdge = this.#graph.edge(tokenI, tokenJ)!;
          const existingWeight = this.#graph.getEdgeAttribute(existingEdge, 'weight') as number;
          this.#graph.setEdgeAttribute(existingEdge, 'weight', existingWeight + weight);
        } else {
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
          } catch {
            // Edge already exists under a different key direction — accumulate weight.
            const existingEdge = this.#graph.edge(tokenI, tokenJ);
            if (existingEdge) {
              const existingWeight = this.#graph.getEdgeAttribute(existingEdge, 'weight') as number;
              this.#graph.setEdgeAttribute(existingEdge, 'weight', existingWeight + weight);
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
  getGraph(): GraphInstance {
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
  getNode(lemma: string): TextNode | undefined {
    const meta = this.#nodeMetadata.get(lemma);
    if (!meta) return undefined;

    return {
      id: meta.id,
      lemma: meta.lemma,
      surfaceForms: Array.from(meta.surfaceForms),
      tfidfWeight: meta.tfidfWeight,
      communityId: meta.communityId,
      betweennessCentrality: meta.betweennessCentrality,
    };
  }

  /**
   * getNodes — returns all TextNodes in the graph.
   */
  getNodes(): ReadonlyArray<TextNode> {
    return Array.from(this.#nodeMetadata.values()).map(meta => ({
      id: meta.id,
      lemma: meta.lemma,
      surfaceForms: Array.from(meta.surfaceForms),
      tfidfWeight: meta.tfidfWeight,
      communityId: meta.communityId,
      betweennessCentrality: meta.betweennessCentrality,
    }));
  }

  /**
   * getEdgeWeight — returns the accumulated co-occurrence weight between two nodes.
   *
   * @param source - Source node lemma.
   * @param target - Target node lemma.
   * @returns Edge weight, or 0 if no edge exists.
   */
  getEdgeWeight(source: string, target: string): number {
    if (!this.#graph.hasEdge(source, target)) return 0;
    const edge = this.#graph.edge(source, target)!;
    return (this.#graph.getEdgeAttribute(edge, 'weight') as number) ?? 0;
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
  updateNodeCentrality(nodeId: string, score: number): void {
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
  updateNodeCommunity(nodeId: string, communityId: number): void {
    const meta = this.#nodeMetadata.get(nodeId);
    if (meta) {
      meta.communityId = communityId;
    }
  }

  /**
   * order — total number of nodes (unique lemma concepts) in the graph.
   */
  get order(): number {
    return this.#graph.order;
  }

  /**
   * size — total number of edges in the graph.
   */
  get size(): number {
    return this.#graph.size;
  }
}
