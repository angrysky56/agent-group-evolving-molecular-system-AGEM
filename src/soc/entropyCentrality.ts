/**
 * entropyCentrality.ts — which concepts are structurally load-bearing?
 *
 * Idea
 * ----
 * Rank a node by how much the graph's von Neumann entropy DROPS when the node
 * is removed:
 *
 *     score(v) = Θ(G) − Θ(G∖v)
 *
 * A node whose removal barely changes Θ is structurally redundant; one whose
 * removal collapses it is carrying the structure. This is the dyadic core of
 * Hu, Tian & Zhang, *Identifying Vital Nodes in Hypergraphs Based on Von
 * Neumann Entropy* (Entropy 2023) — their HVC/semi-SAVC. AGEM's TNA graph is
 * an ordinary weighted graph, not a hypergraph, so the s-line-graph and
 * hyperedge-cardinality machinery does not apply and is not implemented; only
 * the entropy-drop criterion transfers.
 *
 * Why this is affordable only now
 * -------------------------------
 * Ranking every node needs n entropy computations. Against the dense O(n³)
 * solver that is O(n⁴) — measured at 43 s for a 120-node graph, and hours at
 * the sizes AGEM actually reaches. Against FINGER's O(n+m) form it is
 * tractable, and with the incremental update below it is roughly O(Σ deg²).
 *
 * Use Q, NOT Ĥ — this is the counter-intuitive part
 * -------------------------------------------------
 * FINGER's entropy estimate is Ĥ = −Q·ln λ_max. The obvious move is to rank by
 * ΔĤ. That is wrong. Measured against the exact solver on a 120-node
 * hub-heavy graph (Spearman rank correlation):
 *
 *     ΔQ                  0.992      ← use this
 *     ΔĤ (full estimate)  0.137
 *     degree centrality   0.116
 *
 * λ_max shifts from node to node, and that shift swamps the ordering. The bare
 * quadratic term Q = 1 − tr(ρ²) is what tracks the exact entropy drop. Note
 * the source paper reaches for the quadratic approximation for SPEED and notes
 * it costs accuracy; on this evidence it is also the more faithful RANKING
 * signal, which is an argument the paper does not make.
 *
 * Discrimination matters as much as correlation: on the same graph the exact
 * scores took 120 distinct values out of 120 nodes, ΔQ likewise 120, while
 * degree centrality took only 16 — it ties nodes into coarse buckets and
 * cannot order within them. That is the practical case for this measure over
 * degree on sparse word graphs.
 *
 * Honest scope
 * ------------
 * This is a STRUCTURAL measure. It says a node holds the graph together; it
 * does not say the node is conceptually significant. A function word that slips
 * past the preprocessor's noise filters will score highly and deserve to, by
 * this metric. It is a signal to feed judgement, not a verdict.
 *
 * The source paper's own evaluation validates epidemic-propagation influence on
 * six hypergraph datasets. That is not the same claim as "important in a
 * reasoning graph", so it is not carried over here as evidence — the numbers
 * above were measured on this repo, against this repo's exact solver.
 */

import {
  buildAdjacency,
  computeQ,
  type Adjacency,
  type WeightedEdge,
} from "./fingerEntropy.js";

export interface EntropyCentralityResult {
  /** ΔQ per node, index-aligned with [0, nodeCount). */
  scores: Float64Array;
  /** Node indices ordered most-load-bearing first. Ties broken by index. */
  ranking: number[];
  /** Q of the intact graph. */
  baselineQ: number;
  nodeCount: number;
  edgeCount: number;
}

export interface EntropyCentralityOptions {
  /**
   * Recompute Q from scratch for each removed node instead of using the
   * incremental update. O(n·m) rather than O(Σ deg²). Exists so tests can pin
   * the fast path against an obviously-correct one.
   */
  bruteForce?: boolean;
}

/**
 * Q for a graph with node `v` deleted, computed from scratch.
 *
 * Note the trace becomes n−1: in AGEM's normalized Laplacian every node
 * contributes exactly 1 to the diagonal, isolated ones included, so deleting a
 * node always drops the trace by exactly 1 regardless of its degree.
 */
function qWithoutNodeBrute(
  nodeCount: number,
  adjacency: Adjacency,
  v: number,
): number {
  const n = nodeCount - 1;
  if (n <= 1) return 0;

  const degrees = Float64Array.from(adjacency.degrees);
  for (const e of adjacency.edges) {
    if (e.source === v) degrees[e.target] -= e.weight;
    else if (e.target === v) degrees[e.source] -= e.weight;
  }

  let s = 0;
  for (const e of adjacency.edges) {
    if (e.source === v || e.target === v) continue;
    const di = degrees[e.source];
    const dj = degrees[e.target];
    if (di <= 0 || dj <= 0) continue;
    s += (e.weight * e.weight) / (di * dj);
  }
  return 1 - (n + 2 * s) / (n * n);
}

