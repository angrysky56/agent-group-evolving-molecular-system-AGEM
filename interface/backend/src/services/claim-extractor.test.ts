import { describe, expect, it } from "vitest";
import {
  canonicalClaim,
  buildClaimExtractionPrompt,
  claimIdentity,
  claimAttributionIssue,
  claimToTypeQL,
  extractIntoStore,
  schemaClaimFact,
  type ExtractedClaim,
} from "./claim-extractor.js";
import { SCHEMA_RELATIVE_PATHS } from "./typedb-claims.js";

describe("claim identity for finding evidence", () => {
  const claim: ExtractedClaim = {
    kind: "distinction",
    roles: { distinguished: ["b", "a"] } as any,
    scope: "corpus",
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

  it("keeps the attributed holder in structural and occurrence identity", () => {
    const hot: ExtractedClaim = {
      kind: "identity-claim",
      roles: { identified: "meta-state", "identified-with": "thought-like" },
      scope: "position",
      positionId: "HOT",
    };
    const hop: ExtractedClaim = { ...hot, positionId: "HOP" };

    expect(claimIdentity(hot, "segment-1").claimKey).not.toBe(
      claimIdentity(hop, "segment-1").claimKey,
    );
    expect(claimIdentity(hot, "segment-1").claimId).not.toBe(
      claimIdentity(hop, "segment-1").claimId,
    );
  });

  it("persists position attribution instead of flattening the claim", () => {
    const query = claimToTypeQL(
      {
        kind: "identity-claim",
        roles: { identified: "meta-state", "identified-with": "thought-like" },
        scope: "position",
        positionId: "HOT theorists",
      },
      "segment-1",
    );

    expect(query?.position).toContain('isa position, has label "HOT theorists"');
    expect(query?.claim).toContain('has claim-scope "position"');
    expect(query?.attribution).toContain("holder: $position");
    expect(query?.attribution).toContain("attributed-claim: $claim");
  });

  it("turns required roles and semantic signs into a compact fidelity fact", () => {
    expect(
      schemaClaimFact({
        kind: "causal-claim",
        roles: { cause: "experience", effect: "report" },
        scope: "corpus",
        modality: "functional",
        polarity: "denies",
      }),
    ).toBe(
      'causal-claim(cause="experience",effect="report",scope="corpus",modality="functional",polarity="denies")',
    );
    expect(
      schemaClaimFact({
        kind: "identity-claim",
        roles: { identified: "meta-state", "identified-with": "thought-like" },
        scope: "position",
        positionId: "HOT",
      }),
    ).toContain('positionId="HOT"');
    expect(
      schemaClaimFact({
        kind: "causal-claim",
        roles: { cause: "experience", effect: "report" },
        scope: "corpus",
      }),
    ).toBeNull();
    expect(
      schemaClaimFact({
        kind: "distinction",
        roles: { distinguished: ["same", "same"] },
        scope: "corpus",
      }),
    ).toBeNull();
  });

  it("loads the claim schema before the finding schema", () => {
    expect(SCHEMA_RELATIVE_PATHS.map((path) => path.replace(/\\/g, "/"))).toEqual([
      "schema/claims.tql",
      "schema/findings.tql",
    ]);
  });

  it("includes the running predicate glossary in later extraction prompts", () => {
    const prompt = buildClaimExtractionPrompt("Minds cause physical events.", [
      "mental-state",
      "causes-physical",
    ]);
    expect(prompt).toContain("RUNNING PREDICATE GLOSSARY");
    expect(prompt).toContain("mental-state");
    expect(prompt).toContain("Reuse a glossary label");
    expect(prompt).toContain('"scope":"position"');
    expect(prompt).toContain('"positionId":"HOT"');
    expect(prompt).toContain("Never flatten rival positions");
  });

  it("rejects attribution flattening in the exact HOT/HOP survey sentence", () => {
    const source =
      "HOT theorists identify a meta-state with a thought-like state, while HOP theorists identify it with a perception-like state; thought-like and perception-like states can come apart.";
    const flattened: ExtractedClaim = {
      kind: "identity-claim",
      roles: { identified: "meta-state", "identified-with": "thought-like" },
      scope: "corpus",
    };
    const attributed: ExtractedClaim = {
      ...flattened,
      scope: "position",
      positionId: "HOT",
    };
    const directDistinction: ExtractedClaim = {
      kind: "distinction",
      roles: { distinguished: ["thought-like", "perception-like"] },
      scope: "corpus",
    };

    expect(claimAttributionIssue(flattened, source)).toMatch(/flatten/i);
    expect(claimAttributionIssue(attributed, source)).toBeNull();
    expect(claimAttributionIssue(directDistinction, source)).toBeNull();
  });

  it("keeps a corpus-authored generic rule at corpus scope", () => {
    const source =
      "Combining: any theory that holds dominance is not Newcomb-adequate.";
    const rule: ExtractedClaim = {
      kind: "exclusion",
      roles: {
        excluder: "holds-dominance",
        excluded: "newcomb-adequate",
      },
      scope: "corpus",
    };

    expect(claimAttributionIssue(rule, source)).toBeNull();
  });
});

describe("claim extraction lifecycle", () => {
  it("refuses to begin when the request deadline is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("request deadline exceeded");
    controller.abort(reason);

    await expect(
      extractIntoStore([], "corpus", { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("reports proposal, persistence, and fallback telemetry", async () => {
    const report = await extractIntoStore([], "corpus");

    expect(report.telemetry).toMatchObject({
      proposalMs: 0,
      persistenceMs: 0,
      batchCalls: 0,
      fallbackBatches: 0,
      fallbackSegmentCalls: 0,
    });
    expect(report.telemetry.totalMs).toBeGreaterThanOrEqual(0);
  });
});
