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
  makeMcpLogicOracle,
} from "../services/logicalCohomology.js";
import { createRunLogger } from "../services/run-logger.js";
import { settings } from "../config.js";

export const chatRouter = Router();

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
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Resolve or create session
    if (!sessionId) {
      const session = sessionStore.create({ model, provider: providerType });
      sessionId = session.id;
    }

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
- **get_cohomology** — H⁰ and H¹ of the sheaf built over the concept clusters.
  - **H⁰ = number of connected semantic components.** This is meaningful: H⁰ rising means the discussion is fragmenting into separate topic-islands; H⁰ falling means a new idea bridged previously separate clusters. Use H⁰ as a *connectivity/fragmentation* readout.
  - **H¹** currently reflects cycle topology in the cluster graph, NOT logical contradiction. A nonzero H¹ does NOT mean the ideas conflict, and H¹ = 0 does NOT mean they agree. Do not narrate H¹ as "consensus reached" or "obstruction = disagreement." Report it plainly and rely on formal logic (below) for actual contradiction.
- **get_soc_metrics** — VNE/EE/CDP and regime (nascent/stable/critical). A rough measure of how much the graph is still developing. Useful for pacing, not for truth.
- **detect_gaps / generate_catalyst_questions** — structural gaps between clusters and questions that would bridge them. Good for deciding what to explore next.

# Workflow

1. **run_agem_cycle** on the topic, passing the corpus / material to analyse as the 'prompt' argument. The cycle INGESTS that text into a persistent, accumulating graph.
2. **A cycle only advances the graph if you feed it NEW, substantive content.** Running another cycle with no new text — or with a thin scrap, or by re-pasting the same material — does not progress the reasoning; it just piles duplicate co-occurrences on and degrades modularity. So run a second/third cycle ONLY when you genuinely have new material to add: your own synthesis so far, the answers to the catalyst questions, the next step of the argument, additional source text. To make the graph follow the reasoning forward, ingest the reasoning forward.
3. If you have nothing substantively new to add, do NOT run another cycle — instead inspect and reason over what is already there (steps 4–6).
4. Inspect with **get_graph_topology** (primary), then **get_cohomology** and **get_soc_metrics** as needed.
5. For any claim of contradiction, entailment, or logical (in)consistency, do NOT assert it from the graph — verify it with **evaluate_logical_consistency**.
6. Use **detect_gaps / generate_catalyst_questions** to decide what to probe next; if you pursue a question, feeding your exploration of it back in via run_agem_cycle is exactly the kind of new material that makes another cycle worthwhile.
7. Write your answer from the actual tool outputs. Never describe a cycle, metric, agent, or proof you did not actually run — if a tool failed, say so and proceed without it.

# Native AGEM tools (call directly)
- run_agem_cycle, get_agem_state, get_graph_topology, get_cohomology, get_soc_metrics
- evaluate_logical_consistency (logic-based H⁰/H¹ — the real contradiction detector)
- detect_gaps, generate_catalyst_questions, search_context
- spawn_agem_agent, reset_agem_engine, read_skill

# Formal logic — mcp-logic (REQUIRED for contested/multi-position topics)
The graph cannot detect contradiction, entailment, or consistency — only formal logic can. So whenever a corpus contains multiple positions, claims, or theories that might conflict, you MUST verify their logical relations with mcp-logic. Do NOT adjudicate "these positions are consistent / contradictory / the same axis" in prose alone — that judgement has to be checked, not asserted.

