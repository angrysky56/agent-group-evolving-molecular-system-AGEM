/**
 * audit-derived-blocks.ts — run the formalization checks over the blocks a real
 * run actually derived.
 *
 * The typed path builds one block per claim via claimToPropositions, and each
 * block carries its own existential witness. This reports how many of those
 * blocks can contradict anything at all.
 *
 *   npx tsx scripts/audit-derived-blocks.ts <runLogId>
 */

import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { settings } from "../src/config.js";
import {
  analyzeFormalization,
  type LogicalBlock,
} from "../src/services/logicalCohomology.js";
import {
  deriveClaimBlocks,
  mapSegmentsToPositions,
  type ClaimCommunity,
} from "../src/services/claim-blocks.js";
import type { ExtractionOutcome } from "../src/services/claim-extractor.js";
import { segmentText } from "#agem/tna/CooccurrenceGraph.js";
import { ProviderEmbedder } from "../src/services/provider-embedder.js";

const runLogId = process.argv[2];
if (!runLogId) {
  console.error(
    "usage: tsx scripts/audit-derived-blocks.ts <runLogId> [--rederive] [--embeddings] [--ontology=path] [--shared=a,b] [--out=path]",
  );
  process.exit(1);
}
const rederive = process.argv.includes("--rederive");
const useEmbeddings = process.argv.includes("--embeddings");
const ontologyPath = process.argv
  .find((arg) => arg.startsWith("--ontology="))
  ?.slice("--ontology=".length);
const sharedExistencePredicates =
  process.argv
    .find((arg) => arg.startsWith("--shared="))
    ?.slice("--shared=".length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
const outputPath = process.argv
  .find((arg) => arg.startsWith("--out="))
  ?.slice("--out=".length);

function subjectsOf(block: LogicalBlock): Set<string> {
  const out = new Set<string>();
  for (const formula of block.propositions) {
    const arrow = formula.indexOf("->");
    const head = arrow >= 0 ? formula.slice(0, arrow) : formula;
    const bare = head.replace(/\b(all|exists)\s+[a-zA-Z_][\w]*/g, " ");
    for (const [, s] of bare.matchAll(/\b([a-z_][A-Za-z0-9_]*)\s*\(/g)) out.add(s);
  }
  return out;
}

async function main(): Promise<void> {
  const path = join(settings.all.KNOWLEDGE_BASE_PATH, "runs", `${runLogId}.jsonl`);
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let blocks: LogicalBlock[] = [];
  let extractionOutput: Record<string, unknown> | undefined;
  let extractionArgs: Record<string, unknown> | undefined;
  let communities: ClaimCommunity[] = [];
  for await (const line of reader) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      event.type === "tool_call" &&
      event.name === "extract_and_verify_claims" &&
      event.args &&
      typeof event.args === "object"
    ) {
      extractionArgs = event.args as Record<string, unknown>;
    }
    if (
      event.type === "tool_result" &&
      event.name === "get_graph_topology" &&
      typeof event.output === "string"
    ) {
      const parsed = JSON.parse(event.output) as Record<string, unknown>;
      if (Array.isArray(parsed.communities)) {
        communities = parsed.communities as ClaimCommunity[];
      }
    }
    if (
      event.type === "tool_result" &&
      event.name === "extract_and_verify_claims" &&
      typeof event.output === "string"
    ) {
      const parsed = JSON.parse(event.output) as Record<string, unknown>;
      extractionOutput = parsed;
      if (Array.isArray(parsed.derivedBlocks)) {
        blocks = parsed.derivedBlocks as LogicalBlock[];
      }
    }
  }
  reader.close();

  if (rederive) {
    const evidence = Array.isArray(extractionOutput?.supportingClaimEvidence)
      ? extractionOutput.supportingClaimEvidence
      : [];
    const outcomes: ExtractionOutcome[] = evidence.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      if (
        typeof item.segmentId !== "string" ||
        typeof item.claimKey !== "string" ||
        typeof item.claimRef !== "string" ||
        !item.claim ||
        typeof item.claim !== "object"
      ) {
        return [];
      }
      return [{
        segmentId: item.segmentId,
        claim: item.claim as ExtractionOutcome["claim"],
        claimKey: item.claimKey,
        claimId: item.claimRef,
        accepted: true,
      }];
    });
    const ontology = ontologyPath
      ? (JSON.parse(
          await readFile(resolve(ontologyPath), "utf8"),
        ) as Record<string, string>)
      : {};
    const text =
      typeof extractionArgs?.text === "string" ? extractionArgs.text : "";
    const corpusId =
      typeof extractionArgs?.corpusId === "string"
        ? extractionArgs.corpusId
        : "corpus";
    const segments = segmentText(text).map((segment, index) => ({
      id: `${corpusId}-${index}`,
      text: segment,
    }));
    const derivation = await deriveClaimBlocks(outcomes, {
      communities,
      ontology,
      positionBySegment: mapSegmentsToPositions(segments),
      embedder: useEmbeddings ? new ProviderEmbedder() : undefined,
      sharedExistencePredicates,
    });
    blocks = derivation.blocks;
    console.log(
      `re-derived from ${outcomes.length} accepted claims into ${blocks.length} position blocks`,
    );
    console.log(
      `predicate mappings: ${derivation.predicateMapping.filter((entry) => entry.method !== "unchanged").length} merge/repair(s), ${derivation.rejected.length} derivation rejection(s)`,
    );
    console.log(
      `shared existence predicates: ${derivation.sharedExistencePredicates.join(", ") || "none"}`,
    );
    for (const block of derivation.blocks) {
      console.log(
        `  ${block.name}: ${block.claimKeys.length} claim(s), communities [${block.communityIds.join(", ")}]`,
      );
    }
    console.log("");
  }

  if (blocks.length === 0) {
    console.log("No derivedBlocks in that run.");
    return;
  }
  if (outputPath) {
    await writeFile(resolve(outputPath), JSON.stringify(blocks, null, 2), "utf8");
    console.log(`wrote ${blocks.length} block(s) to ${resolve(outputPath)}\n`);
  }

  console.log(`derived blocks: ${blocks.length}\n`);
  console.log("first three, verbatim:");
  for (const b of blocks.slice(0, 3)) {
    console.log(`  ${b.name}`);
    for (const p of b.propositions) console.log(`      ${p}`);
  }

  // How many blocks share a subject predicate with any other block?
  const subjects = blocks.map((b) => ({ name: b.name, s: subjectsOf(b) }));
  const connected = subjects.filter((b) =>
    subjects.some(
      (o) => o.name !== b.name && [...b.s].some((x) => o.s.has(x)),
    ),
  );
  const withWitness = blocks.filter((b) =>
    b.propositions.some((p) => /\bexists\b/.test(p)),
  );

  console.log(`\nblocks introducing their own witness: ${withWitness.length}/${blocks.length}`);
  console.log(`blocks sharing a subject with any other: ${connected.length}/${blocks.length}`);
  console.log(
    `blocks that CANNOT contradict anything: ${blocks.length - connected.length}/${blocks.length}`,
  );

  const warnings = analyzeFormalization(blocks);
  console.log(`\nformalization warnings: ${warnings.length}`);
  for (const w of warnings) {
    console.log(`  [${w.severity}] ${w.code}: ${w.message.slice(0, 110)}...`);
    for (const d of (w.detail ?? []).slice(0, 3)) console.log(`      ${d}`);
    if ((w.detail?.length ?? 0) > 3) {
      console.log(`      ... and ${w.detail!.length - 3} more`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
