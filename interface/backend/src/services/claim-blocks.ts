import type { IEmbedder } from "#agem/lcm/interfaces.js";
import {
  claimToPropositions,
  type ExtractedClaim,
  type ExtractionOutcome,
} from "./claim-extractor.js";
import type { PredicateAliasSuggestion } from "./predicate-aliases.js";

export interface ClaimCommunity {
  id: number;
  label: string;
  members: readonly string[];
}

export interface PredicateMapping {
  source: string;
  canonical: string;
  method: "ontology" | "repair" | "unchanged";
}

export interface DerivedClaimBlock {
  name: string;
  propositions: string[];
  communityId?: number;
  communityIds: number[];
  communityLabel: string;
  positionLabel?: string;
  claimKeys: string[];
  claimRefs: string[];
  segmentIds: string[];
}

export interface ClaimBlockDerivation {
  blocks: DerivedClaimBlock[];
  predicateMapping: PredicateMapping[];
  /** Embedding candidates requiring human/ontology approval before use. */
  predicateAliasSuggestions: PredicateAliasSuggestion[];
  sharedExistencePredicates: string[];
  /** Automatically generated non-vacuity axioms, keyed by derived block. */
  injectedAxioms: Record<string, string[]>;
  rejected: Array<{ segmentId: string; reason: string }>;
}

export interface DeriveClaimBlocksOptions {
  communities?: readonly ClaimCommunity[];
  /** Caller-audited alias -> canonical predicate symbol. */
  ontology?: Readonly<Record<string, string>>;
  /** Segment id -> corpus position/section. Keeps rival positions separate. */
  positionBySegment?: Readonly<Record<string, string>>;
  /** Neutral corpus entities whose existence every position accepts. */
  sharedExistencePredicates?: readonly string[];
  embedder?: IEmbedder;
  similarityThreshold?: number;
}

export function mapSegmentsToPositions(
  segments: ReadonlyArray<{ id: string; text: string }>,
): Record<string, string> {
  const positions: Record<string, string> = {};
  let currentPosition: string | undefined;
  for (const segment of segments) {
    const heading = segment.text.trim().match(/^##\s+(.+)$/);
    if (heading?.[1]) {
      currentPosition = heading[1].trim();
      continue;
    }
    if (currentPosition && !segment.text.trim().startsWith("#")) {
      positions[segment.id] = currentPosition;
    }
  }
  return positions;
}

function symbol(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function labelKey(value: string): string {
  return symbol(value);
}

function labelTokens(value: string): Set<string> {
  return new Set(symbol(value).split("_").filter(Boolean));
}

function roleLabels(claim: ExtractedClaim): string[] {
  return Object.values(claim.roles).flatMap((value) =>
    (Array.isArray(value) ? value : [value]).map(String),
  );
}

const PRONOUN_SUBJECTS = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "this",
  "that",
  "these",
  "those",
]);

function subjectLabels(claim: ExtractedClaim): string[] {
  const role =
    claim.kind === "exclusion"
      ? "excluder"
      : claim.kind === "identity-claim"
        ? "identified"
        : claim.kind === "causal-claim"
          ? "cause"
          : claim.kind === "entailment"
            ? "antecedent"
            : claim.kind === "distinction"
              ? "distinguished"
              : "dissociable";
  const raw = claim.roles[role];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
}

function claimQualityIssue(claim: ExtractedClaim): string | null {
  const pronoun = subjectLabels(claim).find((label) =>
    PRONOUN_SUBJECTS.has(label.trim().toLowerCase()),
  );
  return pronoun ? `pronoun subject '${pronoun}' has no stable referent` : null;
}

function repairClauseLabel(label: string): string | null {
  const normalized = label.trim().toLowerCase().replace(/[_\s]+/g, "-");
  const match = normalized.match(
    /^(?:makes?|causes?|implies|means)-(?:the|a|an)-(.+)$/,
  );
  return match?.[1] ? symbol(match[1]) : null;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA > 0 && normB > 0
    ? dot / (Math.sqrt(normA) * Math.sqrt(normB))
    : -1;
}

