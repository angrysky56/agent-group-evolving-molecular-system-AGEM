# AI Specification: Agentic Design Picker (Meta-Orchestrator)

## 1. Objective

Implement a meta-orchestrator that evaluates task requirements before execution to select the optimal agentic architecture (topology). This ensures architectural efficiency, prevents over-engineering, and maintains structural integrity across heterogeneous tasks.

## 2. The Interface: The Gatekeeper

The picker operates as the upstream entry point. It receives:
- **Raw Task Prompt**: The user's request.
- **System Constraints**: 
  - `acceptable_latency`: Maximum time for execution.
  - `accuracy_requirements`: High fidelity vs. speed.
  - `token_budget`: Maximum token consumption.

**Role**: Initial evaluator before substantial compute is spent on the actual problem.

## 3. The Evaluation Matrix (The Logic Layer)

Maps the task against five core decision points:

| Decision Point | Description | Routing Logic |
| --- | --- | --- |
| **Path & Workflow Predictability** | Is the task a fixed DAG? | If YES -> **Sequential Workflow Engine** (e.g., Dagu manifest). |
| **Structural Articulability** | Can dependencies be defined upfront? | If YES -> **Planning + ReAct**. If NO -> **Standard ReAct**. |
| **Validation Tradeoff** | Cost of error vs. speed. | If HIGH-FIDELITY -> Append **Reflection loop** (critique-refine). |
| **Domain Span & Scale** | Cognitive bottlenecks / context limits. | If COMPLEX/MULTI-DOMAIN -> Provision **Multi-Agent Specialist System**. |
| **Inhibitory Check** | Simplest path verification. | Default to simplest architecture unless explicitly justified. |

## 4. The Output: Topological Manifests

The picker outputs a structured JSON blueprint:

```json
{
  "topology_type": "planning_react | workflow | multi_agent | react",
  "required_tools": ["tool_a", "tool_b"],
  "reflection_enabled": true,
  "max_iterations": 5,
  "specialist_roles": ["architect", "reviewer"],
  "constraints": {
    "max_tokens": 4000,
    "timeout_ms": 30000
  },
  "rationale": "Task requires multi-step planning and tool use with high accuracy requirements."
}
```

## 5. The Constraint & Inhibitory Layer

Strict guardrails to prevent hallucinating complexity:
- **Complexity Penalty**: Forced justification for stepping up from Sequential -> ReAct -> Multi-Agent.
- **Tool Contract Enforcement**: Evaluate exactly which external connections are necessary.
- **Resource Inhibitors**: Reject heavy topologies if latency/token constraints are tight.

## 6. Execution Handoff

The Main Orchestrator parses the manifest:
1. Spins up required contexts.
2. Attaches necessary tool access.
3. Initiates execution loop according to `topology_type`.

## 7. Evaluation Strategy (Phase 7 Success Criteria)

- **Routing Accuracy**: Test suite with labeled tasks vs. picker output.
- **Inhibitory Pass**: Simple tasks must not trigger complex loops.
- **End-to-End Actualization**: Orchestrator correctly interprets and executes based on manifest.
