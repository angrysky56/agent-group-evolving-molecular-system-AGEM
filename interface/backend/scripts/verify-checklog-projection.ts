/**
 * verify-checklog-projection.ts
 *
 * Replays a real run's evaluate_logical_consistency result through the
 * model-facing projection and reports what the model would now receive.
 *
 * Synthetic tests pin the invariants; this pins the actual measured case that
 * motivated the change — a 10-block corpus searched exhaustively to arity 10.
 *
 *   npx tsx scripts/verify-checklog-projection.ts <runLogId>
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { settings } from "../src/config.js";
import {
  summarizeCheckLog,
  type CheckLogEntry,
} from "../src/services/logicalCohomology.js";
import { readCheckLog } from "../src/services/check-log-reader.js";

const runLogId = process.argv[2];
if (!runLogId) {
  console.error("usage: tsx scripts/verify-checklog-projection.ts <runLogId>");
  process.exit(1);
}

const runsDir = join(settings.all.KNOWLEDGE_BASE_PATH, "runs");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const tok = (n: number) => `~${Math.round(n / 4).toLocaleString()} tok`;

async function main(): Promise<void> {
  const reader = createInterface({
    input: createReadStream(join(runsDir, `${runLogId}.jsonl`), {
      encoding: "utf8",
    }),
    crlfDelay: Infinity,
  });

  let found = false;
  for await (const line of reader) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      event.type !== "tool_result" ||
      (event.name !== "evaluate_logical_consistency" &&
        event.name !== "extract_and_verify_claims") ||
      typeof event.output !== "string"
    ) {
      continue;
    }
    const parsed = JSON.parse(event.output) as Record<string, unknown>;
    if (!Array.isArray(parsed.checkLog)) continue;
    found = true;

    const checkLog = parsed.checkLog as CheckLogEntry[];
    const { checkLog: _drop, ...rest } = parsed;
    const before = event.output.length;
    const after = JSON.stringify(
      { ...rest, ...summarizeCheckLog(checkLog, { runLogId }) },
      null,
      2,
    ).length;

    console.log(`\n${event.name} — run ${runLogId}`);
    console.log(`  before   ${before.toLocaleString().padStart(10)} chars  ${tok(before)}`);
    console.log(`  after    ${after.toLocaleString().padStart(10)} chars  ${tok(after)}  (${kb(after)})`);
    console.log(`  ratio    ${(before / after).toFixed(0)}x smaller`);

    const digest = summarizeCheckLog(checkLog, { runLogId }).checkLogDigest;
    console.log(`  checks   ${digest.totalChecks} total, ${digest.returnedEntries} returned, ${digest.omittedEntries} on disk only`);
    console.log(`  byKind   ${JSON.stringify(digest.byKind)}`);
    console.log(`  byVerdict ${JSON.stringify(digest.byVerdict)}`);

    // Retention: nothing that could change the verdict may have been dropped.
    const signal = checkLog.filter(
      (c) =>
        c.verdict !== "consistent" ||
        c.kind === "core" ||
        (c.note ?? "").startsWith("VACUOUS"),
    );
    const kept = summarizeCheckLog(checkLog, { runLogId }).checkLog;
    const keptSignal = kept.filter(
      (c) =>
        c.verdict !== "consistent" ||
        c.kind === "core" ||
        (c.note ?? "").startsWith("VACUOUS"),
    );
    console.log(
      `  retained ${keptSignal.length}/${signal.length} verdict-relevant entries ` +
        (keptSignal.length === signal.length ? "✓" : "✗ REGRESSION"),
    );
    if (keptSignal.length !== signal.length) process.exitCode = 1;
  }
  reader.close();

  if (!found) {
    console.log(`No inline check log in ${runLogId} (already using the split).`);
  }

  // The drill-down must reach the same entries the projection left on disk.
  const page = await readCheckLog({ runLogId, kind: "triple", limit: 3 });
  console.log(
    `\nget_check_log(kind=triple) → ${page.matched} matched, ` +
      `${page.returned} returned${page.error ? ` — ${page.error}` : ""}`,
  );
  if (page.entries[0]) {
    console.log(
      `  sample: {${page.entries[0].blocks.join(", ")}} → ${page.entries[0].verdict}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
