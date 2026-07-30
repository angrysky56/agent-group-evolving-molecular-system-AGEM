import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IEmbedder } from "#agem/lcm/interfaces.js";
import {
  FindingStore,
  type FindingGraph,
  type FindingInput,
  type StoredFinding,
  type VerificationDependencies,
  verificationFingerprint,
} from "./finding-store.js";

class FakeEmbedder implements IEmbedder {
  readonly calls: string[] = [];
  constructor(readonly vectors: Record<string, number[]>) {}

  async embed(text: string): Promise<Float64Array> {
    this.calls.push(text);
    return new Float64Array(this.vectors[text] ?? [0, 1]);
  }
}

class FakeGraph implements FindingGraph {
  findings: StoredFinding[] = [];
  supersedes: Array<[string, string, string]> = [];

  async recordFinding(finding: StoredFinding): Promise<void> {
    this.findings.push(finding);
  }

  async recordSupersedes(
    winner: string,
    loser: string,
    reason: string,
  ): Promise<void> {
    this.supersedes.push([winner, loser, reason]);
  }
}

const input = (
  verdict: string,
  outcome: FindingInput["outcome"],
  claims: string[],
  runLogId = verdict,
  method: FindingInput["method"] = "hand-authored",
): FindingInput => ({
  verdict,
  coverage: "Coverage: all 2 submitted blocks were evaluated.",
  runLogId,
  producedByModel: "test-model",
  method,
  outcome,
  corpusId: "provenance-only",
  memoryNamespace: "default-test",
  supportingClaims: claims,
  ...(method === "derived-from-claims"
    ? {
        attributionValidated: true,
        semanticsValidated: true,
        semanticVerdictKind:
          outcome === "contradiction"
            ? ("position-contradiction" as const)
            : outcome === "no-contradiction"
              ? ("no-contradiction" as const)
              : ("inconclusive" as const),
        verificationDependencies: dependencies({
          supportingClaimIds: claims,
          normalizedClaimKeys: claims,
        }),
      }
    : {}),
});

const dependencies = (
  overrides: Partial<VerificationDependencies> = {},
): VerificationDependencies => ({
  corpusHash: "corpus-hash",
  segmentationVersion: "segments-v1",
  supportingClaimIds: ["claim-b", "claim-a"],
  normalizedClaimKeys: ["key-b", "key-a"],
  ontologyVersion: "ontology-v1",
  extractionSchemaVersion: "schema-v1",
  sourceSemanticValidatorVersion: "source-validator-v1",
  formalizerVersion: "formalizer-v1",
  proverVersion: "mace4-v1",
  solverSettings: { maxChecks: 100, maxArity: 4 },
  ...overrides,
});

