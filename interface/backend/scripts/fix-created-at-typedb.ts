/**
 * fix-created-at-typedb.ts — migrate `created-at` to datetime-tz.
 *
 * The live database still holds `attribute created-at, value datetime;` from an
 * older schema/findings.tql. The current file declares `datetime-tz`, so the
 * startup define aborts with DEX14 and takes the WHOLE claim store offline:
 * extract_and_verify_claims returns "Claim store unavailable" and every run
 * silently degrades to hand-authored FOL. That is why every finding stored so
 * far has method "hand-authored" — the typed path has never once run.
 *
 * datetime-tz is correct: stored values are `new Date().toISOString()`, which
 * carries a Z offset. The file is right; the database is stale.
 *
 * Uses the same HTTP driver as production rather than hand-rolled curl — an
 * earlier curl attempt returned empty and silently did nothing.
 *
 *   npx tsx scripts/fix-created-at-typedb.ts [--apply]
 */

import { TypeDBHttpDriver, isOkResponse } from "@typedb/driver-http";
import { settings } from "../src/config.js";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const config = settings.all;
  const driver = new TypeDBHttpDriver({
    username: config.TYPEDB_USERNAME,
    password: config.TYPEDB_PASSWORD,
    addresses: [config.TYPEDB_ADDRESS],
  });
  const db = config.TYPEDB_DATABASE;

  const health = await driver.health();
  console.log(`server: ${config.TYPEDB_ADDRESS} — ${isOkResponse(health) ? "ok" : "UNREACHABLE"}`);
  if (!isOkResponse(health)) process.exit(1);

  const before = await driver.oneShotQuery(
    "match attribute $a; $a label created-at;",
    false,
    db,
    "read",
  );
  console.log("current definition present:", isOkResponse(before));

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to redefine as datetime-tz.");
    return;
  }

  const result = await driver.oneShotQuery(
    "redefine attribute created-at, value datetime-tz;",
    true,
    db,
    "schema",
  );
  if (!isOkResponse(result)) {
    console.error("\nRedefine REJECTED:");
    console.error(JSON.stringify(result, null, 2).slice(0, 1500));
    console.error(
      "\nTypeDB is a mirror; knowledge_base/findings/index.json is the source " +
        "of truth. If instances block the change they can be dropped safely.",
    );
    process.exit(1);
  }
  console.log("\nRedefined created-at as datetime-tz.");

  /*
   * Prove it took, rather than trusting a success response — an earlier curl
   * attempt returned no error and had changed nothing. getDatabaseSchema wraps
   * the schema text in a response envelope whose shape varies, so unwrap
   * defensively rather than assuming a string.
   */
  const schema: unknown = await driver.getDatabaseSchema(db);
  const text =
    typeof schema === "string"
      ? schema
      : ((schema as { ok?: { schema?: string } })?.ok?.schema ??
        JSON.stringify(schema));
  const match = text.match(/attribute created-at,\s*value ([a-z-]+)/);
  console.log(`verified in live schema: created-at is now "${match?.[1]}"`);
  if (match?.[1] !== "datetime-tz") {
    console.error("Verification FAILED — schema still reports the old type.");
    process.exit(1);
  }
  console.log("Restart the backend so the claim store re-initialises.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
