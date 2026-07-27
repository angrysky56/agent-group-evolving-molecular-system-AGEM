/**
 * graphIntegrity.test.ts
 *
 * Pins two properties the co-occurrence graph must have for anything computed
 * downstream (communities, modularity, cohomology, block proposal) to mean
 * something. Both were observed to fail in live runs:
 *
 *   1. IDEMPOTENCE — re-ingesting material the graph has already seen must not
 *      change its structure. Observed live: three ingests of identical corpus
 *      material moved the graph 1010 -> 1036 -> 1074 nodes and the community
 *      count 13 -> 14 -> 11. Louvain is seeded (42) everywhere, so the
 *      instability is the GRAPH changing, not the clustering.
 *
 *   2. SEGMENT ISOLATION — the sliding window must not span a boundary between
 *      two unrelated pieces of text. A window that runs off the end of one
 *      proposition and into the start of the next manufactures co-occurrence
 *      edges that assert a relationship nothing in the source claims.
 *
 * These are written as characterization tests: they document current behaviour
 * with `expect`s that state what SHOULD hold, so a fix flips them green.
 */

import { describe, it, expect } from "vitest";
import { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import { Preprocessor } from "./Preprocessor.js";

/** Two propositions with NO shared vocabulary — any edge between them is spurious. */
const PROP_A =
  "Phenomenal consciousness concerns subjective experience and qualitative feeling.";
const PROP_B =
  "Multiple realizability entails divergent substrate implementing identical roles.";

function freshGraph(): CooccurrenceGraph {
  return new CooccurrenceGraph(new Preprocessor({ minTfidfWeight: 0.0 }));
}

function snapshot(g: CooccurrenceGraph) {
  const graph = g.getGraph();
  const weights: Record<string, number> = {};
  graph.forEachEdge((_e, attrs, s, t) => {
    const [a, b] = s < t ? [s, t] : [t, s];
    weights[`${a}|${b}`] = attrs.weight as number;
  });
  return { order: g.order, size: g.size, weights };
}

describe("co-occurrence graph integrity", () => {
  it("is idempotent: re-ingesting identical text does not change the graph", () => {
    const once = freshGraph();
    once.ingest(PROP_A, 1);
    const afterFirst = snapshot(once);

    once.ingest(PROP_A, 2); // same text, again
    const afterSecond = snapshot(once);

    expect(afterSecond.order).toBe(afterFirst.order);
    expect(afterSecond.size).toBe(afterFirst.size);
    expect(afterSecond.weights).toEqual(afterFirst.weights);
  });

  it("does not create edges across a boundary between unrelated segments", () => {
    // Ingested separately, these two propositions share no vocabulary, so the
    // graph must contain no edge joining them.
    const separate = freshGraph();
    separate.ingest(PROP_A, 1);
    separate.ingest(PROP_B, 1);
    const separateEdges = new Set(Object.keys(snapshot(separate).weights));

    // Ingested as one blob — the ONLY difference is that a window can now span
    // the join. Any additional edge is an artifact of concatenation.
    const joined = freshGraph();
    joined.ingest(`${PROP_A}\n\n${PROP_B}`, 1);
    const joinedEdges = new Set(Object.keys(snapshot(joined).weights));

    const fabricated = [...joinedEdges].filter((e) => !separateEdges.has(e));
    expect(fabricated).toEqual([]);
  });

  it("does not let a later weak mention overwrite a stronger earlier one", () => {
    // Was last-write-wins, so a node's weight became whatever the most recent
    // batch said. Segment-wise ingestion makes "most recent" mean "final
    // sentence of the document", which is meaningless — so keep the max.
    const g = freshGraph();
    g.ingest("Consciousness consciousness consciousness dominates here.", 1);
    const strong = g.getNode("consciousness")!.tfidfWeight;

    g.ingest("Consciousness appears once among many other unrelated terms.", 2);
    const after = g.getNode("consciousness")!.tfidfWeight;

    expect(strong).toBeGreaterThan(0);
    expect(after).toBeGreaterThanOrEqual(strong);
  });

  /*
   * Function words co-occur with everything, so as graph nodes they become
   * universal bridges and get read as central concepts. A real run produced a
   * most-bridged community labelled "different · not · accompany", from which
   * an analysis concluded "the act of distinguishing is the most structurally
   * central concept in the corpus" — a hub of negation and possessives.
   */
  it("keeps closed-class function words out of the graph", () => {
    const g = freshGraph();
    g.ingest(
      "It is not different without its own others and their several such more claims.",
      1,
    );
    const nodes = g.getNodes().map((n) => n.lemma);
    for (const fw of [
      "not", "its", "own", "other", "others", "without",
      "their", "several", "such", "more",
    ]) {
      expect(nodes).not.toContain(fw);
    }
  });

  it("keeps domain terms that merely look generic", () => {
    // The filter is closed-class only. "kind", "state", "question", "theory"
    // are technical vocabulary here ("mental kinds", "mental states") and
    // dropping them for being generic would destroy real signal.
    const g = freshGraph();
    g.ingest("Mental kinds and mental states raise the question for any theory.", 1);
    const nodes = g.getNodes().map((n) => n.lemma);
    for (const term of ["kind", "state", "question", "theory"]) {
      expect(nodes).toContain(term);
    }
  });

  it("still ingests genuinely new material after skipping a repeat", () => {
    // Idempotence must not degrade into "ignores everything after the first
    // call" — the dedup is per segment, not per ingest.
    const g = freshGraph();
    g.ingest(PROP_A, 1);
    const afterA = snapshot(g);

    g.ingest(`${PROP_A}\n\n${PROP_B}`, 2); // one repeat + one new segment
    const afterB = snapshot(g);

    expect(afterB.order).toBeGreaterThan(afterA.order);
    // ...and the repeated segment contributed nothing extra on top.
    const fresh = freshGraph();
    fresh.ingest(PROP_A, 1);
    fresh.ingest(PROP_B, 1);
    expect(afterB.weights).toEqual(snapshot(fresh).weights);
  });
});
