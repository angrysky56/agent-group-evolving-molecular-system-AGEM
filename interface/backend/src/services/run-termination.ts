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
