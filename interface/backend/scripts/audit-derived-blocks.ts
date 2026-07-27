/**
 * audit-derived-blocks.ts — run the formalization checks over the blocks a real
 * run actually derived.
 *
 * The typed path builds one block per claim via claimToPropositions, and each
 * block carries its own existential witness. This reports how many of those
 * blocks can contradict anything at all.
 *
 *   npx tsx scripts/audit-derived-blocks.ts <runLogId>
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { settings } from "../src/config.js";
import {
  analyzeFormalization,
  type LogicalBlock,
} from "../src/services/logicalCohomology.js";

const runLogId = process.argv[2];
if (!runLogId) {
  console.error("usage: tsx scripts/audit-derived-blocks.ts <runLogId>");
  process.exit(1);
}

function subjectsOf(block: LogicalBlock): Set<string> {
  const out = new Set<string>();
  for (const formula of block.propositions) {
    const arrow = formula.indexOf("->");
    const head = arrow >= 0 ? formula.slice(0, arrow) : formula;
    const bare = head.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
    for (const [, s] of bare.matchAll(/\b([a-z_][A-Za-z0-9_]*)\s*\(/g)) out.add(s);
  }
  return out;
}

async function main(): Promise<void> {
  const path = join(settings.all.KNOWLEDGE_BASE_PATH, "runs", `${runLogId}.jsonl`);
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let blocks: LogicalBlock[] = [];
  for await (const line of reader) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      event.type === "tool_result" &&
      event.name === "extract_and_verify_claims" &&
      typeof event.output === "string"
    ) {
      const parsed = JSON.parse(event.output) as Record<string, unknown>;
      if (Array.isArray(parsed.derivedBlocks)) {
        blocks = parsed.derivedBlocks as LogicalBlock[];
      }
    }
  }
  reader.close();

  if (blocks.length === 0) {
    console.log("No derivedBlocks in that run.");
    return;
  }

  console.log(`derived blocks: ${blocks.length}\n`);
  console.log("first three, verbatim:");
  for (const b of blocks.slice(0, 3)) {
    console.log(`  ${b.name}`);
    for (const p of b.propositions) console.log(`      ${p}`);
  }

  // How many blocks share a subject predicate with any other block?
  const subjects = blocks.map((b) => ({ name: b.name, s: subjectsOf(b) }));
  const connected = subjects.filter((b) =>
    subjects.some(
      (o) => o.name !== b.name && [...b.s].some((x) => o.s.has(x)),
    ),
  );
  const withWitness = blocks.filter((b) =>
    b.propositions.some((p) => /\bexists\b/.test(p)),
  );

  console.log(`\nblocks introducing their own witness: ${withWitness.length}/${blocks.length}`);
  console.log(`blocks sharing a subject with any other: ${connected.length}/${blocks.length}`);
  console.log(
    `blocks that CANNOT contradict anything: ${blocks.length - connected.length}/${blocks.length}`,
  );

  const warnings = analyzeFormalization(blocks);
  console.log(`\nformalization warnings: ${warnings.length}`);
  for (const w of warnings) {
    console.log(`  [${w.severity}] ${w.code}: ${w.message.slice(0, 110)}...`);
    for (const d of (w.detail ?? []).slice(0, 3)) console.log(`      ${d}`);
    if ((w.detail?.length ?? 0) > 3) {
      console.log(`      ... and ${w.detail!.length - 3} more`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
