import { describe, it, expect } from "vitest";
import { SOCTracker } from "./SOCTracker.js";
import { SOCInputs } from "./interfaces.js";

describe("SOCTracker Snapshot & Rehydration", () => {
  it("should snapshot and restore its complete state verbatim", () => {
    const tracker = new SOCTracker({ correlationWindowSize: 3 });

    // Generate mock inputs to advance SOCTracker state
    const emb1 = new Float64Array([1.0, 0.0]);
    const emb2 = new Float64Array([0.0, 1.0]);
    const embeddings = new Map<string, Float64Array>([
      ["a", emb1],
      ["b", emb2],
    ]);

    const inputs1: SOCInputs = {
      nodeCount: 2,
      edges: [{ source: 0, target: 1, weight: 1.5 }],
      embeddings,
      communityAssignments: new Map([["a", 0], ["b", 1]]),
      newEdges: [{ source: "a", target: "b", createdAtIteration: 1 }],
      iteration: 1,
    };

    tracker.computeAndEmit(inputs1);

    const snapshot = tracker.snapshot();
    expect(snapshot.history.length).toBe(1);
    expect(snapshot.previousVNE).not.toBeNull();

    const restoredTracker = new SOCTracker({ correlationWindowSize: 3 });
    restoredTracker.restore(snapshot);

    const restoredSnapshot = restoredTracker.snapshot();
    expect(restoredSnapshot.history.length).toBe(1);
    expect(restoredSnapshot.previousVNE).toBe(snapshot.previousVNE);
    expect(restoredSnapshot.previousEE).toBe(snapshot.previousEE);
    expect(restoredTracker.getCurrentRegime()).toBe(tracker.getCurrentRegime());
  });
});
