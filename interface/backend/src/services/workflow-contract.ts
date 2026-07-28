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
  /**
   * Reports whether the typed-claim path can run at all. The `derive`
   * requirement is suppressed when it cannot, so a claim store that is down
   * never produces a demand the model is unable to satisfy.
   *
   * Defaults to "unavailable", matching the rule the rest of this file follows:
   * when the system cannot confirm a requirement is satisfiable, it does not
   * manufacture it.
   */
  isClaimStoreAvailable?: () => boolean;
  /**
   * Size of the material the user supplied this run. A pasted corpus activates
   * the contract even before the model has touched the engine; a one-line
   * command does not. See `#isAnalysisRun`.
   */
  materialChars?: number;
  /** Minimum user-message size that counts as "a corpus was supplied". */
  materialThreshold?: number;
  /** Maximum number of nudges per run. */
  maxNudges?: number;
  /** Disable contract nudging entirely (falls back to "model decides"). */
  enabled?: boolean;
}

/**
 * Tools whose use means "this run is doing analysis".
 *
 * Deliberately excludes maintenance and status calls — `reset_agem_engine`,
 * `get_agem_state`, `list_mcp_servers`, `read_skill`. Resetting the engine is
 * not an analysis, and a run that only resets has nothing to ingest.
 */
const ANALYSIS_SURFACE = new Set([
  "run_agem_cycle",
  "run_agem_cycles_sectioned",
  "get_graph_topology",
  "get_cohomology",
  "get_soc_metrics",
  "detect_gaps",
  "generate_catalyst_questions",
  "search_context",
  "evaluate_logical_consistency",
  "extract_and_verify_claims",
  "mcp-logic/prove",
  "mcp-logic/find_counterexample",
]);

const INGEST_TOOLS = ["run_agem_cycle", "run_agem_cycles_sectioned"] as const;

/** Tool names that satisfy the "verify logical consistency" requirement. */
const LOGIC_TOOLS = new Set([
  "evaluate_logical_consistency",
  "extract_and_verify_claims",
  "mcp-logic/prove",
  "mcp-logic/find_counterexample",
]);

/**
 * The one tool that derives the logic from typed, provenance-bearing claims
 * instead of from model-authored propositions.
 *
 * Why this earns its own requirement: `evaluate_logical_consistency` accepts
 * whatever formulas the model writes, and on a contested corpus the model
 * tends to skip the corpus's own entities entirely. Observed on the
 * origin-of-the-genetic-code run: five positions were each encoded as ground
 * atoms over a single constant — `arbitrary(code)`, `-arbitrary(code)` — so the
 * prover was asked to confirm that labels the model had already chosen in prose
 * negate each other. It did, soundly, and the result was near-tautological. The
 * corpus's codons, amino acids and assignments never entered the logic.
 *
 * That is the same failure the typed-claim path exists to remove: freehand
 * encodings of one corpus have produced different verdicts across runs.
 */
const TYPED_CLAIM_TOOL = "extract_and_verify_claims";

export class WorkflowContract {
  readonly #counts = new Map<string, number>();
  readonly #nudgedSignatures = new Set<string>();
  readonly #options: Required<WorkflowContractOptions>;
  #nudgeCount = 0;

  constructor(options: WorkflowContractOptions) {
    this.#options = {
      maxNudges: 2,
      enabled: true,
      materialChars: 0,
      materialThreshold: 600,
      isClaimStoreAvailable: () => false,
      ...options,
    };
  }

  /**
   * Is this run an analysis at all?
   *
   * The contract validates HOW an analysis was done, not whether the user
   * wanted one. "Use reset_agem_engine to reset to a clean state" is a
   * maintenance command: there is no corpus, and demanding an ingest forces
   * the model into an extra round trip to re-explain that it has nothing to
   * ingest. (Observed: run 2026-07-24T23-08-48 — a 73-character command took
   * three turns because the contract nudged a run that had no material.)
   *
   * Two activation signals, both deterministic:
   *   1. The model touched the analysis surface.
   *   2. The user supplied enough text to be a corpus.
   * Neither ⇒ the contract stays dormant and the model decides when it is done.
   */
  #isAnalysisRun(): boolean {
    if (this.#options.materialChars >= this.#options.materialThreshold) {
      return true;
    }
    for (const tool of ANALYSIS_SURFACE) {
      if (this.count(tool) > 0) return true;
    }
    return false;
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
    const analysisRun = this.#isAnalysisRun();
    const ranCycle = INGEST_TOOLS.some((tool) => this.count(tool) > 0);
    const contested = analysisRun && ranCycle && this.#safeIsContested();
    const logicRuns = [...LOGIC_TOOLS].reduce(
      (sum, name) => sum + this.count(name),
      0,
    );
    const typedClaimsPossible = this.#safeClaimStoreAvailable();

    const items: ContractItem[] = [
      {
        id: "ingest",
        requirement: "At least one AGEM cycle or sectioned corpus run",
        hint: "You have not ingested the material into the graph yet — call run_agem_cycle for one conceptual section, or run_agem_cycles_sectioned for a structured corpus.",
        satisfied: ranCycle,
        applicable: analysisRun,
      },
      {
        id: "inspect",
        requirement: "At least one get_graph_topology",
        hint: "You have not inspected the graph — call get_graph_topology to see the concept communities and bridges before answering.",
        satisfied: this.count("get_graph_topology") > 0,
        applicable: analysisRun,
      },
      {
        id: "verify",
        requirement:
          "Logical consistency verified for a multi-position corpus",
        hint: "The graph resolved into two or more concept communities, so this corpus is multi-position. Verify the relations between those blocks formally — extract_and_verify_claims is the preferred path — before making any claim about consistency or contradiction.",
        satisfied: logicRuns > 0,
        applicable: contested,
      },
      {
        /*
         * Separate from `verify` on purpose. Making the typed path the ONLY
         * way to satisfy verification would make the run unsatisfiable
         * whenever the claim store is down, burning both nudges on something
         * the model cannot do. So a hand-authored check still counts as
         * verification, and this item raises the encoding question on its own.
         */
        id: "derive",
        requirement:
          "Logic derived from typed claims, not authored freehand",
        hint:
          "You verified with hand-authored propositions. On a multi-position corpus those are the model's paraphrase, not the corpus's claims — a contradiction between them can be an artifact of your own encoding. Run extract_and_verify_claims on the corpus TEXT so the formulas are derived from typed claims with provenance, and reconcile the two results. If the claim store is unavailable, say so explicitly and label the hand-authored verdict as encoding-dependent.",
        satisfied: this.count(TYPED_CLAIM_TOOL) > 0,
        applicable: contested && typedClaimsPossible,
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

  /** Never demand the typed path when the claim store cannot serve it. */
  #safeClaimStoreAvailable(): boolean {
    try {
      return this.#options.isClaimStoreAvailable();
    } catch {
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
      analysisRun: this.#isAnalysisRun(),
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
