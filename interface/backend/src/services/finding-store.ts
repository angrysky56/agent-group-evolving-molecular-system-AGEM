/**
 * Automatic long-term finding memory.
 *
 * Recall is semantic (one cue embedding, cosine floor, then top-k). Conflict
 * detection is deliberately not semantic: same-method comparisons require
 * exact supporting-claim overlap; cross-method comparisons require exact
 * corpus identity. Embedding resemblance never defines a conflict.
 *
 * The hot index is a small JSON file because TypeDB cannot perform vector
 * retrieval. Findings and evidence relations are also mirrored into TypeDB by
 * FindingGraph when it is available. TypeDB is optional; memory is not.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IEmbedder } from "#agem/lcm/interfaces.js";
import { settings } from "../config.js";

export type FindingMethod = "derived-from-claims" | "hand-authored";
export type FindingOutcome =
  | "contradiction"
  | "no-contradiction"
  | "inconclusive";
export type FindingSemanticVerdictKind =
  | "position-contradiction"
  | "corpus-contradiction"
  | "no-contradiction"
  | "inconclusive";

export interface VerificationDependencies {
  corpusHash: string;
  segmentationVersion: string;
  supportingClaimIds: string[];
  normalizedClaimKeys: string[];
  ontologyVersion: string;
  extractionSchemaVersion: string;
  sourceSemanticValidatorVersion: string;
  formalizerVersion: string;
  proverVersion: string;
  solverSettings: Record<string, string | number | boolean | null>;
}

export type VerificationDependencyName = keyof VerificationDependencies;

export interface VerificationDependencyChange {
  dependency: VerificationDependencyName;
  before: unknown;
  after: unknown;
}

export interface FindingInput {
  verdict: string;
  /**
   * What this finding is ABOUT — the retrieval key, distinct from the content.
   *
   * Recall used to embed `verdict`, and `verdict` is written in the prover's
   * register: "CONTRADICTION FOUND — 5 minimal unsatisfiable set(s): {Frozen
   * Accident, Stereochemical Affinity} (arity 2) — the clash is exactly:
   * -affinity_determined(code) ...". That string says what was concluded but
   * barely says what the subject matter was, so a person opening a session with
   * "let's continue the genetic code work" scored 0.199 against it — well under
   * the 0.4 floor — while "let's talk about sourdough baking" scored 0.208.
   * Relevant and irrelevant cues were not separable, so lowering the floor
   * would have bought noise rather than memory. Recall only worked at all when
   * the cue happened to be an entire corpus.
   *
   * Keying on topic instead fixes both ends: "origin of the genetic code" goes
   * 0.217 → 0.473 and clears the floor, while sourdough stays out at 0.183 and
   * an unrelated philosophy-of-mind opener stays out at 0.106.
   *
   * The verdict remains stored and returned verbatim. Only the index key
   * changes — this is not a compressed payload standing in as evidence.
   */
  topicKey?: string;
  coverage: string;
  notRuledOut?: string;
  runLogId: string;
  producedByModel: string;
  method: FindingMethod;
  outcome: FindingOutcome;
  corpusId: string;
  /** Hard retrieval boundary. Similarity never crosses it unless opted in. */
  memoryNamespace: string;
  /** Required safety receipts for findings derived from extracted claims. */
  attributionValidated?: boolean;
  semanticsValidated?: boolean;
  semanticVerdictKind?: FindingSemanticVerdictKind;
  condensedNarrative?: string;
  /** Stable structural keys. These, not embeddings, define conflicts. */
  supportingClaims: string[];
  /** Concrete TypeDB claim occurrence ids used to construct evidences. */
  supportingClaimRefs?: string[];
  /** Exact semantic inputs needed to decide whether this result is still current. */
  verificationDependencies?: VerificationDependencies;
}