async function resolvePredicates(
  labels: readonly string[],
  options: DeriveClaimBlocksOptions,
): Promise<{
  canonicalByLabel: Map<string, string>;
  mappings: Map<string, PredicateMapping>;
  suggestions: Array<Omit<PredicateAliasSuggestion, "severity">>;
}> {
  const ontology = new Map(
    Object.entries(options.ontology ?? {}).map(([alias, canonical]) => [
      labelKey(alias),
      symbol(canonical),
    ]),
  );
  const unique = [...new Set(labels)].sort((a, b) => a.localeCompare(b));
  const canonicalByLabel = new Map<string, string>();
  const mappings = new Map<string, PredicateMapping>();
  for (const label of unique) {
    const exact = ontology.get(labelKey(label));
    if (exact) {
      canonicalByLabel.set(label, exact);
      mappings.set(label, {
        source: label,
        canonical: exact,
        method: "ontology",
      });
      continue;
    }
    const repaired = repairClauseLabel(label);
    if (repaired) {
      canonicalByLabel.set(label, repaired);
      mappings.set(label, {
        source: label,
        canonical: repaired,
        method: "repair",
      });
    }
  }

  for (const label of unique) {
    if (canonicalByLabel.has(label)) continue;
    const canonical = symbol(label);
    canonicalByLabel.set(label, canonical);
    mappings.set(label, {
      source: label,
      canonical,
      method: "unchanged",
    });
  }

  if (!options.embedder || unique.length < 2) {
    return { canonicalByLabel, mappings, suggestions: [] };
  }

  const texts = unique.map((label) => label.replace(/[-_]+/g, " "));
  const vectors = options.embedder.embedBatch
    ? await options.embedder.embedBatch(texts)
    : await Promise.all(texts.map((text) => options.embedder!.embed(text)));
  const threshold = options.similarityThreshold ?? 0.86;
  const vectorByLabel = new Map(unique.map((label, i) => [label, vectors[i]]));
  const anchors = unique.filter(
    (label) => mappings.get(label)?.method === "ontology",
  );
  const unmatched = unique.filter(
    (label) => mappings.get(label)?.method === "unchanged",
  );
  const suggestions = new Map<
    string,
    Omit<PredicateAliasSuggestion, "severity">
  >();
  const suggestedToAnchor = new Set<string>();

  // Explicit caller aliases are useful comparison anchors, but similarity is
  // evidence for review, not authority to rewrite the extracted formalization.
  for (const label of unmatched) {
    const sourceVector = vectorByLabel.get(label)!;
    const best = anchors
      .map((anchor) => ({
        anchor,
        similarity: cosine(sourceVector, vectorByLabel.get(anchor)!),
      }))
      .filter(({ similarity }) => similarity >= threshold)
      .sort(
        (a, b) =>
          b.similarity - a.similarity || a.anchor.localeCompare(b.anchor),
      )[0];
    if (!best) continue;
    const proposedCanonical = canonicalByLabel.get(best.anchor)!;
    if (canonicalByLabel.get(label) === proposedCanonical) continue;
    suggestedToAnchor.add(label);
    suggestions.set(`${label}\0${best.anchor}`, {
      source: label,
      target: best.anchor,
      proposedCanonical,
      similarity: best.similarity,
    });
  }

  const free = unmatched.filter((label) => !suggestedToAnchor.has(label));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const similarity = cosine(
        vectorByLabel.get(free[i])!,
        vectorByLabel.get(free[j])!,
      );
      if (similarity < threshold) continue;
      const [target, source] = [free[i], free[j]].sort(
        (a, b) => symbol(a).length - symbol(b).length || a.localeCompare(b),
      );
      if (canonicalByLabel.get(source) === canonicalByLabel.get(target)) continue;
      suggestions.set(`${source}\0${target}`, {
        source,
        target,
        proposedCanonical: canonicalByLabel.get(target)!,
        similarity,
      });
    }
  }
  return {
    canonicalByLabel,
    mappings,
    suggestions: [...suggestions.values()].sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    ),
  };
}

