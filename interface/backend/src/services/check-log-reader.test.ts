/**
 * check-log-reader.test.ts
 *
 * The drill-down is what makes omitting entries honest rather than lossy, so
 * these tests cover retrieval, the legacy-run fallback, and the path guard.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCheckLog as readCheckLogFrom,
  type CheckLogQuery,
} from "./check-log-reader.js";

let base: string;
let runsDir: string;

/** Bind every call to the fixture directory. */
const readCheckLog = (query: CheckLogQuery) =>
  readCheckLogFrom(query, runsDir);

const entry = (
  kind: string,
  blocks: string[],
  verdict: string,
): Record<string, unknown> => ({
  kind,
  blocks,
  formulas: blocks.map((b) => `p_${b}(a)`),
  verdict,
});

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "agem-checklog-"));
  runsDir = join(base, "runs");
  mkdirSync(runsDir, { recursive: true });

  // Current shape: a dedicated event holding the complete log.
  writeFileSync(
    join(runsDir, "run-current.jsonl"),
    [
      JSON.stringify({ type: "run_start", runId: "run-current" }),
      JSON.stringify({
        type: "logic_check_log",
        runLogId: "run-current",
        checkLog: [
          entry("internal", ["alpha"], "consistent"),
          entry("pair", ["alpha", "beta"], "consistent"),
          entry("pair", ["alpha", "gamma"], "contradictory"),
          entry("triple", ["alpha", "beta", "gamma"], "consistent"),
        ],
      }),
      "not json at all",
      "",
    ].join("\n"),
  );

  // Runs logged before the split kept the log inline in the tool result.
  writeFileSync(
    join(runsDir, "run-legacy.jsonl"),
    JSON.stringify({
      type: "tool_result",
      name: "evaluate_logical_consistency",
      output: JSON.stringify({
        verdict: "No contradiction",
        checkLog: [entry("set", ["x", "y"], "consistent")],
      }),
    }) + "\n",
  );
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("readCheckLog", () => {
  it("returns every entry and survives a malformed line", async () => {
    const page = await readCheckLog({ runLogId: "run-current" });
    expect(page.totalChecks).toBe(4);
    expect(page.matched).toBe(4);
    expect(page.entries).toHaveLength(4);
    expect(page.error).toBeUndefined();
  });

  it("filters by verdict", async () => {
    const page = await readCheckLog({
      runLogId: "run-current",
      verdict: "contradictory",
    });
    expect(page.matched).toBe(1);
    expect(page.entries[0].blocks).toEqual(["alpha", "gamma"]);
    // The denominator stays honest even when the filter narrows the result.
    expect(page.totalChecks).toBe(4);
  });

  it("filters by kind", async () => {
    const page = await readCheckLog({ runLogId: "run-current", kind: "pair" });
    expect(page.matched).toBe(2);
  });

  it("requires ALL named blocks, case-insensitively", async () => {
    const both = await readCheckLog({
      runLogId: "run-current",
      blocks: ["ALPHA", "gamma"],
    });
    expect(both.matched).toBe(2); // the pair and the triple

    const missing = await readCheckLog({
      runLogId: "run-current",
      blocks: ["alpha", "delta"],
    });
    expect(missing.matched).toBe(0);
  });

  it("pages, and says how many are left", async () => {
    const first = await readCheckLog({ runLogId: "run-current", limit: 2 });
    expect(first.returned).toBe(2);
    expect(first.note).toContain("offset 2");

    const second = await readCheckLog({
      runLogId: "run-current",
      limit: 2,
      offset: 2,
    });
    expect(second.returned).toBe(2);
    expect(second.note).toBeUndefined();
  });

  it("reads runs logged before the split", async () => {
    const page = await readCheckLog({ runLogId: "run-legacy" });
    expect(page.totalChecks).toBe(1);
    expect(page.entries[0].blocks).toEqual(["x", "y"]);
  });

  it("refuses a traversal attempt instead of sanitising it", async () => {
    const page = await readCheckLog({ runLogId: "../../../etc/passwd" });
    expect(page.error).toContain("Invalid runLogId");
    expect(page.entries).toEqual([]);
  });

  it("reports a missing run log rather than an empty one", async () => {
    const page = await readCheckLog({ runLogId: "no-such-run" });
    expect(page.error).toContain("No run log found");
    // Absence must never read as "checked, found nothing".
    expect(page.totalChecks).toBe(0);
  });
});
