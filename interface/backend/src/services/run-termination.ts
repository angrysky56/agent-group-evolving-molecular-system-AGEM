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
  return {
    reason,
    fallbackContent: [
      "INCONCLUSIVE — typed claim verification did not produce a validated corpus verdict.",
      verdict,
      "No hand-authored proof is a substitute for the failed provenance-bearing path.",
    ].join("\n\n"),
    instruction: [
      "Typed claim verification is inconclusive. Do not call or request more tools.",
      "Write the final user-facing response now and label it INCONCLUSIVE.",
      "Name the actual reported failure causes. Do not substitute or present hand-authored logic as corpus evidence.",
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
