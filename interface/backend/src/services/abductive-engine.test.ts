import { describe, expect, it, vi } from "vitest";
import {
  assessAnomaly,
  containsDeductiveRegister,
  executeAbductiveLeap,
  frameAsProvisional,
  hypothesisId,
  leapsOfFaith,
  predicateSymbols,
  rankBestExplanation,
  type Hypothesis,
  type Observation,
  type ProofOracle,
} from "./abductive-engine.js";

/** Prover stub keyed on goal, so each test states exactly what it assumes. */
function oracleFor(
  proved: (premises: readonly string[], goal: string) => boolean,
): ProofOracle {
  return async (premises, goal) => ({
    outcome: proved(premises, goal) ? "proved" : "unprovable",
  });
}

const observation = (over: Partial<Observation> = {}): Observation => ({
  id: "obs-1",
  phenomenon: "the corpus asserts that the code is arbitrary",
  source: "unexplained-assertion",
  segmentIds: ["segment:s1"],
  formula: "arbitrary(code)",
  constituentFormulas: ["arbitrary(code)"],
  ...over,
});

const hypothesis = (over: Partial<Hypothesis> = {}): Hypothesis => ({
  id: "hyp-a",
  proposedCause: "the assignment froze early",
  formula: "all x (frozen(x) -> arbitrary(x))",
  vocabulary: ["frozen", "arbitrary"],
  leapsOfFaith: [],
  provenance: "corpus-vocabulary",
  ...over,
});

describe("anomaly gate", () => {
  it("declines abduction when the corpus already entails the observation", async () => {
    const assessment = await assessAnomaly(observation(), {
      background: ["all x (code(x) -> arbitrary(x))", "code(code)"],
      oracle: oracleFor((_, goal) => goal === "arbitrary(code)"),
    });
    expect(assessment.isAnomalous).toBe(false);
    expect(assessment.deductiveWitness).toBeDefined();
    expect(assessment.basis).toMatch(/matter of course/);
  });

  it("treats an assertion the corpus does not entail as surprising", async () => {
    const assessment = await assessAnomaly(observation(), {
      background: ["all x (code(x) -> optimised(x))"],
      oracle: oracleFor(() => false),
    });
    expect(assessment.isAnomalous).toBe(true);
  });

  it("refuses an observation with no corpus provenance", async () => {
    const assessment = await assessAnomaly(observation({ segmentIds: [] }), {
      background: [],
      oracle: oracleFor(() => false),
    });
    expect(assessment.isAnomalous).toBe(false);
    expect(assessment.criterion).toBe("corpus-provenance");
  });

  it("covers every conflict-bearing ClaimVerdictKind, including 'mixed'", async () => {
    // Mirrors ClaimVerdictKind in claim-blocks.ts. `mixed` stores no finding
    // and leaves a human to interpret, so it is the verdict most in need of a
    // candidate explanation — an earlier gate dropped it as "not anomalous".
    const options = { background: [], oracle: oracleFor(() => false) };
    for (const kind of [
      "corpus-contradiction",
      "position-contradiction",
      "positions-incompatible",
      "mixed",
    ]) {
      const assessment = await assessAnomaly(
        observation({
          source: "logical-conflict",
          formula: undefined,
          signals: { verdictKind: kind },
        }),
        options,
      );
      expect(assessment.isAnomalous, `${kind} should be anomalous`).toBe(true);
    }
    const clean = await assessAnomaly(
      observation({
        source: "logical-conflict",
        formula: undefined,
        signals: { verdictKind: "no-contradiction" },
      }),
      options,
    );
    expect(clean.isAnomalous).toBe(false);
  });

  it("distinguishes an n-ary joint incompatibility from a pairwise clash", async () => {
    const options = { background: [], oracle: oracleFor(() => false) };
    const joint = await assessAnomaly(
      observation({
        source: "logical-conflict",
        formula: undefined,
        signals: { verdictKind: "positions-incompatible", arity: 3 },
      }),
      options,
    );
    const pairwise = await assessAnomaly(
      observation({
        source: "logical-conflict",
        formula: undefined,
        signals: { verdictKind: "positions-incompatible", arity: 2 },
      }),
      options,
    );
    expect(joint.basis).toMatch(/n-ary \(arity 3\)/);
    expect(joint.basis).toMatch(/shared constraint/);
    expect(pairwise.basis).toMatch(/pairwise \(arity 2\)/);
  });

  it("uses each source's own criterion rather than a shared threshold", async () => {
    const options = { background: [], oracle: oracleFor(() => false) };
    const gap = await assessAnomaly(
      observation({
        source: "structural-gap",
        formula: undefined,
        signals: { modularityDelta: 0.3, density: 0.05 },
      }),
      options,
    );
    const nonGap = await assessAnomaly(
      observation({
        source: "structural-gap",
        formula: undefined,
        signals: { modularityDelta: -0.1, density: 0.05 },
      }),
      options,
    );
    const h1 = await assessAnomaly(
      observation({
        source: "cohomology-obstruction",
        formula: undefined,
        signals: { h1: 2 },
      }),
      options,
    );
    expect(gap.isAnomalous).toBe(true);
    expect(nonGap.isAnomalous).toBe(false);
    expect(h1.isAnomalous).toBe(true);
    expect(h1.criterion).toMatch(/H¹ > 0/);
  });
});

