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
// graphology-layout-forceatlas2
// ---------------------------------------------------------------------------

/**
 * graphology-layout-forceatlas2
 *
 * Force-directed graph layout using the ForceAtlas2 algorithm.
 * Computes node positions via physics simulation (attractive + repulsive forces).
 *
 * Used by TNA-08 (Phase 6) for semantic graph visualization layout.
 *
 * NOTE: This package ships index.d.ts but uses CJS-style 'import Graph from graphology-types'
 * which fails under NodeNext ESM resolution. We use createRequire (CJS interop) in
 * LayoutComputer.ts and declare our own types here (same pattern as graphology-metrics in
 * CentralityAnalyzer.ts). skipLibCheck:true in tsconfig prevents bundled types from
 * causing compiler errors.
 */
declare module 'graphology-layout-forceatlas2' {
  interface ForceAtlas2Settings {
    /** Use linLog mode (logarithmic attraction). Default: false */
    linLogMode?: boolean;
    /** Adjust sizes. Default: false */
    adjustSizes?: boolean;
    /** Edge weight influence. Default: 1 */
    edgeWeightInfluence?: number;
    /** Scaling ratio (repulsion strength). Default: 1 */
    scalingRatio?: number;
    /** Use strong gravity mode. Default: false */
    strongGravityMode?: boolean;
    /** Gravity constant. Default: 1 */
    gravity?: number;
    /** Slowdown factor. Default: 1 */
    slowDown?: number;
    /** Use Barnes-Hut approximation for O(n log n). Default: false */
    barnesHutOptimize?: boolean;
    /** Barnes-Hut accuracy parameter. Default: 0.5 */
    barnesHutTheta?: number;
  }

  interface ForceAtlas2SyncParams {
    /** Number of simulation iterations to run. Required. */
    iterations: number;
    /** Physics settings. */
    settings?: ForceAtlas2Settings;
    /** Edge weight attribute key. Default: null (unweighted). */
    getEdgeWeight?: string | null;
  }

  type LayoutMapping = Record<string, { x: number; y: number }>;

  interface IForceAtlas2 {
    /** Run layout and return positions without modifying graph. */
    (graph: unknown, params: ForceAtlas2SyncParams): LayoutMapping;
    (graph: unknown, iterations: number): LayoutMapping;
    /** Assign positions directly to graph node attributes. */
    assign(graph: unknown, params: ForceAtlas2SyncParams): void;
    assign(graph: unknown, iterations: number): void;
    /** Infer sensible settings for a graph of given node count. */
    inferSettings(order: number): ForceAtlas2Settings;
  }

  const forceAtlas2: IForceAtlas2;
  export = forceAtlas2;
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
