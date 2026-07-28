export type RunTerminalStatus = "completed" | "timed-out";

export interface FinalRunOutcome {
  emitDone: boolean;
  contract: Record<string, unknown>;
}

/** Keep transport completion and persisted contract status aligned. */
export function finalizeRunOutcome(
  status: RunTerminalStatus,
  contract: Record<string, unknown>,
): FinalRunOutcome {
  if (status === "completed") {
    return { emitDone: true, contract: { ...contract, terminalStatus: status } };
  }
  return {
    emitDone: false,
    contract: { ...contract, satisfied: false, terminalStatus: status },
  };
}
