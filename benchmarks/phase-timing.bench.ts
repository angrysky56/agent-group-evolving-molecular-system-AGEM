/**
 * phase-timing.bench.ts — how much wall-clock does runReasoning actually spend?
 *
 * Question being settled: `Orchestrator.runReasoning` is a linear 8-step chain.
 * Steps 6 (sheaf cohomology) and 7 (SOC metrics) both read the post-Louvain
 * graph and look like an independent fan-out worth parallelising.
 *
 * Parallelising them is NOT free: both steps emit events whose handlers mutate
 * orchestrator state, so overlapping them means auditing every handler for
 * write conflicts. That cost is only worth paying if the steps are expensive.
 *
 * So: measure first. Run with
 *   npx vitest bench src/orchestrator/phase-timing.bench.ts
 * or as a plain script via tsx.
 *
 * Interpretation guide: one LLM turn against a hosted model is 2000–20000 ms.
 * A phase costing single-digit milliseconds is invisible next to that, and
 * parallelising it buys nothing while adding a concurrency hazard.
 */

import { performance } from "node:perf_hooks";
import { Preprocessor } from "../src/tna/Preprocessor.js";
import { CooccurrenceGraph } from "../src/tna/CooccurrenceGraph.js";
import { LouvainDetector } from "../src/tna/LouvainDetector.js";
import { CohomologyAnalyzer } from "../src/sheaf/CohomologyAnalyzer.js";
import { buildFlatSheaf } from "../src/sheaf/helpers/flatSheafFactory.js";
import { SOCTracker } from "../src/soc/SOCTracker.js";
import type { SOCInputs } from "../src/soc/interfaces.js";

/**
 * Deterministic pseudo-corpus with clustered structure AND growing vocabulary.
 *
 * The vocabulary must grow with the corpus. A fixed word list saturates the
 * graph at a constant node count no matter how much text is ingested, which
 * hides exactly the scaling behaviour we are trying to measure — AGEM's graph
 * is persistent and accumulates across every cycle of a session.
 */
function makeCorpus(paragraphs: number): string {
  const themes = [
    "sheaf cohomology restriction global section obstruction topology",
    "entropy criticality avalanche regime transition scaling exponent",
    "molecular bonding orbital entanglement valence electron correlation",
    "agent orchestration scheduler dispatch recovery escalation protocol",
    "logic satisfiability prover counterexample consistency contradiction",
  ];
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    const a = themes[i % themes.length];
    const b = themes[(i * 3 + 1) % themes.length];
    // Distinct multi-character terms per paragraph so the vocabulary — and so
    // the node set — actually grows. Numerals are stripped by the
    // preprocessor's structural-artifact filter, so use letters.
    const tag = `term${numberToWord(i)}`;
    const tag2 = `notion${numberToWord(i * 7 + 3)}`;
    out.push(
      `${a} ${b} ${tag} ${tag2} connects the preceding notions through shared structure and measured relation with ${tag}.`,
    );
  }
  return out.join("\n\n");
}

/** Integer → alphabetic token, so the preprocessor does not strip it. */
function numberToWord(n: number): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  let v = n + 1;
  while (v > 0) {
    s = letters[(v - 1) % 26] + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

interface PhaseTiming {
  nodes: number;
  edges: number;
  preprocess: number;
  graph: number;
  louvain: number;
  sheaf: number;
  soc: number;
}

async function measure(paragraphs: number): Promise<PhaseTiming> {
  const text = makeCorpus(paragraphs);

  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  const louvain = new LouvainDetector(graph);
  const cohomology = new CohomologyAnalyzer();
  const soc = new SOCTracker();

  // Mirrors runReasoning steps 2-4.
  const t0 = performance.now();
  preprocessor.preprocess(text);
  const t1 = performance.now();

  graph.ingest(text, 1);
  const t2 = performance.now();

  const g = graph.getGraph();
  const communities = louvain.detect(42);
  const t3 = performance.now();

  // Step 6 analogue: cohomology over a sheaf sized to the community count.
  const communityCount = Math.max(2, communities.communityCount);
  const sheaf = buildFlatSheaf(communityCount, 1);
  cohomology.analyze(sheaf, 1);
  const t4 = performance.now();

  // Step 7 analogue: SOC over the same graph.
  const nodeList = g.nodes();
  const idx = new Map<string, number>();
  nodeList.forEach((n, i) => idx.set(n, i));
  const edges: Array<{ source: number; target: number; weight: number }> = [];
  g.forEachEdge((_e: unknown, attrs: any, s: string, t: string) => {
    const si = idx.get(s);
    const ti = idx.get(t);
    if (si !== undefined && ti !== undefined) {
      edges.push({ source: si, target: ti, weight: attrs?.weight ?? 1 });
    }
  });
  const embeddings = new Map<string, Float64Array>();
  for (const n of nodeList) {
    const v = new Float64Array(64);
    for (let i = 0; i < 64; i++) v[i] = Math.sin(n.length * (i + 1));
    embeddings.set(n, v);
  }
  const inputs: SOCInputs = {
    nodeCount: nodeList.length,
    edges,
    embeddings,
    communityAssignments: new Map(communities.assignments),
    newEdges: [],
    iteration: 1,
  };
  soc.computeAndEmit(inputs);
  const t5 = performance.now();

  return {
    nodes: nodeList.length,
    edges: edges.length,
    preprocess: t1 - t0,
    graph: t2 - t1,
    louvain: t3 - t2,
    sheaf: t4 - t3,
    soc: t5 - t4,
  };
}

async function main(): Promise<void> {
  console.log(
    "phase".padEnd(12),
    ["nodes", "edges", "prep", "graph", "louvain", "sheaf", "soc", "6+7"]
      .map((s) => s.padStart(9))
      .join(""),
  );
  for (const p of [20, 60, 150, 300, 600, 1000]) {
    // Warm once so JIT effects do not dominate the first sample.
    await measure(p);
    const r = await measure(p);
    const fan = r.sheaf + r.soc;
    console.log(
      `${p} paras`.padEnd(12),
      [
        String(r.nodes),
        String(r.edges),
        r.preprocess.toFixed(1),
        r.graph.toFixed(1),
        r.louvain.toFixed(1),
        r.sheaf.toFixed(1),
        r.soc.toFixed(1),
        fan.toFixed(1),
      ]
        .map((s) => s.padStart(9))
        .join(""),
    );
  }
  console.log(
    "\nAll times in ms. Compare 'sheaf' and 'soc' against a single LLM turn (2000–20000 ms).",
  );
  console.log(
    "Parallelising steps 6 and 7 can save at most min(sheaf, soc) per cycle.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
