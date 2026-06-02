---
name: "agem-expert"
description: "Operating guide for the AGEM reasoning engine: native tools, honest metric interpretation, formal-logic verification via mcp-logic, and the meta-tool MCP interface."
---

# AGEM Expert Skill — Operating Guide

> [!TIP]
> **TL;DR**: Run reasoning cycles on a topic, read the graph and metrics for what they actually measure, and verify any logical claim with formal logic. Do not narrate results you did not produce.
> **Key Action**: Run `run_agem_cycle` to begin analysis on any new topic.

## What AGEM measures (read honestly)

AGEM ingests text into a concept graph and computes topological metrics. Each metric means something specific and limited:

| Tool | What it actually tells you |
| :--- | :--- |
| `get_graph_topology` | The concept communities and the bridges between them. Your richest, most reliable signal — which ideas cluster and how they connect. |
| `get_cohomology` → **H⁰** | Number of connected semantic components. Rising H⁰ = the discussion is fragmenting into separate topic-islands; falling H⁰ = a new idea bridged previously-separate clusters. A genuine connectivity readout. |
| `get_cohomology` → **H¹** | Reflects cycle topology in the cluster graph. It does **NOT** measure logical contradiction. H¹ > 0 is **not** "disagreement"; H¹ = 0 is **not** "agreement." Report it plainly; use formal logic for real contradiction. |
| `get_soc_metrics` | VNE/EE/CDP and regime — how much the graph is still developing. Useful for pacing, not for truth. A VNE spike on emotional input is a warning, not a breakthrough. |
| `detect_gaps` / `generate_catalyst_questions` | Under-connected regions between clusters, and questions that would bridge them. Good for deciding what to explore next. |

> [!IMPORTANT]
> The framework reports; it does not adjudicate truth. Never describe a cycle, metric, agent, or proof you did not actually run. If a tool errors, say so and continue without it. Do not celebrate metric movements as discoveries.

## Native AGEM tools (call directly)

| Tool | When to use |
| :--- | :--- |
| `run_agem_cycle` | First, on any new topic. Run 2–3 times for contested/multi-part topics — each cycle grows the graph. |
| `get_agem_state` | Quick health check: iteration, graph size, H⁰/H¹, gaps. |
| `get_graph_topology` | Primary inspection tool. `detail='concepts'` (default) or `'words'`. |
| `get_cohomology`, `get_soc_metrics` | Secondary inspection — interpret per the table above. |
| `detect_gaps`, `generate_catalyst_questions` | Decide what to probe next. |
| `search_context` | Semantic search across the LCM store. |
| `spawn_agem_agent`, `reset_agem_engine`, `read_skill` | Agent/lifecycle/skill management. |

## Verifying logical claims — mcp-logic

Whenever a question turns on whether claims are **consistent, contradictory, or entailing**, do not assert it from the graph — the graph cannot detect contradiction. Verify with formal logic. This is the one external reasoning tool you should reach for routinely.

```
call_mcp_tool(server_name="mcp-logic", tool_name="prove",
  arguments={"premises": ["all x (Man(x) -> Mortal(x))", "Man(socrates)"],
             "goal": "Mortal(socrates)"})
```

- `prove` — does the goal follow from the premises?
- `find_counterexample` — a model where premises hold but the goal fails.
- `find_model` — a model satisfying the premises (consistency check).
- `check_contingency` — is a propositional formula contingent?

Write formulas as plain first-order-logic **strings**, one predicate per fact — never nested objects. If a call returns a validation error, fix the argument shape and retry once. Do not fabricate a result.

## MCP meta-tools — accessing servers

1. `list_mcp_servers` — what's connected (names + tool counts).
2. `list_server_tools(server_name)` — a server's tools and their schemas. Call this **before** using an unfamiliar tool; do not guess argument names.
3. `call_mcp_tool(server_name, tool_name, arguments)` — invoke any tool. Always nest arguments inside the `arguments` object.

## Other servers

Beyond `mcp-logic`, the connected servers are either utilities (`fetch`, `sqlite`, `memory`, `desktop-commander`, `playwright`, `docker`) used only when a task explicitly calls for them, or experimental reasoning servers not part of the standard workflow. Ignore the experimental ones unless the user names one specifically. When in doubt, rely on the native AGEM tools plus `mcp-logic`.
