/**
 * baseline-keys.ts — the answer keys, transcribed for machine scoring.
 *
 * These are copied from the `answer-key.md` files that sit beside each corpus
 * and were written BEFORE any run. They are the arbiter. Hobbes's point
 * applies directly: an account is not well cast up because a great many
 * approved it, so the engine's own confidence — and my passing unit tests —
 * are not evidence. Only a key written in advance is.
 *
 * TRANSCRIPTION RULES, because whoever transcribes the key can weaken it:
 *   - Stance names are copied verbatim from the markdown tables. No renaming
 *     to match whatever symbols the extractor happens to produce.
 *   - `mustNotFind` is copied with equal care. It is the half that catches an
 *     engine which is merely detecting negation, and it is the half a lazy
 *     transcription would drop.
 *   - Every entry cites its source line so the transcription can be audited
 *     against the file rather than trusted.
 *
 * IMPORTANT: `evaluateExtractorBaseline` in extractor-baseline.ts scores
 * canonical extracted CLAIMS. These keys are about logical VERDICTS — which
 * minimal unsatisfiable sets the prover reproduced, and which positions it
 * must report consistent. The two measure different things; do not feed these
 * keys to that evaluator.
 */

export interface VerdictAnswerKey {
  corpusId: string;
  /** Path to the human-readable key these were transcribed from. */
  source: string;
  /**
   * Minimal unsatisfiable sets the run must reproduce. Each is the stance set
   * the published theorem shows cannot hold together.
   */
  mustFind: Array<{
    name: string;
    stances: string[];
    /** Line in the source markdown this was copied from. */
    sourceLine: number;
  }>;
  /**
   * Things that must come back CONSISTENT. A run that flags one of these has
   * shown it is detecting negation rather than reckoning.
   */
  mustNotFind: Array<{ name: string; why: string; sourceLine: number }>;
  /** The key's own pass condition, verbatim. */
  passCondition: string;
}

