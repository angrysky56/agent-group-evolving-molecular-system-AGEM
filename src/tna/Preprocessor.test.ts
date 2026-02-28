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

import { describe, it, expect, beforeEach } from 'vitest';
import { Preprocessor } from './Preprocessor.js';

describe('Preprocessor', () => {
  let preprocessor: Preprocessor;

  beforeEach(() => {
    preprocessor = new Preprocessor({ minTfidfWeight: 0.0 }); // 0.0 threshold — keep all for testing
  });

  // --------------------------------------------------------------------------
  // T1: Lemmatization collapses morphological variants
  // --------------------------------------------------------------------------

  it('T1: lemmatization collapses verb morphological variants to canonical lemma', () => {
    // "running", "runs", "ran" should all produce the same lemma
    const result1 = preprocessor.preprocess('running');
    const result2 = preprocessor.preprocess('runs');
    const result3 = preprocessor.preprocess('ran');

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
    expect(lemma1).toBe('run');
  });

  it('T1: lemmatization collapses noun morphological variants', () => {
    // "cats" should collapse to "cat"
    const catResult = preprocessor.preprocess('cats');
    expect(catResult.tokens).toContain('cat');

    // "dogs" should collapse to "dog"
    const dogResult = preprocessor.preprocess('dogs');
    expect(dogResult.tokens).toContain('dog');
  });

  // --------------------------------------------------------------------------
  // T1b: Irregular verb forms
  // --------------------------------------------------------------------------

  it('T1b: lemmatization handles irregular verbs — go', () => {
    // went, goes, going, gone all map to "go"
    const results = ['went', 'goes', 'going', 'gone'].map(w => {
      const r = preprocessor.preprocess(w);
      return r.tokens[0] ?? null;
    });

    // All should map to the same lemma.
    const uniqueLemmas = new Set(results.filter(Boolean));
    expect(uniqueLemmas.size).toBe(1);

    // The canonical form should be "go".
    expect(results[0]).toBe('go');
  });

  // --------------------------------------------------------------------------
  // T2: Stopword removal
  // --------------------------------------------------------------------------

  it('T2: stopwords are removed — function words do not appear in output', () => {
    // "The cat sat on the mat" — "the", "on" are stopwords
    const result = preprocessor.preprocess('The cat sat on the mat');

    // Stopwords must not appear in output tokens.
    expect(result.tokens).not.toContain('the');
    expect(result.tokens).not.toContain('on');
    expect(result.tokens).not.toContain('a');

    // Content words should be present (as lemmas).
    // "sat" → lemmatize → likely "sit" or "sat"; "cat" and "mat" remain.
    // Key check: function words are absent.
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it('T2: high-frequency function words never become graph tokens', () => {
    // Input with only stopwords produces empty output.
    const result = preprocessor.preprocess('the and is are of in on at by for');
    // All of these are stopwords in English — output should be empty or near-empty.
    const stopwords = ['the', 'and', 'is', 'are', 'of', 'in', 'on', 'at', 'by', 'for'];
    for (const sw of stopwords) {
      expect(result.tokens).not.toContain(sw);
    }
  });

  // --------------------------------------------------------------------------
  // T2b: TF-IDF scores reflect document frequency
  // --------------------------------------------------------------------------

  it('T2b: TF-IDF scores reflect document frequency — rare terms score higher', () => {
    const corpus = new Preprocessor({ minTfidfWeight: 0.0 });

    // Add 3 documents to build the corpus.
    // "analysis" appears in all 3 docs → low IDF → low TF-IDF.
    // "quantum" appears in only 1 doc → high IDF → high TF-IDF.
    corpus.addDocument('analysis of data analysis');
    corpus.addDocument('analysis methods and approaches');
    corpus.addDocument('quantum entanglement analysis');

    // Preprocess a document that contains both "analysis" and "quantum".
    const result = corpus.preprocessWithCorpus('quantum analysis methods');

    const analysisScore = result.tfidfScores.get('analysis') ?? 0;
    const quantumScore = result.tfidfScores.get('quantum') ?? 0;

    // Quantum appears in fewer documents → higher TF-IDF.
    expect(quantumScore).toBeGreaterThan(analysisScore);
  });

  // --------------------------------------------------------------------------
  // T3: Edge cases
  // --------------------------------------------------------------------------

  it('T3: empty input returns empty tokens and empty scores', () => {
    const result = preprocessor.preprocess('');

    expect(result.tokens).toHaveLength(0);
    expect(result.tfidfScores.size).toBe(0);
  });

  it('T3b: single content word input returns exactly one token', () => {
    const result = preprocessor.preprocess('analysis');

    expect(result.tokens).toHaveLength(1);
    // Should be the lemma of "analysis".
    expect(result.tokens[0]).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // T4: Case normalization
  // --------------------------------------------------------------------------

  it('T4: case normalization — uppercase variants produce same lemma as lowercase', () => {
    const lower = preprocessor.preprocess('running');
    const upper = preprocessor.preprocess('RUNNING');
    const title = preprocessor.preprocess('Running');

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

  it('lemmatize() returns canonical form for verb variants', () => {
    const p = new Preprocessor();

    expect(p.lemmatize('running')).toBe('run');
    expect(p.lemmatize('runs')).toBe('run');
    expect(p.lemmatize('ran')).toBe('run');
    expect(p.lemmatize('run')).toBe('run');
  });

  it('lemmatize() handles noun plurals', () => {
    const p = new Preprocessor();

    expect(p.lemmatize('cats')).toBe('cat');
    expect(p.lemmatize('dogs')).toBe('dog');
  });
});