Required procedure for contested topics:
1. After clustering, name the key blocks (use the concept communities as candidates).
2. State each block's core claim as one or more SINGLE first-order-logic propositions.
3. Call evaluate_logical_consistency with those blocks. The engine runs all the internal/pairwise/triple satisfiability checks via mcp-logic for you (so the calls can't be malformed) and returns logic-based H⁰/H¹: H¹ > 0 means blocks that are consistent in every pair but impossible all together — a genuine contradiction the graph's own H¹ cannot detect. It also lists frustratedTriples (the offending sets) and any checkFailures.
4. Base any consistency claim on that result, and report frustratedTriples when H¹ > 0.

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
            "Retrieves the current AGEM engine state: iteration count, operational mode, graph size (nodes/edges/communities), sheaf H¹ obstruction level, and gap count.",
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
          description:
            "Execute one full AGEM reasoning pipeline iteration. Runs VNE, updates the TNA graph, computes sheaf cohomology, detects gaps, and returns structured artifacts with post-cycle metrics.",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "The problem or topic the agents should discuss.",
              },
            },
            required: ["prompt"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "get_cohomology",
          description:
            "Analyse current sheaf cohomology. Returns H⁰ (connected components), H¹ (obstructions / inconsistencies), coboundary rank, and whether an obstruction exists. Use after a cycle to assess consensus quality.",
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
            "LOGIC-BASED H⁰/H¹ (the real contradiction detector — the graph's H¹ cannot do this). You supply the key blocks of the corpus, each with its core claims as first-order-logic propositions; the engine checks internal, pairwise, and triple-wise satisfiability via mcp-logic (Prover9/Mace4) and computes the consistency complex. H¹ > 0 means a set of blocks that are consistent in every pair but impossible all together (genuine higher-order contradiction). Use this for contested/multi-position corpora instead of judging consistency in prose. Formula syntax: lowercase predicates over constants, '-' for negation, '->' implies, parenthesised quantifiers; one formula per array element, never newlines inside a formula. Example proposition: 'p(a) -> q(a)'.",
          parameters: {
            type: "object",
            properties: {
              blocks: {
                type: "array",
                description:
                  "The blocks to test (use concept communities). Each: {name: string, propositions: string[]}. Provide at least 2 blocks.",
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
            },
            required: ["blocks"],
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
    let continuationNudgeSent = false; // Only nudge the model once per request

    // Persistent, readable trace of this run (graph inputs + full tool I/O).
    // Written to <KNOWLEDGE_BASE_PATH>/runs/<id>.{jsonl,md}. Never throws.
    const runLog = createRunLogger({
      model: String(model ?? "unknown"),
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      message,
    });
    sendEvent("system", { content: `[run-log: ${runLog.runId}]` });

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

      const result = await llmProvider.chat({
        messages: historyMessages,
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
        // Execute tools
        for (const tc of result.tool_calls) {
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
          let output = "";
          let toolLabel = fnName; // Descriptive label for tool_result event

          sendEvent("system", { content: `\n[Executing: ${fnName}]\n` });
          const toolStart = Date.now();
          console.log(
            `[Chat] Executing tool ${fnName} (id: ${tc.id}) with args:`,
            JSON.stringify(args),
          );
          runLog.toolCall(fnName, args);

          try {
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
                const result = await computeLogicalCohomology(blocks, oracle);
                output = JSON.stringify(
                  { runLogId: runLog.runId, ...result },
                  null,
                  2,
                );
              }
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
              try {
                output = await mcpManager.executeTool(sName, tName, tArgs);
              } catch (e: any) {
                output = `Error calling ${sName}/${tName}: ${e.message}`;
              }
            } else if (fnName.startsWith("mcp__")) {
              const parts = fnName.split("__");
              const serverName = parts[1];
              const toolName = parts.slice(2).join("__");
              toolLabel = `${serverName}/${toolName}`;
              output = await mcpManager.executeTool(serverName, toolName, args);
            } else {
              output = `Error: Unknown tool ${fnName}`;
            }
          } catch (err: any) {
            output = `Error executing tool: ${err.message}`;
            console.error(`[Chat] Tool ${fnName} failed: ${err.message}`);
          }

          const toolElapsed = Date.now() - toolStart;
          console.log(
            `[Chat] Tool ${fnName} completed in ${toolElapsed}ms (${output.length} chars)`,
          );
          runLog.toolResult(fnName, output);
          if (toolElapsed > 10000) {
            console.warn(`[Chat] Slow tool: ${fnName} took ${toolElapsed}ms`);
          }

          // Stream structured tool result to frontend
          // Frontend renders as collapsible accordion with server/tool label
          const toolResult = {
            tool: toolLabel,
            elapsed_ms: toolElapsed,
            output,
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
              tool_call_id: tc.id,
              tool_name: fnName,
              content: output,
            });
          } else {
            // OpenRouter/Anthropic/MiniMax: {role: "tool", tool_call_id: "...", content: "..."}
            historyMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: fnName,
              content: output,
            });
          }
        }
      } else {
        // No tool calls — but if the model stopped very early, nudge it to
        // continue with deeper analysis before writing the final answer.
        // This fires at most once per request to avoid infinite loops.
        const MIN_TURNS_BEFORE_DONE = 4;
        if (turnCount < MIN_TURNS_BEFORE_DONE && !continuationNudgeSent) {
          continuationNudgeSent = true;
          console.log(
            `[Chat] Model stopped at turn ${turnCount}/${maxTurns} — injecting continuation nudge`,
          );
          historyMessages.push({
            role: "user",
            content:
              "[SYSTEM] You stopped after only a few tool calls. Before writing your final answer, " +
              "make sure you have completed the full analysis workflow: inspect the graph topology " +
              "(get_graph_topology), check cohomology (get_cohomology), review SOC metrics " +
              "(get_soc_metrics), and — for contested or multi-position topics — verify logical " +
              "consistency (evaluate_logical_consistency or mcp-logic proofs). If you have already " +
              "done all of these, proceed with your answer. Otherwise, continue your analysis now.",
          });
        } else {
          // Genuinely done (enough turns used, or nudge already sent)
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

    const elapsed = Math.round((Date.now() - requestStartTime) / 1000);
    console.log(
      `[Chat] Request complete: ${turnCount} turns, ${elapsed}s elapsed`,
    );
    runLog.end({ turns: turnCount, elapsedSeconds: elapsed });

    // Send usage
    if (lastResult?.usage) {
      sendEvent("usage", lastResult.usage);
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
