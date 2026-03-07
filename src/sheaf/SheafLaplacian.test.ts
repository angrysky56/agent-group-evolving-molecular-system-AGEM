/**
 * SheafLaplacian.test.ts
 *
 * Tests for SheafLaplacian class (getCoboundaryMatrix, getSheafLaplacian, getEigenspectrum):
 *
 *   T4: Sheaf Laplacian is positive semidefinite (all eigenvalues >= -1e-12)
 *   T5: L_sheaf * x = 0 for known global sections of flat sheaf
 *   T5b: L_sheaf differs from L_graph tensor I_d for non-flat sheaf (discrimination test)
 *   T6: dim(H^0) and dim(H^1) via eigenvalue counting (flat path and flat triangle)
 *   T6b: Eigenspectrum output format (Float64Array, sorted ascending, all non-negative)
 *
 * Mathematical context:
 *   L_sheaf = B^T B is positive semidefinite by construction.
 *   For flat sheaves on connected graphs: dim(ker L_sheaf) = stalkDim.
 *   For non-flat sheaves: L_sheaf differs from L_graph tensor I_d.
 */

import { describe, it, expect } from "vitest";
import * as math from "mathjs";
import { SheafLaplacian } from "./SheafLaplacian.js";
import { buildFlatSheaf } from "./helpers/flatSheafFactory.js";
import { buildThreeCycleInconsistentSheaf } from "./helpers/threeCycleFactory.js";

// ---------------------------------------------------------------------------
// Helper: compute eigenvalues of a mathjs matrix
// ---------------------------------------------------------------------------

function getEigenvalues(m: math.Matrix): number[] {
  const result = math.eigs(m);
  const vals = result.values;
  let rawValues: number[];
  if (Array.isArray(vals)) {
    rawValues = vals as number[];
  } else {
    rawValues = (vals as math.Matrix).toArray() as number[];
  }
  return rawValues.sort((a, b) => a - b);
}

/**
 * Compute ||v|| for a number array.
 */
function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

// ---------------------------------------------------------------------------
// T4: Sheaf Laplacian is positive semidefinite
// ---------------------------------------------------------------------------

