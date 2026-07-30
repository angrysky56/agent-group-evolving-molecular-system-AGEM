import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claimIdentity,
  claimSourceSemanticIssue,
  claimToPropositions,
  sourceRequiresJointIncompatibility,
  type ExtractedClaim,
} from "./claim-extractor.js";

interface Fixture {
  segments: Array<{ id: string; source: string; incompatible: string[] }>;
}

const fixturePath = path.resolve(
  import.meta.dirname,
  "../../../../docs/logic-corpus/quantum-no-go-nary-KEY.json",
);

describe("six quantum no-go n-ary fixtures", () => {
  it("preserves each full set as one order-invariant claim", async () => {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    expect(fixture.segments).toHaveLength(6);

    for (const segment of fixture.segments) {
      const claim: ExtractedClaim = {
        kind: "joint-incompatibility",
        roles: { incompatible: segment.incompatible },
        scope: "corpus",
      };
      expect(sourceRequiresJointIncompatibility(segment.source)).toBe(true);
      expect(claimSourceSemanticIssue(claim, segment.source)).toBeNull();
      const formalized = claimToPropositions(claim);
      expect(formalized?.propositions).toHaveLength(1);
      expect(formalized?.propositions[0]).toContain("all x");
      expect(
        claimIdentity(
          { ...claim, roles: { incompatible: [...segment.incompatible].reverse() } },
          segment.id,
        ).claimKey,
      ).toBe(claimIdentity(claim, segment.id).claimKey);

      for (const wrongKind of ["exclusion", "property-assertion", "entailment"] as const) {
        const wrong: ExtractedClaim = {
          kind: wrongKind,
          roles:
            wrongKind === "exclusion"
              ? { excluder: segment.incompatible[0]!, excluded: segment.incompatible[1]! }
              : wrongKind === "property-assertion"
                ? { subject: segment.incompatible[0]!, property: segment.incompatible[1]! }
                : { antecedent: segment.incompatible[0]!, consequent: segment.incompatible[1]! },
          scope: "corpus",
          ...(wrongKind === "property-assertion" ? { polarity: "denies" as const } : {}),
        };
        expect(claimSourceSemanticIssue(wrong, segment.source)).toMatch(
          /joint incompatibility/i,
        );
      }
    }
  });
});
