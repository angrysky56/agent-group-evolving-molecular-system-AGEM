/**
 * run-baseline.ts — reckon the four corpora against keys written beforehand.
 *
 * Why this exists
 * ---------------
 * "No one mans Reason, nor the Reason of any one number of men, makes the
 * certaintie; no more than an account is therefore well cast up, because a
 * great many men have unanimously approved it." — Hobbes, Leviathan I.v.
 *
 * Passing unit tests are unanimous approval. Three separate features in this
 * pipeline had full green suites while never having executed once. The only
 * thing that settles whether the account is well cast up is an arbiter that
 * was written before the run — which is what `corpora/*​/answer-key.md` are,
 * and they had never been consulted: `knowledge_base/reports/` was empty and
 * no script existed to fill it.
 *
 * How it works
 * ------------
 * Drives the REAL pipeline through the CLI, one corpus per run, then scores
 * the resulting run-log JSONL. It deliberately does not import and re-wire the
 * extraction internals: a harness that reassembles the pipeline tests the
 * harness's version of it, not the one that actually runs.
 *
 * What it will NOT do
 * -------------------
 * Claim a `mustFind` was reproduced on a fuzzy symbol match. The key names
 * stances like `measurement_independence`; the run names blocks and predicate
 * symbols the extractor chose. Where those coincide exactly, that is evidence.
 * Where they nearly coincide, it is reported as REVIEW and scored as a miss.
 * Under-claiming is the safe direction, and a scorer that fuzzy-matches its way
 * to a pass is just the engine approving of itself again.
 *
 * Usage:
 *   npx tsx scripts/run-baseline.ts               # all four corpora
 *   npx tsx scripts/run-baseline.ts qm-interpretations
 *   npx tsx scripts/run-baseline.ts --score-only  # re-score newest logs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  VERDICT_ANSWER_KEYS,
  INVERTED_SCORING_CORPORA,
  type VerdictAnswerKey,
} from "../src/services/baseline-keys.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const RUNS = join(ROOT, "knowledge_base/runs");
const REPORTS = join(ROOT, "knowledge_base/reports");

interface RunFacts {
  runLogId: string;
  ingested: boolean;
  glossarySize: number;
  glossaryFailure?: string;
  glossaryDropped: number;
  extensionRequested: number;
  extensionAdded: string[];
  extensionRejected: number;
  unmappableClaims: number;
  claimsAccepted: number;
  claimsRejected: number;
  rejectionKinds: Record<string, number>;
  proverCalls: number;
  verdictKind?: string;
  frustrations: Array<{ kind: string; blocks: string[]; arity: number }>;
  evidentialPathGranted: boolean;
  terminalStatus?: string;
  toolsCalled: string[];
}

function newestRunLog(after: number): string | null {
  const files = readdirSync(RUNS)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, m: statSync(join(RUNS, f)).mtimeMs }))
    .filter(({ m }) => m >= after)
    .sort((a, b) => b.m - a.m);
  return files[0] ? join(RUNS, files[0].f) : null;
}

/** Read only what the log actually records. No inference, no defaults that lie. */
function readRunFacts(path: string): RunFacts {
  const records = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);

  const facts: RunFacts = {
    runLogId: path.split("/").pop()!,
    ingested: false,
    glossarySize: 0,
    glossaryDropped: 0,
    extensionRequested: 0,
    extensionAdded: [],
    extensionRejected: 0,
    unmappableClaims: 0,
    claimsAccepted: 0,
    claimsRejected: 0,
    rejectionKinds: {},
    proverCalls: 0,
    frustrations: [],
    evidentialPathGranted: false,
    toolsCalled: [],
  };

  for (const record of records) {
    switch (record.type) {
      case "tool_call":
        facts.toolsCalled.push(String(record.name));
        break;
      case "cycle_ingest":
      case "sectioned_run_telemetry":
        facts.ingested = true;
        break;
      case "evidential_path_granted":
        facts.evidentialPathGranted = true;
        break;
      case "run_end":
        facts.terminalStatus = record.status;
        break;
      case "claim_extraction_telemetry": {
        facts.glossarySize = Number(record.glossarySize ?? 0);
        facts.glossaryFailure = record.glossaryFailure ?? undefined;
        facts.glossaryDropped = (record.glossaryDropped ?? []).length;
        const ext = record.glossaryExtension;
        if (ext) {
          facts.extensionRequested = Number(ext.requested ?? 0);
          facts.extensionAdded = (ext.additions ?? []).map(
            (a: { label: string }) => a.label,
          );
          facts.extensionRejected = (ext.rejected ?? []).length;
        }
        facts.unmappableClaims = (record.unmappable ?? []).length;
        for (const outcome of record.outcomes ?? []) {
          if (outcome.accepted) facts.claimsAccepted++;
          else {
            facts.claimsRejected++;
            const kind = outcome.rejectionKind ?? "unknown";
            facts.rejectionKinds[kind] = (facts.rejectionKinds[kind] ?? 0) + 1;
          }
        }
        break;
      }
      case "logic_check_log":
        facts.proverCalls = Number(record.totalChecks ?? 0);
        break;
      case "tool_result": {
        for (const value of Object.values(record)) {
          if (typeof value !== "string" || !value.includes("verdictKind")) continue;
          try {
            const parsed = JSON.parse(value);
            if (parsed.verdictKind) facts.verdictKind = parsed.verdictKind;
            for (const frustration of parsed.semanticFrustrations ?? []) {
              facts.frustrations.push({
                kind: String(frustration.kind),
                blocks: (frustration.blocks ?? []).map(String),
                arity: Number(frustration.arity ?? 0),
              });
            }
          } catch {
            // not the payload we are after
          }
        }
        break;
      }
    }
  }
  return facts;
}

