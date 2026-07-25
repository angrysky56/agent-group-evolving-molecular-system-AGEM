/**
 * logicalCohomology.test.ts
 *
 * Pins the two false negatives that made contradiction detection fail silently
 * in practice, and the minimality guarantee that replaces H¹ as the signal.
 *
 * The oracle here is a propositional truth-table evaluator, not a mock with
 * canned answers — it decides satisfiability by actually searching assignments,
 * so the complex is built from real verdicts.
 */

import { describe, it, expect } from "vitest";
import {
  computeLogicalCohomology,
  type SatOracle,
  type LogicalBlock,
} from "./logicalCohomology.js";

/**
 * Satisfiability over propositional formulas in the atoms p, q, r, plus
 * independent atoms a1..a9. Supports the connectives the corpus needs:
 * literals, `&`, `|`, `->`, and leading `-`.
 */
function makeOracle(): SatOracle {
  const atoms = ["p", "q", "r", ...Array.from({ length: 9 }, (_, i) => `a${i}`)];
  const evalFormula = (f: string, env: Record<string, boolean>): boolean => {
    const s = f.replace(/\s+/g, "");
    const impl = s.indexOf("->");
    if (impl >= 0) {
      return (
        !evalFormula(s.slice(0, impl), env) ||
        evalFormula(s.slice(impl + 2), env)
      );
    }
    if (s.includes("|")) return s.split("|").some((x) => evalFormula(x, env));
    if (s.includes("&")) return s.split("&").every((x) => evalFormula(x, env));
    if (s.startsWith("-")) return !evalFormula(s.slice(1), env);
    const name = s.replace(/\(.*\)$/, "");
    return env[name] ?? false;
  };

  return async (formulas: string[]) => {
    const used = atoms.filter((a) =>
      formulas.some((f) => new RegExp(`\\b${a}\\b`).test(f)),
    );
    const total = 1 << used.length;
    for (let mask = 0; mask < total; mask++) {
      const env: Record<string, boolean> = {};
      used.forEach((a, i) => (env[a] = Boolean(mask & (1 << i))));
      if (formulas.every((f) => evalFormula(f, env))) return { consistent: true };
    }
    return { consistent: false };
  };
}

const sat = makeOracle();

/** The canonical frustrated triple: pairwise fine, jointly impossible. */
const TRIPLE: LogicalBlock[] = [
  { name: "P", propositions: ["p(x)"] },
  { name: "PQ", propositions: ["p(x) -> q(x)"] },
  { name: "NQ", propositions: ["-q(x)"] },
];

/** Independent filler blocks, consistent with everything. */
const filler = (n: number): LogicalBlock[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `IND${i}`,
    propositions: [`a${i}(x)`],
  }));

describe("regression: the frustration must survive extra consistent blocks", () => {
  it("detects the triple regardless of how many independent blocks accompany it", async () => {
    // THE bug this fixes. Before, H¹ was the reported detector, and H¹ is 1
    // only at exactly 3 blocks — at 4+ the other filled simplices span the
    // cycle space and cancel it. Real runs name blocks from concept
    // communities, so they almost always have ≥4 and never fired.
    for (const extra of [0, 1, 2, 3, 5]) {
      const r = await computeLogicalCohomology([...TRIPLE, ...filler(extra)], sat);
      expect(r.hasContradiction).toBe(true);
      expect(r.frustrations).toHaveLength(1);
      expect(r.frustrations[0].blocks.sort()).toEqual(["NQ", "P", "PQ"]);
      expect(r.frustrations[0].arity).toBe(3);
    }
  });

  it("still reports H¹ = 1 at exactly three blocks", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat);
    expect(r.h1).toBe(1);
    expect(r.h0).toBe(1);
  });

  it("shows H¹ collapsing to 0 from four blocks on — and says so", async () => {
    // Documents the behaviour rather than pretending it does not happen.
    const r = await computeLogicalCohomology([...TRIPLE, ...filler(1)], sat);
    expect(r.h1).toBe(0);
    expect(r.hasContradiction).toBe(true);
    expect(r.h1Note).toMatch(/Read `frustrations`, not `h1`/);
  });

  it("leaves h1Note unset when there is nothing to explain", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat);
    expect(r.h1Note).toBeUndefined();
  });
});

