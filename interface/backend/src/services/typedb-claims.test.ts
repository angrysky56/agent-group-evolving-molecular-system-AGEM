import { describe, expect, it } from "vitest";
import { parseStoredJointIncompatibility } from "./typedb-claims.js";

describe("TypeDB n-ary claim retrieval", () => {
  it("reassembles role rows without losing cardinality or order identity", () => {
    const parsed = parseStoredJointIncompatibility(
      {
        ok: {
          answerType: "conceptDocuments",
          answers: [
            {
              claimId: "claim-1",
              claimKey: "key-1",
              scope: "corpus",
              member: "realism",
              sourceSegmentId: "bell-1",
            },
            {
              claimId: "claim-1",
              claimKey: "key-1",
              scope: "corpus",
              member: "locality",
              sourceSegmentId: "bell-1",
            },
            {
              claimId: "claim-1",
              claimKey: "key-1",
              scope: "corpus",
              member: "measurement-independence",
              sourceSegmentId: "bell-1",
            },
          ],
        },
      } as any,
      "claim-1",
    );
    expect(parsed).toEqual({
      claimId: "claim-1",
      claimKey: "key-1",
      scope: "corpus",
      incompatible: ["locality", "measurement-independence", "realism"],
      sourceSegmentIds: ["bell-1"],
    });
  });

  it("fails closed on partial or inconsistent read rows", () => {
    expect(
      parseStoredJointIncompatibility(
        {
          ok: {
            answerType: "conceptDocuments",
            answers: [
              {
                claimId: "claim-1",
                claimKey: "key-1",
                scope: "corpus",
                member: "only-one",
                sourceSegmentId: "segment-1",
              },
            ],
          },
        } as any,
        "claim-1",
      ),
    ).toBeNull();
  });
});