export interface StoredFinding extends FindingInput {
  id: string;
  createdAt: string;
  embedding: number[];
  recallCount: number;
  citationCount: number;
  lastRecalledAt?: string;
  lastCitedAt?: string;
  /** conflict-held stays resolvable but is excluded from per-run cosine scans. */
  status:
    | "active"
    | "conflict-held"
    | "revalidation-required"
    | "superseded";
  supersededBy?: string;
  verificationFingerprint?: string;
  revalidationRequiredAt?: string;
  revalidationChanges?: VerificationDependencyChange[];
  fingerprint: string;
}

export interface RevalidationAuditResult {
  scanned: number;
  marked: number;
  unchanged: number;
  truncated: boolean;
  findings: Array<{
    findingId: string;
    verificationFingerprint: string;
    changes: VerificationDependencyChange[];
  }>;
}

export interface ConflictCandidate {
  id: string;
  newerFindingId: string;
  olderFindingId: string;
  sharedClaims: string[];
  basis?: "shared-claims" | "shared-corpus";
  sharedCorpusId?: string;
  createdAt: string;
  status: "open" | "resolved" | "dismissed";
  winnerFindingId?: string;
  reason?: string;
  resolvedAt?: string;
}

export interface RecallMatch {
  finding: Omit<StoredFinding, "embedding" | "fingerprint">;
  similarity: number;
  rankScore: number;
  conflicts: ConflictCandidate[];
}

export interface StoreFindingResult {
  finding: Omit<StoredFinding, "embedding" | "fingerprint">;
  stored: boolean;
  conflicts: ConflictCandidate[];
}

export interface FindingGraph {
  recordFinding(finding: StoredFinding): Promise<void>;
  recordSupersedes(
    winnerFindingId: string,
    loserFindingId: string,
    reason: string,
  ): Promise<void>;
  recordRevalidationRequired?(finding: StoredFinding): Promise<void>;
}

interface FindingIndex {
  version: 1;
  findings: StoredFinding[];
  conflicts: ConflictCandidate[];
  archivedCount: number;
}

export interface FindingStoreOptions {
  directory?: string;
  similarityFloor?: number;
  topK?: number;
  unusedRetentionDays?: number;
  maxActive?: number;
  now?: () => Date;
  graph?: FindingGraph;
}

export interface RecallOptions {
  memoryNamespace: string;
  /** Explicit research-mode opt-in for labeled cross-namespace recall. */
  includeOtherNamespaces?: boolean;
  signal?: AbortSignal;
}

const EMPTY_INDEX = (): FindingIndex => ({
  version: 1,
  findings: [],
  conflicts: [],
  archivedCount: 0,
});