/** Symbols the run actually produced, from block names and frustrations. */
function runSymbols(facts: RunFacts): Set<string> {
  const symbols = new Set<string>();
  for (const frustration of facts.frustrations) {
    for (const block of frustration.blocks) {
      symbols.add(block.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    }
  }
  return symbols;
}

type StanceVerdict = "reproduced" | "review" | "missed";

/**
 * Did the run reproduce this minimal unsatisfiable set?
 *
 * EXACT symbol coverage only. A key stance counts as present when a frustrated
 * block's normalised name equals it. Near misses are surfaced as `review` and
 * scored as misses, never as passes — a scorer that fuzzy-matches its way to a
 * pass is the engine approving of itself, which is the whole thing the answer
 * key exists to prevent.
 */
function scoreMustFind(
  entry: VerdictAnswerKey["mustFind"][number],
  facts: RunFacts,
): { verdict: StanceVerdict; matched: string[]; near: string[] } {
  const symbols = runSymbols(facts);
  const matched = entry.stances.filter((stance) => symbols.has(stance));
  const near = entry.stances.filter(
    (stance) =>
      !symbols.has(stance) &&
      [...symbols].some(
        (symbol) => symbol.includes(stance) || stance.includes(symbol),
      ),
  );
  if (matched.length === entry.stances.length) {
    return { verdict: "reproduced", matched, near };
  }
  return { verdict: near.length > 0 ? "review" : "missed", matched, near };
}

interface CorpusScore {
  corpusId: string;
  facts: RunFacts;
  mustFind: Array<{ name: string; verdict: StanceVerdict; matched: string[]; near: string[] }>;
  mustNotFindViolations: Array<{ name: string; why: string }>;
  surplusFrustrations: number;
  pass: boolean;
  blockedBefore: string | null;
}

function scoreCorpus(key: VerdictAnswerKey, facts: RunFacts): CorpusScore {
  /*
   * Name where the reckoning stopped, if it stopped. A run that never reached
   * the prover has not failed the key — it never sat the exam, and reporting
   * "0/6 reproduced" would blame the corpus for a pipeline abort.
   */
  const blockedBefore = !facts.ingested
    ? "never ingested"
    : facts.glossaryFailure
      ? `glossary: ${facts.glossaryFailure.slice(0, 90)}`
      : facts.proverCalls === 0
        ? `prover never ran (extraction: ${facts.claimsAccepted} accepted, ${facts.claimsRejected} rejected, ${facts.unmappableClaims} unmappable)`
        : null;

  const mustFind = key.mustFind.map((entry) => ({
    name: entry.name,
    ...scoreMustFind(entry, facts),
  }));

  const symbols = runSymbols(facts);
  const mustNotFindViolations = key.mustNotFind.filter((entry) => {
    const normalised = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return [...symbols].some((symbol) => symbol === normalised);
  });

  const reproduced = mustFind.filter((m) => m.verdict === "reproduced").length;
  const surplus = Math.max(0, facts.frustrations.length - key.mustFind.length);

  return {
    corpusId: key.corpusId,
    facts,
    mustFind,
    mustNotFindViolations,
    surplusFrustrations: surplus,
    pass:
      blockedBefore === null &&
      reproduced === key.mustFind.length &&
      mustNotFindViolations.length === 0 &&
      (!INVERTED_SCORING_CORPORA.has(key.corpusId) || surplus === 0),
    blockedBefore,
  };
}

function renderReport(scores: CorpusScore[]): string {
  const lines: string[] = [
    "# Baseline reckoning — corpora scored against keys written beforehand",
    "",
    `Run ${new Date().toISOString()}`,
    "",
    "An account is not well cast up because a great many approved it. These keys",
    "were written before any run; they are the arbiter, not the engine's confidence",
    "and not the unit suite.",
    "",
    "| Corpus | Reached prover | mustFind | mustNotFind violations | Pass |",
    "|---|---|---|---|---|",
  ];
  for (const score of scores) {
    const reproduced = score.mustFind.filter((m) => m.verdict === "reproduced").length;
    lines.push(
      `| ${score.corpusId} | ${score.blockedBefore ? "no" : "yes"} | ${reproduced}/${score.mustFind.length} | ${score.mustNotFindViolations.length} | ${score.pass ? "PASS" : "FAIL"} |`,
    );
  }

  for (const score of scores) {
    const f = score.facts;
    lines.push(
      "",
      `## ${score.corpusId}`,
      "",
      `Run log: \`${f.runLogId}\` · terminal status: ${f.terminalStatus ?? "unknown"}`,
      "",
      "| Stage | Result |",
      "|---|---|",
      `| Ingested | ${f.ingested ? "yes" : "NO"} |`,
      `| Glossary | ${f.glossarySize} entries${f.glossaryDropped ? `, ${f.glossaryDropped} dropped` : ""}${f.glossaryFailure ? ` — FAILED: ${f.glossaryFailure.slice(0, 120)}` : ""} |`,
      `| Extension round | ${f.extensionRequested} gaps → ${f.extensionAdded.length} added${f.extensionAdded.length ? ` (${f.extensionAdded.join(", ")})` : ""}, ${f.extensionRejected} refused |`,
      `| Claims | ${f.claimsAccepted} accepted, ${f.claimsRejected} rejected${Object.keys(f.rejectionKinds).length ? ` (${Object.entries(f.rejectionKinds).map(([k, n]) => `${k}: ${n}`).join(", ")})` : ""}, ${f.unmappableClaims} unmappable |`,
      `| Prover | ${f.proverCalls} checks · verdict: ${f.verdictKind ?? "none"} |`,
      `| Evidential path | ${f.evidentialPathGranted ? "granted" : "not granted"} |`,
      `| Tools | ${f.toolsCalled.join(", ") || "none"} |`,
    );

    if (score.blockedBefore) {
      lines.push(
        "",
        `**Did not reach the prover: ${score.blockedBefore}.** The key was not exercised — this is a pipeline result, not a score against the corpus.`,
      );
    }

    if (score.mustFind.length > 0) {
      lines.push("", "### mustFind", "", "| Theorem | Verdict | Matched | Near (not counted) |", "|---|---|---|---|");
      for (const m of score.mustFind) {
        lines.push(
          `| ${m.name} | ${m.verdict} | ${m.matched.join(", ") || "—"} | ${m.near.join(", ") || "—"} |`,
        );
      }
    }
    if (score.mustNotFindViolations.length > 0) {
      lines.push("", "### mustNotFind VIOLATIONS", "");
      for (const v of score.mustNotFindViolations) {
        lines.push(`- **${v.name}** flagged as contradictory. ${v.why}`);
      }
    }
    if (INVERTED_SCORING_CORPORA.has(score.corpusId) && score.surplusFrustrations > 0) {
      lines.push(
        "",
        `**${score.surplusFrustrations} surplus contradiction(s).** On this corpus that is an encoding bug, not a finding.`,
      );
    }
  }
  lines.push(
    "",
    "---",
    "",
    "`review` means a key stance nearly matched a symbol the run produced. It is",
    "scored as a MISS on purpose. Fuzzy matching would let the scorer talk itself",
    "into a pass, which is the failure the keys exist to catch.",
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scoreOnly = args.includes("--score-only");
  const only = args.filter((a) => !a.startsWith("--"));
  const keys = VERDICT_ANSWER_KEYS.filter(
    (k) => only.length === 0 || only.includes(k.corpusId),
  );

  const scores: CorpusScore[] = [];
  for (const key of keys) {
    const corpusPath = join(ROOT, "corpora", key.corpusId, "corpus.md");
    console.error(`\n=== ${key.corpusId} ===`);
    let logPath: string | null = null;

    if (scoreOnly) {
      logPath = newestRunLog(0);
    } else {
      const startedAt = Date.now();
      console.error(`running the real pipeline (this is slow: glossary + prover)…`);
      try {
        execFileSync(
          "npx",
          [
            "tsx",
            join(ROOT, "cli/index.ts"),
            "ask",
            "--file",
            corpusPath,
            "--prefix",
            "Analyse this corpus: ingest it, inspect the graph, then verify its logical consistency with extract_and_verify_claims.",
            "--quiet",
            "--timeout",
            "1800",
          ],
          { cwd: join(ROOT, "cli"), stdio: ["ignore", "ignore", "inherit"], timeout: 1_900_000 },
        );
      } catch (error) {
        console.error(`  CLI exited non-zero; scoring whatever the run logged.`);
      }
      logPath = newestRunLog(startedAt);
    }

    if (!logPath) {
      console.error(`  no run log found for ${key.corpusId}; skipping`);
      continue;
    }
    const facts = readRunFacts(logPath);
    scores.push(scoreCorpus(key, facts));
  }

  mkdirSync(REPORTS, { recursive: true });
  const out = join(REPORTS, `baseline-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  const report = renderReport(scores);
  writeFileSync(out, report, "utf8");
  console.error(`\nreport → ${out}\n`);
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
