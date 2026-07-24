/**
 * tool-dispatch.ts — side-effect classification and ordered batch dispatch.
 *
 * Why this exists
 * ---------------
 * When a model returns several tool calls in one turn, the chat loop used to
 * await them one at a time. A turn that inspects topology, cohomology and SOC
 * pays three sequential round trips against the *same* immutable post-cycle
 * engine state — pure loss.
 *
 * Parallel dispatch is only safe if the scheduler respects what each call does
 * to shared state ("Side-Effect Classification", arXiv:2604.11378 §4.5): a
 * read-only call may be dispatched speculatively alongside others; a call that
 * mutates the concept graph may not.
 *
 * AGEM's shared mutable state is the engine itself (TNA graph, LCM, SOC
 * history, scenario run). So:
 *
 *   pure      — reads engine state or computes from it, writes nothing.
 *   mutating  — advances the graph, the agent pool, the scenario run, or disk.
 *
 * Unknown tools default to `mutating`. That is the conservative direction: the
 * cost of misclassifying a read as a write is a little latency, the cost of
 * misclassifying a write as a read is a corrupted graph.
 *
 * Ordering guarantee
 * ------------------
 * The batch is executed as a sequence of waves. Consecutive pure calls form
 * one parallel wave; every mutating call is a wave of its own. Relative order
 * between reads and writes is therefore preserved — `run_agem_cycle` followed
 * by `get_cohomology` still reads post-cycle state — while independent reads
 * still overlap. Results are always returned in the original call order,
 * regardless of completion order, so chat history stays deterministic.
 */

export type SideEffect = "pure" | "mutating";

/**
 * Read-only AGEM tools. Each of these reads engine state (or derives from it)
 * without advancing the graph, spawning agents, or writing to disk.
 */
export const PURE_TOOLS: ReadonlySet<string> = new Set([
  "get_agem_state",
  "get_cohomology",
  "get_graph_topology",
  "get_soc_metrics",
  "detect_gaps",
  "generate_catalyst_questions",
  "search_context",
  "read_skill",
  "list_scenarios",
  "load_scenario",
  "list_mcp_servers",
  "list_server_tools",
  // Computes logic-based H⁰/H¹ over agent-supplied blocks via mcp-logic.
  // Reads no engine state and writes none — the blocks come from the model.
  "evaluate_logical_consistency",
]);

/**
 * MCP tools known to be side-effect free, as `server/tool`.
 *
 * Deliberately a short allowlist of *verified* pure tools rather than a guess
 * about MCP servers in general. mcp-logic wraps Prover9/Mace4, which are pure
 * functions of their input formulas.
 */
export const PURE_MCP_TOOLS: ReadonlySet<string> = new Set([
  "mcp-logic/prove",
  "mcp-logic/find_counterexample",
  "mcp-logic/check_well_formed",
]);

/** Resolve `server/tool` for either MCP calling convention, else null. */
export function resolveMcpTarget(
  fnName: string,
  args: Record<string, unknown>,
): string | null {
  if (fnName === "call_mcp_tool") {
    const server = String(args.server_name ?? args.server ?? "").replace(/^:/, "");
    const tool = String(args.tool_name ?? args.tool ?? "");
    return server && tool ? `${server}/${tool}` : null;
  }
  if (fnName.startsWith("mcp__")) {
    const parts = fnName.split("__");
    const server = parts[1] ?? "";
    const tool = parts.slice(2).join("__");
    return server && tool ? `${server}/${tool}` : null;
  }
  return null;
}

/**
 * sideEffectClass(fnName, args) — classify one tool call.
 *
 * Unknown ⇒ mutating. See the module header for why that default is the safe
 * one.
 */
export function sideEffectClass(
  fnName: string,
  args: Record<string, unknown> = {},
): SideEffect {
  if (PURE_TOOLS.has(fnName)) return "pure";
  const mcpTarget = resolveMcpTarget(fnName, args);
  if (mcpTarget && PURE_MCP_TOOLS.has(mcpTarget)) return "pure";
  return "mutating";
}

