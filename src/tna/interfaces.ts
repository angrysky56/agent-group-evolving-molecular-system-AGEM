/**
 * interfaces.ts
 *
 * TNA (Text Network Analysis) domain types.
 *
 * These types form the foundation for the entire TNA pipeline:
 *   - TextNode: a canonical concept node (ID = lemma form)
 *   - TextEdge: a weighted co-occurrence edge from 4-gram sliding window
 *   - GapMetrics: inter-community structural gap measurements
 *   - CommunityAssignment: Louvain community detection output
 *   - TNAConfig: configuration with defaults
 *   - PreprocessResult: output of the TF-IDF + lemmatization pipeline
 *
 * ZERO external imports — pure TypeScript interfaces only.
 */

// ---------------------------------------------------------------------------
// Branded ID type
// ---------------------------------------------------------------------------

/**
 * TextNodeId — opaque branded string type for TNA graph node IDs.
 *
 * The ID IS the canonical lemma form of the concept. For example, the
 * surface forms "running", "runs", "ran" all map to TextNodeId "run".
 *
 * Matches the VertexId/EdgeId pattern from GraphTypes.ts for consistency.
 */
export type TextNodeId = string & { readonly __brand: 'TextNodeId' };

// ---------------------------------------------------------------------------
// Core graph types
// ---------------------------------------------------------------------------

/**
 * TextNode — a node in the TNA co-occurrence graph.
 *
 * Represents a unique semantic concept identified by its canonical lemma.
 * The node tracks all morphological surface forms observed across ingested text.
 *
 * Design invariant: `id` is always a TextNodeId (branded canonical lemma).
 * No raw surface forms appear as node IDs — lemmatization happens BEFORE
 * graph insertion.
 */
export interface TextNode {
  readonly id: TextNodeId;
  /** Canonical lemma form (same as id.valueOf(), but typed as string for convenience). */
  readonly lemma: string;
  /** All morphological variants observed in source text (e.g., "running", "runs", "ran"). */
  readonly surfaceForms: readonly string[];
  /** TF-IDF weight for this concept in the source corpus. */
  readonly tfidfWeight: number;
  /** Community label assigned by LouvainDetector. Set after community detection. */
  readonly communityId?: number;
  /** Betweenness centrality score. Set after CentralityAnalyzer runs. */
  readonly betweennessCentrality?: number;
}

/**
 * TextEdge — a weighted co-occurrence edge in the TNA graph.
 *
 * Weight reflects co-occurrence proximity in the 4-gram sliding window:
 *   - adjacency distance 1: weight += 3
 *   - adjacency distance 2: weight += 2
 *   - adjacency distance 3: weight += 1
 *
 * `createdAtIteration` supports Phase 4 SOC per-iteration surprising-edge-ratio
 * computation (prevents Pitfall 9: surprising edge ratio as cumulative measure).
 */
export interface TextEdge {
  readonly source: TextNodeId;
  readonly target: TextNodeId;
  /** Accumulated co-occurrence weight from all 4-gram window occurrences. */
  readonly weight: number;
  /**
   * Reasoning iteration at which this edge was first created.
   * Required for Phase 4 SOC per-iteration surprising-edge-ratio.
   * Prevents Pitfall 9: treating surprising-edge-ratio as cumulative.
   */
  readonly createdAtIteration: number;
}

// ---------------------------------------------------------------------------
// Community analysis types
// ---------------------------------------------------------------------------

/**
 * CommunityAssignment — result of Louvain community detection for a single node.
 */
export interface CommunityAssignment {
  readonly nodeId: TextNodeId;
  readonly communityId: number;
  readonly modularity: number;
}

/**
 * GapMetrics — structural gap measurements between two communities.
 *
 * Used to detect semantic gaps for Molecular-CoT bridging operations.
 * Phase 3 TNA-04 (GapDetector) produces these from the co-occurrence graph.
 */
export interface GapMetrics {
  readonly communityA: number;
  readonly communityB: number;
  /** Density of edges crossing the boundary between communities A and B. */
  readonly interCommunityDensity: number;
  /** Shortest path length between any node in A and any node in B. */
  readonly shortestPathLength: number;
  /**
   * Change in modularity if the gap were bridged.
   * Negative = bridging would reduce modularity (structural gap is real).
   */
  readonly modularityDelta: number;
  /** Nodes that lie on shortest paths between communities (bridge candidates). */
  readonly bridgeNodes: readonly TextNodeId[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * TNAConfig — configuration for the TNA pipeline with documented defaults.
 *
 * All fields optional; Preprocessor and CooccurrenceGraph apply defaults.
 */
export interface TNAConfig {
  /**
   * Number of tokens in each sliding window (default: 4).
   * A 4-gram window creates edges with weights 3, 2, 1 for distances 1, 2, 3.
   */
  windowSize?: number;
  /**
   * Minimum TF-IDF weight for a token to be included in output (default: 0.1).
   * Tokens below this threshold are treated as stop-like and dropped.
   */
  minTfidfWeight?: number;
  /**
   * Random seed for Louvain community detection (default: 42).
   * Fixed seed ensures deterministic community assignments.
   */
  louvainSeed?: number;
  /**
   * Language code for stopword removal (default: 'en').
   * Passed to stopword library for language-specific stopword corpus.
   */
  language?: string;
}

// ---------------------------------------------------------------------------
// Preprocessing result
// ---------------------------------------------------------------------------

/**
 * PreprocessResult — output of the Preprocessor.preprocess() pipeline.
 *
 * `tokens` are guaranteed to be:
 *   1. Lowercased
 *   2. Stopword-removed
 *   3. Lemmatized (canonical form only — no surface forms appear here)
 *   4. TF-IDF filtered (below minTfidfWeight dropped)
 *
 * No raw surface forms ever appear in `tokens`. This is the primary
 * pitfall guard for TNA (Pitfall: 4-gram window without lemmatization).
 */
export interface PreprocessResult {
  /** Lemmatized, stopword-removed, TF-IDF-filtered tokens in order. */
  readonly tokens: readonly string[];
  /** TF-IDF score per lemma for this document within the current corpus. */
  readonly tfidfScores: ReadonlyMap<string, number>;
}