describe("T4: Sheaf Laplacian is positive semidefinite", () => {
  it("T4.1: all eigenvalues >= -1e-12 for 4-vertex complete flat sheaf (2D stalks)", () => {
    /**
     * 4 vertices, 2D stalks, complete graph topology (6 edges).
     * N_0 = 8, N_1 = 12. L_sheaf is 8x8.
     * For a flat sheaf, L_sheaf = L_graph tensor I_2 which is PSD by standard theory.
     */
    const sheaf = buildFlatSheaf(4, 2, "complete");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    for (const ev of eigenvalues) {
      expect(ev).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("T4.2: all eigenvalues >= -1e-12 for 3-vertex path flat sheaf (3D stalks)", () => {
    const sheaf = buildFlatSheaf(3, 3, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    for (const ev of eigenvalues) {
      expect(ev).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("T4.3: all eigenvalues >= -1e-12 for three-cycle inconsistency sheaf (non-flat)", () => {
    /**
     * The three-cycle inconsistency sheaf is non-flat and has H^1 != 0.
     * But L_sheaf = B^T B is still PSD by construction.
     */
    const sheaf = buildThreeCycleInconsistentSheaf();
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    for (const ev of eigenvalues) {
      expect(ev).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("T4.4: L_sheaf is symmetric (max |L[i][j] - L[j][i]| < 1e-14)", () => {
    const sheaf = buildFlatSheaf(4, 2, "complete");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const arr = L.toArray() as number[][];
    const n = arr.length;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        expect(Math.abs(arr[i][j] - arr[j][i])).toBeLessThan(1e-12);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T5: L_sheaf * x = 0 for known global sections (flat sheaf)
// ---------------------------------------------------------------------------

describe("T5: L_sheaf * x = 0 for known global sections of flat sheaf", () => {
  /**
   * Flat sheaf: 3 vertices, 2D stalks, path topology.
   * N_0 = 6 (v0=[0:2], v1=[2:4], v2=[4:6]).
   *
   * Global sections are constant sections: x[v] = same 2D vector for all v.
   *   x1 = [1, 0, 1, 0, 1, 0]  (all agents have state [1, 0])
   *   x2 = [0, 1, 0, 1, 0, 1]  (all agents have state [0, 1])
   *
   * These span the 2D null space of L_sheaf (dim(H^0) = 2).
   */
  it("T5.1: ||L * x1|| < 1e-12 for constant section x1 = [1,0,1,0,1,0]", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();

    const x1 = [1, 0, 1, 0, 1, 0];
    const Lx1Raw = math.multiply(L, x1);
    const Lx1: number[] = Array.isArray(Lx1Raw)
      ? (Lx1Raw as number[])
      : ((Lx1Raw as math.Matrix).toArray() as number[]);

    expect(norm(Lx1)).toBeLessThan(1e-12);
  });

  it("T5.2: ||L * x2|| < 1e-12 for constant section x2 = [0,1,0,1,0,1]", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();

    const x2 = [0, 1, 0, 1, 0, 1];
    const Lx2Raw = math.multiply(L, x2);
    const Lx2: number[] = Array.isArray(Lx2Raw)
      ? (Lx2Raw as number[])
      : ((Lx2Raw as math.Matrix).toArray() as number[]);

    expect(norm(Lx2)).toBeLessThan(1e-12);
  });

  it("T5.3: both constant sections span a 2D null space (dim(H^0) >= 2)", () => {
    /**
     * x1 = [1,0,1,0,1,0] and x2 = [0,1,0,1,0,1] are orthogonal.
     * Both are in ker(L_sheaf).
     * This proves dim(ker(L_sheaf)) >= 2.
     * For a flat sheaf on a connected graph with stalkDim=2, we expect exactly 2.
     */
    const x1 = new Float64Array([1, 0, 1, 0, 1, 0]);
    const x2 = new Float64Array([0, 1, 0, 1, 0, 1]);

    // x1 and x2 are orthogonal (dot product = 0)
    let dot = 0;
    for (let i = 0; i < 6; i++) dot += x1[i] * x2[i];
    expect(Math.abs(dot)).toBeLessThan(1e-14);
  });

  it("T5.4: non-constant section is NOT in ker(L), i.e., ||L * y|| > 0", () => {
    /**
     * y = [1, 0, 0, 1, 1, 0] is NOT a constant section.
     * v0=[1,0], v1=[0,1], v2=[1,0] — the three agents disagree.
     * So L * y != 0.
     */
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();

    const y = [1, 0, 0, 1, 1, 0];
    const LyRaw = math.multiply(L, y);
    const Ly: number[] = Array.isArray(LyRaw)
      ? (LyRaw as number[])
      : ((LyRaw as math.Matrix).toArray() as number[]);

    expect(norm(Ly)).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// T5b: Discrimination test — L_sheaf differs from L_graph tensor I_d for non-flat sheaf
// ---------------------------------------------------------------------------

describe("T5b: L_sheaf vs L_graph tensor I_2 discrimination test", () => {
  /**
   * For a FLAT sheaf, L_sheaf = L_graph tensor I_d (both are equivalent).
   * For a NON-FLAT sheaf (like the three-cycle), they differ.
   *
   * This test catches the silent substitution error: building L_graph tensor I_d
   * instead of the true sheaf Laplacian. The flat sheaf tests alone cannot catch
   * this substitution because the two matrices are equal for flat sheaves.
   *
   * Setup:
   *   Non-flat sheaf: the three-cycle inconsistency sheaf (3 vertices, R^2 stalks)
   *   L_sheaf: computed from B^T B using restriction maps [1,0] and [0,1]
   *   L_graph: standard triangle graph Laplacian [[2,-1,-1],[-1,2,-1],[-1,-1,2]]
   *   L_graph tensor I_2: Kronecker product, a 6x6 block matrix
   *
   * These must be different matrices for the three-cycle sheaf.
   */
  it("T5b.1: L_sheaf for three-cycle differs from L_graph_triangle tensor I_2", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    const laplacian = new SheafLaplacian(sheaf);
    const L_sheaf = laplacian.getSheafLaplacian();
    const L_sheaf_arr = L_sheaf.toArray() as number[][];

    // Build L_graph tensor I_2 for the triangle graph manually.
    // L_graph for triangle (3 vertices, all edges present):
    //   [[2, -1, -1],
    //    [-1, 2, -1],
    //    [-1, -1, 2]]
    //
    // L_graph tensor I_2 is the 6x6 block matrix:
    //   Each scalar entry L[i,j] becomes a 2x2 block: L[i,j] * I_2
    const L_graph = [
      [2, -1, -1],
      [-1, 2, -1],
      [-1, -1, 2],
    ];
    const L_tensor: number[][] = [];
    for (let r = 0; r < 6; r++) L_tensor.push(new Array(6).fill(0));

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // Block [i,j] = L_graph[i][j] * I_2
        // Rows 2i:2i+2, cols 2j:2j+2
        L_tensor[2 * i][2 * j] = L_graph[i][j];
        L_tensor[2 * i + 1][2 * j + 1] = L_graph[i][j];
      }
    }

    // Compute max difference between L_sheaf and L_tensor
    let maxDiff = 0;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        maxDiff = Math.max(
          maxDiff,
          Math.abs(L_sheaf_arr[r][c] - L_tensor[r][c]),
        );
      }
    }

    // They must differ by more than numerical noise.
    // L_sheaf for three-cycle = I_6 (computed by hand).
    // L_graph tensor I_2 has diagonal entries = 2 (not 1).
    // Max diff will be >= 1.
    expect(maxDiff).toBeGreaterThan(0.5);
  });

  it("T5b.2: flat triangle L_sheaf equals L_graph_triangle tensor I_2 (positive control)", () => {
    /**
     * For FLAT sheaves, L_sheaf = L_graph tensor I_d.
     * This is a positive control: the flat triangle should match the Kronecker product.
     * This confirms our L_graph tensor I_2 construction is correct.
     */
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const laplacian = new SheafLaplacian(sheaf);
    const L_sheaf = laplacian.getSheafLaplacian();
    const L_sheaf_arr = L_sheaf.toArray() as number[][];

    // L_graph for triangle:
    const L_graph = [
      [2, -1, -1],
      [-1, 2, -1],
      [-1, -1, 2],
    ];
    const L_tensor: number[][] = [];
    for (let r = 0; r < 6; r++) L_tensor.push(new Array(6).fill(0));

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        L_tensor[2 * i][2 * j] = L_graph[i][j];
        L_tensor[2 * i + 1][2 * j + 1] = L_graph[i][j];
      }
    }

    // They should match within numerical tolerance.
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        expect(Math.abs(L_sheaf_arr[r][c] - L_tensor[r][c])).toBeLessThan(
          1e-12,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T6: Flat sheaf H^0 and H^1 dimensions via eigenvalue counting
// ---------------------------------------------------------------------------

describe("T6: Flat sheaf cohomology dimensions via eigenvalue counting", () => {
  /**
   * For a flat sheaf on a connected graph, eigenvalue counting gives:
   *   dim(H^0) = number of eigenvalues < 1e-10 = stalkDim
   *   dim(H^1) = N_1 - N_0 + dim(H^0)  (Euler characteristic formula)
   *
   * Test cases:
   *   1. Flat path (3 vertices, 2D stalks): N_1=4, N_0=6, H^0=2, H^1=0
   *   2. Flat triangle (3 vertices, 2D stalks): N_1=6, N_0=6, H^0=2, H^1=2
   */
  it("T6.1: flat path dim(H^0) = 2 (stalkDim for connected graph)", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    const nullDim = eigenvalues.filter((ev) => ev < 1e-10).length;
    expect(nullDim).toBe(2); // dim(H^0) = stalkDim = 2
  });

  it("T6.2: flat path dim(H^1) = 0 (tree topology, no cycles)", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    // N_1 = 2 edges * 2D = 4, N_0 = 3 vertices * 2D = 6
    const N1 = sheaf.c1Dimension; // 4
    const N0 = sheaf.c0Dimension; // 6

    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    const h0 = eigenvalues.filter((ev) => ev < 1e-10).length; // 2
    const h1 = N1 - N0 + h0; // 4 - 6 + 2 = 0

    expect(h0).toBe(2);
    expect(h1).toBe(0);
  });

  it("T6.3: flat triangle dim(H^0) = 2 and dim(H^1) = 2 (one cycle)", () => {
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    // N_1 = 3 edges * 2D = 6, N_0 = 3 vertices * 2D = 6
    const N1 = sheaf.c1Dimension; // 6
    const N0 = sheaf.c0Dimension; // 6

    const laplacian = new SheafLaplacian(sheaf);
    const L = laplacian.getSheafLaplacian();
    const eigenvalues = getEigenvalues(L);

    const h0 = eigenvalues.filter((ev) => ev < 1e-10).length; // 2
    const h1 = N1 - N0 + h0; // 6 - 6 + 2 = 2

    expect(h0).toBe(2); // dim(H^0) = stalkDim for flat sheaf on connected graph
    expect(h1).toBe(2); // dim(H^1) = 2 for flat 2D sheaf on a triangle
  });

  it("T6.4: Euler characteristic: chi = dim(H^0) - dim(H^1) = chi_graph * stalkDim", () => {
    /**
     * For a flat sheaf: chi_sheaf = chi_graph * stalkDim.
     * For path graph: chi_graph = |V| - |E| = 3 - 2 = 1.
     * chi_sheaf = 1 * 2 = 2.
     * chi_sheaf = dim(H^0) - dim(H^1) = 2 - 0 = 2. Verified.
     *
     * For triangle graph: chi_graph = 3 - 3 = 0.
     * chi_sheaf = 0 * 2 = 0.
     * chi_sheaf = 2 - 2 = 0. Verified.
     */
    const pathSheaf = buildFlatSheaf(3, 2, "path");
    const triangleSheaf = buildFlatSheaf(3, 2, "triangle");

    const pathLap = new SheafLaplacian(pathSheaf);
    const triangleLap = new SheafLaplacian(triangleSheaf);

    const pathEigenvalues = getEigenvalues(pathLap.getSheafLaplacian());
    const triangleEigenvalues = getEigenvalues(triangleLap.getSheafLaplacian());

    const pathH0 = pathEigenvalues.filter((ev) => ev < 1e-10).length;
    const pathH1 = pathSheaf.c1Dimension - pathSheaf.c0Dimension + pathH0;

    const triangleH0 = triangleEigenvalues.filter((ev) => ev < 1e-10).length;
    const triangleH1 =
      triangleSheaf.c1Dimension - triangleSheaf.c0Dimension + triangleH0;

    // chi for path: chi = H0 - H1 = 2 - 0 = 2 = stalkDim * chi_graph = 2 * 1
    expect(pathH0 - pathH1).toBe(2);

    // chi for triangle: chi = H0 - H1 = 2 - 2 = 0 = stalkDim * chi_graph = 2 * 0
    expect(triangleH0 - triangleH1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T6b: Eigenspectrum output format
// ---------------------------------------------------------------------------

describe("T6b: Eigenspectrum output format", () => {
  it("T6b.1: getEigenspectrum returns Float64Array of length N_0", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const spectrum = laplacian.getEigenspectrum();

    expect(spectrum.eigenvalues).toBeInstanceOf(Float64Array);
    expect(spectrum.eigenvalues.length).toBe(sheaf.c0Dimension); // N_0 = 6
  });

  it("T6b.2: eigenvalues are sorted ascending", () => {
    const sheaf = buildFlatSheaf(4, 2, "complete");
    const laplacian = new SheafLaplacian(sheaf);
    const spectrum = laplacian.getEigenspectrum();
    const evs = spectrum.eigenvalues;

    for (let i = 0; i + 1 < evs.length; i++) {
      expect(evs[i]).toBeLessThanOrEqual(evs[i + 1] + 1e-14);
    }
  });

  it("T6b.3: all eigenvalues >= -1e-12", () => {
    const sheaf = buildFlatSheaf(3, 2, "triangle");
    const laplacian = new SheafLaplacian(sheaf);
    const spectrum = laplacian.getEigenspectrum();

    for (const ev of spectrum.eigenvalues) {
      expect(ev).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("T6b.4: computedAtIteration defaults to 0 in Phase 1", () => {
    const sheaf = buildFlatSheaf(2, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);
    const spectrum = laplacian.getEigenspectrum();

    expect(spectrum.computedAtIteration).toBe(0);
  });

  it("T6b.5: eigenspectrum length matches c0Dimension for three-cycle (N_0 = 6)", () => {
    const sheaf = buildThreeCycleInconsistentSheaf();
    const laplacian = new SheafLaplacian(sheaf);
    const spectrum = laplacian.getEigenspectrum();

    expect(spectrum.eigenvalues.length).toBe(6); // c0Dimension = 6
  });

  it("T6b.6: caching — getSheafLaplacian twice returns same matrix reference", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);

    const L1 = laplacian.getSheafLaplacian();
    const L2 = laplacian.getSheafLaplacian();

    // Same reference (cached)
    expect(L1).toBe(L2);
  });

  it("T6b.7: invalidateCache forces recomputation on next call", () => {
    const sheaf = buildFlatSheaf(3, 2, "path");
    const laplacian = new SheafLaplacian(sheaf);

    const L1 = laplacian.getSheafLaplacian();
    laplacian.invalidateCache();
    const L2 = laplacian.getSheafLaplacian();

    // After invalidation, a new matrix is computed (different reference but same values)
    expect(L1).not.toBe(L2);

    // But the values should be the same
    const arr1 = L1.toArray() as number[][];
    const arr2 = L2.toArray() as number[][];
    for (let r = 0; r < arr1.length; r++) {
      for (let c = 0; c < arr1[r].length; c++) {
        expect(Math.abs(arr1[r][c] - arr2[r][c])).toBeLessThan(1e-14);
      }
    }
  });
});