export class FindingStore {
  readonly #embedder: IEmbedder;
  readonly #directory: string;
  readonly #indexPath: string;
  readonly #archivePath: string;
  readonly #similarityFloor: number;
  readonly #topK: number;
  readonly #unusedRetentionMs: number;
  readonly #maxActive: number;
  readonly #now: () => Date;
  readonly #graph?: FindingGraph;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(embedder: IEmbedder, options: FindingStoreOptions = {}) {
    this.#embedder = embedder;
    this.#directory =
      options.directory ??
      resolve(settings.all.KNOWLEDGE_BASE_PATH, "findings");
    this.#indexPath = join(this.#directory, "index.json");
    this.#archivePath = join(this.#directory, "archive.jsonl");
    this.#similarityFloor =
      options.similarityFloor ??
      settings.all.FINDING_RECALL_SIMILARITY_FLOOR;
    this.#topK = options.topK ?? settings.all.FINDING_RECALL_TOP_K;
    this.#unusedRetentionMs =
      (options.unusedRetentionDays ??
        settings.all.FINDING_UNUSED_RETENTION_DAYS) *
      24 *
      60 *
      60 *
      1000;
    this.#maxActive = options.maxActive ?? settings.all.FINDING_MAX_ACTIVE;
    this.#now = options.now ?? (() => new Date());
    this.#graph = options.graph;
  }

  async store(input: FindingInput, signal?: AbortSignal): Promise<StoreFindingResult> {
    if (!input.verdict.trim() || !input.coverage.trim()) {
      throw new Error("A reusable finding requires both verdict and coverage.");
    }
    if (input.supportingClaims.length === 0) {
      throw new Error("A reusable finding requires at least one supporting claim.");
    }
    if (!input.memoryNamespace.trim()) {
      throw new Error("A reusable finding requires a memory namespace.");
    }
    if (
      input.method === "derived-from-claims" &&
      (input.attributionValidated !== true ||
        input.semanticsValidated !== true ||
        !input.semanticVerdictKind)
    ) {
      throw new Error(
        "A derived finding requires attribution and semantic-validation receipts.",
      );
    }

    return this.#serial(async () => {
      const index = await this.#readIndex();
      const normalizedInput: FindingInput = {
        ...input,
        supportingClaims: [...new Set(input.supportingClaims)].sort(),
        supportingClaimRefs: input.supportingClaimRefs
          ? [...new Set(input.supportingClaimRefs)].sort()
          : undefined,
      };
      const fingerprint = findingFingerprint(normalizedInput);
      const duplicate = index.findings.find(
        (f) => f.fingerprint === fingerprint,
      );
      if (duplicate) {
        return {
          finding: publicFinding(duplicate),
          stored: false,
          conflicts: this.#conflictsFor(index, duplicate.id),
        };
      }

      // Index on topic, not on the prover's phrasing. Falls back to the
      // verdict so a caller that supplies no topic still gets stored and
      // recalled exactly as before.
      const vector = await this.#embedder.embed(
        input.topicKey?.trim() || input.verdict,
        signal,
      );
      const now = this.#now().toISOString();
      const finding: StoredFinding = {
        ...normalizedInput,
        id: randomUUID(),
        createdAt: now,
        embedding: Array.from(vector),
        recallCount: 0,
        citationCount: 0,
        status: "active",
        verificationFingerprint: normalizedInput.verificationDependencies
          ? verificationFingerprint(normalizedInput.verificationDependencies)
          : undefined,
        fingerprint,
      };

      const conflicts: ConflictCandidate[] = [];
      // Same-method conflicts remain graph-structural: only exact typed claim
      // overlap and opposite conclusive outcomes qualify. Cross-method results
      // cannot share key spaces, so they use exact corpus identity instead.
      // An inconclusive result may disagree cross-method with a conclusive one:
      // that is a review candidate, never an automatic winner.
      if (isConclusive(finding.outcome) || finding.outcome === "inconclusive") {
        for (const older of index.findings) {
          if (
            older.status === "superseded" ||
            older.outcome === finding.outcome
          ) {
            continue;
          }
          const evidence = conflictEvidence(finding, older);
          if (!evidence) continue;
          const alreadyOpen = index.conflicts.some(
            (candidate) =>
              candidate.status === "open" &&
              candidate.newerFindingId === finding.id &&
              candidate.olderFindingId === older.id,
          );
          if (alreadyOpen) continue;
          const candidate: ConflictCandidate = {
            id: randomUUID(),
            newerFindingId: finding.id,
            olderFindingId: older.id,
            sharedClaims: evidence.sharedClaims,
            basis: evidence.basis,
            sharedCorpusId: evidence.sharedCorpusId,
            createdAt: now,
            status: "open",
          };
          index.conflicts.push(candidate);
          conflicts.push(candidate);
        }
      }

      index.findings.push(finding);
      await this.#sink(index);
      await this.#writeIndex(index);
      await this.#mirror(() => this.#graph?.recordFinding(finding));
      return { finding: publicFinding(finding), stored: true, conflicts };
    });
  }

  /** One cue embedding, raw cosine floor, then a bounded ranked result. */
  async recall(cue: string, options: RecallOptions): Promise<RecallMatch[]> {
    if (!cue.trim()) return [];
    const memoryNamespace = options.memoryNamespace.trim();
    if (!memoryNamespace) return [];
    const cueVector = await this.#embedder.embed(boundCue(cue), options.signal);

    return this.#serial(async () => {
      const index = await this.#readIndex();
      await this.#sink(index);
      const now = this.#now();
      const ranked = index.findings
        .filter(
          (finding) =>
            finding.status === "active" &&
            isRecallEligible(finding) &&
            (options.includeOtherNamespaces === true ||
              finding.memoryNamespace === memoryNamespace),
        )
        .map((finding) => {
          const similarity = cosine(cueVector, finding.embedding);
          const ageFraction = Math.min(
            1,
            Math.max(
              0,
              (now.getTime() - new Date(finding.createdAt).getTime()) /
                this.#unusedRetentionMs,
            ),
          );
          const unusedPenalty =
            finding.recallCount === 0 && finding.citationCount === 0
              ? ageFraction * 0.05
              : 0;
          const usageBoost = Math.min(
            0.05,
            finding.citationCount * 0.01 + finding.recallCount * 0.002,
          );
          return {
            finding,
            similarity,
            rankScore: similarity - unusedPenalty + usageBoost,
          };
        })
        // The floor applies to raw resemblance. Ranking cannot rescue noise.
        .filter((match) => match.similarity >= this.#similarityFloor)
        .sort(
          (a, b) =>
            b.rankScore - a.rankScore ||
            b.similarity - a.similarity ||
            b.finding.createdAt.localeCompare(a.finding.createdAt),
        )
        .slice(0, this.#topK);

      const recalledAt = now.toISOString();
      for (const match of ranked) {
        match.finding.recallCount++;
        match.finding.lastRecalledAt = recalledAt;
      }
      await this.#writeIndex(index);

      return ranked.map((match) => ({
        finding: publicFinding(match.finding),
        similarity: match.similarity,
        rankScore: match.rankScore,
        conflicts: this.#conflictsFor(index, match.finding.id),
      }));
    });
  }

  /**
   * Compare a bounded number of current findings with semantic dependency
   * overrides. Omitted fields keep their recorded value, so callers can audit
   * a runtime/schema upgrade without fabricating corpus-specific inputs.
   */
  async auditVerificationDependencies(
    overrides: Partial<VerificationDependencies>,
    options: { limit?: number; memoryNamespace?: string } = {},
  ): Promise<RevalidationAuditResult> {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
    return this.#serial(async () => {
      const index = await this.#readIndex();
      const eligible = index.findings
        .filter(
          (finding) =>
            finding.method === "derived-from-claims" &&
            finding.status !== "superseded" &&
            finding.status !== "revalidation-required" &&
            !!finding.verificationDependencies &&
            (!options.memoryNamespace ||
              finding.memoryNamespace === options.memoryNamespace),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const selected = eligible.slice(0, limit);
      const findings: RevalidationAuditResult["findings"] = [];
      let unchanged = 0;
      for (const finding of selected) {
        const before = finding.verificationDependencies!;
        const after = normalizeVerificationDependencies({
          ...before,
          ...overrides,
        });
        const changes = verificationDependencyChanges(before, after);
        if (changes.length === 0) {
          unchanged++;
          continue;
        }
        finding.status = "revalidation-required";
        finding.revalidationRequiredAt = this.#now().toISOString();
        finding.revalidationChanges = changes;
        const nextFingerprint = verificationFingerprint(after);
        findings.push({
          findingId: finding.id,
          verificationFingerprint: nextFingerprint,
          changes,
        });
      }
      if (findings.length > 0) {
        await this.#writeIndex(index);
        for (const finding of selected.filter(
          (item) => item.status === "revalidation-required",
        )) {
          await this.#mirror(() =>
            this.#graph?.recordRevalidationRequired?.(finding),
          );
        }
      }
      return {
        scanned: selected.length,
        marked: findings.length,
        unchanged,
        truncated: eligible.length > selected.length,
        findings,
      };
    });
  }

  /** Count only explicit `[finding:<id>]` citations from this run's recalls. */
  async recordCitations(
    text: string,
    eligibleFindingIds: readonly string[],
  ): Promise<string[]> {
    const cited = eligibleFindingIds.filter((id) =>
      text.includes(`[finding:${id}]`),
    );
    if (cited.length === 0) return [];
    return this.#serial(async () => {
      const index = await this.#readIndex();
      const citedAt = this.#now().toISOString();
      const updated: string[] = [];
      for (const finding of index.findings) {
        if (!cited.includes(finding.id)) continue;
        finding.citationCount++;
        finding.lastCitedAt = citedAt;
        updated.push(finding.id);
      }
      if (updated.length > 0) await this.#writeIndex(index);
      return updated;
    });
  }

  listOpenConflicts(): Promise<ConflictCandidate[]> {
    return this.#serial(async () => {
      const index = await this.#readIndex();
      if (this.#backfillConflicts(index) > 0) {
        await this.#sink(index);
        await this.#writeIndex(index);
      }
      return index.conflicts
        .filter((candidate) => candidate.status === "open")
        .map((candidate) => ({ ...candidate, sharedClaims: [...candidate.sharedClaims] }));
    });
  }

  async resolveConflict(
    candidateId: string,
    winnerFindingId: string,
    reason: string,
  ): Promise<ConflictCandidate> {
    if (!reason.trim()) throw new Error("A supersession reason is required.");
    return this.#serial(async () => {
      const index = await this.#readIndex();
      const candidate = index.conflicts.find((c) => c.id === candidateId);
      if (!candidate) throw new Error(`Conflict candidate '${candidateId}' not found.`);
      if (candidate.status === "resolved") return { ...candidate };
      const participants = [
        candidate.newerFindingId,
        candidate.olderFindingId,
      ];
      if (!participants.includes(winnerFindingId)) {
        throw new Error("Winner must be one of the conflict candidate's findings.");
      }
      const loserFindingId = participants.find((id) => id !== winnerFindingId)!;
      const loser = index.findings.find((finding) => finding.id === loserFindingId);
      if (!loser) throw new Error(`Losing finding '${loserFindingId}' is not active.`);
      const winner = index.findings.find(
        (finding) => finding.id === winnerFindingId,
      );
      if (!winner) throw new Error(`Winning finding '${winnerFindingId}' is not active.`);

      loser.status = "superseded";
      loser.supersededBy = winnerFindingId;
      winner.status = "active";
      candidate.status = "resolved";
      candidate.winnerFindingId = winnerFindingId;
      candidate.reason = reason.trim();
      candidate.resolvedAt = this.#now().toISOString();

      // A retired finding may participate in several candidates. Leave no
      // dangling "open" conflicts that can no longer be resolved from the hot
      // index; dismiss them transparently with the reason recorded.
      for (const related of index.conflicts) {
        if (
          related.id === candidate.id ||
          related.status !== "open" ||
          (related.newerFindingId !== loserFindingId &&
            related.olderFindingId !== loserFindingId)
        ) {
          continue;
        }
        related.status = "dismissed";
        related.reason =
          `Finding ${loserFindingId} was superseded while resolving candidate ${candidate.id}.`;
        related.resolvedAt = candidate.resolvedAt;
      }

      await this.#archiveFindings(index, [loser], "superseded");
      await this.#sink(index);
      await this.#writeIndex(index);
      await this.#mirror(() =>
        this.#graph?.recordSupersedes(
          winnerFindingId,
          loserFindingId,
          reason.trim(),
        ),
      );
      return { ...candidate, sharedClaims: [...candidate.sharedClaims] };
    });
  }

  getStats(): Promise<{
    active: number;
    archived: number;
    openConflicts: number;
  }> {
    return this.#serial(async () => {
      const index = await this.#readIndex();
      return {
        active: index.findings.filter(
          (f) =>
            f.status !== "superseded" &&
            f.status !== "revalidation-required",
        ).length,
        archived: index.archivedCount,
        openConflicts: index.conflicts.filter((c) => c.status === "open").length,
      };
    });
  }

  #conflictsFor(index: FindingIndex, findingId: string): ConflictCandidate[] {
    return index.conflicts
      .filter(
        (candidate) =>
          candidate.status === "open" &&
          (candidate.newerFindingId === findingId ||
            candidate.olderFindingId === findingId),
      )
      .map((candidate) => ({ ...candidate, sharedClaims: [...candidate.sharedClaims] }));
  }

  #backfillConflicts(index: FindingIndex): number {
    let added = 0;
    const now = this.#now().toISOString();
    for (let newerIndex = 1; newerIndex < index.findings.length; newerIndex++) {
      const newer = index.findings[newerIndex];
      if (newer.status === "superseded") continue;
      for (let olderIndex = 0; olderIndex < newerIndex; olderIndex++) {
        const older = index.findings[olderIndex];
        if (older.status === "superseded") continue;
        const exists = index.conflicts.some(
          (candidate) =>
            (candidate.newerFindingId === newer.id &&
              candidate.olderFindingId === older.id) ||
            (candidate.newerFindingId === older.id &&
              candidate.olderFindingId === newer.id),
        );
        if (exists) continue;
        const evidence = conflictEvidence(newer, older);
        if (!evidence) continue;
        index.conflicts.push({
          id: randomUUID(),
          newerFindingId: newer.id,
          olderFindingId: older.id,
          sharedClaims: evidence.sharedClaims,
          basis: evidence.basis,
          sharedCorpusId: evidence.sharedCorpusId,
          createdAt: now,
          status: "open",
        });
        added++;
      }
    }
    return added;
  }

  async #sink(index: FindingIndex): Promise<void> {
    const protectedIds = new Set(
      index.conflicts
        .filter((candidate) => candidate.status === "open")
        .flatMap((candidate) => [
          candidate.newerFindingId,
          candidate.olderFindingId,
        ]),
    );
    const nowMs = this.#now().getTime();
    // Once every conflict holding a cold finding is closed, it may re-enter the
    // hot pool and compete normally for retention/cap space.
    for (const finding of index.findings) {
      if (finding.status === "conflict-held" && !protectedIds.has(finding.id)) {
        finding.status = "active";
      }
    }
    const staleUnused = index.findings.filter(
      (finding) =>
        finding.status === "active" &&
        !protectedIds.has(finding.id) &&
        finding.recallCount === 0 &&
        finding.citationCount === 0 &&
        nowMs - new Date(finding.createdAt).getTime() >=
          this.#unusedRetentionMs,
    );
    await this.#archiveFindings(index, staleUnused, "unused-retention");

    const hotCount = index.findings.filter(
      (finding) => finding.status === "active",
    ).length;
    const overflow = Math.max(0, hotCount - this.#maxActive);
    if (overflow === 0) return;
    const sinkOrder = index.findings
      .filter(
        (finding) =>
          finding.status === "active" && !protectedIds.has(finding.id),
      )
      .sort((a, b) => {
        const aUsage = a.recallCount + a.citationCount * 4;
        const bUsage = b.recallCount + b.citationCount * 4;
        return aUsage - bUsage || a.createdAt.localeCompare(b.createdAt);
      })
      .slice(0, overflow);
    await this.#archiveFindings(index, sinkOrder, "hot-index-cap");

    // Open conflicts are never archived automatically, but they must not break
    // the per-run cosine bound. Hold the oldest protected findings cold while
    // retaining their full records for explicit resolution.
    const remainingOverflow = Math.max(
      0,
      index.findings.filter((finding) => finding.status === "active").length -
        this.#maxActive,
    );
    if (remainingOverflow > 0) {
      index.findings
        .filter(
          (finding) =>
            finding.status === "active" && protectedIds.has(finding.id),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, remainingOverflow)
        .forEach((finding) => {
          finding.status = "conflict-held";
        });
    }
  }

  async #archiveFindings(
    index: FindingIndex,
    findings: readonly StoredFinding[],
    reason: string,
  ): Promise<void> {
    if (findings.length === 0) return;
    const ids = new Set(findings.map((finding) => finding.id));
    await mkdir(this.#directory, { recursive: true });
    const archivedAt = this.#now().toISOString();
    await appendFile(
      this.#archivePath,
      findings
        .map((finding) =>
          JSON.stringify({ archivedAt, reason, finding }),
        )
        .join("\n") + "\n",
      "utf8",
    );
    index.findings = index.findings.filter((finding) => !ids.has(finding.id));
    index.archivedCount += findings.length;
  }

  async #readIndex(): Promise<FindingIndex> {
    try {
      const parsed = JSON.parse(await readFile(this.#indexPath, "utf8")) as Partial<FindingIndex>;
      if (parsed.version !== 1 || !Array.isArray(parsed.findings)) {
        throw new Error("unsupported or malformed finding index");
      }
      return {
        version: 1,
        findings: parsed.findings.map((finding) => ({
          ...finding,
          // Legacy records predate namespaces. Corpus identity is the safest
          // available retrieval boundary; never promote them to global scope.
          memoryNamespace:
            finding.memoryNamespace?.trim() || finding.corpusId,
          // A legacy typed finding without a semantic dependency receipt is
          // history, not current evidence. Keep it, label it, and exclude it
          // from ordinary recall until a fresh verification creates a new
          // finding.
          ...(finding.method === "derived-from-claims" &&
          !finding.verificationDependencies
            ? {
                status: "revalidation-required" as const,
                revalidationChanges: finding.revalidationChanges ?? [],
              }
            : {}),
        })),
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        archivedCount: Number(parsed.archivedCount ?? 0),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[FindingStore] Could not read index; refusing to overwrite it:", error);
        throw error;
      }
      return EMPTY_INDEX();
    }
  }

  async #writeIndex(index: FindingIndex): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const tempPath = `${this.#indexPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(index), "utf8");
    await rename(tempPath, this.#indexPath);
  }

  async #mirror(action: () => Promise<void> | undefined): Promise<void> {
    try {
      await action();
    } catch (error) {
      // The local semantic index is authoritative for availability. TypeDB is
      // a richer structural mirror and must not take chat offline.
      console.warn("[FindingStore] TypeDB mirror failed:", error);
    }
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function publicFinding(
  finding: StoredFinding,
): Omit<StoredFinding, "embedding" | "fingerprint"> {
  const { embedding: _embedding, fingerprint: _fingerprint, ...rest } = finding;
  return {
    ...rest,
    supportingClaims: [...rest.supportingClaims],
    supportingClaimRefs: rest.supportingClaimRefs
      ? [...rest.supportingClaimRefs]
      : undefined,
    verificationDependencies: rest.verificationDependencies
      ? normalizeVerificationDependencies(rest.verificationDependencies)
      : undefined,
    revalidationChanges: rest.revalidationChanges?.map((change) => ({
      ...change,
    })),
  };
}

/**
 * Longest cue worth embedding.
 *
 * The embedding model has a fixed context and the provider does not truncate —
 * it returns HTTP 500. `ProviderEmbedder` then falls back to a hash-based mock
 * vector, which is semantically unrelated to everything, so recall silently
 * returns nothing and the run proceeds as if there were no memory at all. No
 * error surfaces anywhere.
 *
 * Measured with embeddinggemma: a 10,256-char corpus embedded fine and scored
 * 0.641 against its own stored finding; the same corpus behind a 1,981-char
 * instruction prefix — 12,237 chars total — returned 500, and that run recalled
 * nothing despite being about the exact topic it had already analysed.
 *
 * The head of a cue carries the topic, so truncating is safe where silently
 * hashing is not.
 *
 * Sized for the configured embedding model with margin, NOT to its limit:
 * nvidia/nemotron-3-embed-1b accepted 31,987 chars (~5.5k tokens) in testing
 * against a 33k-token context, but one 32k call had already failed once as a
 * free-tier flake. Since any failure degrades silently, the bound is set where
 * throughput is reliable rather than where the model stops. Re-measure with
 * scripts/probe-embedding-model.py before raising it or changing model.
 */
const MAX_CUE_CHARS = 24_000;

function boundCue(cue: string): string {
  return cue.length > MAX_CUE_CHARS ? cue.slice(0, MAX_CUE_CHARS) : cue;
}

function findingFingerprint(input: FindingInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        runLogId: input.runLogId,
        memoryNamespace: input.memoryNamespace,
        semanticVerdictKind: input.semanticVerdictKind ?? null,
        method: input.method,
        verdict: input.verdict,
        supportingClaims: input.supportingClaims,
      }),
      "utf8",
    )
    .digest("hex");
}

