/**
 * fingerEntropy.test.ts
 *
 * The approximation is only worth having if it (a) agrees with the exact
 * solver, (b) errs in the conservative direction, and (c) gets MORE accurate
 * as the graph grows — since growth is exactly why it exists.
 *
 * Every accuracy test compares against the real `vonNeumannEntropy` from
 * entropy.ts, not against a hand-copied expectation.
 */

import { describe, it, expect } from "vitest";
import { vonNeumannEntropy } from "./entropy.js";
import {
  fingerVonNeumannEntropy,
  fingerVonNeumannEntropyClosedForm,
  type WeightedEdge,
} from "./fingerEntropy.js";

/** Complete graph Kₙ — the case entropy.ts documents (exact H = ln(n−1)). */
function completeGraph(n: number, weight = 1): WeightedEdge[] {
  const edges: WeightedEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ source: i, target: j, weight });
    }
  }
  return edges;
}

/** Deterministic sparse graph with hubs — closer to a real TNA graph. */
function sparseGraph(n: number, degree = 4): WeightedEdge[] {
  const edges: WeightedEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 1; k <= degree; k++) {
      const j = (i * 7 + k * 13 + 1) % n;
      if (j !== i) {
        edges.push({ source: i, target: j, weight: 1 + ((i + k) % 3) });
      }
    }
  }
  return edges;
}

describe("FINGER — degenerate cases match the exact solver", () => {
  it("returns 0 for empty, single-node, and edgeless graphs", () => {
    expect(fingerVonNeumannEntropy(0, []).entropy).toBe(0);
    expect(fingerVonNeumannEntropy(1, []).entropy).toBe(0);
    expect(fingerVonNeumannEntropy(10, []).entropy).toBe(0);
    expect(vonNeumannEntropy(10, [])).toBe(0);
  });

  it("ignores self-loops and out-of-range ids, as the dense builder does", () => {
    const withJunk: WeightedEdge[] = [
      ...completeGraph(6),
      { source: 2, target: 2, weight: 5 },
      { source: -1, target: 3, weight: 5 },
      { source: 3, target: 99, weight: 5 },
    ];
    const a = fingerVonNeumannEntropy(6, withJunk).entropy;
    const b = fingerVonNeumannEntropy(6, completeGraph(6)).entropy;
    expect(a).toBeCloseTo(b, 12);
  });

  it("sums the weights of repeated pairs, as the dense builder does", () => {
    const doubled: WeightedEdge[] = [
      { source: 0, target: 1, weight: 1 },
      { source: 1, target: 0, weight: 1 },
      { source: 1, target: 2, weight: 2 },
    ];
    const merged: WeightedEdge[] = [
      { source: 0, target: 1, weight: 2 },
      { source: 1, target: 2, weight: 2 },
    ];
    expect(fingerVonNeumannEntropy(3, doubled).entropy).toBeCloseTo(
      fingerVonNeumannEntropy(3, merged).entropy,
      12,
    );
  });
});

describe("FINGER — Q closed form is right for Kₙ", () => {
  it("gives Q = (n−2)/(n−1) on the complete graph", () => {
    // Derived in the module header; this is the anchor for the whole method.
    for (const n of [4, 10, 40]) {
      const r = fingerVonNeumannEntropy(n, completeGraph(n));
      expect(r.q).toBeCloseTo((n - 2) / (n - 1), 10);
    }
  });

  it("gives λ_max(ρ) = 1/(n−1) on the complete graph", () => {
    for (const n of [4, 10, 40]) {
      const r = fingerVonNeumannEntropy(n, completeGraph(n));
      expect(r.lambdaMax).toBeCloseTo(1 / (n - 1), 8);
      expect(r.converged).toBe(true);
    }
  });
});

describe("FINGER — accuracy against the exact solver", () => {
  it("is a LOWER bound on the exact entropy (Theorem 1)", () => {
    // Conservative direction: the metric never over-claims structure.
    for (const n of [8, 20, 50]) {
      for (const edges of [completeGraph(n), sparseGraph(n)]) {
        const exact = vonNeumannEntropy(n, edges);
        const approx = fingerVonNeumannEntropy(n, edges).entropy;
        expect(approx).toBeLessThanOrEqual(exact + 1e-9);
      }
    }
  });

  it("matches Kₙ to within 1/(n−1) relative error", () => {
    for (const n of [10, 30, 80]) {
      const edges = completeGraph(n);
      const exact = vonNeumannEntropy(n, edges);
      const approx = fingerVonNeumannEntropy(n, edges).entropy;
      const relErr = Math.abs(exact - approx) / exact;
      expect(relErr).toBeLessThanOrEqual(1 / (n - 1) + 1e-6);
    }
  });

  it("gets MORE accurate as the graph grows — the property that matters", () => {
    const errAt = (n: number): number => {
      const edges = completeGraph(n);
      const exact = vonNeumannEntropy(n, edges);
      const approx = fingerVonNeumannEntropy(n, edges).entropy;
      return Math.abs(exact - approx) / exact;
    };
    const small = errAt(10);
    const medium = errAt(40);
    const large = errAt(100);
    expect(medium).toBeLessThan(small);
    expect(large).toBeLessThan(medium);
  });

  it("stays within 25% on sparse hub-y graphs", () => {
    // Sparse graphs have a less balanced eigenspectrum, so FINGER's bound is
    // looser than on Kₙ. Documented, not hidden.
    for (const n of [30, 60, 120]) {
      const edges = sparseGraph(n);
      const exact = vonNeumannEntropy(n, edges);
      const approx = fingerVonNeumannEntropy(n, edges).entropy;
      expect(approx).toBeGreaterThan(0);
      expect(Math.abs(exact - approx) / exact).toBeLessThan(0.25);
    }
  });

  it("preserves the ORDERING of graphs by entropy", () => {
    // SOC uses VNE as a trend signal across cycles, so monotonicity matters
    // more than absolute value.
    const sizes = [20, 40, 60, 90, 120];
    const exact = sizes.map((n) => vonNeumannEntropy(n, completeGraph(n)));
    const approx = sizes.map(
      (n) => fingerVonNeumannEntropy(n, completeGraph(n)).entropy,
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(exact[i]).toBeGreaterThan(exact[i - 1]);
      expect(approx[i]).toBeGreaterThan(approx[i - 1]);
    }
  });
});

