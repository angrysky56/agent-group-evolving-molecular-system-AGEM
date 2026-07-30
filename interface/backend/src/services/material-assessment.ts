/**
 * material-assessment.ts — reason about the input BEFORE ingesting it.
 *
 * The gap this closes
 * -------------------
 * AGEM's pipeline was unconditional: `run_agem_cycle(text)` segments whatever
 * it is handed, builds a co-occurrence graph, and extraction then tries to type
 * claims out of material nobody ever assessed. `runIntent` does not help —
 * it is read from `body.intent`, i.e. the CALLER declares what kind of run this
 * is. The engine never forms a view.
 *
 * Two consequences, both observed:
 *
 *   1. A bare question is ingested as though it were a corpus. There is no
 *      corpus. The graph is noise and every downstream instrument reports on
 *      noise. Garbage in.
 *   2. Material that cannot support formal verification is put through formal
 *      verification anyway, which burns a full extraction pass and aborts.
 *      `isStructuralMismatch` in run-termination.ts reaches the right verdict
 *      — "this corpus is not formalizable" — but only AFTER the failure. The
 *      same judgement made here costs one cheap pass and produces no failure.
 *
 * Why this is not another special case
 * ------------------------------------
 * Every previous fix in this area named a specific failure and handled it:
 * `mixed` verdicts, `syntax_error` responses, empty repair proposals,
 * structural mismatch. Each was correct and each required the failure to happen
 * first. This module inverts that: instead of recognising a jam, it asks what
 * the material is and which instrument fits, so the jam is not entered.
 *
 * Determinism first, judgement second
 * -----------------------------------
 * Most of the answer is computable without a model. Length, question ratio,
 * attribution-cue density and propositional-cue density separate the clear
 * cases for free. The LLM is consulted only when those signals are genuinely
 * ambiguous, and its verdict is recorded with reasons next to the numbers that
 * prompted it, so a reader can disagree with either.
 *
 * This assessment RECOMMENDS. It does not gate. A recommendation that silently
 * skipped verification would be a worse failure than the one it replaces —
 * see `permitsSkippingFormalPath`, which is deliberately narrow.
 */

export type MaterialKind =
  | "question"
  | "corpus"
  | "claim-to-check"
  | "instruction"
  | "mixed";

/**
 * Whether the material can carry a formal verdict at all.
 *
 * This is a property of the TEXT, not of the extractor's mood. A philosophical
 * argument is not defective for being argumentative; it is simply not the kind
 * of thing a prover settles.
 */
export type Formalizability =
  | "propositional"
  | "argumentative"
  | "narrative"
  | "undetermined";

export type ReasoningPath =
  | "build-corpus-first"
  | "formal-verification"
  | "evidential"
  | "discovery-only"
  | "no-analysis";

/** Cheap, auditable measurements. No model, no network. */
export interface MaterialSignals {
  chars: number;
  sentences: number;
  questionRatio: number;
  /** Sentences carrying "X holds/argues/claims that" — attributable positions. */
  attributionCueDensity: number;
  /** Sentences carrying if/then, therefore, all, none, entails. */
  propositionalCueDensity: number;
  /** Sentences carrying like, as if, sheds light, in terms of, metaphor. */
  figurativeCueDensity: number;
}

export interface MaterialAssessment {
  kind: MaterialKind;
  formalizability: Formalizability;
  recommendedPath: ReasoningPath;
  /** Plain-language reasons, each tied to a signal or to the adjudicator. */
  reasons: string[];
  signals: MaterialSignals;
  /** Which stage decided: the cheap signals, or the model. */
  decidedBy: "signals" | "adjudicator" | "signals+adjudicator";
  /** Set when the model was consulted and failed; signals stand alone. */
  adjudicatorError?: string;
}

const ATTRIBUTION_CUE =
  /\b(holds?|argues?|claims?|asserts?|maintains?|contends?|proposes?|denies|objects?|according to|on this view|the \w+ (view|position|account|objection))\b/i;

const PROPOSITIONAL_CUE =
  /\b(if\b.*\bthen|therefore|thus|hence|it follows|entails?|implies|necessary|sufficient|all\s+\w+\s+are|no\s+\w+\s+(is|are)|cannot be both|contradicts?|inconsistent)\b/i;

