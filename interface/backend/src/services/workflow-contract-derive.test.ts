/**
 * workflow-contract-derive.test.ts
 *
 * The `derive` requirement, added after a run that satisfied the contract
 * while doing the thing the contract was meant to prevent.
 *
 * Observed on the origin-of-the-genetic-code corpus: the model verified with
 * hand-authored propositions, `verify` went green, no nudge fired, and the
 * encoding turned out to be five ground atoms over a single constant — the
 * model's own prose labels handed to a prover for confirmation. The old
 * contract could not see the difference, and its nudge text named the
 * hand-authored tool by name.
 */

import { describe, it, expect } from "vitest";
import { createWorkflowContract } from "./workflow-contract.js";

const contested = () => true;
const uncontested = () => false;
const storeUp = () => true;
const storeDown = () => false;

/** A contested analysis run that has ingested and inspected. */
const analysed = (isClaimStoreAvailable: () => boolean) => {
  const c = createWorkflowContract({
    isContested: contested,
    isClaimStoreAvailable,
    materialChars: 5000,
  });
  c.record("run_agem_cycle");
  c.record("get_graph_topology");
  return c;
};

const itemById = (c: ReturnType<typeof analysed>, id: string) =>
  c.evaluate().items.find((i) => i.id === id)!;

describe("WorkflowContract — derive", () => {
  it("is unsatisfied when only hand-authored logic ran", () => {
    const c = analysed(storeUp);
    c.record("evaluate_logical_consistency");

    // The exact regression: verification is done, derivation is not.
    expect(itemById(c, "verify").satisfied).toBe(true);
    expect(itemById(c, "derive").satisfied).toBe(false);
    expect(c.evaluate().satisfied).toBe(false);
    expect(c.nudge()).toMatch(/extract_and_verify_claims/);
  });

  it("is satisfied by the typed-claim path alone", () => {
    const c = analysed(storeUp);
    c.record("extract_and_verify_claims");

    expect(itemById(c, "verify").satisfied).toBe(true);
    expect(itemById(c, "derive").satisfied).toBe(true);
    expect(c.evaluate().satisfied).toBe(true);
    expect(c.nudge()).toBeNull();
  });

  it("does not demand the typed path when the claim store is down", () => {
    const c = analysed(storeDown);
    c.record("evaluate_logical_consistency");

    // Demanding something the run cannot do would burn the nudge budget on
    // an instruction the model can only refuse.
    expect(itemById(c, "derive").applicable).toBe(false);
    expect(c.evaluate().satisfied).toBe(true);
    expect(c.nudge()).toBeNull();
  });

  it("treats a throwing availability probe as unavailable", () => {
    const c = createWorkflowContract({
      isContested: contested,
      isClaimStoreAvailable: () => {
        throw new Error("typedb unreachable");
      },
      materialChars: 5000,
    });
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    c.record("evaluate_logical_consistency");

    expect(itemById(c, "derive").applicable).toBe(false);
    expect(c.evaluate().satisfied).toBe(true);
  });

  it("does not apply on an uncontested corpus", () => {
    const c = createWorkflowContract({
      isContested: uncontested,
      isClaimStoreAvailable: storeUp,
      materialChars: 5000,
    });
    c.record("run_agem_cycle");
    c.record("get_graph_topology");

    expect(itemById(c, "derive").applicable).toBe(false);
    expect(c.evaluate().satisfied).toBe(true);
  });

  it("defaults to suppressing derive when availability is not wired up", () => {
    // Consistent with the rest of the contract: an unconfirmed requirement is
    // not manufactured.
    const c = createWorkflowContract({
      isContested: contested,
      materialChars: 5000,
    });
    c.record("run_agem_cycle");
    c.record("get_graph_topology");
    c.record("evaluate_logical_consistency");

    expect(itemById(c, "derive").applicable).toBe(false);
    expect(c.evaluate().satisfied).toBe(true);
  });

  it("counts extract_and_verify_claims as verification on its own", () => {
    // It runs the same consistency engine internally, so a run that used only
    // the typed path must not be told it never verified anything.
    const c = analysed(storeUp);
    c.record("extract_and_verify_claims");
    expect(itemById(c, "verify").satisfied).toBe(true);
  });

  it("activates the contract on a run that used only the typed path", () => {
    // extract_and_verify_claims belongs to the analysis surface; a run built
    // entirely on it is an analysis and must still be held to ingest/inspect.
    const c = createWorkflowContract({
      isContested: uncontested,
      isClaimStoreAvailable: storeUp,
      materialChars: 0,
    });
    c.record("extract_and_verify_claims");

    expect(c.evaluate().satisfied).toBe(false);
    expect(c.nudge()).toMatch(/run_agem_cycle/);
  });

  it("no longer points the model at the hand-authored tool by name", () => {
    const c = analysed(storeUp);
    const verify = itemById(c, "verify");
    expect(verify.hint).toContain("extract_and_verify_claims");
    expect(verify.hint).not.toMatch(/with evaluate_logical_consistency/);
  });

  it("stays bounded — derive cannot add nudges beyond the budget", () => {
    const c = analysed(storeUp);
    c.record("evaluate_logical_consistency");
    expect(c.nudge()).not.toBeNull();
    // Same unmet set, already raised.
    expect(c.nudge()).toBeNull();
    expect(c.nudgeCount).toBe(1);
  });
});