function communityFor(
  sourceLabels: readonly string[],
  canonicalLabels: readonly string[],
  communities: readonly ClaimCommunity[],
): ClaimCommunity | undefined {
  const claimTokens = new Set(
    [...sourceLabels, ...canonicalLabels].flatMap((value) => [
      labelKey(value),
      ...labelTokens(value),
    ]),
  );
  return communities
    .map((community) => {
      const vocabulary = new Set(
        [community.label, ...community.members].flatMap((value) => [
          labelKey(value),
          ...labelTokens(value),
        ]),
      );
      let score = 0;
      for (const token of claimTokens) if (vocabulary.has(token)) score++;
      return { community, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.community.id - b.community.id,
    )[0]?.community;
}

function canonicalizeClaim(
  claim: ExtractedClaim,
  canonicalByLabel: ReadonlyMap<string, string>,
): ExtractedClaim {
  const roles = Object.fromEntries(
    Object.entries(claim.roles).map(([role, raw]) => {
      const convert = (value: string): string => {
        return canonicalByLabel.get(value) ?? symbol(value);
      };
      return [
        role,
        Array.isArray(raw) ? raw.map((value) => convert(String(value))) : convert(String(raw)),
      ];
    }),
  );
  return { ...claim, roles };
}

export async function deriveClaimBlocks(
  outcomes: readonly ExtractionOutcome[],
  options: DeriveClaimBlocksOptions = {},
): Promise<ClaimBlockDerivation> {
  const structurallyEligible = outcomes.filter(
    (outcome) => outcome.accepted && outcome.claimKey && outcome.claimId,
  );
  const rejected: ClaimBlockDerivation["rejected"] = [];
  const eligible = structurallyEligible.filter((outcome) => {
    const reason = claimQualityIssue(outcome.claim);
    if (!reason) return true;
    rejected.push({ segmentId: outcome.segmentId, reason });
    return false;
  });
  const {
    canonicalByLabel,
    mappings: predicateMapping,
    suggestions: rawPredicateAliasSuggestions,
  } =
    await resolvePredicates(
      eligible.flatMap((outcome) => roleLabels(outcome.claim)),
      options,
    );
  const callerExistencePredicates = [
    ...new Set(
      (options.sharedExistencePredicates ?? []).map(symbol).filter(Boolean),
    ),
  ].sort();
  const groups = new Map<string, DerivedClaimBlock>();
  const canonicalLabelsByGroup = new Map<string, Set<string>>();

  for (const outcome of eligible) {
    const sourceLabels = roleLabels(outcome.claim);
    const canonicalClaim = canonicalizeClaim(
      outcome.claim,
      canonicalByLabel,
    );
    const logical = claimToPropositions(canonicalClaim);
    if (!logical) {
      rejected.push({
        segmentId: outcome.segmentId,
        reason: "claim could not be converted to propositions",
      });
      continue;
    }
    const community = communityFor(
      sourceLabels,
      roleLabels(canonicalClaim),
      options.communities ?? [],
    );
    const positionLabel = options.positionBySegment?.[outcome.segmentId]?.trim();
    const groupKey = positionLabel
      ? `position:${positionLabel}`
      : community
        ? `community:${community.id}`
        : "community:unassigned";
    const block = groups.get(groupKey) ?? {
      name: positionLabel
        ? `position:${positionLabel}`
        : community
          ? `community:${community.id} ${community.label}`
          : "community:unassigned",
      propositions: [],
      communityId: community?.id,
      communityIds: community ? [community.id] : [],
      communityLabel: community?.label ?? "unassigned",
      positionLabel: positionLabel || undefined,
      claimKeys: [],
      claimRefs: [],
      segmentIds: [],
    };
    block.propositions.push(...logical.propositions);
    block.claimKeys.push(outcome.claimKey!);
    block.claimRefs.push(outcome.claimId!);
    block.segmentIds.push(outcome.segmentId);
    if (
      community &&
      !block.communityIds.includes(community.id)
    ) {
      block.communityIds.push(community.id);
    }
    groups.set(groupKey, block);
    const groupLabels = canonicalLabelsByGroup.get(groupKey) ?? new Set<string>();
    for (const label of roleLabels(canonicalClaim)) groupLabels.add(label);
    canonicalLabelsByGroup.set(groupKey, groupLabels);
  }

  /*
   * Connect position blocks automatically through neutral vocabulary they
   * demonstrably share. This is deliberately based on canonical typed roles,
   * not prose similarity: a role must occur in at least two distinct blocks.
   * The three most widely shared labels are enough to prevent a disconnected
   * nerve without flooding every block with domain assertions. Caller-audited
   * seeds remain additive and are never discarded.
   */
  const labelPositionCounts = new Map<string, number>();
  for (const labels of canonicalLabelsByGroup.values()) {
    for (const label of labels) {
      labelPositionCounts.set(label, (labelPositionCounts.get(label) ?? 0) + 1);
    }
  }
  const recurringExistencePredicates = [...labelPositionCounts]
    .filter(([, count]) => count >= 2)
    .sort(
      ([leftLabel, leftCount], [rightLabel, rightCount]) =>
        rightCount - leftCount || leftLabel.localeCompare(rightLabel),
    )
    .slice(0, 3)
    .map(([label]) => label);
  const sharedExistencePredicates = [
    ...new Set([
      ...callerExistencePredicates,
      ...recurringExistencePredicates,
    ]),
  ].sort();

  const blocks = [...groups.values()]
    .map((block) => ({
      ...block,
      propositions: [
        ...sharedExistencePredicates.map(
          (predicate) => `exists x (${predicate}(x))`,
        ),
        ...block.propositions,
      ].filter((value, index, all) => all.indexOf(value) === index),
      communityIds: [...block.communityIds].sort((a, b) => a - b),
      claimKeys: [...new Set(block.claimKeys)].sort(),
      claimRefs: [...new Set(block.claimRefs)].sort(),
      segmentIds: [...new Set(block.segmentIds)].sort(),
    }))
    .sort((a, b) => {
      if (a.positionLabel && b.positionLabel) return 0;
      if (a.positionLabel) return -1;
      if (b.positionLabel) return 1;
      if (a.communityId === undefined) return 1;
      if (b.communityId === undefined) return -1;
      return a.communityId - b.communityId;
    });
  const injectedAxioms = Object.fromEntries(
    blocks.map((block) => [
      block.name,
      block.propositions.filter((formula) => /^exists\b/.test(formula)),
    ]),
  );
  const predicateAliasSuggestions = rawPredicateAliasSuggestions.map(
    (suggestion): PredicateAliasSuggestion => {
      const sourceSymbol = canonicalByLabel.get(suggestion.source)!;
      const targetSymbol = canonicalByLabel.get(suggestion.target)!;
      const cooccurs = [...canonicalLabelsByGroup.values()].some(
        (labels) => labels.has(sourceSymbol) && labels.has(targetSymbol),
      );
      return {
        ...suggestion,
        severity: cooccurs ? "warning" : "critical",
      };
    },
  );

  return {
    blocks,
    predicateMapping: [...predicateMapping.values()].sort((a, b) =>
      a.source.localeCompare(b.source),
    ),
    predicateAliasSuggestions,
    sharedExistencePredicates,
    injectedAxioms,
    rejected,
  };
}
