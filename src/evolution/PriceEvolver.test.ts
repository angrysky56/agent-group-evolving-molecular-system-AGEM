/**
 * PriceEvolver.test.ts
 *
 * There were no tests for this module at all, which is how a metric that
 * divided by ~0 and a reward channel with zero call sites both survived.
 *
 * These pin the properties that make the numbers mean something: the
 * decomposition must be well-conditioned, fitness must reach the edges it
 * claims to, and reinforcement must actually change weights.
 */

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import GraphologyLib from "graphology";
import type { AbstractGraph } from "graphology-types";
import { PriceEvolver } from "./PriceEvolver.js";
import { DEFAULT_PRICE_CONFIG } from "./interfaces.js";

// Same NodeNext ESM pattern CooccurrenceGraph documents: the default import is
// the VALUE (constructor), AbstractGraph is the TYPE. Using one identifier as
// both is what produces "Cannot use namespace 'Graph' as a type".
const GraphConstructor = GraphologyLib as unknown as new (
  options?: Record<string, unknown>,
) => AbstractGraph;

/** Small graph with known weights and creation iterations. */
function makeGraph(): AbstractGraph {
  const g = new GraphConstructor({ type: "undirected" });
  for (const n of ["a", "b", "c", "d"]) g.addNode(n);
  g.addEdgeWithKey("a:b", "a", "b", { weight: 10, createdAtIteration: 1 });
  g.addEdgeWithKey("b:c", "b", "c", { weight: 5, createdAtIteration: 1 });
  g.addEdgeWithKey("c:d", "c", "d", { weight: 1, createdAtIteration: 2 });
  return g;
}

const weightsOf = (g: AbstractGraph): Record<string, number> => {
  const out: Record<string, number> = {};
  g.forEachEdge((k: string, attrs: unknown) => {
    out[k] = (attrs as { weight: number }).weight;
  });
  return out;
};

describe("conditioning of the Price decomposition", () => {
  it("returns finite, bounded values when almost no edge has fitness", () => {
    // The original bug: w was raw signed fitness, which is 0 for nearly every
    // edge, so w̄ ≈ 0 and both terms were divided by near-zero. On a real run
    // that produced selection jumping 0.0000 → −0.1430 with no change in
    // selection pressure.
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onGapClosure(["d"]); // touches exactly one edge
    const d = p.evolve(2);

    expect(Number.isFinite(d.selection)).toBe(true);
    expect(Number.isFinite(d.transmission)).toBe(true);
    expect(Math.abs(d.selection)).toBeLessThan(1000);
  });

  it("reports exactly zero selection when no edge has fitness", () => {
    // All w equal ⇒ Cov(w,z) = 0. Not a near-zero artifact — exactly 0.
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    const d = p.evolve(2);
    expect(d.selection).toBe(0);
  });

  it("reports zero selection when alpha is 0, whatever the fitness", () => {
    // alpha=0 ⇒ w = 1 for every edge ⇒ no variance in fitness ⇒ no selection.
    const g = makeGraph();
    const p = new PriceEvolver(g, { baseLearningRate: 0, nascentMultiplier: 1 });
    p.beginIteration(2);
    p.onGapClosure(["a", "d"]);
    const d = p.evolve(2);
    expect(d.selection).toBe(0);
  });

  it("scales selection with alpha rather than exploding", () => {
    const run = (alpha: number): number => {
      const g = makeGraph();
      const p = new PriceEvolver(g, {
        baseLearningRate: alpha,
        nascentMultiplier: 1,
      });
      p.beginIteration(2);
      p.onGapClosure(["d"]);
      return p.evolve(2).selection;
    };
    const small = Math.abs(run(0.1));
    const large = Math.abs(run(1.0));
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(1000);
  });
});

