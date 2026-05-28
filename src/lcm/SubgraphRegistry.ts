/**
 * SubgraphRegistry.ts
 *
 * Registry for managing multiple named, independent subgraphs (composable memories).
 *
 * Generalizes the single-graph paradigm. Each Subgraph bundles its own:
 *   - ImmutableStore: raw entry storage
 *   - EmbeddingCache: precomputed embedding vectors
 *   - SummaryIndex: compaction summary nodes
 *   - ContextDAG: structural lineage / cycle detection
 *
 * Cosine-similarity-based routing directs queries to the most relevant subgraph(s)
 * based on the active summary-root embeddings (or raw entries if no summaries exist).
 */

import type {
  IEmbedder,
  ITokenCounter,
  LCMEntry,
  SummaryNode,
} from "./interfaces.js";
import { ImmutableStore } from "./ImmutableStore.js";
import { EmbeddingCache } from "./EmbeddingCache.js";
import { SummaryIndex } from "./SummaryIndex.js";
import { ContextDAG } from "./ContextDAG.js";
import { GptTokenCounter } from "./interfaces.js";
import { uuidv7 } from "uuidv7";
import { cosineSimilarity } from "./LCMGrep.js";

export interface Subgraph {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly store: ImmutableStore;
  readonly cache: EmbeddingCache;
  readonly dag: ContextDAG;
  readonly summaryIndex: SummaryIndex;
  readonly embeddingModel: string;
}

export interface SubgraphSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly embeddingModel: string;
  readonly entries: LCMEntry[];
  readonly embeddings: Record<string, number[]>;
  readonly summaryNodes: SummaryNode[];
}

export interface SubgraphRegistrySnapshot {
  readonly activeSubgraphId: string;
  readonly subgraphs: SubgraphSnapshot[];
}

export class SubgraphRegistry {
  readonly #embedder: IEmbedder;
  readonly #tokenCounter: ITokenCounter;
  readonly #subgraphs = new Map<string, Subgraph>();
  #activeSubgraphId: string;

  constructor(
    embedder: IEmbedder,
    tokenCounter: ITokenCounter = new GptTokenCounter(),
  ) {
    this.#embedder = embedder;
    this.#tokenCounter = tokenCounter;

    // Create the default subgraph at start to keep single-graph backward compatibility
    const defaultGraph = this.create("default", "default");
    this.#activeSubgraphId = defaultGraph.id;
  }

