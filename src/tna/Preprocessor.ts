/**
 * Preprocessor.ts
 *
 * TF-IDF + lemmatization preprocessing pipeline for the TNA module.
 *
 * The CRITICAL invariant: lemmatization happens BEFORE any tokens are returned.
 * No raw surface form ever reaches the co-occurrence graph. This is the primary
 * pitfall guard for TNA (Pitfall: 4-gram window without lemmatization causes
 * node count to grow proportionally to total word count rather than unique concepts).
 *
 * Pipeline:
 *   1. Tokenize using natural.WordTokenizer
 *   2. Lowercase all tokens
 *   3. Remove stopwords using stopword.removeStopwords()
 *   4. Lemmatize each remaining token using wink-lemmatizer (with Porter fallback)
 *   5. Compute TF-IDF scores
 *   6. Filter tokens below minTfidfWeight threshold
 *
 * Dependencies:
 *   - natural (TfIdf, WordTokenizer, PorterStemmer)
 *   - wink-lemmatizer (verb, noun, adjective POS-specific lemmatization)
 *   - stopword (removeStopwords, eng corpus)
 */

import natural from 'natural';
import winkLemmatizer = require('wink-lemmatizer');
import { removeStopwords, eng } from 'stopword';
import type { TNAConfig, PreprocessResult, DetailedPreprocessResult } from './interfaces.js';

// ---------------------------------------------------------------------------
// Resolve natural module exports (handles ESM interop with CommonJS natural)
// ---------------------------------------------------------------------------

const { TfIdf, WordTokenizer } = natural as {
  TfIdf: typeof import('natural').TfIdf;
  WordTokenizer: typeof import('natural').WordTokenizer;
};

// ---------------------------------------------------------------------------
// Default configuration values
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<TNAConfig> = {
  windowSize: 4,
  minTfidfWeight: 0.1,
  louvainSeed: 42,
  language: 'en',
};

// ---------------------------------------------------------------------------
// Internal pipeline result (before TF-IDF filtering)
// ---------------------------------------------------------------------------

interface PipelineResult {
  /** Lemmatized, stopword-removed tokens in order. */
  lemmatizedTokens: string[];
  /** Maps pre-lemmatization surface form → canonical lemma. */
  surfaceToLemma: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Preprocessor class
// ---------------------------------------------------------------------------

/**
 * Preprocessor — TF-IDF + lemmatization preprocessing for TNA.
 *
 * Usage:
 *   // Single document preprocessing:
 *   const p = new Preprocessor();
 *   const result = p.preprocess('The runners are running quickly');
 *   // result.tokens: ['runner', 'run', 'quick'] (lemmatized, stopword-removed)
 *
 *   // Multi-document corpus TF-IDF:
 *   const p = new Preprocessor();
 *   p.addDocument('document one text');
 *   p.addDocument('document two text');
 *   const result = p.preprocessWithCorpus('new document to score');
 *
 *   // Surface form tracking (for CooccurrenceGraph.surfaceForms):
 *   const result = p.preprocessDetailed('The cats ran quickly');
 *   // result.surfaceToLemma: { cats → cat, ran → run, quickly → quick }
 */
export class Preprocessor {
  readonly #config: Required<TNAConfig>;
  readonly #tfidf: InstanceType<typeof TfIdf>;
  readonly #tokenizer: InstanceType<typeof WordTokenizer>;

  constructor(config?: TNAConfig) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#tfidf = new TfIdf();
    this.#tokenizer = new WordTokenizer();
  }

  // --------------------------------------------------------------------------
  // Public: lemmatize()
  // --------------------------------------------------------------------------

