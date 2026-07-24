/**
 * recovery-protocol.test.ts
 *
 * Guards the properties that make the ladder trustworthy:
 *   - error classification routes to the right level
 *   - the retry budget is actually bounded (no failure loops)
 *   - the escalation invariant cannot be skipped
 *   - non-idempotent calls are never blind-retried
 *   - full failure detail stays OUT of the execution-context payload
 */

import { describe, it, expect, vi } from "vitest";
import {
  RecoveryProtocol,
  EscalationViolationError,
  classifyError,
  callKey,
  diagnose,
  terseError,
} from "./recovery-protocol.js";

const noSleep = async (): Promise<void> => {};

/** A run() that fails `failures` times with `err`, then succeeds. */
function flaky(failures: number, err: Error) {
  let calls = 0;
  const run = vi.fn(async () => {
    calls++;
    if (calls <= failures) throw err;
    return { output: `ok after ${calls}`, label: "t" };
  });
  return { run, calls: () => calls };
}

describe("classifyError", () => {
  it("classifies network and 5xx faults as transient", () => {
    expect(classifyError(new Error("ETIMEDOUT"))).toBe("transient");
    expect(classifyError(new Error("socket hang up"))).toBe("transient");
    expect(classifyError(new Error("HTTP 503 Service Unavailable"))).toBe(
      "transient",
    );
    expect(classifyError(new Error("429 Too Many Requests"))).toBe("transient");
    expect(classifyError(new Error("fetch failed"))).toBe("transient");
  });

  it("classifies bad argument shapes as schema", () => {
    expect(classifyError(new Error("invalid_type: expected string"))).toBe(
      "schema",
    );
    expect(classifyError(new Error("missing required parameter 'conclusion'"))).toBe(
      "schema",
    );
    expect(classifyError(new Error("JSON-RPC error -32602"))).toBe("schema");
  });

  it("classifies auth failures as structural, NOT transient", () => {
    // A 401 will never succeed on retry; burning the budget on it only adds
    // latency before the inevitable escalation.
    expect(classifyError(new Error("401 Unauthorized"))).toBe("structural");
    expect(classifyError(new Error("Invalid API key"))).toBe("structural");
    expect(classifyError(new Error("403 Forbidden"))).toBe("structural");
  });

  it("defaults unknown failures to structural", () => {
    expect(classifyError(new Error("Unknown tool frobnicate"))).toBe(
      "structural",
    );
    expect(classifyError(null)).toBe("structural");
  });

  it("prefers transient over schema when a 5xx body mentions 'invalid'", () => {
    expect(
      classifyError(new Error("503 Service Unavailable: invalid upstream")),
    ).toBe("transient");
  });
});

describe("callKey", () => {
  it("is stable under key reordering", () => {
    expect(callKey("t", { a: 1, b: 2 })).toBe(callKey("t", { b: 2, a: 1 }));
  });

  it("distinguishes different arguments", () => {
    expect(callKey("t", { a: 1 })).not.toBe(callKey("t", { a: 2 }));
  });
});

describe("RecoveryProtocol — level 1 (bounded retry)", () => {
  it("retries transient faults and succeeds within budget", async () => {
    const p = new RecoveryProtocol({ retryBudget: 2, baseDelayMs: 0 });
    const { run } = flaky(2, new Error("ETIMEDOUT"));

    const out = await p.execute("t", {}, { run, sleep: noSleep });

    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops at the budget — this is the failure-loop guard", async () => {
    const p = new RecoveryProtocol({ retryBudget: 2, baseDelayMs: 0 });
    const { run } = flaky(99, new Error("ETIMEDOUT"));

    const out = await p.execute("t", {}, { run, sleep: noSleep });

    expect(out.ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, never more
    expect(out.level).toBe(3);
  });

  it("does not retry structural faults at all", async () => {
    const p = new RecoveryProtocol({ retryBudget: 3, baseDelayMs: 0 });
    const { run } = flaky(99, new Error("Unknown tool frobnicate"));

    const out = await p.execute("t", {}, { run, sleep: noSleep });

    expect(run).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.diagnosis?.errorClass).toBe("structural");
  });

  it("honours a per-call retryBudget of 0 for non-idempotent calls", async () => {
    const p = new RecoveryProtocol({ retryBudget: 5, baseDelayMs: 0 });
    const { run } = flaky(99, new Error("ETIMEDOUT"));

    const out = await p.execute(
      "run_agem_cycle",
      { prompt: "x" },
      { run, sleep: noSleep, retryBudget: 0 },
    );

    // A retry here would ingest the same text into the graph twice.
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/Not retried automatically/);
  });
});

