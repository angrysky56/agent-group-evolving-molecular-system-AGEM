/**
 * Chat API Routes.
 *
 * Handles chat completions with SSE streaming, integrating
 * the LLM provider and session persistence.
 */

import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import type {
  ChatMessage,
  ChatRequest,
  RunIntent,
} from "../../../shared/types.js";
import { createProvider } from "../services/llm.js";
import { sessionStore } from "../services/session-store.js";
import { agemBridge } from "../services/agem-bridge.js";
import { knowledgeBase } from "../services/knowledge-base.js";
import { skillRegistry } from "../services/skills.js";
import { mcpManager } from "../services/mcp.js";
import { scenarioService } from "../services/scenarios.js";
import {
  computeLogicalCohomology,
  configuredCohomologyOptions,
  makeMcpLogicOracle,
  normalizePropertyPredication,
  summarizeCheckLog,
  type LogicalCohomologyOptions,
} from "../services/logicalCohomology.js";
import { readCheckLog } from "../services/check-log-reader.js";
import { claimStore } from "../services/typedb-claims.js";
import {
  extractIntoStore,
} from "../services/claim-extractor.js";
import {
  classifyClaimVerdict,
  deriveClaimBlocks,
} from "../services/claim-blocks.js";
import {
  applyExtractionCoverage,
  extractionFailureCauses,
  inconclusiveExtractionVerdict,
  inconclusiveFormalizationVerdict,
} from "../services/extraction-verdict.js";
import { proposeExtractionRepairs } from "../services/extraction-repairs.js";
import {
  executeAbductiveLeap,
  hypothesisId,
  leapsOfFaith,
  predicateSymbols,
  type AnomalySource,
  type Hypothesis,
  type Observation,
  type ProofOracle,
} from "../services/abductive-engine.js";
import {
  constructClaim,
  DisconfirmingSearchRequired,
  type CandidateStatement,
  type ClaimCertainty,
  type ClaimScope,
  type DisconfirmingSearch,
} from "../services/defensible-claim.js";
import { ProviderEmbedder } from "../services/provider-embedder.js";
import { segmentText } from "#agem/tna/CooccurrenceGraph.js";
import { createRunLogger } from "../services/run-logger.js";
import {
  findingNarrativeDensifier,
  findingStore,
} from "../services/run-memory.js";
import {
  attachFindingMemory,
  captureEvidentialFindingFromTool,
  captureFindingFromTool,
  captureFindingNarrativeFromTool,
  currentVerificationDependencyOverrides,
  formatRecallContext,
} from "../services/finding-capture.js";
import type { DensificationResult } from "../services/finding-narrative.js";
import { RecoveryProtocol } from "../services/recovery-protocol.js";
import {
  dispatchBatch,
  isRetrySafe,
  sideEffectClass,
} from "../services/tool-dispatch.js";
import {
  createWorkflowContract,
  toolNamesForUnmetWorkflow,
  workflowToolOutcomeFromOutput,
} from "../services/workflow-contract.js";
import {
  createRequestDeadline,
  ToolRequestDeadlineError,
} from "../services/request-deadline.js";
import { assessToolBudget } from "../services/tool-budget.js";
import {
  explicitlyRequestedMcpServers,
  shouldExposeMcpMetaTools,
  unwrapNestedToolArguments,
} from "../services/mcp-tool-activation.js";
import {
  finalizeRunOutcome,
  sanitizeToolsDisabledFinal,
  typedVerificationFinalization,
  type TypedVerificationFinalization,
  type RunTerminalStatus,
} from "../services/run-termination.js";
import {
  annotateArtifactOutput,
  normalizeRunIntent,
  toolNamesForRunIntent,
} from "../services/artifact-contract.js";
import {
  RUN_AGEM_CYCLE_DESCRIPTION,
  RUN_SECTIONED_CYCLES_DESCRIPTION,
  planSectionedIngestion,
} from "../services/sectioned-ingestion.js";
import { settings } from "../config.js";
import { compress } from "headroom-ai";

export const chatRouter = Router();

const claimBlockEmbedder = new ProviderEmbedder();

// Helper to neutralize user-provided inputs to prevent log forgery/injection
function sanitizeLog(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\r\n]/g, "_");
}

// ─── MCP Tool Parameter Normalization ───
// Models using call_mcp_tool frequently guess wrong parameter names.
// This maps common mistakes to correct names for known MCP tools.
function normalizeMcpToolArgs(
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const s = server.replace(/^:/, ""); // strip leading colon if present
  const key = `${s}/${tool}`;
  const original = JSON.stringify(args);
  const unwrapped = unwrapNestedToolArguments(args);
  let normalized = unwrapped !== args;
  args = unwrapped;

  switch (key) {
    // hipai-montague
    case "hipai-montague/add_belief":
      if (!args.text && (args.belief || args.statement || args.content)) {
        args.text = args.belief ?? args.statement ?? args.content;
        delete args.belief;
        delete args.statement;
        delete args.content;
        normalized = true;
      }
      break;
    case "hipai-montague/evaluate_hypothesis":
      if (!args.hypothesis && (args.claim || args.text || args.statement)) {
        args.hypothesis = args.claim ?? args.text ?? args.statement;
        delete args.claim;
        delete args.text;
        delete args.statement;
        normalized = true;
      }
      break;

    // conscience-servitor
    case "conscience-servitor/triage":
      if (!args.content && (args.text || args.prompt || args.message)) {
        args.content = args.text ?? args.prompt ?? args.message;
        delete args.text;
        delete args.prompt;
        delete args.message;
        normalized = true;
      }
      break;
    case "conscience-servitor/evaluate":
      delete args.context;
      if (args.claims && typeof args.claims === "string") {
        args.claims = [args.claims as string];
        normalized = true;
      }
      break;

    case "aseke-compass/analyze_behavior":
      if (!args.description && (args.behavior || args.text || args.pattern)) {
        args.description = args.behavior ?? args.text ?? args.pattern;
        delete args.behavior;
        delete args.text;
        delete args.pattern;
        normalized = true;
      }
      break;

    case "advanced-reasoning/advanced_reasoning":
      if (!args.thought && (args.text || args.reasoning || args.content)) {
        args.thought = args.text ?? args.reasoning ?? args.content;
        delete args.text;
        delete args.reasoning;
        delete args.content;
        normalized = true;
      }
      if (!args.thoughtNumber) {
        args.thoughtNumber = 1;
        normalized = true;
      }
      if (!args.totalThoughts) {
        args.totalThoughts = 1;
        normalized = true;
      }
      if (args.nextThoughtNeeded === undefined) {
        args.nextThoughtNeeded = false;
        normalized = true;
      }
      break;

    case "mcp-logic/prove":
      if (!args.conclusion && args.goal) {
        args.conclusion = args.goal;
        delete args.goal;
        normalized = true;
      }
      // Fall through to the shared formula normalization below.
    case "mcp-logic/check_well_formed":
    case "mcp-logic/find_counterexample": {
      for (const field of ["statements", "premises"] as const) {
        if (!Array.isArray(args[field])) continue;
        const formulas = (args[field] as unknown[]).map((value) =>
          typeof value === "string"
            ? normalizePropertyPredication(value)
            : value,
        );
        if (JSON.stringify(formulas) !== JSON.stringify(args[field])) {
          args[field] = formulas;
          normalized = true;
        }
      }
      if (typeof args.conclusion === "string") {
        const conclusion = normalizePropertyPredication(args.conclusion);
        if (conclusion !== args.conclusion) {
          args.conclusion = conclusion;
          normalized = true;
        }
      }
      break;
    }
  }

  if (normalized) {
    console.log(
      `[Chat] Normalized MCP args for ${key}: ${original} → ${JSON.stringify(args)}`,
    );
  }

  return args;
}
/**
 * POST /chat/completions
 *
 * Stream a chat completion via SSE.
 * Accepts a message and optional session_id, model, and provider.
 * Streams token, thinking, and usage events back to the client.
 */
