export interface ToolBudgetOptions {
  extractionMinimumMs: number;
  /** Duration of a successful equivalent call earlier in this request. */
  previousDurationMs?: number;
  /** Budget protected for the final tools-disabled response. */
  finalizationReserveMs?: number;
}

export type ToolBudgetDecision =
  | {
      allowed: true;
      status: "admitted";
      remainingMs: number;
      requiredMs: number;
    }
  | {
      allowed: false;
      status: "deferred-insufficient-request-budget";
      remainingMs: number;
      requiredMs: number;
      message: string;
    };

/**
 * Prevent a long semantic-verification phase from starting when only the tail
 * of the enclosing request remains. Engine state is persisted, so deferral is
 * recoverable; an abort halfway through extraction is not useful work.
 */
export function assessToolBudget(
  toolName: string,
  remainingMs: number,
  options: ToolBudgetOptions,
): ToolBudgetDecision {
  const boundedRemaining = Math.max(0, Math.floor(remainingMs));
  const measuredDuration = Math.max(
    0,
    Math.floor(options.previousDurationMs ?? 0),
  );
  const finalizationReserve = Math.max(
    0,
    Math.floor(options.finalizationReserveMs ?? 0),
  );
  const requiredMs =
    toolName === "extract_and_verify_claims"
      ? measuredDuration > 0
        ? Math.ceil(measuredDuration * 1.25) + finalizationReserve
        : Math.max(0, Math.floor(options.extractionMinimumMs))
      : 0;

  if (requiredMs > 0 && boundedRemaining < requiredMs) {
    const remainingSeconds = Math.ceil(boundedRemaining / 1000);
    const requiredSeconds = Math.ceil(requiredMs / 1000);
    return {
      allowed: false,
      status: "deferred-insufficient-request-budget",
      remainingMs: boundedRemaining,
      requiredMs,
      message:
        `${toolName} deferred: ${remainingSeconds}s remain in this request; ` +
        `at least ${requiredSeconds}s are required. Start a new request to ` +
        "continue verification from the persisted engine state.",
    };
  }

  return {
    allowed: true,
    status: "admitted",
    remainingMs: boundedRemaining,
    requiredMs,
  };
}
