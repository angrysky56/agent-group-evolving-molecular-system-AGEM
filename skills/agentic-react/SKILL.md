---
name: "agentic-react"
description: "ReAct (Reasoning + Acting) pattern for adaptive, exploratory tasks with unknown solution paths. Iteratively alternate between reasoning and tool actions."
---

# Agentic ReAct Pattern

> [!TIP]
> **TL;DR**: Use this pattern when the solution path is NOT known upfront. The agent iteratively alternates between reasoning and tool actions until a stopping condition is met.
> **Key Principle**: "Best default for real-world tasks. Flexible exploration via tool use and step-by-step reasoning."

## Pattern Overview

The **ReAct pattern** treats the next best action as not fully knowable in advance. The agent iteratively:

1. **Reasons** about the current state
2. **Acts** by calling tools or making decisions
3. **Observes** the results
4. **Repeats** until stopping condition is met

```
┌─────────────────────────────────────────┐
│           ITERATION LOOP                 │
│  ┌─────────┐    ┌─────────┐             │
│  │ Reason  │───▶│  Act    │             │
│  │ "What's │    │ Call    │             │
│  │ next?"  │    │ tool X  │             │
│  └────┬────┘    └────┬────┘             │
│       │               │                 │
│       │    ┌─────────┐│                 │
│       ◀───│ Observe │─┘                 │
│            │ Get     │                   │
│            │ result  │                   │
│            └─────────┘                   │
│                   │                       │
│         ┌─────────┴─────────┐            │
│         ▼                   ▼            │
│   [Stop? YES]          [Stop? NO]        │
│   → Done               → Next iteration  │
└─────────────────────────────────────────┘
```

## Decision Gate

**When to use**: Apply this pattern when:

- **Question 2b** = YES: Task requires tool access or external information
- **Question 3** = NO: Task structure is NOT articulable before execution (structure emerges during execution)
- Quality criteria are unclear or latency matters more than perfection

## Critical Design Elements

### 1. Clear Stopping Conditions

| Good Stopping                        | Bad Stopping     |
| ------------------------------------ | ---------------- |
| "Task completed" + validation passed | "Do a good job"  |
| "N tool calls reached"               | "Think harder"   |
| "External API confirms state"        | "Feel confident" |

### 2. Tool Design Contracts

Each tool should have:

- **Clear input specification**
- **Predictable output format**
- **Defined failure modes**

> From Anthropic's engineering guide: _"Effective tool design is the foundation everything else sits on."_

### 3. Progress Tracking

Track reasoning history to:

- Avoid revisiting resolved questions
- Detect excessive looping
- Provide audit trail

## Failure Mode: Excessive Looping

| Signal                        | What It Means                     | Suggested Fix            |
| ----------------------------- | --------------------------------- | ------------------------ |
| Too many steps                | Agent is uncertain about progress | Add stopping conditions  |
| Revisiting resolved questions | No progress tracking              | Implement state tracking |
| Getting stuck on tool calls   | Tool contracts unclear            | Refine tool definitions  |

### Escalation Fix for Looping

```
If ReAct loops excessively →
  Task likely needs planning (agentic-planner), OR
  Better tool structure, OR
  Clearer stopping condition
```

## ReAct vs. Planning

| ReAct                              | Planning                      |
| ---------------------------------- | ----------------------------- |
| Structure emerges during execution | Structure defined upfront     |
| Flexible, adaptive                 | Rigid but organized           |
| Late failure detection             | Early dependency exposure     |
| Good for exploration               | Good for complex dependencies |

## AGEM Integration

### Native Tools

- `run_agem_cycle` — Each iteration of the loop
- `get_cohomology` — Check for inconsistencies in reasoning
- `detect_gaps` — Find knowledge gaps causing looping
- `spawn_agem_agent` — Spawn specialized reasoner if stuck

### MCP Server Usage

- **`advanced-reasoning`** — Meta-cognitive reasoning with confidence tracking
- **`verifier-graph`** — Build causal reasoning chains for audit
- **`hipai-montague`** — Track beliefs and calibrate when reasoning stalls

### Workflow Template

```
1. Initialize: goal + stopping condition
2. LOOP:
   a. Reason: analyze current state
   b. Act: call tool or make decision
   c. Observe: get result
   d. Evaluate: check stopping condition
   e. If stopped → output result
   f. If not → check for loops → continue
3. On H¹ > 0 → spawn_agem_agent for alternative perspective
```

## Quick-Start Template

```markdown
## ReAct Task Definition

**Task**: [What needs to be done]
**Solution Path**: [UNKNOWN - key indicator for ReAct]
**Toolset**: [Available tools]

### Stopping Conditions:

1. [Condition 1]
2. [Condition 2]

### Max Iterations: [N - prevent runaway loops]

### Escalation Triggers:

- [Loop detected] → escalate to [agentic-planner]
- [Specialization needed] → escalate to [agentic-multiagent]
- [Quality critical] → add [agentic-reflection]
```

## Combination Patterns

ReAct is often **layered with other patterns**:

| Layer         | Pattern            | When                         |
| ------------- | ------------------ | ---------------------------- |
| Foundation    | ReAct              | Always                       |
| + Planning    | agentic-planner    | When structure becomes clear |
| + Reflection  | agentic-reflection | When quality matters         |
| + Multi-Agent | agentic-multiagent | When specialization needed   |

---

## See Also

- [agentic-planner](agentic-planner) — Add planning layer when structure is articulable
- [agentic-reflection](agentic-reflection) — Add quality checks when output matters
- [agentic-multiagent](agentic-multiagent) — Add specialists when needed
