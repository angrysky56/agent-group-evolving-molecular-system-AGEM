/**
 * workflow-contract.test.ts
 *
 * The contract exists to replace a turn-count proxy with a checkable one, and
 * to stay bounded while doing it. Both properties are tested here, including
 * the two cases the old heuristic got backwards.
 */

import { describe, it, expect } from "vitest";
import { createWorkflowContract } from "./workflow-contract.js";

const uncontested = () => false;
const contested = () => true;

/** A run where the user actually pasted a corpus. */
const withCorpus = (opts: Record<string, unknown> = {}) =>
  createWorkflowContract({
    isContested: uncontested,
    materialChars: 5000,
    ...opts,
  } as any);

describe("WorkflowContract — completion", () => {
  it("is unsatisfied on an empty run that was given material", () => {
    const c = withCorpus();
    const e = c.evaluate();
    expect(e.satisfied).toBe(false);
    expect(e.unmet.map((i) => i.id)).toEqual(["ingest", "inspect"]);
  });

  it("is satisfied once the corpus is ingested and inspected", () => {
    const c = withCorpus();
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    expect(c.evaluate().satisfied).toBe(true);
    expect(c.nudge()).toBeNull();
  });

  it("lets a fast run finish — the old turn-count heuristic did not", () => {
    // Three turns of real work used to trigger a spurious nudge because
    // turnCount < 4. The contract only cares whether the work happened.
    const c = withCorpus();
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    expect(c.nudge()).toBeNull();
  });

  it("stops a long empty run — the old heuristic let it through", () => {
    // Six turns of chatter over a supplied corpus, with no ingest, used to
    // pass unchallenged once turnCount reached 4.
    const c = withCorpus();
    c.record("get_agem_state");
    c.record("list_mcp_servers");
    const nudge = c.nudge();
    expect(nudge).not.toBeNull();
    expect(nudge).toMatch(/run_agem_cycle/);
  });
});

describe("WorkflowContract — dormant on non-analysis runs", () => {
  it("does not nudge a bare maintenance command (regression)", () => {
    // Replay of run 2026-07-24T23-08-48_rd0eal: a 73-char "reset the engine"
    // took THREE turns because the contract demanded an ingest of a run that
    // had no corpus. The model's turn-2 reply ("give me the material") was
    // correct and should have ended the run.
    const c = createWorkflowContract({
      isContested: uncontested,
      materialChars: 73,
    });
    c.record("reset_agem_engine");

    expect(c.evaluate().satisfied).toBe(true);
    expect(c.nudge()).toBeNull();
  });

  it("stays dormant for other maintenance and status calls", () => {
    const c = createWorkflowContract({
      isContested: uncontested,
      materialChars: 40,
    });
    for (const t of ["get_agem_state", "list_mcp_servers", "read_skill"]) {
      c.record(t);
    }
    expect(c.nudge()).toBeNull();
  });

  it("activates once the model touches the analysis surface", () => {
    // Reading cohomology without ever ingesting is the failure worth catching:
    // metrics get reported for a graph the run never built.
    const c = createWorkflowContract({
      isContested: uncontested,
      materialChars: 20,
    });
    c.record("get_cohomology");

    expect(c.evaluate().satisfied).toBe(false);
    expect(c.nudge()).toMatch(/run_agem_cycle/);
  });

  it("activates when the user pastes a corpus, before any tool runs", () => {
    const c = createWorkflowContract({
      isContested: uncontested,
      materialChars: 5003, // the real corpus run in the logs
    });
    expect(c.evaluate().satisfied).toBe(false);
    expect(c.nudge()).not.toBeNull();
  });

  it("honours a custom material threshold", () => {
    const c = createWorkflowContract({
      isContested: uncontested,
      materialChars: 100,
      materialThreshold: 50,
    });
    expect(c.evaluate().satisfied).toBe(false);
  });
});

describe("WorkflowContract — contested corpora", () => {
  it("requires logical verification only after a cycle has run", () => {
    const c = createWorkflowContract({ isContested: contested });
    // No cycle yet ⇒ the engine has no communities to call contested.
    expect(c.evaluate().items.find((i) => i.id === "verify")?.applicable).toBe(
      false,
    );

    c.record("run_agem_cycle");
    expect(c.evaluate().items.find((i) => i.id === "verify")?.applicable).toBe(
      true,
    );
  });

  it("accepts verification via either MCP calling convention", () => {
    for (const label of ["mcp-logic/prove", "mcp-logic/find_counterexample"]) {
      const c = createWorkflowContract({ isContested: contested });
      c.record("run_agem_cycle");
      c.record("get_graph_topology");
      c.record("call_mcp_tool", label);
      expect(c.evaluate().satisfied).toBe(true);
    }
  });

  it("accepts the native evaluate_logical_consistency tool", () => {
    const c = createWorkflowContract({ isContested: contested });
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    expect(c.evaluate().satisfied).toBe(false);
    c.record("evaluate_logical_consistency");
    expect(c.evaluate().satisfied).toBe(true);
  });

  it("does not manufacture a requirement when the probe throws", () => {
    const c = createWorkflowContract({
      isContested: () => {
        throw new Error("engine unavailable");
      },
    });
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    expect(c.evaluate().satisfied).toBe(true);
  });
});

describe("WorkflowContract — boundedness", () => {
  it("never raises the same unmet set twice", () => {
    // Repeating an ignored instruction is a loop, not recovery.
    const c = withCorpus();
    expect(c.nudge()).not.toBeNull();
    expect(c.nudge()).toBeNull();
  });

  it("caps total nudges even as the unmet set changes", () => {
    const c = withCorpus({ maxNudges: 1 });
    expect(c.nudge()).not.toBeNull();
    c.record("run_agem_cycle"); // unmet set changes → new signature
    expect(c.nudge()).toBeNull();
    expect(c.nudgeCount).toBe(1);
  });

  it("can be disabled entirely", () => {
    const c = createWorkflowContract({
      isContested: contested,
      enabled: false,
    });
    expect(c.nudge()).toBeNull();
  });

  it("names the specific missing item rather than reciting the workflow", () => {
    const c = createWorkflowContract({ isContested: uncontested });
    c.record("run_agem_cycle");
    const nudge = c.nudge() ?? "";
    expect(nudge).toMatch(/get_graph_topology/);
    expect(nudge).not.toMatch(/run_agem_cycle/);
  });
});

describe("WorkflowContract — accounting", () => {
  it("counts a resolved MCP label as well as the raw tool name", () => {
    const c = createWorkflowContract({ isContested: uncontested });
    c.record("call_mcp_tool", "mcp-logic/prove");
    expect(c.count("call_mcp_tool")).toBe(1);
    expect(c.count("mcp-logic/prove")).toBe(1);
  });

  it("summarises applicability and satisfaction for the run log", () => {
    const c = createWorkflowContract({ isContested: uncontested });
    c.record("run_agem_cycle");
    const s = c.summary() as any;
    expect(s.satisfied).toBe(false);
    expect(s.toolCounts.run_agem_cycle).toBe(1);
    // ingest, inspect, verify, derive — every item is reported with its own
    // applicability, so the run log shows which were even in scope.
    expect(s.items.map((i: any) => i.id)).toEqual([
      "ingest",
      "inspect",
      "verify",
      "derive",
    ]);
  });
});
