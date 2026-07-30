import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { claimToPropositions, type ExtractedClaim } from "./claim-extractor.js";

const execFileAsync = promisify(execFile);
const MACE4 =
  process.env.MACE4_PATH ??
  "/home/ty/Repositories/ai_workspace/mcp-logic/ladr/bin/mace4";

const joint: ExtractedClaim = {
  kind: "joint-incompatibility",
  roles: { incompatible: ["locality", "realism", "measurement-independence"] },
  scope: "corpus",
};

async function satisfiable(formulas: string[]): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), "agem-joint-mace4-"));
  const inputPath = path.join(directory, "input.p");
  const body = [
    "assign(domain_size, 2).",
    "assign(end_size, 3).",
    "assign(max_seconds, 5).",
    "formulas(assumptions).",
    ...formulas.map((formula) => `${formula.replace(/\.$/, "")}.`),
    "end_of_list.",
    "",
  ].join("\n");
  try {
    await writeFile(inputPath, body, "utf8");
    let output = "";
    try {
      const result = await execFileAsync(MACE4, ["-f", inputPath], {
        timeout: 7000,
        maxBuffer: 8 * 1024 * 1024,
      });
      output = `${result.stdout}\n${result.stderr}`;
    } catch (error: any) {
      output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    }
    if (output.includes("interpretation(") && output.includes("DOMAIN SIZE")) {
      return true;
    }
    if (
      output.includes("exit (exhausted)") ||
      output.includes("Exiting with failure") ||
      output.includes("SEARCH FAILED") ||
      output.includes("SEARCH TERMINATED")
    ) {
      return false;
    }
    throw new Error(`Mace4 returned no decisive verdict: ${output.slice(-500)}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("joint incompatibility against real Mace4", () => {
  it("forbids only the full set while every proper subset remains satisfiable", async () => {
    const formula = claimToPropositions(joint)!.propositions[0]!;
    const members = [
      "locality(entity)",
      "realism(entity)",
      "measurement_independence(entity)",
    ];

    expect(await satisfiable([formula])).toBe(true);
    for (let omitted = 0; omitted < members.length; omitted++) {
      const properSubset = members.filter((_, index) => index !== omitted);
      expect(await satisfiable([formula, ...properSubset])).toBe(true);
    }
    for (const member of members) {
      expect(await satisfiable([formula, member])).toBe(true);
    }
    expect(await satisfiable([formula, ...members])).toBe(false);
  });
});
