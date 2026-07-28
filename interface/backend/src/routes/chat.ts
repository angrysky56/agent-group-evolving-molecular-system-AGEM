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
import type { ChatMessage, ChatRequest } from "../../../shared/types.js";
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
import { ProviderEmbedder } from "../services/provider-embedder.js";
import { segmentText } from "#agem/tna/CooccurrenceGraph.js";
import { createRunLogger } from "../services/run-logger.js";
import {
  findingNarrativeDensifier,
  findingStore,
} from "../services/run-memory.js";
import {
  attachFindingMemory,
  captureFindingFromTool,
  captureFindingNarrativeFromTool,
  formatRecallContext,
} from "../services/finding-capture.js";
import type { DensificationResult } from "../services/finding-narrative.js";
import { RecoveryProtocol } from "../services/recovery-protocol.js";
import {
  dispatchBatch,
  isRetrySafe,
  sideEffectClass,
} from "../services/tool-dispatch.js";
import { createWorkflowContract } from "../services/workflow-contract.js";
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
  let normalized = false;

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
      break;
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
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      message,
    });
    sendEvent("system", { content: `[run-log: ${runLog.runId}]` });

    // Cue, don't query: one embedding of the incoming material, a raw cosine
    // floor, then top-k. This happens before the model sees the prompt.
    let recalledFindingIds: string[] = [];
    let recalledContext: string | null = null;
    try {
      const recalled = await findingStore.recall(
        message,
        {
          memoryNamespace,
          signal: abortController.signal,
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

# How AGEM works (so you interpret its outputs correctly)

Each cycle, the engine ingests text into a concept graph, detects communities, and computes metrics. Read these honestly — do not over-claim what they mean:

- **get_graph_topology** — the concept communities and the bridges between them. This is your richest signal: which ideas cluster, which clusters connect, where the structure is.
- **get_cohomology** — cohomology of the LCM subgraph-registry sheaf, NOT the concept graph. First read \`status\`: when it is \`not-computed\`, numeric H⁰/H¹ fields are deliberately absent. When computed, H⁰ is a vector-space dimension rather than a count of semantic clusters, and H¹ is a topological invariant of registry restriction maps rather than a logical contradiction verdict.
- **get_soc_metrics** — VNE/EE/CDP and regime (nascent/stable/critical). A rough measure of how much the graph is still developing. Useful for pacing, not for truth.
- **detect_gaps / generate_catalyst_questions** — structural gaps between clusters and questions that would bridge them. Good for deciding what to explore next.

# Workflow

1. Use **run_agem_cycle** for one conceptual section, with a stable named \`subgraph\`. For a structured multi-section corpus, prefer **run_agem_cycles_sectioned**: it preserves authored section boundaries, advances SOC once per section, and computes one corpus-level sheaf result after the final section. A single unnamed cycle cannot produce registry-sheaf cohomology.
2. **A cycle only advances the graph if you feed it NEW, substantive content.** Running another cycle with no new text — or with a thin scrap, or by re-pasting the same material — does not progress the reasoning; it just piles duplicate co-occurrences on and degrades modularity. So run a second/third cycle ONLY when you genuinely have new material to add: your own synthesis so far, the answers to the catalyst questions, the next step of the argument, additional source text. To make the graph follow the reasoning forward, ingest the reasoning forward.
3. If you have nothing substantively new to add, do NOT run another cycle — instead inspect and reason over what is already there (steps 4–6).
4. Inspect with **get_graph_topology** (primary), then **get_cohomology** and **get_soc_metrics** as needed.
5. For a contested corpus, prefer **extract_and_verify_claims**, which preserves attributed positions. Use **evaluate_logical_consistency** only for already-audited hand-authored assertion contexts. Never use graph communities themselves as logical blocks.
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

# Formal logic — mcp-logic (REQUIRED for contested/multi-position topics)
The graph cannot detect contradiction, entailment, or consistency — only formal logic can. So whenever a corpus contains multiple positions, claims, or theories that might conflict, you MUST verify their logical relations with mcp-logic. Do NOT adjudicate "these positions are consistent / contradictory / the same axis" in prose alone — that judgement has to be checked, not asserted.

Required procedure for contested topics:
1. Identify who asserts each claim. Logical blocks are corpus-level assertions or named attributed positions; concept communities may help discovery but never define assertion contexts.
2. State each block's core claim as one or more SINGLE first-order-logic propositions.
   **NEGATION MUST USE THE "-" OPERATOR.** Write "-travels(x)". NEVER encode negation in a predicate NAME — "not_travels(x)", "no_transfer(x)", "non_local(x)" are, to the prover, symbols with no relationship whatsoever to "travels(x)", so they can never contradict it. This is the single most common way this tool gets a meaningless answer: a set of formulas with no "-" anywhere is ALWAYS satisfiable (make every predicate true everywhere), so it will report "no contradiction" no matter what the text said.
   Blocks must also SHARE predicate symbols. If block A says "travels(capability)" and block B says "distribution_bound(policy)", nothing connects them. Use the same predicate for the same idea across blocks, and negate it where a block denies it.
   A contradiction is normally expressed by one block asserting P and another asserting -P, or by a conditional in one block whose antecedent the others satisfy — so if the text contains a conditional ("X only if Y", "if X then not Y"), ENCODE IT AS A CONDITIONAL. Dropping it usually destroys the tension.
   **EVERY BLOCK OF UNIVERSALS NEEDS AN EXISTENTIAL WITNESS.** "all x (capability(x) -> travels(x))" is TRUE when nothing is a capability, so a set of pure "all x (...)" formulas is satisfied by the empty world and can never contradict. Whenever you write "all x (P(x) -> ...)" and P is supposed to be non-empty, also assert "exists x (P(x))". This has produced a real false "no contradiction" on a corpus that contained two.
3. Call evaluate_logical_consistency with those blocks. The engine runs every satisfiability check via mcp-logic for you (so the calls can't be malformed). A model of the full set certifies every subset at once; an unsatisfiable full set triggers complete, monotone MUS enumeration unless a caller cap, budget, or undetermined oracle result prevents completion. A **minimal unsatisfiable set** is a set of blocks that cannot all be true together, but every proper subset of which can.
4. On the typed path, read \`verdictKind\`: \`position-contradiction\` and \`corpus-contradiction\` are contradictions in one assertion context; \`positions-incompatible\` means rival positions cannot jointly hold and does NOT make a survey corpus contradictory. On the hand-authored path, read \`frustrations\`. Do NOT use H¹ as a verdict.
5. If "searchTruncated" is true, say so: no contradiction was found *up to the arity searched*, which is not the same as none existing. **Read "truncationNote"** — it says WHICH cap stopped the search. If it names a budget limit, "checksRequiredForNextLevel" is the exact 'maxChecks' that settles the question: call the tool again passing that value. Truncation is a setting, not a capability ceiling — never report it as "the tool cannot search further".
6. Report the frustrated sets whenever "hasContradiction" is true, and check "frustrationsComplete" plus "checkFailures". A found MUS remains evidence when enumeration is incomplete, but it is not proof that no additional MUS exists.
7. **If "resultIsVacuous" is true, the overall verdict is invalid.** With no contradiction, the encoding made "consistent" a foregone conclusion. If contradictions were found, the listed clashes remain evidence, but critical alias/arity defects can hide additional ones. Read "formalizationWarnings", fix the formulas, and call the tool again. Never report a clean consistency or complete contradiction inventory from a vacuous result.

You may also call mcp-logic directly for one-off proofs/counterexamples:

Tools and EXACT argument shapes (verified — do not deviate):
- prove → arguments={"premises": ["all x (man(x) -> mortal(x))", "man(socrates)"], "conclusion": "mortal(socrates)"}
  Returns proved / unprovable. The field is "conclusion" (singular), NOT "goal".
- find_counterexample → arguments={"premises": [...], "conclusion": "..."}
  Finds a model where premises hold but conclusion fails. result="model_found" ⇒ the conclusion does NOT follow.
- check_well_formed → arguments={"statements": [...]}  — syntax-check formulas before proving.

Consistency check idiom: to test whether a set of claims can all be true together, call find_counterexample with the claims as "premises" and conclusion="$F". model_found ⇒ the set is CONSISTENT; no_model_found ⇒ the set is CONTRADICTORY.

SYNTAX RULES (these are where calls fail — follow exactly):
- "premises" is an ARRAY of strings, ONE formula per array element. NEVER put multiple statements in one string, and NEVER use newline characters inside a formula — a literal \\n will fail. Split into separate array elements instead.
- Operators are ASCII: -> (implies), <-> (iff), & (and), | (or), ~ (not).
- Quantifiers MUST be parenthesized: "all x (man(x) -> mortal(x))", "exists y (knows(y, socrates))".
- One predicate per fact; lowercase predicate and constant names.
- If a call returns a validation error, fix the shape (usually: split newlines into array elements, or rename "goal"→"conclusion") and retry ONCE. Never fabricate a result.

# Utility servers (only if a task explicitly needs them)
Reachable via call_mcp_tool but NOT part of normal reasoning: fetch (web fetch), sqlite/memory (storage), desktop-commander, playwright, docker. Other servers listed by list_mcp_servers exist but are experimental — ignore them unless the user names one.

# Calling MCP tools
Use the meta-tools: list_mcp_servers, list_server_tools(server_name), call_mcp_tool(server_name, tool_name, arguments).
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
            "Retrieves the current AGEM engine state: iteration count, operational mode, graph size, SOC state, cohomology status, and gap count. H¹ is absent unless registry cohomology was actually computed.",
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
            "Analyse the LCM subgraph-registry sheaf. Returns H⁰/H¹ only with at least two vertices and an edge; otherwise returns status='not-computed' with a reason and remedy and omits numeric invariants. This is not the concept co-occurrence graph or a logical verdict.",
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
            "Hand-authored logical consistency over already-audited assertion-context blocks. The real result is hasContradiction plus minimal unsatisfiable sets in frustrations; H¹ is only a lossy topological summary and is never the verdict. Prefer extract_and_verify_claims for raw contested corpora because it preserves attribution. Formula syntax: lowercase predicates over constants, '-' for negation, '->' implies, parenthesised quantifiers; one formula per array element, never newlines inside a formula.",
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
            "PREFERRED over evaluate_logical_consistency for contested corpora. Extracts typed, attributed claims and groups logic only by corpus assertion or named position; graph communities are diagnostic annotations and never logical blocks. Rival positions that cannot be jointly satisfied are reported as positions-incompatible, not as a contradictory corpus. Missing attribution is explicitly inconclusive and creates no automatic finding.",
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
      ...messages.slice(-6).map((m: any) => {
        let text = m.content || "";
        if (m.tool_calls) {
          text += " " + JSON.stringify(m.tool_calls);
        }
        return text;
      })
    ].join(" ").toLowerCase();

    const serverNames = mcpManager.getServerNames();
    const activeServers = new Set<string>();

    // Mapping of friendly keywords to server names
    const keywordMap: Record<string, string> = {
      "logic": "mcp-logic",
      "prover": "mcp-logic",
      "mace4": "mcp-logic",
      "hipai": "hipai-montague",
      "montague": "hipai-montague",
      "belief": "hipai-montague",
      "paraclete": "hipai-montague",
      "reasoning": "advanced-reasoning",
      "memory": "advanced-reasoning",
      "ethics": "conscience-servitor",
      "ethical": "conscience-servitor",
      "conscience": "conscience-servitor",
      "triage": "conscience-servitor",
      "sheaf": "sheaf-consistency-enforcer",
      "consistency": "sheaf-consistency-enforcer",
      "enforcer": "sheaf-consistency-enforcer",
      "compass": "aseke-compass",
      "panksepp": "aseke-compass",
      "behavior": "aseke-compass",
      "diagram": "cognitive-diagram-nav",
      "nav": "cognitive-diagram-nav",
      "verifier": "verifier-graph",
      "provenance": "verifier-graph"
    };

    // Match exact server names in prompt/history
    for (const sName of serverNames) {
      if (allTextToScan.includes(sName.toLowerCase())) {
        activeServers.add(sName);
      }
    }

    // Match keywords in prompt/history
    for (const [kw, sName] of Object.entries(keywordMap)) {
      if (allTextToScan.includes(kw) && serverNames.includes(sName)) {
        activeServers.add(sName);
      }
    }

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

    // All providers get AGEM native tools + meta-tools + active MCP tools
    // Cloud providers additionally get skill tools for direct access
    let tools: any[];
    if (isOllama) {
      tools = [...agemTools, ...metaTools, ...activeMcpTools];
      console.log(
        `[Chat] Ollama: ${agemTools.length} AGEM + ${metaTools.length} meta + ${activeMcpTools.length} active MCP = ${tools.length} total`,
      );
    } else {
      tools = [...skillTools, ...agemTools, ...metaTools, ...activeMcpTools];
      console.log(
        `[Chat] Cloud: ${skillTools.length} skill + ${agemTools.length} AGEM + ${metaTools.length} meta + ${activeMcpTools.length} active MCP = ${tools.length} total`,
      );
    }

    // Create provider instance
    const llmProvider = createProvider(resolvedProvider);

    let isDone = false;
    let turnCount = 0;
    const maxTurns = settings.all.CHAT_MAX_TURNS;
    let lastResult: any = null;
    const requestStartTime = Date.now();
    const allTurnToolResults: any[] = [];
    const REQUEST_TIMEOUT_MS = 20 * 60 * 1000; // 20 minute overall timeout

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
      enabled: settings.all.CHAT_ENFORCE_WORKFLOW_CONTRACT,
      isContested: () => (agemBridge.getState().communities ?? 0) >= 2,
      isClaimStoreAvailable: () => claimStore.available,
      materialChars: typeof message === "string" ? message.length : 0,
      materialThreshold: settings.all.CHAT_CONTRACT_MATERIAL_CHARS,
    });

    while (!isDone && turnCount < maxTurns) {
      // Check overall request timeout
      if (Date.now() - requestStartTime > REQUEST_TIMEOUT_MS) {
        console.warn(
          `[Chat] Request timeout after ${turnCount} turns (${Math.round((Date.now() - requestStartTime) / 1000)}s)`,
        );
        sendEvent("error", {
          message:
            "Request timed out after 20 minutes. Try a simpler query or fewer tool calls.",
        });
        break;
      }

      turnCount++;
      console.log(
        `[Chat] Turn ${turnCount}/${maxTurns} — sending to ${sanitizeLog(resolvedProvider)}/${sanitizeLog(model)}`,
      );

      const compressResult = await compress(historyMessages as any[], { model: String(model) });

      const result = await llmProvider.chat({
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
        signal: abortController.signal,
      });
      lastResult = result;

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
                abortController.signal,
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
                abortController.signal,
              );
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
                  mcpManager.executeTool(server, tool, a),
                );
                // Let a caller raise the caps deliberately. Undefined must not
                // be spread over the defaults, so only set what was supplied.
                const cohomologyOpts: LogicalCohomologyOptions = {};
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
                const verdict = result.resultIsVacuous
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
                  evaluated === submitted
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
                output = JSON.stringify(
                  {
                    runLogId: runLog.runId,
                    coverage,
                    blocksSubmitted: submitted,
                    blocksEvaluated: evaluated,
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
                const extraction = await extractIntoStore(segs, corpusId);

                const graphCommunities =
                  agemBridge.getGraphSummary().concept_graph?.communities.map(
                    (community) => ({
                      id: community.id,
                      label: community.label,
                      members: community.members,
                    }),
                  ) ?? [];
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
                  embedder: claimBlockEmbedder,
                  sharedExistencePredicates,
                });
                const distinct = derivation.blocks;

                const extractionComplete =
                  extraction.parseFailures.length === 0 &&
                  extraction.claimsRejected === 0 &&
                  derivation.attributionComplete;

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

                if (!extractionComplete) {
                  output = JSON.stringify({
                    runLogId: runLog.runId,
                    extraction,
                    attributionComplete: derivation.attributionComplete,
                    attributionIssues: derivation.attributionIssues,
                    semanticsValidated: false,
                    verdictKind: "inconclusive",
                    hasContradiction: false,
                    supportingClaimKeys: [],
                    supportingClaimRefs: [],
                    verdict:
                      "INCONCLUSIVE EXTRACTION — one or more claims lacked valid attribution, were rejected, or came from an unparseable segment. No logical verdict was computed and no finding may be stored.",
                  });
                } else if (blocks.length === 0) {
                  output = JSON.stringify({
                    runLogId: runLog.runId,
                    extraction,
                    attributionComplete: true,
                    semanticsValidated: false,
                    verdictKind: "inconclusive",
                    hasContradiction: false,
                    supportingClaimKeys: [],
                    supportingClaimRefs: [],
                    verdict:
                      "No attributed claim blocks were extracted. This is inconclusive about the corpus and creates no finding.",
                  });
                } else {
                  const oracle = makeMcpLogicOracle((server, tool, a) =>
                    mcpManager.executeTool(server, tool, a),
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
                    },
                  );
                  const classified = classifyClaimVerdict(derivation, result);
                  // A clean result over a capped prefix is not a clean corpus
                  // result. Preserve it as an inconclusive run-memory record.
                  const semantic =
                    capped && classified.verdictKind === "no-contradiction"
                      ? { ...classified, verdictKind: "inconclusive" as const }
                      : classified;
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
                    capped
                      ? `${distinct.length - BLOCK_CAP} block(s) excluded by LOGIC_MAX_BLOCKS`
                      : "",
                    result.internallyInconsistent.length
                      ? `${result.internallyInconsistent.length} internally inconsistent block(s) excluded`
                      : "",
                    result.checkFailures.length
                      ? `${result.checkFailures.length} check failure(s)`
                      : "",
                    result.uncheckedBlocks.length
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
                              ? `INCONCLUSIVE — attribution or formalization validation failed, a check was undetermined, or the search was truncated. ${result.truncationNote ?? "Review formalizationWarnings."}`
                              : `No contradiction within ${evaluated} evaluated assertion context(s) up to arity ${result.searchedToArity}.`;
                  output = JSON.stringify(
                    {
                      runLogId: runLog.runId,
                      capNote,
                      coverage,
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
                        segmentsProcessed: extraction.segmentsProcessed,
                        claimsProposed: extraction.claimsProposed,
                        claimsAccepted: extraction.claimsAccepted,
                        claimsRejected: extraction.claimsRejected,
                        parseFailures: extraction.parseFailures.length,
                        rejections: extraction.outcomes
                          .filter((o) => !o.accepted)
                          .slice(0, 10)
                          .map((o) => ({ claim: o.claim, why: o.rejection })),
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
                agemBridge.generateCatalystQuestions(gapId),
                null,
                2,
              );
            } else if (fnName === "search_context") {
              const query = args.query ?? args.search_query ?? args.text ?? "";
              const results = await agemBridge.searchContext(
                query,
                args.max_results,
                abortController.signal,
              );
              output = JSON.stringify(results, null, 2);
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
              output = await mcpManager.executeTool(sName, tName, tArgs);
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
              );
            } else {
              throw new Error(`Unknown tool ${fnName}`);
            }
          }

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

            const outcome = await recovery.execute(fnName, args, {
              run: (a) => runToolOnce(fnName, a),
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

            let effectiveOutput = outcome.output;
            if (outcome.ok) {
              try {
                const finding = captureFindingFromTool(
                  fnName,
                  args,
                  outcome.output,
                  {
                    runLogId: runLog.runId,
                    producedByModel: effectiveModel,
                    memoryNamespace,
                  },
                );
                if (finding) {
                  let densificationResult: DensificationResult | undefined;
                  const narrativeRequest = captureFindingNarrativeFromTool(
                    fnName,
                    args,
                    outcome.output,
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
                          abortController.signal,
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
                    abortController.signal,
                  );
                  effectiveOutput = attachFindingMemory(
                    outcome.output,
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
              console.error(
                `[Chat] Tool ${fnName} failed after ${outcome.attempts} attempt(s) ` +
                  `(class=${outcome.diagnosis?.errorClass}, L${outcome.level}): ${outcome.diagnosis?.phi}`,
              );
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
            if (outcome.ok) workflowContract.record(fnName, outcome.label);

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
      } else {
        // No tool calls — the model believes it is finished. Validate that
        // against the output contract rather than against a turn count: a run
        // that completed the workflow in three turns is done, and one that
        // burned six turns without ingesting anything is not.
        const contractNudge = workflowContract.nudge();
        if (contractNudge) {
          const unmet = workflowContract
            .evaluate()
            .unmet.map((i) => i.id)
            .join(", ");
          console.log(
            `[Chat] Contract unmet at turn ${turnCount}/${maxTurns} (${unmet}) — nudging`,
          );
          runLog.event("contract_nudge", {
            turn: turnCount,
            unmet,
            contract: workflowContract.summary(),
          });
          historyMessages.push({ role: "user", content: contractNudge });
        } else {
          // Contract satisfied, nudge budget spent, or the same gap was
          // already raised once — either way, stop. Bounded by construction.
          isDone = true;
        }
      }
    }

    if (turnCount >= maxTurns && !isDone) {
      console.warn(`[Chat] Hit max turns (${maxTurns}) — forcing completion`);
      sendEvent("system", {
        content: "\n[Max tool iterations reached. Finalizing response.]\n",
      });
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

    // Recalled findings only earn a citation when the final answer contains the
    // exact injected marker. This is the second half of retention accounting.
    let citedFindingIds: string[] = [];
    if (finalAssistantMessage?.content && recalledFindingIds.length > 0) {
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
      `[Chat] Request complete: ${turnCount} turns, ${elapsed}s elapsed`,
    );
    runLog.end({
      turns: turnCount,
      elapsedSeconds: elapsed,
      recalledFindingIds,
      citedFindingIds,
      contract: workflowContract.summary(),
      recoveryLedger: recovery.snapshot(),
    });

    // Send usage
    if (lastResult?.usage) {
      sendEvent("usage", lastResult.usage);
    }

    // Save history (filter out the system messages, keep standard multi-turn)
    const sessionMessagesToSave = historyMessages.filter(
      (m) => m.role !== "system",
    );
    sessionStore.update(sessionId, { messages: sessionMessagesToSave });

    // Signal completion
    sendEvent("done", {
      session_id: sessionId,
      message: finalAssistantMessage,
    });
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