describe("Pólya reinforcement actually changes weights", () => {
  it("raises the weight of a rewarded edge and leaves others alone", () => {
    const g = makeGraph();
    const before = weightsOf(g);
    const p = new PriceEvolver(g, {
      baseLearningRate: 0.5,
      nascentMultiplier: 1,
    });
    p.beginIteration(2);
    p.onGapClosure(["d"]); // rewards edges incident to d ⇒ c:d
    p.evolve(2);
    const after = weightsOf(g);

    expect(after["c:d"]).toBeGreaterThan(before["c:d"]);
    expect(after["a:b"]).toBe(before["a:b"]);
  });

  it("does not change any weight when alpha is 0", () => {
    const g = makeGraph();
    const before = weightsOf(g);
    const p = new PriceEvolver(g, { baseLearningRate: 0 });
    p.beginIteration(2);
    p.onGapClosure(["d"]);
    p.evolve(2);
    expect(weightsOf(g)).toEqual(before);
  });

  it("never drives a weight below the floor", () => {
    const g = makeGraph();
    const p = new PriceEvolver(g, {
      baseLearningRate: 5,
      nascentMultiplier: 1,
      minEdgeWeight: 0.1,
    });
    p.beginIteration(2);
    p.onWeakLumpability(["e1"]); // large negative fitness on recent edges
    p.evolve(2);
    for (const w of Object.values(weightsOf(g))) {
      expect(w).toBeGreaterThanOrEqual(0.1);
    }
  });
});

describe("fitness channels reach the edges they claim to", () => {
  it("gap closure rewards edges incident to the bridge node", () => {
    // Regression: onGapClosure had ZERO call sites in the entire repo, so the
    // strongest reward (+1.0) was unreachable. It is now wired to
    // orch:obstruction-filled; this pins the behaviour it must have.
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onGapClosure(["d"]);
    const f = p.getCurrentFitnesses().filter((x) => x.fitness !== 0);
    expect(f.map((x) => x.edgeKey)).toEqual(["c:d"]);
  });

  it("recent-edge fitness matches THIS iteration, not a two-cycle window", () => {
    // Regression: #iteration was only assigned inside evolve(), which runs
    // after the events fire, so the filter compared against the previous
    // cycle's number and rewarded a wider window than documented.
    const g = makeGraph(); // c:d created at 2, others at 1
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onSOCMetrics(1.0); // baseline, no reward
    p.onSOCMetrics(2.0); // increase ⇒ reward recent edges
    const rewarded = p
      .getCurrentFitnesses()
      .filter((x) => x.fitness !== 0)
      .map((x) => x.edgeKey);
    expect(rewarded).toEqual(["c:d"]);
  });

  it("treats the first CDP reading as a baseline, not an increase", () => {
    // Previously #previousCDP started at 0, so the first real reading looked
    // like a large increase and handed out fitness for nothing.
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onSOCMetrics(2.45);
    expect(p.getCurrentFitnesses().filter((x) => x.fitness !== 0)).toEqual([]);
  });

  it("rewards a fall in H⁰ (islands bridged), not a fall in H¹", () => {
    // H¹ is ≈0 by construction in the geometric sheaf, so an H¹-reduction
    // reward can never fire. H⁰ is the sheaf's signal that actually moves.
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onFragmentationUpdate(3); // baseline
    p.onFragmentationUpdate(1); // two islands bridged
    const rewarded = p.getCurrentFitnesses().filter((x) => x.fitness !== 0);
    expect(rewarded.length).toBeGreaterThan(0);
  });

  it("does not reward a RISE in H⁰", () => {
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onFragmentationUpdate(1);
    p.onFragmentationUpdate(3);
    expect(p.getCurrentFitnesses().filter((x) => x.fitness !== 0)).toEqual([]);
  });
});

describe("bookkeeping", () => {
  it("clears fitness between iterations", () => {
    const g = makeGraph();
    const p = new PriceEvolver(g);
    p.beginIteration(2);
    p.onGapClosure(["d"]);
    p.evolve(2);
    expect(p.getCurrentFitnesses()).toEqual([]);
  });

  it("handles an empty graph without producing NaN", () => {
    const p = new PriceEvolver(new GraphConstructor({ type: "undirected" }));
    p.beginIteration(1);
    const d = p.evolve(1);
    expect(d.selection).toBe(0);
    expect(d.transmission).toBe(0);
    expect(d.populationSize).toBe(0);
  });

  it("keeps the configured default learning rate available", () => {
    expect(DEFAULT_PRICE_CONFIG.baseLearningRate).toBeGreaterThan(0);
    const p = new PriceEvolver(makeGraph());
    expect(p.getCurrentLearningRate()).toBeGreaterThan(0);
  });
});