chatRouter.post("/completions", async (req, res) => {
  const body = req.body as ChatRequest;
  const { message, model, provider: providerType } = body;
  const runIntent = normalizeRunIntent(body.intent);
  let sessionId = body.session_id;

  console.log(
    `[Chat] Request: model=${sanitizeLog(model)}, provider=${sanitizeLog(providerType)}, msg="${sanitizeLog(message?.slice(0, 60))}..."`,
  );

  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const abortController = new AbortController();
  const requestStartTime = Date.now();
  const requestDeadline = createRequestDeadline(
    settings.all.CHAT_REQUEST_TIMEOUT_MS,
    abortController.signal,
  );
  let terminalStatus: RunTerminalStatus = "completed";
  res.on("close", () => {
    if (!res.writableEnded) {
      console.log("[Chat] Client disconnected, aborting request...");
      abortController.abort();
    }
  });

  /** Helper to send an SSE event. */
  const sendEvent = (event: string, data: unknown): void => {
    lastWriteAt = Date.now();
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let timeoutEventSent = false;
  const markRequestTimedOut = (turnCount: number): void => {
    terminalStatus = "timed-out";
    if (timeoutEventSent) return;
    timeoutEventSent = true;
    const elapsedSeconds = Math.round((Date.now() - requestStartTime) / 1000);
    console.warn(
      `[Chat] Request timeout after ${turnCount} turns (${elapsedSeconds}s)`,
    );
    sendEvent("error", {
      message: `Request timed out after ${Math.round(settings.all.CHAT_REQUEST_TIMEOUT_MS / 1000)} seconds.`,
      status: terminalStatus,
    });
  };

  /*
   * Keep the response body alive during long tool calls.
   *
   * A tool can legitimately run for many minutes — extract_and_verify_claims
   * on a real corpus took 478s in one measured run — and nothing is written to
   * the stream while it does. HTTP clients treat that as a dead body: undici
   * (Node's fetch) aborts at a 300s body timeout by default, so the CLI died
   * with UND_ERR_BODY_TIMEOUT mid-analysis. The server carried on and wrote the
   * finding, but the client was gone before the write-up, and the report file
   * ended after two lines with no error in it.
   *
   * An SSE comment line (`: ...`) is ignored by every conformant parser, so
   * this costs nothing semantically and resets the read timer.
   */
  let lastWriteAt = Date.now();
  const HEARTBEAT_MS = 15_000;
  const heartbeat = setInterval(() => {
    if (Date.now() - lastWriteAt < HEARTBEAT_MS) return;
    lastWriteAt = Date.now();
    try {
      res.write(`: keepalive ${new Date().toISOString()}\n\n`);
    } catch {
      // The client is gone; the finally block clears this interval.
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  res.on("close", () => clearInterval(heartbeat));

  try {
    // Resolve or create session
    if (!sessionId) {
      const session = sessionStore.create({ model, provider: providerType });
      sessionId = session.id;
    }
    const memoryNamespace =
      body.memory_namespace?.trim() || `session:${sessionId}`;

    sendEvent("session", { session_id: sessionId });

    // Link engine state to this session for persistence
    if (agemBridge.getActiveSessionId() !== sessionId) {
      console.log(
        `[Chat] Session mismatch (loaded: ${sanitizeLog(agemBridge.getActiveSessionId())}, requested: ${sanitizeLog(sessionId)}) — restoring session state…`,
      );
      await agemBridge.loadSession(sessionId);
    }

    // Persist user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    sessionStore.addMessage(sessionId, userMessage);

    // Build message history for LLM context
    const session = sessionStore.get(sessionId);
    const historyMessages = [];

    // Resolve provider earlier to check for cache support
    let resolvedProvider = providerType ?? settings.getLLMConfig().provider;
    if (model) {
      if (model.startsWith("ollama:")) resolvedProvider = "ollama";
      else if (model.startsWith("openrouter:")) resolvedProvider = "openrouter";
      else if (model.startsWith("anthropic:")) resolvedProvider = "anthropic";
      else if (model.startsWith("minimax:")) resolvedProvider = "minimax";
    }

    const isCacheSupported = ["anthropic", "minimax"].includes(
      resolvedProvider ?? "",
    );
    const effectiveModel = String(
      model ?? settings.getLLMConfig(resolvedProvider).model,
    );

    // Create the run trace before recall so automatic memory activity is
    // auditable alongside cycle and tool activity.
    const runLog = createRunLogger({
      model: effectiveModel,
      provider: resolvedProvider,
      intent: runIntent,
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      message,
    });
    sendEvent("system", { content: `[run-log: ${runLog.runId}]` });

    // Cue, don't query: one embedding of the incoming material, a raw cosine
    // floor, then top-k. This happens before the model sees the prompt.
    let recalledFindingIds: string[] = [];
    let recalledContext: string | null = null;
    try {
      const revalidationAudit =
        await findingStore.auditVerificationDependencies(
          currentVerificationDependencyOverrides(),
          { limit: 100, memoryNamespace },
        );
      runLog.event("finding_revalidation_audit", { ...revalidationAudit });
      const recalled = await findingStore.recall(
        message,
        {
          memoryNamespace,
          signal: requestDeadline.signal,
        },
      );
      recalledFindingIds = recalled.map((match) => match.finding.id);
      recalledContext = formatRecallContext(recalled, effectiveModel);
      runLog.event("finding_recall", {
        cueChars: message.length,
        matches: recalled.map((match) => ({
          findingId: match.finding.id,
          similarity: match.similarity,
          conflictCandidates: match.conflicts.map((c) => c.id),
        })),
        memoryNamespace,
      });
    } catch (error) {
      // Long-term memory must degrade safely just as TypeDB does.
      runLog.event("finding_recall_error", {
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn("[Chat] Automatic finding recall unavailable:", error);
    }

    // Inject system prompt with all loaded skills
    const allSkills = Array.from(
      ["agem-expert"]
        .map((name) => skillRegistry.getSkill(name))
        .filter(Boolean)
        .map(
          (s) =>
            `\n--- ${s!.name.toUpperCase()} SKILL ---\n${s!.content}\n--- END ---`,
        ),
    ).join("\n");
    const skillContent = allSkills || "";

    historyMessages.push({
      role: "system",
      content: `You are AGEM, a reasoning engine built on text-network analysis and sheaf topology. Your own analytical substrate is the AGEM engine (the native tools below). You also have one external reasoning aid — formal logic — plus optional utility servers you only use when explicitly relevant.

# Run intent: ${runIntent}

Discovery outputs are hypotheses or candidates, never logical verdicts. Verification consumes source-grounded typed claims or explicitly audited formulas, never graph communities, embeddings, centrality, or sheaf values as evidence. In discover-then-verify mode, a discovery candidate must re-enter through typed extraction before it can become a verified finding.

# How AGEM works (so you interpret its outputs correctly)

Each cycle, the engine ingests text into a concept graph, detects communities, and computes metrics. Read these honestly — do not over-claim what they mean:

- **get_graph_topology** — the concept communities and the bridges between them. This is your richest signal: which ideas cluster, which clusters connect, where the structure is.
- **get_cohomology** — cohomology of the LCM subgraph-registry sheaf, NOT the concept graph. First read \`status\`: when it is \`not-computed\`, numeric topology fields are deliberately absent. When computed, H⁰ is a vector-space dimension rather than a count of semantic clusters. The former registry H¹ label is exposed only as \`cycle_topology_dimension\` / \`cycle_topology_present\`: it is created by embedding-similarity edges, exists on cycles even under full agreement, and is never a content obstruction or logical verdict.
- **get_soc_metrics** — VNE/EE/CDP and regime (nascent/stable/critical). A rough measure of how much the graph is still developing. Useful for pacing, not for truth.
- **detect_gaps / generate_catalyst_questions** — structural gaps between clusters and questions that would bridge them. Good for deciding what to explore next.

# Workflow

1. Use **run_agem_cycle** for one conceptual section, with a stable named \`subgraph\`. For a structured multi-section corpus, prefer **run_agem_cycles_sectioned**: it preserves authored section boundaries, advances SOC once per section, and computes one corpus-level sheaf result after the final section. A single unnamed cycle cannot produce registry-sheaf cohomology.
2. **A cycle only advances the graph if you feed it NEW, substantive content.** Running another cycle with no new text — or with a thin scrap, or by re-pasting the same material — does not progress the reasoning; it just piles duplicate co-occurrences on and degrades modularity. So run a second/third cycle ONLY when you genuinely have new material to add: your own synthesis so far, the answers to the catalyst questions, the next step of the argument, additional source text. To make the graph follow the reasoning forward, ingest the reasoning forward.
3. If you have nothing substantively new to add, do NOT run another cycle — instead inspect and reason over what is already there (steps 4–6).
4. Inspect with **get_graph_topology** (primary), then **get_cohomology** and **get_soc_metrics** as needed.
5. For a contested corpus, prefer **extract_and_verify_claims**, which preserves attributed positions. Use **evaluate_logical_consistency** only for already-audited hand-authored assertion contexts. Its result establishes consequences of the supplied formulas only; it is not evidence that the corpus entails those formulas and must never be described as confirmation of a corpus finding. Never use graph communities themselves as logical blocks.
6. Use **detect_gaps / generate_catalyst_questions** to decide what to probe next; if you pursue a question, feeding your exploration of it back into the relevant named subgraph via run_agem_cycle is exactly the kind of new material that makes another cycle worthwhile.
7. Write your answer from the actual tool outputs. Never describe a cycle, metric, agent, or proof you did not actually run — if a tool failed, say so and proceed without it.

# Cross-run finding memory is automatic

Before your first turn, the engine has already recalled semantically relevant findings (if any) using a cosine floor plus top-k. After a conclusive verification, the engine writes the finding automatically from the structured tool result. Do not spend a tool turn asking a memory service whether the corpus id was seen before, and do not rely on remembering to save a verdict yourself.

Recalled findings are context, not an agenda. Cite one you actually use with its exact \`[finding:<id>]\` marker. An opposite new verdict is not silently allowed to replace an old one: exact overlap between typed supporting claims creates a supersedes candidate in the tool result. Review candidates with list_finding_conflicts and resolve them explicitly with resolve_finding_conflict.

# Native AGEM tools (call directly)
- run_agem_cycle, run_agem_cycles_sectioned, get_agem_state, get_graph_topology, get_cohomology, get_soc_metrics
- evaluate_logical_consistency (minimal unsatisfiable sets — the real contradiction detector; read "frustrations", not H¹)
- get_check_log (drill into individual satisfiability checks; the digest in the result already gives exact counts, so call this only for a specific entry)
- extract_and_verify_claims (preferred typed-claim path for contested corpora)
- detect_gaps, generate_catalyst_questions, search_context
- list_finding_conflicts, resolve_finding_conflict
- spawn_agem_agent, reset_agem_engine, read_skill

# Formal verification (REQUIRED for contested/multi-position topics)
The graph cannot detect contradiction, entailment, or consistency — only formal logic can. For a raw corpus, call extract_and_verify_claims: it invokes mcp-logic internally after deriving attributed formulas. Do NOT replace a failed typed extraction with premises you author yourself. evaluate_logical_consistency is only for formulas the user or another audited process already supplied.

Required procedure for contested topics:
1. For raw text, call extract_and_verify_claims with the corpus text. It identifies assertion holders, validates typed roles, converts claims, runs formalization preflight, and invokes the prover.
2. Only for already-audited formulas, identify who asserts each claim and preserve those assertion-context blocks. Concept communities may help discovery but never define assertion contexts.
   **NEGATION MUST USE THE "-" OPERATOR.** Write "-travels(x)". NEVER encode negation in a predicate NAME — "not_travels(x)", "no_transfer(x)", "non_local(x)" are, to the prover, symbols with no relationship whatsoever to "travels(x)", so they can never contradict it. This is the single most common way this tool gets a meaningless answer: a set of formulas with no "-" anywhere is ALWAYS satisfiable (make every predicate true everywhere), so it will report "no contradiction" no matter what the text said.
   Blocks must also SHARE predicate symbols. If block A says "travels(capability)" and block B says "distribution_bound(policy)", nothing connects them. Use the same predicate for the same idea across blocks, and negate it where a block denies it.
   A contradiction is normally expressed by one block asserting P and another asserting -P, or by a conditional in one block whose antecedent the others satisfy — so if the text contains a conditional ("X only if Y", "if X then not Y"), ENCODE IT AS A CONDITIONAL. Dropping it usually destroys the tension.
   **EVERY BLOCK OF UNIVERSALS NEEDS AN EXISTENTIAL WITNESS.** "all x (capability(x) -> travels(x))" is TRUE when nothing is a capability, so a set of pure "all x (...)" formulas is satisfied by the empty world and can never contradict. Whenever you write "all x (P(x) -> ...)" and P is supposed to be non-empty, also assert "exists x (P(x))". This has produced a real false "no contradiction" on a corpus that contained two.
3. Call evaluate_logical_consistency only with those already-audited blocks. The engine runs every satisfiability check via mcp-logic for you. A model of the full set certifies every subset at once; an unsatisfiable full set triggers complete, monotone MUS enumeration unless a caller cap, budget, or undetermined oracle result prevents completion. A **minimal unsatisfiable set** is a set of blocks that cannot all be true together, but every proper subset of which can.
4. On the typed path, read \`verdictKind\`: \`position-contradiction\` and \`corpus-contradiction\` are contradictions in one assertion context; \`positions-incompatible\` means rival positions cannot jointly hold and does NOT make a survey corpus contradictory. On the hand-authored path, read \`frustrations\`, but report them only as consequences of analyst-supplied premises. They carry no evidential weight about what the source corpus says unless a separate attributed extraction validates those premises. Do NOT use H¹ as a verdict.
5. If "searchTruncated" is true, say so: no contradiction was found *up to the arity searched*, which is not the same as none existing. **Read "truncationNote"** — it says WHICH cap stopped the search. If it names a budget limit, "checksRequiredForNextLevel" is the exact 'maxChecks' that settles the question: call the tool again passing that value. Truncation is a setting, not a capability ceiling — never report it as "the tool cannot search further".
6. Report the frustrated sets whenever "hasContradiction" is true, and check "frustrationsComplete" plus "checkFailures". A found MUS remains evidence when enumeration is incomplete, but it is not proof that no additional MUS exists.
7. **If "resultIsVacuous" is true, the overall verdict is invalid.** With no contradiction, the encoding made "consistent" a foregone conclusion. If contradictions were found, the listed clashes remain evidence, but critical alias/arity defects can hide additional ones. Read "formalizationWarnings" and report the actual defects. On a typed-path failure, stop: do not substitute hand-authored proofs or spend more tool turns.

If and only if the user explicitly requests mcp-logic, you may call it directly for a one-off proof/counterexample:

Tools and EXACT argument shapes (verified — do not deviate):
- prove → arguments={"premises": ["all x (man(x) -> mortal(x))", "man(socrates)"], "conclusion": "mortal(socrates)"}
  Returns proved / unprovable. The field is "conclusion" (singular), NOT "goal".
- find_counterexample → arguments={"premises": [...], "conclusion": "..."}
  Finds a model where premises hold but conclusion fails. result="model_found" ⇒ the conclusion does NOT follow.
- check_well_formed → arguments={"statements": [...]}  — syntax-check formulas before proving.

Consistency check idiom: to test whether a set of claims can all be true together, call find_counterexample with the claims as "premises" and conclusion="$F". model_found ⇒ the set is CONSISTENT; no_model_found ⇒ the set is CONTRADICTORY.

SYNTAX RULES (these are where calls fail — follow exactly):
- "premises" is an ARRAY of strings, ONE formula per array element. NEVER put multiple statements in one string, and NEVER use newline characters inside a formula — a literal \\n will fail. Split into separate array elements instead.
- Operators are ASCII: -> (implies), <-> (iff), & (and), | (or), - (not).
- Quantifiers MUST be parenthesized: "all x (man(x) -> mortal(x))", "exists y (knows(y, socrates))".
- One predicate per fact; lowercase predicate and constant names. Properties
  are always predicates: write "lesion_adequate(fdt)", never
  "holds(fdt, lesion_adequate)". Attributed blocks already carry the holder;
  reifying the property inside holds is redundant and creates an arity-0/arity-1
  collision when that property is predicated elsewhere.
- If a call returns a validation error, fix the shape (usually: split newlines into array elements, or rename "goal"→"conclusion") and retry ONCE. Never fabricate a result.

# Utility servers (only if a task explicitly needs them)
Reachable via call_mcp_tool but NOT part of normal reasoning: fetch (web fetch), sqlite/memory (storage), desktop-commander, playwright, docker. Other servers listed by list_mcp_servers exist but are experimental — ignore them unless the user names one.

# Calling MCP tools
MCP discovery and invocation tools are exposed only when the user explicitly names a connected server. When exposed, use list_server_tools(server_name) before an unfamiliar call and put tool arguments inside the "arguments" object.
ALWAYS put tool arguments INSIDE the "arguments" object, and call list_server_tools FIRST if you are unsure of a tool's exact schema — do not guess argument names.

${skillContent}`,
      cache_control: isCacheSupported ? { type: "ephemeral" } : undefined,
    } as any);

    if (recalledContext) {
      historyMessages.push({ role: "system", content: recalledContext });
    }

    const messages = session?.messages ?? [userMessage];
    messages.forEach((m: any, idx) => {
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      if (m.name) msg.name = m.name;

      // Mark the 2nd to last message for caching if history is significant
      if (
        isCacheSupported &&
        idx === messages.length - 2 &&
        messages.length > 5
      ) {
        msg.cache_control = { type: "ephemeral" };
      }
      historyMessages.push(msg);
    });

    // Get API key from request headers (for OpenRouter)
    const apiKey =
      req.headers["authorization"]?.toString().replace("Bearer ", "") ??
      req.headers["x-openrouter-key"]?.toString() ??
      req.headers["x-api-key"]?.toString();

    const isOllama = resolvedProvider === "ollama";

    // Setup Tools
    const mcpTools = await mcpManager.getAllTools();
    const skillTools = skillRegistry.getTools();

    // Add AGEM Native Tools
    const agemTools = [
      {
        type: "function" as const,
        function: {
          name: "get_agem_state",
          description:
            "Retrieves the current AGEM engine state: iteration count, operational mode, graph size, SOC state, registry-topology status, and gap count. Embedding-derived registry cycles do not drive OBSTRUCTED state.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "run_agem_cycle",
          description: RUN_AGEM_CYCLE_DESCRIPTION,
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "One conceptual section or new piece of material.",
              },
              subgraph: {
                type: "string",
                description:
                  "Stable assertion/topic subgraph name. Reuse it for later material about the same section.",
              },
            },
            required: ["prompt"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "run_agem_cycles_sectioned",
          description: RUN_SECTIONED_CYCLES_DESCRIPTION,
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The complete structured corpus text.",
              },
              sectionPattern: {
                type: "string",
                description:
                  "Optional JavaScript regex source matched in multiline mode. Default '^## '. Use '^### ' for third-level sections.",
              },
              maxSections: {
                type: "integer",
                minimum: 2,
                maximum: 100,
                default: 24,
                description:
                  "Hard safety limit. The tool errors before running when the split exceeds it.",
              },
            },
            required: ["text"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_cohomology",
          description:
            "Analyse the embedding-derived LCM subgraph-registry sheaf. Returns numeric topology only with at least two vertices and an edge; otherwise returns status='not-computed' with a reason and remedy. On computed results, obey h0_component_count_valid and h0_interpretation. cycle_topology_dimension is c1_dimension-coboundary_rank: a threshold-edge cycle signal that can be positive under full agreement, never a content obstruction or logical verdict. This sheaf does not drive OBSTRUCTED state.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "evaluate_logical_consistency",
          description:
            "Hand-authored logical consistency over already-audited assertion-context blocks. It proves consequences of the supplied formulas only and is not evidence that a source corpus entails those formulas. The real formula-level result is hasContradiction plus minimal unsatisfiable sets in frustrations; H¹ is only a lossy topological summary and is never the verdict. Prefer extract_and_verify_claims for raw contested corpora because it preserves attribution. Formula syntax: lowercase predicates over constants, '-' for negation, '->' implies, parenthesised quantifiers; property(entity), never holds(entity, property); one formula per array element, never newlines inside a formula.",
          parameters: {
            type: "object",
            properties: {
              blocks: {
                type: "array",
                description:
                  "Audited assertion-context blocks grouped by corpus assertion or attributed position, never by graph community. Each: {name: string, propositions: string[]}.",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    propositions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["name", "propositions"],
                },
              },
              corpusId: {
                type: "string",
                description:
                  "Optional provenance label only. Recall is semantic and does not use corpus-id equality.",
              },
            },
            required: ["blocks"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_check_log",
          description:
            "Drill into the satisfiability checks behind an evaluate_logical_consistency result. That tool returns exact counts (checkLogDigest) plus every entry that carries signal — contradictions, undetermined results, vacuity notes, minimal cores, per-block internal checks — and omits the routine subset checks that came back 'consistent', because on a real 10-block run those were 99.7% of a 1.8 MB payload. Call this only when you need a specific omitted entry verbatim; the digest already answers 'did that level actually run?' exactly. Filter by kind, verdict, or blocks.",
          parameters: {
            type: "object",
            properties: {
              runLogId: {
                type: "string",
                description:
                  "The runLogId from the evaluate_logical_consistency result, verbatim.",
              },
              kind: {
                type: "string",
                description:
                  "Optional: 'internal' | 'pair' | 'triple' | 'set' | 'core-probe' | 'core'.",
              },
              verdict: {
                type: "string",
                description:
                  "Optional: 'consistent' | 'contradictory' | 'undetermined'.",
              },
              blocks: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional: keep only checks covering ALL of these block names.",
              },
              limit: {
                type: "number",
                description: "Entries per page (default 25, max 200).",
              },
              offset: {
                type: "number",
                description: "Skip this many matching entries (for paging).",
              },
            },
            required: ["runLogId"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "extract_and_verify_claims",
          description:
            "PREFERRED over evaluate_logical_consistency for contested corpora. First proposes one closed corpus-wide predicate glossary, then extracts typed, attributed claims by forced choice with no new symbols permitted; unmappable claims are reported and make a clean verdict inconclusive. Logic is grouped only by corpus assertion or named position; graph communities are diagnostic annotations and never logical blocks. Rival positions that cannot be jointly satisfied are reported as positions-incompatible, not as a contradictory corpus. Missing attribution is explicitly inconclusive and creates no automatic finding.",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description:
                  "The corpus text to extract claims from. Sentences are the unit of assertion.",
              },
              corpusId: {
                type: "string",
                description: "Label for this corpus, used for provenance.",
              },
              ontology: {
                type: "object",
                additionalProperties: { type: "string" },
                description:
                  "Optional audited alias-to-canonical predicate map, e.g. {\"arbitrariness\":\"arbitrary\",\"assignments\":\"assignment\"}. Only this audited map and deterministic clause-label repairs rewrite formulas. Embedding similarities are returned separately as predicateAliasSuggestions and are never applied silently.",
              },
              sharedExistencePredicates: {
                type: "array",
                items: { type: "string" },
                description:
                  "Explicitly audited neutral entities whose existence every position accepts, e.g. [\"codon\",\"amino_acid\",\"assignment\"]. No witnesses are inferred from recurring vocabulary. Every applied seed is returned for audit; supply only corpus-wide commitments.",
              },
            },
            required: ["text"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "list_finding_conflicts",
          description:
            "List automatically detected supersedes candidates. Same-method candidates require exact shared typed claims and opposite conclusive outcomes; cross-method candidates require exact corpus identity and different outcomes. Embedding similarity never defines conflicts, and no finding is retired automatically.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "resolve_finding_conflict",
          description:
            "Resolve one supersedes candidate after reviewing both findings. Select the authoritative finding and give an explicit reason; the losing finding is archived, never deleted.",
          parameters: {
            type: "object",
            properties: {
              candidateId: { type: "string" },
              winnerFindingId: { type: "string" },
              reason: { type: "string" },
            },
            required: ["candidateId", "winnerFindingId", "reason"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_graph_topology",
          description:
            "Return the TNA graph topology. Default mode returns concept-level communities (named clusters with top nodes, sizes, and inter-community bridges). Use detail='words' for full word-level nodes.",
          parameters: {
            type: "object",
            properties: {
              detail: {
                type: "string",
                description:
                  "Level of detail: 'concepts' (default, community-level summary) or 'words' (full word-level graph).",
              },
            },
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_soc_metrics",
          description:
            "Retrieve Self-Organised Criticality metrics: latest VNE, Embedding Entropy, CDP, Surprising Edge Ratio, correlation coefficient, phase transition flag, regime classification, and trend.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "detect_gaps",
          description:
            "Detect structural gaps between communities in the TNA graph. Returns gap density, shortest path, modularity delta, and bridge nodes for each gap.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "generate_catalyst_questions",
          description:
            "Generate bridging questions designed to close structural gaps. Optionally filter to a specific gap by ID (format: communityA_communityB).",
          parameters: {
            type: "object",
            properties: {
              gap_id: {
                type: "string",
                description:
                  "Optional gap ID to target (e.g. '0_1'). Omit to generate questions for all gaps.",
              },
              max_proposals: {
                type: "number",
                description: "Maximum proposals to explore (1-12, default 6).",
              },
            },
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "search_context",
          description:
            "Semantic search across the LCM context store. Returns entries ranked by cosine similarity.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query.",
              },
              max_results: {
                type: "number",
                description:
                  "Maximum number of results to return. Default: 10.",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "abduce_best_explanation",
          description:
            "Inference to the best explanation for a SURPRISING FACT ABOUT THE CORPUS — an assertion the corpus's other claims do not entail, an outlying inter-community bridge, a structural gap, an H¹ obstruction, or a proved incompatibility. Ranks the candidate causes YOU supply by coherence with the corpus (counter-abduction), whether the observation would follow if the cause were true, explanatory depth, and Ockham penalty on introduced entities. Returns a PROVISIONAL hypothesis adopted for testing. It establishes nothing, stores no finding, and does not satisfy logical verification. Do not use it to diagnose AGEM itself.",
          parameters: {
            type: "object",
            properties: {
              observation: {
                type: "object",
                description:
                  "The surprising fact. Requires phenomenon, source (unexplained-assertion | community-bridge | structural-gap | cohomology-obstruction | logical-conflict), and segmentIds. Supply formula (FOL) and constituentFormulas to make it testable, plus signals for the source's own criterion (e.g. {h1: 1} or {links: 128, meanInterCommunityLinks: 31}).",
              },
              hypotheses: {
                type: "array",
                description:
                  "Candidate causes. Each needs proposedCause and formula (FOL). State them in the corpus's own vocabulary where possible; terms the corpus does not contain are counted as leaps of faith and penalised.",
                items: { type: "object" },
              },
              background: {
                type: "array",
                description:
                  "The corpus's own asserted formulas. Not the model's beliefs about the world.",
                items: { type: "string" },
              },
              existenceWitnesses: {
                type: "array",
                description:
                  "Existence assertions for what the background quantifies over, e.g. 'exists x (organism(x))'. Omit these and the coherence check may be satisfied by the empty world; the result will say so.",
                items: { type: "string" },
              },
              maxProverCalls: {
                type: "number",
                description: "Prover call ceiling. Default 64.",
              },
            },
            required: ["observation", "hypotheses"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "build_defensible_claim",
          description:
            "Build an EVIDENTIAL (defeasible) claim anchored to checkable grounds, for corpora that support a recommendation without supporting a theorem. Filters opinions and unbacked assertions out of the grounds, weighs what remains on relevance/reliability/coverage/verifiability, and SHRINKS THE SCOPE until the claim fits the evidence rather than hedging the wording. Requires a disconfirming-search receipt — the query you ran asking what would prove the recommendation wrong, and where — and refuses to build without one. Result is stored as a finding with method 'evidential'; it never satisfies formal verification.",
          parameters: {
            type: "object",
            properties: {
              decision: {
                type: "object",
                description:
                  "{question, subQuestions?}. Evidence is weighed against THIS decision; a weight computed for another question is not reusable.",
              },
              recommendation: {
                type: "string",
                description: "The point you want accepted, before calibration.",
              },
              statements: {
                type: "array",
                description:
                  "Everything gathered, supporting AND disconfirming. Per item: text, bearing ('supports'|'contradicts'), sourceRef (a resolvable locator such as 'segment:s12' or a DOI/URL — items without one are dropped as unbacked assertions), category, instanceCount (1 marks an anecdote, which cannot carry a claim alone), reliabilityTier, addresses.",
                items: { type: "object" },
              },
              disconfirmingSearch: {
                type: "object",
                description:
                  "{query, searchedIn[], found}. Mandatory. Finding nothing is a valid result; not looking is not.",
              },
              initialScope: {
                type: "string",
                description:
                  "universal | general | typical | some | at-least-one. Default 'general'. Calibration only moves down this ladder.",
              },
              initialCertainty: {
                type: "string",
                description:
                  "is | indicates | appears | is-consistent-with. Default 'is'.",
              },
              corpusId: {
                type: "string",
                description: "Corpus identity for the stored finding.",
              },
            },
            required: [
              "decision",
              "recommendation",
              "statements",
              "disconfirmingSearch",
            ],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "spawn_agem_agent",
          description:
            "Request the engine to spawn a new agent with a given persona. Note: agent spawning is currently triggered automatically by H¹ obstructions.",
          parameters: {
            type: "object",
            properties: {
              persona: {
                type: "string",
                description:
                  "The persona of the new agent, e.g., 'Contrarian' or 'Detail-Oriented'.",
              },
            },
            required: ["persona"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "reset_agem_engine",
          description:
            "Reset the engine state: shuts down the Orchestrator and re-instantiates a clean engine. Clears all graph data, metrics, and history.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "read_skill",
          description:
            "Read the full markdown instructions of a loaded agent skill. Use list_mcp_servers or get_agem_state to see available skills first.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The skill name (e.g., 'agem-expert').",
              },
            },
            required: ["name"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "create_skill",
          description:
            "Create or update an agent skill. Writes a SKILL.md file with YAML frontmatter (name, description) and markdown body. Skills are loaded on next server restart.",
          parameters: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description:
                  "Skill folder name (e.g., 'value-guardian'). Will be created under skills/.",
              },
              description: {
                type: "string",
                description: "One-line description of the skill.",
              },
              content: {
                type: "string",
                description:
                  "Full markdown body of the skill (everything after the frontmatter).",
              },
            },
            required: ["name", "description", "content"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "list_scenarios",
          description:
            "List all available ethical scenarios in the Paraclete Proving Grounds. Shows ID, title, category, and turn count.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "load_scenario",
          description:
            "Load a specific scenario by ID to see its full definition (turns, affordances, constraints, metric targets).",
          parameters: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Scenario ID (e.g., 'plague-village').",
              },
            },
            required: ["id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "generate_scenario",
          description:
            "Create and save a new ethical scenario for the Paraclete Proving Grounds. Use when encountering a real ethical dilemma worth preserving as a reusable test case. The scenario is saved to scenarios/{id}.json.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique kebab-case ID." },
              title: { type: "string", description: "Human-readable title." },
              description: {
                type: "string",
                description: "Brief description of the ethical dilemma.",
              },
              category: {
                type: "string",
                description:
                  "Category: means-vs-ends | hidden-information | temporal-pressure | poppers-paradox | epistemic-autonomy | structural-harm | custom",
              },
              metric_target: {
                type: "string",
                description: "What topological stress this scenario targets.",
              },
              turns: {
                type: "array",
                description:
                  "Array of turn objects with: turn (number), situation (string), affordances (optional string[]), reveal_after_action (optional string), turns_remaining (optional number).",
                items: { type: "object" },
              },
              vk_axioms: {
                type: "array",
                items: { type: "string" },
                description: "VK axiom IDs relevant to this scenario.",
              },
              origin_context: {
                type: "string",
                description:
                  "What real situation inspired this scenario (optional).",
              },
            },
            required: [
              "id",
              "title",
              "description",
              "category",
              "turns",
              "vk_axioms",
            ],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "run_scenario",
          description:
            "Start executing an ethical scenario from the Paraclete Proving Grounds. Loads the scenario and presents the first turn. Process each turn by: (1) run_agem_cycle with the situation, (2) check cohomology + sheaf enforcer, (3) decide action, (4) record_scenario_turn with metrics.",
          parameters: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Scenario ID to run (e.g., 'plague-village').",
              },
            },
            required: ["id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "record_scenario_turn",
          description:
            "Record metrics and decision for the current scenario turn. Call after analyzing the situation with AGEM tools. Returns the next turn or completion status.",
          parameters: {
            type: "object",
            properties: {
              action_taken: {
                type: "string",
                description:
                  "The action you chose (or 'REFUSE' if refusing to act).",
              },
              h1_dimension: {
                type: "number",
                description: "Current H¹ dimension from get_cohomology.",
              },
              vk_coboundary: {
                type: "number",
                description:
                  "Coboundary norm on tna→value-guardian edge (from sheaf enforcer edge report).",
              },
              vk_dual_variable: {
                type: "number",
                description: "Dual variable on tna→value-guardian edge.",
              },
              closure_status: {
                type: "string",
                description:
                  "From get_closure_status (KERNEL1/WEAK/WARNING/TIMEOUT).",
              },
              ethical_risk: {
                type: "string",
                description:
                  "From conscience-servitor triage (low/medium/high/critical).",
              },
            },
            required: ["action_taken"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "complete_scenario",
          description:
            "Finalize the active scenario run. Saves results to scenarios/results/ with full metrics summary. Call after all turns are processed.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ];

    // ─── Meta-tools: dynamic MCP access without schema flooding ───
    // Instead of exposing 50+ raw MCP tool schemas (which overwhelms local models),
    // we provide 3 meta-tools that let the model discover and invoke any MCP tool.
    // Pattern from mcp_coordinator: model sees ~13 tools, accesses everything.
    const metaTools = [
      {
        type: "function" as const,
        function: {
          name: "list_mcp_servers",
          description:
            "List all connected MCP servers and how many tools each has. Call this first to see what external capabilities are available (reasoning, ethics, logic, knowledge graphs, etc).",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "list_server_tools",
          description:
            "List all tools available on a specific MCP server with their descriptions. Use this to discover what a server can do before calling its tools.",
          parameters: {
            type: "object",
            properties: {
              server_name: {
                type: "string",
                description: "Name of the MCP server (from list_mcp_servers)",
              },
            },
            required: ["server_name"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "call_mcp_tool",
          description:
            'Call any tool on any connected MCP server. Use list_server_tools first to see required arguments. IMPORTANT: Pass tool arguments inside the "arguments" object, e.g.: arguments: {"text": "Socrates is mortal"} for hipai-montague/add_belief. Servers: advanced-reasoning, sheaf-consistency-enforcer, hipai-montague, verifier-graph, conscience-servitor, mcp-logic, aseke-compass.',
          parameters: {
            type: "object",
            properties: {
              server_name: { type: "string", description: "MCP server name" },
              tool_name: {
                type: "string",
                description: "Tool name on that server",
              },
              arguments: {
                type: "object",
                description: "Tool arguments as key-value pairs",
              },
            },
            required: ["server_name", "tool_name"],
          },
        },
      },
    ];

    // --- Dynamic MCP Schema Injection ---
    // Scan current prompt and conversation history for mentions of connected servers
    const allTextToScan = [
      message,
      ...messages
        .filter((m: any) => m.role === "user")
        .slice(-6)
        .map((m: any) => {
        let text = m.content || "";
        if (m.tool_calls) {
          text += " " + JSON.stringify(m.tool_calls);
        }
        return text;
        })
    ].join(" ").toLowerCase();

    const serverNames = mcpManager.getServerNames();
    const activeServers = new Set(
      explicitlyRequestedMcpServers(allTextToScan, serverNames),
    );

    // Filter tools for the active servers and map them
    const activeMcpTools: any[] = [];
    for (const tool of mcpTools) {
      const parts = tool.function.name.split("__");
      const sName = parts[1];
      if (activeServers.has(sName)) {
        activeMcpTools.push(tool);
      }
    }

    if (activeServers.size > 0) {
      console.log(
        `[Chat] Dynamically injected ${activeMcpTools.length} tools for active servers:`,
        Array.from(activeServers)
      );
    }

    const exposedMetaTools = shouldExposeMcpMetaTools([...activeServers])
      ? metaTools
      : [];

    const intentToolNames = toolNamesForRunIntent(runIntent);
    const intentAgemTools =
      intentToolNames === null
        ? agemTools
        : agemTools.filter(({ function: definition }) =>
            intentToolNames.has(definition.name),
          );

    // All providers get AGEM native tools. MCP discovery is opt-in because
    // call_mcp_tool otherwise bypasses the selective direct-tool surface.
    // Cloud providers additionally get skill tools for direct access
    let tools: any[];
    if (isOllama) {
      tools = [...intentAgemTools, ...exposedMetaTools, ...activeMcpTools];
      console.log(
        `[Chat] Ollama: ${intentAgemTools.length} AGEM + ${exposedMetaTools.length} meta + ${activeMcpTools.length} active MCP = ${tools.length} total`,
      );
    } else {
      tools = [...skillTools, ...intentAgemTools, ...exposedMetaTools, ...activeMcpTools];
      console.log(
        `[Chat] Cloud: ${skillTools.length} skill + ${intentAgemTools.length} AGEM + ${exposedMetaTools.length} meta + ${activeMcpTools.length} active MCP = ${tools.length} total`,
      );
    }

    // Create provider instance
    const llmProvider = createProvider(resolvedProvider);

    let isDone = false;
    let turnCount = 0;
    const maxTurns = settings.all.CHAT_MAX_TURNS;
    let lastResult: any = null;
    const allTurnToolResults: any[] = [];
    const successfulToolDurations = new Map<string, number>();
    let deferredTool:
      | { name: string; remainingMs: number; requiredMs: number }
      | undefined;
    let typedFinalization: TypedVerificationFinalization | undefined;
    let finalResponsePending = false;
    /**
     * One evidential turn may be granted after a STRUCTURAL typed-path failure.
     * Granted at most once per run, so this cannot become an unbounded retry
     * loop dressed up as adaptation.
     */
    let evidentialPathGranted = false;

    // Bounded recovery ladder (L1 retry → L2 patch → L3 escalate) shared by
    // every tool call in this run, so the retry budget is per-run, not per-call.
    const recovery = new RecoveryProtocol({
      retryBudget: settings.all.TOOL_RETRY_BUDGET,
      runId: runLog.runId,
    });

    // Output contract κ — replaces the old turn-count completion heuristic.
    // "Contested" is read from the engine's own clustering: two or more concept
    // communities means a multi-position corpus, which requires formal
    // verification before any consistency claim.
    // It stays dormant on runs that are not analyses at all — a bare
    // "reset the engine" has no corpus, and nudging it to ingest just costs a
    // round trip.
    const workflowContract = createWorkflowContract({
      intent: runIntent,
      enabled: settings.all.CHAT_ENFORCE_WORKFLOW_CONTRACT,
      isContested: () => (agemBridge.getState().communities ?? 0) >= 2,
      isClaimStoreAvailable: () => claimStore.available,
      materialChars: typeof message === "string" ? message.length : 0,
      materialThreshold: settings.all.CHAT_CONTRACT_MATERIAL_CHARS,
    });

    while (!isDone && turnCount < maxTurns) {
      if (requestDeadline.timedOut) {
        markRequestTimedOut(turnCount);
        break;
      }

      turnCount++;
      console.log(
        `[Chat] Turn ${turnCount}/${maxTurns} — sending to ${sanitizeLog(resolvedProvider)}/${sanitizeLog(model)}`,
      );

      let result: any;
      const inputMessageCount = historyMessages.length;
      let compressedMessageCount = inputMessageCount;
      try {
        requestDeadline.signal.throwIfAborted();
        const compressResult = await compress(historyMessages as any[], {
          model: String(model),
          timeout: Math.min(30_000, Math.max(1, requestDeadline.remainingMs())),
        });
        compressedMessageCount = compressResult.messages.length;
        requestDeadline.signal.throwIfAborted();

        result = await llmProvider.chat({
          messages: compressResult.messages as any[],
          model,
          tools,
          apiKey,
          onToken: (t) => {
            res.write(
              `event: token\ndata: ${JSON.stringify({ content: t })}\n\n`,
            );
          },
          onThinking: (t) => {
            if (t)
              res.write(
                `event: thinking\ndata: ${JSON.stringify({ content: t })}\n\n`,
              );
          },
          onUsage: (u) => {
            res.write(`event: usage\ndata: ${JSON.stringify(u)}\n\n`);
          },
          signal: requestDeadline.signal,
        });
      } catch (error) {
        if (requestDeadline.timedOut) {
          markRequestTimedOut(turnCount);
          break;
        }
        throw error;
      }
      lastResult = result;
      runLog.turn(turnCount, {
        content: String(result.content ?? ""),
        thinking:
          typeof result.thinking === "string" ? result.thinking : undefined,
        finishReason:
          typeof result.finishReason === "string"
            ? result.finishReason
            : undefined,
        toolNames: Array.isArray(result.tool_calls)
          ? result.tool_calls.map((call: any) =>
              String(call?.function?.name ?? "unknown"),
            )
          : [],
        inputMessageCount,
        compressedMessageCount,
        usage: result.usage,
      });

      if (finalResponsePending) {
        const fallbackContent =
          typedFinalization?.fallbackContent ??
          [
            `PARTIAL / DEFERRED — ${deferredTool?.name ?? "required verification"} could not be completed within the request budget.`,
            deferredTool
              ? `The tool needed ${Math.ceil(deferredTool.requiredMs / 1000)}s of safe budget, with ${Math.floor(deferredTool.remainingMs / 1000)}s remaining.`
              : "Required verification remains incomplete.",
            "The persisted engine state can be continued in a new request.",
          ].join("\n\n");
        const sanitizedFinal = sanitizeToolsDisabledFinal(
          result,
          fallbackContent,
        );
        if (sanitizedFinal.ignoredToolCalls > 0) {
          sendEvent("clear_stream", {});
          runLog.event("final_tool_calls_ignored", {
            count: sanitizedFinal.ignoredToolCalls,
          });
        }
        result.content = sanitizedFinal.content;
        result.tool_calls = [];
        if (sanitizedFinal.usedFallback) {
          runLog.event("final_response_fallback", {
            reason: "empty-tools-disabled-response",
          });
        }
      }

      // If the model returned tool calls, check if the streamed text was just raw JSON
      // (nemotron bug) vs legitimate text. Only clear if it looks like raw tool-call JSON.
      if (result.tool_calls && result.tool_calls.length > 0) {
        const trimmed = (result.content ?? "").trim();
        const looksLikeRawJson =
          trimmed.startsWith("{") || trimmed.startsWith("[");
        if (looksLikeRawJson && trimmed.length < 2000) {
          sendEvent("clear_stream", {});
        }
        // Otherwise keep the text — it's legitimate narration between tool calls
      }

      // Ensure all tool calls have unique IDs for history reconstruction and UI tracking
      if (result.tool_calls && result.tool_calls.length > 0) {
        result.tool_calls = result.tool_calls.map((tc: any, i: number) => ({
          ...tc,
          id: tc.id || `call_${Date.now()}_${i}`,
        }));
      }

      // Append assistant response to history
      const assistantMessage: any = {
        role: "assistant",
        content: result.content,
      };
      if (result.tool_calls) {
        if (isOllama) {
          // Ollama expects: tool_calls with type, function.index, and arguments as OBJECT
          // We include the ID for cross-provider stability (e.g. switching to Anthropic)
          assistantMessage.tool_calls = result.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === "string"
                  ? JSON.parse(tc.function.arguments || "{}")
                  : tc.function.arguments,
            },
          }));
        } else {
          // OpenRouter/MiniMax/Anthropic: standard OpenAI format with arguments as STRING
          assistantMessage.tool_calls = result.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: tc.type ?? "function",
            function: {
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === "string"
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments ?? {}),
            },
          }));
        }
      }
      historyMessages.push(assistantMessage);

      if (result.tool_calls && result.tool_calls.length > 0) {
        // ─── Tool execution ───
        // parseToolArgs: recover the argument object from whatever the model
        // emitted. Separated from execution so the scheduler can classify a
        // call's side-effect profile before deciding how to dispatch it.
        const parseToolArgs = (tc: any): Record<string, unknown> => {
          const fnName = tc.function.name;
          let args: any = {};
          if (typeof tc.function.arguments === "string") {
            const rawArgs = tc.function.arguments || "{}";
            try {
              args = JSON.parse(rawArgs);
            } catch (parseErr) {
              // Attempt common JSON repairs (trailing text, unquoted keys, etc.)
              console.warn(
                `[Chat] Malformed tool args for ${fnName}, attempting repair: ${(parseErr as Error).message}`,
              );
              try {
                // Try fixing: truncate at last valid closing brace/bracket
                const lastBrace = rawArgs.lastIndexOf("}");
                const lastBracket = rawArgs.lastIndexOf("]");
                const cutPoint = Math.max(lastBrace, lastBracket);
                if (cutPoint > 0) {
                  args = JSON.parse(rawArgs.slice(0, cutPoint + 1));
                  console.log(`[Chat] JSON repair succeeded for ${fnName}`);
                } else {
                  console.error(
                    `[Chat] JSON repair failed for ${fnName}, using empty args`,
                  );
                  args = {};
                }
              } catch {
                console.error(
                  `[Chat] JSON repair also failed for ${fnName}: ${rawArgs.slice(0, 200)}`,
                );
                args = {};
              }
            }
          } else if (
            typeof tc.function.arguments === "object" &&
            tc.function.arguments !== null
          ) {
            args = tc.function.arguments;
          }
          return args as Record<string, unknown>;
        };

        /**
         * runToolOnce — a SINGLE attempt at one tool call.
         *
         * Contract: throws on failure. It must not swallow errors into its
         * return value, because the recovery protocol classifies the thrown
         * error to decide whether a retry (transient) or an argument repair
         * (schema) is warranted. A stringified error returned as output would
         * look like success and bypass the ladder entirely.
         */
        const runToolOnce = async (
          fnName: string,
          args: any,
        ): Promise<{ output: string; label: string }> => {
          requestDeadline.signal.throwIfAborted();
          let output = "";
          let toolLabel = fnName; // Descriptive label for tool_result event

          {
            if (fnName === "read_skill") {
              output = skillRegistry.executeTool(fnName, args);
            } else if (fnName === "get_agem_state") {
              const state = agemBridge.getState();
              // Trim verbose graph data for LLM context efficiency
              // Full graph available via get_graph_topology(detail='words')
              const trimmed = {
                ...state,
                graph_summary: state.graph_summary
                  ? {
                      node_count: state.graph_summary.node_count,
                      edge_count: state.graph_summary.edge_count,
                      concept_graph: state.graph_summary.concept_graph
                        ? {
                            communities:
                              state.graph_summary.concept_graph.communities,
                            edges: state.graph_summary.concept_graph.edges,
                            modularity:
                              state.graph_summary.concept_graph.modularity,
                            text_summary:
                              state.graph_summary.concept_graph.text_summary,
                          }
                        : undefined,
                    }
                  : undefined,
              };
              output = JSON.stringify(trimmed, null, 2);
            } else if (fnName === "run_agem_cycle") {
              // Accept common parameter name variations from different models
              const prompt =
                args.prompt ??
                args.conversation_topic ??
                args.topic ??
                args.message ??
                message;
              // Log the EXACT text fed into the graph this cycle — the thing
              // previously only visible in the terminal ("processed N tokens").
              runLog.cycleIngest(typeof prompt === "string" ? prompt : String(prompt));
              const runResult = await agemBridge.runCycle(
                prompt,
                sendEvent,
                requestDeadline.signal,
                {
                  subgraph:
                    typeof args.subgraph === "string"
                      ? args.subgraph
                      : undefined,
                },
              );
              // Trim state for LLM context — strip word-level nodes/edges, keep concept graph
              const st = runResult.state;
              const trimmedState = {
                iteration: st.iteration,
                communities: st.communities,
                operational_state: st.operational_state,
                sheaf_energy: st.sheaf_energy,
                gap_count: st.gap_count,
                agent_count: st.agent_count,
                graph_summary: st.graph_summary
                  ? {
                      node_count: st.graph_summary.node_count,
                      edge_count: st.graph_summary.edge_count,
                      concept_graph: st.graph_summary.concept_graph
                        ? {
                            text_summary:
                              st.graph_summary.concept_graph.text_summary,
                            modularity:
                              st.graph_summary.concept_graph.modularity,
                            communities:
                              st.graph_summary.concept_graph.communities,
                          }
                        : undefined,
                    }
                  : undefined,
                soc: st.soc,
                evolution: st.evolution,
              };
              output = `Cycle completed. State:\n${JSON.stringify(trimmedState, null, 2)}`;
              // Emit AGEM state and artifacts as SSE events
              sendEvent("agem_state", runResult.state);
              for (const artifact of runResult.artifacts) {
                sendEvent("artifact", artifact);
                try {
                  knowledgeBase.saveArtifact(artifact);
                } catch {
                  /* skip */
                }
              }
            } else if (fnName === "run_agem_cycles_sectioned") {
              const corpusText = String(args.text ?? args.prompt ?? "");
              const plan = planSectionedIngestion(corpusText, {
                sectionPattern:
                  typeof args.sectionPattern === "string"
                    ? args.sectionPattern
                    : undefined,
                maxSections:
                  typeof args.maxSections === "number"
                    ? args.maxSections
                    : undefined,
              });
              const runResult = await agemBridge.runSectionedCycles(
                plan,
                (event, data) => {
                  if (event === "section_progress") {
                    const index = Number((data as { index?: number })?.index ?? 0) - 1;
                    const section = plan[index];
                    if (section) runLog.cycleIngest(section.text);
                  }
                  sendEvent(event, data);
                },
                requestDeadline.signal,
              );
              runLog.event("sectioned_run_telemetry", runResult.telemetry);
              const state = runResult.analysis.state;
              output = `Sectioned corpus run completed.\n${JSON.stringify(
                {
                  sections: runResult.sections,
                  analysis: {
                    iteration: state.iteration,
                    communities: state.communities,
                    operational_state: state.operational_state,
                    graph: state.graph_summary
                      ? {
                          node_count: state.graph_summary.node_count,
                          edge_count: state.graph_summary.edge_count,
                        }
                      : undefined,
                    cohomology: runResult.analysis.cohomology,
                    soc: {
                      latest: runResult.analysis.soc.latest,
                      regime: runResult.analysis.soc.regime,
                      history_length: runResult.analysis.soc.history_length,
                    },
                  },
                  telemetry: runResult.telemetry,
                },
                null,
                2,
              )}`;
              sendEvent("agem_state", state);
              for (const artifact of runResult.artifacts) {
                sendEvent("artifact", artifact);
                try {
                  knowledgeBase.saveArtifact(artifact);
                } catch {
                  /* skip */
                }
              }
            } else if (fnName === "get_cohomology") {
              output = JSON.stringify(agemBridge.getCohomology(), null, 2);
            } else if (fnName === "evaluate_logical_consistency") {
              // Logic-based H⁰/H¹ over agent-supplied blocks. The ENGINE builds
              // the mcp-logic calls (so they can't be malformed) and computes the
              // consistency-complex homology. See logicalCohomology.ts / docs §15.
              const rawBlocks = Array.isArray(args.blocks) ? args.blocks : [];
              const blocks = rawBlocks
                .map((b: any) => ({
                  name: String(b?.name ?? "").trim(),
                  propositions: Array.isArray(b?.propositions)
                    ? b.propositions.map((p: any) => String(p)).filter(Boolean)
                    : [],
                }))
                .filter(
                  (b: any) => b.name && b.propositions.length > 0,
                );
              if (blocks.length < 2) {
                output = JSON.stringify({
                  error:
                    "Provide at least 2 blocks, each with a name and a non-empty propositions array of first-order-logic strings (e.g. ['p(a)', 'p(a) -> q(a)']).",
                });
              } else {
                const oracle = makeMcpLogicOracle((server, tool, a) =>
                  mcpManager.executeTool(
                    server,
                    tool,
                    a,
                    requestDeadline.signal,
                  ),
                );
                // Let a caller raise the caps deliberately. Undefined must not
                // be spread over the defaults, so only set what was supplied.
                const cohomologyOpts: LogicalCohomologyOptions = {};
                cohomologyOpts.abortOnCriticalFormalization = true;
                if (Number.isFinite(Number(args.maxArity)))
                  cohomologyOpts.maxArity = Number(args.maxArity);
                if (Number.isFinite(Number(args.maxChecks)))
                  cohomologyOpts.maxChecks = Number(args.maxChecks);
                const result = await computeLogicalCohomology(
                  blocks,
                  oracle,
                  cohomologyOpts,
                );
                // Lead with the verdict the model should actually act on.
                // H¹ is pinned at 0 for most realistic block counts, so
                // putting it first invited exactly the wrong reading.
                const formulaVerdict = result.resultIsVacuous
                  ? (result.hasContradiction
                      ? `CONTRADICTION(S) FOUND, BUT FORMALIZATION INCOMPLETE — the listed clashes are valid evidence, but critical symbol defects can hide additional contradictions. `
                      : `INVALID FORMALIZATION — the consistency result is VACUOUS and must not be reported as a finding. `) +
                    result.formalizationWarnings
                      .filter((w) => w.severity === "critical")
                      .map((w) => w.message)
                      .join(" ") +
                    " Re-encode the blocks and call this tool again."
                  : result.hasContradiction
                    ? `CONTRADICTION FOUND — ${result.frustrations.length} minimal unsatisfiable set(s): ` +
                      result.frustrations
                        .map((f) => {
                          const head = `{${f.blocks.join(", ")}} (arity ${f.arity})`;
                          if (!f.core || f.core.length === 0) return head;
                          // Name the propositions that actually collide, not
                          // just the blocks they came from.
                          const core = f.core
                            .map((c) => `${c.block}: ${c.formula}`)
                            .join(" | ");
                          return (
                            `${head} — the clash is exactly: ${core}` +
                            (f.coreTruncated ? " [core not fully minimised]" : "")
                          );
                        })
                        .join("; ") +
                      (result.frustrationsComplete
                        ? ""
                        : ` WARNING: MUS enumeration is incomplete; more minimal ` +
                          `contradictions may exist. ${result.frustrationSearchNote ?? result.truncationNote ?? ""}`)
                    : result.searchTruncated
                      ? `No contradiction found up to arity ${result.searchedToArity} — the search was TRUNCATED, ` +
                        `so higher-order frustrations are not ruled out. ${result.truncationNote ?? ""} ` +
                        `Do NOT report this as "no contradiction"; it is "not yet checked".`
                      : `No contradiction: all subsets up to arity ${result.searchedToArity} are jointly satisfiable.`;

                /*
                 * State the DENOMINATOR. Blocks that are internally
                 * inconsistent or fail to parse never enter the search, so a
                 * clean verdict covers only what was actually evaluated.
                 * Observed: a run submitted 10 blocks, evaluated 6 (2 self-
                 * contradictory, 2 syntax errors) and reported "no
                 * contradictions between any pair or triple of the 10
                 * distinction claims". The engine knew the real number; the
                 * verdict line did not carry it, so the write-up used 10.
                 */
                const submitted = blocks.length;
                const evaluated = result.vertices.length;
                const coverage =
                  result.preflightAborted
                    ? `COVERAGE: 0 of ${submitted} submitted blocks were sent to the prover. ` +
                      "Critical formalization defects triggered the preflight gate; no prover budget was spent."
                  : evaluated === submitted
                    ? `Coverage: all ${submitted} submitted blocks were evaluated.`
                    : `COVERAGE: only ${evaluated} of ${submitted} submitted blocks were ` +
                      `evaluated. Excluded — ` +
                      [
                        result.internallyInconsistent.length
                          ? `${result.internallyInconsistent.length} internally inconsistent ` +
                            `(${result.internallyInconsistent.join(", ")})`
                          : "",
                        result.checkFailures.length
                          ? `${result.checkFailures.length} check failure(s)`
                          : "",
                        result.uncheckedBlocks.length
                          ? `${result.uncheckedBlocks.length} unchecked after the call budget ended`
                          : "",
                      ]
                        .filter(Boolean)
                        .join("; ") +
                      `. Any verdict below is about those ${evaluated} blocks, NOT about ` +
                      `all ${submitted}. Do not report it as covering the full set.`;
                /*
                 * The complete check log goes to disk, not into the model's
                 * context. Spreading `...result` used to put all of it inline:
                 * one measured run emitted 1,799,602 chars (~450k tokens) of
                 * which 99.7% was checkLog, re-serialising 51 unique formulas
                 * into 1.24 MB. That does not just cost tokens — it lands in
                 * historyMessages untruncated and is re-sent on every
                 * subsequent turn, streams over SSE, and is persisted into the
                 * session JSON. See summarizeCheckLog for the projection.
                 */
                const { checkLog, ...cohomology } = result;
                runLog.event("logic_check_log", {
                  runLogId: runLog.runId,
                  totalChecks: checkLog.length,
                  checkLog,
                });
                const provenanceWarning =
                  "These formulas were supplied by the analyst/model. The prover " +
                  "establishes only their formal consequences; this result does " +
                  "not establish that the source corpus contains, entails, or " +
                  "supports the premises. Use extract_and_verify_claims for " +
                  "corpus-level evidence.";
                output = JSON.stringify(
                  {
                    runLogId: runLog.runId,
                    coverage,
                    blocksSubmitted: submitted,
                    blocksEvaluated: evaluated,
                    formalizationOrigin: "hand-authored",
                    corpusEvidentialStatus: "not-established",
                    provenanceWarning,
                    verdict: `HAND-AUTHORED FORMALIZATION ONLY — ${formulaVerdict}`,
                    ...cohomology,
                    ...summarizeCheckLog(checkLog, {
                      runLogId: runLog.runId,
                    }),
                  },
                  null,
                  2,
                );
              }
            } else if (fnName === "extract_and_verify_claims") {
              /*
               * The whole chain with no hand-written logic. This exists because
               * evaluate_logical_consistency takes model-authored propositions,
               * and freehand encoding of ONE corpus produced contradictory
               * answers across runs: IIT/GWT contradictory in an exhaustive
               * run, consistent in a later one (the exclusion silently
               * vanished), and Hard/Easy manufactured as a contradiction the
               * corpus never made. Typed claims remove the improvisation.
               */
              const text = String(args.text ?? "");
              const corpusId = String(args.corpusId ?? "corpus");
              if (!claimStore.available) {
                output = JSON.stringify({
                  error:
                    "Claim store unavailable — " +
                    (claimStore.status().note ?? "TypeDB not reachable") +
                    " Fall back to evaluate_logical_consistency, and say in your " +
                    "report that the encoding was hand-written and may vary between runs.",
                });
              } else if (text.trim().length === 0) {
                output = JSON.stringify({ error: "Provide the corpus text." });
              } else {
                const segs = segmentText(text).map((t, i) => ({
                  id: `${corpusId}-${i}`,
                  text: t,
                }));
                const rawOntology =
                  args.ontology &&
                  typeof args.ontology === "object" &&
                  !Array.isArray(args.ontology)
                    ? (args.ontology as Record<string, unknown>)
                    : {};
                const ontology = Object.fromEntries(
                  Object.entries(rawOntology).flatMap(([alias, canonical]) =>
                    typeof canonical === "string" && canonical.trim()
                      ? [[alias, canonical]]
                      : [],
                  ),
                );
                const extraction = await extractIntoStore(segs, corpusId, {
                  signal: requestDeadline.signal,
                  ontology,
                });
                runLog.event("claim_extraction_telemetry", {
                  corpusId,
                  segments: segs.length,
                  replayManifest: extraction.replayManifest,
                  sourceSegments: extraction.sourceSegments,
                  parseFailureOutcomes: extraction.parseFailureOutcomes,
                  outcomes: extraction.outcomes,
                  unmappable: extraction.unmappableClaims,
                  glossarySize: extraction.glossary.length,
                  glossaryFailure: extraction.glossaryFailure,
                  unmappableClaims: extraction.unmappableClaims.length,
                  ...extraction.telemetry,
                });

                const graphCommunities =
                  agemBridge.getGraphSummary().concept_graph?.communities.map(
                    (community) => ({
                      id: community.id,
                      label: community.label,
                      members: community.members,
                    }),
                  ) ?? [];
                const sharedExistencePredicates = Array.isArray(
                  args.sharedExistencePredicates,
                )
                  ? args.sharedExistencePredicates
                      .map((value: unknown) => String(value).trim())
                      .filter(Boolean)
                  : [];
                // Derive deterministic formulas, but canonicalise their labels
                // and collect related claims into corpus positions annotated
                // with their graph communities before the subset search.
                const derivation = await deriveClaimBlocks(extraction.outcomes, {
                  corpusId,
                  communities: graphCommunities,
                  ontology,
                  closedVocabulary: extraction.glossary.map(
                    ({ label, kind }) => (kind === "axis" ? "" : label),
                  ).filter(Boolean),
                  embedder: claimBlockEmbedder,
                  sharedExistencePredicates,
                  signal: requestDeadline.signal,
                });
                const distinct = derivation.blocks;

                const extractionComplete =
                  !extraction.glossaryFailure &&
                  extraction.unmappableClaims.length === 0 &&
                  extraction.parseFailures.length === 0 &&
                  extraction.claimsRejected === 0 &&
                  derivation.attributionComplete &&
                  derivation.rejected.length === 0;

                /*
                 * CAP THE BLOCK COUNT. Unlike the hand-curated path, extraction
                 * decides how many blocks there are, and EVERY satisfiability
                 * check is an MCP round-trip to a Prover9/Mace4 subprocess —
                 * far costlier than the direct-Mace4 timings the 5000-check
                 * budget was sized against. 60 blocks is 1770 pair checks
                 * before any triple. Cap it, and say so, rather than appearing
                 * to hang.
                 */
                const BLOCK_CAP = settings.all.LOGIC_MAX_BLOCKS;
                const capped = distinct.length > BLOCK_CAP;
                const selected = distinct.slice(0, BLOCK_CAP);
                const blocks = selected.map(({ name, propositions }) => ({
                  name,
                  propositions,
                }));
                const capNote = capped
                  ? `NOTE: extraction produced ${distinct.length} distinct claim blocks; ` +
                    `only the first ${BLOCK_CAP} were checked, because each check is a ` +
                    `Prover9 call. Contradictions involving the remaining ` +
                    `${distinct.length - BLOCK_CAP} were NOT ruled out. Narrow the corpus ` +
                    `or raise the cap deliberately.`
                  : undefined;
                const inconclusiveCauses = extractionFailureCauses(
                  extraction,
                  derivation,
                );

                if (!extractionComplete) {
                  const repairReport = await proposeExtractionRepairs(
                    {
                      segments: segs,
                      extraction,
                      attributionIssues: derivation.attributionIssues,
                      predicateAliasSuggestions:
                        derivation.predicateAliasSuggestions,
                    },
                    (repairArgs) =>
                      mcpManager.executeTool(
                        "mcp-logic",
                        "abductive_explain",
                        repairArgs,
                        requestDeadline.signal,
                      ),
                  );
                  runLog.event("logic_check_log", {
                    runLogId: runLog.runId,
                    totalChecks: 0,
                    checkLog: [],
                    preflightAborted: true,
                    preflightStage: "extraction",
                    abductiveRepairCalls: repairReport.abductiveCalls,
                    counterfactualValidatorCalls:
                      repairReport.validatorCalls,
                  });
                  output = JSON.stringify({
                    runLogId: runLog.runId,
                    corpusCompletenessValidated: false,
                    verdictScope: "none",
                    preflightAborted: true,
                    preflightStage: "extraction",
                    proverCalls: 0,
                    attributionComplete: derivation.attributionComplete,
                    attributionIssues: derivation.attributionIssues,
                    inconclusiveCauses,
                    semanticsValidated: false,
                    verdictKind: "inconclusive",
                    hasCorpusContradiction: false,
                    hasPositionContradiction: false,
                    hasPositionIncompatibility: false,
                    semanticFrustrations: [],
                    verdict: inconclusiveExtractionVerdict(inconclusiveCauses),
                    repairReport,
                    extraction: {
                      replayManifest: extraction.replayManifest,
                      sourceSegments: extraction.sourceSegments,
                      segmentsProcessed: extraction.segmentsProcessed,
                      claimsProposed: extraction.claimsProposed,
                      claimsAccepted: extraction.claimsAccepted,
                      claimsRejected: extraction.claimsRejected,
                      glossary: extraction.glossary,
                      glossaryFailure: extraction.glossaryFailure,
                      unmappableClaims: extraction.unmappableClaims,
                      parseFailures: extraction.parseFailures.length,
                      parseFailureOutcomes: extraction.parseFailureOutcomes,
                      rejections: extraction.outcomes
                        .filter((outcome) => !outcome.accepted)
                        .slice(0, 10)
                        .map((outcome) => ({
                          segmentId: outcome.segmentId,
                          sourceSegmentId: outcome.sourceSegmentId,
                          claim: outcome.claim,
                          why: outcome.rejection,
                        })),
                    },
                    derivedBlocksHeldAtPreflight: blocks,
                    predicateMapping: derivation.predicateMapping,
                    predicateAliasSuggestions:
                      derivation.predicateAliasSuggestions,
                    derivationRejections: derivation.rejected,
                  });
                } else if (blocks.length === 0) {
                  output = JSON.stringify({
                    runLogId: runLog.runId,
                    extraction,
                    corpusCompletenessValidated: extractionComplete,
                    verdictScope: "accepted-claims",
                    attributionComplete: derivation.attributionComplete,
                    attributionIssues: derivation.attributionIssues,
                    inconclusiveCauses,
                    semanticsValidated: false,
                    verdictKind: "inconclusive",
                    hasContradiction: false,
                    supportingClaimKeys: [],
                    supportingClaimRefs: [],
                    verdict: inconclusiveExtractionVerdict(inconclusiveCauses),
                  });
                } else {
                  const oracle = makeMcpLogicOracle((server, tool, a) =>
                    mcpManager.executeTool(
                      server,
                      tool,
                      a,
                      requestDeadline.signal,
                    ),
                  );
                  const predicateAliases = Object.fromEntries(
                    derivation.predicateMapping
                      .filter((mapping) => {
                        const source = mapping.source
                          .trim()
                          .replace(/[^a-zA-Z0-9]+/g, "_")
                          .replace(/^_+|_+$/g, "")
                          .toLowerCase();
                        return source !== mapping.canonical;
                      })
                      .map((mapping) => [mapping.source, mapping.canonical]),
                  );
                  const result = await computeLogicalCohomology(
                    blocks,
                    oracle,
                    {
                      ...configuredCohomologyOptions(settings.all),
                      predicateAliases,
                      predicateAliasSuggestions:
                        derivation.predicateAliasSuggestions,
                      abortOnCriticalFormalization: true,
                    },
                  );
                  const classified = classifyClaimVerdict(derivation, result);
                  const semantic = applyExtractionCoverage(classified, {
                    corpusComplete: extractionComplete,
                    capped,
                  });
                  const evaluatedNames = new Set([
                    ...result.vertices,
                    ...result.internallyInconsistent,
                  ]);
                  const evaluatedBlocks = selected.filter((block) =>
                    evaluatedNames.has(block.name),
                  );
                  const evidenceBlockNames = new Set(
                    semantic.verdictKind === "position-contradiction" ||
                      semantic.verdictKind === "corpus-contradiction"
                      ? semantic.semanticFrustrations
                          .filter(({ kind }) => kind === semantic.verdictKind)
                          .flatMap(({ blocks }) => blocks)
                      : [...evaluatedNames],
                  );
                  const supporting = selected.filter((block) =>
                    evidenceBlockNames.has(block.name),
                  );
                  const segmentTextById = new Map(
                    segs.map((segment) => [segment.id, segment.text]),
                  );
                  const supportingKeys = new Set(
                    supporting.flatMap((block) => block.claimKeys),
                  );
                  const supportingRefs = new Set(
                    supporting.flatMap((block) => block.claimRefs),
                  );
                  const evidenceKeys = new Set<string>();
                  const supportingClaimEvidence = extraction.outcomes.flatMap((accepted) => {
                    if (
                      !accepted.accepted ||
                      !accepted.claimKey ||
                      !accepted.claimId ||
                      !supportingKeys.has(accepted.claimKey) ||
                      evidenceKeys.has(accepted.claimKey)
                    ) {
                      return [];
                    }
                    const sourceText = accepted
                      ? segmentTextById.get(accepted.segmentId)
                      : undefined;
                    if (sourceText) evidenceKeys.add(accepted.claimKey);
                    return sourceText
                      ? [
                          {
                            claimKey: accepted.claimKey,
                            claimRef: accepted.claimId,
                            segmentId: accepted.segmentId,
                            sourceText,
                            claim: accepted.claim,
                          },
                        ]
                      : [];
                  });
                  const evaluated = evaluatedBlocks.length;
                  const coverageDetails = [
                    result.preflightAborted
                      ? `${blocks.length} block(s) held at the critical formalization preflight gate; zero prover calls made`
                      : "",
                    capped
                      ? `${distinct.length - BLOCK_CAP} block(s) excluded by LOGIC_MAX_BLOCKS`
                      : "",
                    result.internallyInconsistent.length
                      ? `${result.internallyInconsistent.length} internally inconsistent block(s) excluded`
                      : "",
                    result.checkFailures.length
                      ? `${result.checkFailures.length} check failure(s)`
                      : "",
                    !result.preflightAborted && result.uncheckedBlocks.length
                      ? `${result.uncheckedBlocks.length} unchecked after the call budget ended`
                      : "",
                  ].filter(Boolean);
                  const coverage =
                    evaluated === distinct.length
                      ? `Coverage: all ${distinct.length} distinct extracted claim blocks were evaluated.`
                      : `Coverage: ${evaluated} of ${distinct.length} distinct extracted claim blocks were evaluated` +
                        (coverageDetails.length
                          ? `. Excluded or unresolved — ${coverageDetails.join("; ")}.`
                          : ".");
                  // Same split as evaluate_logical_consistency: the complete
                  // check log is written to the run's JSONL, and only the
                  // digest plus the signal-carrying entries reach the model.
                  const { checkLog, ...cohomology } = result;
                  runLog.event("logic_check_log", {
                    runLogId: runLog.runId,
                    totalChecks: checkLog.length,
                    checkLog,
                  });
                  const semanticSets = semantic.semanticFrustrations
                    .map(
                      (frustration) =>
                        `{${frustration.blocks.join(", ")}} (arity ${frustration.arity})`,
                    )
                    .join("; ");
                  const verdict =
                    semantic.verdictKind === "corpus-contradiction"
                      ? `CORPUS CONTRADICTION — direct corpus-level assertions form ${semantic.semanticFrustrations.length} minimal unsatisfiable set(s): ${semanticSets}`
                      : semantic.verdictKind === "position-contradiction"
                        ? `POSITION CONTRADICTION — one attributed position is internally inconsistent: ${semanticSets}. This does not by itself make the survey corpus contradictory.`
                        : semantic.verdictKind === "positions-incompatible"
                          ? `POSITIONS INCOMPATIBLE — rival attributed positions cannot be jointly satisfied: ${semanticSets}. The corpus is not contradictory merely for accurately reporting their disagreement.`
                          : semantic.verdictKind === "mixed"
                            ? `MIXED LOGICAL RESULTS — multiple semantic conflict kinds were found (${semanticSets}). Manual interpretation is required; no automatic finding will be stored.`
                            : semantic.verdictKind === "inconclusive"
                              ? result.preflightAborted
                                ? inconclusiveFormalizationVerdict(
                                    result.formalizationWarnings,
                                  )
                                : inconclusiveCauses.length > 0
                                  ? inconclusiveExtractionVerdict(
                                      inconclusiveCauses,
                                    )
                                  : `INCONCLUSIVE — ${result.truncationNote ?? "a logical check was undetermined or the search was truncated. Review formalizationWarnings."}`
                              : `No contradiction within ${evaluated} evaluated assertion context(s) up to arity ${result.searchedToArity}.`;
                  output = JSON.stringify(
                    {
                      runLogId: runLog.runId,
                      capNote,
                      coverage,
                      corpusCompletenessValidated: extractionComplete,
                      verdictScope: extractionComplete
                        ? "whole-corpus"
                        : "accepted-claims",
                      inconclusiveCauses,
                      distinctClaimsExtracted: new Set(
                        extraction.outcomes
                          .filter((outcome) => outcome.accepted)
                          .map((outcome) => outcome.claimKey)
                          .filter(Boolean),
                      ).size,
                      positionBlocksDerived: distinct.length,
                      distinctBlocksExtracted: distinct.length,
                      blocksChecked: blocks.length,
                      blocksEvaluated: evaluated,
                      attributionComplete: derivation.attributionComplete,
                      attributionIssues: derivation.attributionIssues,
                      semanticsValidated: semantic.semanticsValidated,
                      verdictKind: semantic.verdictKind,
                      hasCorpusContradiction: semantic.hasCorpusContradiction,
                      hasPositionContradiction:
                        semantic.hasPositionContradiction,
                      hasPositionIncompatibility:
                        semantic.hasPositionIncompatibility,
                      semanticFrustrations: semantic.semanticFrustrations,
                      extraction: {
                        replayManifest: extraction.replayManifest,
                        sourceSegments: extraction.sourceSegments,
                        segmentsProcessed: extraction.segmentsProcessed,
                        claimsProposed: extraction.claimsProposed,
                        claimsAccepted: extraction.claimsAccepted,
                        claimsRejected: extraction.claimsRejected,
                        glossary: extraction.glossary,
                        glossaryFailure: extraction.glossaryFailure,
                        unmappableClaims: extraction.unmappableClaims,
                        parseFailures: extraction.parseFailures.length,
                        parseFailureOutcomes: extraction.parseFailureOutcomes,
                        rejections: extraction.outcomes
                          .filter((o) => !o.accepted)
                          .slice(0, 10)
                          .map((o) => ({
                            segmentId: o.segmentId,
                            sourceSegmentId: o.sourceSegmentId,
                            claim: o.claim,
                            why: o.rejection,
                          })),
                      },
                      derivedBlocks: blocks,
                      predicateMapping: derivation.predicateMapping,
                      sharedExistencePredicates:
                        derivation.sharedExistencePredicates,
                      injectedAxioms: derivation.injectedAxioms,
                      blockAssignments: selected.map((block) => ({
                        block: block.name,
                        communityId: block.communityId,
                        communityIds: block.communityIds,
                        communityLabel: block.communityLabel,
                        positionLabel: block.positionLabel,
                        assertionScope: block.assertionScope,
                        assertionContextId: block.assertionContextId,
                        claimKeys: block.claimKeys,
                        segmentIds: block.segmentIds,
                      })),
                      derivationRejections: derivation.rejected,
                      supportingClaimKeys: [...supportingKeys].sort(),
                      supportingClaimRefs: [...supportingRefs].sort(),
                      // Accepted source sentences plus typed roles form the
                      // fidelity oracle for optional narrative densification.
                      supportingClaimEvidence,
                      verdict,
                      ...cohomology,
                      ...summarizeCheckLog(checkLog, {
                        runLogId: runLog.runId,
                      }),
                    },
                    null,
                    2,
                  );
                }
              }
            } else if (fnName === "get_check_log") {
              const rawBlocks = Array.isArray(args.blocks)
                ? args.blocks.map((b: unknown) => String(b)).filter(Boolean)
                : undefined;
              output = JSON.stringify(
                await readCheckLog({
                  runLogId: String(args.runLogId ?? ""),
                  kind: args.kind ? (String(args.kind) as any) : undefined,
                  verdict: args.verdict
                    ? (String(args.verdict) as any)
                    : undefined,
                  blocks: rawBlocks?.length ? rawBlocks : undefined,
                  limit: Number.isFinite(Number(args.limit))
                    ? Number(args.limit)
                    : undefined,
                  offset: Number.isFinite(Number(args.offset))
                    ? Number(args.offset)
                    : undefined,
                }),
                null,
                2,
              );
            } else if (fnName === "list_finding_conflicts") {
              output = JSON.stringify(
                await findingStore.listOpenConflicts(),
                null,
                2,
              );
            } else if (fnName === "resolve_finding_conflict") {
              const candidateId = String(args.candidateId ?? "");
              const winnerFindingId = String(args.winnerFindingId ?? "");
              const reason = String(args.reason ?? "");
              output = JSON.stringify(
                await findingStore.resolveConflict(
                  candidateId,
                  winnerFindingId,
                  reason,
                ),
                null,
                2,
              );
            } else if (fnName === "get_graph_topology") {
              const detail = args.detail ?? args.level ?? "concepts";
              const full = agemBridge.getGraphSummary();
              if (detail === "words") {
                output = JSON.stringify(full, null, 2);
              } else {
                // Concept-level: just communities + bridges + summary stats
                const cg = full.concept_graph;
                output = cg
                  ? JSON.stringify(
                      {
                        ...cg,
                        total_nodes: full.node_count,
                        total_edges: full.edge_count,
                      },
                      null,
                      2,
                    )
                  : JSON.stringify(
                      {
                        total_nodes: full.node_count,
                        total_edges: full.edge_count,
                        note: "No communities computed yet. Run an AGEM cycle first.",
                      },
                      null,
                      2,
                    );
              }
            } else if (fnName === "get_soc_metrics") {
              output = JSON.stringify(agemBridge.getSOCMetrics(), null, 2);
            } else if (fnName === "detect_gaps") {
              output = JSON.stringify(agemBridge.detectGaps(), null, 2);
            } else if (fnName === "generate_catalyst_questions") {
              const gapId = args.gap_id ?? args.gapId ?? args.gap ?? undefined;
              output = JSON.stringify(
                await agemBridge.generateCatalystQuestions(
                  gapId,
                  Number(args.max_proposals ?? 6),
                  requestDeadline.signal,
                ),
                null,
                2,
              );
            } else if (fnName === "search_context") {
              const query = args.query ?? args.search_query ?? args.text ?? "";
              const results = await agemBridge.searchContext(
                query,
                args.max_results,
                requestDeadline.signal,
              );
              output = JSON.stringify(results, null, 2);
            } else if (fnName === "abduce_best_explanation") {
              /*
               * Peirce's middle premise is a prover call, not an assertion.
               * `prove` is used rather than the SatOracle used elsewhere in
               * this file because abduction asks whether the observation would
               * FOLLOW from a cause, which is entailment, not satisfiability.
               */
              const proofOracle: ProofOracle = async (premises, goal) => {
                try {
                  const raw = await mcpManager.executeTool(
                    "mcp-logic",
                    "prove",
                    { premises: [...premises], conclusion: goal },
                    requestDeadline.signal,
                  );
                  let parsed: any;
                  try {
                    parsed = JSON.parse(raw);
                  } catch {
                    parsed = { result: "", complete_output: raw };
                  }
                  /*
                   * Response shapes verified against the live mcp-logic server
                   * on 2026-07-30, not inferred from its docs:
                   *   proved       → { result, proof, stats, method }
                   *   unprovable   → { result, reason, hint, method }
                   *   syntax_error → { result, validation: { formula_results } }
                   */
                  const result = String(parsed.result ?? "");
                  if (result === "proved") {
                    return {
                      outcome: "proved",
                      detail:
                        String(parsed.proof ?? "").slice(0, 400) || undefined,
                    };
                  }
                  if (result === "unprovable") {
                    return { outcome: "unprovable" };
                  }
                  /*
                   * A malformed formula is NOT an undecided one, and collapsing
                   * the two hides the only failure the caller can actually fix.
                   * Without this branch a hypothesis with an unmatched paren
                   * comes back as `undecided` — "the prover could not settle
                   * it" — which reads as a hard logical problem rather than a
                   * typo. Name the offending formula and the parser's reason.
                   */
                  if (result === "syntax_error") {
                    const bad = (parsed.validation?.formula_results ?? [])
                      .filter((entry: any) => entry?.valid === false)
                      .map(
                        (entry: any) =>
                          `${entry.formula}: ${(entry.errors ?? []).join("; ")}`,
                      );
                    const setErrors = parsed.validation?.set_errors ?? [];
                    return {
                      outcome: "error",
                      detail: `syntax_error — ${[...bad, ...setErrors].join(" | ") || "malformed input"}`.slice(
                        0,
                        400,
                      ),
                    };
                  }
                  return {
                    outcome: "error",
                    detail: String(
                      parsed.error ?? (result || "unrecognised prover response"),
                    ).slice(0, 400),
                  };
                } catch (error) {
                  return {
                    outcome: "error",
                    detail: error instanceof Error ? error.message : String(error),
                  };
                }
              };

              const rawObservation = (args.observation ?? {}) as Record<string, unknown>;
              const background = Array.isArray(args.background)
                ? args.background.map(String).filter(Boolean)
                : [];
              const corpusVocabulary = (
                agemBridge.getGraphSummary().concept_graph?.communities ?? []
              ).flatMap((community: { members?: string[] }) => community.members ?? []);

              const observation: Observation = {
                id: String(rawObservation.id ?? "obs-1"),
                phenomenon: String(rawObservation.phenomenon ?? ""),
                source: String(
                  rawObservation.source ?? "unexplained-assertion",
                ) as AnomalySource,
                segmentIds: Array.isArray(rawObservation.segmentIds)
                  ? rawObservation.segmentIds.map(String).filter(Boolean)
                  : [],
                formula: rawObservation.formula
                  ? String(rawObservation.formula)
                  : undefined,
                constituentFormulas: Array.isArray(
                  rawObservation.constituentFormulas,
                )
                  ? rawObservation.constituentFormulas.map(String).filter(Boolean)
                  : undefined,
                signals: (rawObservation.signals ?? {}) as Record<string, never>,
              };

              const hypotheses: Hypothesis[] = (
                Array.isArray(args.hypotheses) ? args.hypotheses : []
              )
                .map((raw: unknown) => {
                  const item = (raw ?? {}) as Record<string, unknown>;
                  const formula = String(item.formula ?? "").trim();
                  if (!formula) return null;
                  const leaps = leapsOfFaith(formula, corpusVocabulary, background);
                  return {
                    id: String(item.id ?? "") || hypothesisId(formula),
                    proposedCause: String(item.proposedCause ?? formula),
                    formula,
                    vocabulary: Array.isArray(item.vocabulary)
                      ? item.vocabulary.map(String)
                      : predicateSymbols(formula),
                    leapsOfFaith: leaps,
                    provenance:
                      leaps.length === 0
                        ? ("corpus-vocabulary" as const)
                        : ("exogenous" as const),
                  };
                })
                .filter((item: Hypothesis | null): item is Hypothesis => item !== null);

              const abduction = await executeAbductiveLeap(
                observation,
                hypotheses,
                {
                  background,
                  existenceWitnesses: Array.isArray(args.existenceWitnesses)
                    ? args.existenceWitnesses.map(String).filter(Boolean)
                    : [],
                  oracle: proofOracle,
                  maxProverCalls: Number(args.maxProverCalls ?? 64),
                },
              );

              runLog.event("abduction", {
                runLogId: runLog.runId,
                observationId: observation.id,
                source: observation.source,
                isAnomalous: abduction.assessment.isAnomalous,
                criterion: abduction.assessment.criterion,
                candidates: hypotheses.length,
                proverCalls: abduction.proverCalls,
                proverFailures: abduction.proverFailures,
                bestHypothesisId: abduction.best?.hypothesis.id,
              });

              output = JSON.stringify(
                {
                  runLogId: runLog.runId,
                  inferenceKind: "abduction",
                  // Restated at the top of the payload so a reader who skims
                  // cannot mistake the ranking for a verdict.
                  epistemicStatus:
                    "PROVISIONAL — abduction justifies adopting a hypothesis for testing. It establishes nothing, no finding is stored, and formal verification is not satisfied.",
                  ...abduction,
                },
                null,
                2,
              );
            } else if (fnName === "build_defensible_claim") {
              try {
                const claim = await constructClaim({
                  decision: (args.decision ?? {
                    question: "",
                  }) as { question: string; subQuestions?: string[] },
                  recommendation: String(args.recommendation ?? ""),
                  statements: Array.isArray(args.statements)
                    ? (args.statements as CandidateStatement[])
                    : [],
                  disconfirmingSearch:
                    args.disconfirmingSearch as DisconfirmingSearch,
                  initialScope: args.initialScope as ClaimScope | undefined,
                  initialCertainty: args.initialCertainty as
                    | ClaimCertainty
                    | undefined,
                  embed: async (text: string) =>
                    Array.from(
                      await claimBlockEmbedder.embed(
                        text,
                        requestDeadline.signal,
                      ),
                    ),
                });

                runLog.event("evidential_claim", {
                  runLogId: runLog.runId,
                  scope: claim.scope,
                  certainty: claim.certainty,
                  grounds: claim.grounds.length,
                  contradicting: claim.contradicting.length,
                  dropped: claim.dropped.length,
                  calibrationSteps: claim.calibration.steps.length,
                  groundsStrength: claim.calibration.groundsStrength,
                  cannotStand: claim.cannotStand,
                });

                output = JSON.stringify(
                  {
                    runLogId: runLog.runId,
                    inferenceKind: "evidential",
                    epistemicStatus:
                      "DEFEASIBLE — an evidential claim from checkable grounds. It is not a logical verdict, does not satisfy formal verification, and can be defeated by new evidence.",
                    disconfirmingSearch: args.disconfirmingSearch,
                    ...claim,
                  },
                  null,
                  2,
                );
              } catch (error) {
                if (error instanceof DisconfirmingSearchRequired) {
                  output = JSON.stringify({
                    error: error.message,
                    inferenceKind: "evidential",
                    remedy:
                      "Run the disconfirming search first — search_context or the corpus segments, asking what would show the recommendation is false — then call again with {query, searchedIn, found}.",
                  });
                } else {
                  throw error;
                }
              }
            } else if (fnName === "spawn_agem_agent") {
              const persona =
                args.persona ?? args.agent_persona ?? args.role ?? "General";
              const spawnResult = agemBridge.spawnAgent(persona);
              output = spawnResult.message;
            } else if (fnName === "reset_agem_engine") {
              await agemBridge.reset();
              output = "AGEM engine reset.";
            } else if (fnName === "create_skill") {
              const skillName = args.name ?? "unnamed-skill";
              const desc = args.description ?? "No description.";
              const body = args.content ?? "";
              try {
                if (typeof skillName !== "string" || !/^[a-zA-Z0-9_-]+$/.test(skillName)) {
                  throw new Error("Invalid skill name format. Only alphanumeric characters, hyphens, and underscores are allowed.");
                }
                const baseSkillsDir = path.resolve(process.cwd(), "..", "..", "skills");
                const skillDir = path.normalize(path.join(baseSkillsDir, path.basename(skillName)));
                if (!skillDir.startsWith(baseSkillsDir + path.sep)) {
                  throw new Error("Invalid skill name (path traversal detected)");
                }
                const targetFilePath = path.normalize(path.join(skillDir, "SKILL.md"));
                if (!targetFilePath.startsWith(baseSkillsDir + path.sep)) {
                  throw new Error("Invalid skill path (path traversal detected)");
                }
                await fs.mkdir(skillDir, { recursive: true });
                const frontmatter = `---\nname: "${skillName}"\ndescription: "${desc}"\n---\n\n`;
                await fs.writeFile(
                  targetFilePath,
                  frontmatter + body,
                  "utf8",
                );
                await skillRegistry.initialize();
                output = `Skill '${skillName}' created/updated and reloaded.`;
              } catch (err: any) {
                output = `Error creating skill: ${err.message}`;
              }
            } else if (fnName === "list_scenarios") {
              const scenarios = await scenarioService.listScenarios();
              output =
                scenarios.length === 0
                  ? "No scenarios found. Use generate_scenario to create one."
                  : JSON.stringify(scenarios, null, 2);
            } else if (fnName === "load_scenario") {
              const id = args.id ?? args.scenario_id ?? "";
              const scenario = await scenarioService.loadScenario(id);
              output = scenario
                ? JSON.stringify(scenario, null, 2)
                : `Scenario '${id}' not found.`;
            } else if (fnName === "generate_scenario") {
              try {
                const scenario = {
                  id: args.id,
                  title: args.title,
                  description: args.description,
                  category: args.category ?? "custom",
                  metric_target: args.metric_target ?? "",
                  turns: args.turns ?? [],
                  constraints: {
                    vk_axioms: args.vk_axioms ?? ["VK1"],
                    omega_refs: args.omega_refs,
                    expected_tier: args.expected_tier,
                  },
                  source: "generated" as const,
                  origin_context: args.origin_context,
                  created_at: new Date().toISOString(),
                };
                const filePath = await scenarioService.saveScenario(scenario);
                output = `Scenario '${scenario.id}' saved to ${filePath}.\n${JSON.stringify(scenario, null, 2)}`;
              } catch (err: any) {
                output = `Error creating scenario: ${err.message}`;
              }
            } else if (fnName === "run_scenario") {
              const id = args.id ?? args.scenario_id ?? "";
              const run = await scenarioService.startRun(id);
              if (!run) {
                output = `Scenario '${id}' not found or has no turns.`;
              } else {
                output =
                  `# Scenario Started: ${run.scenario.title}\n\n` +
                  `Category: ${run.scenario.category}\n` +
                  `Turns: ${run.scenario.turns.length}\n` +
                  `VK Axioms: ${run.scenario.constraints.vk_axioms.join(", ")}\n` +
                  `Metric Target: ${run.scenario.metric_target}\n\n` +
                  run.instructions;
              }
            } else if (fnName === "record_scenario_turn") {
              const state = agemBridge.getState();
              const socMetrics = agemBridge.getSOCMetrics();
              const latest = socMetrics.latest;
              const activeRun = scenarioService.getActiveRun();
              const turnMetrics: any = {
                turn: activeRun?.currentTurn ?? 0,
                iteration: state.iteration,
                vne: latest?.von_neumann_entropy ?? 0,
                ee: latest?.embedding_entropy ?? 0,
                cdp: latest?.cdp ?? 0,
                ser: latest?.surprising_edge_ratio ?? 0,
                correlation: latest?.correlation_coefficient ?? 0,
                h1_dimension: args.h1_dimension ?? state.sheaf_energy ?? 0,
                gap_count: state.gap_count,
                communities: state.communities,
                node_count: state.graph_summary?.node_count ?? 0,
                edge_count: state.graph_summary?.edge_count ?? 0,
                regime: socMetrics.regime?.regime ?? "unknown",
                selection: state.evolution?.selection ?? 0,
                transmission: state.evolution?.transmission ?? 0,
                explore_exploit: state.evolution?.explore_exploit_ratio ?? 0.5,
                vk_coboundary: args.vk_coboundary ?? 0,
                vk_dual_variable: args.vk_dual_variable ?? 0,
                closure_status: args.closure_status ?? "unknown",
                action_taken: args.action_taken ?? "unknown",
                ethical_risk: args.ethical_risk ?? "unknown",
              };
              const result = scenarioService.recordTurn(turnMetrics);
              if (!result.recorded) {
                output = "No active scenario run. Use run_scenario first.";
              } else if (result.isComplete) {
                output =
                  `Turn recorded. Action: ${args.action_taken}\n\n` +
                  (result.reveal ? `**REVEAL:** ${result.reveal}\n\n` : "") +
                  "All turns recorded. Call complete_scenario to finalize and save results.";
              } else {
                output =
                  `Turn recorded. Action: ${args.action_taken}\n\n` +
                  (result.reveal ? `**REVEAL:** ${result.reveal}\n\n` : "") +
                  (result.nextInstructions ?? "");
              }
            } else if (fnName === "complete_scenario") {
              const result = await scenarioService.completeRun();
              if (!result) {
                output = "No active scenario run to complete.";
              } else {
                output =
                  `# Scenario Complete: ${result.scenario_title}\n\n` +
                  `## Summary\n` +
                  `- Turns: ${result.summary.total_turns}\n` +
                  `- H¹ Spikes: ${result.summary.h1_spikes}\n` +
                  `- Max Coboundary: ${result.summary.max_coboundary.toFixed(4)}\n` +
                  `- Max Dual Variable: ${result.summary.max_dual_variable.toFixed(4)}\n` +
                  `- Regime Changes: ${result.summary.regime_changes.length > 0 ? result.summary.regime_changes.join(", ") : "none"}\n` +
                  `- Final Regime: ${result.summary.final_regime}\n` +
                  `- Ethical Violations Flagged: ${result.summary.ethical_violations_flagged}\n\n` +
                  `Results saved to scenarios/results/`;
              }
            } else if (fnName === "list_mcp_servers") {
              // Meta-tool: list connected MCP servers
              const serverNames = mcpManager.getServerNames();
              const serverList = await Promise.all(
                serverNames.map(async (name: string) => {
                  try {
                    const tools = await mcpManager.getServerTools(name);
                    return {
                      name,
                      tool_count: tools.length,
                      status: "connected",
                    };
                  } catch {
                    return { name, tool_count: 0, status: "error" };
                  }
                }),
              );
              output = JSON.stringify(serverList, null, 2);
            } else if (fnName === "list_server_tools") {
              // Meta-tool: list tools on a specific server
              const sName = (args.server_name ?? args.server ?? "")
                .toString()
                .replace(/^:/, "");
              try {
                const serverTools = await mcpManager.getServerTools(sName);
                output = JSON.stringify(serverTools, null, 2);
              } catch (e: any) {
                output = `Error: Server '${sName}' not found or not connected. ${e.message}`;
              }
            } else if (fnName === "call_mcp_tool") {
              // Meta-tool: call any tool on any server
              // Strip leading colon — models sometimes send ":server-name" instead of "server-name"
              const sName = (args.server_name ?? args.server ?? "")
                .toString()
                .replace(/^:/, "");
              const tName = (args.tool_name ?? args.tool ?? "").toString();
              let tArgs = args.arguments ?? args.args ?? {};

              // If tArgs is empty but there are extra keys in args beyond the
              // meta-tool params, the model put tool args at the top level.
              // Extract them into tArgs.
              if (
                typeof tArgs === "object" &&
                Object.keys(tArgs as object).length === 0
              ) {
                const metaKeys = new Set([
                  "server_name",
                  "server",
                  "tool_name",
                  "tool",
                  "arguments",
                  "args",
                ]);
                const extracted: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(args)) {
                  if (k === "__proto__" || k === "constructor" || k === "prototype") {
                    continue;
                  }
                  if (!metaKeys.has(k)) {
                    Object.defineProperty(extracted, k, {
                      value: v,
                      writable: true,
                      enumerable: true,
                      configurable: true,
                    });
                  }
                }
                if (Object.keys(extracted).length > 0) {
                  tArgs = extracted;
                  console.log(
                    `[Chat] Extracted top-level MCP args for ${sName}/${tName}: ${JSON.stringify(extracted)}`,
                  );
                }
              }

              // If tArgs is a JSON string, parse it
              if (typeof tArgs === "string") {
                try {
                  tArgs = JSON.parse(tArgs);
                } catch {
                  // Might be a plain text value — wrap it based on known tool signatures
                  tArgs = { text: tArgs };
                  console.log(
                    `[Chat] Wrapped string MCP arg as {text: ...} for ${sName}/${tName}`,
                  );
                }
              }

              // ─── Parameter normalization for common MCP tool mistakes ───
              // Models frequently guess wrong parameter names for MCP tools.
              // Rather than letting them fail and waste a turn, normalize here.
              tArgs = normalizeMcpToolArgs(sName, tName, tArgs);

              toolLabel = `${sName}/${tName}`;
              // No inner catch: MCP failures are exactly the ones that benefit
              // from the recovery ladder (transient transport faults retry,
              // schema faults get patched). Swallowing them here would hide
              // both from the protocol.
              output = await mcpManager.executeTool(
                sName,
                tName,
                tArgs,
                requestDeadline.signal,
              );
            } else if (fnName.startsWith("mcp__")) {
              const parts = fnName.split("__");
              const serverName = parts[1];
              const toolName = parts.slice(2).join("__");
              toolLabel = `${serverName}/${toolName}`;
              // Same normalization the call_mcp_tool path gets. These two
              // branches reach the identical MCP tools; only the calling
              // convention differs, so they must not disagree on arg shape.
              const directArgs = normalizeMcpToolArgs(
                serverName,
                toolName,
                args,
              );
              output = await mcpManager.executeTool(
                serverName,
                toolName,
                directArgs,
                requestDeadline.signal,
              );
            } else {
              throw new Error(`Unknown tool ${fnName}`);
            }
          }

          requestDeadline.signal.throwIfAborted();
          return { output, label: toolLabel };
        };

        // ─── Batch dispatch ───
        // Parse every call up front so the scheduler can see side-effect
        // classes before anything runs, then execute: consecutive read-only
        // calls concurrently, mutating calls serially and in order. Results
        // come back indexed by original position, so history order is
        // deterministic regardless of completion order.
        const parsedCalls = result.tool_calls.map((tc: any) => ({
          tc,
          fnName: tc.function.name as string,
          args: parseToolArgs(tc),
        }));

        type ExecutedCall = {
          tc: any;
          fnName: string;
          toolLabel: string;
          output: string;
          elapsedMs: number;
          ok: boolean;
        };

        const executed = await dispatchBatch<
          (typeof parsedCalls)[number],
          ExecutedCall
        >(
          parsedCalls,
          async ({ tc, fnName, args }) => {
            sendEvent("system", { content: `\n[Executing: ${fnName}]\n` });
            const toolStart = Date.now();
            console.log(
              `[Chat] Executing tool ${fnName} (id: ${tc.id}) with args:`,
              JSON.stringify(args),
            );
            runLog.toolCall(fnName, args);

            const budgetDecision = assessToolBudget(
              fnName,
              requestDeadline.remainingMs(),
              {
                extractionMinimumMs:
                  settings.all.CLAIM_EXTRACTION_MIN_REMAINING_MS,
                previousDurationMs: successfulToolDurations.get(fnName),
                finalizationReserveMs: 30_000,
              },
            );
            if (!budgetDecision.allowed) {
              deferredTool = {
                name: fnName,
                remainingMs: budgetDecision.remainingMs,
                requiredMs: budgetDecision.requiredMs,
              };
              const output = JSON.stringify(
                {
                  status: budgetDecision.status,
                  semanticsValidated: false,
                  remainingMs: budgetDecision.remainingMs,
                  requiredMs: budgetDecision.requiredMs,
                  remedy:
                    "Start a new request to continue verification from the persisted engine state.",
                  message: budgetDecision.message,
                },
                null,
                2,
              );
              runLog.event("tool_deferred", {
                tool: fnName,
                status: budgetDecision.status,
                remainingMs: budgetDecision.remainingMs,
                requiredMs: budgetDecision.requiredMs,
              });
              runLog.toolResult(fnName, output);
              console.warn(`[Chat] ${budgetDecision.message}`);
              return {
                tc,
                fnName,
                toolLabel: fnName,
                output,
                elapsedMs: Date.now() - toolStart,
                ok: true,
              };
            }

            const outcome = await recovery.execute(fnName, args, {
              run: async (a) => {
                try {
                  return await runToolOnce(fnName, a);
                } catch (error) {
                  if (requestDeadline.timedOut) {
                    throw new ToolRequestDeadlineError(
                      fnName,
                      Date.now() - toolStart,
                      settings.all.CHAT_REQUEST_TIMEOUT_MS,
                      { cause: error },
                    );
                  }
                  throw error;
                }
              },
              signal: requestDeadline.signal,
              // Non-idempotent calls are never blind-retried. run_agem_cycle
              // ingests into a persistent accumulating graph: a silent retry
              // would double-count the same co-occurrences.
              retryBudget: isRetrySafe(fnName, args)
                ? undefined
                : 0,
              // Level-2 repair: the same deterministic normalizer used
              // pre-emptively on the MCP paths, now also wired as a
              // failure-triggered patch.
              patch: (a) => {
                const target =
                  fnName === "call_mcp_tool"
                    ? {
                        server: String(
                          (a as any).server_name ?? (a as any).server ?? "",
                        ),
                        tool: String(
                          (a as any).tool_name ?? (a as any).tool ?? "",
                        ),
                      }
                    : fnName.startsWith("mcp__")
                      ? {
                          server: fnName.split("__")[1] ?? "",
                          tool: fnName.split("__").slice(2).join("__"),
                        }
                      : null;
                if (!target || !target.server || !target.tool) return null;
                if (fnName === "call_mcp_tool") {
                  const inner = (a as any).arguments ?? (a as any).args;
                  if (inner && typeof inner === "object") {
                    return {
                      ...a,
                      arguments: normalizeMcpToolArgs(
                        target.server,
                        target.tool,
                        inner as Record<string, unknown>,
                      ),
                    };
                  }
                  return null;
                }
                return normalizeMcpToolArgs(target.server, target.tool, a);
              },
              // Diagnostic context C_diag. Full detail lands in the run log
              // only — never in historyMessages, and therefore never in the
              // graph.
              onDiagnostic: (event) => runLog.event("recovery", event),
            });

            let effectiveOutput = outcome.ok
              ? annotateArtifactOutput(fnName, outcome.output, runIntent)
              : outcome.output;
            if (outcome.ok) {
              try {
                const findingContext = {
                  runLogId: runLog.runId,
                  producedByModel: effectiveModel,
                  memoryNamespace,
                };
                /*
                 * Two capture gates, tried in order, never merged. The typed
                 * gate refuses every tool but `extract_and_verify_claims`, and
                 * that refusal is what keeps hand-authored logic out of
                 * long-term memory. The evidential gate has its own receipts —
                 * a real disconfirming search, checkable grounds, a claim that
                 * survived calibration — and is reached only when the typed
                 * gate has already declined.
                 */
                const finding =
                  captureFindingFromTool(
                    fnName,
                    args,
                    effectiveOutput,
                    findingContext,
                  ) ??
                  captureEvidentialFindingFromTool(
                    fnName,
                    args,
                    effectiveOutput,
                    findingContext,
                  );
                if (finding) {
                  let densificationResult: DensificationResult | undefined;
                  const narrativeRequest = captureFindingNarrativeFromTool(
                    fnName,
                    args,
                    effectiveOutput,
                  );
                  if (narrativeRequest) {
                    try {
                      densificationResult =
                        await findingNarrativeDensifier.densify(
                          {
                            ...narrativeRequest,
                            model: effectiveModel,
                            provider: resolvedProvider,
                          },
                          requestDeadline.signal,
                        );
                      if (densificationResult.condensedNarrative) {
                        finding.condensedNarrative =
                          densificationResult.condensedNarrative;
                      }
                      runLog.event("finding_densification", {
                        status: densificationResult.status,
                        passes: densificationResult.passes,
                        sourceTokens: densificationResult.sourceTokens,
                        targetTokens: densificationResult.targetTokens,
                        schemaEnvelopeTokens:
                          densificationResult.schemaEnvelopeTokens,
                        outputTokens: densificationResult.outputTokens,
                        narrativeTokens: densificationResult.narrativeTokens,
                        minimumNarrativeTokens:
                          densificationResult.minimumNarrativeTokens,
                        missingFactCount:
                          densificationResult.missingFacts?.length ?? 0,
                        note: densificationResult.note,
                      });
                    } catch (error) {
                      // Optional compression must never make a verified
                      // finding disappear. The verbatim fields still store.
                      const message =
                        error instanceof Error ? error.message : String(error);
                      densificationResult = {
                        status: "internal-error",
                        passes: 0,
                        sourceTokens: 0,
                        note: message,
                      };
                      runLog.event("finding_densification", {
                        status: densificationResult.status,
                        message,
                      });
                    }
                  }
                  const memory = await findingStore.store(
                    finding,
                    requestDeadline.signal,
                  );
                  effectiveOutput = attachFindingMemory(
                    effectiveOutput,
                    memory,
                    densificationResult,
                  );
                  runLog.event("finding_write", {
                    findingId: memory.finding.id,
                    stored: memory.stored,
                    conflictCandidates: memory.conflicts.map((c) => c.id),
                    method: memory.finding.method,
                    outcome: memory.finding.outcome,
                    memoryNamespace: memory.finding.memoryNamespace,
                    condensedNarrativeStored:
                      !!memory.finding.condensedNarrative,
                    densificationStatus:
                      densificationResult?.status ??
                      (memory.finding.method === "derived-from-claims"
                        ? "not-attempted"
                        : "not-applicable"),
                  });
                  sendEvent("finding_memory", {
                    finding_id: memory.finding.id,
                    conflict_candidates: memory.conflicts,
                    condensed_narrative_stored:
                      !!memory.finding.condensedNarrative,
                    densification_status:
                      densificationResult?.status ??
                      (memory.finding.method === "derived-from-claims"
                        ? "not-attempted"
                        : "not-applicable"),
                  });
                }
              } catch (error) {
                // A verified tool result remains valid if memory persistence is
                // temporarily unavailable. Log the degradation; never relabel
                // the underlying logic call as failed.
                runLog.event("finding_write_error", {
                  tool: fnName,
                  message:
                    error instanceof Error ? error.message : String(error),
                });
                console.warn("[Chat] Automatic finding write unavailable:", error);
              }
            }
            const elapsedMs = Date.now() - toolStart;
            if (!outcome.ok) {
              if (outcome.diagnosis?.errorClass === "cancelled") {
                console.warn(
                  `[Chat] Request deadline interrupted ${fnName} after ${elapsedMs}ms`,
                );
              } else {
                console.error(
                  `[Chat] Tool ${fnName} failed after ${outcome.attempts} attempt(s) ` +
                    `(class=${outcome.diagnosis?.errorClass}, L${outcome.level}): ${outcome.diagnosis?.phi}`,
                );
              }
            }
            // The run log gets the real story; history gets the terse notice.
            runLog.toolResult(
              fnName,
              outcome.ok ? effectiveOutput : (outcome.detail ?? outcome.output),
            );
            if (elapsedMs > 10000) {
              console.warn(`[Chat] Slow tool: ${fnName} took ${elapsedMs}ms`);
            } else if (outcome.ok) {
              console.log(
                `[Chat] Tool ${fnName} completed in ${elapsedMs}ms (${effectiveOutput.length} chars)`,
              );
            }

            // Only successful calls count toward the output contract.
            if (outcome.ok) {
              successfulToolDurations.set(fnName, elapsedMs);
              workflowContract.record(
                fnName,
                outcome.label,
                workflowToolOutcomeFromOutput(fnName, effectiveOutput),
              );
            }

            return {
              tc,
              fnName,
              toolLabel: outcome.label,
              output: effectiveOutput,
              elapsedMs,
              ok: outcome.ok,
            };
          },
          {
            classify: ({ fnName, args }) => sideEffectClass(fnName, args),
            maxConcurrency: settings.all.TOOL_MAX_CONCURRENCY,
            onWave: (wave, i) => {
              if (wave.kind === "pure" && wave.calls.length > 1) {
                console.log(
                  `[Chat] Wave ${i}: dispatching ${wave.calls.length} read-only tools in parallel`,
                );
              }
            },
          },
        );

        // Emit results and extend history in ORIGINAL call order.
        for (const r of executed) {
          const toolResult = {
            tool: r.toolLabel,
            elapsed_ms: r.elapsedMs,
            output: r.output,
          };
          allTurnToolResults.push(toolResult);

          // Locate the corresponding assistant message in history and append the marker/result
          const currentAssistantMessage = [...historyMessages]
            .reverse()
            .find((m) => m.role === "assistant");
          if (currentAssistantMessage) {
            if (!currentAssistantMessage.metadata) {
              currentAssistantMessage.metadata = {
                model,
                provider: providerType,
                tool_results: [],
              };
            } else if (!currentAssistantMessage.metadata.tool_results) {
              currentAssistantMessage.metadata.tool_results = [];
            }

            const toolIdx =
              currentAssistantMessage.metadata.tool_results.length;
            currentAssistantMessage.content += `\n\n:::tool_result[${toolIdx}]:::\n\n`;
            currentAssistantMessage.metadata.tool_results.push(toolResult);
          }

          sendEvent("tool_result", toolResult);

          // Format tool result per provider spec
          if (isOllama) {
            // Ollama: {role: "tool", tool_name: "...", content: "..."}
            // We also include tool_call_id for cross-provider session stability (e.g. switching to Anthropic)
            historyMessages.push({
              role: "tool",
              tool_call_id: r.tc.id,
              tool_name: r.fnName,
              content: r.output,
            });
          } else {
            // OpenRouter/Anthropic/MiniMax: {role: "tool", tool_call_id: "...", content: "..."}
            historyMessages.push({
              role: "tool",
              tool_call_id: r.tc.id,
              name: r.fnName,
              content: r.output,
            });
          }
        }
        typedFinalization = executed
          .filter((call) => call.fnName === "extract_and_verify_claims" && call.ok)
          .map((call) => typedVerificationFinalization(call.output))
          .find((finalization): finalization is TypedVerificationFinalization =>
            finalization !== null,
          );
        const evidentialClaimBuilt = executed.some(
          (call) => call.fnName === "build_defensible_claim" && call.ok,
        );
        if (
          typedFinalization &&
          typedFinalization.evidentialPathOffered &&
          !evidentialPathGranted &&
          turnCount < maxTurns
        ) {
          /*
           * The typed path failed because the corpus is not formalizable, not
           * because anything is broken. Hard-stopping here is what produced a
           * run that mapped 746 concepts into 14 communities and then reported
           * only that verification had aborted.
           *
           * So grant ONE turn on a narrowed tool surface instead. The surface
           * is the point: extract_and_verify_claims and
           * evaluate_logical_consistency are absent, so this cannot become a
           * retry of the thing that structurally cannot work, and the model
           * cannot author logic by hand to fill the gap. What remains can only
           * produce a defeasible, provenance-bearing claim that is labelled as
           * such and still fails the verify/derive contract items.
           */
          evidentialPathGranted = true;
          tools = tools.filter((tool: any) =>
            ["search_context", "build_defensible_claim"].includes(
              tool?.function?.name,
            ),
          );
          historyMessages.push({
            role: "user",
            content: typedFinalization.instruction,
          });
          runLog.event("evidential_path_granted", {
            reason: typedFinalization.reason,
            causeKind: "structural-mismatch",
            allowedTools: tools.map((tool: any) => tool?.function?.name),
          });
        } else if (
          typedFinalization &&
          turnCount < maxTurns &&
          !evidentialPathGranted
        ) {
          finalResponsePending = true;
          tools = [];
          terminalStatus = "contract-unmet";
          sendEvent("final_start", { status: terminalStatus });
          historyMessages.push({
            role: "user",
            content: typedFinalization.instruction,
          });
          runLog.event("finalization_required", {
            reason: typedFinalization.reason,
            tool: "extract_and_verify_claims",
          });
        } else if (evidentialPathGranted && evidentialClaimBuilt) {
          // The granted turn has been spent. Close the run rather than leaving
          // the narrowed surface open for further calls.
          finalResponsePending = true;
          tools = [];
          terminalStatus = "contract-unmet";
          sendEvent("final_start", { status: terminalStatus });
          historyMessages.push({
            role: "user",
            content: [
              "The evidential claim is built. Do not call any more tools.",
              "Write the final response now. Label the FORMAL result INCONCLUSIVE and name its",
              "reported failure causes; present the evidential claim as defeasible and clearly",
              "separate from any logical verdict; report the graph results as structural.",
            ].join("\n"),
          });
          runLog.event("finalization_required", {
            reason: "evidential-path-complete",
            tool: "build_defensible_claim",
          });
        } else if (deferredTool && turnCount < maxTurns) {
          finalResponsePending = true;
          tools = [];
          terminalStatus = "contract-unmet";
          sendEvent("final_start", { status: terminalStatus });
          historyMessages.push({
            role: "user",
            content: [
              `${deferredTool.name} was deferred because the request budget could not safely fund it.`,
              "Do not call or request more tools. Write the final user-facing response now.",
              "Explicitly label the result PARTIAL / DEFERRED, name the unmet verification, and explain that persisted engine state can be continued in a new request.",
            ].join("\n"),
          });
          runLog.event("finalization_required", {
            reason: "tool-deferred",
            tool: deferredTool.name,
            remainingMs: deferredTool.remainingMs,
            requiredMs: deferredTool.requiredMs,
          });
        }
      } else {
        if (finalResponsePending) {
          finalResponsePending = false;
          isDone = true;
          continue;
        }
        // No tool calls — the model believes it is finished. Validate that
        // against the output contract rather than against a turn count: a run
        // that completed the workflow in three turns is done, and one that
        // burned six turns without ingesting anything is not.
        const contractNudge = workflowContract.nudge();
        if (contractNudge) {
          const unmetItems = workflowContract.evaluate().unmet;
          const unmetIds = unmetItems.map((item) => item.id);
          const unmet = unmetIds.join(", ");
          console.log(
            `[Chat] Contract unmet at turn ${turnCount}/${maxTurns} (${unmet}) — nudging`,
          );
          runLog.event("contract_nudge", {
            turn: turnCount,
            unmet,
            contract: workflowContract.summary(),
          });
          historyMessages.push({ role: "user", content: contractNudge });
          const allowedNames = toolNamesForUnmetWorkflow(unmetIds);
          tools = tools.filter((tool) =>
            allowedNames.has(String(tool?.function?.name ?? "")),
          );
          runLog.event("contract_tool_surface", {
            turn: turnCount,
            allowedTools: [...allowedNames],
          });
        } else {
          // Contract satisfied, nudge budget spent, or the same gap was
          // already raised once — either way, stop. Bounded by construction.
          isDone = true;
        }
      }
    }

    if (turnCount >= maxTurns && !isDone) {
      console.warn(`[Chat] Hit max turns (${maxTurns}) — forcing completion`);
      terminalStatus = "max-turns";
      const contractAtLimit = workflowContract.summary();
      runLog.event("max_turns", {
        turn: turnCount,
        maxTurns,
        contract: contractAtLimit,
      });
      sendEvent("final_start", { status: terminalStatus });

      const unmet = Array.isArray(contractAtLimit.items)
        ? contractAtLimit.items
            .filter(
              (item: any) => item?.applicable === true && item?.satisfied !== true,
            )
            .map((item: any) => String(item.id))
        : [];
      const finalInstruction = [
        "The tool-execution budget is exhausted. Do not call or request any more tools.",
        "Write the final user-facing response now from the evidence already in the conversation.",
        "Explicitly label the result PARTIAL / MAX-TURNS and do not claim the workflow completed.",
        unmet.length > 0
          ? `Unmet workflow requirements: ${unmet.join(", ")}.`
          : "The workflow contract has no recorded unmet item, but the tool loop still exhausted its cap.",
        "Distinguish verified findings from unresolved work and give the safest next action.",
      ].join("\n");
      historyMessages.push({ role: "user", content: finalInstruction });

      const fallbackContent = [
        "PARTIAL / MAX-TURNS — the tool-execution budget was exhausted before the workflow completed.",
        unmet.length > 0
          ? `Unmet workflow requirements: ${unmet.join(", ")}.`
          : "The final workflow state could not be completed within this request.",
        "The persisted engine state can be continued in a new request.",
      ].join("\n\n");

      try {
        if (requestDeadline.remainingMs() <= 5_000) {
          historyMessages.push({ role: "assistant", content: fallbackContent });
          runLog.event("final_response_fallback", {
            reason: "insufficient-request-budget",
            remainingMs: requestDeadline.remainingMs(),
          });
        } else {
          const compressed = await compress(historyMessages as any[], {
            model: String(model),
            timeout: Math.min(
              30_000,
              Math.max(1, requestDeadline.remainingMs()),
            ),
          });
          const finalResult = await llmProvider.chat({
            messages: compressed.messages as any[],
            model,
            // Deliberately omit tools: this call is the reserved final response,
            // not an extension of the tool loop.
            apiKey,
            onToken: (t) => sendEvent("token", { content: t }),
            onThinking: (t) => {
              if (t) sendEvent("thinking", { content: t });
            },
            onUsage: (u) => sendEvent("usage", u),
            signal: requestDeadline.signal,
          });
          lastResult = finalResult;
          const finalContent = String(finalResult.content ?? "").trim();
          runLog.turn(turnCount + 1, {
            content: finalContent || fallbackContent,
            thinking:
              typeof finalResult.thinking === "string"
                ? finalResult.thinking
                : undefined,
            finishReason:
              typeof finalResult.finishReason === "string"
                ? finalResult.finishReason
                : undefined,
            toolNames: [],
            inputMessageCount: historyMessages.length,
            compressedMessageCount: compressed.messages.length,
            usage: finalResult.usage,
          });
          historyMessages.push({
            role: "assistant",
            content: finalContent || fallbackContent,
          });
          runLog.event("final_response", {
            status: terminalStatus,
            contentChars: finalContent.length,
            usedFallback: finalContent.length === 0,
            toolCallsIgnored: finalResult.tool_calls?.length ?? 0,
          });
        }
      } catch (error) {
        if (requestDeadline.timedOut) {
          markRequestTimedOut(turnCount);
        } else {
          historyMessages.push({ role: "assistant", content: fallbackContent });
          runLog.event("final_response_fallback", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Attach metadata to the final assistant message
    const finalAssistantMessage = [...historyMessages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (finalAssistantMessage) {
      finalAssistantMessage.id = uuidv4();
      finalAssistantMessage.timestamp = Date.now();
      finalAssistantMessage.metadata = {
        ...finalAssistantMessage.metadata,
        model,
        provider: providerType,
        usage: lastResult?.usage,
        thinking: lastResult?.thinking,
        tool_results:
          finalAssistantMessage.metadata?.tool_results ?? allTurnToolResults,
      };
    }

    if (requestDeadline.timedOut) markRequestTimedOut(turnCount);
    // No asynchronous work remains after this boundary. Stop the timer so a
    // request that met its deadline cannot flip status between logging and SSE.
    requestDeadline.dispose();
    const termination = finalizeRunOutcome(
      terminalStatus,
      workflowContract.summary(),
    );

    // Recalled findings only earn a citation when the final answer contains the
    // exact injected marker. This is the second half of retention accounting.
    let citedFindingIds: string[] = [];
    if (
      termination.status === "completed" &&
      finalAssistantMessage?.content &&
      recalledFindingIds.length > 0
    ) {
      try {
        citedFindingIds = await findingStore.recordCitations(
          String(finalAssistantMessage.content),
          recalledFindingIds,
        );
        if (citedFindingIds.length > 0) {
          runLog.event("finding_citations", { findingIds: citedFindingIds });
        }
      } catch (error) {
        runLog.event("finding_citation_error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const elapsed = Math.round((Date.now() - requestStartTime) / 1000);
    console.log(
      `[Chat] Request ${termination.status}: ${turnCount} turns, ${elapsed}s elapsed`,
    );
    runLog.end({
      turns: turnCount,
      elapsedSeconds: elapsed,
      recalledFindingIds,
      citedFindingIds,
      status: termination.status,
      contract: termination.contract,
      recoveryLedger: recovery.snapshot(),
    });

    // Send usage
    if (termination.emitDone && lastResult?.usage) {
      sendEvent("usage", lastResult.usage);
    }

    // Save history (filter out the system messages, keep standard multi-turn)
    const sessionMessagesToSave = historyMessages.filter(
      (m) => m.role !== "system",
    );
    sessionStore.update(sessionId, { messages: sessionMessagesToSave });

    if (termination.emitDone) {
      sendEvent("done", {
        session_id: sessionId,
        message: finalAssistantMessage,
        status: termination.status,
      });
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Chat] Error: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      console.error(
        `[Chat] Stack: ${error.stack.split("\n").slice(0, 3).join(" | ")}`,
      );
    }
    sendEvent("error", { message: errorMessage });
  } finally {
    requestDeadline.dispose();
    clearInterval(heartbeat);
    res.end();
  }
});

/**
 * GET /chat/history/:sessionId
 *
 * Get the message history for a specific session.
 */
chatRouter.get("/history/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessionStore.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Load the AGEM engine state for this session from disk
  try {
    const loaded = await agemBridge.loadSession(sessionId);
    if (loaded) {
      console.log(
        `[Chat] Restored AGEM engine state for session: ${sanitizeLog(sessionId)}`,
      );
    } else {
      console.warn(
        `[Chat] No saved AGEM engine state found for session: ${sanitizeLog(sessionId)}, keeping current or default`,
      );
    }
  } catch (err: any) {
    console.error(
      `[Chat] Failed to load AGEM engine state for session ${sanitizeLog(sessionId)}:`,
      err,
    );
  }

  res.json(session.messages);
});
