/**
 * The boundary tests. These pin the separation between an evidential claim and
 * a logical verdict — the property the whole `evidential` method exists to
 * preserve. If one of these ever fails, the third path has become a way to
 * launder a defeasible claim into a verified one.
 */

import { describe, expect, it } from "vitest";
import { captureEvidentialFindingFromTool } from "./finding-capture.js";
import { createWorkflowContract } from "./workflow-contract.js";
import { PURE_TOOLS, sideEffectClass } from "./tool-dispatch.js";
import {
  isStructuralMismatch,
  typedVerificationFinalization,
} from "./run-termination.js";

const context = {
  runLogId: "run-1",
  producedByModel: "test-model",
  memoryNamespace: "ns-1",
};

const claimOutput = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    inferenceKind: "evidential",
    statement: "EVIDENTIAL (defeasible) — Typically, the evidence indicates that X.",
    scope: "typical",
    certainty: "indicates",
    cannotStand: false,
    grounds: [
      { id: "ev:aaa", finding: "f1", source: "doi:10.1000/a" },
      { id: "ev:bbb", finding: "f2", source: "doi:10.1000/b" },
    ],
    contradicting: [],
    dropped: [{ id: "ev:ccc", verdict: "opinion" }],
    strongestObjection: "the search may have been too narrow",
    calibration: { groundsStrength: 0.8, scopeDemand: 0.5 },
    disconfirmingSearch: {
      query: "what would show this is false?",
      searchedIn: ["segment:s1"],
      found: 0,
    },
    ...over,
  });

describe("evidential capture gate", () => {
  it("captures a calibrated claim as method 'evidential'", () => {
    const finding = captureEvidentialFindingFromTool(
      "build_defensible_claim",
      { corpusId: "corpus-1" },
      claimOutput(),
      context,
    );
    expect(finding?.method).toBe("evidential");
    expect(finding?.supportingClaims).toEqual(["ev:aaa", "ev:bbb"]);
  });

  it("never carries formal-verification receipts", () => {
    const finding = captureEvidentialFindingFromTool(
      "build_defensible_claim",
      {},
      claimOutput(),
      context,
    );
    expect(finding?.semanticsValidated).toBeUndefined();
    expect(finding?.attributionValidated).toBeUndefined();
    expect(finding?.semanticVerdictKind).toBeUndefined();
    expect(finding?.outcome).toBe("inconclusive");
  });

  it("always records the claim as defeasible in notRuledOut", () => {
    const finding = captureEvidentialFindingFromTool(
      "build_defensible_claim",
      {},
      claimOutput(),
      context,
    );
    expect(finding?.notRuledOut).toMatch(/Defeasible/);
    expect(finding?.verdict).toMatch(/EVIDENTIAL/);
  });

  it("refuses a claim the evidence cannot carry", () => {
    expect(
      captureEvidentialFindingFromTool(
        "build_defensible_claim",
        {},
        claimOutput({ cannotStand: true }),
        context,
      ),
    ).toBeNull();
  });

  it("refuses a claim with no disconfirming-search receipt", () => {
    expect(
      captureEvidentialFindingFromTool(
        "build_defensible_claim",
        {},
        claimOutput({
          disconfirmingSearch: { query: "", searchedIn: [], found: 0 },
        }),
        context,
      ),
    ).toBeNull();
  });

  it("refuses a claim with no surviving grounds", () => {
    expect(
      captureEvidentialFindingFromTool(
        "build_defensible_claim",
        {},
        claimOutput({ grounds: [] }),
        context,
      ),
    ).toBeNull();
  });

  it("ignores every other tool", () => {
    expect(
      captureEvidentialFindingFromTool(
        "extract_and_verify_claims",
        {},
        claimOutput(),
        context,
      ),
    ).toBeNull();
  });
});