const FIGURATIVE_CUE =
  /\b(like a|as if|as though|sheds? light|in terms of|metaphor|analogy|resembles?|is a kind of dance|picture(s|d)? it)\b/i;

/** Split on sentence enders, keeping it dependency-free and predictable. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function measureMaterial(text: string): MaterialSignals {
  const parts = sentences(text);
  const n = parts.length || 1;
  const ratio = (re: RegExp) =>
    parts.filter((s) => re.test(s)).length / n;
  return {
    chars: text.length,
    sentences: parts.length,
    questionRatio: parts.filter((s) => s.trimEnd().endsWith("?")).length / n,
    attributionCueDensity: ratio(ATTRIBUTION_CUE),
    propositionalCueDensity: ratio(PROPOSITIONAL_CUE),
    figurativeCueDensity: ratio(FIGURATIVE_CUE),
  };
}

/**
 * Below this, there is no corpus — whatever the text is, it is not material to
 * analyse. Matches the workflow contract's existing `materialThreshold`, so the
 * two components agree about when a corpus was supplied.
 */
const CORPUS_MIN_CHARS = 600;

/**
 * The adjudicator. Consulted only when the cheap signals are ambiguous.
 *
 * Returns a partial view; the caller merges it with the signals rather than
 * letting it overwrite them. A model that disagrees with an unambiguous
 * measurement does not get to win.
 */
export type MaterialAdjudicator = (
  text: string,
  signals: MaterialSignals,
) => Promise<{
  kind?: MaterialKind;
  formalizability?: Formalizability;
  reason?: string;
}>;

/**
 * Classify from the cheap signals alone, and say whether that was enough.
 *
 * Exported separately so the decision can be inspected and argued with without
 * running anything. The thresholds are stated here rather than buried, because
 * they are the part most likely to be wrong and most in need of tuning against
 * real corpora.
 */
