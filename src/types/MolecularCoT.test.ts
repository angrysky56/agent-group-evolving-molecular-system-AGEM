import { describe, it, expect } from "vitest";
import { BondGraph, StepId } from "./MolecularCoT.js";

describe("MolecularCoT — Emergent Bonds & Event Sourcing", () => {
  const stepA = "step-a" as StepId;
  const stepB = "step-b" as StepId;
  const stepC = "step-c" as StepId;

  it("should classify Covalent bonds if options.isLogicalDependency is true", () => {
    const graph = new BondGraph();
    const bond = graph.observe(stepA, stepB, {
      isLogicalDependency: true,
      strength: 0.8,
    });

    expect(bond).toBeDefined();
    expect(bond!.type).toBe("covalent");
    expect(bond!.source).toBe(stepA);
    expect(bond!.target).toBe(stepB);
    expect((bond as any).strength).toBe(0.8);
    expect(graph.hasBond(stepA, stepB)).toBe(true);
  });

  it("should classify Hydrogen bonds if embeddings are semantically close", () => {
    const graph = new BondGraph({ hydrogenThreshold: 0.3 });
    
    // Identical embeddings (cosine similarity = 1.0, semantic distance = 0.0)
    const embA = new Float64Array([1.0, 0.0, 0.0]);
    const embB = new Float64Array([1.0, 0.0, 0.0]);

    const bond = graph.observe(stepA, stepB, {
      sourceEmbedding: embA,
      targetEmbedding: embB,
    });

    expect(bond).toBeDefined();
    expect(bond!.type).toBe("hydrogen");
    expect((bond as any).semanticDistance).toBeCloseTo(0.0, 5);
  });

  it("should reject Hydrogen classification if embeddings are too semantically distant", () => {
    const graph = new BondGraph({ hydrogenThreshold: 0.3 });

    // Orthogonal embeddings (cosine similarity = 0.0, semantic distance = 1.0)
    const embA = new Float64Array([1.0, 0.0, 0.0]);
    const embB = new Float64Array([0.0, 1.0, 0.0]);

    const bond = graph.observe(stepA, stepB, {
      sourceEmbedding: embA,
      targetEmbedding: embB,
    });

    // Should not form any bond
    expect(bond).toBeUndefined();
    expect(graph.hasBond(stepA, stepB)).toBe(false);
  });

  it("should classify VanDerWaals bonds if trajectoryLength is sufficient", () => {
    const graph = new BondGraph({ vdwMinTrajectory: 5 });
    const bond = graph.observe(stepA, stepB, {
      trajectoryLength: 6,
    });

    expect(bond).toBeDefined();
    expect(bond!.type).toBe("vanDerWaals");
    expect((bond as any).trajectoryLength).toBe(6);
  });

  it("should enforce classification priority: Covalent > Hydrogen > VanDerWaals", () => {
    const graph = new BondGraph({ hydrogenThreshold: 0.3, vdwMinTrajectory: 5 });
    const emb = new Float64Array([1.0, 0.0]);

    // All match
    const bond = graph.observe(stepA, stepB, {
      isLogicalDependency: true,
      strength: 0.9,
      sourceEmbedding: emb,
      targetEmbedding: emb,
      trajectoryLength: 10,
    });

    expect(bond!.type).toBe("covalent");
  });

  it("should support cascade invalidation on Covalent removal and re-derive from observation log", () => {
    const graph = new BondGraph();
    graph.addCovalentBond(stepA, stepB, 1.0);
    graph.addCovalentBond(stepB, stepC, 1.0);

    expect(graph.getBonds().length).toBe(2);

    const invalidated = graph.removeCovalentBond(stepA, stepB);
    expect(invalidated).toEqual([stepB, stepC]);

    expect(graph.hasBond(stepA, stepB)).toBe(false);
    // B -> C should still be there because B was not removed, only the bond A -> B was removed
    expect(graph.hasBond(stepB, stepC)).toBe(true);
  });

  it("should snapshot and restore correctly (verbatim rehydration)", () => {
    const graph = new BondGraph({ hydrogenThreshold: 0.5, vdwMinTrajectory: 5 });
    const embA = new Float64Array([1.0, 0.0]);
    const embB = new Float64Array([0.8, 0.6]);

    graph.observe(stepA, stepB, {
      sourceEmbedding: embA,
      targetEmbedding: embB,
    });
    graph.addCovalentBond(stepB, stepC, 0.7);

    const snapshot = graph.snapshot();
    expect(snapshot.observations.length).toBe(2);

    const restoredGraph = new BondGraph({ hydrogenThreshold: 0.5, vdwMinTrajectory: 5 });
    restoredGraph.restore(snapshot);

    expect(restoredGraph.getBonds().length).toBe(2);
    expect(restoredGraph.getBond(stepA, stepB)!.type).toBe("hydrogen");
    expect(restoredGraph.getBond(stepB, stepC)!.type).toBe("covalent");
  });
});