/**
 * Q for a graph with node `v` deleted, via incremental update.
 *
 * Only two families of term change when v goes:
 *   1. edges incident to v — dropped entirely;
 *   2. edges with an endpoint in N(v) — their denominators shift, because
 *      those neighbours lost the weight of their edge to v.
 * Everything else is untouched. Cost is O(deg(v) + Σ_{u∈N(v)} deg(u)).
 *
 * Safety: if an edge (i,j) survives the deletion and i ∈ N(v), then
 * dᵢ ≥ w_iv + w_ij, so the updated degree is still ≥ w_ij > 0 — the
 * denominator can never reach zero on a surviving edge.
 */
function qWithoutNodeIncremental(
  nodeCount: number,
  adjacency: Adjacency,
  v: number,
  incident: ReadonlyArray<ReadonlyArray<number>>,
  baseS: number,
): number {
  const n = nodeCount - 1;
  if (n <= 1) return 0;

  const { edges, degrees } = adjacency;

  // Neighbours of v and their reduced degrees.
  const reduced = new Map<number, number>();
  for (const ei of incident[v]) {
    const e = edges[ei];
    const u = e.source === v ? e.target : e.source;
    reduced.set(u, degrees[u] - e.weight);
  }

  let s = baseS;
  const visited = new Set<number>();

  // (1) drop every edge incident to v
  for (const ei of incident[v]) {
    const e = edges[ei];
    const di = degrees[e.source];
    const dj = degrees[e.target];
    if (di > 0 && dj > 0) s -= (e.weight * e.weight) / (di * dj);
    visited.add(ei);
  }

  // (2) re-price every surviving edge that touches a neighbour of v
  for (const u of reduced.keys()) {
    for (const ei of incident[u]) {
      if (visited.has(ei)) continue;
      visited.add(ei);
      const e = edges[ei];
      if (e.source === v || e.target === v) continue;
      const oldI = degrees[e.source];
      const oldJ = degrees[e.target];
      const newI = reduced.get(e.source) ?? oldI;
      const newJ = reduced.get(e.target) ?? oldJ;
      const w2 = e.weight * e.weight;
      if (oldI > 0 && oldJ > 0) s -= w2 / (oldI * oldJ);
      if (newI > 0 && newJ > 0) s += w2 / (newI * newJ);
    }
  }

  return 1 - (n + 2 * s) / (n * n);
}

/**
 * computeEntropyCentrality — rank nodes by the entropy they hold up.
 *
 * Deterministic: no randomness anywhere, and ties resolve by ascending node
 * index, so the same graph always produces the same ranking.
 */
export function computeEntropyCentrality(
  nodeCount: number,
  edges: ReadonlyArray<WeightedEdge>,
  options: EntropyCentralityOptions = {},
): EntropyCentralityResult {
  const scores = new Float64Array(Math.max(0, nodeCount));
  const empty: EntropyCentralityResult = {
    scores,
    ranking: [],
    baselineQ: 0,
    nodeCount,
    edgeCount: 0,
  };
  if (nodeCount <= 2 || edges.length === 0) return empty;

  const adjacency = buildAdjacency(nodeCount, edges);
  if (adjacency.edges.length === 0) return empty;

  const baselineQ = computeQ(nodeCount, adjacency);

  if (options.bruteForce) {
    for (let v = 0; v < nodeCount; v++) {
      scores[v] = baselineQ - qWithoutNodeBrute(nodeCount, adjacency, v);
    }
  } else {
    // Incidence index: node → indices of its edges.
    const incident: number[][] = Array.from({ length: nodeCount }, () => []);
    for (let i = 0; i < adjacency.edges.length; i++) {
      const e = adjacency.edges[i];
      incident[e.source].push(i);
      incident[e.target].push(i);
    }

    // Σ w²/(dᵢdⱼ) over the intact graph — the quantity the update edits.
    let baseS = 0;
    for (const e of adjacency.edges) {
      const di = adjacency.degrees[e.source];
      const dj = adjacency.degrees[e.target];
      if (di > 0 && dj > 0) baseS += (e.weight * e.weight) / (di * dj);
    }

    for (let v = 0; v < nodeCount; v++) {
      scores[v] =
        baselineQ -
        qWithoutNodeIncremental(nodeCount, adjacency, v, incident, baseS);
    }
  }

  const ranking = Array.from({ length: nodeCount }, (_, i) => i).sort(
    (a, b) => scores[b] - scores[a] || a - b,
  );

  return {
    scores,
    ranking,
    baselineQ,
    nodeCount,
    edgeCount: adjacency.edges.length,
  };
}
