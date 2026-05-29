/**
 * Preprocessor.test.ts
 *
 * TDD tests for the TNA Preprocessor (TF-IDF + lemmatization pipeline).
 *
 * Test inventory:
 *   T1:  Lemmatization collapses verb morphological variants
 *   T1b: Lemmatization handles irregular verbs
 *   T2:  Stopwords are removed before lemmatization
 *   T2b: TF-IDF scores are computed and reflect document frequency
 *   T3:  Empty input returns empty tokens
 *   T3b: Single word input returns exactly one token
 *   T4:  Case normalization — uppercase variants produce same lemma
 *
 * RED phase: all tests fail until Preprocessor.ts is implemented.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Preprocessor } from "./Preprocessor.js";

describe("Preprocessor", () => {
  let preprocessor: Preprocessor;

  beforeEach(() => {
    preprocessor = new Preprocessor({ minTfidfWeight: 0.0 }); // 0.0 threshold — keep all for testing
  });

  // --------------------------------------------------------------------------
  // T1: Lemmatization collapses morphological variants
  // --------------------------------------------------------------------------

  it("T1: lemmatization collapses verb morphological variants to canonical lemma", () => {
    // "running", "runs", "ran" should all produce the same lemma
    const result1 = preprocessor.preprocess("running");
    const result2 = preprocessor.preprocess("runs");
    const result3 = preprocessor.preprocess("ran");

    // All verb forms of "run" must produce identical lemmas.
    expect(result1.tokens.length).toBeGreaterThan(0);
    expect(result2.tokens.length).toBeGreaterThan(0);
    expect(result3.tokens.length).toBeGreaterThan(0);

    // All must map to the same canonical form.
    const lemma1 = result1.tokens[0];
    const lemma2 = result2.tokens[0];
    const lemma3 = result3.tokens[0];

    expect(lemma1).toBe(lemma2);
    expect(lemma1).toBe(lemma3);

    // The canonical form should be "run".
    expect(lemma1).toBe("run");
  });

  it("T1: lemmatization collapses noun morphological variants", () => {
    // "cats" should collapse to "cat"
    const catResult = preprocessor.preprocess("cats");
    expect(catResult.tokens).toContain("cat");

    // "dogs" should collapse to "dog"
    const dogResult = preprocessor.preprocess("dogs");
    expect(dogResult.tokens).toContain("dog");
  });

  // --------------------------------------------------------------------------
  // T1b: Irregular verb forms
  // --------------------------------------------------------------------------

  it("T1b: lemmatization handles irregular verbs — go", () => {
    // went, goes, going, gone all map to "go"
    const results = ["went", "goes", "going", "gone"].map((w) => {
      const r = preprocessor.preprocess(w);
      return r.tokens[0] ?? null;
    });

    // All should map to the same lemma.
    const uniqueLemmas = new Set(results.filter(Boolean));
    expect(uniqueLemmas.size).toBe(1);

    // The canonical form should be "go".
    expect(results[0]).toBe("go");
  });

  // --------------------------------------------------------------------------
  // T2: Stopword removal
  // --------------------------------------------------------------------------

  it("T2: stopwords are removed — function words do not appear in output", () => {
    // "The cat sat on the mat" — "the", "on" are stopwords
    const result = preprocessor.preprocess("The cat sat on the mat");

    // Stopwords must not appear in output tokens.
    expect(result.tokens).not.toContain("the");
    expect(result.tokens).not.toContain("on");
    expect(result.tokens).not.toContain("a");

    // Content words should be present (as lemmas).
    // "sat" → lemmatize → likely "sit" or "sat"; "cat" and "mat" remain.
    // Key check: function words are absent.
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it("T2: high-frequency function words never become graph tokens", () => {
    // Input with only stopwords produces empty output.
    const result = preprocessor.preprocess("the and is are of in on at by for");
    // All of these are stopwords in English — output should be empty or near-empty.
    const stopwords = [
      "the",
      "and",
      "is",
      "are",
      "of",
      "in",
      "on",
      "at",
      "by",
      "for",
    ];
    for (const sw of stopwords) {
      expect(result.tokens).not.toContain(sw);
    }
  });

  // --------------------------------------------------------------------------
  // T2b: TF-IDF scores reflect document frequency
  // --------------------------------------------------------------------------

  it("T2b: TF-IDF scores reflect document frequency — rare terms score higher", () => {
    const corpus = new Preprocessor({ minTfidfWeight: 0.0 });

    // Add 3 documents to build the corpus.
    // "analysis" appears in all 3 docs → low IDF → low TF-IDF.
    // "quantum" appears in only 1 doc → high IDF → high TF-IDF.
    corpus.addDocument("analysis of data analysis");
    corpus.addDocument("analysis methods and approaches");
    corpus.addDocument("quantum entanglement analysis");

    // Preprocess a document that contains both "analysis" and "quantum".
    const result = corpus.preprocessWithCorpus("quantum analysis methods");

    const analysisScore = result.tfidfScores.get("analysis") ?? 0;
    const quantumScore = result.tfidfScores.get("quantum") ?? 0;

    // Quantum appears in fewer documents → higher TF-IDF.
    expect(quantumScore).toBeGreaterThan(analysisScore);
  });

  // --------------------------------------------------------------------------
  // T3: Edge cases
  // --------------------------------------------------------------------------

  it("T3: empty input returns empty tokens and empty scores", () => {
    const result = preprocessor.preprocess("");

    expect(result.tokens).toHaveLength(0);
    expect(result.tfidfScores.size).toBe(0);
  });

  it("T3b: single content word input returns exactly one token", () => {
    const result = preprocessor.preprocess("analysis");

    expect(result.tokens).toHaveLength(1);
    // Should be the lemma of "analysis".
    expect(result.tokens[0]).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // T4: Case normalization
  // --------------------------------------------------------------------------

  it("T4: case normalization — uppercase variants produce same lemma as lowercase", () => {
    const lower = preprocessor.preprocess("running");
    const upper = preprocessor.preprocess("RUNNING");
    const title = preprocessor.preprocess("Running");

    // All must produce tokens (not empty after stopword removal).
    expect(lower.tokens.length).toBeGreaterThan(0);
    expect(upper.tokens.length).toBeGreaterThan(0);
    expect(title.tokens.length).toBeGreaterThan(0);

    // All must produce the same lemma.
    expect(lower.tokens[0]).toBe(upper.tokens[0]);
    expect(lower.tokens[0]).toBe(title.tokens[0]);
  });

  // --------------------------------------------------------------------------
  // Additional: lemmatize() public method
  // --------------------------------------------------------------------------

  it("lemmatize() returns canonical form for verb variants", () => {
    const p = new Preprocessor();

    expect(p.lemmatize("running")).toBe("run");
    expect(p.lemmatize("runs")).toBe("run");
    expect(p.lemmatize("ran")).toBe("run");
    expect(p.lemmatize("run")).toBe("run");
  });

  it("lemmatize() handles noun plurals", () => {
    const p = new Preprocessor();

    expect(p.lemmatize("cats")).toBe("cat");
    expect(p.lemmatize("dogs")).toBe("dog");
  });

  // --------------------------------------------------------------------------
  // T5: Noise filter (numerals, short tokens, domain artifacts)
  //
  // Real noise classes observed in AGEM cycle dumps:
  //   - Bare numerals being labeled as concepts (community "0 . 2 . 15").
  //   - Single letters from formulas / OCR-y prose ("s", "h", "l", "im", "ax").
  //   - Lemmatizer artifacts ("mot" <- "not", "pas" <- "passage").
  //   - Low-signal connectors eng stopword corpus leaves through.
  // --------------------------------------------------------------------------

  it("T5: pure numerals are rejected (no number ever becomes a node)", () => {
    const result = preprocessor.preprocess(
      "see section 462 and equation 769 with rate 0.5 across 990 nodes",
    );

    for (const tok of result.tokens) {
      expect(/^-?\d+(\.\d+)?$/.test(tok)).toBe(false);
    }
    // Negative sanity: a content word from the same sentence should survive.
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it("T5: single-letter tokens are rejected; legitimate 2-char content words survive", () => {
    // "h", "l", "s" — singletons, all observed as garbage nodes.
    // "go", "no", "so", "us" — legitimate 2-char content words, must survive
    //   (note: many are filtered by the stopword corpus, but those that aren't
    //    must not be dropped by the noise filter).
    const result = preprocessor.preprocess(
      "the h l s entropy values rise across iterations",
    );

    for (const tok of result.tokens) {
      expect(tok.length).toBeGreaterThanOrEqual(2);
    }
    // "entropy" lemma is the survivor we expect.
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T5: two-letter math/formula leftovers are rejected", () => {
    // "im", "ax", "dx", "dy" — observed math/formula fragments.
    const result = preprocessor.preprocess(
      "im ax dx dy entropy gradient analysis",
    );
    for (const noise of ["im", "ax", "dx", "dy"]) {
      expect(result.tokens).not.toContain(noise);
    }
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T5: domain noise tokens are rejected (lemmatizer artifacts + low-signal connectors)", () => {
    // Connectors and artifacts that should never appear as nodes.
    const noise = [
      "also",
      "often",
      "rather",
      "whether",
      "thing",
      "say",
      "use",
      "let",
      "may",
      "would",
      "could",
      "should",
      "must",
      "well",
      "even",
      "still",
      "yet",
      "however",
      "thus",
      "hence",
      "etc",
      "mot",
      "pas",
    ];
    const result = preprocessor.preprocess(noise.join(" ") + " entropy");

    for (const n of noise) {
      expect(result.tokens).not.toContain(n);
    }
    // "entropy" survives.
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T5: noise filter survives the corpus pipeline (preprocessWithCorpus)", () => {
    const corpus = new Preprocessor({ minTfidfWeight: 0.0 });
    corpus.addDocument("passage 1 entropy analysis 462");
    corpus.addDocument("passage 2 cohomology 769");
    corpus.addDocument("passage 3 lumpability 990");

    const result = corpus.preprocessWithCorpus(
      "passage 4 says 0 entropy at 15",
    );

    // No numeral ever scored.
    for (const tok of result.tokens) {
      expect(/^-?\d+(\.\d+)?$/.test(tok)).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // T6: Re-ingestion guard (strip structural artifacts before tokenization)
  //
  // Real failure mode: model or user pastes serialized tool output (JSON,
  // stack traces, snake_case object keys, UUIDs, file paths) into the cycle.
  // Those structural tokens are NOT concepts and must never seed nodes.
  // --------------------------------------------------------------------------

  it("T6: snake_case identifiers (1+ underscore) are stripped", () => {
    // These were exact tokens observed polluting cycles:
    //   "proposed_action", "correlation_coefficient", "key_value_pairs"
    const result = preprocessor.preprocess(
      "the proposed_action and correlation_coefficient feed key_value_pairs into the entropy analysis",
    );

    expect(result.tokens).not.toContain("proposed_action");
    expect(result.tokens).not.toContain("correlation_coefficient");
    expect(result.tokens).not.toContain("key_value_pairs");
    // The snake_case fragments must not survive as separate tokens either.
    expect(result.tokens).not.toContain("proposed");
    expect(result.tokens).not.toContain("action");
    expect(result.tokens).not.toContain("correlation");
    expect(result.tokens).not.toContain("coefficient");
    // Prose context survives.
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T6: UUIDs are stripped (no hex IDs become nodes)", () => {
    const result = preprocessor.preprocess(
      "the entry 019e7083-751b-7a4f-8ef9-83d408d8cd98 contains entropy",
    );
    // UUID does not appear in any form.
    for (const tok of result.tokens) {
      expect(tok).not.toMatch(/^[0-9a-f]{4,}$/);
    }
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T6: fenced code blocks are stripped", () => {
    const result = preprocessor.preprocess(
      "the analysis shows ```typescript\nconst gibberish = noiseInsideCode();\n``` an entropy gradient",
    );
    expect(result.tokens).not.toContain("typescript");
    expect(result.tokens).not.toContain("gibberish");
    expect(result.tokens).not.toContain("noiseinsidecode");
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T6: file paths are stripped", () => {
    const result = preprocessor.preprocess(
      "see src/orchestrator/ComposeRootModule.ts for the entropy computation",
    );
    expect(result.tokens).not.toContain("src");
    expect(result.tokens).not.toContain("orchestrator");
    expect(result.tokens).not.toContain("composerootmodule");
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T6: URLs are stripped", () => {
    const result = preprocessor.preprocess(
      "see https://github.com/some/repo for the entropy analysis",
    );
    expect(result.tokens).not.toContain("github");
    expect(result.tokens).not.toContain("https");
    expect(result.tokens.some((t) => t.startsWith("entrop"))).toBe(true);
  });

  it("T6: JSON-shaped key:value content does not become nodes", () => {
    const result = preprocessor.preprocess(
      '{"proposed_action": "ingest", "correlation_coefficient": 0.85, "timestamp": 1748448000}',
    );
    // No identifier survives.
    expect(result.tokens).not.toContain("proposed_action");
    expect(result.tokens).not.toContain("correlation_coefficient");
    expect(result.tokens).not.toContain("timestamp");
    expect(result.tokens).not.toContain("ingest");
  });

  it("T6: method-call dot-notation is stripped (.getConceptVector)", () => {
    const result = preprocessor.preprocess(
      "the registry.getConceptVector method returns a centroid for the subgraph",
    );
    expect(result.tokens).not.toContain("getconceptvector");
    // "registry" and "centroid" are prose and should survive.
    expect(result.tokens).toContain("registry");
    expect(result.tokens).toContain("centroid");
  });

  it("T6: structural-only input collapses to empty tokens", () => {
    // Pure JSON: nothing should remain.
    const result = preprocessor.preprocess(
      '{"a_b_c": 1, "d_e_f": 2, "g_h_i": 3}',
    );
    expect(result.tokens.length).toBe(0);
  });
});
