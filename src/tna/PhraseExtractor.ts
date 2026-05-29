/**
 * PhraseExtractor.ts
 *
 * Tracks bigram occurrences across ingestions and promotes frequently-seen
 * lemma pairs to first-class "concept phrase" nodes.
 *
 * Motivation: the bare 4-gram co-occurrence graph represents every distinct
 * lemma as its own node, so multi-word concepts ("weak lumpability",
 * "honest messenger", "phase transition") are scattered across multiple
 * single-lemma nodes. Community detection then has to reassemble them. By
 * promoting frequent adjacent-lemma bigrams to phrase-nodes, the graph
 * directly carries multi-word concepts and Louvain clusters meaningfully
 * around them.
 *
 * Design:
 *   - Pure in-memory bigram frequency counter.
 *   - update(tokens): record consecutive adjacent bigrams.
 *   - promotedPhrases(tokens): given a fresh token stream, return the
 *     positions (i, i+1) whose bigram has crossed the promotion threshold
 *     AND whose two component lemmas are not noise. Caller decides what to
 *     do with promotions (typically: insert a phrase node).
 *   - This is the concept-phrase primitive promised in the cleanup pass.
 *
 * What this does NOT do:
 *   - POS tagging. Bigrams are surface-frequency-based, not noun-phrase-
 *     based. The risk of false phrases ("very interesting", "really good")
 *     is mitigated because: (a) stopword removal already eliminates "very"
 *     and "really", and (b) the threshold filter requires multiple
 *     co-occurrences before promotion -- random adjacent pairs won't make it.
 *   - Trigrams. The same approach trivially extends to 3-grams later;
 *     deferred until the bigram primitive is validated.
 */

/** Configuration knobs for phrase promotion. */
export interface PhraseExtractorConfig {
  /**
   * Minimum number of times an adjacent bigram must be observed before it is
   * promoted to a first-class phrase node. Default 2 -- a single occurrence
   * could be coincidence, two is a pattern.
   */
  minOccurrences?: number;

  /**
   * Maximum number of phrases tracked at once. When exceeded, lowest-count
   * phrases are evicted. Prevents unbounded memory growth in long sessions.
   * Default 4096.
   */
  maxTracked?: number;
}

export class PhraseExtractor {
  readonly #counts = new Map<string, number>();
  readonly #minOccurrences: number;
  readonly #maxTracked: number;

  constructor(config?: PhraseExtractorConfig) {
    this.#minOccurrences = Math.max(2, config?.minOccurrences ?? 2);
    this.#maxTracked = Math.max(64, config?.maxTracked ?? 4096);
  }

  /**
   * update(tokens) -- record adjacent bigram occurrences from a sequence of
   * already-lemmatized tokens. No phrase nodes are created here; that
   * happens in the consumer based on promotedPhrases() output.
   */
  update(tokens: readonly string[]): void {
    for (let i = 0; i + 1 < tokens.length; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (a === b) continue; // skip duplicates (e.g. "very very")
      const key = this.#bigramKey(a, b);
      this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
    }
    this.#evictIfNeeded();
  }

  /**
   * promotedPhrases(tokens) -- for the given token stream, return positions
   * (i, i+1) whose bigram has been seen at least minOccurrences times.
   *
   * The token stream is INCLUDED in the count check, so this is meant to be
   * called AFTER update() has been called on this stream. (The bigram in
   * the current stream then counts toward its own promotion eligibility.)
   *
   * Returns: { position: i, phrase: "a b" } in token-stream order. Caller
   * can use position to insert phrase nodes into the graph.
   */
  promotedPhrases(
    tokens: readonly string[],
  ): Array<{ position: number; phrase: string }> {
    const out: Array<{ position: number; phrase: string }> = [];
    for (let i = 0; i + 1 < tokens.length; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      if (a === b) continue;
      const key = this.#bigramKey(a, b);
      const count = this.#counts.get(key) ?? 0;
      if (count >= this.#minOccurrences) {
        out.push({ position: i, phrase: `${a} ${b}` });
      }
    }
    return out;
  }

  /** Bigram occurrence count (for inspection / testing). */
  count(a: string, b: string): number {
    return this.#counts.get(this.#bigramKey(a, b)) ?? 0;
  }

  /** Total distinct bigrams currently tracked. */
  get size(): number {
    return this.#counts.size;
  }

  /** Reset all bigram counts. */
  clear(): void {
    this.#counts.clear();
  }

  /** Snapshot for persistence: plain object of bigram -> count. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.#counts) out[k] = v;
    return out;
  }

  /** Restore from snapshot. Replaces current state. */
  restore(snap: Record<string, number>): void {
    this.#counts.clear();
    for (const [k, v] of Object.entries(snap)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        this.#counts.set(k, v);
      }
    }
  }

  /** Bigram key is space-joined (preserves whitespace-free token assumption). */
  #bigramKey(a: string, b: string): string {
    return `${a} ${b}`;
  }

  /** Drop lowest-count entries when over the cap. */
  #evictIfNeeded(): void {
    if (this.#counts.size <= this.#maxTracked) return;
    // Sort ascending by count, drop the bottom N.
    const sorted = [...this.#counts.entries()].sort((x, y) => x[1] - y[1]);
    const dropCount = this.#counts.size - this.#maxTracked;
    for (let i = 0; i < dropCount; i++) {
      this.#counts.delete(sorted[i][0]);
    }
  }
}
