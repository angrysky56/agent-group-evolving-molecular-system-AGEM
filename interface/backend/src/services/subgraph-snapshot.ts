import type { SubgraphRegistrySnapshot } from "#agem/lcm/index.js";

export interface EmbeddingSnapshotTag {
  model: string;
  dim: number;
}

export interface PreparedSubgraphSnapshot {
  snapshot: SubgraphRegistrySnapshot;
  invalidations: string[];
}

/**
 * Normalize v3 subgraph embedding provenance before restoring caches.
 *
 * Early v3 snapshots left each subgraph's model tag blank even though the
 * root v2-compatible tag was populated. Treat that root tag as migration
 * provenance; caches without any usable provenance are discarded rather than
 * silently mixed with vectors from the current provider.
 */
export function prepareSubgraphsForEmbeddingModel(
  snapshot: SubgraphRegistrySnapshot,
  currentModel: string,
  legacyTag?: EmbeddingSnapshotTag,
): PreparedSubgraphSnapshot {
  const invalidations: string[] = [];
  const subgraphs = snapshot.subgraphs.map((subgraph) => {
    const vectors = Object.values(subgraph.embeddings);
    const dimensions = new Set(
      vectors.map((vector) => vector.length).filter((dim) => dim > 0),
    );
    const declaredModel =
      subgraph.embeddingModel.trim() || legacyTag?.model.trim() || "";
    const reasons: string[] = [];

    if (vectors.length > 0 && !declaredModel) {
      reasons.push("snapshot has no embedding-model provenance");
    } else if (declaredModel && declaredModel !== currentModel) {
      reasons.push(
        `snapshot used '${declaredModel}', current model is '${currentModel}'`,
      );
    }
    if (dimensions.size > 1) {
      reasons.push(
        `snapshot contains mixed embedding dimensions (${[...dimensions].join(", ")})`,
      );
    }
    if (
      legacyTag &&
      declaredModel === legacyTag.model &&
      subgraph.id === snapshot.activeSubgraphId &&
      dimensions.size === 1 &&
      !dimensions.has(legacyTag.dim)
    ) {
      reasons.push(
        `snapshot vectors do not match tagged dimension ${legacyTag.dim}`,
      );
    }

    if (reasons.length > 0) {
      invalidations.push(
        `Embedding cache invalidated for subgraph '${subgraph.name}': ${reasons.join("; ")}.`,
      );
    }
    return {
      ...subgraph,
      embeddingModel: currentModel,
      embeddings: reasons.length > 0 ? {} : subgraph.embeddings,
    };
  });

  return {
    snapshot: { activeSubgraphId: snapshot.activeSubgraphId, subgraphs },
    invalidations,
  };
}
