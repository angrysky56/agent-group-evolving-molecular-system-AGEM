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
import type { TNAConfig, PreprocessResult, DetailedPreprocessResult } from "./interfaces.js";
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
export declare class Preprocessor {
    #private;
    constructor(config?: TNAConfig);
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
    lemmatize(word: string): string;
    /**
     * preprocess — full TF-IDF + lemmatization pipeline for a single document.
     *
     * This creates a temporary single-document TF-IDF instance. For multi-document
     * corpus scoring, use addDocument() + preprocessWithCorpus() instead.
     *
     * @param text - Raw input text.
     * @returns PreprocessResult with lemmatized tokens and TF-IDF scores.
     */
    preprocess(text: string): PreprocessResult;
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
    preprocessDetailed(text: string): DetailedPreprocessResult;
    /**
     * addDocument — adds a raw text document to the TF-IDF corpus.
     *
     * Call this multiple times before preprocessWithCorpus() to build the
     * document frequency corpus for accurate IDF computation.
     *
     * @param text - Raw input text document.
     */
    addDocument(text: string): void;
    /**
     * preprocessWithCorpus — preprocesses text using the accumulated corpus TF-IDF.
     *
     * Returns TF-IDF scores computed against all documents added via addDocument().
     * Terms appearing in more documents will have lower scores (lower IDF component).
     *
     * @param text - Raw input text to preprocess.
     * @returns PreprocessResult with corpus-aware TF-IDF scores.
     */
    preprocessWithCorpus(text: string): PreprocessResult;
}
//# sourceMappingURL=Preprocessor.d.ts.map