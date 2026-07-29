import { describe, expect, it } from "vitest";
import { assessToolBudget } from "./tool-budget.js";

describe("tool request-budget admission", () => {
  it("defers claim extraction when the enclosing request cannot fund it", () => {
    expect(
      assessToolBudget("extract_and_verify_claims", 84_000, {
        extractionMinimumMs: 8 * 60_000,
      }),
    ).toEqual({
      allowed: false,
      status: "deferred-insufficient-request-budget",
      remainingMs: 84_000,
      requiredMs: 480_000,
      message:
        "extract_and_verify_claims deferred: 84s remain in this request; at least 480s are required. Start a new request to continue verification from the persisted engine state.",
    });
  });

  it("admits ordinary tools and adequately funded extraction", () => {
    expect(
      assessToolBudget("extract_and_verify_claims", 600_000, {
        extractionMinimumMs: 480_000,
      }).allowed,
    ).toBe(true);
    expect(
      assessToolBudget("get_agem_state", 1_000, {
        extractionMinimumMs: 480_000,
      }).allowed,
    ).toBe(true);
  });

  it("uses a measured extraction duration plus a final-response reserve for retries", () => {
    expect(
      assessToolBudget("extract_and_verify_claims", 194_293, {
        extractionMinimumMs: 480_000,
        previousDurationMs: 121_000,
        finalizationReserveMs: 30_000,
      }),
    ).toMatchObject({
      allowed: true,
      requiredMs: 181_250,
    });
  });
});
