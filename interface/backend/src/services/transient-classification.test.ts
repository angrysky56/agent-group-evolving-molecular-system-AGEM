/**
 * Run 2026-07-30 (QM interpretations): 16 sections ingested into a 296-node
 * graph, modularity 0.577, then the entire formal path lost to one provider
 * hiccup:
 *
 *   "OpenRouter stream error: Upstream error from Ambient: EngineCore
 *    encountered an issue."
 *
 * That classified as `structural` — do not retry, escalate now — which is the
 * exact opposite of what a relayed upstream failure warrants.
 */

import { describe, expect, it } from "vitest";
import { classifyError } from "./recovery-protocol.js";

describe("provider infrastructure failures are transient", () => {
  it.each([
    "OpenRouter stream error: Upstream error from Ambient: EngineCore encountered an issue.",
    "Upstream error from Ambient: EngineCore encountered an issue",
    "OpenRouter stream error",
    "provider error: model temporarily unavailable",
    "Unexpected end of JSON input",
    "connection closed",
  ])("retries %s", (message) => {
    expect(classifyError(new Error(message))).toBe("transient");
  });

  it("still recognises the classic transport shapes", () => {
    for (const message of ["503 Service Unavailable", "fetch failed", "ECONNRESET"]) {
      expect(classifyError(new Error(message))).toBe("transient");
    }
  });
});

describe("the widening did not swallow other classes", () => {
  it("keeps auth structural even when phrased as an upstream error", () => {
    // Auth is checked first by design; a credential cannot be repaired by
    // repeating the call, however the gateway words it.
    expect(
      classifyError(new Error("Upstream error: 401 invalid api key")),
    ).toBe("structural");
    expect(
      classifyError(new Error("stream error: authentication failed")),
    ).toBe("structural");
  });

  it("keeps genuine schema faults repairable, not retryable", () => {
    expect(
      classifyError(new Error("invalid_type: expected string but received number")),
    ).toBe("schema");
    expect(classifyError(new Error("missing required property 'name'"))).toBe(
      "schema",
    );
  });

  it("leaves an unrecognised failure structural, the conservative default", () => {
    expect(classifyError(new Error("the corpus contains no positions"))).toBe(
      "structural",
    );
  });

  it("does not reclassify a cancellation", () => {
    // Cancellation is marked with `scope === "request"`, not by error name —
    // checked before any pattern runs, so widening TRANSIENT_RE cannot capture
    // a deliberate abort.
    const aborted = Object.assign(new Error("The operation was aborted"), {
      scope: "request",
    });
    expect(classifyError(aborted)).toBe("cancelled");
  });
});