/**
 * Mutating tools whose repetition leaves the same state — safe to retry.
 *
 * Everything else that mutates is NOT retry-safe. This matters more than it
 * looks: `run_agem_cycle` ingests text into a persistent, accumulating graph,
 * so a blind retry after a transient fault would pile the same co-occurrences
 * on twice and degrade modularity — the exact failure the system prompt warns
 * the model about. An automatic retry that silently corrupts the graph is
 * worse than an escalation.
 */
export const IDEMPOTENT_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "reset_agem_engine", // resetting twice == resetting once
  "create_skill", // writes the same file
  "generate_scenario", // writes the same scenario id
]);

/**
 * isRetrySafe — may the engine repeat this call unchanged, without telling
 * the model? ("Idempotent nodes for retry-safe execution", §9.10.)
 *
 * Pure calls are idempotent by definition. Mutating calls are retry-safe only
 * if explicitly listed. MCP calls are never blind-retried unless the target is
 * on the verified pure allowlist, because we cannot know whether the side
 * effect landed before the transport failed.
 */
export function isRetrySafe(
  fnName: string,
  args: Record<string, unknown> = {},
): boolean {
  if (sideEffectClass(fnName, args) === "pure") return true;
  return IDEMPOTENT_MUTATING_TOOLS.has(fnName);
}

export interface DispatchWave<C> {
  kind: SideEffect;
  /** Original indices of the calls in this wave, in order. */
  indices: number[];
  calls: C[];
}

/**
 * planWaves(calls, classify) — split a batch into ordered execution waves.
 *
 * Exported separately from `dispatchBatch` so the scheduling decision can be
 * asserted in tests without executing anything.
 */
export function planWaves<C>(
  calls: readonly C[],
  classify: (call: C, index: number) => SideEffect,
): DispatchWave<C>[] {
  const waves: DispatchWave<C>[] = [];
  let pending: DispatchWave<C> | null = null;

  calls.forEach((call, index) => {
    const kind = classify(call, index);
    if (kind === "mutating") {
      if (pending) {
        waves.push(pending);
        pending = null;
      }
      waves.push({ kind, indices: [index], calls: [call] });
      return;
    }
    if (!pending) pending = { kind: "pure", indices: [], calls: [] };
    pending.indices.push(index);
    pending.calls.push(call);
  });

  if (pending) waves.push(pending);
  return waves;
}

export interface DispatchOptions<C> {
  classify: (call: C, index: number) => SideEffect;
  /** Upper bound on simultaneous in-flight pure calls. */
  maxConcurrency?: number;
  /** Called once per wave, before it runs — used for progress events. */
  onWave?: (wave: DispatchWave<C>, waveIndex: number) => void;
}

/**
 * dispatchBatch — run a batch of tool calls, parallelising only where safe.
 *
 * `exec` must resolve rather than reject (wrap it in the recovery protocol);
 * a rejection here would abort sibling calls in the same wave.
 *
 * @returns results indexed by ORIGINAL call position.
 */
export async function dispatchBatch<C, R>(
  calls: readonly C[],
  exec: (call: C, index: number) => Promise<R>,
  options: DispatchOptions<C>,
): Promise<R[]> {
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 4);
  const waves = planWaves(calls, options.classify);
  const results = new Array<R>(calls.length);

  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    options.onWave?.(wave, w);

    if (wave.kind === "mutating") {
      const index = wave.indices[0];
      results[index] = await exec(wave.calls[0], index);
      continue;
    }

    // Pure wave: run in bounded-size slices so a model that emits twenty
    // reads at once cannot open twenty concurrent Prover9 processes.
    for (let start = 0; start < wave.calls.length; start += maxConcurrency) {
      const sliceIdx = wave.indices.slice(start, start + maxConcurrency);
      const sliceCalls = wave.calls.slice(start, start + maxConcurrency);
      const settled = await Promise.all(
        sliceCalls.map((call, k) => exec(call, sliceIdx[k])),
      );
      settled.forEach((value, k) => {
        results[sliceIdx[k]] = value;
      });
    }
  }

  return results;
}
