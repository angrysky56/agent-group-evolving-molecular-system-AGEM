export type RunTerminalStatus =
  | "completed"
  | "timed-out"
  | "max-turns"
  | "contract-unmet";

export interface FinalRunOutcome {
  status: RunTerminalStatus;
  emitDone: boolean;
  contract: Record<string, unknown>;
}

export interface ToolsDisabledFinalResult {
  content: string;
  ignoredToolCalls: number;
  usedFallback: boolean;
}

export interface TypedVerificationFinalization {
  reason:
    | "typed-formalization-preflight-failed"
    | "typed-verification-inconclusive";
  fallbackContent: string;
  instruction: string;
  /**
   * Whether the failure was a STRUCTURAL MISMATCH rather than a defect, and the
   * evidential path is therefore offered as the one permitted alternative.
   *
   * See `isStructuralMismatch` for why the distinction has to be drawn here.
   */
  evidentialPathOffered: boolean;
  /**
   * True when no repair candidate could be constructed for ANY reported
   * failure, so the typed path is not recoverable by re-running. The
   * distinction matters to the reader: "repairs pending" invites a retry,
   * "repair route closed" asks for a human decision.
   */
  repairRouteExhausted: boolean;
  /** What a person would have to do, one line per closed proposal. */
  humanActionRequired: string[];
}

/**
 * Did the typed path fail because the corpus is not first-order formalizable,
 * or because the extraction is broken?
 *
 * This distinction decides whether AGEM may switch instruments, so it must not
 * be a judgement call.
 *
 * A DEFECT — unparseable output, schema violations, attribution failures — means
 * the typed path could have worked and did not. Offering an alternative there
 * papers over a fixable bug, and the corpus stops being the thing under study.
 *
 * A STRUCTURAL MISMATCH — claims that no closed vocabulary can express — means
 * the typed path was the wrong instrument for this material. Observed live on
 * the Peirce/Einstein run (2026-07-30T07-03-12): 7 unmappable claims and 18
 * vocabulary rejections, for content like Einstein describing "pure thinking"
 * as playing violin and smoking a pipe, and abduction "shedding light" on
 * itself. Those are not extraction bugs. Minting `playing_violin(einstein)` to
 * satisfy the extractor would produce a formula that proves nothing about a
 * paper whose argument is genuinely about metaphor and method.
 *
 * The run had already produced 746 concepts, 14 communities and modularity 0.52
 * before it hit this, and reported none of it as a result.
 */
export function isStructuralMismatch(
  causes: ReadonlyArray<{ code: string; count: number }>,
): boolean {
  const total = causes.reduce((sum, cause) => sum + cause.count, 0);
  if (total === 0) return false;
  const structural = causes
    .filter(
      (cause) =>
        cause.code === "unmappable-claims" ||
        cause.code === "vocabulary-rejections",
    )
    .reduce((sum, cause) => sum + cause.count, 0);
  const defects = causes
    .filter((cause) =>
      [
        "parse-failures",
        "schema-rejections",
        "glossary-failure",
        "attribution-guard-rejections",
        "attribution-issues",
        "storage-rejections",
      ].includes(cause.code),
    )
    .reduce((sum, cause) => sum + cause.count, 0);
  // A fixable defect anywhere in the run keeps the typed path on the hook.
  return structural > 0 && defects === 0;
}

/**
 * A failed typed verification is a terminal analytical result for this run.
 * Replacing it with model-authored premises only restates the model's beliefs
 * and can never satisfy the provenance-bearing workflow contract.
 */