  /** Create and register a new Subgraph. */
  create(name: string, id?: string): Subgraph {
    const subgraphId = id ?? `subgraph-${uuidv7()}`;
    const store = new ImmutableStore(this.#tokenCounter);
    const cache = new EmbeddingCache(this.#embedder);
    const summaryIndex = new SummaryIndex();
    const dag = new ContextDAG(store, summaryIndex);

    const subgraph: Subgraph = {
      id: subgraphId,
      name,
      createdAt: Date.now(),
      store,
      cache,
      dag,
      summaryIndex,
      embeddingModel: "",
    };

    this.#subgraphs.set(subgraphId, subgraph);
    return subgraph;
  }

  /** Retrieve a Subgraph by ID. */
  get(id: string): Subgraph | undefined {
    return this.#subgraphs.get(id);
  }

  /** List all registered subgraphs. */
  list(): Subgraph[] {
    return Array.from(this.#subgraphs.values());
  }

  /** Set the active subgraph ID. */
  activate(id: string): void {
    if (!this.#subgraphs.has(id)) {
      throw new Error(
        `SubgraphRegistry: cannot activate non-existent subgraph '${id}'`,
      );
    }
    this.#activeSubgraphId = id;
  }

  /** Get the active subgraph's ID. */
  get activeSubgraphId(): string {
    return this.#activeSubgraphId;
  }

  /** Get the active Subgraph bundle. */
  get activeSubgraph(): Subgraph {
    return this.#subgraphs.get(this.#activeSubgraphId)!;
  }

  /**
   * route(query, embedder) — ranks subgraphs by maximum cosine similarity
   * of the query embedding against the subgraph's routing targets.
   *
   * Targets are summary-root nodes (no parents), or raw entries if no summary nodes exist.
   * If a summary node has compaction reflections, their questions are also checked.
   */
  async route(
    query: string,
    embedder: IEmbedder,
  ): Promise<Array<{ subgraphId: string; score: number }>> {
    const queryVector = await embedder.embed(query);
    const results: Array<{ subgraphId: string; score: number }> = [];

    for (const subgraph of this.#subgraphs.values()) {
      const rootSummaries = subgraph.summaryIndex
        .list()
        .filter((node) => subgraph.dag.getParentSummary(node.id) === undefined);

      const targetIds =
        rootSummaries.length > 0
          ? rootSummaries.map((n) => n.id)
          : subgraph.store.getAll().map((e) => e.id);

      if (targetIds.length === 0) {
        results.push({ subgraphId: subgraph.id, score: -1.0 });
        continue;
      }

      let maxSim = -1.0;
      for (const targetId of targetIds) {
        const node = subgraph.summaryIndex.get(targetId);
        const candidateIds = [targetId];

        // If target is a summary node, also rank against its indexed reflection questions
        if (node && node.metrics && Array.isArray(node.metrics.reflections)) {
          const reflections = node.metrics.reflections;
          for (let i = 0; i < reflections.length; i++) {
            candidateIds.push(`${targetId}-ref-${i}`);
          }
        }

        for (const cid of candidateIds) {
          let vec = subgraph.cache.getEmbedding(cid);
          if (!vec) {
            // Lazy embed fallback
            if (cid === targetId) {
              const text =
                node?.content ?? subgraph.store.get(targetId)?.content;
              if (text) {
                vec = await embedder.embed(text);
                subgraph.cache.seed(targetId, vec);
              }
            } else {
              // It's a reflection question
              const parts = cid.split("-ref-");
              const idx = parseInt(parts[1] ?? "", 10);
              if (
                node &&
                node.metrics &&
                Array.isArray(node.metrics.reflections)
              ) {
                const ref = node.metrics.reflections[idx];
                if (ref && ref.question) {
                  vec = await embedder.embed(ref.question);
                  subgraph.cache.seed(cid, vec);
                }
              }
            }
          }

          if (vec) {
            const sim = cosineSimilarity(queryVector, vec);
            if (sim > maxSim) {
              maxSim = sim;
            }
          }
        }
      }
      results.push({ subgraphId: subgraph.id, score: maxSim });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /** Export registry as a serializable snapshot. */
  snapshot(): SubgraphRegistrySnapshot {
    const subgraphs: SubgraphSnapshot[] = [];
    for (const sub of this.#subgraphs.values()) {
      subgraphs.push({
        id: sub.id,
        name: sub.name,
        createdAt: sub.createdAt,
        embeddingModel: sub.embeddingModel,
        entries: [...sub.store.getAll()],
        embeddings: sub.cache.snapshot(),
        summaryNodes: sub.dag.snapshot(),
      });
    }
    return {
      activeSubgraphId: this.#activeSubgraphId,
      subgraphs,
    };
  }

  /** Restore registry state from a snapshot. */
  restore(snapshot: SubgraphRegistrySnapshot): void {
    this.#subgraphs.clear();
    for (const subSnap of snapshot.subgraphs) {
      const store = new ImmutableStore(this.#tokenCounter);
      const cache = new EmbeddingCache(this.#embedder);
      const summaryIndex = new SummaryIndex();
      const dag = new ContextDAG(store, summaryIndex);

      store.rehydrate(subSnap.entries);
      for (const [id, vec] of Object.entries(subSnap.embeddings)) {
        cache.seed(id, vec);
      }
      dag.restore(subSnap.summaryNodes);

      const subgraph: Subgraph = {
        id: subSnap.id,
        name: subSnap.name,
        createdAt: subSnap.createdAt,
        store,
        cache,
        dag,
        summaryIndex,
        embeddingModel: subSnap.embeddingModel,
      };

      this.#subgraphs.set(subSnap.id, subgraph);
    }

    const activeId = snapshot.activeSubgraphId;
    if (this.#subgraphs.has(activeId)) {
      this.#activeSubgraphId = activeId;
    } else {
      if (this.#subgraphs.size > 0) {
        this.#activeSubgraphId = this.#subgraphs.keys().next().value!;
      } else {
        const defaultGraph = this.create("default", "default");
        this.#activeSubgraphId = defaultGraph.id;
      }
    }
  }
}
