/**
 * MetaOrchestrator.test.ts
 *
 * Tests for the Meta-Orchestrator coordination layer.
 */

import { describe, it, expect, vi } from "vitest";
import { MetaOrchestrator } from "./MetaOrchestrator.js";
import { Orchestrator } from "../ComposeRootModule.js";
import type { LLMProvider } from "../interfaces.js";

describe("MetaOrchestrator", () => {
  it("executes the routing pipeline and hands off to Orchestrator", async () => {
    // 1. Mock LLM for the Design Picker
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "react",
          requiredTools: [],
          reflectionEnabled: false,
          maxIterations: 10,
          constraints: { maxTokens: 4000, timeoutMs: 30000 },
          rationale: "Test routing logic"
        }),
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      })
    } as unknown as LLMProvider;

    // 2. Mock Orchestrator for the execution handoff
    const mockOrch = {
      runReasoning: vi.fn().mockResolvedValue(undefined)
    } as unknown as Orchestrator;

    const meta = new MetaOrchestrator(mockLLM, mockOrch);
    
    // 3. Run execution
    const result = await meta.execute("How are you?", { 
      accuracyRequirement: "standard" 
    });

    // 4. Assertions
    expect(mockLLM.chat).toHaveBeenCalled();
    expect(mockOrch.runReasoning).toHaveBeenCalledWith("How are you?", undefined);
    expect(result.manifest.topologyType).toBe("react");
    expect(result.manifest.rationale).toBe("Test routing logic");
  });

  it("propagates abort signals through the pipeline", async () => {
    const mockLLM = {
      chat: vi.fn().mockImplementation(() => new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Aborted")), 10);
      }))
    } as unknown as LLMProvider;

    const mockOrch = {
      runReasoning: vi.fn().mockResolvedValue(undefined)
    } as unknown as Orchestrator;

    const meta = new MetaOrchestrator(mockLLM, mockOrch);
    const controller = new AbortController();
    controller.abort();

    await expect(meta.execute("Test", { accuracyRequirement: "standard" }, controller.signal))
      .rejects.toThrow("Aborted");
  });

  it("allows planning without execution", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "planning_react",
          requiredTools: ["web_search"],
          reflectionEnabled: true,
          maxIterations: 20,
          constraints: { maxTokens: 8000, timeoutMs: 60000 },
          rationale: "Planning required"
        }),
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      })
    } as unknown as LLMProvider;

    const mockOrch = {
      runReasoning: vi.fn()
    } as unknown as Orchestrator;

    const meta = new MetaOrchestrator(mockLLM, mockOrch);
    const manifest = await meta.plan("Complex task", { accuracyRequirement: "high" });

    expect(manifest.topologyType).toBe("planning_react");
    expect(mockOrch.runReasoning).not.toHaveBeenCalled();
  });
});
