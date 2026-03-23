/**
 * CommunitySummarizer.ts
 *
 * Aggregates individual TNA lemma-nodes into named concept communities.
 *
 * Problem: TNA builds a co-occurrence graph of individual lemmatized words
 * (200+ nodes). Louvain groups them into communities, but the visualization
 * and LLM prompts still show individual words. Users see scattered nodes
 * labeled "algorithm", "fear", "metric" instead of meaningful concept clusters.
 *
 * Solution: This module:
 *   1. Names each community by its top-N nodes (by centrality/weight)
 *   2. Computes community-level statistics (size, density, avg weight)
 *   3. Builds a "concept graph" — communities as super-nodes with
 *      inter-community edges aggregated
 *   4. Provides both detailed and summarized views
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */

import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import type { LouvainDetector } from "./LouvainDetector.js";
import type { CentralityAnalyzer } from "./CentralityAnalyzer.js";

// ─── Types ───

/** A named concept community with its member nodes. */
export interface ConceptCommunity {
  /** Community ID from Louvain. */
  readonly id: number;
  /** Human-readable label from top nodes (e.g., "algorithm · exploitation · engagement"). */
  readonly label: string;
  /** Top-N representative nodes by centrality/weight. */
  readonly topNodes: readonly string[];
  /** All member node IDs. */
  readonly members: readonly string[];
  /** Number of nodes in this community. */
  readonly size: number;
  /** Total internal edge weight. */
  readonly internalWeight: number;
  /** Average TF-IDF weight of member nodes. */
  readonly avgTfidfWeight: number;
  /** Highest centrality score among members. */
  readonly maxCentrality: number;
}

/** An edge between two concept communities (aggregated inter-community links). */
export interface ConceptEdge {
  /** Source community ID. */
  readonly source: number;
  /** Target community ID. */
  readonly target: number;
  /** Number of individual edges crossing between the two communities. */
  readonly edgeCount: number;
  /** Sum of weights of all crossing edges. */
  readonly totalWeight: number;
  /** Average weight per crossing edge. */
  readonly avgWeight: number;
}

/** The full concept-level graph — communities as super-nodes. */
export interface ConceptGraph {
  /** Named concept communities. */
  readonly communities: readonly ConceptCommunity[];
  /** Aggregated inter-community edges. */
  readonly edges: readonly ConceptEdge[];
  /** Modularity score from Louvain. */
  readonly modularity: number;
  /** Total nodes in the underlying word-level graph. */
  readonly totalNodes: number;
  /** Total edges in the underlying word-level graph. */
  readonly totalEdges: number;
}

// ─── CommunitySummarizer ───

export class CommunitySummarizer {
  readonly #graph: CooccurrenceGraph;
  readonly #louvain: LouvainDetector;
  readonly #centrality: CentralityAnalyzer;

  /** Number of top nodes to use for community labeling. */
  readonly #topN: number;

  constructor(
    graph: CooccurrenceGraph,
    louvain: LouvainDetector,
    centrality: CentralityAnalyzer,
    topN: number = 3,
  ) {
    this.#graph = graph;
    this.#louvain = louvain;
    this.#centrality = centrality;
    this.#topN = topN;
  }

