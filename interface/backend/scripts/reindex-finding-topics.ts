/**
 * reindex-finding-topics.ts — re-key existing findings on topic.
 *
 * Findings written before the topicKey split are embedded on their verdict, so
 * they are effectively unreachable from a conversational opener (measured: 0.199
 * for "let's continue our work on the origin of the genetic code", against a 0.4
 * floor). This rebuilds their retrieval key and re-embeds them in place.
 *
 * The original block names are not recoverable from a stored finding — the
 * arguments are gone — but the verdict names them inside `{...}` groups, and the
 * corpus id carries the subject. That is enough to key on topic. Verdict,
 * coverage and every other field are left untouched: this changes only what the
 * finding is indexed BY, never what it says.
 *
 *   npx tsx scripts/reindex-finding-topics.ts [--apply]
 *
 * Without --apply it reports what would change and writes nothing.
 */

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { settings } from "../src/config.js";
import { ProviderEmbedder } from "../src/services/provider-embedder.js";

const APPLY = process.argv.includes("--apply");
const INDEX_PATH = join(
  settings.all.KNOWLEDGE_BASE_PATH,
  "findings",
  "index.json",
);

interface Storedish {
  id: string;
  verdict: string;
  corpusId: string;
  coverage?: string;
  topicKey?: string;
  embedding: number[];
}

/** "origin-of-genetic-code" → "origin of genetic code". */
function deslug(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Recover block names from a verdict. They appear as `{A, B}` groups in a
 * contradiction verdict; a clean verdict names none, and the corpus id then
 * carries the topic on its own.
 */
function blockNamesFromVerdict(verdict: string): string[] {
  const names = new Set<string>();
  for (const match of verdict.matchAll(/\{([^{}]+)\}/g)) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim();
      // Skip anything that looks like a formula rather than a label.
      if (name && !/[()]/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/*
 * `coverage` is deliberately NOT included. It reads "Coverage: all 10 submitted
 * blocks were evaluated." — pure boilerplate with no topical content, and it
 * measurably dilutes the key: on the philosophy-of-mind finding it dragged
 * "Continue the philosophy of mind work" from 0.466 down to 0.359, i.e. from
 * recalled to missed, while also pulling the sourdough control UP from 0.274 to
 * 0.176 in the wrong direction relative to the signal. Boilerplate shared by
 * every finding cannot discriminate between them.
 */
function rebuildTopicKey(finding: Storedish): string {
  const parts = [deslug(finding.corpusId)];
  const names = blockNamesFromVerdict(finding.verdict);
  if (names.length > 0) parts.push(names.join(", "));
  return parts.join("\n").slice(0, 2000);
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(INDEX_PATH, "utf8"));
  const findings: Storedish[] = raw.findings ?? raw;
  if (!Array.isArray(findings)) throw new Error("Unexpected index shape.");

  const embedder = new ProviderEmbedder();
  let changed = 0;

  /*
   * --force re-embeds findings that already have a topic key. Needed after an
   * embedding-model change: vectors are model-specific and dimensions differ
   * (embeddinggemma 768 vs nemotron 2048). `cosine` returns -1 on a dimension
   * mismatch, so a stale finding does not corrupt recall — it silently drops
   * out of it, which is quieter and just as bad. Re-embed everything.
   */
  const force = process.argv.includes("--force");

  for (const finding of findings) {
    if (finding.topicKey && !force) continue; // already re-keyed
    const topicKey = rebuildTopicKey(finding);
    console.log(`\n${finding.id.slice(0, 8)}  ${finding.corpusId}`);
    console.log(`  was keyed on: ${finding.verdict.slice(0, 88)}...`);
    console.log(`  now keyed on: ${topicKey.replace(/\n/g, " | ").slice(0, 88)}...`);
    if (APPLY) {
      finding.topicKey = topicKey;
      const vector = await embedder.embed(topicKey);
      finding.embedding = Array.from(vector);
      console.log(`  embedded: ${vector.length} dimensions`);
    }
    changed++;
  }

  if (!APPLY) {
    console.log(`\n${changed} finding(s) would be re-keyed. Re-run with --apply.`);
    return;
  }
  if (changed === 0) {
    console.log("\nNothing to do — every finding already has a topic key.");
    return;
  }

  await copyFile(INDEX_PATH, `${INDEX_PATH}.bak`);
  await writeFile(INDEX_PATH, JSON.stringify(raw, null, 2), "utf8");
  console.log(`\nRe-keyed ${changed} finding(s). Backup at ${INDEX_PATH}.bak`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
