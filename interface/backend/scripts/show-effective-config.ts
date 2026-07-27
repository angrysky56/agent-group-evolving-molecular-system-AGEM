/**
 * show-effective-config.ts — what a FRESH process would use.
 *
 * Exists because editing .env is not sufficient to change a running server.
 * dotenv does not override variables already present in process.env, and
 * `tsx watch` restarts only the child, which inherits the parent's environment
 * frozen at launch. So a dev server started hours ago keeps serving the values
 * that were in .env then, no matter how many times the file is edited or a
 * source file is touched — and /system/config keeps reporting the stale pair
 * while every offline probe shows the new one.
 *
 * Run this to see what the file actually says; compare with
 * `curl localhost:8000/api/v1/system/config` to see what the server believes.
 * A mismatch means the dev server needs a genuine restart, not a reload.
 */

import { settings } from "../src/config.js";

const c = settings.all;
console.log("effective config from .env (fresh process):");
console.log(`  EMBEDDING_PROVIDER              = ${c.EMBEDDING_PROVIDER}`);
console.log(`  OPENROUTER_EMBEDDING_MODEL      = ${c.OPENROUTER_EMBEDDING_MODEL}`);
console.log(`  OLLAMA_EMBEDDING_MODEL          = ${c.OLLAMA_EMBEDDING_MODEL}`);
console.log(`  FINDING_RECALL_SIMILARITY_FLOOR = ${c.FINDING_RECALL_SIMILARITY_FLOOR}`);
console.log(`  FINDING_RECALL_TOP_K            = ${c.FINDING_RECALL_TOP_K}`);

for (const key of [
  "EMBEDDING_PROVIDER",
  "OPENROUTER_EMBEDDING_MODEL",
] as const) {
  if (process.env[key] && process.env[key] !== String(c[key])) {
    console.log(
      `\nWARNING: ${key} is also exported in this shell as ` +
        `"${process.env[key]}", which would win over .env.`,
    );
  }
}
