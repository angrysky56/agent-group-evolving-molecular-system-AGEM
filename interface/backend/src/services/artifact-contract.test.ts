import { describe, expect, it } from "vitest";
import {
  annotateArtifactOutput,
  normalizeRunIntent,
  toolNamesForRunIntent,
} from "./artifact-contract.js";

describe("artifact contract", () => {
  it("defaults unknown intent to the combined workflow", () => {
    expect(normalizeRunIntent(undefined)).toBe("discover-then-verify");
    expect(normalizeRunIntent("other")).toBe("discover-then-verify");
  });

  it("keeps discovery and verification tool surfaces separate", () => {
    expect(toolNamesForRunIntent("discover")?.has("detect_gaps")).toBe(true);
    expect(
      toolNamesForRunIntent("discover")?.has("evaluate_logical_consistency"),
    ).toBe(false);
    expect(toolNamesForRunIntent("verify")?.has("detect_gaps")).toBe(false);
    expect(
      toolNamesForRunIntent("verify")?.has("extract_and_verify_claims"),
    ).toBe(true);
    expect(toolNamesForRunIntent("discover-then-verify")).toBeNull();
  });

  it("labels gap output as a proposal without a certificate", () => {
    expect(
      JSON.parse(annotateArtifactOutput("detect_gaps", '{"gaps":[]}', "discover")),
    ).toMatchObject({
      runIntent: "discover",
      artifactStatus: "discovery-candidate",
      evidenceScope: "discovery-diagnostic",
      formalCertificateExists: false,
      discoveryProposal: true,
      coverage: "not-applicable",
      unmappableCount: null,
      artifactProvenance: {
        producer: "detect_gaps",
        validationStatus: "propose-only",
      },
    });
  });

  it("labels every member of list-valued discovery output", () => {
    const parsed = JSON.parse(
      annotateArtifactOutput(
        "generate_catalyst_questions",
        '[{"gap_id":"0_1"},{"gap_id":"1_2"}]',
        "discover",
      ),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      runIntent: "discover",
      artifactStatus: "discovery-candidate",
      artifactProvenance: {
        sourceReferences: ["0_1"],
        validationStatus: "propose-only",
      },
    });
  });

  it("only promotes typed output when semantics were validated", () => {
    expect(
      JSON.parse(
        annotateArtifactOutput(
          "extract_and_verify_claims",
          '{"semanticsValidated":false}',
          "verify",
        ),
      ).artifactStatus,
    ).toBe("typed-claim");
    expect(
      JSON.parse(
        annotateArtifactOutput(
          "extract_and_verify_claims",
          '{"semanticsValidated":true}',
          "verify",
        ),
      ),
    ).toMatchObject({
      artifactStatus: "verified-finding",
      formalCertificateExists: true,
      discoveryProposal: false,
    });
  });

  it("does not annotate unrelated or non-JSON output", () => {
    expect(annotateArtifactOutput("read_skill", "plain", "discover")).toBe("plain");
  });
});