export function classifyFromSignals(signals: MaterialSignals): {
  kind: MaterialKind;
  formalizability: Formalizability;
  reasons: string[];
  ambiguous: boolean;
} {
  const reasons: string[] = [];

  // 1. Is there a corpus at all?
  if (signals.chars < CORPUS_MIN_CHARS) {
    if (signals.questionRatio >= 0.5) {
      return {
        kind: "question",
        formalizability: "undetermined",
        reasons: [
          `${signals.chars} chars and ${(signals.questionRatio * 100).toFixed(0)}% of sentences are questions: this is a question, not a corpus.`,
          "There is nothing to ingest yet. A corpus has to be BUILT — by searching, reasoning, or experiment — before any analysis instrument applies. Ingesting the question itself would put noise in the graph and every downstream result would describe that noise.",
        ],
        ambiguous: false,
      };
    }
    return {
      kind: "instruction",
      formalizability: "undetermined",
      reasons: [
        `${signals.chars} chars, below the ${CORPUS_MIN_CHARS}-char corpus threshold, and not phrased as a question: treated as an instruction or command.`,
      ],
      ambiguous: false,
    };
  }

  reasons.push(
    `${signals.chars} chars across ${signals.sentences} sentences: substantial enough to be a corpus.`,
  );

  /*
   * 2. Can it carry a formal verdict?
   *
   * THRESHOLDS ARE CALIBRATED, NOT GUESSED. Measured over every corpus in
   * corpora/ and docs/logic-corpus/ with scripts/calibrate-material.ts:
   *
   *   corpus                          prop   attr    fig   real outcome
   *   quantum-mind-genesis/corpus    0.057  0.571  0.000   extracted 24 claims
   *   qm-interpretations/corpus      0.025  0.321  0.000   formal path works
   *   quantum-no-go-nary             0.000  0.200  0.000   formal path works
   *   decision-theory/corpus         0.084  0.150  0.000   formal path works
   *   reverse-math/corpus            0.023  0.114  0.000   formal path works
   *   generalization-trilemma        0.022  0.088  0.007   formal path works
   *   peirce-abduction-einstein      0.000  0.040  0.080   ABORTED, unmappable
   *
   * Two things that first-draft intuition got wrong:
   *
   *   - `propositionalCueDensity` is near zero for EVERY corpus, including the
   *     ones the prover handles. Real sources rarely write "therefore". It is
   *     kept for the record and deliberately not used as a gate.
   *   - The separating signal is FIGURATIVE density. Peirce/Einstein sits at
   *     0.080 against a baseline of 0.000–0.008 — an order of magnitude clear
   *     of everything else, and it is the only corpus in the set that could not
   *     be formalised. Attribution density then separates surveys of named
   *     positions (0.11–0.57) from single-voice material.
   */
  const prop = signals.propositionalCueDensity;
  const attr = signals.attributionCueDensity;
  const fig = signals.figurativeCueDensity;

  reasons.push(
    `cue densities — attribution ${attr.toFixed(3)}, figurative ${fig.toFixed(3)}, propositional ${prop.toFixed(3)}.`,
  );

  /*
   * Figurative first, because it is the signal with real separation and the
   * only one with a confirmed failure behind it. Ordering it after attribution
   * would misclassify a figurative survey.
   */
  if (fig >= 0.05) {
    reasons.push(
      `figurative density ${fig.toFixed(3)} is far above the 0.000–0.008 baseline of corpora the prover handles. Much of what this text asserts is carried by metaphor, description or analogy, which does not map to a closed first-order vocabulary. Formal extraction here is expected to abort on unmappable claims rather than produce a verdict.`,
    );
    return {
      kind: "corpus",
      formalizability: "argumentative",
      reasons,
      ambiguous: false,
    };
  }

  if (attr >= 0.12) {
    reasons.push(
      `attribution density ${attr.toFixed(3)} matches the range of corpora that extract successfully (0.11–0.57): named holders assert things here, so claims should be typeable and attributable. The formal path is the right instrument.`,
    );
    return {
      kind: "corpus",
      formalizability: "propositional",
      reasons,
      ambiguous: false,
    };
  }

  if (attr < 0.06 && prop < 0.05) {
    reasons.push(
      "almost no attributed positions and almost no propositional connectives: this reads as description or narrative. Note that terse formal statements also score low here, so this does not by itself mean the material cannot be verified.",
    );
    return {
      kind: "corpus",
      formalizability: "narrative",
      reasons,
      ambiguous: false,
    };
  }

  // Everything else is genuinely unclear from counting alone.
  reasons.push(
    "the signals do not separate cleanly, so counting is not enough to decide what this material can support.",
  );
  return {
    kind: "corpus",
    formalizability: "undetermined",
    reasons,
    ambiguous: true,
  };
}

/** Which instrument the assessment points at. */
export function recommendPath(
  kind: MaterialKind,
  formalizability: Formalizability,
): ReasoningPath {
  if (kind === "question") return "build-corpus-first";
  if (kind === "instruction") return "no-analysis";
  if (kind === "claim-to-check") return "formal-verification";
  switch (formalizability) {
    case "propositional":
      return "formal-verification";
    case "argumentative":
      /*
       * The ONLY reading that redirects. It is driven by figurative density,
       * the one signal with real separation in the calibration set and a
       * confirmed abort behind it.
       */
      return "evidential";
    case "narrative":
      /*
       * Deliberately still the formal path.
       *
       * Low cue density means "few attributed positions were detected", which
       * a terse formal corpus also produces — `logic-h1-test-corpus.md` scores
       * 0.020 attribution and is a designed logic test. Routing narrative to
       * the evidential path would skip verification on material that could
       * have carried it, and that error is silent. The briefing still reports
       * the reading so a thin corpus is not a surprise.
       */
      return "formal-verification";
    case "undetermined":
      /*
       * Try the formal path when unsure.
       *
       * The asymmetry is deliberate: a formal attempt that aborts is recoverable
       * and now routes to the evidential path on structural mismatch, whereas
       * skipping verification on material that could have carried it loses a
       * result silently. Guess in the direction whose error is visible.
       */
      return "formal-verification";
  }
}

