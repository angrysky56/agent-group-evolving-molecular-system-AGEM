/**
 * These tests are calibrated against material that actually jammed the engine,
 * not against invented strings. If a threshold is retuned, it must still keep
 * these classifications, because each corresponds to a real run.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessMaterial,
  assessmentBriefing,
  classifyFromSignals,
  measureMaterial,
  permitsSkippingFormalPath,
  recommendPath,
} from "./material-assessment.js";

const PEIRCE = new URL(
  "../../../../corpora/peirce-abduction-einstein.md",
  import.meta.url,
).pathname;

describe("there is no corpus yet", () => {
  it("recognises a bare question and refuses to treat it as material", async () => {
    const assessment = await assessMaterial(
      "Does abduction actually dissolve Einstein's puzzle about comprehensibility?",
    );
    expect(assessment.kind).toBe("question");
    expect(assessment.recommendedPath).toBe("build-corpus-first");
  });

  it("tells the run to BUILD a corpus rather than ingest the question", async () => {
    const assessment = await assessMaterial("Why is the genetic code optimal?");
    const briefing = assessmentBriefing(assessment);
    expect(briefing).toMatch(/THERE IS NO CORPUS YET/);
    expect(briefing).toMatch(/Do not ingest this input/);
    expect(briefing).toMatch(/search, gather sources, reason the problem out/);
  });

  it("names the harm, so the instruction is not arbitrary", async () => {
    const assessment = await assessMaterial("What causes decoherence?");
    expect(assessment.reasons.join(" ")).toMatch(
      /noise in the graph|describe that noise/,
    );
  });

  it("treats a short non-question as a command, not a corpus", async () => {
    const assessment = await assessMaterial("Reset the AGEM engine.");
    expect(assessment.kind).toBe("instruction");
    expect(assessment.recommendedPath).toBe("no-analysis");
  });
});

describe("the Peirce/Einstein corpus — the run that aborted", () => {
  const text = readFileSync(PEIRCE, "utf8");

  it("is long enough to be a corpus", () => {
    expect(measureMaterial(text).chars).toBeGreaterThan(600);
  });

  it("is NOT classified as formally verifiable", async () => {
    // The live run spent a full extraction pass discovering this, then aborted
    // with unmappable claims. Reached here before ingestion, for free.
    const assessment = await assessMaterial(text);
    expect(assessment.kind).toBe("corpus");
    expect(assessment.formalizability).not.toBe("propositional");
    expect(assessment.recommendedPath).toBe("evidential");
  });

  it("warns that an abort here is expected, not a defect", async () => {
    const briefing = assessmentBriefing(await assessMaterial(text));
    expect(briefing).toMatch(/unlikely to support a formal verdict/);
    expect(briefing).toMatch(/expected outcome and not a defect to repair/);
  });
});

describe("classification against the calibration set", () => {
  const CORPORA = new URL("../../../../corpora/", import.meta.url).pathname;
  const read = (p: string) => readFileSync(CORPORA + p, "utf8");

  // Every corpus here formalised successfully in a real run. None may be
  // routed away from the prover.
  it.each([
    ["quantum-mind-genesis/corpus.md"],
    ["qm-interpretations/corpus.md"],
    ["decision-theory/corpus.md"],
    ["reverse-math/corpus.md"],
  ])("keeps %s on the formal path", async (file) => {
    const assessment = await assessMaterial(read(file));
    expect(assessment.recommendedPath).toBe("formal-verification");
    expect(permitsSkippingFormalPath(assessment)).toBe(false);
  });

  it("separates the one corpus that actually aborted", async () => {
    const peirce = await assessMaterial(read("peirce-abduction-einstein.md"));
    const survey = await assessMaterial(read("quantum-mind-genesis/corpus.md"));
    expect(peirce.signals.figurativeCueDensity).toBeGreaterThanOrEqual(0.05);
    expect(survey.signals.figurativeCueDensity).toBeLessThan(0.05);
    expect(peirce.recommendedPath).toBe("evidential");
    expect(survey.recommendedPath).toBe("formal-verification");
  });

  it("does not route thin-but-formal material away from the prover", () => {
    // logic-h1-test-corpus scores 0.020 attribution and IS a designed logic
    // test. `narrative` must not mean `evidential`.
    expect(recommendPath("corpus", "narrative")).toBe("formal-verification");
  });

  it("guesses toward the formal path when the signals do not separate", () => {
    // The error is then visible — an abort that routes onward — rather than a
    // verdict silently never attempted.
    expect(recommendPath("corpus", "undetermined")).toBe("formal-verification");
  });

  it("does not gate on propositional cues, which are near zero everywhere", () => {
    // Measured 0.000–0.084 across the whole calibration set, including corpora
    // the prover handles. Kept as a signal, never used as a threshold.
    const survey = measureMaterial(read("quantum-mind-genesis/corpus.md"));
    expect(survey.propositionalCueDensity).toBeLessThan(0.1);
    expect(classifyFromSignals(survey).formalizability).toBe("propositional");
  });
});

describe("the recommendation does not become a loophole", () => {
  it("never lets a question excuse the formal path", async () => {
    const assessment = await assessMaterial("Is the genetic code optimal?");
    expect(permitsSkippingFormalPath(assessment)).toBe(false);
  });

  it("never lets a narrative reading excuse it", async () => {
    // The dangerous one: terse formal corpora score narrative too.
    expect(
      permitsSkippingFormalPath({
        kind: "corpus",
        formalizability: "narrative",
        recommendedPath: "formal-verification",
        reasons: [],
        signals: measureMaterial("x"),
        decidedBy: "signals",
      }),
    ).toBe(false);
  });

  it("never lets an adjudicator-decided reading excuse it", async () => {
    const text = Array.from(
      { length: 40 },
      (_, i) =>
        i % 10 === 0
          ? `The standard account holds that step ${i} is required.`
          : `Step ${i} proceeds in the usual manner and is recorded.`,
    ).join(" ");
    const assessment = await assessMaterial(text, async () => ({
      formalizability: "argumentative" as const,
      reason: "model says so",
    }));
    expect(assessment.decidedBy).toBe("signals+adjudicator");
    // A model may redirect the reasoning; it may not excuse verification.
    expect(permitsSkippingFormalPath(assessment)).toBe(false);
  });

  /*
   * REGRESSION PIN. Run 2026-07-30T23-36-00 called extract_and_verify_claims as
   * its ONLY tool and built no graph, because the briefing said "the right
   * FIRST instrument". The model quoted it back: "I'll proceed with
   * extract_and_verify_claims, the preferred formal path."
   */
  it.each([
    ["peirce-abduction-einstein.md", "evidential"],
    ["quantum-mind-genesis/corpus.md", "formal-verification"],
  ])("never tells a run to skip ingestion for %s", async (file) => {
    const corpora = new URL("../../../../corpora/", import.meta.url).pathname;
    const assessment = await assessMaterial(readFileSync(corpora + file, "utf8"));
    const briefing = assessmentBriefing(assessment);
    expect(briefing).toMatch(/WORKFLOW UNCHANGED/);
    expect(briefing).toMatch(/ingest the material and inspect the graph first/);
    // The exact phrasing that caused the regression must not come back.
    expect(briefing).not.toMatch(/first instrument|first choice/i);
  });

  it("only says 'do not ingest' when there is genuinely nothing to ingest", async () => {
    const question = assessmentBriefing(
      await assessMaterial("Why is the genetic code optimal?"),
    );
    expect(question).toMatch(/Do not ingest/);
    const corpus = assessmentBriefing(
      await assessMaterial(readFileSync(PEIRCE, "utf8")),
    );
    expect(corpus).not.toMatch(/Do not ingest/);
  });

  it("states that it is a recommendation, not a verdict", async () => {
    const briefing = assessmentBriefing(
      await assessMaterial(readFileSync(PEIRCE, "utf8")),
    );
    expect(briefing).toMatch(/recommendation from cheap measurements, not a verdict/);
    expect(briefing).toMatch(/If the material contradicts it, say so/);
  });
});

describe("the adjudicator", () => {
  /** Sits in the band between the narrative floor and the propositional cut. */
  const ambiguous = Array.from(
    { length: 40 },
    (_, i) =>
      i % 10 === 0
        ? `The standard account holds that step ${i} is required.`
        : `Step ${i} proceeds in the usual manner and is recorded.`,
  ).join(" ");

  it("is only reached when counting genuinely did not decide", () => {
    expect(classifyFromSignals(measureMaterial(ambiguous)).ambiguous).toBe(true);
  });

  it("is not consulted when counting already decided", async () => {
    let called = false;
    await assessMaterial("Reset the engine.", async () => {
      called = true;
      return {};
    });
    expect(called).toBe(false);
  });

  it("does not turn its own failure into a confident verdict", async () => {
    const assessment = await assessMaterial(ambiguous, async () => {
      throw new Error("provider down");
    });
    expect(assessment.adjudicatorError).toMatch(/provider down/);
    expect(assessment.decidedBy).toBe("signals");
    // Falls back to the direction whose error is visible.
    expect(assessment.recommendedPath).toBe("formal-verification");
  });
});
