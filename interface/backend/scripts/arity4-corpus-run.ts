/**
 * arity4-corpus-run.ts
 *
 * Runs a logic corpus through the real `computeLogicalCohomology` engine at the
 * current defaults, driving Mace4 directly instead of going through the MCP
 * transport.
 *
 * Why this exists: every previous run of the consciousness corpus stopped at
 * arity 3, because the check budget (then 400) refused to start a level it
 * could not finish. The question "is there a 4-block minimal unsatisfiable
 * set?" was therefore never actually asked. This script asks it.
 *
 * The oracle mirrors mcp-logic's Mace4 wrapper exactly — same input file shape
 * (domain_size 2, end_size 10) and the same authoritative exit-status parsing —
 * so results are comparable with the live tool rather than a separate dialect.
 *
 * Usage:
 *   npx tsx scripts/arity4-corpus-run.ts [path/to/blocks.json]
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  computeLogicalCohomology,
  type SatOracle,
  type LogicalBlock,
} from "../src/services/logicalCohomology.js";

const execFileAsync = promisify(execFile);

/** Mace4 binary shipped with the mcp-logic checkout. Override with MACE4_PATH. */
const MACE4 =
  process.env.MACE4_PATH ??
  "/home/ty/Repositories/ai_workspace/mcp-logic/ladr/bin/mace4";

/** Seconds Mace4 may spend on a single satisfiability question. */
const PER_CHECK_SECONDS = Number(process.env.MACE4_SECONDS ?? 5);

/**
 * Translate the operators mcp-logic's `normalize_formula` translates, so a
 * formula written for the live tool means the same thing here.
 */
function normalizeFormula(f: string): string {
  return f.replace(/~/g, "-").trim();
}

/**
 * Satisfiability via Mace4 model finding: a model exists ⇒ consistent;
 * exhausting the domain range without one ⇒ contradictory; anything else
 * (timeout, parse failure) ⇒ undetermined, never silently "consistent".
 */
function makeMace4Oracle(): SatOracle {
  return async (formulas: string[]) => {
    const dir = await mkdtemp(path.join(tmpdir(), "agem-mace4-"));
    const input = path.join(dir, "in.p");
    const body = [
      "assign(domain_size, 2).",
      "assign(end_size, 10).",
      `assign(max_seconds, ${PER_CHECK_SECONDS}).`,
      "",
      "formulas(assumptions).",
      ...formulas.map((f) => {
        const n = normalizeFormula(f);
        return n.endsWith(".") ? n : n + ".";
      }),
      "end_of_list.",
      "",
    ].join("\n");

    try {
      await writeFile(input, body, "utf8");
      let stdout = "";
      let stderr = "";
      try {
        const r = await execFileAsync(MACE4, ["-f", input], {
          timeout: (PER_CHECK_SECONDS + 2) * 1000,
          maxBuffer: 32 * 1024 * 1024,
        });
        stdout = r.stdout;
        stderr = r.stderr;
      } catch (e: any) {
        // Mace4 signals its verdict through a NON-ZERO exit status, so a throw
        // here is normal control flow, not an error. Read the output.
        stdout = e?.stdout ?? "";
        stderr = e?.stderr ?? "";
        if (!stdout && !stderr)
          return { consistent: null, note: `mace4 failed: ${e?.message}` };
      }

      const combined = `${stdout}\n${stderr}`;
      const modelFound =
        stdout.includes("interpretation(") && stdout.includes("DOMAIN SIZE");
      const exhausted =
        combined.includes("exit (exhausted)") ||
        combined.includes("Exiting with failure") ||
        stdout.includes("SEARCH FAILED") ||
        stdout.includes("SEARCH TERMINATED");
      const hitLimit =
        combined.includes("exit (max_seconds)") ||
        combined.includes("exit (max_megs)");

      if (modelFound) return { consistent: true };
      if (exhausted)
        return { consistent: false, note: "no model up to domain bound" };
      if (hitLimit) return { consistent: null, note: "mace4 hit its time limit" };
      return { consistent: null, note: "mace4 gave no decisive verdict" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function main() {
  const blocksPath =
    process.argv[2] ??
    path.join(import.meta.dirname, "consciousness-blocks.json");
  const blocks: LogicalBlock[] = JSON.parse(readFileSync(blocksPath, "utf8"));

  console.log(`Corpus: ${blocks.length} blocks from ${blocksPath}`);
  console.log(`Mace4:  ${MACE4} (${PER_CHECK_SECONDS}s per check)\n`);

  // MAX_ARITY=full exhausts the lattice, leaving no "not ruled out" caveat.
  const arityEnv = process.env.MAX_ARITY;
  const maxArity =
    arityEnv === "full" ? blocks.length : arityEnv ? Number(arityEnv) : undefined;
  const maxChecks = process.env.MAX_CHECKS
    ? Number(process.env.MAX_CHECKS)
    : undefined;
  const opts = {
    ...(maxArity ? { maxArity } : {}),
    ...(maxChecks ? { maxChecks } : {}),
  };
  if (maxArity || maxChecks) {
    console.log(
      `overrides: maxArity=${maxArity ?? "default"}, maxChecks=${maxChecks ?? "default"}\n`,
    );
  }

  const started = Date.now();
  const r = await computeLogicalCohomology(blocks, makeMace4Oracle(), opts);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `--- searched to arity ${r.searchedToArity} in ${elapsed}s, ` +
      `${r.checksPerformed} checks ---\n`,
  );

  console.log(`hasContradiction : ${r.hasContradiction}`);
  console.log(`frustrations     : ${r.frustrations.length}`);
  for (const f of r.frustrations) {
    console.log(`  arity ${f.arity}: {${f.blocks.join(", ")}}`);
    for (const c of f.core ?? []) console.log(`      ${c.block}: ${c.formula}`);
  }

  console.log(`\nsearchTruncated  : ${r.searchTruncated}`);
  if (r.truncationNote) console.log(`  ${r.truncationNote}`);
  console.log(`h0 / h1          : ${r.h0} / ${r.h1}`);
  if (r.h1Note) console.log(`  ${r.h1Note}`);
  console.log(`resultIsVacuous  : ${r.resultIsVacuous}`);

  const byArity = new Map<number, number>();
  for (const c of r.checkLog) {
    if (c.kind === "core" || c.kind === "internal") continue;
    byArity.set(c.blocks.length, (byArity.get(c.blocks.length) ?? 0) + 1);
  }
  console.log(
    `\nchecks by arity  : ${[...byArity.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}:${n}`)
      .join("  ")}`,
  );

  if (r.internallyInconsistent.length)
    console.log(
      `\ninternally inconsistent: ${r.internallyInconsistent.join(", ")}`,
    );
  if (r.checkFailures.length) {
    console.log(`\ncheckFailures (${r.checkFailures.length}):`);
    for (const f of r.checkFailures.slice(0, 20)) console.log(`  ${f}`);
  }
  for (const w of r.formalizationWarnings)
    console.log(`\n[${w.severity}] ${w.code}: ${w.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
