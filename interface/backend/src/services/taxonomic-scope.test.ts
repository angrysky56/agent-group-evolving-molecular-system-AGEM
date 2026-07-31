/**
 * QM-interpretations run 2026-07-31T01-06-27. The model emitted fourteen
 * structurally identical distinctions over the corpus's stance axes, wrote
 * "scope":"corpus" on one, and omitted it on thirteen. All thirteen were
 * rejected. Their content was perfect.
 */

import { describe, expect, it } from "vitest";
import {
  claimAttributionIssue,
  claimSchemaIssue,
  normalizeClaimExtras,
  type ExtractedClaim,
} from "./claim-extractor.js";

/** Verbatim from the run, minus the scope the model forgot. */
const forgotten = () =>
  ({
    kind: "distinction",
    differenceKind: "in-kind",
    roles: { distinguished: ["deterministic", "stochastic"] },
  }) as unknown as ExtractedClaim;

describe("a taxonomic claim with no holder is corpus-scoped", () => {
  it("supplies the scope the model omitted", () => {
    const claim = normalizeClaimExtras(forgotten());
    expect(claim.scope).toBe("corpus");
    expect(claimAttributionIssue(claim, "Determinism versus stochasticity.")).toBeNull();
  });

  it("does the same for dissociation", () => {
    const claim = normalizeClaimExtras({
      kind: "dissociation",
      roles: { dissociated: ["access", "phenomenal"] },
    } as unknown as ExtractedClaim);
    expect(claim.scope).toBe("corpus");
  });

  it("refuses to default when the model named a holder", () => {
    /*
     * A position may draw a distinction of its own. The default deliberately
     * does NOT fire here: silently writing "corpus" over a claim the model
     * attributed to Bohm is exactly the attribution flattening the guard
     * exists to catch. It is left unscoped and rejected, which forces the
     * attribution to be stated rather than guessed.
     */
    const claim = normalizeClaimExtras({
      kind: "distinction",
      positionId: "Bohm",
      roles: { distinguished: ["particle", "wave"] },
    } as unknown as ExtractedClaim);
    expect(claim.scope).toBeUndefined();
    expect(claim.positionId).toBe("Bohm");
    expect(claimAttributionIssue(claim, "Bohm distinguishes particle from wave.")).toMatch(
      /scope is missing or invalid/,
    );
  });

  it("does NOT default any other kind", () => {
    // For a property-assertion, "corpus" is a real choice with consequences.
    const claim = normalizeClaimExtras({
      kind: "property-assertion",
      polarity: "asserts",
      roles: { subject: "psi", property: "ontic" },
    } as unknown as ExtractedClaim);
    expect(claim.scope).toBeUndefined();
    expect(claimAttributionIssue(claim, "Bohm holds that psi is ontic.")).toMatch(
      /scope is missing or invalid/,
    );
  });

  it("never overrides a scope the model did supply", () => {
    const claim = normalizeClaimExtras({
      kind: "distinction",
      scope: "position",
      positionId: "QBism",
      roles: { distinguished: ["agent", "world"] },
    } as unknown as ExtractedClaim);
    expect(claim.scope).toBe("position");
  });
});

describe("a repeated label names the vocabulary, not the model", () => {
  it("explains that one pole cannot carry a two-way distinction", () => {
    // Verbatim from the run: {"distinguished":["collapse","collapse"]}
    const issue = claimSchemaIssue({
      kind: "distinction",
      scope: "corpus",
      roles: { distinguished: ["collapse", "collapse"] },
    } as unknown as ExtractedClaim);
    expect(issue).toMatch(/repeated the single label 'collapse'/);
    expect(issue).toMatch(/signed-property axis carries one label/);
    expect(issue).toMatch(/property-assertion with polarity/);
  });

  it("still reports a genuinely short role plainly", () => {
    const issue = claimSchemaIssue({
      kind: "distinction",
      scope: "corpus",
      roles: { distinguished: ["collapse"] },
    } as unknown as ExtractedClaim);
    expect(issue).toMatch(/requires at least 2 distinct values; found 1/);
    expect(issue).not.toMatch(/repeated the single label/);
  });

  it("accepts a well-formed two-pole distinction", () => {
    expect(
      claimSchemaIssue({
        kind: "distinction",
        scope: "corpus",
        roles: { distinguished: ["psi-ontic", "psi-epistemic"] },
      } as unknown as ExtractedClaim),
    ).toBeNull();
  });
});
