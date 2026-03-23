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
import { settings } from "../config.js";

export const chatRouter = Router();

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

  console.log(`[Chat] Request: model=${model}, provider=${providerType}, msg="${message?.slice(0, 60)}..."`);

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
    agemBridge.setActiveSession(sessionId);

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

    // Inject system prompt with all loaded skills
    const allSkills = Array.from(
      ["agem-expert", "value-guardian"]
        .map((name) => skillRegistry.getSkill(name))
        .filter(Boolean)
        .map((s) => `\n--- ${s!.name.toUpperCase()} SKILL ---\n${s!.content}\n--- END ---`)
    ).join("\n");
    const skillContent = allSkills || "";

    historyMessages.push({
      role: "system",
      content: `You are AGEM, an advanced multi-agent reasoning engine built on mathematical topology. You have access to native AGEM tools AND external MCP servers for consistency enforcement, ethical evaluation, formal logic, and advanced reasoning.

WORKFLOW: Always run_agem_cycle FIRST on new topics. Then use introspection tools to analyze results. For complex or contested topics, run multiple cycles and use MCP servers for external validation.

CORE TOOLS (use directly):
- run_agem_cycle: Execute a reasoning cycle on a topic
- get_agem_state, get_soc_metrics, get_cohomology, get_graph_topology: Inspect engine state
- detect_gaps, generate_catalyst_questions: Find and bridge knowledge gaps
- search_context: Semantic search across the LCM store
- spawn_agem_agent, reset_agem_engine: Agent and lifecycle management

MCP SERVER ACCESS (use the 3 meta-tools to discover and call):
1. list_mcp_servers → see available servers
2. list_server_tools(server_name) → see tools on that server
3. call_mcp_tool(server_name, tool_name, arguments) → invoke any tool

KEY MCP SERVERS:
- advanced-reasoning: Deep multi-step reasoning with memory
- sheaf-consistency-enforcer: Cross-agent consistency verification
- conscience-servitor: Ethical risk triage and full EFHF evaluation
- hipai-montague: World model knowledge graph with Paraclete Protocol
- verifier-graph: Reasoning provenance chains
- mcp-logic: Formal logic proofs (Prover9/Mace4)
${skillContent}`,
    });

    historyMessages.push(
      ...(session?.messages ?? [userMessage]).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    );

    // Get API key from request headers (for OpenRouter)
    const apiKey =
      req.headers["authorization"]?.toString().replace("Bearer ", "") ??
      req.headers["x-openrouter-key"]?.toString() ??
      req.headers["x-api-key"]?.toString();

    let resolvedProvider = providerType ?? settings.getLLMConfig().provider;
    if (model) {
      if (model.startsWith("ollama:")) resolvedProvider = "ollama";
      else if (model.startsWith("openrouter:")) resolvedProvider = "openrouter";
      else if (model.startsWith("anthropic:")) resolvedProvider = "anthropic";
    }

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
          name: "get_graph_topology",
          description:
            "Return the full TNA graph for visualisation: all nodes with labels, community IDs, and sizes; all edges with weights.",
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
                description: "Skill folder name (e.g., 'value-guardian'). Will be created under skills/.",
              },
              description: {
                type: "string",
                description: "One-line description of the skill.",
              },
              content: {
                type: "string",
                description: "Full markdown body of the skill (everything after the frontmatter).",
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
          description: "List all available ethical scenarios in the Paraclete Proving Grounds. Shows ID, title, category, and turn count.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "load_scenario",
          description: "Load a specific scenario by ID to see its full definition (turns, affordances, constraints, metric targets).",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Scenario ID (e.g., 'plague-village')." },
            },
            required: ["id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "generate_scenario",
          description: "Create and save a new ethical scenario for the Paraclete Proving Grounds. Use when encountering a real ethical dilemma worth preserving as a reusable test case. The scenario is saved to scenarios/{id}.json.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique kebab-case ID." },
              title: { type: "string", description: "Human-readable title." },
              description: { type: "string", description: "Brief description of the ethical dilemma." },
              category: {
                type: "string",
                description: "Category: means-vs-ends | hidden-information | temporal-pressure | poppers-paradox | epistemic-autonomy | structural-harm | custom",
              },
              metric_target: { type: "string", description: "What topological stress this scenario targets." },
              turns: {
                type: "array",
                description: "Array of turn objects with: turn (number), situation (string), affordances (optional string[]), reveal_after_action (optional string), turns_remaining (optional number).",
                items: { type: "object" },
              },
              vk_axioms: {
                type: "array", items: { type: "string" },
                description: "VK axiom IDs relevant to this scenario.",
              },
              origin_context: { type: "string", description: "What real situation inspired this scenario (optional)." },
            },
            required: ["id", "title", "description", "category", "turns", "vk_axioms"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "run_scenario",
          description: "Start executing an ethical scenario from the Paraclete Proving Grounds. Loads the scenario and presents the first turn. Process each turn by: (1) run_agem_cycle with the situation, (2) check cohomology + sheaf enforcer, (3) decide action, (4) record_scenario_turn with metrics.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "Scenario ID to run (e.g., 'plague-village')." },
            },
            required: ["id"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "record_scenario_turn",
          description: "Record metrics and decision for the current scenario turn. Call after analyzing the situation with AGEM tools. Returns the next turn or completion status.",
          parameters: {
            type: "object",
            properties: {
              action_taken: { type: "string", description: "The action you chose (or 'REFUSE' if refusing to act)." },
              h1_dimension: { type: "number", description: "Current H¹ dimension from get_cohomology." },
              vk_coboundary: { type: "number", description: "Coboundary norm on tna→value-guardian edge (from sheaf enforcer edge report)." },
              vk_dual_variable: { type: "number", description: "Dual variable on tna→value-guardian edge." },
              closure_status: { type: "string", description: "From get_closure_status (KERNEL1/WEAK/WARNING/TIMEOUT)." },
              ethical_risk: { type: "string", description: "From conscience-servitor triage (low/medium/high/critical)." },
            },
            required: ["action_taken"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "complete_scenario",
          description: "Finalize the active scenario run. Saves results to scenarios/results/ with full metrics summary. Call after all turns are processed.",
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
          description: "List all connected MCP servers and how many tools each has. Call this first to see what external capabilities are available (reasoning, ethics, logic, knowledge graphs, etc).",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "list_server_tools",
          description: "List all tools available on a specific MCP server with their descriptions. Use this to discover what a server can do before calling its tools.",
          parameters: {
            type: "object",
            properties: {
              server_name: { type: "string", description: "Name of the MCP server (from list_mcp_servers)" },
            },
            required: ["server_name"],
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "call_mcp_tool",
          description: "Call any tool on any connected MCP server. Use list_server_tools first to see required arguments. Supports servers like: advanced-reasoning, sheaf-consistency-enforcer, hipai-montague, verifier-graph, conscience-servitor, mcp-logic, and more.",
          parameters: {
            type: "object",
            properties: {
              server_name: { type: "string", description: "MCP server name" },
              tool_name: { type: "string", description: "Tool name on that server" },
              arguments: { type: "object", description: "Tool arguments as key-value pairs" },
            },
            required: ["server_name", "tool_name"],
          },
        },
      },
    ];

    // All providers get AGEM native tools + meta-tools (compact, ~13 total)
    // Cloud providers additionally get skill tools for direct access
    let tools: any[];
    if (isOllama) {
      tools = [...agemTools, ...metaTools];
      console.log(`[Chat] Ollama: ${agemTools.length} AGEM + ${metaTools.length} meta = ${tools.length} total`);
    } else {
      tools = [...skillTools, ...agemTools, ...metaTools];
      console.log(`[Chat] Cloud: ${skillTools.length} skill + ${agemTools.length} AGEM + ${metaTools.length} meta = ${tools.length} total`);
    }

    // Create provider instance
    const llmProvider = createProvider(resolvedProvider);

    let isDone = false;
    let turnCount = 0;
    const maxTurns = 15;
    let lastResult: any = null;
    const requestStartTime = Date.now();
    const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute overall timeout

    while (!isDone && turnCount < maxTurns) {
      // Check overall request timeout
      if (Date.now() - requestStartTime > REQUEST_TIMEOUT_MS) {
        console.warn(`[Chat] Request timeout after ${turnCount} turns (${Math.round((Date.now() - requestStartTime) / 1000)}s)`);
        sendEvent("error", { message: "Request timed out after 5 minutes. Try a simpler query or fewer tool calls." });
        break;
      }

      turnCount++;
      console.log(`[Chat] Turn ${turnCount}/${maxTurns} — sending to ${resolvedProvider}/${model}`);

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
        signal: req.app.locals.abortController?.signal,
      });
      lastResult = result;

      // If the model returned tool calls, check if the streamed text was just raw JSON
      // (nemotron bug) vs legitimate text. Only clear if it looks like raw tool-call JSON.
      if (result.tool_calls && result.tool_calls.length > 0) {
        const trimmed = (result.content ?? "").trim();
        const looksLikeRawJson = trimmed.startsWith("{") || trimmed.startsWith("[");
        if (looksLikeRawJson && trimmed.length < 2000) {
          sendEvent("clear_stream", {});
        }
        // Otherwise keep the text — it's legitimate narration between tool calls
      }

      // Append assistant response to history
      const assistantMessage: any = {
        role: "assistant",
        content: result.content,
      };
      if (result.tool_calls) {
        if (isOllama) {
          // Ollama expects: tool_calls with type, function.index, and arguments as OBJECT
          assistantMessage.tool_calls = result.tool_calls.map((tc: any, i: number) => ({
            type: "function",
            function: {
              index: i,
              name: tc.function.name,
              arguments: typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments || "{}")
                : tc.function.arguments,
            },
          }));
        } else {
          // OpenRouter: standard OpenAI format with arguments as STRING
          assistantMessage.tool_calls = result.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: tc.type ?? "function",
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === "string"
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
              console.warn(`[Chat] Malformed tool args for ${fnName}, attempting repair: ${(parseErr as Error).message}`);
              try {
                // Try fixing: truncate at last valid closing brace/bracket
                const lastBrace = rawArgs.lastIndexOf("}");
                const lastBracket = rawArgs.lastIndexOf("]");
                const cutPoint = Math.max(lastBrace, lastBracket);
                if (cutPoint > 0) {
                  args = JSON.parse(rawArgs.slice(0, cutPoint + 1));
                  console.log(`[Chat] JSON repair succeeded for ${fnName}`);
                } else {
                  console.error(`[Chat] JSON repair failed for ${fnName}, using empty args`);
                  args = {};
                }
              } catch {
                console.error(`[Chat] JSON repair also failed for ${fnName}: ${rawArgs.slice(0, 200)}`);
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

          sendEvent("system", { content: `\n[Executing: ${fnName}]\n` });
          const toolStart = Date.now();

          try {
            if (fnName === "read_skill") {
              output = skillRegistry.executeTool(fnName, args);
            } else if (fnName === "get_agem_state") {
              output = JSON.stringify(agemBridge.getState(), null, 2);
            } else if (fnName === "run_agem_cycle") {
              // Accept common parameter name variations from different models
              const prompt = args.prompt ?? args.conversation_topic ?? args.topic ?? args.message ?? message;
              const runResult = await agemBridge.runCycle(
                prompt,
                sendEvent,
              );
              output = `Cycle completed. State:\n${JSON.stringify(runResult.state, null, 2)}`;
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
            } else if (fnName === "get_graph_topology") {
              output = JSON.stringify(agemBridge.getGraphSummary(), null, 2);
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
              );
              output = JSON.stringify(results, null, 2);
            } else if (fnName === "spawn_agem_agent") {
              const persona = args.persona ?? args.agent_persona ?? args.role ?? "General";
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
                const skillDir = path.resolve(process.cwd(), "..", "..", "skills", skillName);
                await fs.mkdir(skillDir, { recursive: true });
                const frontmatter = `---\nname: "${skillName}"\ndescription: "${desc}"\n---\n\n`;
                await fs.writeFile(path.join(skillDir, "SKILL.md"), frontmatter + body, "utf8");
                await skillRegistry.initialize();
                output = `Skill '${skillName}' created/updated and reloaded.`;
              } catch (err: any) {
                output = `Error creating skill: ${err.message}`;
              }
            } else if (fnName === "list_scenarios") {
              const scenarios = await scenarioService.listScenarios();
              output = scenarios.length === 0
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
                output = `# Scenario Started: ${run.scenario.title}\n\n` +
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
                output = `Turn recorded. Action: ${args.action_taken}\n\n` +
                  (result.reveal ? `**REVEAL:** ${result.reveal}\n\n` : "") +
                  "All turns recorded. Call complete_scenario to finalize and save results.";
              } else {
                output = `Turn recorded. Action: ${args.action_taken}\n\n` +
                  (result.reveal ? `**REVEAL:** ${result.reveal}\n\n` : "") +
                  (result.nextInstructions ?? "");
              }
            } else if (fnName === "complete_scenario") {
              const result = await scenarioService.completeRun();
              if (!result) {
                output = "No active scenario run to complete.";
              } else {
                output = `# Scenario Complete: ${result.scenario_title}\n\n` +
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
                    return { name, tool_count: tools.length, status: "connected" };
                  } catch {
                    return { name, tool_count: 0, status: "error" };
                  }
                }),
              );
              output = JSON.stringify(serverList, null, 2);
            } else if (fnName === "list_server_tools") {
              // Meta-tool: list tools on a specific server
              const sName = args.server_name ?? args.server ?? "";
              try {
                const serverTools = await mcpManager.getServerTools(sName);
                output = JSON.stringify(serverTools, null, 2);
              } catch (e: any) {
                output = `Error: Server '${sName}' not found or not connected. ${e.message}`;
              }
            } else if (fnName === "call_mcp_tool") {
              // Meta-tool: call any tool on any server
              const sName = args.server_name ?? args.server ?? "";
              const tName = args.tool_name ?? args.tool ?? "";
              const tArgs = args.arguments ?? args.args ?? {};
              try {
                output = await mcpManager.executeTool(sName, tName, tArgs);
              } catch (e: any) {
                output = `Error calling ${sName}/${tName}: ${e.message}`;
              }
            } else if (fnName.startsWith("mcp__")) {
              const parts = fnName.split("__");
              const serverName = parts[1];
              const toolName = parts.slice(2).join("__");
              output = await mcpManager.executeTool(serverName, toolName, args);
            } else {
              output = `Error: Unknown tool ${fnName}`;
            }
          } catch (err: any) {
            output = `Error executing tool: ${err.message}`;
            console.error(`[Chat] Tool ${fnName} failed: ${err.message}`);
          }

          const toolElapsed = Date.now() - toolStart;
          console.log(`[Chat] Tool ${fnName} completed in ${toolElapsed}ms (${output.length} chars)`);
          if (toolElapsed > 10000) {
            console.warn(`[Chat] Slow tool: ${fnName} took ${toolElapsed}ms`);
          }

          // Format tool result per provider spec
          if (isOllama) {
            // Ollama: {role: "tool", tool_name: "...", content: "..."}
            historyMessages.push({
              role: "tool",
              tool_name: fnName,
              content: output,
            });
          } else {
            // OpenRouter/Anthropic: {role: "tool", tool_call_id: "...", content: "..."}
            historyMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: fnName,
              content: output,
            });
          }
        }
      } else {
        // No tool calls, interaction is finished
        isDone = true;
      }
    }

    if (turnCount >= maxTurns && !isDone) {
      console.warn(`[Chat] Hit max turns (${maxTurns}) — forcing completion`);
      sendEvent("system", { content: "\n[Max tool iterations reached. Finalizing response.]\n" });
    }

    const elapsed = Math.round((Date.now() - requestStartTime) / 1000);
    console.log(`[Chat] Request complete: ${turnCount} turns, ${elapsed}s elapsed`);

    // Send usage
    if (lastResult?.usage) {
      sendEvent("usage", lastResult.usage);
    }

    // Attach metadata to the final assistant message
    const finalAssistantMessage = historyMessages[historyMessages.length - 1];
    if (finalAssistantMessage.role === "assistant") {
      finalAssistantMessage.id = uuidv4();
      finalAssistantMessage.timestamp = Date.now();
      finalAssistantMessage.metadata = {
        model,
        provider: providerType,
        tokens_used: lastResult?.usage?.total_tokens,
        thinking: lastResult?.thinking,
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
      console.error(`[Chat] Stack: ${error.stack.split("\n").slice(0, 3).join(" | ")}`);
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
chatRouter.get("/history/:sessionId", (req, res) => {
  const session = sessionStore.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session.messages);
});
