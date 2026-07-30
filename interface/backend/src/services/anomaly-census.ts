/**
 * anomaly-census.ts — surface the surprising facts the discovery phase already
 * found, so abduction is reachable without anyone thinking of it.
 *
 * The gap this closes
 * -------------------
 * `abduce_best_explanation` shipped with five anomaly sources — outlying
 * bridges, structural gaps, H¹ obstructions, logical conflicts, unexplained
 * assertions — and no trigger for any of them. It was called in zero runs.
 * Meanwhile `get_graph_topology`, `detect_gaps` and `get_cohomology` compute
 * exactly those signals on every analysis and report them as numbers.
 *
 * A number in a report is not a prompt to explain anything. The engine could
 * see a 128-link bridge between two communities the partition says are
 * separate, print it, and move on — because nothing turned "here is a
 * measurement" into "here is something that wants explaining".
 *
 * That is the whole job of this module: read the shapes the bridge already
 * returns and emit candidate observations, ranked, with the signals the
 * abductive engine's own anomaly gate will re-check. It decides nothing. The
 * gate still applies its criteria, and a candidate that fails them is reported
 * as not anomalous.
 *
 * Why this is not one more hand-wired path
 * ----------------------------------------
 * The previous fixes each recognised one failure after it happened. This runs
 * on every discovery output and asks the same question of all of them: does
 * this measurement describe something the corpus does not explain? The answer
 * comes from criteria that already exist — GapDetector's own gap test, H¹ > 0,
 * the verdict kinds — rather than from new thresholds invented here.
 */

import type { AnomalySource, Observation } from "./abductive-engine.js";

/** Shapes as `AgemBridge` actually returns them, not as one might assume. */
export interface ConceptCommunity {
  id: number;
  label: string;
  members?: string[];
  size?: number;
}

export interface ConceptEdge {
  source: number | string;
  target: number | string;
  edge_count?: number;
  total_weight?: number;
}

export interface GapSnapshotInput {
  community_a: number;
  community_b: number;
  density: number;
  shortest_path: number;
  modularity_delta: number;
  bridge_nodes?: string[];
}

export interface CandidateAnomaly {
  observation: Observation;
  /** Ordering only. Higher means "look here first", never "this is true". */
  priority: number;
  /** What a person should do with it. */
  suggestedAction: string;
}

/**
 * Bridge strength multiple over the mean that counts as outlying.
 *
 * Matches the default in the abductive engine's own `community-bridge`
 * criterion, so the census never surfaces something the gate will immediately
 * reject as unremarkable. If one moves, the other must.
 */
const BRIDGE_FACTOR = 2;

/** Most anomalies worth putting in front of a reader at once. */
const MAX_CANDIDATES = 6;

function communityName(
  communities: readonly ConceptCommunity[],
  id: number | string,
): string {
  const match = communities.find((c) => String(c.id) === String(id));
  return match?.label ? `${match.label} (community ${id})` : `community ${id}`;
}

/**
 * Concepts standing in for source segments.
 *
 * The abductive engine refuses an observation with no provenance, because an
 * observation nobody can trace is not a fact about the corpus. A structural
 * anomaly's provenance is the graph, and the graph's provenance is the members
 * of the communities involved — so those members ARE the trace, at a coarser
 * granularity than a segment id. Passing them keeps the provenance requirement
 * meaningful rather than working around it.
 */
function conceptProvenance(
  communities: readonly ConceptCommunity[],
  ids: Array<number | string>,
): string[] {
  return ids.flatMap((id) => {
    const match = communities.find((c) => String(c.id) === String(id));
    return (match?.members ?? []).slice(0, 8).map((m) => `concept:${m}`);
  });
}

export interface AnomalyCensusInput {
  communities?: readonly ConceptCommunity[];
  /** Inter-community edges from `concept_graph.edges`. */
  conceptEdges?: readonly ConceptEdge[];
  gaps?: readonly GapSnapshotInput[];
  /** H¹ from the cohomology snapshot. */
  h1?: number;
  /** Verdict kind and frustration arity from a completed logic run. */
  logicVerdict?: { verdictKind?: string; arity?: number };
}

/**
 * Read the discovery output and name what wants explaining.
 *
 * Every criterion here is one the abductive engine's gate will re-apply. This
 * function's only privilege is deciding what to put in front of a reader.
 */
