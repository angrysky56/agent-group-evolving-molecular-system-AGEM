import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("decision-theory regression corpus", () => {
  it("registers the two actual minimal desiderata conflicts instead of an arity-four MUS", () => {
    const expected = JSON.parse(
      readFileSync("corpora/decision-theory/expected-mus.json", "utf8"),
    ) as {
      mustFind: Array<{ id: string; arity: number }>;
    };

    expect(expected.mustFind).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "dominance_newcomb_incompatibility",
          arity: 2,
        }),
        expect.objectContaining({
          id: "evidential_lesion_incompatibility",
          arity: 2,
        }),
      ]),
    );
    expect(
      expected.mustFind.find((target) => target.id === "newcomb_lesion_tension"),
    ).toBeUndefined();
  });
});
