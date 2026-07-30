/**
 * fix-finding-status-typedb.ts — backfill missing `finding-status` on legacy findings.
 *
 * Pre-existing `finding` instances in the live database lacked `finding-status`
 * attribute ownership because they were written before `finding-status` was added
 * to schema/findings.tql.
 *
 * Running `schema define` with `@card(1)` previously failed because TypeDB validates
 * all existing data instances against mandatory cardinality constraints.
 *
 * Usage:
 *   npx tsx scripts/fix-finding-status-typedb.ts [--apply]
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

  const missing = await driver.oneShotQuery(
    `match $f isa finding, not { $f has finding-status $s; }; get $f;`,
    false,
    db,
    "read",
  );
  
  const count = isOkResponse(missing) && Array.isArray(missing.ok?.data)
    ? missing.ok.data.length
    : 0;

  console.log(`Pre-existing findings missing finding-status: ${count}`);

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to insert 'active' status for legacy findings.");
    return;
  }

  if (count > 0) {
    const updateResult = await driver.oneShotQuery(
      `match $f isa finding, not { $f has finding-status $s; }; insert $f has finding-status "active";`,
      true,
      db,
      "write",
    );

    if (!isOkResponse(updateResult)) {
      console.error("\nBackfill REJECTED:");
      console.error(JSON.stringify(updateResult, null, 2).slice(0, 1500));
      process.exit(1);
    }
    console.log(`\nUpdated ${count} findings with default finding-status "active".`);
  } else {
    console.log("\nNo findings require backfilling.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