  /**
   * summarize() — Build the concept-level graph from current TNA state.
   *
   * Requires Louvain and centrality to have been computed first.
   * Returns a ConceptGraph with named communities and aggregated edges.
   */
  summarize(): ConceptGraph {
    const g = this.#graph.getGraph();
    const assignments = this.#louvain.getAssignments();

    // Group nodes by community
    const communityMembers = new Map<number, string[]>();
    for (const [nodeId, communityId] of assignments) {
      const members = communityMembers.get(communityId) ?? [];
      members.push(nodeId);
      communityMembers.set(communityId, members);
    }

    // Build concept communities
    const communities: ConceptCommunity[] = [];

    for (const [communityId, members] of communityMembers) {
      // Score each member by centrality (primary) + tfidf weight (secondary)
      const scored = members.map((nodeId) => {
        const attrs = g.getNodeAttributes(nodeId) as {
          betweennessCentrality?: number;
          tfidfWeight?: number;
        };
        const centrality = attrs.betweennessCentrality ?? 0;
        const tfidf = attrs.tfidfWeight ?? 0;
        return { nodeId, centrality, tfidf, score: centrality * 10 + tfidf };
      });

      // Sort by combined score descending
      scored.sort((a, b) => b.score - a.score);

      const topNodes = scored.slice(0, this.#topN).map((s) => s.nodeId);
      const label = topNodes.join(" · ");

      // Compute internal edge weight
      const memberSet = new Set(members);
      let internalWeight = 0;
      g.forEachEdge((_edge, attrs, source, target) => {
        if (memberSet.has(source) && memberSet.has(target)) {
          internalWeight += (attrs as { weight?: number }).weight ?? 1;
        }
      });

      const avgTfidf = scored.reduce((s, n) => s + n.tfidf, 0) / scored.length;
      const maxCentrality = scored[0]?.centrality ?? 0;

      communities.push({
        id: communityId,
        label,
        topNodes,
        members,
        size: members.length,
        internalWeight,
        avgTfidfWeight: avgTfidf,
        maxCentrality,
      });
    }

    // Sort communities by size descending
    communities.sort((a, b) => b.size - a.size);

    // Build inter-community edges (aggregated)
    const edgeMap = new Map<string, { count: number; weight: number }>();

    g.forEachEdge((_edge, attrs, source, target) => {
      const srcCommunity = assignments.get(source);
      const tgtCommunity = assignments.get(target);
      if (srcCommunity === undefined || tgtCommunity === undefined) return;
      if (srcCommunity === tgtCommunity) return; // skip intra-community

      // Normalize edge key (smaller community ID first)
      const a = Math.min(srcCommunity, tgtCommunity);
      const b = Math.max(srcCommunity, tgtCommunity);
      const key = `${a}_${b}`;

      const existing = edgeMap.get(key) ?? { count: 0, weight: 0 };
      existing.count++;
      existing.weight += (attrs as { weight?: number }).weight ?? 1;
      edgeMap.set(key, existing);
    });

    const edges: ConceptEdge[] = [];
    for (const [key, data] of edgeMap) {
      const [a, b] = key.split("_").map(Number);
      edges.push({
        source: a!,
        target: b!,
        edgeCount: data.count,
        totalWeight: data.weight,
        avgWeight: data.weight / data.count,
      });
    }

    // Sort edges by total weight descending
    edges.sort((a, b) => b.totalWeight - a.totalWeight);

    return {
      communities,
      edges,
      modularity: this.#louvain.getModularity(),
      totalNodes: g.order,
      totalEdges: g.size,
    };
  }

  /**
   * toTextSummary() — Generate a human/LLM-readable text summary.
   *
   * Used for injecting community-level context into LLM prompts
   * and for the dashboard tooltip/event log.
   */
  toTextSummary(conceptGraph?: ConceptGraph): string {
    const cg = conceptGraph ?? this.summarize();
    const lines: string[] = [
      `Concept Graph: ${cg.communities.length} communities, ${cg.totalNodes} nodes, ${cg.totalEdges} edges (mod=${cg.modularity.toFixed(3)})`,
      "",
    ];

    for (const c of cg.communities) {
      lines.push(
        `  [${c.id}] "${c.label}" (${c.size} nodes, internal_w=${c.internalWeight.toFixed(1)})`,
      );
      if (c.members.length > this.#topN) {
        const others = c.members.filter((m) => !c.topNodes.includes(m));
        lines.push(`       also: ${others.slice(0, 8).join(", ")}${others.length > 8 ? "..." : ""}`);
      }
    }

    if (cg.edges.length > 0) {
      lines.push("");
      lines.push("  Bridges:");
      for (const e of cg.edges.slice(0, 10)) {
        const srcLabel = cg.communities.find((c) => c.id === e.source)?.label ?? `#${e.source}`;
        const tgtLabel = cg.communities.find((c) => c.id === e.target)?.label ?? `#${e.target}`;
        lines.push(
          `    "${srcLabel}" ↔ "${tgtLabel}" (${e.edgeCount} links, w=${e.totalWeight.toFixed(1)})`,
        );
      }
    }

    return lines.join("\n");
  }
}
