import { describe, expect, it, vi } from "vitest";
import type { ExtractionRepairContext } from "./extraction-repairs.js";
import {
  collectExtractionRepairProposals,
  proposeExtractionRepairs,
} from "./extraction-repairs.js";

const context = (): ExtractionRepairContext => ({
  segments: [
    {
      id: "qm-0",
      text: "Wavefunction status — psi ontic vs psi epistemic.",
    },
    {
      id: "qm-1",
      text: "The Copenhagen position says psi is epistemic.",
    },
  ],
  extraction: {
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
        sourceForms: ["psi ontic"],
      },
      {
        label: "psi-epistemic",
        kind: "axis-value",
        axis: "wavefunction-status",
        definition: "psi is informational",
        sourceForms: ["psi epistemic"],
      },
      {
        label: "copenhagen",
        kind: "entity",
        definition: "the Copenhagen interpretation",
        sourceForms: ["Copenhagen position"],
      },
    ],
    unmappableClaims: [
      {
        segmentId: "qm-1",
        reason: "no closed label represents the cut",
        candidateLabels: ["quantum-classical-cut"],
      },
    ],
    outcomes: [
      {
        segmentId: "qm-0",
        claim: {
          kind: "distinction",
          roles: {
            distinguished: ["wavefunction-status", "wavefunction-status"],
          },
          scope: "corpus",
        },
        accepted: false,
        rejectionKind: "schema",
        rejection: "distinction needs two distinct values",
      },
      {
        segmentId: "qm-1",
        claim: {
          kind: "property-assertion",
          roles: { subject: "copenhagen", property: "psi-epistemic" },
          scope: "corpus",
          polarity: "asserts",
        },
        accepted: false,
        rejectionKind: "attribution",
        rejection: "named holder was flattened",
      },
      {
        segmentId: "qm-1",
        claim: {
          kind: "property-assertion",
          roles: {
            subject: "copenhagen",
            property: "wavefunction-status",
          },
          scope: "position",
          positionId: "copenhagen",
          polarity: "asserts",
        },
        accepted: false,
        rejectionKind: "vocabulary",
        rejection: "axis labels cannot fill claim roles",
      },
    ],
  },
  predicateAliasSuggestions: [
    {
      source: "act-itself",
      target: "dominance",
      proposedCanonical: "dominance",
      similarity: 0.91,
      severity: "critical",
    },
  ],
});

describe("extraction repair proposals", () => {
  it("bounds each failure to source and glossary candidates", () => {
    const repairs = collectExtractionRepairProposals(context());

    expect(repairs.map(({ kind }) => kind)).toEqual([
      "glossary-addition",
      "distinction-value",
      "attribution-holder",
      "axis-value-choice",
      "predicate-bridge",
    ]);
    expect(repairs[1].candidates[0].patch).toEqual({
      operation: "replace-distinction-values",
      values: ["psi-ontic", "psi-epistemic"],
    });
    expect(repairs[2].candidates[0].patch).toEqual({
      operation: "set-attribution",
      scope: "position",
      positionId: "copenhagen",
    });
    expect(repairs[3].candidates[0].patch).toEqual({
      operation: "replace-role-value",
      role: "property",
      value: "psi-epistemic",
    });
    expect(repairs.every(({ applied }) => applied === false)).toBe(true);
  });

  it("uses abductive_explain only to rank and never applies a repair", async () => {
    const oracle = vi.fn(async () =>
      JSON.stringify({
        best_explanation: "repair_0",
        explains_observation: true,
      }),
    );
    const input = context();
    const before = structuredClone(input);

    const report = await proposeExtractionRepairs(input, oracle);

    expect(report).toMatchObject({
      mode: "propose-only",
      abductiveCalls: 5,
      oracleFailures: 0,
      truncated: false,
    });
    expect(report.proposals.every(({ status }) => status === "proposed")).toBe(true);
    expect(report.proposals.every(({ applied }) => applied === false)).toBe(true);
    expect(input).toEqual(before);
    expect(oracle).toHaveBeenCalledWith({
      observation: "failure_resolved",
      candidates: ["repair_0"],
      background: ["repair_0 -> failure_resolved"],
      max_complexity: 8,
    });
  });

  it("surfaces an unavailable oracle instead of treating it as a repair", async () => {
    const report = await proposeExtractionRepairs(context(), async () => {
      throw new Error("mcp-logic unavailable");
    });

    expect(report.oracleFailures).toBe(5);
    expect(report.proposals[0]).toMatchObject({
      status: "oracle-failed",
      applied: false,
      oracleError: "mcp-logic unavailable",
    });
  });
});
