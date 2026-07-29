import { describe, expect, it } from "vitest";
import {
  attachFindingMemory,
  captureFindingFromTool,
  captureFindingNarrativeFromTool,
  formatRecallContext,
} from "./finding-capture.js";

const context = {
  runLogId: "run-1",
  producedByModel: "model-a",
  memoryNamespace: "consciousness",
};

describe("automatic finding capture", () => {
  it("does not store hand-authored formalizations as corpus findings", () => {
    const captured = captureFindingFromTool(
      "evaluate_logical_consistency",
      {
        corpusId: "corpus-for-provenance",
        blocks: [
          { name: "A", propositions: ["p(a)"] },
          { name: "B", propositions: [" -p(a) "] },
        ],
      },
      JSON.stringify({
        runLogId: "run-1",
        verdict: "CONTRADICTION FOUND",
        coverage: "Coverage: all 2 submitted blocks were evaluated.",
        hasContradiction: true,
        searchTruncated: false,
        checkFailures: [],
      }),
      context,
    );

    expect(captured).toBeNull();
  });

  it("marks truncated clean searches inconclusive and preserves the caveat", () => {
    const captured = captureFindingFromTool(
      "evaluate_logical_consistency",
      { blocks: [{ propositions: ["p(a)"] }] },
      JSON.stringify({
        verdict: "No contradiction found up to arity 3",
        coverage: "Coverage: all 1 submitted blocks were evaluated.",
        hasContradiction: false,
        searchTruncated: true,
        truncationNote: "Arity 4 was not searched.",
        checkFailures: [],
      }),
      context,
    );
    expect(captured).toBeNull();
  });

  it("captures derived claim keys and concrete evidence references", () => {
    const output = JSON.stringify({
      verdict: "No contradiction among 2 blocks.",
      coverage: "Coverage: all 2 distinct extracted claim blocks were evaluated.",
      hasContradiction: false,
      searchTruncated: false,
      checkFailures: [],
      attributionComplete: true,
      semanticsValidated: true,
      verdictKind: "no-contradiction",
      supportingClaimKeys: ["claim:a", "claim:b"],
      supportingClaimRefs: ["claim-occurrence:1", "claim-occurrence:2"],
      supportingClaimEvidence: [
        {
          claimKey: "claim:a",
          segmentId: "typed-corpus-0",
          sourceText: "Phi can occur without global broadcast.",
          claim: {
            kind: "exclusion",
            roles: { excluder: "phi", excluded: "global-broadcast" },
            scope: "corpus",
          },
        },
        {
          claimKey: "claim:b",
          segmentId: "typed-corpus-1",
          sourceText: "Consciousness is phi.",
          claim: {
            kind: "identity-claim",
            roles: { identified: "consciousness", "identified-with": "phi" },
            scope: "corpus",
          },
        },
      ],
    });
    const captured = captureFindingFromTool(
      "extract_and_verify_claims",
      { corpusId: "typed-corpus" },
      output,
      context,
    );
    expect(captured).toMatchObject({
      method: "derived-from-claims",
      outcome: "no-contradiction",
      memoryNamespace: "consciousness",
      supportingClaims: ["claim:a", "claim:b"],
      supportingClaimRefs: [
        "claim-occurrence:1",
        "claim-occurrence:2",
      ],
    });

    const narrative = captureFindingNarrativeFromTool(
      "extract_and_verify_claims",
      {
        text:
          "Phi can occur without global broadcast. Consciousness is phi. Additional corpus context remains available for compression.",
      },
      output,
    );
    expect(narrative?.sourceNarrative).toBe(
      "Phi can occur without global broadcast. Consciousness is phi. Additional corpus context remains available for compression.",
    );
    expect(narrative?.schemaFacts).toEqual([
      'exclusion(excluder="phi",excluded="global-broadcast",scope="corpus")',
      'identity-claim(identified="consciousness",identified-with="phi",scope="corpus")',
    ]);
  });

  it("does not densify hand-authored or partially evidenced findings", () => {
    expect(
      captureFindingNarrativeFromTool(
        "evaluate_logical_consistency",
        {},
        JSON.stringify({ supportingClaimKeys: ["claim:a"] }),
      ),
    ).toBeNull();
    expect(
      captureFindingNarrativeFromTool(
        "extract_and_verify_claims",
        {},
        JSON.stringify({
          supportingClaimKeys: ["claim:a", "claim:missing"],
          attributionComplete: true,
          semanticsValidated: true,
          verdictKind: "no-contradiction",
          supportingClaimEvidence: [
            {
              claimKey: "claim:a",
              segmentId: "s1",
              sourceText: "A excludes B.",
              claim: {
                kind: "exclusion",
                roles: { excluder: "a", excluded: "b" },
                scope: "corpus",
              },
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("stores nothing for vacuous, malformed, or non-verdict output", () => {
    expect(
      captureFindingFromTool(
        "evaluate_logical_consistency",
        { blocks: [{ propositions: ["p(a)"] }] },
        JSON.stringify({
          verdict: "INVALID",
          coverage: "none",
          hasContradiction: false,
          resultIsVacuous: true,
        }),
        context,
      ),
    ).toBeNull();
    expect(
      captureFindingFromTool("get_graph_topology", {}, "{}", context),
    ).toBeNull();
  });

  it("stores no derived finding when attribution or semantic classification is unsafe", () => {
    const base = {
      verdict: "The rival positions are incompatible, not a corpus contradiction.",
      coverage: "Coverage: all 2 blocks evaluated.",
      hasContradiction: true,
      supportingClaimKeys: ["claim:hot", "claim:hop"],
      supportingClaimEvidence: [
        {
          claimKey: "claim:hot",
          segmentId: "survey-1",
          sourceText: "HOT theorists identify meta-states with thoughts.",
          claim: {
            kind: "identity-claim",
            roles: { identified: "meta-state", "identified-with": "thought" },
            scope: "position",
            positionId: "HOT",
          },
        },
        {
          claimKey: "claim:hop",
          segmentId: "survey-1",
          sourceText: "HOP theorists identify meta-states with perceptions.",
          claim: {
            kind: "identity-claim",
            roles: {
              identified: "meta-state",
              "identified-with": "perception",
            },
            scope: "position",
            positionId: "HOP",
          },
        },
      ],
      checkFailures: [],
    };

    for (const unsafe of [
      {
        ...base,
        attributionComplete: false,
        semanticsValidated: false,
        verdictKind: "inconclusive",
      },
      {
        ...base,
        attributionComplete: true,
        semanticsValidated: true,
        verdictKind: "positions-incompatible",
      },
      {
        ...base,
        attributionComplete: true,
        semanticsValidated: true,
        verdictKind: "mixed",
      },
    ]) {
      expect(
        captureFindingFromTool(
          "extract_and_verify_claims",
          { corpusId: "consciousness" },
          JSON.stringify(unsafe),
          context,
        ),
      ).toBeNull();
      expect(
        captureFindingNarrativeFromTool(
          "extract_and_verify_claims",
          { text: "theory survey" },
          JSON.stringify(unsafe),
        ),
      ).toBeNull();
    }
  });

  it("captures an internally contradictory attributed position without calling the corpus contradictory", () => {
    const captured = captureFindingFromTool(
      "extract_and_verify_claims",
      { corpusId: "consciousness" },
      JSON.stringify({
        verdict: "Position HOT is internally contradictory.",
        coverage: "Coverage: all 1 blocks evaluated.",
        hasContradiction: true,
        attributionComplete: true,
        semanticsValidated: true,
        verdictKind: "position-contradiction",
        supportingClaimKeys: ["claim:hot"],
        supportingClaimRefs: ["occurrence:hot"],
        checkFailures: [],
      }),
      context,
    );

    expect(captured).toMatchObject({
      outcome: "contradiction",
      memoryNamespace: "consciousness",
      attributionValidated: true,
      semanticsValidated: true,
      semanticVerdictKind: "position-contradiction",
      verdict: "Position HOT is internally contradictory.",
    });
  });

  it("surfaces write conflicts and formats recalled memory with citation discipline", () => {
    const finding = {
      id: "finding-1",
      verdict: "VERDICT",
      coverage: "COVERAGE",
      runLogId: "run-1",
      producedByModel: "model-a",
      method: "hand-authored" as const,
      outcome: "contradiction" as const,
      corpusId: "corpus",
      memoryNamespace: "consciousness",
      supportingClaims: ["claim:a"],
      createdAt: "2026-01-01T00:00:00.000Z",
      recallCount: 1,
      citationCount: 0,
      status: "active" as const,
      condensedNarrative:
        'exclusion(excluder="phi",excluded="broadcast") phi⊥broadcast',
    };
    const conflict = {
      id: "conflict-1",
      newerFindingId: "finding-1",
      olderFindingId: "finding-0",
      sharedClaims: ["claim:a"],
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "open" as const,
    };
    const memory = { finding, stored: true, conflicts: [conflict] };
    const attached = JSON.parse(attachFindingMemory("{}", memory));
    expect(attached.findingMemory.conflictCandidates[0].id).toBe("conflict-1");
    expect(attached.findingMemory.condensedNarrativeStored).toBe(true);
    expect(attached.findingMemory.densification.status).toBe("not-applicable");

    const crossMethod = JSON.parse(
      attachFindingMemory("{}", {
        ...memory,
        conflicts: [
          {
            ...conflict,
            basis: "shared-corpus",
            sharedCorpusId: "corpus",
            sharedClaims: [],
          },
        ],
      }),
    );
    expect(crossMethod.findingMemory.conflictCandidates[0]).toEqual(
      expect.objectContaining({
        basis: "shared-corpus",
        sharedCorpusId: "corpus",
        sharedClaimCount: 0,
        note: expect.stringContaining("exact corpus identity"),
      }),
    );

    const rejected = JSON.parse(
      attachFindingMemory(
        "{}",
        {
          ...memory,
          finding: { ...finding, condensedNarrative: undefined },
        },
        {
          status: "fidelity-rejected",
          passes: 3,
          sourceTokens: 400,
          targetTokens: 112,
          schemaEnvelopeTokens: 72,
          outputTokens: 100,
          narrativeTokens: 1,
          minimumNarrativeTokens: 16,
          missingFacts: [],
          note: "No pass produced the minimum narrative.",
        },
      ),
    );
    expect(rejected.findingMemory).toMatchObject({
      condensedNarrativeStored: false,
      densification: {
        status: "fidelity-rejected",
        passes: 3,
        schemaEnvelopeTokens: 72,
        narrativeTokens: 1,
        minimumNarrativeTokens: 16,
      },
    });

    const formatted = formatRecallContext(
      [{ finding, similarity: 0.91, rankScore: 0.91, conflicts: [conflict] }],
      "model-a",
    );
    expect(formatted).toContain("[finding:finding-1]");
    expect(formatted).toContain("Verdict (verbatim): VERDICT");
    expect(formatted).toContain("never used as a retrieval cue");
    expect(formatted).toContain("phi⊥broadcast");
    expect(formatted).toContain("Do not silently choose a winner");
  });
});