describe("ranking", () => {
  const options = (oracle: ProofOracle) => ({ background: ["code(code)"], oracle });

  it("refutes a hypothesis that contradicts the corpus, whatever it explains", async () => {
    const { ranked } = await rankBestExplanation(
      observation(),
      [hypothesis()],
      options(oracleFor((_, goal) => goal === "$F" || goal === "arbitrary(code)")),
    );
    expect(ranked[0]!.status).toBe("refuted-incoherent");
    expect(ranked[0]!.score).toBe(Number.NEGATIVE_INFINITY);
  });

  it("prefers the hypothesis that introduces nothing, at equal explanatory depth", async () => {
    const lean = hypothesis({ id: "hyp-lean", leapsOfFaith: [] });
    const costly = hypothesis({
      id: "hyp-costly",
      formula: "all x (panspermia(x) -> arbitrary(x))",
      leapsOfFaith: ["panspermia", "seeding_event"],
      provenance: "exogenous",
    });
    const { ranked } = await rankBestExplanation(
      observation(),
      [costly, lean],
      options(oracleFor((_, goal) => goal !== "$F")),
    );
    expect(ranked[0]!.hypothesis.id).toBe("hyp-lean");
    expect(ranked[1]!.hypothesis.id).toBe("hyp-costly");
  });

  it("lets deeper coverage outweigh one introduced entity", async () => {
    const shallow = hypothesis({
      id: "hyp-shallow",
      formula: "shallow(code)",
      leapsOfFaith: [],
    });
    const deep = hypothesis({
      id: "hyp-deep",
      formula: "deep(code)",
      leapsOfFaith: ["one_new_thing"],
    });
    const obs = observation({
      constituentFormulas: ["a(code)", "b(code)", "c(code)", "d(code)"],
    });
    const { ranked } = await rankBestExplanation(
      obs,
      [shallow, deep],
      options(
        oracleFor((premises, goal) => {
          if (goal === "$F") return false;
          if (premises.includes("deep(code)")) return goal !== "d(code)";
          return goal === "a(code)";
        }),
      ),
    );
    // deep: 3/4 - 0.35 = 0.40; shallow: 1/4 - 0 = 0.25.
    expect(ranked[0]!.hypothesis.id).toBe("hyp-deep");
    expect(ranked[0]!.explanatoryDepth).toBeCloseTo(0.75);
  });

  it("reports WHY a check was undecided, not just that it was", async () => {
    // A malformed formula is not a hard logical problem; the caller can fix it
    // in seconds if told. Verified live: mcp-logic returns result:"syntax_error"
    // with per-formula parser errors, which the adapter passes through here.
    const { ranked } = await rankBestExplanation(
      observation(),
      [hypothesis()],
      {
        background: [],
        oracle: async () => ({
          outcome: "error",
          detail: "syntax_error — all x (frozen(x): Unmatched opening parenthesis",
        }),
      },
    );
    expect(ranked[0]!.status).toBe("undecided");
    expect(ranked[0]!.rationale).toMatch(/Unmatched opening parenthesis/);
  });

  it("rejects a cause that would not make the observation follow", async () => {
    const { ranked } = await rankBestExplanation(
      observation(),
      [hypothesis()],
      options(oracleFor(() => false)),
    );
    expect(ranked[0]!.status).toBe("rejected-does-not-explain");
  });

  it("is deterministic across runs over identical input", async () => {
    const pool = [
      hypothesis({ id: "hyp-b", formula: "b(code)" }),
      hypothesis({ id: "hyp-a", formula: "a(code)" }),
    ];
    const run = () =>
      rankBestExplanation(
        observation(),
        pool,
        options(oracleFor((_, goal) => goal !== "$F")),
      );
    const first = await run();
    const second = await run();
    expect(first.ranked.map((entry) => entry.hypothesis.id)).toEqual(
      second.ranked.map((entry) => entry.hypothesis.id),
    );
  });

  it("stops calling the prover once the budget is spent", async () => {
    const oracle = vi.fn(oracleFor(() => false));
    const { proverCalls, budgetExhausted } = await rankBestExplanation(
      observation({
        constituentFormulas: ["a(x)", "b(x)", "c(x)", "d(x)", "e(x)"],
      }),
      [hypothesis(), hypothesis({ id: "hyp-2", formula: "z(code)" })],
      { background: [], oracle, maxProverCalls: 3 },
    );
    expect(proverCalls).toBeLessThanOrEqual(3);
    expect(budgetExhausted).toBe(true);
  });
});

