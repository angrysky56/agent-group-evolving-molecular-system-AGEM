import { describe, expect, it } from "vitest";
import { buildFlatSheaf } from "#agem/sheaf/index.js";
import { registryCohomologySnapshot } from "./cohomology-snapshot.js";

describe("registryCohomologySnapshot", () => {
  it("omits numeric invariants when the registry sheaf has not been built", () => {
    const result = registryCohomologySnapshot(
      buildFlatSheaf(2, 1, "path"),
      false,
      false,
    );

    expect(result).toMatchObject({
      status: "not-computed",
      sheaf_vertices: 0,
      sheaf_edges: 0,
      notComputed: expect.stringMatching(/not built/i),
    });
    expect("h0_dimension" in result).toBe(false);
    expect("h1_dimension" in result).toBe(false);
  });

  it("reports a failed registry build instead of exposing stale sheaf numbers", () => {
    const result = registryCohomologySnapshot(
      buildFlatSheaf(2, 1, "path"),
      false,
      false,
      "mixed embedding dimensions (384 and 2048)",
    );

    expect(result).toMatchObject({
      status: "not-computed",
      sheaf_vertices: 0,
      sheaf_edges: 0,
      notComputed: expect.stringMatching(/build failed.*mixed embedding/i),
      remedy: expect.stringMatching(/re-embed/i),
    });
    expect("h0_dimension" in result).toBe(false);
  });

  it("omits numeric invariants for a single registry vertex", () => {
    const result = registryCohomologySnapshot(
      buildFlatSheaf(1, 3, "path"),
      true,
      false,
    );

    expect(result).toMatchObject({
      status: "not-computed",
      sheaf_vertices: 1,
      sheaf_edges: 0,
      notComputed: expect.stringMatching(/single registry vertex/i),
      remedy: expect.stringMatching(
        /run_agem_cycles_sectioned|distinct.*subgraph/i,
      ),
    });
    expect("h0_dimension" in result).toBe(false);
  });

  it("omits numeric invariants for a multi-vertex edgeless registry sheaf", () => {
    const edgeless = {
      getVertexIds: () => ["a", "b"],
      getEdgeIds: () => [],
    } as any;
    const result = registryCohomologySnapshot(edgeless, true, false);

    expect(result).toMatchObject({
      status: "not-computed",
      sheaf_vertices: 2,
      sheaf_edges: 0,
      notComputed: expect.stringMatching(/no edges/i),
    });
    expect("h1_dimension" in result).toBe(false);
  });

  it("emits numeric invariants only for a non-degenerate sheaf", () => {
    const result = registryCohomologySnapshot(
      buildFlatSheaf(2, 1, "path"),
      true,
      true,
    );

    expect(result.status).toBe("computed");
    if (result.status !== "computed") throw new Error("expected computed result");
    expect(result.h0_dimension).toBeTypeOf("number");
    expect(result.h1_dimension).toBeTypeOf("number");
  });

  it("omits numeric invariants while a sectioned run defers corpus analysis", () => {
    const result = registryCohomologySnapshot(
      buildFlatSheaf(2, 1, "path"),
      true,
      false,
    );

    expect(result).toMatchObject({
      status: "not-computed",
      notComputed: expect.stringMatching(/deferred/i),
      remedy: expect.stringMatching(/final section/i),
    });
    expect("h0_dimension" in result).toBe(false);
  });
});