  /**
   * lemmatize — returns the canonical lemma form of a word.
   *
   * Strategy: try wink-lemmatizer for verb, noun, and adjective POS,
   * then pick the shortest result (most reduced form). If wink-lemmatizer
   * produces no change for any POS, fall back to PorterStemmer.
   *
   * The "shortest result" heuristic works because:
   *   - "running" → verb="run" (shorter) vs noun="running" → pick "run"
   *   - "runs" → verb="run" vs noun="run" → both "run"
   *   - "cats" → noun="cat" (shorter) vs verb="cats" → pick "cat"
   *
   * @param word - Lowercased input word.
   * @returns Canonical lemma string.
   */
  lemmatize(word: string): string {
    const lower = word.toLowerCase();

    // Try all three POS lemmatizations.
    const verbForm = winkLemmatizer.verb(lower);
    const nounForm = winkLemmatizer.noun(lower);
    const adjForm = winkLemmatizer.adjective(lower);

    // Collect results that differ from the input (actual lemmatization happened).
    const lemmatized = [verbForm, nounForm, adjForm];

    // Pick the shortest result — this gives the most reduced canonical form.
    // Sort by length ascending and pick first.
    const shortest = lemmatized.reduce((a, b) => (a.length <= b.length ? a : b));

    // If the shortest form is the same as input, it means wink didn't lemmatize.
    // Keep the word as-is (it's already in canonical form).
    // We deliberately do NOT fall back to Porter stemmer here because Porter
    // would produce inconsistent canonical forms:
    //   "analyze" → Porter → "analyz" (different from "analyze" ← "analyzing" via wink)
    // This causes nodes like "analyz" and "analyze" to appear as separate concepts
    // when they are the same concept, which is exactly the node-count-explosion pitfall.
    return shortest;
  }

  // --------------------------------------------------------------------------
  // Private: #runPipeline() — shared tokenize/stopword/lemmatize logic
  // --------------------------------------------------------------------------

  /**
   * #runPipeline — core text processing: tokenize, lowercase, remove stopwords, lemmatize.
   *
   * Returns both the lemmatized tokens in order AND the surface-to-lemma mapping
   * for surface form tracking in CooccurrenceGraph.
   *
   * @param text - Raw input text.
   */
  #runPipeline(text: string): PipelineResult {
    // Step 1: Tokenize.
    const rawTokens: string[] = this.#tokenizer.tokenize(text) ?? [];

    // Step 2: Lowercase.
    const lowercased = rawTokens.map(t => t.toLowerCase());

    // Step 3: Remove stopwords.
    const withoutStopwords = removeStopwords(lowercased, eng);

    // Step 4: Lemmatize each token — build surface-to-lemma map.
    const surfaceToLemma = new Map<string, string>();
    const lemmatizedTokens: string[] = [];

    for (const surface of withoutStopwords) {
      const lemma = this.lemmatize(surface);
      if (lemma.length > 0) {
        // Record ALL surface forms that map to this lemma.
        // If "running" and "runs" both map to "run", both are recorded.
        surfaceToLemma.set(surface, lemma);
        lemmatizedTokens.push(lemma);
      }
    }

