import { createHash } from "node:crypto";
import {
  canonicalClaim,
  claimIdentity,
  claimSchemaIssue,
  normalizeClaimExtras,
  type ClaimKind,
  type ExtractedClaim,
} from "./claim-extractor.js";

export interface ClaimIncidenceNode {
  nodeType: "typed-claim";
  claimId: string;
  claimKey: string;
  claimKind: ClaimKind;
  canonicalClaim: string;
  segmentId: string;
  sourceSegmentId?: string;
}

export interface ClaimParticipantNode {
  nodeType: "concept";
  participantId: string;
  label: string;
}

export interface ClaimIncidenceEdge {
  incidenceId: string;
  claimId: string;
  participantId: string;
  role: string;
  /** Retains repeated-role order for a lossless structural round trip. */
  ordinal: number;
}

export interface ClaimIncidenceGraph {
  representation: "role-labelled-claim-incidence";
  verifierInput: true;
  claim: ClaimIncidenceNode;
  participants: ClaimParticipantNode[];
  incidences: ClaimIncidenceEdge[];
  attributes: Pick<
    ExtractedClaim,
    "scope" | "positionId" | "modality" | "polarity" | "differenceKind"
  >;
}

export interface DiagnosticCliqueProjection {
  representation: "diagnostic-clique-projection";
  verifierInput: false;
  sourceClaimId: string;
  sourceClaimKey: string;
  edges: Array<{ source: string; target: string }>;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function typedClaimToIncidence(
  rawClaim: ExtractedClaim,
  provenance: { segmentId: string; sourceSegmentId?: string },
): ClaimIncidenceGraph {
  const claim = normalizeClaimExtras(structuredClone(rawClaim));
  const issue = claimSchemaIssue(claim);
  if (issue) throw new Error(`cannot build incidence graph: ${issue}`);
  const identity = claimIdentity(claim, provenance.segmentId);
  const participantByLabel = new Map<string, ClaimParticipantNode>();
  const incidences: ClaimIncidenceEdge[] = [];

  for (const [role, raw] of Object.entries(claim.roles).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const labels = (Array.isArray(raw) ? raw : [raw]).map(String);
    labels.forEach((label, ordinal) => {
      let participant = participantByLabel.get(label);
      if (!participant) {
        participant = {
          nodeType: "concept",
          participantId: `concept:${digest(label)}`,
          label,
        };
        participantByLabel.set(label, participant);
      }
      incidences.push({
        incidenceId: `incidence:${digest(
          `${identity.claimId}\n${role}\n${ordinal}\n${label}`,
        )}`,
        claimId: identity.claimId,
        participantId: participant.participantId,
        role,
        ordinal,
      });
    });
  }

  return {
    representation: "role-labelled-claim-incidence",
    verifierInput: true,
    claim: {
      nodeType: "typed-claim",
      ...identity,
      claimKind: claim.kind,
      canonicalClaim: canonicalClaim(claim),
      segmentId: provenance.segmentId,
      ...(provenance.sourceSegmentId
        ? { sourceSegmentId: provenance.sourceSegmentId }
        : {}),
    },
    participants: [...participantByLabel.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
    incidences,
    attributes: {
      scope: claim.scope,
      ...(claim.positionId ? { positionId: claim.positionId } : {}),
      ...(claim.modality ? { modality: claim.modality } : {}),
      ...(claim.polarity ? { polarity: claim.polarity } : {}),
      ...(claim.differenceKind
        ? { differenceKind: claim.differenceKind }
        : {}),
    },
  };
}

export function incidenceToTypedClaim(graph: ClaimIncidenceGraph): ExtractedClaim {
  assertVerifierIncidence(graph);
  const labelById = new Map(
    graph.participants.map(({ participantId, label }) => [participantId, label]),
  );
  const grouped = new Map<string, Array<{ ordinal: number; label: string }>>();
  for (const incidence of graph.incidences) {
    if (incidence.claimId !== graph.claim.claimId) {
      throw new Error("incidence graph contains an edge for a different claim");
    }
    const label = labelById.get(incidence.participantId);
    if (!label) throw new Error("incidence graph references a missing participant");
    const values = grouped.get(incidence.role) ?? [];
    values.push({ ordinal: incidence.ordinal, label });
    grouped.set(incidence.role, values);
  }
  const roles: Record<string, string | string[]> = {};
  for (const [role, values] of grouped) {
    const labels = values.sort((a, b) => a.ordinal - b.ordinal).map(({ label }) => label);
    roles[role] = labels.length === 1 ? labels[0]! : labels;
  }
  const claim: ExtractedClaim = {
    kind: graph.claim.claimKind,
    roles,
    ...graph.attributes,
  };
  const issue = claimSchemaIssue(claim);
  if (issue) throw new Error(`incidence round trip produced an invalid claim: ${issue}`);
  if (claimIdentity(claim, graph.claim.segmentId).claimKey !== graph.claim.claimKey) {
    throw new Error("incidence round trip changed the stable claim identity");
  }
  return claim;
}

export function diagnosticCliqueProjection(
  graph: ClaimIncidenceGraph,
): DiagnosticCliqueProjection {
  const labels = graph.participants.map(({ label }) => label).sort();
  const edges: DiagnosticCliqueProjection["edges"] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      edges.push({ source: labels[i]!, target: labels[j]! });
    }
  }
  return {
    representation: "diagnostic-clique-projection",
    verifierInput: false,
    sourceClaimId: graph.claim.claimId,
    sourceClaimKey: graph.claim.claimKey,
    edges,
  };
}

export function assertVerifierIncidence(
  value: ClaimIncidenceGraph | DiagnosticCliqueProjection,
): asserts value is ClaimIncidenceGraph {
  if (
    value.representation !== "role-labelled-claim-incidence" ||
    value.verifierInput !== true
  ) {
    throw new Error(
      "diagnostic pairwise projections are not valid verification input; use the typed claim hyperedge",
    );
  }
}
