/**
 * price-ablation.bench.ts — does Pólya reinforcement actually do anything?
 *
 * The Price/Pólya loop produces numbers. That is not the same as it having an
 * effect. This is the ablation that tells them apart: identical corpus,
 * identical seed, identical everything except the learning rate α, run headless
 * with no LLM anywhere in the loop so it is fast and exactly repeatable.
 *
 *   α = 0        control — reinforcement mathematically disabled
 *   α = default  the shipped configuration
 *   α = 10×      exaggerated, to show the mechanism is wired at all
 *
 * If the arms do not separate, the loop is decorative and the honest move is to
 * say so in the README rather than list it as a capability.
 *
 * What is measured each cycle:
 *   fitnessDensity — fraction of edges carrying non-zero fitness. If this is
 *                    ~0 the reinforcement has nothing to act on, and every
 *                    other number is noise. This is the first thing to read.
 *   gini           — inequality of the edge-weight distribution. Pólya
 *                    reinforcement is a rich-get-richer process, so if it is
 *                    working the α>0 arms should concentrate weight faster
 *                    than the control.
 *   selection      — Cov(w,z)/w̄, the Price selection term.
 *   transmission   — E(wΔz)/w̄.
 *
 * Run: npx tsx benchmarks/price-ablation.bench.ts
 */

import { Preprocessor } from "../src/tna/Preprocessor.js";
import { CooccurrenceGraph } from "../src/tna/CooccurrenceGraph.js";
import { LouvainDetector } from "../src/tna/LouvainDetector.js";
import { SOCTracker } from "../src/soc/SOCTracker.js";
import { PriceEvolver } from "../src/evolution/PriceEvolver.js";
import { DEFAULT_PRICE_CONFIG } from "../src/evolution/interfaces.js";
import type { SOCInputs } from "../src/soc/interfaces.js";

/** Deterministic pseudo-embedding — no network, identical across arms. */
function embed(token: string, dim = 32): Float64Array {
  const v = new Float64Array(dim);
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (let i = 0; i < dim; i++) {
    h = Math.imul(h ^ (i + 1), 16777619) >>> 0;
    v[i] = ((h % 2000) / 1000 - 1) * 0.5;
  }
  return v;
}

/** Six cycles of material with overlapping but drifting vocabulary. */
function corpusStages(): string[] {
  const themes = [
    "capability transfers across benchmark distributions because representation is general not indexed to the training sample",
    "preference training fits a policy to annotator comparisons so the disposition installed is bound to that collection distribution",
    "evaluation coverage red teaming held out families and pre registered thresholds make measurement predict deployment",
    "superposition packs many features into overlapping directions so individual neurons are polysemantic and hard to read",
    "reconciliation argues the vocabularies converge because competence and disposition share one representational substrate",
    "criticality tracks whether structural entropy still develops or the embedding entropy has already settled prematurely",
  ];
  return themes.map(
    (t, i) =>
      `${t}. ${t.split(" ").reverse().join(" ")}. stage ${"abcdef"[i]} elaborates the same material with additional connective phrasing and measured relation.`,
  );
}

/** Gini coefficient of a non-negative distribution. 0 = flat, →1 = concentrated. */
function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * xs[i];
  return (2 * cum) / (n * total) - (n + 1) / n;
}

/** Connected-component count — the same quantity H⁰ reports. */
function componentCount(
  graph: ReturnType<CooccurrenceGraph["getGraph"]>,
): number {
  const seen = new Set<string>();
  let components = 0;
  graph.forEachNode((start: string) => {
    if (seen.has(start)) return;
    components++;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      graph.forEachNeighbor(cur, (nb: string) => {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      });
    }
  });
  return components;
}

interface CycleRecord {
  iteration: number;
  edges: number;
  fitnessDensity: number;
  gini: number;
  selection: number;
  transmission: number;
}

