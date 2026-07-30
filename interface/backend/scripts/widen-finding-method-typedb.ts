/**
 * widen-finding-method-typedb.ts — admit "evidential" to the `method` @values set.
 *
 * Why this needs its own script
 * -----------------------------
 * `schema/findings.tql` is re-defined on every backend start. TypeDB validates
 * a redefinition against the data already in the database, and a rejected
 * define aborts the WHOLE define — which has already taken the entire claim
 * store offline once in this project's history (the `created-at datetime` vs
 * `datetime-tz` incident; see docs/ENGINEERING-HANDOFF.md §5). Widening an
 * @values set is the safe direction, but "safe in principle" is what the last
 * outage was called too, so this verifies against the live server first.
 *
 * Usage:
 *   npx tsx scripts/widen-finding-method-typedb.ts          # dry run
 *   npx tsx scripts/widen-finding-method-typedb.ts --apply
 */

import { TypeDBHttpDriver, isOkResponse } from "@typedb/driver-http";
import { settings } from "../src/config.js";

const APPLY = process.argv.includes("--apply");

/**
 * `redefine`, not `define`.
 *
 * TypeDB 3.x rejects a `define` that changes an annotation already present on a
 * type — DEX15, "a different 'method @values(...)' is already defined. Try
 * redefine instead?" `define` is add-only; changing an existing annotation is
 * what `redefine` is for. (Observed live on 2026-07-30 against 127.0.0.1:8100.)
 */
const WIDENED =
  'redefine attribute method, value string @values("derived-from-claims", "hand-authored", "evidential");';

async function main(): Promise<void> {
  const config = settings.all;
  const driver = new TypeDBHttpDriver({
    username: config.TYPEDB_USERNAME,
    password: config.TYPEDB_PASSWORD,
    addresses: [config.TYPEDB_ADDRESS],
  });
  const db = config.TYPEDB_DATABASE;

  const health = await driver.health();
  console.log(
    `server: ${config.TYPEDB_ADDRESS} — ${isOkResponse(health) ? "ok" : "UNREACHABLE"}`,
  );
  if (!isOkResponse(health)) process.exit(1);

  // Existing values must all remain inside the widened set, or the define
  // fails and takes every other type definition with it.
  const existing = await driver.oneShotQuery(
    `match $f isa finding, has method $m; select $m;`,
    false,
    db,
    "read",
  );
  const answers = isOkResponse(existing)
    ? ((existing.ok as { answers?: unknown[] })?.answers ?? [])
    : [];
  const values = new Set(
    answers.map((answer) => JSON.stringify(answer)).map((raw) => {
      const match = raw.match(/"value":"([^"]+)"/);
      return match?.[1] ?? "";
    }),
  );
  values.delete("");
  const allowed = new Set([
    "derived-from-claims",
    "hand-authored",
    "evidential",
  ]);
  const strays = [...values].filter((value) => !allowed.has(value));

  console.log(`distinct stored method values: ${[...values].join(", ") || "(none)"}`);
  if (strays.length > 0) {
    console.error(
      `\nABORT — ${strays.length} stored value(s) fall outside the widened set: ${strays.join(", ")}. ` +
        "Reconcile these before redefining, or the define will abort and take the store offline.",
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log(
      `\nDry run — every stored value is inside the widened set. Re-run with --apply to run:\n  ${WIDENED}`,
    );
    return;
  }

  const result = await driver.oneShotQuery(WIDENED, true, db, "schema");
  if (!isOkResponse(result)) {
    console.error("\nDefine REJECTED:");
    console.error(JSON.stringify(result, null, 2).slice(0, 1500));
    process.exit(1);
  }
  console.log('\nmethod @values now admits "evidential".');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
