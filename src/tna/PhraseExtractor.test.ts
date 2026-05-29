/**
 * PhraseExtractor.test.ts
 *
 * Tests for bigram counting + phrase promotion threshold.
 */

import { describe, it, expect } from "vitest";
import { PhraseExtractor } from "./PhraseExtractor.js";

describe("PhraseExtractor", () => {
  it("update() records adjacent bigram counts", () => {
    const px = new PhraseExtractor({ minOccurrences: 2 });
    px.update(["weak", "lumpability", "is", "a", "concept"]);
    expect(px.count("weak", "lumpability")).toBe(1);
    expect(px.count("lumpability", "is")).toBe(1);
    expect(px.count("a", "concept")).toBe(1);
    // Reverse order is NOT the same bigram.
    expect(px.count("lumpability", "weak")).toBe(0);
  });

  it("update() ignores self-adjacent duplicate tokens", () => {
    const px = new PhraseExtractor();
    px.update(["very", "very", "interesting"]);
    expect(px.count("very", "very")).toBe(0);
    expect(px.count("very", "interesting")).toBe(1);
  });

  it("promotedPhrases() returns empty when no bigram crosses threshold", () => {
    const px = new PhraseExtractor({ minOccurrences: 3 });
    px.update(["weak", "lumpability", "is", "rare"]);
    expect(px.promotedPhrases(["weak", "lumpability", "is", "rare"])).toEqual(
      [],
    );
  });

  it("promotedPhrases() surfaces bigrams once threshold is crossed", () => {
    const px = new PhraseExtractor({ minOccurrences: 2 });

    // Three ingestions of the same bigram.
    px.update(["weak", "lumpability", "fails"]);
    px.update(["the", "weak", "lumpability"]);
    px.update(["under", "weak", "lumpability"]);

    const promoted = px.promotedPhrases(["under", "weak", "lumpability"]);
    expect(promoted).toEqual([{ position: 1, phrase: "weak lumpability" }]);
  });

  it("promotedPhrases() returns all promoted positions in order", () => {
    const px = new PhraseExtractor({ minOccurrences: 2 });
    // "honest messenger" appears in multiple varied contexts; "weak lumpability"
    // appears once. Only the first should promote -- and it should NOT pick up
    // the connector bigrams (those are filtered upstream by stopword removal
    // in real ingestion, but here we verify that promotion is per-bigram).
    px.update(["honest", "messenger", "speaks"]);
    px.update(["the", "honest", "messenger"]);
    px.update(["another", "weak", "lumpability"]);

    const promoted = px.promotedPhrases([
      "the",
      "honest",
      "messenger",
      "weak",
      "lumpability",
    ]);
    expect(promoted.map((p) => p.phrase)).toEqual(["honest messenger"]);
    expect(promoted.map((p) => p.position)).toEqual([1]);
  });

  it("minOccurrences below 2 is clamped to 2 (single occurrences are never phrases)", () => {
    const px = new PhraseExtractor({ minOccurrences: 1 });
    px.update(["weak", "lumpability"]);
    // Single observation must not promote, even if config asked for 1.
    expect(px.promotedPhrases(["weak", "lumpability"])).toEqual([]);
  });

  it("maxTracked enforces a cap by evicting lowest-count entries", () => {
    const px = new PhraseExtractor({ minOccurrences: 2, maxTracked: 64 });
    // Push 100 distinct bigrams, each seen once.
    for (let i = 0; i < 100; i++) {
      px.update([`a${i}`, `b${i}`]);
    }
    expect(px.size).toBeLessThanOrEqual(64);

    // A frequent bigram should not be evicted.
    for (let n = 0; n < 5; n++) px.update(["weak", "lumpability"]);
    // Push more low-count noise to trigger another eviction.
    for (let i = 100; i < 200; i++) {
      px.update([`a${i}`, `b${i}`]);
    }
    expect(px.count("weak", "lumpability")).toBe(5);
    expect(px.size).toBeLessThanOrEqual(64);
  });

  it("snapshot/restore round-trips the bigram counts", () => {
    const px = new PhraseExtractor({ minOccurrences: 2 });
    px.update(["weak", "lumpability"]);
    px.update(["weak", "lumpability"]);
    px.update(["honest", "messenger"]);

    const snap = px.snapshot();
    const restored = new PhraseExtractor({ minOccurrences: 2 });
    restored.restore(snap);

    expect(restored.count("weak", "lumpability")).toBe(2);
    expect(restored.count("honest", "messenger")).toBe(1);
    expect(restored.promotedPhrases(["weak", "lumpability"])).toEqual([
      { position: 0, phrase: "weak lumpability" },
    ]);
  });

  it("clear() resets counts but preserves config", () => {
    const px = new PhraseExtractor({ minOccurrences: 3 });
    px.update(["weak", "lumpability"]);
    px.update(["weak", "lumpability"]);
    expect(px.size).toBe(1);

    px.clear();
    expect(px.size).toBe(0);
    expect(px.count("weak", "lumpability")).toBe(0);

    // Threshold still 3 after clear.
    px.update(["weak", "lumpability"]);
    px.update(["weak", "lumpability"]);
    expect(px.promotedPhrases(["weak", "lumpability"])).toEqual([]);
  });
});