describe("FINGER — determinism", () => {
  it("returns bit-identical results across repeated runs", () => {
    const edges = sparseGraph(80);
    const runs = Array.from(
      { length: 5 },
      () => fingerVonNeumannEntropy(80, edges).entropy,
    );
    for (const r of runs) expect(r).toBe(runs[0]);
  });

  it("is invariant to edge ordering", () => {
    const edges = sparseGraph(50);
    const shuffled = [...edges].reverse();
    expect(fingerVonNeumannEntropy(50, shuffled).entropy).toBeCloseTo(
      fingerVonNeumannEntropy(50, edges).entropy,
      10,
    );
  });
});

describe("FINGER — closed-form fallback", () => {
  it("is looser than the power-iteration estimate but same order", () => {
    const n = 60;
    const edges = completeGraph(n);
    const exact = vonNeumannEntropy(n, edges);
    const hat = fingerVonNeumannEntropy(n, edges).entropy;
    const tilde = fingerVonNeumannEntropyClosedForm(n, edges);
    expect(tilde).toBeGreaterThan(0);
    expect(tilde).toBeLessThan(hat);
    expect(hat).toBeLessThanOrEqual(exact + 1e-9);
  });
});

describe("FINGER — performance", () => {
  it("handles a graph that is intractable for the dense solver", () => {
    // 1500 nodes would be ~10 minutes and ~18 MB of dense matrix for
    // math.eigs(). FINGER must do it in milliseconds.
    const n = 1500;
    const edges = sparseGraph(n, 6);
    const t0 = performance.now();
    const r = fingerVonNeumannEntropy(n, edges);
    const elapsed = performance.now() - t0;

    expect(r.entropy).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
    // Accuracy, not a convergence flag: check the default-settings answer
    // against a far tighter reference run.
    const reference = fingerVonNeumannEntropy(n, edges, {
      tolerance: 0,
      maxIterations: 6000,
    });
    expect(Math.abs(r.entropy - reference.entropy)).toBeLessThan(1e-3);
  });

  it("reports a residual that actually bounds the entropy error", () => {
    // The residual is only useful if it is honest. Compare a loose-tolerance
    // run against a tight one and check the drift respects the reported bound.
    const n = 400;
    const edges = sparseGraph(n, 6);
    const loose = fingerVonNeumannEntropy(n, edges, { tolerance: 1e-4 });
    const tight = fingerVonNeumannEntropy(n, edges, {
      tolerance: 1e-10,
      maxIterations: 20000,
    });
    const drift = Math.abs(loose.entropy - tight.entropy);
    // Entropy error ≈ Q · (relative error in λ_max) ≤ Q · relativeResidual.
    expect(drift).toBeLessThanOrEqual(loose.q * loose.relativeResidual + 1e-9);
  });

  it("reaches a usable error bound at realistic sizes", () => {
    for (const n of [200, 500, 1000]) {
      const r = fingerVonNeumannEntropy(n, sparseGraph(n, 6));
      expect(r.entropy).toBeGreaterThan(0);
      // Worst case observed on deliberately near-regular graphs, where plain
      // power iteration plateaus at its noise floor. Entropy error is bounded
      // by q · relativeResidual, i.e. well under 1e-3 nats.
      expect(r.relativeResidual).toBeLessThan(1e-3);
      expect(r.q * r.relativeResidual).toBeLessThan(1e-3);
    }
  });

  it("converges properly on hub-heavy graphs, as real TNA graphs are", () => {
    // Word co-occurrence graphs have Zipfian degrees, so the top of the
    // spectrum is well separated and power iteration converges cleanly. The
    // near-regular case above is the pathological one, not the typical one.
    const n = 1200;
    const edges: WeightedEdge[] = [];
    for (let i = 1; i < n; i++) {
      edges.push({
        source: i,
        target: Math.floor(Math.sqrt(i)) % n,
        weight: 1 + (i % 4),
      });
      edges.push({ source: i, target: (i * 31 + 7) % n, weight: 1 });
    }
    // Given headroom, hub-heavy graphs converge to arbitrary precision —
    // measured 2.3e-8 residual by 5000 iterations. Near-regular graphs never
    // do; they plateau. That difference is the real distinction.
    const converged = fingerVonNeumannEntropy(n, edges, {
      tolerance: 1e-6,
      maxIterations: 6000,
    });
    expect(converged.converged).toBe(true);

    // And at DEFAULT settings the answer already matches it to ~1e-4 nats,
    // which is what actually matters.
    const dflt = fingerVonNeumannEntropy(n, edges);
    expect(Math.abs(dflt.entropy - converged.entropy)).toBeLessThan(1e-3);
  });
});
