/**
 * workflow-contract.ts — an output contract κ for a chat run.
 *
 * What it replaces
 * ----------------
 * The chat loop used to decide whether the model had finished with:
 *
 *     const MIN_TURNS_BEFORE_DONE = 4;
 *     if (turnCount < MIN_TURNS_BEFORE_DONE && !nudgeSent) { ...inject nudge... }
 *
 * Turn count is a proxy for nothing. A model that runs the whole workflow in
 * three turns got nudged spuriously; a model that burned five turns doing
 * nothing at all was let through. The nudge itself then rewrote the trajectory
 * mid-run — a plan mutation fired on a signal unrelated to the plan.
 *
 * This module replaces the proxy with the real thing: a checkable contract
 * over what the run actually did ("contract validation", arXiv:2604.11378
 * §6.1). The run is complete when every applicable requirement is satisfied,
 * and the nudge — when it fires — names the specific missing item instead of
 * reciting the whole workflow.
 *
 * Boundedness
 * -----------
 * Nudging is capped two ways, so this cannot become the unbounded-recovery
 * pathology it is meant to remove:
 *
 *   1. `maxNudges` total (default 2).
 *   2. The same unmet set is never nudged twice. If the model was told what
 *      was missing and did not act, telling it again is not recovery, it is a
 *      loop.
 *
 * Contested-topic detection
 * -------------------------
 * The system prompt requires formal-logic verification for "contested or
 * multi-position topics". Rather than keyword-matching the user's message,
 * this asks the engine: a graph that resolved into two or more concept
 * communities *is* a multi-position corpus by AGEM's own measure. That keeps
 * the trigger deterministic and grounded in a signal the system already
 * computes, instead of a guess about prose.
 */

export interface ContractItem {
  id: string;
  /** What the run must contain. */
  requirement: string;
  /** Instruction handed to the model when this item is unmet. */
  hint: string;
  satisfied: boolean;
  /** Whether this requirement applies to this run at all. */
  applicable: boolean;
}

export interface ContractEvaluation {
  satisfied: boolean;
  unmet: ContractItem[];
  items: ContractItem[];
}

export interface WorkflowContractOptions {
  /**
   * Reports whether the corpus is multi-position, i.e. whether logical
   * consistency must be verified. Called lazily at evaluation time so it sees
   * post-cycle engine state.
   */
  isContested: () => boolean;
  /** Maximum number of nudges per run. */
  maxNudges?: number;
  /** Disable contract nudging entirely (falls back to "model decides"). */
  enabled?: boolean;
}

/** Tool names that satisfy the "verify logical consistency" requirement. */
const LOGIC_TOOLS = new Set([
  "evaluate_logical_consistency",
  "mcp-logic/prove",
  "mcp-logic/find_counterexample",
]);

export class WorkflowContract {
  readonly #counts = new Map<string, number>();
  readonly #nudgedSignatures = new Set<string>();
  readonly #options: Required<WorkflowContractOptions>;
  #nudgeCount = 0;

  constructor(options: WorkflowContractOptions) {
    this.#options = {
      maxNudges: 2,
      enabled: true,
      ...options,
    };
  }

  /**
   * Record an executed tool call.
   *
   * `label` is the resolved `server/tool` for MCP calls, so a proof run through
   * `call_mcp_tool` counts the same as one run through `mcp__mcp-logic__prove`.
   * Failed calls must NOT be recorded — a contract satisfied by a tool that
   * errored is not satisfied.
   */
  record(fnName: string, label?: string): void {
    this.#bump(fnName);
    if (label && label !== fnName) this.#bump(label);
  }

  #bump(key: string): void {
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + 1);
  }

  count(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /** Evaluate κ against what the run has done so far. */
  evaluate(): ContractEvaluation {
    const ranCycle = this.count("run_agem_cycle") > 0;
    const contested = ranCycle && this.#safeIsContested();
    const logicRuns = [...LOGIC_TOOLS].reduce(
      (sum, name) => sum + this.count(name),
      0,
    );

    const items: ContractItem[] = [
      {
        id: "ingest",
        requirement: "At least one run_agem_cycle",
        hint: "You have not ingested the material into the graph yet — call run_agem_cycle with the text to analyse.",
        satisfied: ranCycle,
        applicable: true,
      },
      {
        id: "inspect",
        requirement: "At least one get_graph_topology",
        hint: "You have not inspected the graph — call get_graph_topology to see the concept communities and bridges before answering.",
        satisfied: this.count("get_graph_topology") > 0,
        applicable: true,
      },
      {
        id: "verify",
        requirement:
          "Logical consistency verified for a multi-position corpus",
        hint: "The graph resolved into two or more concept communities, so this corpus is multi-position. Verify the relations between those blocks with evaluate_logical_consistency before making any claim about consistency or contradiction.",
        satisfied: logicRuns > 0,
        applicable: contested,
      },
    ];

    const unmet = items.filter((i) => i.applicable && !i.satisfied);
    return { satisfied: unmet.length === 0, unmet, items };
  }

  #safeIsContested(): boolean {
    try {
      return this.#options.isContested();
    } catch {
      // If the engine cannot answer, do not manufacture a requirement.
      return false;
    }
  }

  /**
   * The nudge to inject, or null when the run may finish.
   *
   * Returns null when the contract is satisfied, when nudging is disabled,
   * when the nudge budget is spent, or when this exact unmet set has already
   * been raised once.
   */
  nudge(): string | null {
    if (!this.#options.enabled) return null;
    const { satisfied, unmet } = this.evaluate();
    if (satisfied) return null;
    if (this.#nudgeCount >= this.#options.maxNudges) return null;

    const signature = unmet.map((i) => i.id).sort().join(",");
    if (this.#nudgedSignatures.has(signature)) return null;

    this.#nudgedSignatures.add(signature);
    this.#nudgeCount++;

    const lines = unmet.map((i, n) => `${n + 1}. ${i.hint}`);
    return (
      "[SYSTEM] Before you finish, the following required step" +
      (unmet.length === 1 ? " has" : "s have") +
      " not been completed:\n" +
      lines.join("\n") +
      "\nComplete " +
      (unmet.length === 1 ? "it" : "them") +
      " now, then write your answer. If a tool failed, say so explicitly and proceed — do not fabricate its result."
    );
  }

  /** Whether a nudge was ever issued (for the run-log summary). */
  get nudgeCount(): number {
    return this.#nudgeCount;
  }

  /** Compact summary for the run log / diagnostic context. */
  summary(): Record<string, unknown> {
    const { satisfied, items } = this.evaluate();
    return {
      satisfied,
      nudges: this.#nudgeCount,
      items: items.map((i) => ({
        id: i.id,
        applicable: i.applicable,
        satisfied: i.satisfied,
      })),
      toolCounts: Object.fromEntries(this.#counts),
    };
  }
}

export function createWorkflowContract(
  options: WorkflowContractOptions,
): WorkflowContract {
  return new WorkflowContract(options);
}
