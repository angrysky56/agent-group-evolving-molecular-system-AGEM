import { describe, expect, it } from "vitest";
import { CentralityAnalyzer } from "./CentralityAnalyzer.js";
import { CooccurrenceGraph } from "./CooccurrenceGraph.js";
import { Preprocessor } from "./Preprocessor.js";

describe("centrality calculation revision", () => {
  it("identifies stale scores after topology mutation and refreshes on compute", () => {
    const graph = new CooccurrenceGraph(new Preprocessor());
    graph.ingestTokens(["alpha", "beta", "gamma"], 1);
    const centrality = new CentralityAnalyzer(graph);
    centrality.compute();
    expect(centrality.getCalculationRevision()).toBe(
      graph.getTopologyRevision(),
    );

    graph.getGraph().addNode("delta");
    expect(centrality.getCalculationRevision()).not.toBe(
      graph.getTopologyRevision(),
    );

    centrality.compute();
    expect(centrality.getCalculationRevision()).toBe(
      graph.getTopologyRevision(),
    );
  });
});
