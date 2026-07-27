/**
 * topic-key.test.ts
 *
 * Findings are indexed by what they are ABOUT, not by how the prover phrased
 * the conclusion. Keying on the verdict made memory unreachable from ordinary
 * language: measured against a 0.4 floor, "let's continue our work on the
 * origin of the genetic code" scored 0.199 while "let's talk about sourdough
 * baking" scored 0.208 — the relevant cue ranked BELOW the irrelevant one, so
 * no threshold could have separated them. After re-keying: 0.531 and 0.274.
 *
 * These tests pin the shape of the key. The cosine numbers themselves are
 * measured by scripts/measure-recall-cues.py against the live embedder.
 */

import { describe, it, expect } from "vitest";
import { buildTopicKey } from "./finding-capture.js";

describe("buildTopicKey", () => {
  it("leads with the corpus id as words, not as a slug", () => {
    const key = buildTopicKey({}, "origin-of-genetic-code", {});
    expect(key).toBe("origin of genetic code");
  });

  it("carries block names, which is where the subject matter lives", () => {
    const key = buildTopicKey(
      {
        blocks: [
          { name: "Frozen Accident", propositions: ["arbitrary(code)"] },
          { name: "Stereochemical Affinity", propositions: ["-arbitrary(code)"] },
        ],
      },
      "origin-of-genetic-code",
      {},
    );
    expect(key).toContain("origin of genetic code");
    expect(key).toContain("Frozen Accident");
    expect(key).toContain("Stereochemical Affinity");
  });

  it("excludes formulas — they are what made the old key undiscriminating", () => {
    const key = buildTopicKey(
      {
        blocks: [
          {
            name: "Frozen Accident",
            propositions: ["arbitrary(code)", "-affinity_determined(code)"],
          },
        ],
      },
      "origin-of-genetic-code",
      {},
    );
    expect(key).not.toContain("affinity_determined");
    expect(key).not.toContain("(code)");
  });

  it("prefers the corpus text when the typed path supplies it", () => {
    const key = buildTopicKey(
      { text: "There are codons, and there are amino acids." },
      "origin-of-genetic-code",
      {},
    );
    expect(key).toContain("codons");
    expect(key).toContain("amino acids");
  });

  it("picks up block names the typed path reports in the result", () => {
    const key = buildTopicKey({}, "corpus", {
      derivedBlocks: [{ name: "Coevolution" }, { name: "Error Minimisation" }],
    });
    expect(key).toContain("Coevolution");
    expect(key).toContain("Error Minimisation");
  });

  it("deduplicates block names across args and result", () => {
    const key = buildTopicKey(
      { blocks: [{ name: "Coevolution" }] },
      "corpus",
      { derivedBlocks: [{ name: "Coevolution" }] },
    );
    expect(key.match(/Coevolution/g)).toHaveLength(1);
  });

  it("stays bounded so one huge corpus cannot dominate the index", () => {
    const key = buildTopicKey(
      { text: "codon ".repeat(5000) },
      "big-corpus",
      {},
    );
    expect(key.length).toBeLessThanOrEqual(2000);
  });

  it("survives malformed blocks without losing the corpus id", () => {
    const key = buildTopicKey(
      { blocks: [null, "nonsense", { name: "" }, { name: "Real Block" }] },
      "some-corpus",
      {},
    );
    expect(key).toContain("some corpus");
    expect(key).toContain("Real Block");
  });

  it("never returns empty, so a finding is always indexable", () => {
    expect(buildTopicKey({}, "x", {}).length).toBeGreaterThan(0);
  });
});
