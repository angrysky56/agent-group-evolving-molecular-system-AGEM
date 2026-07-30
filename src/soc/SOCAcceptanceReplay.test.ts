import { describe, expect, it } from "vitest";
import { SOCTracker } from "./SOCTracker.js";
import type { SOCInputs, SOCMetrics } from "./interfaces.js";

function savedInput(iteration: number): SOCInputs {
  const nodeCount = iteration + 3;
  const edges = Array.from({ length: nodeCount - 1 }, (_, source) => ({
    source,
    target: source + 1,
    weight: 1,
  }));
  const embeddings = new Map<string, Float64Array>();
  const communityAssignments = new Map<string, number>();
  for (let index = 0; index < nodeCount; index++) {
    const vector = new Float64Array(4);
    vector[index % vector.length] = 1;
    embeddings.set(String(index), vector);
    communityAssignments.set(String(index), index < nodeCount / 2 ? 0 : 1);
  }
  return {
    nodeCount,
    edges,
    embeddings,
    communityAssignments,
    newEdges: [
      {
        source: "0",
        target: String(nodeCount - 1),
        createdAtIteration: iteration,
        origin: "accepted-discovery",
      },
    ],
    iteration,
  };
}

function comparable(metrics: SOCMetrics) {
  const { timestamp: _timestamp, ...rest } = metrics;
  return rest;
}

describe("SOC Stage A deterministic acceptance replay", () => {
  it("runs 12 growing iterations with measurable discovery edges and exact resume", () => {
    const continuous = new SOCTracker({
      correlationWindowSize: 4,
    });
    const continuousMetrics = Array.from({ length: 12 }, (_, index) =>
      continuous.computeAndEmit(savedInput(index + 1)),
    );

    expect(continuousMetrics).toHaveLength(12);
    expect(
      continuousMetrics.every(
        (metrics) =>
          metrics.eligibleNewEdgeCount === 1 &&
          metrics.surprisingEdgeStatus === "measured" &&
          metrics.surprisingEdgeRatio !== null,
      ),
    ).toBe(true);
    for (let index = 1; index < 12; index++) {
      expect(savedInput(index + 1).nodeCount).toBeGreaterThan(
        savedInput(index).nodeCount,
      );
    }

    const firstHalf = new SOCTracker({
      correlationWindowSize: 4,
    });
    for (let iteration = 1; iteration <= 6; iteration++) {
      firstHalf.computeAndEmit(savedInput(iteration));
    }
    const checkpoint = firstHalf.snapshot();
    const resumed = new SOCTracker({
      correlationWindowSize: 4,
    });
    resumed.restore(checkpoint);
    const resumedTail: SOCMetrics[] = [];
    for (let iteration = 7; iteration <= 12; iteration++) {
      resumedTail.push(resumed.computeAndEmit(savedInput(iteration)));
    }

    expect(resumedTail.map(comparable)).toEqual(
      continuousMetrics.slice(6).map(comparable),
    );
    expect(resumed.snapshot().history.map(comparable)).toEqual(
      continuous.snapshot().history.map(comparable),
    );
  });
});