export function verificationFingerprint(
  dependencies: VerificationDependencies,
): string {
  return createHash("sha256")
    .update(stableJson(normalizeVerificationDependencies(dependencies)), "utf8")
    .digest("hex");
}

export function verificationDependencyChanges(
  before: VerificationDependencies,
  after: VerificationDependencies,
): VerificationDependencyChange[] {
  const normalizedBefore = normalizeVerificationDependencies(before);
  const normalizedAfter = normalizeVerificationDependencies(after);
  return (Object.keys(normalizedBefore) as VerificationDependencyName[])
    .filter(
      (dependency) =>
        stableJson(normalizedBefore[dependency]) !==
        stableJson(normalizedAfter[dependency]),
    )
    .map((dependency) => ({
      dependency,
      before: normalizedBefore[dependency],
      after: normalizedAfter[dependency],
    }));
}

function normalizeVerificationDependencies(
  dependencies: VerificationDependencies,
): VerificationDependencies {
  return {
    ...dependencies,
    supportingClaimIds: [...new Set(dependencies.supportingClaimIds)].sort(),
    normalizedClaimKeys: [...new Set(dependencies.normalizedClaimKeys)].sort(),
    solverSettings: Object.fromEntries(
      Object.entries(dependencies.solverSettings).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isConclusive(
  outcome: FindingOutcome,
): outcome is "contradiction" | "no-contradiction" {
  return outcome === "contradiction" || outcome === "no-contradiction";
}

function isRecallEligible(finding: StoredFinding): boolean {
  return (
    finding.method !== "derived-from-claims" ||
    (finding.attributionValidated === true &&
      finding.semanticsValidated === true &&
      !!finding.semanticVerdictKind)
  );
}

function conflictEvidence(
  newer: StoredFinding,
  older: StoredFinding,
): Pick<ConflictCandidate, "basis" | "sharedClaims" | "sharedCorpusId"> | null {
  if (newer.memoryNamespace !== older.memoryNamespace) return null;
  if (newer.outcome === older.outcome) return null;
  if (
    newer.method === "derived-from-claims" &&
    older.method === "derived-from-claims" &&
    isConclusive(newer.outcome) &&
    isConclusive(older.outcome)
  ) {
    const sharedClaims = intersection(
      newer.supportingClaims,
      older.supportingClaims,
    );
    return sharedClaims.length > 0
      ? { basis: "shared-claims", sharedClaims }
      : null;
  }
  if (
    newer.method !== older.method &&
    newer.corpusId === older.corpusId &&
    (isConclusive(newer.outcome) || isConclusive(older.outcome))
  ) {
    return {
      basis: "shared-corpus",
      sharedCorpusId: newer.corpusId,
      sharedClaims: [],
    };
  }
  return null;
}

function intersection(a: readonly string[], b: readonly string[]): string[] {
  const right = new Set(b);
  return [...new Set(a.filter((value) => right.has(value)))].sort();
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
