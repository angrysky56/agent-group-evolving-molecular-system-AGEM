/**
 * verify-extractor.ts
 *
 * Checks the generated TypeQL executes, and — the point of the whole exercise —
 * that a claim with a dropped role is REJECTED rather than quietly stored.
 *
 * No LLM involved: claims are supplied directly, so this tests the query
 * builder and the contract, not model behaviour.
 */
import { claimStore } from "../src/services/typedb-claims.js";
import {
  claimToTypeQL,
  storeSegment,
  type ExtractedClaim,
} from "../src/services/claim-extractor.js";
import { isOkResponse } from "@typedb/driver-http";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
let failures = 0;
function check(label: string, passed: boolean, detail = "") {
  if (!passed) failures++;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const status = await claimStore.initialize(PROJECT_ROOT);
if (!status.available) {
  console.error(`claim store unavailable: ${status.note}`);
  process.exit(1);
}

const SEG = "xtr-1";
await storeSegment(
  SEG,
  "One says consciousness is intrinsic integration whether or not anything is broadcast.",
  "verify",
);

/**
 * A rejection only counts if it came from a CONSTRAINT, not a parse failure.
 * An earlier version of this script scored three syntax errors as passes,
 * because "rejected for any reason" was treated as the guard working. A broken
 * query and an enforced contract look identical unless you read the code.
 */
function isConstraintViolation(res: unknown): boolean {
  const err = (res as { err?: { code?: string; message?: string } } | null)?.err;
  const blob = `${err?.code ?? ""} ${err?.message ?? ""}`;
  return /CNT\d|DVL\d|constraint|cardinal/i.test(blob) && !/TQL\d|syntax/i.test(blob);
}

async function run(label: string, claim: ExtractedClaim, expectAccept: boolean) {
  const q = claimToTypeQL(claim, SEG);
  if (!q) {
    check(label, !expectAccept, "builder returned null (never reached the server)");
    return;
  }
  await claimStore.write(q.concepts);
  const res = await claimStore.write(q.claim);
  const accepted = !!res && isOkResponse(res);

  if (expectAccept) {
    check(label, accepted, accepted ? "accepted" : describe(res));
  } else {
    const constraint = isConstraintViolation(res);
    check(
      label,
      !accepted && constraint,
      accepted
        ? "WRONGLY ACCEPTED"
        : constraint
          ? describe(res)
          : `rejected but NOT by a constraint — ${describe(res)}`,
    );
  }
}

function describe(res: unknown): string {
  const err = (res as { err?: { code?: string; message?: string } } | null)?.err;
  return err
    ? `${err.code ?? ""} ${err.message ?? ""}`.trim().replace(/\s+/g, " ").slice(0, 110)
    : "rejected";
}

console.log("Generated TypeQL — well-formed claims must execute");
await run(
  "exclusion with both roles",
  { kind: "exclusion", roles: { excluder: "phi", excluded: "global-broadcast" } },
  true,
);
await run(
  "distinction with array-valued role + differenceKind",
  {
    kind: "distinction",
    roles: { distinguished: ["hard-problem", "easy-problems"] as unknown as string },
    differenceKind: "in-kind",
  },
  true,
);
await run(
  "causal-claim with polarity",
  {
    kind: "causal-claim",
    roles: { cause: "mental-event", effect: "physical-event" },
    polarity: "denies",
  },
  true,
);

console.log("\nMalformed claims must be REJECTED, not stored");
await run(
  "exclusion missing 'excluded' — the Test C failure",
  { kind: "exclusion", roles: { excluder: "phi" } },
  false,
);
await run(
  "causal-claim with no polarity",
  { kind: "causal-claim", roles: { cause: "mental-event", effect: "physical-event" } },
  false,
);
await run(
  "unknown claim kind",
  { kind: "vibes" as never, roles: { a: "b" } },
  false,
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