describe("workflow contract boundary", () => {
  const contested = () =>
    createWorkflowContract({
      isContested: () => true,
      isClaimStoreAvailable: () => true,
      materialChars: 5000,
    });

  it("does not let an evidential claim satisfy verification", () => {
    const contract = contested();
    contract.record("run_agem_cycle");
    contract.record("get_graph_topology");
    contract.record("build_defensible_claim", undefined, {
      semanticsValidated: true,
    });
    const unmet = contract.evaluate().unmet.map((item) => item.id);
    expect(unmet).toContain("verify");
    expect(unmet).toContain("derive");
  });

  it("does not let an abduction satisfy verification", () => {
    const contract = contested();
    contract.record("run_agem_cycle");
    contract.record("get_graph_topology");
    contract.record("abduce_best_explanation", undefined, {
      semanticsValidated: true,
    });
    expect(contract.evaluate().unmet.map((item) => item.id)).toContain("verify");
  });

  it("still counts them as analysis, so the contract activates", () => {
    const contract = createWorkflowContract({
      isContested: () => true,
      isClaimStoreAvailable: () => true,
    });
    contract.record("abduce_best_explanation");
    expect(contract.summary().analysisRun).toBe(true);
  });
});

describe("structural mismatch vs defect", () => {
  // Reproduces the Peirce/Einstein run 2026-07-30T07-03-12: 7 unmappable
  // claims, 18 vocabulary rejections, no defects. The run mapped 746 concepts
  // into 14 communities, then reported only that verification had aborted.
  const peirceEinstein = [
    { code: "unmappable-claims", count: 7 },
    { code: "vocabulary-rejections", count: 18 },
  ];

  it("calls the Peirce/Einstein failure a mismatch of instrument", () => {
    expect(isStructuralMismatch(peirceEinstein)).toBe(true);
  });

  it("offers the evidential path on that failure", () => {
    const finalization = typedVerificationFinalization(
      JSON.stringify({
        preflightAborted: true,
        semanticsValidated: false,
        verdict: "INCONCLUSIVE EXTRACTION — 7 unmappable, 18 vocabulary rejections.",
        inconclusiveCauses: peirceEinstein,
      }),
    );
    expect(finalization?.evidentialPathOffered).toBe(true);
    expect(finalization?.instruction).toMatch(/You MAY call build_defensible_claim once/);
    // The guard it must NOT drop: no hand-authored logic, no retry of the
    // path that structurally cannot work.
    expect(finalization?.instruction).toMatch(/Do NOT call extract_and_verify_claims/);
    expect(finalization?.instruction).toMatch(/do NOT\nauthor logic by hand/);
  });

  it("does NOT offer it when a fixable defect is present", () => {
    // A parse failure means the typed path could have worked. Switching
    // instruments here would paper over a bug.
    expect(
      isStructuralMismatch([
        ...peirceEinstein,
        { code: "parse-failures", count: 1 },
      ]),
    ).toBe(false);
    const finalization = typedVerificationFinalization(
      JSON.stringify({
        preflightAborted: true,
        semanticsValidated: false,
        inconclusiveCauses: [
          { code: "unmappable-claims", count: 7 },
          { code: "schema-rejections", count: 2 },
        ],
      }),
    );
    expect(finalization?.evidentialPathOffered).toBe(false);
    expect(finalization?.instruction).toMatch(/Do not call or request more tools/);
  });

  it("does not offer it when no causes were reported at all", () => {
    expect(isStructuralMismatch([])).toBe(false);
  });

  it("still refuses to treat a validated verdict as a failure", () => {
    expect(
      typedVerificationFinalization(
        JSON.stringify({ semanticsValidated: true, inconclusiveCauses: peirceEinstein }),
      ),
    ).toBeNull();
  });
});

describe("dispatch classification", () => {
  it("treats abduction as pure — it stores nothing", () => {
    expect(PURE_TOOLS.has("abduce_best_explanation")).toBe(true);
    expect(sideEffectClass("abduce_best_explanation")).toBe("pure");
  });

  it("treats claim building as mutating — it writes a finding", () => {
    expect(sideEffectClass("build_defensible_claim")).toBe("mutating");
  });
});
