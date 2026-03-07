/**
 * Chat API Routes.
 *
 * Handles chat completions with SSE streaming, integrating
 * the LLM provider and session persistence.
 */

import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { ChatMessage, ChatRequest } from "../../../shared/types.js";
import { createProvider } from "../services/llm.js";
import { sessionStore } from "../services/session-store.js";
import { agemBridge } from "../services/agem-bridge.js";
import { knowledgeBase } from "../services/knowledge-base.js";
import { skillRegistry } from "../services/skills.js";
import { mcpManager } from "../services/mcp.js";
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

    // Inject system prompt with skills summary
    historyMessages.push({
      role: "system",
      content: `You are AGEM, an advanced molecular simulation agent system designed to assist users with complex system architecture and coding tasks.
Your situational awareness includes Agent Skills.
${skillRegistry.getAllSkillsSummary()}
Use the read_skill tool to read the full content of any skill if you need more information about it.`,
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
      req.headers["x-openrouter-key"]?.toString();

    const provider =
      settings.getLLMConfig().provider === "ollama" ? "ollama" : "openrouter";

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
    ];

    const tools = [...skillTools, ...mcpTools, ...agemTools];

    // Create provider instance
    const llmProvider = createProvider(providerType);

    let isDone = false;
    let turnCount = 0;
    const maxTurns = 15;
    let lastResult: any = null;

    while (!isDone && turnCount < maxTurns) {
      turnCount++;
      const result = await llmProvider.chat({
        messages: historyMessages,
        model, // Use the model from the request body
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

      // Append assistant response to history
      const assistantMessage: any = {
        role: "assistant",
        content: result.content,
      };
      if (result.tool_calls) {
        assistantMessage.tool_calls = result.tool_calls;
      }
      historyMessages.push(assistantMessage);

      if (result.tool_calls && result.tool_calls.length > 0) {
        // Execute tools
        for (const tc of result.tool_calls) {
          const fnName = tc.function.name;
          let args: any = {};
          if (typeof tc.function.arguments === "string") {
            args = JSON.parse(tc.function.arguments || "{}");
          } else if (
            typeof tc.function.arguments === "object" &&
            tc.function.arguments !== null
          ) {
            args = tc.function.arguments;
          }
          let output = "";

          sendEvent("system", { content: `\n[Executing: ${fnName}]\n` });

          try {
            if (fnName === "read_skill") {
              output = skillRegistry.executeTool(fnName, args);
            } else if (fnName === "get_agem_state") {
              output = JSON.stringify(agemBridge.getState(), null, 2);
            } else if (fnName === "run_agem_cycle") {
              const runResult = await agemBridge.runCycle(
                args.prompt,
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
              output = JSON.stringify(
                agemBridge.generateCatalystQuestions(args.gap_id),
                null,
                2,
              );
            } else if (fnName === "search_context") {
              const results = await agemBridge.searchContext(
                args.query,
                args.max_results,
              );
              output = JSON.stringify(results, null, 2);
            } else if (fnName === "spawn_agem_agent") {
              const spawnResult = agemBridge.spawnAgent(args.persona);
              output = spawnResult.message;
            } else if (fnName === "reset_agem_engine") {
              await agemBridge.reset();
              output = "AGEM engine reset.";
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
          }

          historyMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: fnName,
            content: output,
          });
        }
      } else {
        // No tool calls, interaction is finished
        isDone = true;
      }
    }

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
