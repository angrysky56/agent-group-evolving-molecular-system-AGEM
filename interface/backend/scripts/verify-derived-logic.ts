/**
 * verify-derived-logic.ts
 *
 * The claim: deterministic FOL derived from typed claims reproduces the
 * EXHAUSTIVE verdict, and cannot drift the way freehand encoding did.
 *
 * Ground truth is the 3457-check exhaustive Mace4 run over the ToM corpus:
 *   contradictions = { IIT/GWT, TypePhys/Functionalism, Epiphen/Interactionism }
 *   Hard/Easy problems are a DISTINCTION, not a contradiction (per the corpus
 *   answer key: "different kinds of question").
 *
 * A later freehand run inverted two of those: IIT/GWT became consistent (the
 * exclusion was dropped) and Hard/Easy became a contradiction (manufactured by
 * encoding the hard problem as "not a functional performance"). This script
 * checks the derivation gets both right.
 */
import { claimToPropositions, type ExtractedClaim } from "../src/services/claim-extractor.js";
import { computeLogicalCohomology } from "../src/services/logicalCohomology.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MACE4 =
  process.env.MACE4_PATH ??
  "/home/ty/Repositories/ai_workspace/mcp-logic/ladr/bin/mace4";

const sat = async (formulas: string[]) => {
  const dir = await mkdtemp(path.join(tmpdir(), "derive-"));
  const f = path.join(dir, "in.p");
  try {
    await writeFile(
      f,
      ["assign(domain_size, 2).", "assign(end_size, 10).", "assign(max_seconds, 5).", "",
        "formulas(assumptions).",
        ...formulas.map((x) => (x.trim().endsWith(".") ? x : x + ".")),
        "end_of_list.", ""].join("\n"),
      "utf8",
    );
    let out = "";
    try {
      out = (await execFileAsync(MACE4, ["-f", f], { timeout: 7000, maxBuffer: 1 << 24 })).stdout;
    } catch (e: any) { out = `${e?.stdout ?? ""}\n${e?.stderr ?? ""}`; }
    if (out.includes("interpretation(") && out.includes("DOMAIN SIZE")) return { consistent: true };
    if (/exit \(exhausted\)|Exiting with failure|SEARCH FAILED/.test(out)) return { consistent: false };
    return { consistent: null };
  } finally { await rm(dir, { recursive: true, force: true }); }
};

/** Claims as the extractor would type them from the corpus sentences. */
const CLAIMS: ExtractedClaim[] = [
  // "consciousness is intrinsic integration WHETHER OR NOT anything is broadcast"
  { kind: "identity-claim", roles: { identified: "consciousness", "identified-with": "phi" } },
  { kind: "exclusion", roles: { excluder: "phi", excluded: "global-broadcast" } },
  { kind: "identity-claim", roles: { identified: "consciousness", "identified-with": "global-broadcast" } },
  // Hard vs easy problems — the corpus calls this a difference in KIND of question.
  { kind: "distinction", roles: { distinguished: ["hard-problem", "easy-problems"] as never }, differenceKind: "in-kind" },
];

let failures = 0;
const check = (l: string, ok: boolean, d = "") => {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l}${d ? ` — ${d}` : ""}`);
};

const blocks = CLAIMS.map(claimToPropositions).filter(Boolean) as {
  name: string; propositions: string[];
}[];

console.log("Derived blocks:");
for (const b of blocks) console.log(`  ${b.name}\n    ${b.propositions.join("\n    ")}`);

console.log("\nStructural guarantees");
const excl = blocks.find((b) => b.name.startsWith("exclusion"))!;
check("exclusion emits a negation unprompted", excl.propositions.some((p) => p.includes("-")));
check("every block carries an existential witness",
  blocks.every((b) => b.propositions.some((p) => p.startsWith("exists"))));
const dist = blocks.find((b) => b.name.startsWith("distinction"))!;
check("distinction is non-coextension, NOT opposed predicates",
  dist.propositions.length === 1 && dist.propositions[0].startsWith("exists"));

console.log("\nAgainst real Mace4");
const r = await computeLogicalCohomology(blocks, sat);
const names = r.frustrations.map((f) => f.blocks.slice().sort().join(" + "));
for (const f of r.frustrations) console.log(`  frustration: {${f.blocks.join(", ")}} arity ${f.arity}`);

check(
  "IIT/GWT contradiction RECOVERED (freehand run lost it)",
  r.frustrations.some((f) =>
    f.blocks.some((b) => b.includes("phi")) &&
    f.blocks.some((b) => b.includes("global-broadcast")),
  ),
  names.join(" | ") || "none found",
);
check(
  "Hard/Easy NOT contradictory (freehand run manufactured it)",
  !r.frustrations.some((f) => f.blocks.some((b) => b.includes("hard-problem"))),
);
check("result is not vacuous", !r.resultIsVacuous);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
