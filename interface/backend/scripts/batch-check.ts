import { claimStore } from "../src/services/typedb-claims.js";
import { extractIntoStore } from "../src/services/claim-extractor.js";
import { segmentText } from "#agem/tna/CooccurrenceGraph.js";
import { readFileSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
await claimStore.initialize(ROOT);
const text = readFileSync(
  path.join(ROOT, "docs/ToM-test/seed-test-theories-of-mind.md"), "utf8");
const segs = segmentText(text).slice(30, 42).map((t, i) => ({ id: `bt-${i}`, text: t }));
console.log(`segments: ${segs.length} (batched 6, concurrency 4 => ~2 model calls)`);
const t0 = Date.now();
const r = await extractIntoStore(segs, "batch-test");
console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`proposed=${r.claimsProposed} accepted=${r.claimsAccepted} rejected=${r.claimsRejected} parseFailures=${r.parseFailures.length}`);
for (const o of r.outcomes.filter(x => !x.accepted).slice(0, 3))
  console.log(`  reject: ${o.claim.kind} ${JSON.stringify(o.claim.roles)} -> ${(o.rejection ?? "").slice(0, 80)}`);
for (const o of r.outcomes.filter(x => x.accepted).slice(0, 5))
  console.log(`  ok: ${o.claim.kind} ${JSON.stringify(o.claim.roles)}`);
process.exit(0);
