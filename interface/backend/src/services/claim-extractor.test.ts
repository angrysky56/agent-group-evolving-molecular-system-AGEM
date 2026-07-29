import { describe, expect, it } from "vitest";
import {
  canonicalClaim,
  buildClaimExtractionPrompt,
  buildCorpusGlossaryPrompt,
  claimIdentity,
  claimAttributionIssue,
  claimSourceSemanticIssue,
  claimSchemaIssue,
  claimVocabularyIssue,
  claimToPropositions,
  claimToTypeQL,
  extractIntoStore,
  normalizeClaimExtras,
  parseClaimArray,
  parseClosedGlossary,
  parseSegmentProposal,
  schemaClaimFact,
  type ExtractedClaim,
} from "./claim-extractor.js";
import { SCHEMA_RELATIVE_PATHS } from "./typedb-claims.js";

describe("claim identity for finding evidence", () => {
  it("accepts both direct and wrapped claim arrays from cheap models", () => {
    expect(parseClaimArray([])).toEqual([]);
    expect(parseClaimArray({ claims: [] })).toEqual([]);
    expect(parseClaimArray({ claims: "not-an-array" })).toBeNull();
  });

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

    expect(query?.position).toContain('isa position, has label "hot theorists"');
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
    ).toContain('positionId="hot"');
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

  it("rejects malformed role cardinality before generating a TypeDB write", () => {
    const malformed: ExtractedClaim = {
      kind: "dissociation",
      roles: { dissociable: "influence-over-termites" },
      scope: "corpus",
    };

    expect(claimSchemaIssue(malformed)).toMatch(
      /dissociation.*dissociable.*at least 2.*found 1/i,
    );
    expect(claimToTypeQL(malformed, "segment-7")).toBeNull();
    expect(schemaClaimFact(malformed)).toBeNull();
  });

  it("rejects duplicate and unexpected role players before persistence", () => {
    expect(
      claimSchemaIssue({
        kind: "distinction",
        roles: { distinguished: ["same", "same"] },
        scope: "corpus",
      }),
    ).toMatch(/at least 2 distinct values.*found 1/i);
    expect(
      claimSchemaIssue({
        kind: "entailment",
        roles: { antecedent: "a", consequent: "b", extra: "c" },
        scope: "corpus",
      }),
    ).toMatch(/unexpected role.*extra/i);
  });

  it("does not persist or identify extras that are unsupported by a claim kind", () => {
    const clean: ExtractedClaim = {
      kind: "exclusion",
      roles: { excluder: "fdt", excluded: "dominance" },
      scope: "corpus",
    };
    const noisy = { ...clean, polarity: "denies" as const };

    expect(claimToTypeQL(noisy, "segment-8")?.claim).not.toContain(
      "has polarity",
    );
    expect(canonicalClaim(noisy)).toBe(canonicalClaim(clean));
    expect(schemaClaimFact(noisy)).toBe(schemaClaimFact(clean));
  });

  it("lifts cheap-model polarity from a nested extra object", () => {
    const normalized = normalizeClaimExtras({
      kind: "property-assertion",
      roles: { subject: "FDT", property: "pays" },
      scope: "position",
      positionId: "FDT",
      extra: { polarity: "asserts" },
    } as unknown as ExtractedClaim);

    expect(normalized.polarity).toBe("asserts");
    expect("extra" in normalized).toBe(false);
    expect(claimSchemaIssue(normalized)).toBeNull();
  });

  it("mechanically repairs flattened role fields and object-shaped position scope", () => {
    const normalized = normalizeClaimExtras({
      kind: "property-assertion",
      subject: "copenhagen",
      property: "psi-epistemic",
      roles: {},
      scope: { positionId: "copenhagen" },
      polarity: "asserts",
    } as unknown as ExtractedClaim);

    expect(normalized).toEqual({
      kind: "property-assertion",
      roles: { subject: "copenhagen", property: "psi-epistemic" },
      scope: "position",
      positionId: "copenhagen",
      polarity: "asserts",
    });
    expect(claimSchemaIssue(normalized)).toBeNull();
  });

  it("lifts flattened distinction values but still rejects a collapsed pair", () => {
    const normalized = normalizeClaimExtras({
      kind: "distinction",
      distinguished: ["wavefunction-status", "wavefunction-status"],
      roles: {},
      scope: "corpus",
      differenceKind: "in-kind",
    } as unknown as ExtractedClaim);

    expect(normalized.roles.distinguished).toEqual([
      "wavefunction-status",
      "wavefunction-status",
    ]);
    expect(claimSchemaIssue(normalized)).toMatch(/found 1/);
  });

  it("mechanically lifts nominalized no-negation into structural polarity", () => {
    expect(
      normalizeClaimExtras({
        kind: "property-assertion",
        roles: { subject: "act", property: "no-ratifiable" },
        scope: "corpus",
        polarity: "asserts",
      }),
    ).toMatchObject({
      roles: { subject: "act", property: "ratifiable" },
      polarity: "denies",
    });
  });

  it("uses predicate form throughout deterministic claim conversion", () => {
    const converted = claimToPropositions({
      kind: "entailment",
      roles: {
        antecedent: "dominance",
        consequent: "newcomb-adequate",
      },
      scope: "corpus",
    });

    expect(converted?.propositions).toContain(
      "all x (dominance(x) -> newcomb_adequate(x))",
    );
    expect(converted?.propositions.join(" ")).not.toContain("holds(");
  });

  it("represents a denied entailment by negating its consequent", () => {
    const converted = claimToPropositions({
      kind: "entailment",
      roles: {
        antecedent: "dominance-holding",
        consequent: "newcomb-adequacy",
      },
      scope: "corpus",
      polarity: "denies",
    });

    expect(converted?.propositions).toContain(
      "all x (dominance_holding(x) -> -newcomb_adequacy(x))",
    );
  });

  it("uses a separate symbol namespace for property subjects", () => {
    const classProperty = claimToPropositions({
      kind: "property-assertion",
      roles: { subject: "two-boxes", property: "better-in-every-state" },
      scope: "corpus",
      polarity: "asserts",
    });
    const theoryProperty = claimToPropositions({
      kind: "property-assertion",
      roles: { subject: "CDT", property: "two-boxes" },
      scope: "position",
      positionId: "CDT",
      polarity: "asserts",
    });

    expect(classProperty?.propositions).toEqual([
      "better_in_every_state(entity_two_boxes)",
    ]);
    expect(theoryProperty?.propositions).toEqual(["two_boxes(entity_cdt)"]);
  });

  it("represents a theory holding a property as predication, not reverse entailment", () => {
    const claim = {
      kind: "property-assertion",
      roles: { subject: "CDT", property: "dominance" },
      scope: "position",
      positionId: "CDT",
      polarity: "asserts",
    } as ExtractedClaim;

    expect(claimToPropositions(claim)?.propositions).toEqual([
      "dominance(entity_cdt)",
    ]);
    expect(claimToTypeQL(claim, "segment-9")?.claim).toContain(
      "$claim isa property-assertion",
    );
  });

  it("loads the claim schema before the finding schema", () => {
    expect(SCHEMA_RELATIVE_PATHS.map((path) => path.replace(/\\/g, "/"))).toEqual([
      "schema/claims.tql",
      "schema/findings.tql",
    ]);
  });

  it("forces every role through one closed corpus glossary", () => {
    const prompt = buildClaimExtractionPrompt(
      "It causes physical events.",
      [
        {
          label: "mental-state",
          kind: "entity",
          definition: "a mental state",
          sourceForms: ["mind", "it"],
        },
        {
          label: "physical-event",
          kind: "entity",
          definition: "a physical event",
          sourceForms: ["physical events"],
        },
      ],
      true,
    );
    expect(prompt).toContain("CLOSED CORPUS ROLE VOCABULARY");
    expect(prompt).toContain("mental-state");
    expect(prompt).toContain("no new symbols are permitted");
    expect(prompt).toContain('to "unmappable"');
    expect(prompt).toContain("Resolve paraphrases, relativizers, and\npronouns");
    expect(prompt).toContain('"scope":"position"');
    expect(prompt).toContain('"positionId":"..."');
    expect(prompt).toContain("Never flatten rival positions");
    expect(prompt).not.toContain('"identified":"meta-state"');
  });

  it("builds pass one from the whole corpus and honors audited canonicals", () => {
    const prompt = buildCorpusGlossaryPrompt(
      [
        { id: "s1", text: "A theory that holds dominance two-boxes." },
        { id: "s2", text: "The theory holding dominance is not adequate." },
      ],
      { "dominance-principle": "dominance" },
    );

    expect(prompt).toContain("ENTIRE numbered corpus");
    expect(prompt).toContain(
      "[0] (segmentId=s1) A theory that holds dominance two-boxes.",
    );
    expect(prompt).toContain(
      "[1] (segmentId=s2) The theory holding dominance is not adequate.",
    );
    expect(prompt).toContain("dominance-principle -> dominance");
    expect(prompt).toContain('"theory that holds dominance" and\n  "theory holding dominance"');
    expect(prompt).toContain('"the act itself" uses the underlying "act"');
    expect(prompt).toContain('"segmentId=<id>: <surface form>"');
  });

  it("parses an auditable glossary and rejects pronoun or duplicate labels", () => {
    expect(
      parseClosedGlossary({
        glossary: [
          {
            label: "dominance",
            kind: "property",
            definition: "the dominance property",
            sourceForms: ["theory holding dominance", "dominance"],
          },
        ],
      }),
    ).toEqual([
      {
        label: "dominance",
        kind: "property",
        definition: "the dominance property",
        sourceForms: ["dominance", "theory holding dominance"],
      },
    ]);
    expect(
      parseClosedGlossary({
        glossary: [
          {
            label: "wavefunction-status",
            kind: "axis",
            axisEncoding: "categorical",
            definition: "status of psi",
            sourceForms: ["Wavefunction status"],
            values: ["psi-ontic", "psi-epistemic"],
          },
          {
            label: "psi-ontic",
            kind: "axis-value",
            axis: "wavefunction-status",
            definition: "psi is physical",
            sourceForms: [],
          },
          {
            label: "psi-epistemic",
            kind: "axis-value",
            axis: "wavefunction-status",
            definition: "psi is informational",
            sourceForms: [],
          },
        ],
      }),
    ).not.toBeNull();
    expect(
      parseClosedGlossary({
        glossary: [
          {
            label: "wavefunction-status",
            kind: "axis",
            axisEncoding: "categorical",
            definition: "status of psi",
            values: ["wavefunction-status", "wavefunction-status"],
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseClosedGlossary({
        glossary: [{ label: "act-itself", definition: "the act" }],
      }),
    ).toBeNull();
    expect(
      parseClosedGlossary({
        glossary: [
          { label: "dominance", definition: "one" },
          { label: "dominance", definition: "two" },
        ],
      }),
    ).toBeNull();
    expect(
      parseClosedGlossary({
        glossary: [
          { label: "newcomb-adequacy", definition: "one" },
          { label: "newcomb_adequacy", definition: "two" },
        ],
      }),
    ).toBeNull();
  });

  it("retains explicit unmappable claims and rejects symbol minting", () => {
    expect(
      parseSegmentProposal({
        claims: [],
        unmappable: [{ reason: "No glossary label represents calibration." }],
      }),
    ).toEqual({
      claims: [],
      unmappable: [
        {
          reason: "No glossary label represents calibration.",
          candidateLabels: [],
        },
      ],
    });
    expect(parseSegmentProposal({ claims: [] }, true)).toBeNull();

    const glossary = [
      {
        label: "dominance",
        kind: "property" as const,
        definition: "the dominance property",
        sourceForms: ["theory that holds dominance"],
      },
    ];
    expect(
      claimVocabularyIssue(
        {
          kind: "entailment",
          roles: {
            antecedent: "theory-that-holds-dominance",
            consequent: "dominance",
          },
          scope: "corpus",
        },
        glossary,
      ),
    ).toMatch(/theory-that-holds-dominance/);
    expect(
      claimVocabularyIssue(
        {
          kind: "property-assertion",
          roles: { subject: "dominance", property: "dominance" },
          scope: "corpus",
          polarity: "asserts",
        },
        glossary,
      ),
    ).toBeNull();
  });

  it("keeps axis headings out of the predicate vocabulary", () => {
    const glossary = parseClosedGlossary({
      glossary: [
        {
          label: "wavefunction-status",
          kind: "axis",
          axisEncoding: "categorical",
          definition: "status of psi",
          values: ["psi-ontic", "psi-epistemic"],
        },
        {
          label: "psi-ontic",
          kind: "axis-value",
          axis: "wavefunction-status",
          definition: "psi is physical",
        },
        {
          label: "psi-epistemic",
          kind: "axis-value",
          axis: "wavefunction-status",
          definition: "psi is informational",
        },
        {
          label: "consistent-histories",
          kind: "entity",
          definition: "the consistent histories position",
        },
      ],
    })!;

    expect(
      claimVocabularyIssue(
        {
          kind: "property-assertion",
          roles: {
            subject: "consistent-histories",
            property: "wavefunction-status",
          },
          scope: "position",
          positionId: "consistent-histories",
          polarity: "denies",
        },
        glossary,
      ),
    ).toMatch(/metadata-only axis/i);
    expect(
      claimVocabularyIssue(
        {
          kind: "property-assertion",
          roles: {
            subject: "consistent-histories",
            property: "psi-epistemic",
          },
          scope: "position",
          positionId: "consistent-histories",
          polarity: "asserts",
        },
        glossary,
      ),
    ).toBeNull();
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

  it("refuses to turn an n-ary no-go theorem into pairwise exclusions", () => {
    const claim: ExtractedClaim = {
      kind: "exclusion",
      roles: { excluder: "bell-theorem", excluded: "locality" },
      scope: "corpus",
    };

    expect(
      claimSourceSemanticIssue(
        claim,
        "No position can hold all of: locality, hidden variables, measurement independence, and empirical adequacy.",
      ),
    ).toMatch(/joint incompatibility.*pairwise exclusions/i);
    expect(
      claimSourceSemanticIssue(
        claim,
        "No position can hold all three of: universal quantum theory, agent consistency, and single outcomes.",
      ),
    ).toMatch(/joint incompatibility/i);
    expect(
      claimSourceSemanticIssue(
        claim,
        "Every theory that holds dominance is not Newcomb-adequate.",
      ),
    ).toBeNull();
  });

  it("does not mistake the decision-theory universal rule for named attribution", () => {
    expect(
      claimAttributionIssue(
        {
          kind: "exclusion",
          roles: {
            excluder: "theory-holding-dominance",
            excluded: "newcomb-adequacy",
          },
          scope: "corpus",
        },
        "Therefore every theory fails at least one property: a theory that holds dominance is not Newcomb-adequate.",
      ),
    ).toBeNull();
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
      glossaryMs: 0,
      proposalMs: 0,
      persistenceMs: 0,
      glossaryCalls: 0,
      batchCalls: 0,
      fallbackBatches: 0,
      fallbackSegmentCalls: 0,
    });
    expect(report.telemetry.totalMs).toBeGreaterThanOrEqual(0);
  });
});
