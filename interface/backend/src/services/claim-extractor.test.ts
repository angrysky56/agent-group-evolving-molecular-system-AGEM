import { describe, expect, it } from "vitest";
import {
  canonicalClaim,
  claimIdentity,
  claimToTypeQL,
  schemaClaimFact,
  type ExtractedClaim,
} from "./claim-extractor.js";
import { SCHEMA_RELATIVE_PATHS } from "./typedb-claims.js";

describe("claim identity for finding evidence", () => {
  const claim: ExtractedClaim = {
    kind: "distinction",
    roles: { distinguished: ["b", "a"] } as any,
    differenceKind: "in-kind",
  };

  it("is stable across role ordering while occurrence ids retain provenance", () => {
    const reordered: ExtractedClaim = {
      ...claim,
      roles: { distinguished: ["a", "b"] } as any,
    };
    expect(canonicalClaim(claim)).toBe(canonicalClaim(reordered));
    expect(claimIdentity(claim, "segment-1").claimKey).toBe(
      claimIdentity(reordered, "segment-2").claimKey,
    );
    expect(claimIdentity(claim, "segment-1").claimId).not.toBe(
      claimIdentity(claim, "segment-2").claimId,
    );
  });

  it("writes both structural and concrete ids onto claim relations", () => {
    const query = claimToTypeQL(claim, "segment-1");
    expect(query?.claim).toContain(`has claim-key "${query?.claimKey}"`);
    expect(query?.claim).toContain(`has claim-id "${query?.claimId}"`);
  });

  it("turns required roles and semantic signs into a compact fidelity fact", () => {
    expect(
      schemaClaimFact({
        kind: "causal-claim",
        roles: { cause: "experience", effect: "report" },
        modality: "functional",
        polarity: "denies",
      }),
    ).toBe(
      'causal-claim(cause="experience",effect="report",modality="functional",polarity="denies")',
    );
    expect(
      schemaClaimFact({
        kind: "causal-claim",
        roles: { cause: "experience", effect: "report" },
      }),
    ).toBeNull();
    expect(
      schemaClaimFact({
        kind: "distinction",
        roles: { distinguished: ["same", "same"] },
      }),
    ).toBeNull();
  });

  it("loads the claim schema before the finding schema", () => {
    expect(SCHEMA_RELATIVE_PATHS.map((path) => path.replace(/\\/g, "/"))).toEqual([
      "schema/claims.tql",
      "schema/findings.tql",
    ]);
  });
});
