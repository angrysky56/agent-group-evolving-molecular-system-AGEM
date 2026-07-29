import { describe, expect, it } from "vitest";
import {
  finalizeRunOutcome,
  sanitizeToolsDisabledFinal,
} from "./run-termination.js";

describe("run termination", () => {
  it("never emits normal completion or a satisfied contract after timeout", () => {
    const outcome = finalizeRunOutcome("timed-out", {
      satisfied: true,
      items: [],
    });

    expect(outcome.emitDone).toBe(false);
    expect(outcome.contract).toMatchObject({
      satisfied: false,
      terminalStatus: "timed-out",
    });
  });

  it("surfaces turn exhaustion as a partial non-success while still emitting the final response", () => {
    const outcome = finalizeRunOutcome("max-turns", {
      satisfied: false,
      items: [{ id: "derive", satisfied: false }],
    });

    expect(outcome.status).toBe("max-turns");
    expect(outcome.emitDone).toBe(true);
    expect(outcome.contract).toMatchObject({
      satisfied: false,
      terminalStatus: "max-turns",
    });
  });

  it("downgrades completed when the workflow contract is still unmet", () => {
    const outcome = finalizeRunOutcome("completed", {
      satisfied: false,
      items: [{ id: "derive", satisfied: false }],
    });

    expect(outcome.status).toBe("contract-unmet");
    expect(outcome.emitDone).toBe(true);
    expect(outcome.contract).toMatchObject({
      satisfied: false,
      terminalStatus: "contract-unmet",
    });
  });

  it("ignores tool calls from a tools-disabled final response", () => {
    const final = sanitizeToolsDisabledFinal(
      {
        content: "",
        tool_calls: [{ function: { name: "extract_and_verify_claims" } }],
      },
      "PARTIAL / DEFERRED",
    );

    expect(final).toEqual({
      content: "PARTIAL / DEFERRED",
      ignoredToolCalls: 1,
      usedFallback: true,
    });
  });

  it("keeps a textual final response while stripping any ignored calls", () => {
    expect(
      sanitizeToolsDisabledFinal(
        {
          content: "PARTIAL / DEFERRED — continue in a new request.",
          tool_calls: [{ function: { name: "prove" } }],
        },
        "fallback",
      ),
    ).toEqual({
      content: "PARTIAL / DEFERRED — continue in a new request.",
      ignoredToolCalls: 1,
      usedFallback: false,
    });
  });

  it("does not expose raw tool-call JSON as the final answer", () => {
    expect(
      sanitizeToolsDisabledFinal(
        {
          content: '{"name":"prove","arguments":{}}',
          tool_calls: [{ function: { name: "prove" } }],
        },
        "PARTIAL / DEFERRED",
      ),
    ).toEqual({
      content: "PARTIAL / DEFERRED",
      ignoredToolCalls: 1,
      usedFallback: true,
    });
  });
});