    return { lemmatizedTokens, surfaceToLemma };
  }

  // --------------------------------------------------------------------------
  // Public: preprocess()
  // --------------------------------------------------------------------------

  /**
   * preprocess — full TF-IDF + lemmatization pipeline for a single document.
   *
   * This creates a temporary single-document TF-IDF instance. For multi-document
   * corpus scoring, use addDocument() + preprocessWithCorpus() instead.
   *
   * @param text - Raw input text.
   * @returns PreprocessResult with lemmatized tokens and TF-IDF scores.
   */
  preprocess(text: string): PreprocessResult {
    if (!text || text.trim().length === 0) {
      return {
        tokens: [],
        tfidfScores: new Map(),
      };
    }

    const { lemmatizedTokens } = this.#runPipeline(text);

    if (lemmatizedTokens.length === 0) {
      return { tokens: [], tfidfScores: new Map() };
    }

    // Step 5: Compute TF-IDF scores for this document.
    const tempTfidf = new TfIdf();
    tempTfidf.addDocument(lemmatizedTokens.join(' '));

    const scores = new Map<string, number>();
    const uniqueTerms = new Set(lemmatizedTokens);

    for (const term of uniqueTerms) {
      const score = tempTfidf.tfidf(term, 0);
      scores.set(term, score);
    }

    // Step 6: Filter tokens below minTfidfWeight threshold.
    const filtered = this.#config.minTfidfWeight <= 0.0
      ? lemmatizedTokens
      : lemmatizedTokens.filter(t => (scores.get(t) ?? 0) >= this.#config.minTfidfWeight);

    return {
      tokens: filtered,
      tfidfScores: scores,
    };
  }

  // --------------------------------------------------------------------------
  // Public: preprocessDetailed()
  // --------------------------------------------------------------------------

  /**
   * preprocessDetailed — TF-IDF + lemmatization pipeline with surface form tracking.
   *
   * Extends preprocess() by also returning `surfaceToLemma` — the mapping from
   * each pre-lemmatization surface form to its canonical lemma. Used by
   * CooccurrenceGraph to populate TextNode.surfaceForms.
   *
   * Example: text = "The cats were running"
   *   result.tokens = ['cat', 'run']
   *   result.surfaceToLemma = { cats → cat, running → run }
   *   (stopwords "the" and "were" are filtered)
   *
   * @param text - Raw input text.
   * @returns DetailedPreprocessResult with tokens, TF-IDF scores, and surface-to-lemma map.
   */
  preprocessDetailed(text: string): DetailedPreprocessResult {
    if (!text || text.trim().length === 0) {
      return {
        tokens: [],
        tfidfScores: new Map(),
        surfaceToLemma: new Map(),
      };
    }

    const { lemmatizedTokens, surfaceToLemma } = this.#runPipeline(text);

    if (lemmatizedTokens.length === 0) {
      return { tokens: [], tfidfScores: new Map(), surfaceToLemma: new Map() };
    }

    // Compute TF-IDF scores.
    const tempTfidf = new TfIdf();
    tempTfidf.addDocument(lemmatizedTokens.join(' '));

    const scores = new Map<string, number>();
    const uniqueTerms = new Set(lemmatizedTokens);

    for (const term of uniqueTerms) {
      const score = tempTfidf.tfidf(term, 0);
      scores.set(term, score);
    }

    // Filter tokens below threshold.
    const filtered = this.#config.minTfidfWeight <= 0.0
      ? lemmatizedTokens
      : lemmatizedTokens.filter(t => (scores.get(t) ?? 0) >= this.#config.minTfidfWeight);

    return {
      tokens: filtered,
      tfidfScores: scores,
      surfaceToLemma,
    };
  }

  // --------------------------------------------------------------------------
  // Public: addDocument() and preprocessWithCorpus()
  // --------------------------------------------------------------------------

  /**
   * addDocument — adds a raw text document to the TF-IDF corpus.
   *
   * Call this multiple times before preprocessWithCorpus() to build the
   * document frequency corpus for accurate IDF computation.
   *
   * @param text - Raw input text document.
   */
  addDocument(text: string): void {
    if (!text || text.trim().length === 0) return;

    const { lemmatizedTokens } = this.#runPipeline(text);

    if (lemmatizedTokens.length > 0) {
      this.#tfidf.addDocument(lemmatizedTokens.join(' '));
    }
  }

  /**
   * preprocessWithCorpus — preprocesses text using the accumulated corpus TF-IDF.
   *
   * Returns TF-IDF scores computed against all documents added via addDocument().
   * Terms appearing in more documents will have lower scores (lower IDF component).
   *
   * @param text - Raw input text to preprocess.
   * @returns PreprocessResult with corpus-aware TF-IDF scores.
   */
  preprocessWithCorpus(text: string): PreprocessResult {
    if (!text || text.trim().length === 0) {
      return {
        tokens: [],
        tfidfScores: new Map(),
      };
    }

    const { lemmatizedTokens } = this.#runPipeline(text);

    if (lemmatizedTokens.length === 0) {
      return { tokens: [], tfidfScores: new Map() };
    }

    // Add this document to the corpus temporarily for scoring.
    const docIndex = (this.#tfidf as unknown as { documents: unknown[] }).documents.length;
    this.#tfidf.addDocument(lemmatizedTokens.join(' '));

    // Compute corpus-aware TF-IDF scores.
    const scores = new Map<string, number>();
    const uniqueTerms = new Set(lemmatizedTokens);

    for (const term of uniqueTerms) {
      const score = this.#tfidf.tfidf(term, docIndex);
      scores.set(term, score);
    }

    // Filter below threshold.
    const filtered = this.#config.minTfidfWeight <= 0.0
      ? lemmatizedTokens
      : lemmatizedTokens.filter(t => (scores.get(t) ?? 0) >= this.#config.minTfidfWeight);

    return {
      tokens: filtered,
      tfidfScores: scores,
    };
  }
}