export function typedVerificationFinalization(
  output: string,
): TypedVerificationFinalization | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed.semanticsValidated === true) return null;
  if (String(parsed.status ?? "").startsWith("deferred-")) return null;

  const preflightAborted = parsed.preflightAborted === true;
  const reason = preflightAborted
    ? "typed-formalization-preflight-failed"
    : "typed-verification-inconclusive";
  const verdict =
    typeof parsed.verdict === "string" && parsed.verdict.trim()
      ? parsed.verdict.trim()
      : preflightAborted
        ? "Formalization preflight found critical defects before any prover call."
        : "Typed claim verification did not produce a semantically validated verdict.";
  const causes = Array.isArray(parsed.inconclusiveCauses)
    ? (parsed.inconclusiveCauses as Array<{ code?: unknown; count?: unknown }>)
        .filter((cause) => cause && typeof cause === "object")
        .map((cause) => ({
          code: String(cause.code ?? ""),
          count: Number(cause.count ?? 0),
        }))
    : [];
  const structuralMismatch = isStructuralMismatch(causes);

  /*
   * Is the repair route open, or already closed?
   *
   * A defect-caused abort is only recoverable if something can actually be
   * repaired. On the quantum-mind-genesis run the answer was no — three
   * proposals, zero candidates, `validatorCalls: 0` — and the run still told
   * the user that "unresolved proposals are flagged in the output", which
   * reads as pending work. Nothing was pending. Report a closed route as
   * closed, and name what a person would have to do instead.
   */
  const repairReport =
    parsed.repairReport && typeof parsed.repairReport === "object"
      ? (parsed.repairReport as Record<string, unknown>)
      : undefined;
  const repairRouteExhausted = repairReport?.repairRouteExhausted === true;
  const humanActionRequired = Array.isArray(repairReport?.humanActionRequired)
    ? (repairReport.humanActionRequired as unknown[]).map(String)
    : [];

  return {
    reason,
    evidentialPathOffered: structuralMismatch,
    repairRouteExhausted,
    humanActionRequired,
    fallbackContent: [
      "INCONCLUSIVE — typed claim verification did not produce a validated corpus verdict.",
      verdict,
      "No hand-authored proof is a substitute for the failed provenance-bearing path.",
      ...(structuralMismatch
        ? [
            "The failure was a structural mismatch, not a defect: the corpus's claims are not " +
              "expressible in a closed first-order vocabulary. Discovery-phase results stand, and " +
              "an evidential (defeasible) claim remains available.",
          ]
        : []),
    ].join("\n\n"),
    /*
     * The original instruction banned ALL further tools. That is the right
     * guard against one specific substitution — hand-authored FOL presented as
     * corpus evidence — but it over-generalised into "stop", and a run that had
     * mapped 746 concepts reported nothing.
     *
     * The ban is therefore narrowed to what it was actually protecting: no
     * hand-authored logic, no claim of verification. When the failure is a
     * structural mismatch, exactly one alternative is permitted, and it is one
     * that CANNOT counterfeit the failed path — build_defensible_claim is
     * provenance-bearing, is labelled defeasible in its own output, and does
     * not satisfy the verify or derive contract items.
     */
    instruction: structuralMismatch
      ? [
          "Typed claim verification is inconclusive because the corpus's claims do not fit a closed",
          "first-order vocabulary. This is a mismatch of instrument, not a defect to retry.",
          "",
          "Do NOT call extract_and_verify_claims or evaluate_logical_consistency again, and do NOT",
          "author logic by hand — neither can produce the verdict this corpus was unable to support.",
          "",
          "You MAY call build_defensible_claim once, if the corpus carries checkable grounds for a",
          "claim worth making. Run the disconfirming search first (search_context) and pass the",
          "receipt. Its result is EVIDENTIAL and defeasible: it is not a logical verdict and must",
          "not be described as one.",
          "",
          "Then write the final response. Label the FORMAL result INCONCLUSIVE, name the actual",
          "reported failure causes, and report the discovery-phase findings as what they are —",
          "structural results about the concept graph, not logical ones.",
        ].join("\n")
      : [
          "Typed claim verification is inconclusive. Do not call or request more tools.",
          "Write the final user-facing response now and label it INCONCLUSIVE.",
          "Name the actual reported failure causes. Do not substitute or present hand-authored logic as corpus evidence.",
          ...(repairRouteExhausted
            ? [
                "",
                "REPAIR ROUTE IS CLOSED. No repair candidate could be constructed for any reported",
                "failure — the proposals in the output are EMPTY, and the counterfactual validator",
                "never ran. Do NOT describe them as unresolved, pending, flagged for review, or as a",
                "starting point for a repair attempt. There is nothing in them to act on.",
                "State that re-running will reproduce this result unchanged, and report exactly what",
                "a person would have to change:",
                ...humanActionRequired.map((action) => `  - ${action}`),
              ]
            : []),
        ].join("\n"),
  };
}

/**
 * A reserved final response is never allowed to reopen the tool loop. This is
 * provider-agnostic because inexpensive models may emit a tool call even when
 * the request deliberately omitted the tool schema.
 */
export function sanitizeToolsDisabledFinal(
  result: { content?: unknown; tool_calls?: unknown },
  fallbackContent: string,
): ToolsDisabledFinalResult {
  const rawContent =
    typeof result.content === "string" ? result.content.trim() : "";
  const ignoredToolCalls = Array.isArray(result.tool_calls)
    ? result.tool_calls.length
    : 0;
  const looksLikeRawToolJson =
    ignoredToolCalls > 0 &&
    (rawContent.startsWith("{") || rawContent.startsWith("["));
  const content = looksLikeRawToolJson ? "" : rawContent;
  return {
    content: content || fallbackContent,
    ignoredToolCalls,
    usedFallback: content.length === 0,
  };
}

/** Keep transport completion and persisted contract status aligned. */
export function finalizeRunOutcome(
  status: RunTerminalStatus,
  contract: Record<string, unknown>,
): FinalRunOutcome {
  const effectiveStatus =
    status === "completed" && contract.satisfied !== true
      ? "contract-unmet"
      : status;
  if (effectiveStatus === "completed") {
    return {
      status: effectiveStatus,
      emitDone: true,
      contract: { ...contract, terminalStatus: effectiveStatus },
    };
  }
  return {
    status: effectiveStatus,
    // Partial/max-turn responses still need a terminal SSE frame so the client
    // can persist their explicit non-success status and final explanation.
    emitDone: effectiveStatus !== "timed-out",
    contract: {
      ...contract,
      satisfied: false,
      terminalStatus: effectiveStatus,
    },
  };
}
