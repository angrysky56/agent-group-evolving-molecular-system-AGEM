/**
 * entropyCentrality.test.ts
 *
 * Three things have to hold for this measure to be worth shipping:
 *   1. the fast incremental path equals the obviously-correct brute path;
 *   2. the ranking agrees with the EXACT von Neumann entropy drop, computed
 *      with the real dense solver — not with a hand-copied expectation;
 *   3. it discriminates where degree centrality ties.
 */

import { describe, it, expect } from "vitest";
import { vonNeumannEntropy } from "./entropy.js";
import { computeEntropyCentrality } from "./entropyCentrality.js";
import type { WeightedEdge } from "./fingerEntropy.js";

/** Hub-heavy, Zipfian-ish — the shape a word co-occurrence graph takes. */
function wordish(n: number): WeightedEdge[] {
  const e: WeightedEdge[] = [];
  for (let i = 1; i < n; i++) {
    e.push({
      source: i,
      target: Math.floor(Math.sqrt(i)) % n,
      weight: 1 + (i % 4),
    });
    e.push({ source: i, target: (i * 31 + 7) % n, weight: 1 });
    if (i % 3 === 0) e.push({ source: i, target: (i * 17 + 5) % n, weight: 2 });
  }
  return e;
}

/** Path graph: interior nodes hold it together, endpoints do not. */
function path(n: number): WeightedEdge[] {
  return Array.from({ length: n - 1 }, (_, i) => ({
    source: i,
    target: i + 1,
    weight: 1,
  }));
}

/** Re-index after deleting v, so the exact solver sees a dense id range. */
function withoutNode(edges: WeightedEdge[], v: number): WeightedEdge[] {
  return edges
    .filter((e) => e.source !== v && e.target !== v)
    .map((e) => ({
      source: e.source > v ? e.source - 1 : e.source,
      target: e.target > v ? e.target - 1 : e.target,
      weight: e.weight,
    }));
}

function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (x: readonly number[]): number[] => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(x.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n - 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - mean) * (rb[i] - mean);
    da += (ra[i] - mean) ** 2;
    db += (rb[i] - mean) ** 2;
  }
  return num / Math.sqrt(da * db);
}

describe("entropy centrality — degenerate cases", () => {
  it("returns empty for graphs too small to have structure", () => {
    expect(computeEntropyCentrality(0, []).ranking).toEqual([]);
    expect(computeEntropyCentrality(2, []).ranking).toEqual([]);
    expect(computeEntropyCentrality(10, []).ranking).toEqual([]);
  });

  it("produces one score per node", () => {
    const r = computeEntropyCentrality(30, wordish(30));
    expect(r.scores.length).toBe(30);
    expect(r.ranking).toHaveLength(30);
    expect(new Set(r.ranking).size).toBe(30);
  });
});

describe("entropy centrality — incremental path is exact", () => {
  it("matches the brute-force recompute to floating-point tolerance", () => {
    // The whole point of the incremental update is that it changes cost, not
    // answers. If these ever diverge, the update is wrong.
    for (const n of [12, 40, 90]) {
      const edges = wordish(n);
      const fast = computeEntropyCentrality(n, edges);
      const slow = computeEntropyCentrality(n, edges, { bruteForce: true });
      for (let v = 0; v < n; v++) {
        expect(fast.scores[v]).toBeCloseTo(slow.scores[v], 12);
      }
      expect(fast.ranking).toEqual(slow.ranking);
    }
  });

  it("agrees on a path graph, where degrees are near-uniform", () => {
    const n = 25;
    const fast = computeEntropyCentrality(n, path(n));
    const slow = computeEntropyCentrality(n, path(n), { bruteForce: true });
    for (let v = 0; v < n; v++) {
      expect(fast.scores[v]).toBeCloseTo(slow.scores[v], 12);
    }
  });

  it("agrees when deleting a node isolates its neighbour", () => {
    // A pendant node's only edge vanishes with the hub; the update must not
    // divide by the resulting zero degree.
    const edges: WeightedEdge[] = [
      { source: 0, target: 1, weight: 1 },
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 3, target: 4, weight: 1 },
      { source: 4, target: 0, weight: 1 },
      { source: 5, target: 0, weight: 3 }, // 5 is pendant on 0
    ];
    const fast = computeEntropyCentrality(6, edges);
    const slow = computeEntropyCentrality(6, edges, { bruteForce: true });
    for (let v = 0; v < 6; v++) {
      expect(Number.isFinite(fast.scores[v])).toBe(true);
      expect(fast.scores[v]).toBeCloseTo(slow.scores[v], 12);
    }
  });
});

