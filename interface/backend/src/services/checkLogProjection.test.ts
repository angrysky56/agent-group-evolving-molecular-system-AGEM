/**
 * checkLogProjection.test.ts
 *
 * Pins the split between what the prover recorded and what the model reads.
 *
 * The failure this replaces was not a wrong answer — it was a correct answer
 * that cost 450k tokens. One 10-block run searched exhaustively to arity 10
 * returned 1,799,602 chars, 99.7% of it a check log in which 51 unique
 * formulas appeared as 1.24 MB. It landed untruncated in history and was
 * re-sent every turn after.
 *
 * So the tests below are about retention, not just size: a projection that
 * shrinks the payload by dropping a contradiction would be worse than the bug.
 */

import { describe, it, expect } from "vitest";
import {
  summarizeCheckLog,
  type CheckLogEntry,
} from "./logicalCohomology.js";

const consistentSet = (n: number): CheckLogEntry => ({
  kind: "set",
  blocks: [`b${n}`, `b${n + 1}`, `b${n + 2}`],
  formulas: ["p(a)", "p(a) -> q(a)", "exists x (p(x))"],
  verdict: "consistent",
});

describe("summarizeCheckLog", () => {
  it("counts every check exactly, including the ones it omits", () => {
    const log: CheckLogEntry[] = [
      ...Array.from({ length: 40 }, (_, i) => consistentSet(i)),
      { kind: "internal", blocks: ["b0"], formulas: ["p(a)"], verdict: "consistent" },
      { kind: "pair", blocks: ["b0", "b1"], formulas: ["p(a)", "-p(a)"], verdict: "contradictory" },
    ];

    const { checkLogDigest, checkLog } = summarizeCheckLog(log);

    // The digest is the load-bearing part: it must describe the WHOLE log.
    expect(checkLogDigest.totalChecks).toBe(42);
    expect(checkLogDigest.byKind).toEqual({ set: 40, internal: 1, pair: 1 });
    expect(checkLogDigest.byVerdict).toEqual({
      consistent: 41,
      contradictory: 1,
    });
    expect(checkLogDigest.omittedEntries).toBe(40);
    expect(checkLog).toHaveLength(2);
  });

  it("never omits an entry that could change the verdict", () => {
    const log: CheckLogEntry[] = [
      consistentSet(0),
      { kind: "set", blocks: ["b1"], formulas: ["p(a)"], verdict: "contradictory" },
      { kind: "set", blocks: ["b2"], formulas: ["q(a)"], verdict: "undetermined" },
      { kind: "core", blocks: ["b3"], formulas: ["r(a)"], verdict: "contradictory" },
      { kind: "internal", blocks: ["b4"], formulas: ["s(a)"], verdict: "consistent" },
      {
        kind: "set",
        blocks: ["b5"],
        formulas: ["all x (p(x) -> q(x))"],
        verdict: "consistent",
        note: "VACUOUS — satisfied only by the empty world",
      },
    ];

    const { checkLog } = summarizeCheckLog(log);

    // Everything except the one routine consistent subset check survives.
    expect(checkLog).toHaveLength(5);
    expect(checkLog.some((e) => e.verdict === "contradictory")).toBe(true);
    expect(checkLog.some((e) => e.verdict === "undetermined")).toBe(true);
    expect(checkLog.some((e) => e.kind === "core")).toBe(true);
    expect(checkLog.some((e) => e.kind === "internal")).toBe(true);
    expect(
      checkLog.some((e) => (e.note ?? "").startsWith("VACUOUS")),
    ).toBe(true);
  });

  it("keeps contradictions in preference to routine checks when capped", () => {
    const log: CheckLogEntry[] = [
      ...Array.from({ length: 30 }, (_, i) => ({
        kind: "internal" as const,
        blocks: [`b${i}`],
        formulas: ["p(a)"],
        verdict: "consistent" as const,
      })),
      { kind: "pair", blocks: ["x", "y"], formulas: ["p(a)", "-p(a)"], verdict: "contradictory" },
    ];

    const { checkLog, checkLogDigest } = summarizeCheckLog(log, {
      maxEntries: 3,
    });

    expect(checkLog).toHaveLength(3);
    expect(checkLogDigest.entriesCapped).toBe(true);
    // The cap must not be able to hide the only contradiction in the run.
    expect(checkLog[0].verdict).toBe("contradictory");
    expect(checkLogDigest.byVerdict.contradictory).toBe(1);
  });

  it("deduplicates formulas into a table without losing any", () => {
    const shared = ["p(a)", "p(a) -> q(a)"];
    const log: CheckLogEntry[] = [
      { kind: "internal", blocks: ["b0"], formulas: shared, verdict: "consistent" },
      { kind: "internal", blocks: ["b1"], formulas: shared, verdict: "consistent" },
      { kind: "internal", blocks: ["b2"], formulas: [...shared, "-q(a)"], verdict: "consistent" },
    ];

    const { formulaTable, checkLog } = summarizeCheckLog(log);

    expect(formulaTable).toEqual(["p(a)", "p(a) -> q(a)", "-q(a)"]);
    expect(checkLog.map((e) => e.formulaIds)).toEqual([
      [0, 1],
      [0, 1],
      [0, 1, 2],
    ]);
    // Round-trip: ids must resolve back to exactly what the prover saw.
    for (const [i, entry] of checkLog.entries()) {
      expect(entry.formulaIds.map((id) => formulaTable[id])).toEqual(
        log[i].formulas,
      );
    }
  });

  it("collapses the measured worst case by two orders of magnitude", () => {
    // Reconstructs the shape of the real run: every subset of 10 blocks,
    // each entry re-echoing the formulas of every block it covers.
    const names = Array.from({ length: 10 }, (_, i) => `block-${i}`);
    const propsOf = (n: string) => [`p_${n}(a)`, `all x (p_${n}(x) -> q(x))`];
    const log: CheckLogEntry[] = [];
    for (let mask = 1; mask < 1 << names.length; mask++) {
      const blocks = names.filter((_, i) => mask & (1 << i));
      log.push({
        kind: blocks.length === 1 ? "internal" : "set",
        blocks,
        formulas: blocks.flatMap(propsOf),
        verdict: "consistent",
      });
    }

    const before = JSON.stringify({ checkLog: log }, null, 2).length;
    const after = JSON.stringify(summarizeCheckLog(log), null, 2).length;

    // The real run's formulas were longer than these, so it hit 1.79 MB where
    // this reconstruction lands around 0.5 MB. The ratio is the invariant.
    expect(log).toHaveLength(1023);
    expect(before).toBeGreaterThan(500_000);
    expect(after).toBeLessThan(20_000);
    expect(before / after).toBeGreaterThan(100);
  });

  it("points at the run log when it omits anything", () => {
    const log: CheckLogEntry[] = Array.from({ length: 5 }, (_, i) =>
      consistentSet(i),
    );
    const { checkLogDigest } = summarizeCheckLog(log, { runLogId: "run-abc" });
    expect(checkLogDigest.note).toContain("get_check_log");
    expect(checkLogDigest.note).toContain("run-abc");
  });

  it("says nothing was omitted when nothing was", () => {
    const log: CheckLogEntry[] = [
      { kind: "internal", blocks: ["b0"], formulas: ["p(a)"], verdict: "consistent" },
    ];
    const { checkLogDigest } = summarizeCheckLog(log);
    expect(checkLogDigest.omittedEntries).toBe(0);
    expect(checkLogDigest.returnedEntries).toBe(1);
    expect(checkLogDigest.note).toContain("Every check is listed.");
    expect(checkLogDigest.note).not.toContain("not listed here");
  });

  it("handles an empty log without inventing counts", () => {
    const { checkLogDigest, checkLog, formulaTable } = summarizeCheckLog([]);
    expect(checkLogDigest.totalChecks).toBe(0);
    expect(checkLogDigest.byKind).toEqual({});
    expect(checkLog).toEqual([]);
    expect(formulaTable).toEqual([]);
  });
});
