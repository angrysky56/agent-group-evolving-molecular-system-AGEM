declare module "stopword" {
  /**
   * Remove stopwords from an array of tokens.
   * @param tokens Array of lowercased tokens.
   * @param stopwords Optional array of custom stopwords to remove. Defaults to English stopwords.
   */
  export function removeStopwords(tokens: string[], stopwords?: string[]): string[];

  /**
   * The English stopwords list.
   */
  export const eng: string[];
}