describe("regression: frustrations above arity 3", () => {
  /*
   * Four blocks, every triple satisfiable, all four together unsatisfiable —
   * the Bell shape. Verified independently against Mace4.
   */
  const QUAD: LogicalBlock[] = [
    { name: "A", propositions: ["p(x) | q(x)"] },
    { name: "B", propositions: ["p(x) | -q(x)"] },
    { name: "C", propositions: ["-p(x) | q(x)"] },
    { name: "D", propositions: ["-p(x) | -q(x)"] },
  ];

  it("finds the 4-wise frustration that triples-only search cannot see", async () => {
    const r = await computeLogicalCohomology(QUAD, sat);
    expect(r.hasContradiction).toBe(true);
    expect(r.frustrations).toHaveLength(1);
    expect(r.frustrations[0].arity).toBe(4);
    expect(r.frustrations[0].blocks.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("confirms every triple really was satisfiable — so H¹ sees nothing", async () => {
    const r = await computeLogicalCohomology(QUAD, sat);
    expect(r.frustratedTriples).toEqual([]);
    expect(r.h1).toBe(0);
    // Exactly the case where the old implementation reported "no contradiction".
    expect(r.h1Note).toBeDefined();
  });

  it("misses it when the arity cap is set below 4, and admits the search was truncated", async () => {
    const r = await computeLogicalCohomology(QUAD, sat, { maxArity: 3 });
    expect(r.hasContradiction).toBe(false);
    expect(r.searchTruncated).toBe(true);
    expect(r.searchedToArity).toBe(3);
  });
});

describe("minimality", () => {
  it("reports the irreducible set, not the supersets that contain it", async () => {
    // With fillers present, {P,PQ,NQ,IND0} is also unsatisfiable — but it is
    // not minimal, and reporting it would be noise.
    const r = await computeLogicalCohomology([...TRIPLE, ...filler(2)], sat);
    expect(r.frustrations).toHaveLength(1);
    expect(r.frustrations[0].blocks).not.toContain("IND0");
  });

  it("reports a pairwise contradiction at arity 2, not as a triple", async () => {
    const r = await computeLogicalCohomology(
      [
        { name: "T", propositions: ["p(x)"] },
        { name: "F", propositions: ["-p(x)"] },
        { name: "X", propositions: ["a0(x)"] },
      ],
      sat,
    );
    expect(r.frustrations).toHaveLength(1);
    expect(r.frustrations[0].arity).toBe(2);
    expect(r.frustrations[0].blocks.sort()).toEqual(["F", "T"]);

    // The unsatisfiable pair never becomes an edge — but X is consistent with
    // both, so the pairwise graph is the connected path T–X–F and H⁰ is 1.
    // Worth pinning: H⁰ is connectivity, and a third block that agrees with
    // both sides of a flat contradiction bridges them in the graph while
    // changing nothing about the contradiction itself.
    expect(r.consistentPairs.map((p) => p.sort().join("|")).sort()).toEqual([
      "F|X",
      "T|X",
    ]);
    expect(r.h0).toBe(1);
  });

  it("excludes internally inconsistent blocks before searching", async () => {
    const r = await computeLogicalCohomology(
      [
        { name: "SELF", propositions: ["p(x)", "-p(x)"] },
        ...TRIPLE,
      ],
      sat,
    );
    expect(r.internallyInconsistent).toEqual(["SELF"]);
    expect(r.vertices).not.toContain("SELF");
    expect(r.hasContradiction).toBe(true);
    expect(r.frustrations[0].blocks.sort()).toEqual(["NQ", "P", "PQ"]);
  });
});

describe("consistent corpora stay clean", () => {
  it("finds no contradiction among mutually consistent blocks", async () => {
    const r = await computeLogicalCohomology(filler(5), sat);
    expect(r.hasContradiction).toBe(false);
    expect(r.frustrations).toEqual([]);
    expect(r.h0).toBe(1);
    expect(r.h1).toBe(0);
    expect(r.h1Note).toBeUndefined();
  });
});

describe("search accounting is honest", () => {
  it("reports how far it searched and how many checks it ran", async () => {
    const r = await computeLogicalCohomology([...TRIPLE, ...filler(2)], sat);
    expect(r.checksPerformed).toBeGreaterThan(0);
    expect(r.checkLog.length).toBeGreaterThanOrEqual(r.checksPerformed);
    expect(r.searchedToArity).toBeGreaterThanOrEqual(3);
  });

  it("flags truncation when the check budget runs out", async () => {
    const r = await computeLogicalCohomology(filler(8), sat, { maxChecks: 5 });
    expect(r.searchTruncated).toBe(true);
  });

  it("does not claim truncation when the lattice was exhausted", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat, { maxArity: 8 });
    expect(r.searchTruncated).toBe(false);
  });

  it("surfaces undetermined checks instead of treating them as consistent", async () => {
    const flaky: SatOracle = async (fs) =>
      fs.length > 1 ? { consistent: null, note: "parse error" } : { consistent: true };
    const r = await computeLogicalCohomology(TRIPLE, flaky);
    expect(r.checkFailures.length).toBeGreaterThan(0);
    expect(r.hasContradiction).toBe(false);
  });
});
