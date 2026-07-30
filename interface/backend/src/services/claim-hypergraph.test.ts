import { describe, expect, it } from "vitest";
import { claimIdentity, type ExtractedClaim } from "./claim-extractor.js";
import {
  assertVerifierIncidence,
  diagnosticCliqueProjection,
  incidenceToTypedClaim,
  typedClaimToIncidence,
} from "./claim-hypergraph.js";

describe("typed claim incidence hypergraph", () => {
  const joint: ExtractedClaim = {
    kind: "joint-incompatibility",
    roles: {
      incompatible: [
        "locality",
        "hidden-variables",
        "measurement-independence",
      ],
    },
    scope: "corpus",
    modality: "metaphysical",
  };

  it("round-trips n-ary roles, metadata, stable identity, and provenance", () => {
    const graph = typedClaimToIncidence(joint, {
      segmentId: "bell-1",
      sourceSegmentId: "source-segment:bell",
    });
    const roundTrip = incidenceToTypedClaim(graph);

    expect(graph.incidences).toHaveLength(3);
    expect(new Set(graph.incidences.map(({ role }) => role))).toEqual(
      new Set(["incompatible"]),
    );
    expect(graph.claim.sourceSegmentId).toBe("source-segment:bell");
    expect(roundTrip).toEqual(joint);
    expect(claimIdentity(roundTrip, "bell-1")).toEqual({
      claimId: graph.claim.claimId,
      claimKey: graph.claim.claimKey,
    });
  });

  it("keeps identity independent of participant ordering", () => {
    const reversed = {
      ...joint,
      roles: {
        incompatible: [...(joint.roles.incompatible as string[])].reverse(),
      },
    };
    const first = typedClaimToIncidence(joint, { segmentId: "bell-1" });
    const second = typedClaimToIncidence(reversed, { segmentId: "bell-1" });

    expect(second.claim.claimKey).toBe(first.claim.claimKey);
    expect(second.claim.claimId).toBe(first.claim.claimId);
    expect(incidenceToTypedClaim(second).roles.incompatible).toEqual(
      reversed.roles.incompatible,
    );
  });

  it("represents binary claims through the same incidence contract", () => {
    const binary: ExtractedClaim = {
      kind: "exclusion",
      roles: { excluder: "phi", excluded: "broadcast" },
      scope: "position",
      positionId: "iit",
    };
    const graph = typedClaimToIncidence(binary, { segmentId: "tom-1" });

    expect(graph.incidences.map(({ role }) => role).sort()).toEqual([
      "excluded",
      "excluder",
    ]);
    expect(incidenceToTypedClaim(graph)).toEqual(binary);
  });

  it("marks clique expansion diagnostic-only and rejects it as verifier input", () => {
    const projection = diagnosticCliqueProjection(
      typedClaimToIncidence(joint, { segmentId: "bell-1" }),
    );

    expect(projection).toMatchObject({
      representation: "diagnostic-clique-projection",
      verifierInput: false,
    });
    expect(projection.edges).toHaveLength(3);
    expect(() => assertVerifierIncidence(projection)).toThrow(
      /not valid verification input/i,
    );
  });
});
