# AGEM Native Tools

This document describes the tools that the AGEM agent has native access to in every session. These are built into the engine and wired directly through the chat backend — they are always available regardless of MCP configuration.

The full tool list injected into the LLM context is:

```
[skillTools, mcpTools, agemTools]
```

---

## 1. Skill Tools

### `read_skill`

Read the full markdown instructions of a specific agent skill loaded from the `skills/` directory.

| Parameter | Type     | Required | Description                                                |
| --------- | -------- | -------- | ---------------------------------------------------------- |
| `name`    | `string` | ✅       | Exact name of the skill to read (e.g. `'pdf-processing'`). |

> Skills are discovered at startup. Use the system prompt summary (`getAllSkillsSummary`) to know what skills are available before calling this tool.

---

## 2. AGEM Engine Tools

These tools expose the running AGEM orchestration engine directly to the agent.

### `get_agem_state`

Snapshot of the current engine state. No parameters.

**Returns:** iteration count, operational mode, graph size (nodes / edges / communities), sheaf H¹ obstruction level, gap count.

---

### `run_agem_cycle`

Execute one full AGEM reasoning pipeline iteration.

| Parameter | Type     | Required | Description                                     |
| --------- | -------- | -------- | ----------------------------------------------- |
| `prompt`  | `string` | ✅       | The problem or topic the agents should discuss. |

**Pipeline steps:** VNE computation → TNA graph update → sheaf cohomology → gap detection → artifact emission via SSE.

**Returns:** updated engine state + structured artifacts streamed as `agem_state` and `artifact` SSE events.

---

### `get_cohomology`

Analyse the current sheaf cohomology. No parameters.

**Returns:** H⁰ (connected components / global consensus), H¹ (topological obstructions / inconsistencies), coboundary rank, and an `obstructionExists` boolean.

> Call this after `run_agem_cycle` to assess whether the system has reached a coherent consensus or has structural gaps.

---

### `get_graph_topology`

Return the full TNA (Text Network Analysis) graph. No parameters.

**Returns:** all nodes with labels, community IDs, and sizes; all edges with weights. Designed for the `GraphVisualization` panel on the frontend.

---

### `get_soc_metrics`

Retrieve the latest Self-Organised Criticality (SOC) snapshot. No parameters.

**Returns:** VNE, Embedding Entropy, CDP, Surprising Edge Ratio, correlation coefficient, phase transition flag, regime classification (`nascent` / `stable` / `transitioning` / `critical`), and trend direction.

---

### `detect_gaps`

Detect structural gaps between communities in the TNA graph. No parameters.

**Returns:** per-gap metrics — gap density, shortest inter-community path, modularity delta, and bridge nodes that span the gap.

---

### `generate_catalyst_questions`

Generate bridging questions designed to close a specific structural gap.

| Parameter | Type     | Required | Description                                                                                               |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `gap_id`  | `string` | ❌       | Gap to target (format: `'communityA_communityB'`, e.g. `'0_1'`). Omit to generate questions for all gaps. |

**Returns:** list of catalyst questions per gap.

---

### `search_context`

Semantic search across the LCM (Lifecycle Context Model) context store.

| Parameter     | Type     | Required | Description                           |
| ------------- | -------- | -------- | ------------------------------------- |
| `query`       | `string` | ✅       | The search query.                     |
| `max_results` | `number` | ❌       | Max results to return. Default: `10`. |

**Returns:** context entries ranked by cosine similarity.

---

### `spawn_agem_agent`

Request the engine to spawn a new agent with a given persona.

| Parameter | Type     | Required | Description                                               |
| --------- | -------- | -------- | --------------------------------------------------------- |
| `persona` | `string` | ✅       | Agent persona (e.g. `'Contrarian'`, `'Detail-Oriented'`). |

> Note: agent spawning is also triggered **automatically** by the `VdWAgentSpawner` when H¹ dimension exceeds threshold and regime is `transitioning` or `critical`.

---

### `reset_agem_engine`

Reset the engine state. No parameters.

Shuts down the current `Orchestrator` and re-instantiates a clean engine. **Clears all graph data, SOC metrics, sheaf state, and LCM history.**

---

## Usage Pattern

A typical agent workflow looks like this:

```
run_agem_cycle(prompt) → get_agem_state() → get_cohomology()
  → [if gaps] detect_gaps() → generate_catalyst_questions()
  → [repeat] run_agem_cycle(bridging_answer)
```

Use `get_soc_metrics()` at any point to assess whether the system is approaching a phase transition.
