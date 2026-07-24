/**
 * tool-dispatch.test.ts
 *
 * The properties that make parallel dispatch safe rather than just faster:
 *   - reads and writes are classified correctly, unknowns default to mutating
 *   - a mutating call is never overlapped with anything
 *   - read/write ORDER is preserved (post-cycle reads still see post-cycle state)
 *   - results come back in original call order regardless of completion order
 *   - concurrency is bounded
 */

import { describe, it, expect } from "vitest";
import {
  sideEffectClass,
  isRetrySafe,
  planWaves,
  dispatchBatch,
  resolveMcpTarget,
} from "./tool-dispatch.js";

const classify = (c: { fn: string; args?: Record<string, unknown> }) =>
  sideEffectClass(c.fn, c.args ?? {});

describe("sideEffectClass", () => {
  it("treats engine reads as pure", () => {
    for (const t of [
      "get_agem_state",
      "get_cohomology",
      "get_graph_topology",
      "get_soc_metrics",
      "detect_gaps",
      "search_context",
      "evaluate_logical_consistency",
    ]) {
      expect(sideEffectClass(t)).toBe("pure");
    }
  });

  it("treats graph/scenario mutations as mutating", () => {
    for (const t of [
      "run_agem_cycle",
      "spawn_agem_agent",
      "reset_agem_engine",
      "record_scenario_turn",
      "complete_scenario",
    ]) {
      expect(sideEffectClass(t)).toBe("mutating");
    }
  });

  it("defaults unknown tools to mutating", () => {
    // Misclassifying a read as a write costs latency; the reverse corrupts
    // the graph. Unknown must fall on the safe side.
    expect(sideEffectClass("some_new_tool")).toBe("mutating");
  });

  it("allows only the verified pure MCP allowlist through", () => {
    expect(
      sideEffectClass("call_mcp_tool", {
        server_name: "mcp-logic",
        tool_name: "prove",
      }),
    ).toBe("pure");
    expect(sideEffectClass("mcp__mcp-logic__find_counterexample")).toBe("pure");
    // Any other MCP server is unknown territory.
    expect(
      sideEffectClass("call_mcp_tool", {
        server_name: "desktop-commander",
        tool_name: "write_file",
      }),
    ).toBe("mutating");
    expect(sideEffectClass("mcp__sqlite__write_query")).toBe("mutating");
  });
});

describe("resolveMcpTarget", () => {
  it("handles both calling conventions and strips a leading colon", () => {
    expect(
      resolveMcpTarget("call_mcp_tool", {
        server_name: ":mcp-logic",
        tool_name: "prove",
      }),
    ).toBe("mcp-logic/prove");
    expect(resolveMcpTarget("mcp__mcp-logic__prove", {})).toBe(
      "mcp-logic/prove",
    );
    expect(resolveMcpTarget("get_cohomology", {})).toBeNull();
  });
});

describe("isRetrySafe", () => {
  it("never blind-retries run_agem_cycle", () => {
    // Retrying an ingest double-counts co-occurrences in the persistent graph.
    expect(isRetrySafe("run_agem_cycle", { prompt: "x" })).toBe(false);
  });

  it("allows retry of pure reads and idempotent writes", () => {
    expect(isRetrySafe("get_cohomology")).toBe(true);
    expect(isRetrySafe("reset_agem_engine")).toBe(true);
    expect(isRetrySafe("create_skill")).toBe(true);
  });

  it("does not blind-retry arbitrary MCP calls", () => {
    expect(
      isRetrySafe("call_mcp_tool", {
        server_name: "desktop-commander",
        tool_name: "write_file",
      }),
    ).toBe(false);
    expect(isRetrySafe("mcp__mcp-logic__prove", {})).toBe(true);
  });
});

describe("planWaves", () => {
  it("groups consecutive reads into one wave", () => {
    const calls = [
      { fn: "get_cohomology" },
      { fn: "get_soc_metrics" },
      { fn: "detect_gaps" },
    ];
    const waves = planWaves(calls, classify);
    expect(waves).toHaveLength(1);
    expect(waves[0].kind).toBe("pure");
    expect(waves[0].indices).toEqual([0, 1, 2]);
  });

  it("isolates every mutating call in its own wave", () => {
    const calls = [
      { fn: "run_agem_cycle" },
      { fn: "spawn_agem_agent" },
    ];
    const waves = planWaves(calls, classify);
    expect(waves).toHaveLength(2);
    expect(waves.every((w) => w.calls.length === 1)).toBe(true);
  });

  it("preserves read/write ordering across the batch", () => {
    // A cycle followed by reads must not let the reads start early — they
    // would observe pre-cycle state.
    const calls = [
      { fn: "get_agem_state" },
      { fn: "run_agem_cycle" },
      { fn: "get_cohomology" },
      { fn: "get_soc_metrics" },
    ];
    const waves = planWaves(calls, classify);
    expect(waves.map((w) => w.indices)).toEqual([[0], [1], [2, 3]]);
  });
});

describe("dispatchBatch", () => {
  it("returns results in ORIGINAL order even when they finish out of order", async () => {
    const calls = [
      { fn: "get_cohomology", delay: 30 },
      { fn: "get_soc_metrics", delay: 1 },
      { fn: "detect_gaps", delay: 15 },
    ];
    const out = await dispatchBatch(
      calls,
      async (c) => {
        await new Promise((r) => setTimeout(r, c.delay));
        return c.fn;
      },
      { classify: (c) => sideEffectClass(c.fn) },
    );
    expect(out).toEqual(["get_cohomology", "get_soc_metrics", "detect_gaps"]);
  });

  it("actually overlaps reads", async () => {
    let inFlight = 0;
    let peak = 0;
    const calls = Array.from({ length: 4 }, () => ({ fn: "get_cohomology" }));

    await dispatchBatch(
      calls,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return null;
      },
      { classify: (c) => sideEffectClass(c.fn), maxConcurrency: 4 },
    );

    expect(peak).toBeGreaterThan(1);
  });

  it("never overlaps a mutating call", async () => {
    let inFlight = 0;
    let peakDuringMutation = 0;
    const calls = [
      { fn: "get_cohomology" },
      { fn: "run_agem_cycle" },
      { fn: "get_soc_metrics" },
    ];

    await dispatchBatch(
      calls,
      async (c) => {
        inFlight++;
        if (c.fn === "run_agem_cycle") {
          peakDuringMutation = Math.max(peakDuringMutation, inFlight);
        }
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return null;
      },
      { classify: (c) => sideEffectClass(c.fn) },
    );

    expect(peakDuringMutation).toBe(1);
  });

  it("respects maxConcurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const calls = Array.from({ length: 9 }, () => ({ fn: "get_cohomology" }));

    await dispatchBatch(
      calls,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return null;
      },
      { classify: (c) => sideEffectClass(c.fn), maxConcurrency: 2 },
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("runs a single call unchanged", async () => {
    const out = await dispatchBatch(
      [{ fn: "run_agem_cycle" }],
      async (c) => c.fn,
      { classify: (c) => sideEffectClass(c.fn) },
    );
    expect(out).toEqual(["run_agem_cycle"]);
  });
});
