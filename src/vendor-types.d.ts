/**
 * vendor-types.d.ts
 *
 * Type declarations for npm packages that do not ship their own TypeScript
 * declaration files and have no @types/* packages available.
 *
 * These are minimal shims sufficient for the AGEM project's usage.
 * They are intentionally conservative — only the APIs used in production
 * code are typed; everything else is left as 'any' or 'unknown'.
 */

// ---------------------------------------------------------------------------
// wink-lemmatizer
// ---------------------------------------------------------------------------

/**
 * wink-lemmatizer — morphological lemmatization for English words.
 *
 * Provides POS-specific lemmatization: verb(), noun(), adjective().
 * Returns the canonical lemma for the given word under each POS assumption.
 *
 * Example:
 *   lemmatizer.verb('running')   // 'run'
 *   lemmatizer.noun('cats')      // 'cat'
 *   lemmatizer.adjective('bigger') // 'big'
 */
declare module 'wink-lemmatizer' {
  interface WinkLemmatizer {
    /** Returns the canonical verb form (infinitive) of the input word. */
    verb(word: string): string;
    /** Returns the canonical noun form (singular) of the input word. */
    noun(word: string): string;
    /** Returns the canonical adjective form (positive degree) of the input word. */
    adjective(word: string): string;
    /** Alias for verb(). */
    lemmatizeVerb(word: string): string;
    /** Alias for noun(). */
    lemmatizeNoun(word: string): string;
    /** Alias for adjective(). */
    lemmatizeAdjective(word: string): string;
  }

  const lemmatizer: WinkLemmatizer;
  export = lemmatizer;
}

// ---------------------------------------------------------------------------
// stopword
// ---------------------------------------------------------------------------

/**
 * stopword — stopword removal for multiple languages.
 *
 * Provides removeStopwords() function and language-specific word arrays.
 */
declare module 'stopword' {
  /**
   * Removes stopwords from an array of tokens.
   *
   * @param tokens - Array of lowercase tokens.
   * @param stopwords - Optional stopword array (defaults to English).
   * @returns New array with stopwords removed, preserving order.
   */
  export function removeStopwords(tokens: string[], stopwords?: string[]): string[];

  /** English stopword corpus. */
  export const eng: string[];
  /** Afrikaans stopword corpus. */
  export const afr: string[];
  /** Arabic stopword corpus. */
  export const ara: string[];
  /** Spanish stopword corpus. */
  export const spa: string[];
  /** French stopword corpus. */
  export const fra: string[];
  /** German stopword corpus. */
  export const deu: string[];
  /** Italian stopword corpus. */
  export const ita: string[];
  /** Portuguese stopword corpus. */
  export const por: string[];
}
