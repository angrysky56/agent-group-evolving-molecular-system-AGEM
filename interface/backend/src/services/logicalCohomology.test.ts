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
  configuredCohomologyOptions,
  analyzeFormalization,
  normalizePropertyPredication,
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

/**
 * The Bell shape at module scope: every triple satisfiable, all four together
 * unsatisfiable. Used to prove the DEFAULT budget still reaches arity 4 once
 * padded out to a realistic corpus size.
 */
const QUAD_FOR_DEFAULTS: LogicalBlock[] = [
  { name: "QA", propositions: ["p(x) | q(x)"] },
  { name: "QB", propositions: ["p(x) | -q(x)"] },
  { name: "QC", propositions: ["-p(x) | q(x)"] },
  { name: "QD", propositions: ["-p(x) | -q(x)"] },
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

describe("predicate-form conversion and early arity validation", () => {
  it("deterministically converts property reification to predication", () => {
    expect(
      normalizePropertyPredication(
        "all x (holds(x, dominance) -> -newcomb_adequate(x))",
      ),
    ).toBe("all x (dominance(x) -> -newcomb_adequate(x))");
    expect(normalizePropertyPredication("holds(fdt, lesion_adequate)"))
      .toBe("lesion_adequate(fdt)");
  });

  it("applies the convention before the prover and records the repair", async () => {
    const calls: string[][] = [];
    const result = await computeLogicalCohomology(
      [
        { name: "FDT", propositions: ["holds(fdt, lesion_adequate)"] },
        { name: "Constraint", propositions: ["-lesion_adequate(fdt)"] },
      ],
      async (formulas) => {
        calls.push(formulas);
        return {
          consistent:
            !formulas.includes("lesion_adequate(fdt)") ||
            !formulas.includes("-lesion_adequate(fdt)"),
        };
      },
      { abortOnCriticalFormalization: true },
    );

    expect(calls.flat().some((formula) => formula.includes("holds("))).toBe(false);
    expect(result.formalizationRepairs).toEqual([
      expect.stringMatching(/holds\(fdt, lesion_adequate\).*lesion_adequate\(fdt\)/),
    ]);
    expect(result.hasContradiction).toBe(true);
  });

  it("finds arity collisions across blocks, including reified constants", () => {
    const warnings = analyzeFormalization([
      { name: "FDT", propositions: ["holds(fdt, lesion_adequate)"] },
      {
        name: "Rule",
        propositions: [
          "all x (lesion_verdict(x, refrain) -> -lesion_adequate(x))",
        ],
      },
    ]);

    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: "inconsistent_arity",
        severity: "critical",
        detail: expect.arrayContaining([
          expect.stringMatching(/lesion_adequate.*arity 0 and 1.*FDT.*Rule/i),
        ]),
      }),
    );
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
    expect(r.frustrationsComplete).toBe(true);
    // Four internal checks + one full probe + four deletion probes.
    expect(r.checksPerformed).toBeLessThanOrEqual(9);
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

  it("enumerates every independent MUS without walking the powerset", async () => {
    const r = await computeLogicalCohomology(
      [
        { name: "P", propositions: ["p(x)"] },
        { name: "NP", propositions: ["-p(x)"] },
        { name: "Q", propositions: ["q(x)"] },
        { name: "NQ", propositions: ["-q(x)"] },
      ],
      sat,
    );
    expect(
      r.frustrations.map((f) => [...f.blocks].sort().join("|")).sort(),
    ).toEqual(["NP|P", "NQ|Q"]);
    expect(r.frustrationsComplete).toBe(true);
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
    expect(r.frustrations.map((f) => f.blocks.sort())).toEqual(
      expect.arrayContaining([["SELF"], ["NQ", "P", "PQ"]]),
    );
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

  it("certifies the full set once and derives the complete complex", async () => {
    const calls: string[][] = [];
    const modelOracle: SatOracle = async (formulas) => {
      calls.push(formulas);
      return { consistent: true, domainSize: 2 };
    };
    const r = await computeLogicalCohomology(filler(10), modelOracle);

    expect(calls).toHaveLength(11); // 10 internal checks + one full-set model.
    expect(r.checksPerformed).toBe(11);
    expect(r.fullSetCertificate).toEqual({ modelFound: true, domainSize: 2 });
    expect(r.homologyDerivedAnalytically).toBe(true);
    expect(r.consistentPairs).toHaveLength(45);
    expect(r.h0).toBe(1);
    expect(r.h1).toBe(0);
    expect(r.searchedToArity).toBe(10);
    expect(r.searchTruncated).toBe(false);
  });

  it("keeps certified homology bounded at the 120-block extraction cap", async () => {
    const r = await computeLogicalCohomology(
      filler(120),
      async () => ({ consistent: true, domainSize: 2 }),
    );

    expect(r.checksPerformed).toBe(121);
    expect(r.consistentPairs).toHaveLength(7_140);
    expect(r.homologyDerivedAnalytically).toBe(true);
    expect(r.rankD1).toBe(119);
    expect(r.rankD2).toBe(7_021);
    expect(r.h1).toBe(0);
  });

  it("reports full-signature components without using them as a search prune", async () => {
    const r = await computeLogicalCohomology(
      [
        { name: "A", propositions: ["p(x)"] },
        { name: "B", propositions: ["p(x) -> q(x)"] },
        { name: "C", propositions: ["z(x)"] },
      ],
      async () => ({ consistent: true }),
    );
    expect(r.signatureComponents).toEqual([["A", "B"], ["C"]]);
    expect(r.fullSetCertificate?.modelFound).toBe(true);
  });
});

describe("formalization defects — vacuous consistency", () => {
  /*
   * Verbatim replay of a real submission (run 2026-07-25T02-09-27_k88iic) on a
   * corpus containing a Mace4-verified contradiction. Every block encodes
   * negation as a predicate NAME, so nothing can contradict anything, and the
   * tool confidently reported "no contradiction". This is the regression.
   */
  const REAL_RUN: LogicalBlock[] = [
    {
      name: "transfer_argument",
      propositions: [
        "competence_generalizes",
        "all x (capability(x) -> not_distribution_bound(x))",
        "capability_travels",
      ],
    },
    {
      name: "preference_training",
      propositions: [
        "distribution_bound(preference_policy)",
        "all x (distribution_bound(x) -> not_travel(x))",
      ],
    },
    {
      name: "evaluation_mandate",
      propositions: [
        "all x (disposition(x) -> travels(x))",
        "travels(trained_refusal)",
      ],
    },
  ];

  it("flags a negation-free submission as critical", () => {
    const w = analyzeFormalization(REAL_RUN);
    const codes = w.map((x) => x.code);
    expect(codes).toContain("negation_free");
    expect(w.find((x) => x.code === "negation_free")?.severity).toBe("critical");
  });

  it("flags negation smuggled into predicate names", () => {
    const w = analyzeFormalization(REAL_RUN);
    const pseudo = w.find((x) => x.code === "pseudo_negation");
    expect(pseudo).toBeDefined();
    expect(pseudo?.severity).toBe("critical");
    // not_travel vs travels — different symbols, so they cannot contradict.
    expect(pseudo?.detail?.join(" ")).toMatch(/not_travel/);
  });

  it("marks the whole result vacuous rather than reporting a clean bill", async () => {
    const r = await computeLogicalCohomology(
      REAL_RUN,
      async () => ({ consistent: true }),
    );
    expect(r.hasContradiction).toBe(false);
    expect(r.resultIsVacuous).toBe(true);
  });

  it("aborts critical formalizations before spending a prover call", async () => {
    let calls = 0;
    const r = await computeLogicalCohomology(
      REAL_RUN,
      async () => {
        calls++;
        return { consistent: true };
      },
      { abortOnCriticalFormalization: true },
    );

    expect(calls).toBe(0);
    expect(r.checksPerformed).toBe(0);
    expect(r.preflightAborted).toBe(true);
    expect(r.resultIsVacuous).toBe(true);
    expect(r.truncationNote).toMatch(/before the first prover call/i);
  });

  it("allows a clean formalization through the preflight gate", async () => {
    let calls = 0;
    const r = await computeLogicalCohomology(
      TRIPLE,
      async (formulas) => {
        calls++;
        return sat(formulas);
      },
      { abortOnCriticalFormalization: true },
    );

    expect(calls).toBeGreaterThan(0);
    expect(r.preflightAborted).toBe(false);
    expect(r.hasContradiction).toBe(true);
  });

  it("does not flag a proper encoding", () => {
    const w = analyzeFormalization(TRIPLE);
    expect(w.filter((x) => x.severity === "critical")).toEqual([]);
  });

  it("is not vacuous when a contradiction was actually found", async () => {
    // Expressive enough to find one ⇒ the encoding was adequate after all.
    const r = await computeLogicalCohomology(TRIPLE, sat);
    expect(r.hasContradiction).toBe(true);
    expect(r.resultIsVacuous).toBe(false);
  });

  it("keeps critical alias drift fatal when another contradiction is found", async () => {
    const r = await computeLogicalCohomology(
      [
        {
          name: "Epiphenomenalism",
          propositions: [
            "all x (mental_states(x) -> -causes_physical(x))",
            "exists x (mental_states(x))",
          ],
        },
        {
          name: "Interactionism",
          propositions: [
            "all x (mental(x) -> causes_physical(x))",
            "exists x (mental(x))",
          ],
        },
        { name: "P", propositions: ["p(x)"] },
        { name: "NP", propositions: ["-p(x)"] },
      ],
      sat,
    );

    expect(r.hasContradiction).toBe(true);
    expect(r.formalizationWarnings).toContainEqual(
      expect.objectContaining({
        code: "predicate_aliasing_suspected",
        severity: "critical",
      }),
    );
    expect(r.resultIsVacuous).toBe(true);
  });

  /*
   * Verbatim replay of the two calls in run 2026-07-25T06-22-46_1j7q26. The
   * ONLY difference between them is the `exists` lines. Call #1 returned "no
   * contradiction" with zero warnings; call #2 found two real frustrations,
   * one of them a flat pairwise contradiction. The universals in call #1 were
   * all satisfied by the empty world.
   */
  const UNIVERSALS_NO_WITNESS: LogicalBlock[] = [
    {
      name: "A_Transfer",
      propositions: [
        "all x (capability(x) -> travels(x))",
        "all x (capability(x) -> -distribution_bound(x))",
      ],
    },
    {
      name: "B_Preference",
      propositions: [
        "all x (disposition(x) -> distribution_bound(x))",
        "all x (disposition(x) -> -travels(x))",
      ],
    },
    {
      name: "C_Evaluation",
      propositions: [
        "all x (disposition(x) -> travels(x))",
        "all x (disposition(x) -> -distribution_bound(x))",
      ],
    },
  ];

  it("flags universals with no existential witness (regression)", () => {
    // None of the other checks fire here: negation is correct, predicates are
    // shared, blocks genuinely interact. Only the empty-world defect applies.
    const w = analyzeFormalization(UNIVERSALS_NO_WITNESS);
    expect(w.map((x) => x.code)).not.toContain("negation_free");
    expect(w.map((x) => x.code)).not.toContain("pseudo_negation");

    const witness = w.find((x) => x.code === "no_existential_witness");
    expect(witness).toBeDefined();
    expect(witness?.severity).toBe("critical");
  });

  it("clears the warning once witnesses are asserted", () => {
    const withWitnesses = UNIVERSALS_NO_WITNESS.map((b) => ({
      ...b,
      propositions: [
        ...b.propositions,
        b.name === "A_Transfer"
          ? "exists x (capability(x))"
          : "exists x (disposition(x))",
      ],
    }));
    const w = analyzeFormalization(withWitnesses);
    expect(w.map((x) => x.code)).not.toContain("no_existential_witness");
  });

  it("accepts a ground atom as a witness", () => {
    // p(a) forces a non-empty extension just as exists does.
    const w = analyzeFormalization([
      { name: "A", propositions: ["all x (p(x) -> q(x))", "p(a)"] },
      { name: "B", propositions: ["-q(a)"] },
    ]);
    expect(w.map((x) => x.code)).not.toContain("no_existential_witness");
  });

  it("warns when blocks share no predicate symbols", () => {
    const w = analyzeFormalization([
      { name: "A", propositions: ["-alpha(x)"] },
      { name: "B", propositions: ["beta(y)"] },
    ]);
    const iso = w.find((x) => x.code === "isolated_predicates");
    expect(iso).toBeDefined();
    expect(iso?.detail).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("does not warn about isolation when blocks do share vocabulary", () => {
    const w = analyzeFormalization([
      { name: "A", propositions: ["travels(cap)"] },
      { name: "B", propositions: ["-travels(cap)"] },
    ]);
    expect(w.map((x) => x.code)).not.toContain("isolated_predicates");
  });

  it("flags predicate drift that can hide a cross-block contradiction", () => {
    const warnings = analyzeFormalization([
      {
        name: "Epiphenomenalism",
        propositions: [
          "all x (mental_states(x) -> -causes_physical(x))",
          "exists x (mental_states(x))",
        ],
      },
      {
        name: "Interactionism",
        propositions: [
          "all x (mental(x) -> causes_physical(x))",
          "exists x (mental(x))",
        ],
      },
    ]);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: "predicate_aliasing_suspected",
        severity: "critical",
        detail: expect.arrayContaining([
          expect.stringMatching(/mental.*mental_states|mental_states.*mental/),
        ]),
      }),
    );
  });

  it("surfaces embedding alias suggestions without treating them as applied", async () => {
    const suggestion = {
      source: "stereochemical-interaction",
      target: "affinity",
      proposedCanonical: "affinity",
      similarity: 0.97,
      severity: "critical" as const,
    };
    const r = await computeLogicalCohomology(
      [
        { name: "Stereochemical", propositions: ["affinity(x)"] },
        {
          name: "Alternative",
          propositions: ["stereochemical_interaction(x)"],
        },
      ],
      async () => ({ consistent: true }),
      { predicateAliasSuggestions: [suggestion] },
    );

    expect(r.predicateAliases).toEqual({});
    expect(r.predicateAliasSuggestions).toEqual([suggestion]);
    expect(r.formalizationWarnings).toContainEqual(
      expect.objectContaining({
        code: "predicate_aliasing_suspected",
        severity: "critical",
        detail: expect.arrayContaining([
          expect.stringMatching(/stereochemical-interaction.*affinity/),
        ]),
      }),
    );
  });
});

describe("minimal cores — which propositions actually collide", () => {
  it("isolates the load-bearing formulas and drops the passengers", async () => {
    // Each block carries a real claim plus filler that has nothing to do with
    // the clash. The core must name the three that matter and none of the rest.
    const blocks: LogicalBlock[] = [
      { name: "P", propositions: ["p(x)", "a0(x)", "a1(x)"] },
      { name: "PQ", propositions: ["p(x) -> q(x)", "a2(x)"] },
      { name: "NQ", propositions: ["-q(x)", "a3(x)", "a4(x)"] },
    ];
    const r = await computeLogicalCohomology(blocks, sat);

    expect(r.hasContradiction).toBe(true);
    const core = r.frustrations[0].core ?? [];
    const formulas = core.map((c) => c.formula).sort();
    expect(formulas).toEqual(["-q(x)", "p(x)", "p(x) -> q(x)"]);
    expect(r.frustrations[0].coreTruncated).toBeUndefined();
  });

  it("keeps provenance — every core formula names its block", async () => {
    const blocks: LogicalBlock[] = [
      { name: "P", propositions: ["p(x)"] },
      { name: "PQ", propositions: ["p(x) -> q(x)"] },
      { name: "NQ", propositions: ["-q(x)"] },
    ];
    const r = await computeLogicalCohomology(blocks, sat);
    const core = r.frustrations[0].core ?? [];
    expect(core.find((c) => c.formula === "p(x)")?.block).toBe("P");
    expect(core.find((c) => c.formula === "-q(x)")?.block).toBe("NQ");
  });

  it("produces a core that is genuinely unsatisfiable and genuinely minimal", async () => {
    const blocks: LogicalBlock[] = [
      { name: "P", propositions: ["p(x)", "a0(x)"] },
      { name: "PQ", propositions: ["p(x) -> q(x)"] },
      { name: "NQ", propositions: ["-q(x)", "a1(x)"] },
    ];
    const r = await computeLogicalCohomology(blocks, sat);
    const core = (r.frustrations[0].core ?? []).map((c) => c.formula);

    // Unsatisfiable as a set...
    expect((await sat(core)).consistent).toBe(false);
    // ...and every member necessary: drop any one and it becomes satisfiable.
    for (const f of core) {
      const without = core.filter((x) => x !== f);
      expect((await sat(without)).consistent).toBe(true);
    }
  });

  it("narrows an arity-2 clash to the two colliding formulas", async () => {
    const blocks: LogicalBlock[] = [
      { name: "T", propositions: ["p(x)", "a0(x)", "a1(x)"] },
      { name: "F", propositions: ["-p(x)", "a2(x)"] },
    ];
    const r = await computeLogicalCohomology(blocks, sat);
    const core = (r.frustrations[0].core ?? []).map((c) => c.formula).sort();
    expect(core).toEqual(["-p(x)", "p(x)"]);
  });

  it("can be switched off", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat, {
      extractCores: false,
    });
    expect(r.hasContradiction).toBe(true);
    expect(r.frustrations[0].core).toBeUndefined();
  });

  it("marks the core truncated rather than guessing when a check is undetermined", async () => {
    // An oracle that refuses to answer subset queries must not cause a formula
    // to be dropped — the reported core is then an over-approximation, and
    // says so.
    let first = true;
    const flaky: SatOracle = async (fs) => {
      if (first) {
        first = false;
        return sat(fs); // let the frustration itself be found
      }
      const r = await sat(fs);
      return r.consistent === false ? { consistent: null, note: "flaky" } : r;
    };
    const r = await computeLogicalCohomology(TRIPLE, flaky);
    if (r.hasContradiction) {
      expect(r.frustrations[0].coreTruncated ?? false).toBe(true);
    }
  });

  it("records core extraction in the audit trail", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat);
    const coreEntries = r.checkLog.filter((c) => c.kind === "core");
    expect(coreEntries).toHaveLength(1);
    expect(coreEntries[0].note).toMatch(/minimal core/);
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
    const r = await computeLogicalCohomology(filler(8), sat, {
      maxChecks: 5,
      forceExhaustive: true,
    });
    expect(r.searchTruncated).toBe(true);
  });

  it("treats maxChecks as a hard cap including internal probes", async () => {
    let calls = 0;
    const r = await computeLogicalCohomology(
      filler(8),
      async () => {
        calls++;
        return { consistent: true };
      },
      { maxChecks: 3 },
    );
    expect(calls).toBe(3);
    expect(r.checksPerformed).toBe(3);
    expect(r.uncheckedBlocks).toHaveLength(5);
    expect(r.searchTruncated).toBe(true);
    expect(r.truncationNote).toMatch(/internal/i);
  });

  /*
   * Regression: a bare `searchTruncated: true` was repeatedly read as "the
   * engine cannot search deeper" when it meant "the budget stopped it one level
   * short". Those have opposite remedies, so the result must say which it was
   * and name the budget that settles it.
   */
  it("says the budget stopped it, and names the budget that would not", async () => {
    const r = await computeLogicalCohomology(filler(8), sat, {
      maxChecks: 5,
      forceExhaustive: true,
    });
    expect(r.truncationNote).toMatch(/BUDGET limit, not a capability limit/);
    expect(r.checksRequiredForNextLevel).toBeGreaterThan(5);
    // The number must be actionable: re-running at it completes that level.
    const rerun = await computeLogicalCohomology(filler(8), sat, {
      maxChecks: r.checksRequiredForNextLevel!,
      forceExhaustive: true,
    });
    expect(rerun.searchedToArity).toBeGreaterThan(r.searchedToArity);
  });

  /*
   * Regression: 6 evaluable blocks is a 64-subset lattice against a 5000-check
   * budget, and the engine still stopped at arity 4 and reported truncation.
   * A cost guard that fires when there is no cost forces every caller to carry
   * a caveat that need not exist.
   */
  it("exhausts a small lattice instead of stopping at the arity cap", async () => {
    const r = await computeLogicalCohomology(filler(6), sat);
    expect(r.searchedToArity).toBe(6);
    expect(r.searchTruncated).toBe(false);
    expect(r.truncationNote).toBeUndefined();
  });

  it("auto-exhausts ten extracted blocks when arity comes from config defaults", async () => {
    const options = configuredCohomologyOptions({
      LOGIC_MAX_ARITY: 6,
      LOGIC_MAX_CHECKS: 50_000,
    });
    expect(options).toEqual({ defaultMaxArity: 6, maxChecks: 50_000 });
    const r = await computeLogicalCohomology(
      filler(10),
      async () => ({ consistent: true }),
      options,
    );
    expect(r.searchedToArity).toBe(10);
    expect(r.searchTruncated).toBe(false);
    expect(r.truncationNote).toBeUndefined();
  });

  it("still honours the arity cap when the lattice does NOT fit the budget", async () => {
    // 2^20 subsets is far past any sane budget, so the guard must still apply.
    const r = await computeLogicalCohomology(
      filler(20),
      async () => ({ consistent: true }),
      { maxChecks: 500, forceExhaustive: true },
    );
    expect(r.searchedToArity).toBeLessThan(20);
    expect(r.searchTruncated).toBe(true);
  });

  it("distinguishes an arity cap from a budget cap in the note", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat, { maxArity: 2 });
    expect(r.searchTruncated).toBe(true);
    expect(r.truncationNote).toMatch(/arity cap/);
    expect(r.checksRequiredForNextLevel).toBeUndefined();
  });

  it("leaves both truncation fields unset when the search really was exhaustive", async () => {
    const r = await computeLogicalCohomology(TRIPLE, sat, { maxArity: 8 });
    expect(r.searchTruncated).toBe(false);
    expect(r.truncationNote).toBeUndefined();
    expect(r.checksRequiredForNextLevel).toBeUndefined();
  });

  /*
   * AGEM is for deep thinking, so the defaults are generous: a 13-block corpus
   * is an 8178-subset lattice, well inside the default budget, and therefore
   * gets EXHAUSTED rather than cut off at arity 4 with a caveat.
   *
   * This test previously asserted searchedToArity === 4 and searchTruncated ===
   * true — it had encoded the old, tighter limitation as the expected result.
   * A test that pins a budget artefact will keep passing while the engine
   * silently under-searches.
   */
  it("exhausts a 13-block corpus at the default budget, no caveat", async () => {
    const blocks = [...QUAD_FOR_DEFAULTS, ...filler(9)];
    expect(blocks).toHaveLength(13);
    const r = await computeLogicalCohomology(blocks, sat);
    expect(r.hasContradiction).toBe(true);
    expect(r.frustrations.some((f) => f.arity === 4)).toBe(true);
    expect(r.searchedToArity).toBeGreaterThan(4);
    // Neither cap stopped it, so there is nothing to caveat.
    expect(r.searchTruncated).toBe(false);
    expect(r.truncationNote).toBeUndefined();
    expect(r.checksRequiredForNextLevel).toBeUndefined();
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

  it("falls back after an undetermined full probe and marks the search incomplete", async () => {
    const fallback = makeOracle();
    const flaky: SatOracle = async (formulas) =>
      formulas.length === 4
        ? { consistent: null, note: "full-set timeout" }
        : fallback(formulas);
    const r = await computeLogicalCohomology(
      [...TRIPLE, ...filler(1)],
      flaky,
    );
    expect(r.frustrations[0]?.blocks.sort()).toEqual(["NQ", "P", "PQ"]);
    expect(r.frustrationsComplete).toBe(false);
    expect(r.searchTruncated).toBe(true);
    expect(r.truncationNote).toMatch(/undetermined/i);
  });
});

