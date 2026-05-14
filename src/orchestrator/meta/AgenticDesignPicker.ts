/**
 * AgenticDesignPicker.ts
 *
 * Phase 7: Meta-Orchestrator Logic Layer.
 * Evaluates task requirements and generates a TopologicalManifest based on the
 * agentic decision tree methodology.
 *
 * Architecture:
 *   1. Evaluate: Prompt LLM with task and constraints.
 *   2. Parse: Extract structured manifest.
 *   3. Inhibit: Apply complexity penalties and guardrails.
 */

import type { LLMProvider } from "../../../interface/backend/src/services/llm.js";
import type { TopologicalManifest } from "../interfaces.js";

/**
 * PickerConstraints — input constraints for the design evaluation.
 */
export interface PickerConstraints {
  /** Maximum tokens allowed for the entire reasoning process. */
  readonly maxTokens?: number;
  /** Timeout in milliseconds for the reasoning process. */
  readonly timeoutMs?: number;
  /** Desired output quality/accuracy level. */
  readonly accuracyRequirement: "high" | "standard";
}

/**
 * AgenticDesignPicker — the primary routing engine for the meta-orchestrator.
 */
export class AgenticDesignPicker {
  #llm: LLMProvider;

  /**
   * @param llm - The LLM provider used to perform the topological analysis.
   */
  constructor(llm: LLMProvider) {
    this.#llm = llm;
  }

  /**
   * evaluate — analyzes the task prompt and produces a topological manifest.
   *
   * @param prompt - The raw user task.
   * @param constraints - System-level constraints (latency, accuracy).
   * @returns A validated TopologicalManifest.
   */
  async evaluate(prompt: string, constraints: PickerConstraints): Promise<TopologicalManifest> {
    const systemPrompt = `You are the AGEM Meta-Orchestrator Gatekeeper. 
Your task is to analyze a user request and determine the optimal agentic topology based on the "Agentic Design Pattern Decision Tree".

### The Five Questions:
1. Is the Solution Path Known in Advance? (Fixed vs. Adaptive)
2. Is This a Fixed Workflow? (Sequential Workflow Pattern)
3. Does the Task Require Tool Access or External Information?
4. Is the Task Structure Articulable Before Execution? (Planning vs. ReAct)
5. Does Output Quality Matter More Than Response Speed? (Reflection loop)
6. Does the Task Have a Specialization or Scale Problem? (Multi-Agent)

### Routing Logic:
- If Known Path & Predictable -> sequential_workflow
- If Unknown Path & Articulable Structure -> planning_react
- If Unknown Path & Emergent Structure -> react
- If Specialization/Scale needed -> multi_agent

### Inhibitory Guardrails:
- Default to the simplest architecture (react or sequential_workflow).
- Only upgrade to planning_react or multi_agent if explicitly justified by task complexity.
- If accuracyRequirement is "high", consider enabling reflection.

### Output Format:
Return ONLY a JSON object matching this schema:
{
  "topologyType": "sequential_workflow" | "planning_react" | "react" | "multi_agent",
  "requiredTools": string[],
  "reflectionEnabled": boolean,
  "maxIterations": number,
  "specialistRoles": string[] | null,
  "constraints": {
    "maxTokens": number,
    "timeoutMs": number
  },
  "rationale": string
}`;

    const completion = await this.#llm.chat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Task: ${prompt}\nConstraints: ${JSON.stringify(constraints)}` }
      ],
      signal: constraints.timeoutMs ? AbortSignal.timeout(constraints.timeoutMs) : undefined
    });

    try {
      const jsonContent = this.#extractJson(completion.content);
      const manifest = JSON.parse(jsonContent) as TopologicalManifest;
      return this.#applyInhibitoryGuardrails(manifest, constraints);
    } catch (err) {
      console.error("[Picker] Failed to parse manifest, defaulting to react:", err);
      return {
        topologyType: "react",
        requiredTools: [],
        reflectionEnabled: false,
        maxIterations: 10,
        constraints: {
          maxTokens: constraints.maxTokens || 4000,
          timeoutMs: constraints.timeoutMs || 30000
        },
        rationale: "Fallback due to parsing error: " + (err instanceof Error ? err.message : String(err))
      };
    }
  }

  /**
   * #applyInhibitoryGuardrails — enforces architectural leaness and safety limits.
   */
  #applyInhibitoryGuardrails(manifest: TopologicalManifest, constraints: PickerConstraints): TopologicalManifest {
    // 1. Complexity Penalty: multi_agent requires at least 2 distinct roles
    if (manifest.topologyType === "multi_agent") {
      if (!manifest.specialistRoles || manifest.specialistRoles.length < 2) {
        return {
          ...manifest,
          topologyType: "react",
          rationale: manifest.rationale + " [Inhibitory: Downgraded multi_agent -> react (insufficient specialization)]"
        };
      }
    }

    // 2. Reflection Guardrail: Disable reflection if accuracy requirement is standard
    if (manifest.reflectionEnabled && constraints.accuracyRequirement === "standard") {
      return {
        ...manifest,
        reflectionEnabled: false,
        rationale: manifest.rationale + " [Inhibitory: Reflection disabled for standard accuracy task]"
      };
    }

    // 3. Iteration Cap: Hard upper bound on reasoning loops
    const MAX_ITER = 30;
    if (manifest.maxIterations > MAX_ITER) {
      return {
        ...manifest,
        maxIterations: MAX_ITER,
        rationale: manifest.rationale + ` [Inhibitory: Capped iterations at ${MAX_ITER}]`
      };
    }

    return manifest;
  }

  /**
   * #extractJson — helper to extract JSON from a potentially markdown-formatted response.
   */
  #extractJson(text: string): string {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? jsonMatch[0] : text;
  }
}