describe("RecoveryProtocol — level 2 (deterministic patch)", () => {
  it("patches a schema failure and succeeds on the re-run", async () => {
    const p = new RecoveryProtocol({ retryBudget: 2, baseDelayMs: 0 });
    const run = vi.fn(async (args: Record<string, unknown>) => {
      if (args.conclusion === undefined) {
        throw new Error("missing required parameter 'conclusion'");
      }
      return { output: "proved", label: "mcp-logic/prove" };
    });

    const out = await p.execute(
      "prove",
      { goal: "mortal(socrates)" },
      {
        run,
        sleep: noSleep,
        patch: (a) =>
          a.goal !== undefined ? { conclusion: a.goal } : null,
      },
    );

    expect(out.ok).toBe(true);
    expect(out.level).toBe(2);
    expect(out.output).toBe("proved");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("skips level 2 when the patch is a no-op", async () => {
    const p = new RecoveryProtocol({ retryBudget: 0, baseDelayMs: 0 });
    const run = vi.fn(async () => {
      throw new Error("invalid_type");
    });
    const skips: unknown[] = [];

    const out = await p.execute(
      "t",
      { a: 1 },
      {
        run,
        sleep: noSleep,
        patch: (a) => a, // returns identical args
        onDiagnostic: (e) => {
          if (e.event === "level_skipped") skips.push(e);
        },
      },
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    expect(skips.some((s: any) => s.level === 2)).toBe(true);
  });

  it("survives a patch function that throws", async () => {
    const p = new RecoveryProtocol({ retryBudget: 0, baseDelayMs: 0 });
    const run = vi.fn(async () => {
      throw new Error("invalid_type");
    });

    const out = await p.execute(
      "t",
      {},
      {
        run,
        sleep: noSleep,
        patch: () => {
          throw new Error("patch blew up");
        },
      },
    );

    expect(out.ok).toBe(false);
    expect(out.level).toBe(3);
  });
});

describe("RecoveryProtocol — escalation invariant", () => {
  it("advances pristine → retried → patched before escalating", async () => {
    const p = new RecoveryProtocol({ retryBudget: 1, baseDelayMs: 0 });
    const args = { a: 1 };
    expect(p.getState("t", args)).toBe("pristine");

    const out = await p.execute(
      "t",
      args,
      { run: async () => { throw new Error("ETIMEDOUT"); }, sleep: noSleep },
    );

    expect(out.ok).toBe(false);
    expect(out.level).toBe(3);
    // Level 3 was only reachable because 1 and 2 were marked exhausted.
    expect(p.getState("t", args)).toBe("patched");
  });

  it("records why a level was skipped, so the audit trail is complete", async () => {
    const p = new RecoveryProtocol({ retryBudget: 2, baseDelayMs: 0 });
    const events: any[] = [];

    await p.execute(
      "t",
      {},
      {
        run: async () => { throw new Error("401 Unauthorized"); },
        sleep: noSleep,
        onDiagnostic: (e) => events.push(e),
      },
    );

    const skipped = events.filter((e) => e.event === "level_skipped");
    expect(skipped.length).toBeGreaterThanOrEqual(2);
    expect(skipped[0].reason).toMatch(/not retryable/);
    expect(events.some((e) => e.event === "recovery_escalated")).toBe(true);
  });

  it("exports a violation error type for API-boundary enforcement", () => {
    expect(new EscalationViolationError("x")).toBeInstanceOf(Error);
  });

  it("never throws out of execute(), whatever run() does", async () => {
    const p = new RecoveryProtocol({ retryBudget: 1, baseDelayMs: 0 });
    for (const thrown of [new Error("boom"), "string error", null, 42, {}]) {
      const out = await p.execute(
        "t",
        {},
        { run: async () => { throw thrown; }, sleep: noSleep },
      );
      expect(out.ok).toBe(false);
      expect(typeof out.output).toBe("string");
    }
  });
});

describe("RecoveryProtocol — context partition", () => {
  const stack = new Error("boom").stack ?? "";
  const bigError = Object.assign(
    new Error(
      "500 Server Error: " + "x".repeat(5000) + "\nresponse body: secret-ish detail",
    ),
    { stack },
  );

  it("keeps the execution-context notice terse and single-line", async () => {
    const p = new RecoveryProtocol({
      retryBudget: 0,
      baseDelayMs: 0,
      maxNoticeChars: 400,
      runId: "run-123",
    });

    const out = await p.execute(
      "t",
      {},
      { run: async () => { throw bigError; }, sleep: noSleep },
    );

    expect(out.output.length).toBeLessThanOrEqual(400);
    expect(out.output).not.toContain("\n");
    expect(out.output).toContain("run-123");
    // The 5000-char body must not reach chat history.
    expect(out.output).not.toContain("x".repeat(200));
  });

  it("still preserves the FULL detail on the diagnostic side", async () => {
    const p = new RecoveryProtocol({ retryBudget: 0, baseDelayMs: 0 });
    const diagnostics: any[] = [];

    const out = await p.execute(
      "t",
      {},
      {
        run: async () => { throw bigError; },
        sleep: noSleep,
        onDiagnostic: (e) => diagnostics.push(e),
      },
    );

    expect(out.detail).toContain("x".repeat(1000));
    expect(diagnostics.some((d) => String(d.detail ?? "").length > 4000)).toBe(
      true,
    );
  });

  it("does not let a throwing diagnostic sink break execution", async () => {
    const p = new RecoveryProtocol({ retryBudget: 0, baseDelayMs: 0 });
    const out = await p.execute(
      "t",
      {},
      {
        run: async () => ({ output: "fine", label: "t" }),
        onDiagnostic: () => { throw new Error("sink exploded"); },
      },
    );
    expect(out.ok).toBe(true);
  });
});

describe("diagnosis helpers", () => {
  it("produces (phi, cause, action, confidence)", () => {
    const d = diagnose(new Error("ETIMEDOUT"), "transient");
    expect(d.action).toBe("local_retry");
    expect(d.confidence).toBeGreaterThan(0);
    expect(d.phi).toBe("ETIMEDOUT");
  });

  it("flattens newlines out of terse summaries", () => {
    expect(terseError(new Error("a\nb\n c"))).toBe("a b c");
  });
});
