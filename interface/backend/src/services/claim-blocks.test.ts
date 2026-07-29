import { describe, expect, it } from "vitest";
import type { IEmbedder } from "#agem/lcm/interfaces.js";
import {
  classifyClaimVerdict,
  deriveClaimBlocks,
  mapSegmentsToPositions,
  type ClaimCommunity,
} from "./claim-blocks.js";
import type { ExtractedClaim, ExtractionOutcome } from "./claim-extractor.js";
import {
  analyzeFormalization,
  computeLogicalCohomology,
  type SatOracle,
} from "./logicalCohomology.js";

type ClaimInput = Omit<ExtractedClaim, "scope"> &
  Partial<Pick<ExtractedClaim, "scope" | "positionId">>;

const accepted = (
  segmentId: string,
  claimKey: string,
  claim: ClaimInput,
): ExtractionOutcome => ({
  segmentId,
  claim: { scope: "corpus", ...claim } as ExtractedClaim,
  claimKey,
  claimId: `occurrence:${claimKey}`,
  accepted: true,
});

const hotHopOracle: SatOracle = async (formulas) => ({
  consistent: !(
    formulas.includes("all x (meta_state(x) <-> thought_like(x))") &&
    formulas.includes("all x (meta_state(x) <-> perception_like(x))") &&
    formulas.includes("exists x (thought_like(x) & -perception_like(x))")
  ),
});