describe("high-arity regression", () => {
  it("finds an 8-wise MUS that the old arity-6 ladder misses", async () => {
    const blocks = Array.from({ length: 8 }, (_, i) => ({
      name: `B${i + 1}`,
      propositions: [`marker_${i + 1}(x)`],
    }));
    const allMarkers = new Set(blocks.flatMap((block) => block.propositions));
    const oracle: SatOracle = async (formulas) => ({
      consistent: ![...allMarkers].every((marker) => formulas.includes(marker)),
    });

    const oldPath = await computeLogicalCohomology(blocks, oracle, {
      maxArity: 6,
      forceExhaustive: true,
    });
    expect(oldPath.hasContradiction).toBe(false);
    expect(oldPath.searchTruncated).toBe(true);

    const optimized = await computeLogicalCohomology(blocks, oracle);
    expect(optimized.frustrations).toHaveLength(1);
    expect(optimized.frustrations[0].arity).toBe(8);
    expect(optimized.frustrationsComplete).toBe(true);
    expect(optimized.checksPerformed).toBe(17);
  });

  it("derives a complete 2-skeleton analytically around a high-arity MUS", async () => {
    const blocks = Array.from({ length: 15 }, (_, i) => ({
      name: `H${i + 1}`,
      propositions: [`high_marker_${i + 1}(x)`],
    }));
    const allMarkers = new Set(blocks.flatMap((block) => block.propositions));
    const oracle: SatOracle = async (formulas) => ({
      consistent: ![...allMarkers].every((marker) => formulas.includes(marker)),
    });

    const r = await computeLogicalCohomology(blocks, oracle);

    expect(r.frustrations).toEqual([
      expect.objectContaining({ arity: 15, blocks: blocks.map((b) => b.name) }),
    ]);
    expect(r.checksPerformed).toBe(31);
    expect(r.homologyDerivedAnalytically).toBe(true);
    expect(r.rankD2).toBe(91);
    expect(r.h1).toBe(0);
  });

  it("keeps sparse homology bounded for a pair MUS at the 120-block cap", async () => {
    const blocks: LogicalBlock[] = [
      { name: "P", propositions: ["p(x)"] },
      { name: "NP", propositions: ["-p(x)"] },
      ...Array.from({ length: 118 }, (_, index) => ({
        name: `S${index + 1}`,
        propositions: [`sparse_marker_${index + 1}(x)`],
      })),
    ];
    const oracle: SatOracle = async (formulas) => ({
      consistent: !(formulas.includes("p(x)") && formulas.includes("-p(x)")),
    });

    const r = await computeLogicalCohomology(blocks, oracle);

    expect(r.frustrations).toEqual([
      expect.objectContaining({ arity: 2, blocks: ["P", "NP"] }),
    ]);
    expect(r.checksPerformed).toBe(241);
    expect(r.consistentPairs).toHaveLength(7_139);
    expect(r.homologyDerivedAnalytically).toBe(false);
    expect(r.h1).toBe(0);
  });
});

describe("optimized/exhaustive equivalence", () => {
  it("agrees on the contradiction verdict and complete MUS set", async () => {
    const corpora: LogicalBlock[][] = [
      TRIPLE,
      QUAD_FOR_DEFAULTS,
      filler(5),
      [
        { name: "P", propositions: ["p(x)"] },
        { name: "NP", propositions: ["-p(x)"] },
        { name: "Q", propositions: ["q(x)"] },
        { name: "NQ", propositions: ["-q(x)"] },
      ],
    ];
    const musKeys = (result: Awaited<ReturnType<typeof computeLogicalCohomology>>) =>
      result.frustrations
        .map((frustration) => [...frustration.blocks].sort().join("|"))
        .sort();

    for (const corpus of corpora) {
      const optimized = await computeLogicalCohomology(corpus, sat);
      const exhaustive = await computeLogicalCohomology(corpus, sat, {
        forceExhaustive: true,
      });
      expect(optimized.hasContradiction).toBe(exhaustive.hasContradiction);
      expect(musKeys(optimized)).toEqual(musKeys(exhaustive));
      expect(optimized.frustrationsComplete).toBe(true);
      expect(exhaustive.frustrationsComplete).toBe(true);
    }
  });
});
