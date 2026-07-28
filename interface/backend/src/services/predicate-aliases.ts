export interface PredicateAliasSuggestion {
  /** Extracted label that might be an alias. */
  source: string;
  /** Existing extracted or ontology-anchored label it resembles. */
  target: string;
  /** Canonical symbol that an audited ontology entry would apply. */
  proposedCanonical: string;
  similarity: number;
  /** Critical when the symbols never co-occur in a derived block. */
  severity: "critical" | "warning";
}
