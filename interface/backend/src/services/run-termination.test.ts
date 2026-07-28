import { describe, expect, it } from "vitest";
import { finalizeRunOutcome } from "./run-termination.js";

describe("run termination", () => {
  it("never emits normal completion or a satisfied contract after timeout", () => {
    const outcome = finalizeRunOutcome("timed-out", {
      satisfied: true,
      items: [],
    });

    expect(outcome.emitDone).toBe(false);
    expect(outcome.contract).toMatchObject({
      satisfied: false,
      terminalStatus: "timed-out",
    });
  });
});