export const VERDICT_ANSWER_KEYS: VerdictAnswerKey[] = [
  {
    corpusId: "qm-interpretations",
    source: "corpora/qm-interpretations/answer-key.md",
    mustFind: [
      {
        name: "Bell",
        stances: [
          "locality",
          "definite_prior_values",
          "measurement_independence",
          "empirically_adequate",
        ],
        sourceLine: 8,
      },
      {
        name: "Kochen-Specker",
        stances: ["noncontextuality", "value_definiteness", "empirically_adequate"],
        sourceLine: 9,
      },
      {
        name: "PBR",
        stances: ["psi_epistemic", "preparation_independence", "empirically_adequate"],
        sourceLine: 10,
      },
      {
        name: "Frauchiger-Renner",
        stances: ["universal_quantum_theory", "agent_consistency", "single_outcome"],
        sourceLine: 11,
      },
      {
        name: "Leggett-Garg",
        stances: ["macrorealism", "noninvasive_measurability", "empirically_adequate"],
        sourceLine: 12,
      },
      {
        name: "Brukner / Local Friendliness",
        stances: [
          "observer_independent_facts",
          "locality",
          "measurement_independence",
          "universal_quantum_theory",
        ],
        sourceLine: 13,
      },
    ],
    mustNotFind: [
      {
        name: "ontic_vs_epistemic_alone",
        why: "the psi-ontic/psi-epistemic split alone is not a contradiction; flagging it is the tripwire for an engine detecting negation",
        sourceLine: 28,
      },
      {
        name: "Bohm",
        why: "Bohm survives Bell by dropping locality; calling it contradictory means the escape routes are not encoded",
        sourceLine: 18,
      },
      {
        name: "QBism",
        why: "escapes PBR by denying there is a lambda at all",
        sourceLine: 10,
      },
      {
        name: "Everett",
        why: "escapes Frauchiger-Renner by dropping single outcomes",
        sourceLine: 11,
      },
      {
        name: "RQM",
        why: "escapes Brukner by dropping observer-independent facts",
        sourceLine: 13,
      },
    ],
    passCondition:
      "Pass requires all six in mustFind reproduced and all five mustNotFind entries reported consistent. Reproducing Bell while also calling Bohm contradictory is a fail — it means the escape routes aren't encoded and the engine is just detecting negation.",
  },
  {
    corpusId: "quantum-mind-genesis",
    source: "corpora/quantum-mind-genesis/answer-key.md",
    mustFind: [],
    mustNotFind: [
      {
        name: "Orch-OR",
        why: "empirically constrained, not refuted — the corpus states both Tegmark's estimate and the Hagan/Hameroff/Tuszynski dispute, so a correct run reports positions-incompatible with an open empirical question, not a settled contradiction",
        sourceLine: 20,
      },
    ],
    passCondition:
      "Must come back SAT. Getting the distinction between an empirical constraint and a settled contradiction right is the whole test of this corpus.",
  },
  {
    corpusId: "decision-theory",
    source: "corpora/decision-theory/answer-key.md",
    mustFind: [
      {
        name: "dominance_vs_newcomb",
        stances: ["dominance", "newcomb_adequacy"],
        sourceLine: 27,
      },
      {
        name: "evidential_vs_lesion",
        stances: ["evidential_responsiveness", "lesion_adequacy"],
        sourceLine: 27,
      },
      {
        name: "no_three_jointly_satisfiable",
        stances: [
          "dominance",
          "evidential_responsiveness",
          "newcomb_adequacy",
          "lesion_adequacy",
        ],
        sourceLine: 29,
      },
      {
        name: "ratifiability_impossible",
        stances: ["death_in_damascus", "ratifiable_act"],
        sourceLine: 48,
      },
    ],
    mustNotFind: [
      {
        name: "dominance + evidential_responsiveness",
        why: "a maximal satisfiable pair",
        sourceLine: 33,
      },
      {
        name: "dominance + lesion_adequacy (CDT)",
        why: "a maximal satisfiable pair — this is CDT and it is coherent",
        sourceLine: 34,
      },
      {
        name: "evidential_responsiveness + newcomb_adequacy (EDT)",
        why: "a maximal satisfiable pair — this is EDT and it is coherent",
        sourceLine: 35,
      },
      {
        name: "newcomb_adequacy + lesion_adequacy (FDT)",
        why: "a maximal satisfiable pair — FDT changes the object of evaluation from acts to policies rather than weakening a desideratum",
        sourceLine: 36,
      },
    ],
    passCondition:
      "Pass = all four mustFind reproduced, all four mustNotFind reported consistent. ratifiability_impossible is arity 2 and nearly trivial: if AGEM misses it, the problem is in extraction or attribution, not in the search — check there before touching anything else.",
  },
  {
    corpusId: "reverse-math",
    source: "corpora/reverse-math/answer-key.md",
    /*
     * INVERTED SCORING. On the other three corpora a surplus MUS is a
     * candidate finding; here it is almost certainly an encoding bug. Fifty
     * years of hand-verified results — the corpus's job is to fail loudly when
     * the pipeline is broken.
     */
    mustFind: [
      { name: "rt22_not_aca0", stances: ["rt22", "aca0"], sourceLine: 29 },
      { name: "rt22_not_wkl0", stances: ["rt22", "wkl0"], sourceLine: 30 },
      {
        name: "ramsey_uniform_strength",
        stances: ["rt22", "rt_n_k", "aca0"],
        sourceLine: 31,
      },
      {
        name: "hierarchy_strictness",
        stances: ["wkl0", "aca0"],
        sourceLine: 32,
      },
    ],
    mustNotFind: [],
    passCondition:
      "ramsey_uniform_strength is THE test. If the extractor aliases rt22 to rt_n_k — and an embedding pass will absolutely propose that merge, the strings are nearly identical — this MUS vanishes and the run PASSES WHILE BEING WRONG. ontology.json carries an explicit _DO_NOT_MERGE block. Surplus MUS here is an encoding bug, not a finding.",
  },
];

/**
 * Corpora where an unexpected extra contradiction means a bug, not a discovery.
 *
 * Directly relevant to the glossary extension round: an extension that merged
 * `rt22` into `rt_n_k` would make `ramsey_uniform_strength` disappear and the
 * run would look BETTER while being wrong. The extension is add-only and
 * refuses redefinition, which is the guard — but predicate-alias suggestions
 * are a separate path and this is the corpus that would catch them.
 */
export const INVERTED_SCORING_CORPORA = new Set(["reverse-math"]);
