/** Live TypeDB 3.x storage/retrieval probe for n-ary joint incompatibility. */
import path from "node:path";
import { isOkResponse } from "@typedb/driver-http";
import { claimToTypeQL, type ExtractedClaim } from "../src/services/claim-extractor.js";
import { TypeDBClaimStore } from "../src/services/typedb-claims.js";

const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const database = process.env.TYPEDB_PROBE_DATABASE ?? "agem-claims";
const address = process.env.TYPEDB_PROBE_ADDRESS ?? "http://127.0.0.1:8100";
const store = new TypeDBClaimStore({
  enabled: true,
  address,
  database,
  username: process.env.TYPEDB_USERNAME ?? "admin",
  password: process.env.TYPEDB_PASSWORD ?? "password",
});

const status = await store.initialize(projectRoot);
if (!status.available) throw new Error(status.note ?? "TypeDB unavailable");

const segmentId = "joint-roundtrip-segment";
const claim: ExtractedClaim = {
  kind: "joint-incompatibility",
  roles: {
    incompatible: ["roundtrip-locality", "roundtrip-realism", "roundtrip-freedom"],
  },
  scope: "corpus",
};
const query = claimToTypeQL(claim, segmentId);
if (!query) throw new Error("claim query builder rejected valid n-ary claim");

for (const statement of [
  `put
  $s isa segment,
    has segment-id "${segmentId}",
    has corpus-id "joint-roundtrip",
    has text "No model can simultaneously satisfy all three assumptions.";`,
  query.concepts,
  query.claim,
]) {
  const response = await store.write(statement);
  if (!response || !isOkResponse(response)) {
    throw new Error(`TypeDB rejected round-trip write: ${JSON.stringify(response)}`);
  }
}

const restored = await store.readJointIncompatibility(query.claimId);
const expected = ["roundtrip-freedom", "roundtrip-locality", "roundtrip-realism"];
if (
  !restored ||
  restored.claimKey !== query.claimKey ||
  JSON.stringify(restored.incompatible) !== JSON.stringify(expected) ||
  !restored.sourceSegmentIds.includes(segmentId)
) {
  throw new Error(`Lossy n-ary round trip: ${JSON.stringify(restored)}`);
}

console.log(
  JSON.stringify({
    status: "passed",
    serverVersion: status.serverVersion,
    database,
    claimId: restored.claimId,
    claimKey: restored.claimKey,
    arity: restored.incompatible.length,
    sourceSegmentIds: restored.sourceSegmentIds,
  }),
);
