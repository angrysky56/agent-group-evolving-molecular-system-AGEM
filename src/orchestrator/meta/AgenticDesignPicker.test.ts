/**
 * AgenticDesignPicker.test.ts
 *
 * Tests for the Meta-Orchestrator's topological routing logic.
 */

import { describe, it, expect, vi } from "vitest";
import { AgenticDesignPicker } from "./AgenticDesignPicker.js";
import type { LLMProvider } from "../interfaces.js";

describe("AgenticDesignPicker", () => {
  it("routes a simple greeting to react with no tools", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "react",
          requiredTools: [],
          reflectionEnabled: false,
          maxIterations: 5,
          constraints: { maxTokens: 1000, timeoutMs: 5000 },
          rationale: "Simple greeting"
        })
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Hello", { accuracyRequirement: "standard" });

    expect(manifest.topologyType).toBe("react");
    expect(manifest.reflectionEnabled).toBe(false);
    expect(manifest.maxIterations).toBe(5);
  });

  it("enables reflection when accuracyRequirement is high", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "planning_react",
          requiredTools: ["web_search"],
          reflectionEnabled: true,
          maxIterations: 15,
          constraints: { maxTokens: 8000, timeoutMs: 60000 },
          rationale: "Complex research task requiring high accuracy"
        })
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Deep research on AGEM", { accuracyRequirement: "high" });

    expect(manifest.topologyType).toBe("planning_react");
    expect(manifest.reflectionEnabled).toBe(true);
  });

  it("applies inhibitory guardrails to multi_agent with insufficient roles", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "multi_agent",
          specialistRoles: ["researcher"], // Only one role
          requiredTools: ["search"],
          reflectionEnabled: false,
          maxIterations: 10,
          constraints: { maxTokens: 4000, timeoutMs: 30000 },
          rationale: "Routing to multi-agent for research"
        })
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Research task", { accuracyRequirement: "standard" });

    // Should be downgraded to react because multi_agent requires >= 2 roles in guardrails
    expect(manifest.topologyType).toBe("react");
    expect(manifest.rationale).toContain("[Inhibitory: Downgraded multi_agent -> react (insufficient specialization)]");
  });

  it("disables reflection for standard accuracy tasks via guardrail", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "react",
          requiredTools: [],
          reflectionEnabled: true, // Requested by LLM
          maxIterations: 10,
          constraints: { maxTokens: 4000, timeoutMs: 30000 },
          rationale: "Task is slightly complex"
        })
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Medium task", { accuracyRequirement: "standard" });

    // Guardrail should disable reflection for standard accuracy
    expect(manifest.reflectionEnabled).toBe(false);
    expect(manifest.rationale).toContain("[Inhibitory: Reflection disabled for standard accuracy task]");
  });

  it("caps maximum iterations via guardrail", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          topologyType: "react",
          requiredTools: [],
          reflectionEnabled: false,
          maxIterations: 100, // Too many
          constraints: { maxTokens: 4000, timeoutMs: 30000 },
          rationale: "Infinite loop requested"
        })
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Loop me", { accuracyRequirement: "standard" });

    expect(manifest.maxIterations).toBe(30); // Capped at 30
    expect(manifest.rationale).toContain("[Inhibitory: Capped iterations at 30]");
  });

  it("falls back to react on LLM failure or malformed JSON", async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: "I am not a JSON object"
      })
    } as unknown as LLMProvider;

    const picker = new AgenticDesignPicker(mockLLM);
    const manifest = await picker.evaluate("Break me", { accuracyRequirement: "standard" });

    expect(manifest.topologyType).toBe("react");
    expect(manifest.rationale).toContain("Fallback due to parsing error");
  });
});