describe("deriveClaimBlocks", () => {
  it("stops before derivation when the request is aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("deadline exceeded");
    controller.abort(reason);

    await expect(
      deriveClaimBlocks([], { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("retains markdown position hints as provenance only", () => {
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

  it("merges holder identities that differ only by case", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:fdt-upper", {
          kind: "property-assertion",
          roles: { subject: "FDT", property: "lesion-adequate" },
          scope: "position",
          positionId: "FDT",
          polarity: "asserts",
        }),
        accepted("s2", "claim:fdt-lower", {
          kind: "property-assertion",
          roles: { subject: "FDT", property: "newcomb-adequate" },
          scope: "position",
          positionId: "fdt",
          polarity: "asserts",
        }),
      ],
      { corpusId: "decision-theory" },
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      name: "position:fdt",
      positionId: "fdt",
    });
  });

  it("eliminates the decision-theory arity and pseudo-negation preflight defects", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:act-class", {
          kind: "property-assertion",
          roles: { subject: "two-boxing", property: "better-in-every-state" },
          polarity: "asserts",
        }),
        accepted("s2", "claim:cdt-two-boxes", {
          kind: "property-assertion",
          roles: { subject: "CDT", property: "two-boxes" },
          scope: "position",
          positionId: "CDT",
          polarity: "asserts",
        }),
        accepted("s3", "claim:newcomb-rule", {
          kind: "entailment",
          roles: {
            antecedent: "dominance-holding",
            consequent: "non-newcomb-adequacy",
          },
        }),
        accepted("s4", "claim:ratifiability", {
          kind: "property-assertion",
          roles: { subject: "staying", property: "not-ratifiable" },
          polarity: "asserts",
        }),
      ],
      { corpusId: "decision-theory" },
    );

    const warnings = analyzeFormalization(
      result.blocks.map(({ name, propositions }) => ({ name, propositions })),
    );
    expect(warnings.map((warning) => warning.code)).not.toContain(
      "inconsistent_arity",
    );
    expect(warnings.map((warning) => warning.code)).not.toContain(
      "pseudo_negation",
    );
    expect(result.blocks.flatMap((block) => block.propositions)).toEqual(
      expect.arrayContaining([
        "better_in_every_state(entity_two_boxes)",
        "two_boxes(entity_cdt)",
        "all x (dominance_holding(x) -> -newcomb_adequacy(x))",
        "-ratifiable(entity_staying)",
      ]),
    );
  });

  it("applies audited aliases while communities remain diagnostic annotations", async () => {
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
        corpusId: "genetic-code",
        communities,
        ontology: {
          arbitrariness: "arbitrary",
          assignments: "assignment",
          "chemical-affinity-between-triplet-and-residue":
            "stereochemical_affinity",
        },
      },
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      name: "corpus:genetic-code",
      assertionScope: "corpus",
      communityIds: [0, 2],
    });
    expect(result.blocks[0].propositions).toEqual(
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
          scope: "position",
          positionId: "Affinity",
        }),
        accepted("s2", "claim:denies", {
          kind: "causal-claim",
          roles: {
            cause: "stereochemical-interaction",
            effect: "assignment",
          },
          polarity: "denies",
          scope: "position",
          positionId: "Stereochemical",
        }),
      ],
      {
        corpusId: "genetic-code",
        embedder: new FakeEmbedder(),
        similarityThreshold: 0.9,
      },
    );

    expect(result.blocks.flatMap((block) => block.propositions)).toEqual(
      expect.arrayContaining([
        "all x (affinity(x) -> causes_assignment(x))",
        "all x (stereochemical_interaction(x) -> -causes_assignment(x))",
      ]),
    );
    expect(result.predicateAliasSuggestions).toContainEqual({
      source: "stereochemical-interaction",
      target: "affinity",
      proposedCanonical: "affinity",
      similarity: 1,
      severity: "critical",
    });
  });

  it("treats pass-one glossary labels as canonical and skips alias embeddings", async () => {
    class MustNotEmbed implements IEmbedder {
      async embed(): Promise<Float64Array> {
        throw new Error("closed vocabulary must not be re-clustered");
      }
      async embedBatch(): Promise<Float64Array[]> {
        throw new Error("closed vocabulary must not be re-clustered");
      }
    }

    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:dominance", {
          kind: "property-assertion",
          roles: { subject: "cdt", property: "dominance" },
          scope: "position",
          positionId: "CDT",
          polarity: "asserts",
        }),
        accepted("s2", "claim:adequacy", {
          kind: "entailment",
          roles: {
            antecedent: "dominance",
            consequent: "newcomb-adequacy",
          },
          scope: "corpus",
          polarity: "denies",
        }),
      ],
      {
        closedVocabulary: ["cdt", "dominance", "newcomb-adequacy"],
        embedder: new MustNotEmbed(),
      },
    );

    expect(result.predicateAliasSuggestions).toEqual([]);
    expect(result.predicateMapping).toEqual(
      expect.arrayContaining([
        { source: "dominance", canonical: "dominance", method: "unchanged" },
        {
          source: "newcomb-adequacy",
          canonical: "newcomb_adequacy",
          method: "unchanged",
        },
      ]),
    );
    expect(result.blocks.flatMap(({ propositions }) => propositions)).toEqual(
      expect.arrayContaining([
        "dominance(entity_cdt)",
        "all x (dominance(x) -> -newcomb_adequacy(x))",
      ]),
    );
  });

  it("auto-applies inflectional aliases before semantic suggestion", async () => {
    class SameVectorEmbedder implements IEmbedder {
      async embed(): Promise<Float64Array> {
        return new Float64Array([1, 0]);
      }
      async embedBatch(texts: string[]): Promise<Float64Array[]> {
        return Promise.all(texts.map(() => this.embed()));
      }
    }

    const result = await deriveClaimBlocks(
      [
        accepted("s1", "claim:lesion-adjective", {
          kind: "exclusion",
          roles: { excluder: "lesion-adequate", excluded: "cdt" },
        }),
        accepted("s2", "claim:lesion-noun", {
          kind: "exclusion",
          roles: { excluder: "lesion-adequacy", excluded: "edt" },
        }),
        accepted("s3", "claim:newcomb-adjective", {
          kind: "exclusion",
          roles: { excluder: "newcomb-adequate", excluded: "cdt" },
        }),
        accepted("s4", "claim:newcomb-noun", {
          kind: "exclusion",
          roles: { excluder: "newcomb-adequacy", excluded: "edt" },
        }),
        accepted("s5", "claim:recommend-present", {
          kind: "exclusion",
          roles: { excluder: "recommends-refraining", excluded: "smoking" },
        }),
        accepted("s6", "claim:recommend-gerund", {
          kind: "exclusion",
          roles: { excluder: "recommending-refraining", excluded: "smoking" },
        }),
        accepted("s7", "claim:semantic-left", {
          kind: "exclusion",
          roles: { excluder: "mental", excluded: "physical" },
        }),
        accepted("s8", "claim:semantic-right", {
          kind: "exclusion",
          roles: { excluder: "mental-states", excluded: "physical" },
        }),
      ],
      {
        ontology: {
          does_well_in_newcomb: "newcomb_adequacy",
          smokes_in_lesion: "lesion_adequacy",
        },
        embedder: new SameVectorEmbedder(),
        similarityThreshold: 0.9,
      },
    );

    const mapping = Object.fromEntries(
      result.predicateMapping.map(({ source, canonical, method }) => [
        source,
        { canonical, method },
      ]),
    );
    expect(mapping["lesion-adequate"]).toEqual({
      canonical: "lesion_adequacy",
      method: "morphology",
    });
    expect(mapping["lesion-adequacy"].canonical).toBe("lesion_adequacy");
    expect(mapping["newcomb-adequate"]).toEqual({
      canonical: "newcomb_adequacy",
      method: "morphology",
    });
    expect(mapping["newcomb-adequacy"].canonical).toBe("newcomb_adequacy");
    expect(mapping["recommending-refraining"]).toEqual({
      canonical: "recommends_refraining",
      method: "morphology",
    });

    // Different token structure is semantic, not inflectional: report it for
    // audit even when embeddings are identical, and never silently merge it.
    expect(mapping.mental.canonical).toBe("mental");
    expect(mapping["mental-states"].canonical).toBe("mental_states");
    expect(result.predicateAliasSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "mental-states",
          target: "mental",
        }),
      ]),
    );
    const inflectionalPairs = new Set([
      ["lesion-adequate", "lesion-adequacy"].sort().join("|"),
      ["newcomb-adequate", "newcomb-adequacy"].sort().join("|"),
      ["recommends-refraining", "recommending-refraining"]
        .sort()
        .join("|"),
    ]);
    expect(
      result.predicateAliasSuggestions.some(({ source, target }) =>
        inflectionalPairs.has([source, target].sort().join("|")),
      ),
    ).toBe(false);
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
  });

  it("keeps rival positions separate by holder even in one segment and community", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("survey-1", "claim:denies", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "denies",
          scope: "position",
          positionId: "Frozen accident",
        }),
        accepted("survey-1", "claim:asserts", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "asserts",
          scope: "position",
          positionId: "Stereochemical affinity",
        }),
      ],
      {
        corpusId: "genetic-code",
        communities: [
          {
            id: 0,
            label: "origin · genetic · stereochemical",
            members: ["affinity", "assignment"],
          },
        ],
      },
    );

    expect(result.blocks.map((block) => block.positionId)).toEqual([
      "frozen accident",
      "stereochemical affinity",
    ]);
    expect(result.blocks.map((block) => block.communityIds)).toEqual([[0], [0]]);
  });

  it("adds only caller-audited shared existence seeds to every block", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("a", "claim:a", {
          kind: "exclusion",
          roles: { excluder: "measurement", excluded: "cell" },
          scope: "position",
          positionId: "A",
        }),
        accepted("b", "claim:b", {
          kind: "exclusion",
          roles: { excluder: "code", excluded: "arbitrary" },
          scope: "position",
          positionId: "B",
        }),
      ],
      {
        corpusId: "genetic-code",
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

  it("does not inject a recurring predicate into an unrelated position", async () => {
    const result = await deriveClaimBlocks(
      [
        accepted("a", "claim:a", {
          kind: "causal-claim",
          roles: { cause: "affinity", effect: "assignment" },
          polarity: "asserts",
          scope: "position",
          positionId: "Stereochemical",
        }),
        accepted("b", "claim:b", {
          kind: "causal-claim",
          roles: { cause: "historical-accident", effect: "assignment" },
          polarity: "denies",
          scope: "position",
          positionId: "Frozen accident",
        }),
      ],
      { corpusId: "genetic-code" },
    );

    expect(result.sharedExistencePredicates).toEqual([]);
    expect(result.injectedAxioms["position:stereochemical"]).toEqual([
      "exists x (affinity(x))",
    ]);
    expect(result.injectedAxioms["position:frozen accident"]).toEqual([
      "exists x (historical_accident(x))",
    ]);
  });

  it("marks missing scope as attribution-incomplete instead of using a community block", async () => {
    const incomplete: ExtractionOutcome = {
      segmentId: "s1",
      claimKey: "claim:missing-scope",
      claimId: "occurrence:missing-scope",
      accepted: true,
      claim: {
        kind: "identity-claim",
        roles: { identified: "meta-state", "identified-with": "thought-like" },
      } as unknown as ExtractedClaim,
    };

    const result = await deriveClaimBlocks([incomplete], {
      corpusId: "consciousness",
      communities: [{ id: 5, label: "thought", members: ["meta-state"] }],
    });

    expect(result.attributionComplete).toBe(false);
    expect(result.blocks).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/scope|attribution/i);
  });

  it("keeps HOT and HOP separate and classifies their joint clash as position incompatibility", async () => {
    const sameSegment = "theory-survey-0";
    const result = await deriveClaimBlocks(
      [
        accepted(sameSegment, "claim:hot", {
          kind: "identity-claim",
          roles: { identified: "meta-state", "identified-with": "thought-like" },
          scope: "position",
          positionId: "HOT",
        }),
        accepted(sameSegment, "claim:hop", {
          kind: "identity-claim",
          roles: { identified: "meta-state", "identified-with": "perception-like" },
          scope: "position",
          positionId: "HOP",
        }),
        accepted(sameSegment, "claim:distinction", {
          kind: "distinction",
          roles: { distinguished: ["thought-like", "perception-like"] },
          scope: "corpus",
        }),
      ],
      {
        corpusId: "consciousness",
        communities: [{ id: 5, label: "higher order", members: ["meta-state"] }],
      },
    );

    expect(result.attributionComplete).toBe(true);
    expect(result.blocks.map((block) => block.name).sort()).toEqual([
      "corpus:consciousness",
      "position:hop",
      "position:hot",
    ]);
    expect(
      result.blocks
        .filter((block) => block.positionId)
        .every((block) => block.segmentIds.includes(sameSegment)),
    ).toBe(true);

    const logical = await computeLogicalCohomology(
      result.blocks.map(({ name, propositions }) => ({ name, propositions })),
      hotHopOracle,
    );
    const semantic = classifyClaimVerdict(result, logical);

    expect(logical.internallyInconsistent).toEqual([]);
    expect(semantic.verdictKind).toBe("positions-incompatible");
    expect(semantic.hasCorpusContradiction).toBe(false);
  });

  it("classifies the same clash inside one holder and at corpus scope as real contradictions", async () => {
    const claims: Array<{
      kind: ExtractedClaim["kind"];
      roles: Record<string, string | string[]>;
    }> = [
      {
        kind: "identity-claim" as const,
        roles: { identified: "meta-state", "identified-with": "thought-like" },
      },
      {
        kind: "identity-claim" as const,
        roles: { identified: "meta-state", "identified-with": "perception-like" },
      },
      {
        kind: "distinction" as const,
        roles: { distinguished: ["thought-like", "perception-like"] },
      },
    ];

    for (const [scope, expected] of [
      ["position", "position-contradiction"],
      ["corpus", "corpus-contradiction"],
    ] as const) {
      const derivation = await deriveClaimBlocks(
        claims.map((claim, index) =>
          accepted(`s${index}`, `claim:${index}`, {
            ...claim,
            scope,
            ...(scope === "position" ? { positionId: "Combined theory" } : {}),
          }),
        ),
        { corpusId: "consciousness" },
      );
      const logical = await computeLogicalCohomology(
        derivation.blocks.map(({ name, propositions }) => ({ name, propositions })),
        hotHopOracle,
      );
      expect(classifyClaimVerdict(derivation, logical).verdictKind).toBe(expected);
    }
  });

  it("keeps logical blocks invariant when graph communities are reassigned", async () => {
    const outcomes = [
      accepted("s1", "claim:hot", {
        kind: "identity-claim",
        roles: { identified: "meta-state", "identified-with": "thought-like" },
        scope: "position",
        positionId: "HOT",
      }),
      accepted("s2", "claim:hop", {
        kind: "identity-claim",
        roles: { identified: "meta-state", "identified-with": "perception-like" },
        scope: "position",
        positionId: "HOP",
      }),
    ];
    const left = await deriveClaimBlocks(outcomes, {
      corpusId: "consciousness",
      communities: [{ id: 1, label: "meta", members: ["meta-state"] }],
    });
    const right = await deriveClaimBlocks(outcomes, {
      corpusId: "consciousness",
      communities: [{ id: 99, label: "different", members: ["thought-like"] }],
    });
    const logicalView = (derivation: typeof left) =>
      derivation.blocks.map(({ name, propositions }) => ({ name, propositions }));

    expect(logicalView(left)).toEqual(logicalView(right));
  });
});
