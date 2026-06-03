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
| `run_agem_cycle` | First, on a new topic — pass the material to analyse as `prompt`; it ingests into a persistent, accumulating graph. Run again ONLY with genuinely new content (your synthesis, answers to catalyst questions, the next step). |
| `get_agem_state` | Quick health check: iteration, graph size, H⁰/H¹, gaps. |
| `get_graph_topology` | Primary inspection tool. `detail='concepts'` (default) or `'words'`. |
| `get_cohomology`, `get_soc_metrics` | Secondary inspection — interpret per the table above. |
| `detect_gaps`, `generate_catalyst_questions` | Decide what to probe next. |
| `search_context` | Semantic search across the LCM store. |
| `spawn_agem_agent`, `reset_agem_engine`, `read_skill` | Agent/lifecycle/skill management. |

## Verifying logical claims — mcp-logic (REQUIRED for contested topics)

Whenever a corpus holds multiple positions, claims, or theories that might conflict, you **must** verify their logical relations with mcp-logic — the graph cannot detect contradiction, entailment, or consistency. Do not adjudicate "these are consistent / contradictory / the same axis" in prose; check it.

Procedure: name the blocks (use the concept communities) → state each block's core claim as a single FOL proposition → test each related pair with mcp-logic → report the verdicts.

```
call_mcp_tool(server_name="mcp-logic", tool_name="prove",
  arguments={"premises": ["all x (man(x) -> mortal(x))", "man(socrates)"],
             "conclusion": "mortal(socrates)"})
```

- `prove` — does the conclusion follow? Field is **`conclusion`** (singular), not `goal`.
- `find_counterexample` — `{"premises":[...], "conclusion":"..."}` → a model where premises hold but conclusion fails (`model_found` ⇒ conclusion does not follow).
- `check_well_formed` — `{"statements":[...]}` to syntax-check before proving.

**Consistency idiom:** to test whether claims can all hold together, `find_counterexample` with the claims as `premises` and `conclusion="$F"`. `model_found` ⇒ CONSISTENT; `no_model_found` ⇒ CONTRADICTORY.

**Syntax (where calls fail — follow exactly):**
- `premises` is an array, **one formula per element**. Never combine statements in one string; never use a newline inside a formula (a literal `\n` fails) — split into separate elements.
- ASCII operators: `->` `<->` `&` `|` `~`. Quantifiers parenthesized: `all x (man(x) -> mortal(x))`.
- Lowercase predicates/constants, one predicate per fact.
- On a validation error, fix the shape (split newlines; `goal`→`conclusion`) and retry once. Never fabricate a result.

## MCP meta-tools — accessing servers

1. `list_mcp_servers` — what's connected (names + tool counts).
2. `list_server_tools(server_name)` — a server's tools and their schemas. Call this **before** using an unfamiliar tool; do not guess argument names.
3. `call_mcp_tool(server_name, tool_name, arguments)` — invoke any tool. Always nest arguments inside the `arguments` object.

## Other servers

Beyond `mcp-logic`, the connected servers are either utilities (`fetch`, `sqlite`, `memory`, `desktop-commander`, `playwright`, `docker`) used only when a task explicitly calls for them, or experimental reasoning servers not part of the standard workflow. Ignore the experimental ones unless the user names one specifically. When in doubt, rely on the native AGEM tools plus `mcp-logic`.