describe("FindingStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "agem-findings-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("fingerprints semantic dependencies canonically", () => {
    const first = dependencies();
    const reordered = dependencies({
      supportingClaimIds: ["claim-a", "claim-b", "claim-a"],
      normalizedClaimKeys: ["key-a", "key-b"],
      solverSettings: { maxArity: 4, maxChecks: 100 },
    });
    expect(verificationFingerprint(first)).toBe(
      verificationFingerprint(reordered),
    );
    expect(
      verificationFingerprint(
        dependencies({ sourceSemanticValidatorVersion: "source-validator-v2" }),
      ),
    ).not.toBe(verificationFingerprint(first));
  });

  it("marks changed semantic dependencies stale and removes them from active recall", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ finding: [1, 0], cue: [1, 0] }),
      { directory, similarityFloor: 0.4 },
    );
    const stored = await store.store({
      ...input(
        "finding",
        "contradiction",
        ["key-a", "key-b"],
        "typed-run",
        "derived-from-claims",
      ),
      verificationDependencies: dependencies(),
    });

    const audit = await store.auditVerificationDependencies({
      formalizerVersion: "formalizer-v2",
    });
    expect(audit).toMatchObject({ scanned: 1, marked: 1, unchanged: 0, truncated: false });
    expect(audit.findings[0]).toMatchObject({
      findingId: stored.finding.id,
      changes: [
        {
          dependency: "formalizerVersion",
          before: "formalizer-v1",
          after: "formalizer-v2",
        },
      ],
    });
    await expect(
      store.recall("cue", { memoryNamespace: "default-test" }),
    ).resolves.toEqual([]);
    expect(await store.getStats()).toMatchObject({ active: 0 });
  });

  it("keeps unchanged dependencies active and bounds each audit", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ one: [1, 0], two: [1, 0], cue: [1, 0] }),
      { directory, similarityFloor: 0.4 },
    );
    for (const verdict of ["one", "two"]) {
      await store.store({
        ...input(
          verdict,
          "contradiction",
          [`key-${verdict}`],
          `run-${verdict}`,
          "derived-from-claims",
        ),
        verificationDependencies: dependencies({
          normalizedClaimKeys: [`key-${verdict}`],
        }),
      });
    }
    expect(
      await store.auditVerificationDependencies(
        { sourceSemanticValidatorVersion: "source-validator-v1" },
        { limit: 1 },
      ),
    ).toMatchObject({ scanned: 1, marked: 0, unchanged: 1, truncated: true });
    expect(
      await store.recall("cue", { memoryNamespace: "default-test" }),
    ).toHaveLength(2);
  });

  it("uses one cue embedding, a raw similarity floor, and top-k", async () => {
    const embedder = new FakeEmbedder({
      relevant: [1, 0],
      secondary: [0.8, 0.6],
      unrelated: [0, 1],
      cue: [1, 0],
    });
    const store = new FindingStore(embedder, {
      directory,
      similarityFloor: 0.7,
      topK: 2,
    });
    await store.store(input("relevant", "contradiction", ["a"]));
    await store.store(input("secondary", "no-contradiction", ["b"]));
    await store.store(input("unrelated", "contradiction", ["c"]));

    const recalled = await store.recall("cue", {
      memoryNamespace: "default-test",
    });

    expect(embedder.calls.filter((call) => call === "cue")).toHaveLength(1);
    expect(recalled.map((match) => match.finding.verdict)).toEqual([
      "relevant",
      "secondary",
    ]);
    expect(recalled.every((match) => match.similarity >= 0.7)).toBe(true);
  });

  it("embeds the verbatim verdict and never the condensed payload", async () => {
    const embedder = new FakeEmbedder({ "verbatim verdict": [1, 0] });
    const store = new FindingStore(embedder, { directory });
    await store.store({
      ...input("verbatim verdict", "contradiction", ["claim:a"]),
      condensedNarrative: "符号⊥soup→dense",
    });

    expect(embedder.calls).toEqual(["verbatim verdict"]);
  });

  it("recalls nothing for unrelated material instead of forcing a top-k match", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ finding: [1, 0], unrelatedCue: [0, 1] }),
      { directory, similarityFloor: 0.4, topK: 3 },
    );
    await store.store(input("finding", "contradiction", ["a"]));
    await expect(
      store.recall("unrelatedCue", { memoryNamespace: "default-test" }),
    ).resolves.toEqual([]);
  });

  it("recalls only the requested namespace even when another corpus is an identical vector match", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ consciousness: [1, 0], genetics: [1, 0], cue: [1, 0] }),
      { directory, similarityFloor: 0.4, topK: 3 },
    );
    await store.store({
      ...input("consciousness", "contradiction", ["claim:mind"], "mind-run"),
      memoryNamespace: "consciousness",
      corpusId: "theories-of-mind",
    });
    await store.store({
      ...input("genetics", "contradiction", ["claim:code"], "code-run"),
      memoryNamespace: "genetic-code",
      corpusId: "origin-of-genetic-code",
    });

    const recalled = await store.recall("cue", {
      memoryNamespace: "consciousness",
    });

    expect(recalled.map((match) => match.finding.verdict)).toEqual([
      "consciousness",
    ]);
  });

  it("quarantines legacy derived findings that have no attribution receipt", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ legacy: [1, 0], cue: [1, 0] }),
      { directory, similarityFloor: 0.4 },
    );
    await store.store(
      input(
        "legacy",
        "contradiction",
        ["claim:legacy"],
        "legacy-run",
        "derived-from-claims",
      ),
    );
    const indexPath = join(directory, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    delete index.findings[0].attributionValidated;
    delete index.findings[0].semanticsValidated;
    delete index.findings[0].semanticVerdictKind;
    await writeFile(indexPath, JSON.stringify(index), "utf8");

    await expect(
      store.recall("cue", { memoryNamespace: "default-test" }),
    ).resolves.toEqual([]);
  });

  it("detects conflict only from exact shared claims and opposite outcomes", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ old: [1, 0], newer: [1, 0], fuzzy: [1, 0], same: [1, 0] }),
      { directory },
    );
    const old = await store.store(
      input("old", "no-contradiction", ["claim:shared"], "old", "derived-from-claims"),
    );
    const fuzzy = await store.store(
      input("fuzzy", "contradiction", ["claim:different"], "fuzzy", "derived-from-claims"),
    );
    const same = await store.store(
      input("same", "no-contradiction", ["claim:shared"], "same", "derived-from-claims"),
    );
    const newer = await store.store(
      input("newer", "contradiction", ["claim:shared"], "newer", "derived-from-claims"),
    );

    expect(fuzzy.conflicts).toEqual([]);
    expect(same.conflicts).toEqual([]);
    expect(newer.conflicts).toHaveLength(2);
    expect(newer.conflicts.map((c) => c.olderFindingId).sort()).toEqual(
      [old.finding.id, same.finding.id].sort(),
    );
    expect(await store.getStats()).toMatchObject({
      active: 4,
      openConflicts: 2,
    });
  });

  it("flags cross-method outcome disagreements only for the exact same corpus", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ hand: [1, 0], typed: [1, 0], other: [1, 0] }),
      { directory },
    );
    const hand = await store.store({
      ...input("hand", "contradiction", ["fol:one"], "hand", "hand-authored"),
      corpusId: "origin-of-genetic-code",
    });
    const other = await store.store({
      ...input(
        "other",
        "inconclusive",
        ["claim:one"],
        "other",
        "derived-from-claims",
      ),
      corpusId: "different-corpus",
    });
    const typed = await store.store({
      ...input(
        "typed",
        "inconclusive",
        ["claim:two"],
        "typed",
        "derived-from-claims",
      ),
      corpusId: "origin-of-genetic-code",
    });

    expect(other.conflicts).toEqual([]);
    expect(typed.conflicts).toEqual([
      expect.objectContaining({
        olderFindingId: hand.finding.id,
        basis: "shared-corpus",
        sharedCorpusId: "origin-of-genetic-code",
        sharedClaims: [],
      }),
    ]);
  });

  it("backfills cross-method candidates already present in a legacy index", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ hand: [1, 0], typed: [1, 0] }),
      { directory },
    );
    await store.store({
      ...input("hand", "contradiction", ["fol:one"], "hand", "hand-authored"),
      corpusId: "origin-of-genetic-code",
    });
    await store.store({
      ...input(
        "typed",
        "inconclusive",
        ["claim:one"],
        "typed",
        "derived-from-claims",
      ),
      corpusId: "origin-of-genetic-code",
    });
    const indexPath = join(directory, "index.json");
    const legacy = JSON.parse(await readFile(indexPath, "utf8"));
    legacy.conflicts = [];
    await writeFile(indexPath, JSON.stringify(legacy), "utf8");

    expect(await store.listOpenConflicts()).toEqual([
      expect.objectContaining({
        basis: "shared-corpus",
        sharedCorpusId: "origin-of-genetic-code",
      }),
    ]);
  });

  it("surfaces a candidate without silently superseding, then archives on explicit resolution", async () => {
    const graph = new FakeGraph();
    const store = new FindingStore(
      new FakeEmbedder({ old: [1, 0], newer: [1, 0] }),
      { directory, graph },
    );
    const old = await store.store(
      input("old", "no-contradiction", ["claim:shared"], "old", "derived-from-claims"),
    );
    const newer = await store.store(
      input("newer", "contradiction", ["claim:shared"], "newer", "derived-from-claims"),
    );
    const candidate = newer.conflicts[0];

    expect(await store.getStats()).toMatchObject({ active: 2, archived: 0 });
    const resolved = await store.resolveConflict(
      candidate.id,
      newer.finding.id,
      "The newer run covered the missing claim.",
    );

    expect(resolved.status).toBe("resolved");
    expect(await store.getStats()).toMatchObject({ active: 1, archived: 1 });
    expect(graph.supersedes).toEqual([
      [
        newer.finding.id,
        old.finding.id,
        "The newer run covered the missing claim.",
      ],
    ]);
  });

  it("does not turn matching hand-authored formula strings into graph conflicts", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ old: [1, 0], newer: [1, 0] }),
      { directory },
    );
    await store.store(input("old", "no-contradiction", ["fol:shared"]));
    const newer = await store.store(
      input("newer", "contradiction", ["fol:shared"]),
    );
    expect(newer.conflicts).toEqual([]);
  });

  it("sinks old findings that were never recalled or cited but preserves cited findings", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const store = new FindingStore(
      new FakeEmbedder({ unused: [1, 0], cited: [1, 0], miss: [0, 1] }),
      {
        directory,
        similarityFloor: 0.9,
        unusedRetentionDays: 10,
        now: () => now,
      },
    );
    const unused = await store.store(
      input("unused", "contradiction", ["unused"]),
    );
    const cited = await store.store(
      input("cited", "contradiction", ["cited"]),
    );
    await store.recordCitations(
      `Used [finding:${cited.finding.id}]`,
      [unused.finding.id, cited.finding.id],
    );

    now = new Date("2026-01-12T00:00:00.000Z");
    await store.recall("miss", { memoryNamespace: "default-test" });

    expect(await store.getStats()).toEqual({
      active: 1,
      archived: 1,
      openConflicts: 0,
    });
  });

  it("enforces an absolute hot-index cap and deduplicates retries within one run", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ one: [1, 0], two: [1, 0], three: [1, 0] }),
      { directory, maxActive: 2 },
    );
    const one = input("one", "contradiction", ["a"], "run-1");
    expect((await store.store(one)).stored).toBe(true);
    expect((await store.store(one)).stored).toBe(false);
    await store.store(input("two", "contradiction", ["b"], "run-2"));
    await store.store(input("three", "contradiction", ["c"], "run-3"));
    expect(await store.getStats()).toEqual({
      active: 2,
      archived: 1,
      openConflicts: 0,
    });
  });

  it("keeps open conflict records resolvable without exceeding the cosine hot cap", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ one: [1, 0], two: [1, 0], three: [1, 0], cue: [1, 0] }),
      { directory, maxActive: 1, topK: 3, similarityFloor: 0.4 },
    );
    await store.store(
      input("one", "no-contradiction", ["claim:x"], "one", "derived-from-claims"),
    );
    await store.store(
      input("two", "contradiction", ["claim:x"], "two", "derived-from-claims"),
    );
    await store.store(
      input("three", "no-contradiction", ["claim:x"], "three", "derived-from-claims"),
    );

    expect(
      await store.recall("cue", { memoryNamespace: "default-test" }),
    ).toHaveLength(1);
    expect((await store.listOpenConflicts()).length).toBeGreaterThan(0);
  });

  it("dismisses other open candidates involving a finding once it is superseded", async () => {
    const store = new FindingStore(
      new FakeEmbedder({ old: [1, 0], newer: [1, 0], peer: [1, 0] }),
      { directory },
    );
    const old = await store.store(
      input("old", "no-contradiction", ["claim:x"], "old", "derived-from-claims"),
    );
    const peer = await store.store(
      input("peer", "no-contradiction", ["claim:x"], "peer", "derived-from-claims"),
    );
    const newer = await store.store(
      input("newer", "contradiction", ["claim:x"], "newer", "derived-from-claims"),
    );
    expect(newer.conflicts).toHaveLength(2);

    const againstOld = newer.conflicts.find(
      (candidate) => candidate.olderFindingId === old.finding.id,
    )!;
    await store.resolveConflict(
      againstOld.id,
      old.finding.id,
      "Keep the older result.",
    );

    expect(await store.listOpenConflicts()).toEqual([]);
    expect((await store.getStats()).active).toBe(2);
    expect(peer.finding.id).not.toBe(old.finding.id);
  });
});
