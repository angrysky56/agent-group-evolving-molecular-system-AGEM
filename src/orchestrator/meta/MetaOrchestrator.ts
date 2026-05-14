/**
 * MetaOrchestrator.ts
 *
 * Phase 7: Automated Architectural Routing.
 * Integrates the Design Picker with the AGEM execution pipeline.
 *
 * The MetaOrchestrator acts as the "Pre-Flight" layer that determines the
 * most efficient architectural topology for a given task before any
 * reasoning cycles are spent.
 */

import { AgenticDesignPicker, type PickerConstraints } from "./AgenticDesignPicker.js";
import { Orchestrator } from "../ComposeRootModule.js";
import type { LLMProvider } from "../../../interface/backend/src/services/llm.js";
import type { TopologicalManifest } from "../interfaces.js";

/**
 * MetaOrchestrator — high-level coordinator that analyzes task topology
 * before delegating to specific execution strategies.
 */
export class MetaOrchestrator {
  #picker: AgenticDesignPicker;
  #orchestrator: Orchestrator;

  /**
   * @param llm - The LLM provider used by the Design Picker.
   * @param orchestrator - The underlying AGEM orchestrator for standard execution.
   */
  constructor(llm: LLMProvider, orchestrator: Orchestrator) {
    this.#picker = new AgenticDesignPicker(llm);
    this.#orchestrator = orchestrator;
  }

  /**
   * plan — performs topological analysis without executing the task.
   * Useful for UI previews or architectural dry-runs.
   *
   * @param prompt - The reasoning prompt to analyze.
   * @param constraints - System constraints for routing.
   * @returns The generated TopologicalManifest.
   */
  async plan(prompt: string, constraints: PickerConstraints): Promise<TopologicalManifest> {
    return await this.#picker.evaluate(prompt, constraints);
  }

  /**
   * execute — the primary entry point for AGEM reasoning in Phase 7+.
   * 
   * Pipeline:
   *   1. Topological Routing: Analyze task complexity and select pattern.
   *   2. Inhibitory Check: Apply complexity penalties to prevent over-engineering.
   *   3. Execution Handoff: Delegate to the standard Orchestrator reasoning pipeline.
   *
   * @param prompt - The reasoning prompt.
   * @param constraints - System constraints for routing.
   * @param signal - Optional abort signal for cancellation.
   * @returns The manifest and execution metadata.
   */
  async execute(
    prompt: string, 
    constraints: PickerConstraints, 
    signal?: AbortSignal
  ): Promise<{ manifest: TopologicalManifest }> {
    // Phase 1: Topological Routing (The Picker)
    // This step consumes minimal tokens to determine the most efficient path.
    const manifest = await this.#picker.evaluate(prompt, constraints);
    
    console.log(`[META] Routing task to topology: ${manifest.topologyType}`);
    console.log(`[META] Rationale: ${manifest.rationale}`);
    console.log(`[META] Reflection: ${manifest.reflectionEnabled ? "ENABLED" : "DISABLED"}`);

    if (signal?.aborted) throw new Error("Aborted during routing phase.");

    // Phase 2: Execution Handoff
    // Future expansion: In Phase 8, we will dispatch to different execution
    // strategies (Sequential, ReAct, Planning, Multi-Agent) based on manifest.topologyType.
    // For now, we utilize the standard iterative AGEM pipeline.
    await this.#orchestrator.runReasoning(prompt, signal);

    return { manifest };
  }

  /**
   * getOrchestrator — returns the underlying AGEM orchestrator instance.
   */
  getOrchestrator(): Orchestrator {
    return this.#orchestrator;
  }
}
