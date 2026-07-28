import type { CohomologySnapshot } from "../../../shared/types.js";
import {
  computeCohomology,
  type CellularSheaf,
} from "#agem/sheaf/index.js";

/**
 * Report registry-sheaf cohomology only when the construction has enough
 * topology to make H0/H1 meaningful. Warning text cannot neutralize a number,
 * so degenerate cases omit the numeric fields entirely.
 */
export function registryCohomologySnapshot(
  sheaf: CellularSheaf,
  builtFromRegistry: boolean,
): CohomologySnapshot {
  const domain = "lcm-subgraph-registry" as const;
  if (!builtFromRegistry) {
    return {
      status: "not-computed",
      notComputed:
        "registry sheaf not built — run run_agem_cycle before requesting cohomology",
      domain,
      sheaf_vertices: 0,
      sheaf_edges: 0,
    };
  }

  const sheaf_vertices = sheaf.getVertexIds().length;
  const sheaf_edges = sheaf.getEdgeIds().length;
  if (sheaf_vertices < 2) {
    return {
      status: "not-computed",
      notComputed:
        sheaf_vertices === 1
          ? "single registry vertex — cohomology comparison requires at least two registry vertices"
          : "registry sheaf has no vertices",
      domain,
      sheaf_vertices,
      sheaf_edges,
    };
  }
  if (sheaf_edges === 0) {
    return {
      status: "not-computed",
      notComputed:
        "registry sheaf has no edges — no restriction maps exist to compare subgraphs",
      domain,
      sheaf_vertices,
      sheaf_edges,
    };
  }

  const cohomology = computeCohomology(sheaf);
  return {
    status: "computed",
    h0_dimension: cohomology.h0Dimension,
    h1_dimension: cohomology.h1Dimension,
    has_obstruction: cohomology.hasObstruction,
    coboundary_rank: cohomology.coboundaryRank,
    tolerance: cohomology.tolerance,
    domain,
    sheaf_vertices,
    sheaf_edges,
  };
}