/**
 * May this assessment be used to SKIP formal verification entirely?
 *
 * Narrow on purpose. An assessment confident enough to redirect the reasoning
 * is not automatically confident enough to excuse the run from verifying, and
 * conflating the two would turn a helpful hint into a way to dodge the one
 * check that produces verdicts. Only an unambiguous, signal-decided reading of
 * clearly figurative or narrative material qualifies — and even then the run
 * must SAY it skipped, which is why the reasons travel with the verdict.
 */
export function permitsSkippingFormalPath(
  assessment: MaterialAssessment,
): boolean {
  return (
    assessment.decidedBy === "signals" &&
    assessment.kind === "corpus" &&
    assessment.formalizability === "argumentative"
  );
}

/**
 * Assess the material. The adjudicator is consulted only when counting was
 * inconclusive, and never overrides an unambiguous measurement.
 */
export async function assessMaterial(
  text: string,
  adjudicator?: MaterialAdjudicator,
): Promise<MaterialAssessment> {
  const signals = measureMaterial(text);
  const base = classifyFromSignals(signals);

  if (!base.ambiguous || !adjudicator) {
    return {
      kind: base.kind,
      formalizability: base.formalizability,
      recommendedPath: recommendPath(base.kind, base.formalizability),
      reasons: base.reasons,
      signals,
      decidedBy: "signals",
    };
  }

  try {
    const verdict = await adjudicator(text, signals);
    const kind = verdict.kind ?? base.kind;
    const formalizability = verdict.formalizability ?? base.formalizability;
    return {
      kind,
      formalizability,
      recommendedPath: recommendPath(kind, formalizability),
      reasons: [
        ...base.reasons,
        `adjudicator: ${verdict.reason ?? "no reason given"}`,
      ],
      signals,
      decidedBy: "signals+adjudicator",
    };
  } catch (error) {
    /*
     * An adjudicator failure must not silently become a confident verdict.
     * Fall back to the signals, keep `undetermined`, and record why — which
     * routes to the formal path, the direction whose error is visible.
     */
    return {
      kind: base.kind,
      formalizability: base.formalizability,
      recommendedPath: recommendPath(base.kind, base.formalizability),
      reasons: [
        ...base.reasons,
        "adjudicator unavailable; the cheap signals stand alone and the reading remains undetermined.",
      ],
      signals,
      decidedBy: "signals",
      adjudicatorError:
        error instanceof Error ? error.message : String(error),
    };
  }
}

/** The briefing injected into the run, so instrument choice follows assessment. */
export function assessmentBriefing(assessment: MaterialAssessment): string {
  const lines = [
    `# Material assessment (computed before ingestion, decided by: ${assessment.decidedBy})`,
    `Kind: ${assessment.kind} · Formalizability: ${assessment.formalizability} · Suggested path: ${assessment.recommendedPath}`,
    "",
    ...assessment.reasons.map((reason) => `- ${reason}`),
    "",
  ];
  switch (assessment.recommendedPath) {
    case "build-corpus-first":
      lines.push(
        "THERE IS NO CORPUS YET. Do not ingest this input as though it were source material — that would fill the graph with the question's own words and every later result would describe that noise.",
        "Build the corpus first: search, gather sources, reason the problem out, or run an experiment. Ingest what you GATHER, then analyse.",
      );
      break;
    case "evidential":
      lines.push(
        "This material is unlikely to support a formal verdict. You may still attempt the formal path, but if it aborts on unmappable claims that is the expected outcome and not a defect to repair.",
        "The evidential path (build_defensible_claim) is the better first choice. Say which you chose and why.",
      );
      break;
    case "formal-verification":
      lines.push(
        "This material looks like it can carry attributable propositional claims. The formal path is the right first instrument.",
      );
      break;
    case "no-analysis":
      lines.push(
        "This is a command rather than material to analyse. Do not ingest it.",
      );
      break;
    case "discovery-only":
      lines.push("Structural discovery only; no verdict is expected.");
      break;
  }
  lines.push(
    "",
    "This assessment is a recommendation from cheap measurements, not a verdict. If the material contradicts it, say so and proceed on the evidence.",
  );
  return lines.join("\n");
}
