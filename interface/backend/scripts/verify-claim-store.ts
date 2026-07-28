/**
 * verify-claim-store.ts
 *
 * End-to-end check of the automatic bootstrap: connect, create the database if
 * absent, define the schema, then confirm the contract still rejects the
 * extraction failure it exists to catch.
 *
 * Also asserts the degradation path — pointing at a dead address must disable
 * the store and leave a usable note, not throw.
 *
 * Usage: npx tsx scripts/verify-claim-store.ts
 */
import { TypeDBClaimStore, claimStore } from "../src/services/typedb-claims.js";
import { isOkResponse } from "@typedb/driver-http";
import path from "node:path";
import { TypeDBFindingGraph } from "../src/services/typedb-findings.js";
import type { StoredFinding } from "../src/services/finding-store.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const ok = (b: boolean) => (b ? "PASS" : "FAIL");
let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`  [${ok(passed)}] ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("1. Automatic bootstrap (idempotent)");
const first = await claimStore.initialize(PROJECT_ROOT);
check("store reports available", first.available, first.note ?? "");
check("domain labelled", first.database.length > 0, first.database);
if (!first.available) {
  console.log(
    "\n  TypeDB is not reachable. Start it with:\n" +
      "    typedb server --server.http.listen-address 0.0.0.0:8100\n",
  );
  process.exit(1);
}

// Idempotence: a second boot must converge, not error on an existing schema.
const second = await claimStore.initialize(PROJECT_ROOT);
check("second boot still available (idempotent)", second.available);

console.log("\n2. The contract still holds through the driver");
// `put` not `insert`: segment-id and label are @key, so a second run of this
// script would collide. That collision is the schema doing its job — the test
// has to be idempotent, not the constraint loosened.
const seed = await claimStore.write(`
put
  $s isa segment, has segment-id "verify-1", has corpus-id "verify",
     has text "Consciousness is intrinsic integration whether or not anything is broadcast.";
  $a isa concept, has label "verify-phi";
  $b isa concept, has label "verify-broadcast";`);
check("seed upsert accepted (idempotent)", !!seed && isOkResponse(seed));

const good = await claimStore.write(`
match
  $a isa concept, has label "verify-phi";
  $b isa concept, has label "verify-broadcast";
  $s isa segment, has segment-id "verify-1";
insert
  $_ isa exclusion, links (excluder: $a, excluded: $b, source: $s),
    has claim-id "verify-claim-occurrence-1",
    has claim-key "verify-claim-structural-1";`);
check("well-formed exclusion ACCEPTED", !!good && isOkResponse(good));

const bad = await claimStore.write(`
match
  $a isa concept, has label "verify-phi";
  $s isa segment, has segment-id "verify-1";
insert
  $_ isa exclusion, links (excluder: $a, source: $s);`);
check(
  "exclusion missing a role REJECTED (the Test C failure)",
  !!bad && !isOkResponse(bad),
);

console.log("\n3. Finding, evidence, and supersedes graph writes");
const findingGraph = new TypeDBFindingGraph();
const finding = (
  id: string,
  outcome: StoredFinding["outcome"],
): StoredFinding => ({
  id,
  verdict:
    outcome === "contradiction"
      ? "CONTRADICTION FOUND"
      : "No contradiction found.",
  coverage: "Coverage: all 2 submitted blocks were evaluated.",
  runLogId: `verify-run-${id}`,
  producedByModel: "verify-model",
  method: "derived-from-claims",
  outcome,
  corpusId: "verify",
  memoryNamespace: "verify-scratch",
  attributionValidated: true,
  semanticsValidated: true,
  semanticVerdictKind:
    outcome === "contradiction"
      ? "corpus-contradiction"
      : "no-contradiction",
  supportingClaims: ["verify-claim-structural-1"],
  supportingClaimRefs: ["verify-claim-occurrence-1"],
  createdAt: "2026-07-27T06:00:00.000Z",
  embedding: [1, 0],
  recallCount: 0,
  citationCount: 0,
  status: "active",
  fingerprint: `verify-${id}`,
});
let findingWritesPassed = true;
try {
  await findingGraph.recordFinding(
    finding("verify-finding-old", "no-contradiction"),
  );
  await findingGraph.recordFinding(
    finding("verify-finding-new", "contradiction"),
  );
  await findingGraph.recordSupersedes(
    "verify-finding-new",
    "verify-finding-old",
    "Live verification of explicit supersession.",
  );
} catch (error) {
  findingWritesPassed = false;
  console.error(error);
}
check(
  "finding entities + n-ary evidence + supersedes ACCEPTED",
  findingWritesPassed,
);

console.log("\n4. Degradation when TypeDB is absent");
// A port nothing is listening on. Injected rather than set via process.env,
// because `settings` parses the environment once at module load — mutating it
// here silently does nothing, which made an earlier version of this test pass
// against the LIVE server while claiming to test the dead one.
const orphan = new TypeDBClaimStore({ address: "http://127.0.0.1:59999" });
const dead = await orphan.initialize(PROJECT_ROOT).catch(() => null);
check("initialize() did not throw", dead !== null);
check("reports unavailable", dead?.available === false);
check("note explains the fix", !!dead?.note && dead.note.length > 10, dead?.note);
check("writes return null rather than throwing", (await orphan.write("insert $x isa concept;")) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
