import { describe, expect, it } from "vitest";
import {
  deriveClaimBlocks,
  mapSegmentsToPositions,
  type ClaimCommunity,
} from "./claim-blocks.js";
import type { ExtractionOutcome } from "./claim-extractor.js";
import type { IEmbedder } from "#agem/lcm/interfaces.js";

const accepted = (
  segmentId: string,
  claimKey: string,
  claim: ExtractionOutcome["claim"],
): ExtractionOutcome => ({
  segmentId,
  claim,
  claimKey,
  claimId: `occurrence:${claimKey}`,
  accepted: true,
});

describe("deriveClaimBlocks", () => {
  it("carries markdown section headings forward as segment position provenance", () => {
    expect(
      mapSegmentsToPositions([
        { id: "0", text: "# Corpus title" },
        { id: "1", text: "## Frozen accident" },
        { id: "2", text: "The assignment is arbitrary" },
        { id: "3", text: "## Stereochemical affinity" },
        { id: "4", text: "Affinity fixes assignments" },
      ]),
    ).toEqual({
      "2": "Frozen accident",
      "4": "Stereochemical affinity",
    });
  });

  it("applies caller aliases, groups claims by concept community, and reports every merge", async () => {
    const communities: ClaimCommunity[] = [
      {
        id: 2,
        label: "freeze · accident · assignment",
        members: ["freeze", "accident", "assignment", "arbitrary"],
      },
      {
        id: 0,
        label: "origin · genetic · stereochemical",
        members: ["origin", "genetic", "stereochemical", "affinity"],
      },
    ];
    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:frozen", {
          kind: "exclusion",
          roles: { excluder: "assignment", excluded: "arbitrariness" },
        }),
        accepted("s2", "claim:affinity", {
          kind: "causal-claim",
          roles: {
            cause: "chemical-affinity-between-triplet-and-residue",
            effect: "assignments",
          },
          polarity: "asserts",
        }),
      ],
      {
        communities,
        ontology: {
          arbitrariness: "arbitrary",
          assignments: "assignment",
          "chemical-affinity-between-triplet-and-residue":
            "stereochemical_affinity",
        },
      },
    );

    expect(result.blocks.map((block) => block.communityId)).toEqual([0, 2]);
    expect(result.blocks.flatMap((block) => block.claimKeys).sort()).toEqual([
      "claim:affinity",
      "claim:frozen",
    ]);
    expect(result.blocks.flatMap((block) => block.propositions)).toEqual(
      expect.arrayContaining([
        "all x (stereochemical_affinity(x) -> causes_assignment(x))",
        "all x (assignment(x) -> -arbitrary(x))",
      ]),
    );
    expect(result.predicateMapping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "arbitrariness",
          canonical: "arbitrary",
          method: "ontology",
        }),
        expect.objectContaining({
          source: "chemical-affinity-between-triplet-and-residue",
          canonical: "stereochemical_affinity",
          method: "ontology",
        }),
      ]),
    );
  });

  it("suggests semantic aliases without silently merging predicates", async () => {
    class FakeEmbedder implements IEmbedder {
      async embed(text: string): Promise<Float64Array> {
        return new Float64Array(
          text === "affinity" || text === "stereochemical interaction"
            ? [1, 0]
            : [0, 1],
        );
      }

      async embedBatch(texts: string[]): Promise<Float64Array[]> {
        return Promise.all(texts.map((text) => this.embed(text)));
      }
    }

    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:asserts", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "asserts",
        }),
        accepted("s2", "claim:denies", {
          kind: "causal-claim",
          roles: {
            cause: "stereochemical-interaction",
            effect: "assignment",
          },
          polarity: "denies",
        }),
      ],
      {
        embedder: new FakeEmbedder(),
        similarityThreshold: 0.9,
        positionBySegment: { s1: "Affinity", s2: "Stereochemical" },
      },
    );

    expect(result.blocks.flatMap((block) => block.propositions)).toEqual(
      expect.arrayContaining([
        "all x (affinity(x) -> causes_assignment(x))",
        "all x (stereochemical_interaction(x) -> -causes_assignment(x))",
      ]),
    );
    expect(result.predicateMapping).toContainEqual({
      source: "stereochemical-interaction",
      canonical: "stereochemical_interaction",
      method: "unchanged",
    });
    expect(result.predicateAliasSuggestions).toContainEqual({
      source: "stereochemical-interaction",
      target: "affinity",
      proposedCanonical: "affinity",
      similarity: 1,
      severity: "critical",
    });
  });

  it("does not suggest labels already unified by an audited ontology", async () => {
    class CanonicalEmbedder implements IEmbedder {
      async embed(text: string): Promise<Float64Array> {
        const vectors: Record<string, number[]> = {
          assignment: [1, 0, 0],
          assignments: [1, 0, 0],
          first: [0, 1, 0],
          second: [0, 0, 1],
        };
        return new Float64Array(vectors[text] ?? [0, 0, 0]);
      }
    }

    const result = await deriveClaimBlocks(
      [
        accepted("a", "claim:a", {
          kind: "exclusion",
          roles: { excluder: "assignments", excluded: "first" },
        }),
        accepted("b", "claim:b", {
          kind: "exclusion",
          roles: { excluder: "assignment", excluded: "second" },
        }),
      ],
      {
        ontology: { assignments: "assignment" },
        embedder: new CanonicalEmbedder(),
        similarityThreshold: 0.9,
      },
    );

    expect(result.predicateAliasSuggestions).toEqual([]);
  });

  it("rejects pronoun subjects and repairs clause-shaped predicate labels", async () => {
    const result = await deriveClaimBlocks([
      accepted("s1", "claim:pronoun", {
        kind: "entailment",
        roles: { antecedent: "this", consequent: "contiguous-codon-domains" },
      }),
      accepted("s2", "claim:repair", {
        kind: "causal-claim",
        roles: {
          cause: "error-value",
          effect: "makes-the-comparison-quantitative",
        },
        polarity: "asserts",
      }),
    ]);

    expect(result.rejected).toEqual([
      expect.objectContaining({
        segmentId: "s1",
        reason: expect.stringContaining("pronoun subject"),
      }),
    ]);
    expect(result.blocks.flatMap((block) => block.propositions)).toContain(
      "all x (error_value(x) -> causes_comparison_quantitative(x))",
    );
    expect(result.predicateMapping).toContainEqual({
      source: "makes-the-comparison-quantitative",
      canonical: "comparison_quantitative",
      method: "repair",
    });
  });

  it("keeps rival positions separate when they discuss the same community", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("frozen-1", "claim:denies", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "denies",
        }),
        accepted("stereo-1", "claim:asserts", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "asserts",
        }),
      ],
      {
        communities: [
          {
            id: 0,
            label: "origin · genetic · stereochemical",
            members: ["affinity", "assignment"],
          },
        ],
        positionBySegment: {
          "frozen-1": "Frozen accident",
          "stereo-1": "Stereochemical affinity",
        },
      },
    );

    expect(result.blocks.map((block) => block.positionLabel)).toEqual([
      "Frozen accident",
      "Stereochemical affinity",
    ]);
    expect(result.blocks.map((block) => block.communityIds)).toEqual([[0], [0]]);
    expect(result.blocks).toHaveLength(2);
  });

  it("adds caller-audited shared existence seeds to every position block", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("a", "claim:a", {
          kind: "exclusion",
          roles: { excluder: "measurement", excluded: "cell" },
        }),
        accepted("b", "claim:b", {
          kind: "exclusion",
          roles: { excluder: "code", excluded: "arbitrary" },
        }),
      ],
      {
        positionBySegment: { a: "A", b: "B" },
        sharedExistencePredicates: ["codon", "amino-acid", "assignment"],
      },
    );

    expect(result.sharedExistencePredicates).toEqual([
      "amino_acid",
      "assignment",
      "codon",
    ]);
    expect(
      result.blocks.every((block) =>
        [
          "exists x (amino_acid(x))",
          "exists x (assignment(x))",
          "exists x (codon(x))",
        ].every((seed) => block.propositions.includes(seed)),
      ),
    ).toBe(true);
  });

  it("automatically links positions through canonical roles that recur across them", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("a", "claim:a", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignments" },
          polarity: "asserts",
        }),
        accepted("b", "claim:b", {
          kind: "causal-claim",
          roles: { cause: "historical accident", effect: "assignment" },
          polarity: "denies",
        }),
      ],
      {
        ontology: { assignments: "assignment" },
        positionBySegment: { a: "Stereochemical", b: "Frozen accident" },
      },
    );

    expect(result.sharedExistencePredicates).toContain("assignment");
    expect(
      result.blocks.every((block) =>
        block.propositions.includes("exists x (assignment(x))"),
      ),
    ).toBe(true);
    expect(result.injectedAxioms["position:Stereochemical"]).toEqual(
      expect.arrayContaining([
        "exists x (affinity(x))",
        "exists x (assignment(x))",
      ]),
    );
    expect(result.injectedAxioms["position:Frozen accident"]).toEqual(
      expect.arrayContaining([
        "exists x (historical_accident(x))",
        "exists x (assignment(x))",
      ]),
    );
  });

  it("audits compound existence witnesses generated for distinctions", async () => {
    const result = await deriveClaimBlocks([
      accepted("d", "claim:d", {
        kind: "distinction",
        roles: { distinguished: ["phenomenal", "access"] },
      }),
    ]);

    expect(result.injectedAxioms["community:unassigned"]).toContain(
      "exists x (phenomenal(x) & -access(x))",
    );
  });
});
