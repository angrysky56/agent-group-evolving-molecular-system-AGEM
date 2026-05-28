declare module "wink-lemmatizer" {
  interface WinkLemmatizer {
    /**
     * Lemmatize a noun.
     * @param word The lowercased word to lemmatize.
     */
    noun(word: string): string;

    /**
     * Lemmatize a verb.
     * @param word The lowercased word to lemmatize.
     */
    verb(word: string): string;

    /**
     * Lemmatize an adjective.
     * @param word The lowercased word to lemmatize.
     */
    adjective(word: string): string;
  }

  const winkLemmatizer: WinkLemmatizer;
  export default winkLemmatizer;
}
