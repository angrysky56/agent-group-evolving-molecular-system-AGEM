import type { CohomologySnapshot } from "../../../shared/types.js";
import {
  computeCohomology,
  type CellularSheaf,
} from "#agem/sheaf/index.js";

/**
 * H0 is a graph component count only for a constant scalar sheaf: every stalk
 * is one-dimensional and the two restriction maps on each edge agree up to a
 * shared non-zero scalar. Vector-valued concept stalks do not meet this test.
 */
function hasConstantScalarComponentSemantics(sheaf: CellularSheaf): boolean {
  if (
    sheaf.getVertexIds().some((id) => sheaf.getVertex(id).stalkSpace.dim !== 1)
  ) {
    return false;
  }
  return sheaf.getEdgeIds().every((id) => {
    const edge = sheaf.getEdge(id);
    const source = edge.sourceRestriction.entries;
    const target = edge.targetRestriction.entries;
    return (
      edge.stalkSpace.dim === 1 &&
      source.length === 1 &&
      target.length === 1 &&
      Math.abs(source[0]!) > 1e-12 &&
      Math.abs(source[0]! - target[0]!) <= 1e-12
    );
  });
}

/**
 * Report registry-sheaf cohomology only when the construction has enough
 * topology to make H0/H1 meaningful. Warning text cannot neutralize a number,
 * so degenerate cases omit the numeric fields entirely.
 */
export function registryCohomologySnapshot(
  sheaf: CellularSheaf,
  builtFromRegistry: boolean,
  analyzedFromRegistry: boolean,
  buildError?: string | null,
): CohomologySnapshot {
  const domain = "lcm-subgraph-registry" as const;
  if (!builtFromRegistry) {
    if (buildError) {
      return {
        status: "not-computed",
        notComputed: `registry sheaf build failed — ${buildError}`,
        remedy:
          "Re-embed the affected subgraphs with one embedding model, then rerun the sectioned corpus.",
        domain,
        sheaf_vertices: 0,
        sheaf_edges: 0,
      };
    }
    return {
      status: "not-computed",
      notComputed:
        "registry sheaf not built — run run_agem_cycle before requesting cohomology",
      remedy:
        "Ingest one section with run_agem_cycle, or use run_agem_cycles_sectioned for a structured corpus.",
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
      remedy:
        sheaf_vertices === 1
          ? "Use run_agem_cycles_sectioned, or run distinct cycles with distinct subgraph values."
          : "Ingest content into at least two named subgraphs before requesting cohomology.",
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
      remedy:
        "Add genuine bridging material shared by the named subgraphs; do not interpret an edgeless result as H0 or H1.",
      domain,
      sheaf_vertices,
      sheaf_edges,
    };
  }
  if (!analyzedFromRegistry) {
    return {
      status: "not-computed",
      notComputed:
        "registry sheaf analysis deferred until the sectioned corpus run is complete",
      remedy:
        "Wait for the final section and use the combined post-run analysis.",
      domain,
      sheaf_vertices,
      sheaf_edges,
    };
  }

  const cohomology = computeCohomology(sheaf);
  const h0ComponentCountValid = hasConstantScalarComponentSemantics(sheaf);
  return {
    status: "computed",
    c0_dimension: sheaf.c0Dimension,
    c1_dimension: sheaf.c1Dimension,
    h0_dimension: cohomology.h0Dimension,
    cycle_topology_dimension: cohomology.h1Dimension,
    cycle_topology_present: cohomology.h1Dimension > 0,
    coboundary_rank: cohomology.coboundaryRank,
    tolerance: cohomology.tolerance,
    domain,
    sheaf_vertices,
    sheaf_edges,
    h0_meaning: "dimension-of-global-sections",
    h0_component_count_valid: h0ComponentCountValid,
    h0_interpretation: h0ComponentCountValid
      ? "This is a verified constant one-dimensional sheaf, so H0 also equals the number of connected components."
      : "H0 is dim ker(d0), the dimension of the global-section vector space. It is not a count of theories, perspectives, semantic clusters, or graph components for this sheaf.",
    cycle_topology_interpretation:
      "cycle_topology_dimension = c1_dimension - coboundary_rank for the embedding-derived registry restriction maps. A positive value can be created by an additional similarity-threshold edge and is present on cycles even under full agreement; it does not track corpus content, joint satisfiability, or logical obstruction.",
    remedy:
      (h0ComponentCountValid
        ? "Report H0 as a component count only together with h0_component_count_valid=true. "
        : "Report the arithmetic c0_dimension - coboundary_rank = h0_dimension and stop there; do not assign a semantic story to the number without a separately validated basis analysis. ") +
      "Always report cycle_topology_dimension as embedding-derived cycle topology; never call it an obstruction or use it to infer corpus disagreement.",
  };
}