export function censusAnomalies(
  input: AnomalyCensusInput,
): CandidateAnomaly[] {
  const communities = input.communities ?? [];
  const candidates: CandidateAnomaly[] = [];

  // ---- Outlying bridges -------------------------------------------------
  //
  // The Peirce/Einstein run's single most informative structural result was a
  // 128-link bridge against a mean of about 31 — the paper's whole thesis,
  // visible in the topology. It was printed and never explained.
  const edges = (input.conceptEdges ?? []).filter(
    (e) => typeof e.edge_count === "number" && e.edge_count > 0,
  );
  if (edges.length >= 2) {
    const counts = edges.map((e) => e.edge_count!);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    for (const edge of edges) {
      const links = edge.edge_count!;
      if (mean <= 0 || links < mean * BRIDGE_FACTOR) continue;
      const a = communityName(communities, edge.source);
      const b = communityName(communities, edge.target);
      candidates.push({
        priority: links / mean,
        suggestedAction:
          "Propose causes for the joining, stated in the corpus's own vocabulary, and rank them with abduce_best_explanation.",
        observation: {
          id: `bridge-${edge.source}-${edge.target}`,
          phenomenon: `${a} and ${b} are joined by ${links} links against a mean of ${mean.toFixed(1)}, though the community partition treats them as distinct.`,
          source: "community-bridge" as AnomalySource,
          segmentIds: conceptProvenance(communities, [edge.source, edge.target]),
          signals: {
            links,
            meanInterCommunityLinks: Number(mean.toFixed(3)),
            factor: BRIDGE_FACTOR,
          },
        },
      });
    }
  }

  // ---- Structural gaps --------------------------------------------------
  // GapDetector's own criterion, not a new one.
  for (const gap of input.gaps ?? []) {
    if (!(gap.modularity_delta > 0)) continue;
    const a = communityName(communities, gap.community_a);
    const b = communityName(communities, gap.community_b);
    candidates.push({
      priority: gap.modularity_delta,
      suggestedAction:
        "Ask what would account for two cohesive clusters being this weakly joined — a missing intermediate concept, or a genuine conceptual boundary.",
      observation: {
        id: `gap-${gap.community_a}-${gap.community_b}`,
        phenomenon: `${a} and ${b} are only weakly joined (density ${gap.density.toFixed(3)}), yet separating them raises modularity by ${gap.modularity_delta.toFixed(3)}.`,
        source: "structural-gap" as AnomalySource,
        segmentIds: [
          ...conceptProvenance(communities, [gap.community_a, gap.community_b]),
          ...(gap.bridge_nodes ?? []).map((n) => `concept:${n}`),
        ],
        signals: {
          modularityDelta: gap.modularity_delta,
          density: gap.density,
          densityThreshold: 0.2,
        },
      },
    });
  }

  // ---- Cohomological obstruction ---------------------------------------
  if (typeof input.h1 === "number" && input.h1 > 0) {
    candidates.push({
      priority: 10 + input.h1,
      suggestedAction:
        "An obstruction is a structural fact that wants a cause. Propose what would make local agreement fail to glue.",
      observation: {
        id: `h1-${input.h1}`,
        phenomenon: `H¹ = ${input.h1}: locally consistent agreements do not glue into a global section.`,
        source: "cohomology-obstruction" as AnomalySource,
        segmentIds: conceptProvenance(
          communities,
          communities.map((c) => c.id),
        ).slice(0, 12),
        signals: { h1: input.h1 },
      },
    });
  }

  // ---- Established logical conflict ------------------------------------
  //
  // Highest priority by construction: a proved conflict is the least
  // speculative anomaly the system can hold, and the one where an explanation
  // is most clearly owed.
  const kind = input.logicVerdict?.verdictKind;
  const conflictKinds = new Set([
    "corpus-contradiction",
    "position-contradiction",
    "positions-incompatible",
    "mixed",
  ]);
  if (kind && conflictKinds.has(kind)) {
    candidates.push({
      priority: 100,
      suggestedAction:
        "The prover established this. Explaining WHY the corpus holds incompatible commitments is the analytic payload; the verdict alone is not.",
      observation: {
        id: `conflict-${kind}`,
        phenomenon: `The prover established ${kind}${
          input.logicVerdict?.arity
            ? ` at arity ${input.logicVerdict.arity}`
            : ""
        }.`,
        source: "logical-conflict" as AnomalySource,
        segmentIds: conceptProvenance(
          communities,
          communities.map((c) => c.id),
        ).slice(0, 12),
        signals: {
          verdictKind: kind,
          ...(input.logicVerdict?.arity
            ? { arity: input.logicVerdict.arity }
            : {}),
        },
      },
    });
  }

  return candidates
    .sort((a, b) => b.priority - a.priority || a.observation.id.localeCompare(b.observation.id))
    .slice(0, MAX_CANDIDATES);
}

/**
 * The block appended to a discovery tool's output.
 *
 * Returns null when nothing qualified — an empty "anomalies" section would be
 * the same reporting-scaffolding-as-substance failure that made three empty
 * repair proposals look like pending work.
 */
export function anomalyBlock(
  candidates: readonly CandidateAnomaly[],
): Record<string, unknown> | null {
  if (candidates.length === 0) return null;
  return {
    note:
      `${candidates.length} structural observation(s) here are not explained by the corpus. ` +
      "These are CANDIDATES for abduce_best_explanation, not findings. That tool re-applies its " +
      "own anomaly criteria and will decline any that do not meet them. You must supply the " +
      "candidate causes; it ranks and tests, it does not invent.",
    candidates: candidates.map(({ observation, suggestedAction }) => ({
      observation,
      suggestedAction,
    })),
  };
}
