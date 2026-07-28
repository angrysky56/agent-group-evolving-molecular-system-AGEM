/** Best-effort structural mirror for the file-backed semantic finding index. */

import { claimStore } from "./typedb-claims.js";
import type { FindingGraph, StoredFinding } from "./finding-store.js";
import { isOkResponse } from "@typedb/driver-http";

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export class TypeDBFindingGraph implements FindingGraph {
  async recordFinding(finding: StoredFinding): Promise<void> {
    if (!claimStore.available) return;
    const optional = [
      finding.notRuledOut
        ? `has not-ruled-out "${esc(finding.notRuledOut)}"`
        : "",
      finding.condensedNarrative
        ? `has condensed-narrative "${esc(finding.condensedNarrative)}"`
        : "",
      finding.semanticVerdictKind
        ? `has semantic-verdict-kind "${esc(finding.semanticVerdictKind)}"`
        : "",
      finding.attributionValidated === true
        ? "has attribution-validated true"
        : "",
      finding.semanticsValidated === true
        ? "has semantics-validated true"
        : "",
    ].filter(Boolean);
    await requireWrite(`put
  $f isa finding,
    has finding-id "${esc(finding.id)}",
    has verdict "${esc(finding.verdict)}",
    has coverage "${esc(finding.coverage)}",
    has run-log-id "${esc(finding.runLogId)}",
    has produced-by-model "${esc(finding.producedByModel)}",
    has method "${esc(finding.method)}",
    has finding-outcome "${esc(finding.outcome)}",
    has memory-namespace "${esc(finding.memoryNamespace)}",
    has created-at ${finding.createdAt},
    has corpus-id "${esc(finding.corpusId)}"${optional.length ? `,\n    ${optional.join(",\n    ")}` : ""};`);

    const refs = [...new Set(finding.supportingClaimRefs ?? [])];
    if (refs.length === 0) return;
    const matches = refs
      .map(
        (id, index) =>
          `  $c${index} isa claim, has claim-id "${esc(id)}";`,
      )
      .join("\n");
    const roles = refs
      .map((_, index) => `supporting-claim: $c${index}`)
      .join(", ");
    await requireWrite(`match
  $f isa finding, has finding-id "${esc(finding.id)}";
${matches}
insert
  $_ isa evidences (conclusion: $f, ${roles});`);
  }

  async recordSupersedes(
    winnerFindingId: string,
    loserFindingId: string,
    reason: string,
  ): Promise<void> {
    if (!claimStore.available) return;
    await requireWrite(`match
  $winner isa finding, has finding-id "${esc(winnerFindingId)}";
  $loser isa finding, has finding-id "${esc(loserFindingId)}";
insert
  $_ isa supersedes (newer: $winner, older: $loser),
    has reason "${esc(reason)}";`);
  }
}

async function requireWrite(query: string): Promise<void> {
  const response = await claimStore.write(query);
  if (response && isOkResponse(response)) return;
  const error = (response as { err?: { code?: string; message?: string } } | null)
    ?.err;
  throw new Error(
    `TypeDB finding write rejected: ${[error?.code, error?.message]
      .filter(Boolean)
      .join(" ") || "store unavailable"}`,
  );
}