describe("Ockham accounting", () => {
  it("counts only symbols absent from both corpus vocabulary and background", () => {
    expect(
      leapsOfFaith(
        "all x (panspermia(x) -> arbitrary(x))",
        ["arbitrary"],
        ["code(code)"],
      ),
    ).toEqual(["panspermia"]);
  });

  it("does not mistake a bound variable for a predicate", () => {
    expect(predicateSymbols("all x (p(x) -> q(x))")).toEqual(["p", "q"]);
    expect(predicateSymbols("exists y (r(y))")).toEqual(["r"]);
  });

  it("gives a hypothesis the same id across runs", () => {
    expect(hypothesisId("p(x)")).toBe(hypothesisId(" p(x) "));
  });
});

describe("provisional framing", () => {
  it("never states an abduced hypothesis in the deductive register", async () => {
    // Proves only when the hypothesis is among the premises, so the anomaly
    // gate (which asks the background alone) still finds the fact surprising.
    const result = await executeAbductiveLeap(observation(), [hypothesis()], {
      background: [],
      oracle: oracleFor(
        (premises, goal) => goal !== "$F" && premises.includes(hypothesis().formula),
      ),
    });
    expect(result.provisionalStatement).toMatch(/^PROVISIONAL/);
    expect(containsDeductiveRegister(result.provisionalStatement)).toBe(false);
    expect(result.testProposal).not.toHaveLength(0);
  });

  it("reports an unexplained anomaly as a live gap, not a negative result", () => {
    const statement = frameAsProvisional(observation(), undefined);
    expect(statement).toMatch(/NO ADOPTABLE EXPLANATION/);
    expect(statement).toMatch(/live gap, not a negative result/);
  });

  it("warns that coherence may have been satisfied by the empty world", async () => {
    const explainsOnlyWithHypothesis = oracleFor(
      (premises, goal) => goal !== "$F" && premises.includes(hypothesis().formula),
    );
    const withoutWitnesses = await executeAbductiveLeap(
      observation(),
      [hypothesis()],
      {
        background: ["all x (p(x) -> q(x))"],
        oracle: explainsOnlyWithHypothesis,
      },
    );
    const withWitnesses = await executeAbductiveLeap(
      observation(),
      [hypothesis()],
      {
        background: ["all x (p(x) -> q(x))"],
        existenceWitnesses: ["exists x (p(x))"],
        oracle: explainsOnlyWithHypothesis,
      },
    );
    expect(withoutWitnesses.vacuityRisk).toMatch(/empty world/);
    expect(withWitnesses.vacuityRisk).toBeUndefined();
  });

  it("redirects to deduction instead of explaining what already follows", async () => {
    const result = await executeAbductiveLeap(
      observation(),
      [hypothesis()],
      { background: [], oracle: oracleFor(() => true) },
    );
    expect(result.declined).toMatch(/Abduction declined/);
    expect(result.provisionalStatement).toMatch(/NOT ANOMALOUS/);
    expect(result.proverCalls).toBe(0);
  });

  it("does not invent candidates when none were supplied", async () => {
    const result = await executeAbductiveLeap(observation(), [], {
      background: [],
      oracle: oracleFor(() => false),
    });
    expect(result.declined).toMatch(/does not invent them/);
    expect(result.best).toBeUndefined();
  });
});
