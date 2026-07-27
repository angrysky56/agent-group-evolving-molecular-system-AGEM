/**
 * measure-segmentation-impact.ts
 *
 * Quantifies, on real corpus files, how many co-occurrence edges the old
 * whole-blob sliding window fabricated by spanning sentence boundaries.
 *
 * "Old" is reproduced by preprocessing the entire document as one token stream
 * and windowing across it (what ingest() used to do). "New" is the segmented
 * path. Any edge present only in "old" asserts a co-occurrence that does not
 * occur inside any single sentence of the source.
 *
 * Usage: npx tsx scripts/measure-segmentation-impact.ts <file.md> [...]
 */

import { readFileSync } from "node:fs";
import { CooccurrenceGraph, segmentText } from "../src/tna/CooccurrenceGraph.js";
import { Preprocessor } from "../src/tna/Preprocessor.js";

const WINDOW = 4;

/** Reproduce the pre-fix behaviour: one flat token stream, window spans all. */
function wholeBlobEdges(text: string): Set<string> {
  const tokens = new Preprocessor({ minTfidfWeight: 0.0 }).preprocessDetailed(
    text,
  ).tokens;
  const edges = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    for (let d = 1; d < WINDOW && i + d < tokens.length; d++) {
      const [a, b] = [tokens[i], tokens[i + d]].sort();
      if (a !== b) edges.add(`${a}|${b}`);
    }
  }
  return edges;
}

function segmentedEdges(text: string): Set<string> {
  const g = new CooccurrenceGraph(new Preprocessor({ minTfidfWeight: 0.0 }));
  g.ingest(text, 1);
  const edges = new Set<string>();
  g.getGraph().forEachEdge((_e, _a, s, t) => {
    const [a, b] = [s, t].sort();
    edges.add(`${a}|${b}`);
  });
  return edges;
}

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, "utf8");
  const segments = segmentText(text);
  const old = wholeBlobEdges(text);
  const now = segmentedEdges(text);
  const fabricated = [...old].filter((e) => !now.has(e));

  // Idempotence: ingest twice, confirm the second pass is a no-op.
  const g = new CooccurrenceGraph(new Preprocessor({ minTfidfWeight: 0.0 }));
  g.ingest(text, 1);
  const [n1, e1] = [g.order, g.size];
  g.ingest(text, 2);
  const [n2, e2] = [g.order, g.size];

  console.log(`\n=== ${file.split("/").pop()} ===`);
  console.log(`segments               : ${segments.length}`);
  console.log(`edges, whole-blob (old): ${old.size}`);
  console.log(`edges, segmented (new) : ${now.size}`);
  console.log(
    `boundary artifacts     : ${fabricated.length} ` +
      `(${((100 * fabricated.length) / Math.max(old.size, 1)).toFixed(1)}% of old graph)`,
  );
  console.log(
    `re-ingest identical    : ${n1}n/${e1}e -> ${n2}n/${e2}e ` +
      `${n1 === n2 && e1 === e2 ? "(stable)" : "(DRIFTED)"}`,
  );
  if (fabricated.length)
    console.log(`  examples: ${fabricated.slice(0, 6).join(", ")}`);

  /*
   * Top-degree nodes are what community detection organises around and what
   * gets reported as "the central concepts". If they are function words, any
   * structural claim built on them is about English, not the corpus.
   */
  const graph = g.getGraph();
  const degrees = graph
    .nodes()
    .map((n) => ({ n, d: graph.degree(n) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 12);
  console.log(`hubs (top degree)      : ${degrees.map((x) => `${x.n}(${x.d})`).join(" ")}`);
}
