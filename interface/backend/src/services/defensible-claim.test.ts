import { describe, expect, it } from "vitest";
import {
  calibrateCertainty,
  constructClaim,
  DisconfirmingSearchRequired,
  filterNoise,
  groundsStrength,
  scopeDemand,
  weighEvidence,
  type CandidateStatement,
  type Evidence,
} from "./defensible-claim.js";

const search = {
  query: "what evidence would show this recommendation is false?",
  searchedIn: ["segment:s1", "segment:s2"],
  found: 0,
};

const strong = (over: Partial<CandidateStatement> = {}): CandidateStatement => ({
  text: "measured assignment frequency rose 12% across 40 independent samples",
  sourceRef: "doi:10.1000/example",
  instanceCount: 40,
  reliabilityTier: "peer-reviewed",
  category: "data",
  bearing: "supports",
  ...over,
});

describe("noise filtering", () => {
  it("drops preferences as opinion and unbacked statements as assertion", () => {
    const { kept, dropped } = filterNoise([
      { text: "I think the frozen accident view is better", instanceCount: 9 },
      { text: "the code is optimised", instanceCount: 9 },
      strong(),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped.map((item) => item.verdict).sort()).toEqual([
      "assertion",
      "opinion",
    ]);
  });

  it("keeps a single instance as an anecdote, with a warning", () => {
    const { kept, anecdotes } = filterNoise([
      strong({ instanceCount: 1, text: "one lab observed the effect once" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(anecdotes).toHaveLength(1);
  });

  it("records every removal with its reason, so the filter is auditable", () => {
    const { dropped } = filterNoise([{ text: "obviously the best approach" }]);
    expect(dropped[0]!.why).toMatch(/preference/);
    expect(dropped[0]!.basis).toBe("lexical");
  });

  it("prefers the structured field over the lexical guess", () => {
    const { kept } = filterNoise([
      strong({
        text: "respondents said they prefer the shorter protocol",
        isNormative: false,
      }),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("weighing", () => {
  it("scores an unsourced tier at the midpoint rather than assuming trust", async () => {
    const weight = await weighEvidence(
      strong({ reliabilityTier: undefined }),
      { question: "did assignment frequency rise?" },
    );
    expect(weight.reliability).toBe(0.5);
    expect(weight.basis.reliability).toMatch(/rather than assumed trustworthy/);
  });

  it("rewards a resolvable locator over a named-but-unfindable source", async () => {
    const decision = { question: "did assignment frequency rise?" };
    const resolvable = await weighEvidence(strong(), decision);
    const vague = await weighEvidence(
      strong({ sourceRef: "a paper I read" }),
      decision,
    );
    expect(resolvable.verifiability).toBe(1);
    expect(vague.verifiability).toBeLessThan(1);
  });

  it("names which relevance measure ran", async () => {
    const lexical = await weighEvidence(strong(), { question: "assignment frequency" });
    expect(lexical.basis.relevance).toMatch(/no embedder supplied/);
    const embedded = await weighEvidence(
      strong(),
      { question: "assignment frequency" },
      async () => [1, 0, 0],
    );
    expect(embedded.basis.relevance).toMatch(/cosine similarity/);
  });
});

describe("calibration", () => {
  it("shrinks the scope instead of adding a qualifier", () => {
    const result = calibrateCertainty(
      { scope: "universal", certainty: "is" },
      0.3,
    );
    expect(result.scope).not.toBe("universal");
    expect(result.steps[0]!.reason).toMatch(/rather than adding a qualifier/);
  });

  it("terminates at the bottom of both ladders rather than looping", () => {
    const result = calibrateCertainty(
      { scope: "universal", certainty: "is" },
      0,
    );
    expect(result.scope).toBe("at-least-one");
    expect(result.certainty).toBe("is-consistent-with");
    expect(result.steps.length).toBeLessThanOrEqual(8);
  });

  it("leaves a claim alone when the grounds already carry it", () => {
    const result = calibrateCertainty({ scope: "some", certainty: "appears" }, 1);
    expect(result.steps).toHaveLength(0);
  });

  it("makes a wider scope cost more", () => {
    expect(scopeDemand("universal", "is")).toBeGreaterThan(
      scopeDemand("some", "appears"),
    );
  });
});

describe("grounds strength", () => {
  const evidence = (over: Partial<Evidence> = {}): Evidence => ({
    id: "e1",
    category: "data",
    source: "doi:10.1000/x",
    finding: "f",
    bearing: "supports",
    weight: {
      relevance: 1,
      reliability: 1,
      coverage: 1,
      verifiability: 1,
      total: 4,
      basis: { relevance: "", reliability: "", coverage: "", verifiability: "" },
    },
    ...over,
  });

  it("is zero without supporting evidence", () => {
    expect(groundsStrength([], [])).toBe(0);
  });

  it("is reduced by standing counter-evidence", () => {
    const clean = groundsStrength([evidence()], []);
    const disputed = groundsStrength(
      [evidence()],
      [evidence({ id: "c1", bearing: "contradicts" })],
    );
    expect(disputed).toBeLessThan(clean);
  });

  it("penalises a base made only of anecdotes", () => {
    const anecdotal = groundsStrength(
      [evidence({ warning: "single isolated instance" })],
      [],
    );
    expect(anecdotal).toBeLessThan(groundsStrength([evidence()], []));
  });
});

describe("construct claim", () => {
  const decision = {
    question: "did measured assignment frequency rise?",
    subQuestions: ["frequency", "sample size"],
  };

  it("refuses to build without a disconfirming search", async () => {
    await expect(
      constructClaim({
        decision,
        recommendation: "assignment frequency rose",
        statements: [strong()],
        disconfirmingSearch: { query: "", searchedIn: [], found: 0 },
      }),
    ).rejects.toBeInstanceOf(DisconfirmingSearchRequired);
  });

  it("accepts a search that found nothing, but not one that never ran", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [strong(), strong({ text: "replicated in a second cohort" })],
      disconfirmingSearch: search,
    });
    expect(claim.statement).toMatch(/^EVIDENTIAL \(defeasible\)/);
  });

  it("marks a claim carried only by anecdote as unable to stand", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [strong({ instanceCount: 1 })],
      disconfirmingSearch: search,
    });
    expect(claim.cannotStand).toBe(true);
    expect(claim.statement).toMatch(/INSUFFICIENT GROUNDS/);
  });

  it("keeps contradicting evidence rather than filtering it out", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [
        strong(),
        strong({
          text: "a larger reanalysis found no change in frequency",
          bearing: "contradicts",
          sourceRef: "doi:10.1000/counter",
        }),
      ],
      disconfirmingSearch: { ...search, found: 1 },
    });
    expect(claim.contradicting).toHaveLength(1);
    expect(claim.strongestObjection).toMatch(/larger reanalysis/);
    expect(claim.reasoning).toMatch(/not dissolved/);
  });

  it("names search coverage as the objection when nothing contrary was found", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [strong(), strong({ text: "replicated in a second cohort" })],
      disconfirmingSearch: search,
    });
    expect(claim.strongestObjection).toMatch(/too narrow/);
  });

  it("never labels an evidential claim as verified", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [strong(), strong({ text: "replicated in a second cohort" })],
      disconfirmingSearch: search,
    });
    expect(claim.statement).toMatch(/not a logical verdict/);
    expect(claim.statement).toMatch(/does not satisfy formal verification/);
  });

  it("reports what it dropped instead of silently discarding it", async () => {
    const claim = await constructClaim({
      decision,
      recommendation: "assignment frequency rose",
      statements: [strong(), { text: "I prefer the other reading" }],
      disconfirmingSearch: search,
    });
    expect(claim.dropped).toHaveLength(1);
    expect(claim.dropped[0]!.verdict).toBe("opinion");
  });
});