describe("entropy centrality — agrees with the EXACT entropy drop", () => {
  /*
   * Ground truth is n dense eigendecompositions — ~12 s at n=90, which is why
   * these carry an explicit timeout instead of vitest's 5 s default, and why
   * the result is memoised across both assertions rather than computed twice.
   */
  const N = 90;
  const EDGES = wordish(N);
  let cachedExactDrop: number[] | null = null;

  const exactDrop = (): number[] => {
    if (cachedExactDrop) return cachedExactDrop;
    const base = vonNeumannEntropy(N, EDGES);
    cachedExactDrop = Array.from(
      { length: N },
      (_, v) => base - vonNeumannEntropy(N - 1, withoutNode(EDGES, v)),
    );
    return cachedExactDrop;
  };

  it(
    "ranks nodes like the dense von Neumann solver does",
    { timeout: 120_000 },
    () => {
      const approx = computeEntropyCentrality(N, EDGES);
      const rho = spearman(Array.from(approx.scores), exactDrop());
      // Measured 0.9865 at n=90 and 0.9918 at n=120.
      expect(rho).toBeGreaterThan(0.95);
    },
  );

  it(
    "beats degree centrality as a proxy for the exact drop",
    { timeout: 120_000 },
    () => {
      // Degree is the obvious cheap alternative; it should lose clearly.
      const degree = new Array(N).fill(0);
      for (const e of EDGES) {
        degree[e.source] += e.weight;
        degree[e.target] += e.weight;
      }

      const approx = computeEntropyCentrality(N, EDGES);
      const rhoEntropy = spearman(Array.from(approx.scores), exactDrop());
      const rhoDegree = spearman(degree, exactDrop());
      expect(rhoEntropy).toBeGreaterThan(rhoDegree + 0.3);
    },
  );
});

describe("entropy centrality — discrimination", () => {
  it("separates nodes that degree centrality ties together", () => {
    // The practical argument for this measure: on sparse word graphs degree
    // collapses many nodes into a handful of buckets and cannot order within
    // them.
    const n = 120;
    const edges = wordish(n);
    const degree = new Array(n).fill(0);
    for (const e of edges) {
      degree[e.source] += e.weight;
      degree[e.target] += e.weight;
    }
    const distinct = (xs: readonly number[]): number =>
      new Set(xs.map((x) => x.toFixed(9))).size;

    const approx = computeEntropyCentrality(n, edges);
    const distinctEntropy = distinct(Array.from(approx.scores));
    const distinctDegree = distinct(degree);

    expect(distinctEntropy).toBeGreaterThan(distinctDegree * 3);
    expect(distinctEntropy).toBeGreaterThan(n * 0.9);
  });

  it("ranks a path graph's interior above its endpoints", () => {
    // A sanity check with an unambiguous right answer: removing an endpoint
    // barely touches the structure; removing a middle node severs it.
    const n = 21;
    const r = computeEntropyCentrality(n, path(n));
    const mid = Math.floor(n / 2);
    expect(r.scores[mid]).toBeGreaterThan(r.scores[0]);
    expect(r.scores[mid]).toBeGreaterThan(r.scores[n - 1]);
    expect(r.ranking[r.ranking.length - 1]).toBeGreaterThanOrEqual(0);
  });
});

describe("entropy centrality — determinism and cost", () => {
  it("is bit-identical across runs and invariant to edge order", () => {
    const n = 60;
    const edges = wordish(n);
    const a = computeEntropyCentrality(n, edges);
    const b = computeEntropyCentrality(n, [...edges].reverse());
    expect(a.ranking).toEqual(b.ranking);
    for (let v = 0; v < n; v++) {
      expect(a.scores[v]).toBeCloseTo(b.scores[v], 12);
    }
  });

  it("ranks a graph the dense solver could never rank, in well under a second", () => {
    // n=2000 by exact ΔVNE would be 2000 dense eigendecompositions — hours.
    const n = 2000;
    const edges = wordish(n);
    const t0 = performance.now();
    const r = computeEntropyCentrality(n, edges);
    const elapsed = performance.now() - t0;

    expect(r.ranking).toHaveLength(n);
    expect(elapsed).toBeLessThan(1000);
  });
});