function runArm(alpha: number): CycleRecord[] {
  const preprocessor = new Preprocessor({ minTfidfWeight: 0.0 });
  const graph = new CooccurrenceGraph(preprocessor);
  const louvain = new LouvainDetector(graph);
  const soc = new SOCTracker();
  const evolver = new PriceEvolver(graph.getGraph(), {
    ...DEFAULT_PRICE_CONFIG,
    baseLearningRate: alpha,
    // Hold the regime multipliers at 1 so the arms differ ONLY by alpha.
    nascentMultiplier: 1,
    stableMultiplier: 1,
    criticalMultiplier: 1,
  });

  const records: CycleRecord[] = [];
  const embeddings = new Map<string, Float64Array>();
  let previousComponents: number | null = null;

  corpusStages().forEach((text, idx) => {
    const iteration = idx + 1;
    evolver.beginIteration(iteration);
    graph.ingest(text, iteration);

    const g = graph.getGraph();
    if (g.order === 0) return;
    const communities = louvain.detect(42);

    for (const node of g.nodes()) {
      if (!embeddings.has(node)) embeddings.set(node, embed(node));
    }

    const idxOf = new Map<string, number>();
    g.nodes().forEach((n: string, i: number) => idxOf.set(n, i));
    const edges: Array<{ source: number; target: number; weight: number }> = [];
    const newEdges: Array<{
      source: string;
      target: string;
      createdAtIteration: number;
    }> = [];
    g.forEachEdge((_e: string, attrs: any, s: string, t: string) => {
      edges.push({
        source: idxOf.get(s) as number,
        target: idxOf.get(t) as number,
        weight: attrs?.weight ?? 1,
      });
      if (attrs?.createdAtIteration === iteration) {
        newEdges.push({ source: s, target: t, createdAtIteration: iteration });
      }
    });

    const inputs: SOCInputs = {
      nodeCount: g.order,
      edges,
      embeddings,
      communityAssignments: new Map(communities.assignments),
      newEdges,
      iteration,
    };
    const metrics = soc.computeAndEmit(inputs);

    // Drive the evolver exactly as the orchestrator does.
    evolver.onRegimeChange("nascent");
    evolver.onSOCMetrics(metrics.cdp);
    const components = componentCount(g);
    evolver.onFragmentationUpdate(components);
    previousComponents = components;

    const fitnesses = evolver.getCurrentFitnesses();
    const nonZero = fitnesses.filter((f) => f.fitness !== 0).length;

    const decomp = evolver.evolve(iteration);

    // Gini is measured on SALIENCE — the attribute reinforcement actually
    // writes. Edge `weight` is evidence and the evolver no longer touches it,
    // so measuring weight here would show every arm as identical by design.
    const weights: number[] = [];
    g.forEachEdge((_e: string, attrs: any) => weights.push(attrs?.salience ?? 1));

    records.push({
      iteration,
      edges: weights.length,
      fitnessDensity: weights.length > 0 ? nonZero / weights.length : 0,
      gini: gini(weights),
      selection: decomp.selection,
      transmission: decomp.transmission,
    });
  });

  void previousComponents;
  return records;
}

function main(): void {
  const arms: Array<[string, number]> = [
    ["alpha=0 (control)", 0],
    [`alpha=${DEFAULT_PRICE_CONFIG.baseLearningRate} (default)`, DEFAULT_PRICE_CONFIG.baseLearningRate],
    [`alpha=${DEFAULT_PRICE_CONFIG.baseLearningRate * 10} (10x)`, DEFAULT_PRICE_CONFIG.baseLearningRate * 10],
  ];

  const results = new Map<string, CycleRecord[]>();
  for (const [label, alpha] of arms) results.set(label, runArm(alpha));

  console.log(
    "\narm".padEnd(26) +
      ["it", "edges", "fitDens", "gini", "selection", "transmis"]
        .map((s) => s.padStart(11))
        .join(""),
  );
  for (const [label, recs] of results) {
    for (const r of recs) {
      console.log(
        label.padEnd(26) +
          [
            String(r.iteration),
            String(r.edges),
            r.fitnessDensity.toFixed(3),
            r.gini.toFixed(5),
            r.selection.toFixed(5),
            r.transmission.toFixed(5),
          ]
            .map((s) => s.padStart(11))
            .join(""),
      );
    }
  }

  // The question the whole file exists to answer.
  const control = results.get(arms[0][0]) as CycleRecord[];
  const dflt = results.get(arms[1][0]) as CycleRecord[];
  const strong = results.get(arms[2][0]) as CycleRecord[];
  const last = (r: CycleRecord[]) => r[r.length - 1];

  const dDefault = Math.abs(last(dflt).gini - last(control).gini);
  const dStrong = Math.abs(last(strong).gini - last(control).gini);
  const meanDensity =
    dflt.reduce((s, r) => s + r.fitnessDensity, 0) / Math.max(1, dflt.length);

  console.log(
    `\nmean fitness density (default arm): ${(meanDensity * 100).toFixed(1)}% of edges carry fitness`,
  );
  console.log(
    `final-cycle Gini divergence from control:  default=${dDefault.toExponential(2)}  10x=${dStrong.toExponential(2)}`,
  );
  const concentrates =
    last(strong).gini > last(control).gini && last(dflt).gini >= last(control).gini;

  console.log(
    dStrong <= 1e-6
      ? "VERDICT: arms did NOT separate — reinforcement is not doing anything. Do not claim it as a capability."
      : concentrates
        ? "VERDICT: reinforcement CONCENTRATES salience with alpha — the rich-get-richer dynamic the design calls for."
        : "VERDICT: arms separate but salience FLATTENS as alpha rises — the mechanism is wired backwards from the stated theory.",
  );
  console.log(
    "note: Gini is measured on salience (policy). Edge weight (evidence) is untouched by design.",
  );
}

main();
