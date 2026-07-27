/**
 * bench-embed-batch.ts — sequential vs batched embedding, against the live
 * configured provider.
 *
 * Measures the change rather than asserting it. A graph cycle embeds every
 * store entry, so this ratio is roughly the ratio of the cycle's embedding
 * cost before and after.
 *
 *   npx tsx scripts/bench-embed-batch.ts [count]
 */

import { ProviderEmbedder } from "../src/services/provider-embedder.js";
import { settings } from "../src/config.js";

const COUNT = Number(process.argv[2] ?? 40);

function corpus(n: number): string[] {
  const themes = [
    "codon assignment and amino acid identity",
    "stereochemical affinity between triplet and residue",
    "biosynthetic precursor and product relations",
    "error minimisation across random alternative codes",
    "frozen accident and the cost of altering the code",
  ];
  return Array.from(
    { length: n },
    (_, i) => `${themes[i % themes.length]} — segment ${i} of the corpus.`,
  );
}

async function main(): Promise<void> {
  const embedder = new ProviderEmbedder();
  const texts = corpus(COUNT);
  console.log(
    `provider: ${settings.all.EMBEDDING_PROVIDER} / ` +
      `${settings.all.OPENROUTER_EMBEDDING_MODEL}\ntexts: ${COUNT}\n`,
  );

  const t0 = Date.now();
  const sequential: number[] = [];
  for (const text of texts) sequential.push((await embedder.embed(text)).length);
  const seqMs = Date.now() - t0;

  const t1 = Date.now();
  const batched = await embedder.embedBatch(texts);
  const batchMs = Date.now() - t1;

  console.log(`sequential: ${seqMs.toLocaleString()} ms  (${(seqMs / COUNT).toFixed(0)} ms/text)`);
  console.log(`batched   : ${batchMs.toLocaleString()} ms  (${(batchMs / COUNT).toFixed(0)} ms/text)`);
  console.log(`speedup   : ${(seqMs / Math.max(batchMs, 1)).toFixed(1)}x`);

  // Correctness matters more than speed: same count, same dims, same order.
  const dimsOk = batched.every((v) => v.length === sequential[0]);
  console.log(`\ncount ok  : ${batched.length === COUNT}`);
  console.log(`dims ok   : ${dimsOk} (${sequential[0]})`);

  const first = await embedder.embed(texts[0]);
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < first.length; i++) {
    dot += first[i] * batched[0][i];
    a += first[i] * first[i];
    b += batched[0][i] * batched[0][i];
  }
  const same = dot / (Math.sqrt(a) * Math.sqrt(b));
  console.log(`order ok  : batched[0] vs embed(texts[0]) cosine = ${same.toFixed(4)}`);
  if (same < 0.99) {
    console.error("MISMATCH — batch is not returning results in input order.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
