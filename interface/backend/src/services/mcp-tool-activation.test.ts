import { describe, expect, it } from "vitest";
import {
  explicitlyRequestedMcpServers,
  shouldExposeMcpMetaTools,
  unwrapNestedToolArguments,
} from "./mcp-tool-activation.js";

describe("MCP tool activation", () => {
  it("does not activate servers from generic corpus vocabulary", () => {
    expect(
      explicitlyRequestedMcpServers(
        "This corpus compares logical reasoning and memory-based choice.",
        ["mcp-logic", "advanced-reasoning"],
      ),
    ).toEqual([]);
  });

  it("activates a server when its canonical name is explicitly present", () => {
    expect(
      explicitlyRequestedMcpServers(
        "Use mcp-logic for a one-off proof.",
        ["mcp-logic", "advanced-reasoning"],
      ),
    ).toEqual(["mcp-logic"]);
  });

  it("hides MCP discovery and invocation unless a server was requested", () => {
    expect(shouldExposeMcpMetaTools([])).toBe(false);
    expect(shouldExposeMcpMetaTools(["mcp-logic"])).toBe(true);
  });

  it("unwraps the direct-MCP nested arguments shape without discarding siblings", () => {
    expect(
      unwrapNestedToolArguments({
        arguments: { premises: ["p(a)"], conclusion: "q(a)" },
      }),
    ).toEqual({ premises: ["p(a)"], conclusion: "q(a)" });
    expect(
      unwrapNestedToolArguments({
        arguments: { premises: ["wrong(a)"] },
        premises: ["right(a)"],
      }),
    ).toEqual({
      arguments: { premises: ["wrong(a)"] },
      premises: ["right(a)"],
    });
  });
});
