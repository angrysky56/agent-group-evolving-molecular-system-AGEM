/**
 * CellularSheaf.ts
 *
 * Core data structure for sheaf-theoretic agent coordination.
 *
 * Stores graph topology (vertices + edges) with validated restriction maps.
 * Provides dimension bookkeeping methods.
 *
 * Wave 1: Construction validation and dimension methods only.
 * Wave 2: Laplacian and coboundary operator assembly (delegates to SheafLaplacian).
 * Wave 3: SVD-based cohomology computation.
 */

import * as math from "mathjs";
import type {
  VertexId,
  EdgeId,
  SheafVertex,
  SheafEdge,
  RestrictionMap,
  SheafEigenspectrum,
} from "../types/index.js";
import { SheafLaplacian } from "./SheafLaplacian.js";

export class CellularSheaf {
  // Protected to allow Wave 2 to access without rewriting.
  protected readonly _vertices: Map<VertexId, SheafVertex>;
  protected readonly _edges: Map<EdgeId, SheafEdge>;

  // Insertion-order arrays (Map iteration is insertion-ordered in JS,
  // but we keep explicit arrays for clarity and performance).
  protected readonly _vertexOrder: VertexId[];
  protected readonly _edgeOrder: EdgeId[];

  // Precomputed cumulative offset caches.
  private readonly _vertexOffsets: Map<VertexId, number>;
  private readonly _edgeOffsets: Map<EdgeId, number>;

  // Cached dimension sums.
  private readonly _c0Dimension: number;
  private readonly _c1Dimension: number;

  constructor(vertices: SheafVertex[], edges: SheafEdge[]) {
    // Build vertex map and order.
    this._vertices = new Map();
    this._vertexOrder = [];
    for (const v of vertices) {
      this._vertices.set(v.id, v);
      this._vertexOrder.push(v.id);
    }

    // Build edge map and order.
    this._edges = new Map();
    this._edgeOrder = [];
    for (const e of edges) {
      this._edges.set(e.id, e);
      this._edgeOrder.push(e.id);
    }

    // Validate all edges.
    for (const edge of edges) {
      this._validateEdge(edge);
    }

    // Precompute vertex offsets.
    this._vertexOffsets = new Map();
    let offset = 0;
    for (const vid of this._vertexOrder) {
      this._vertexOffsets.set(vid, offset);
      offset += this._vertices.get(vid)!.stalkSpace.dim;
    }
    this._c0Dimension = offset;

    // Precompute edge offsets.
    this._edgeOffsets = new Map();
    offset = 0;
    for (const eid of this._edgeOrder) {
      this._edgeOffsets.set(eid, offset);
      offset += this._edges.get(eid)!.stalkSpace.dim;
    }
    this._c1Dimension = offset;
  }

  // ---------------------------------------------------------------------------
  // Private validation
  // ---------------------------------------------------------------------------

  private _validateEdge(edge: SheafEdge): void {
    // Validate that referenced vertices exist.
    if (!this._vertices.has(edge.sourceVertex)) {
      throw new Error(
        `CellularSheaf: edge '${edge.id}' references non-existent source vertex '${edge.sourceVertex}'`,
      );
    }
    if (!this._vertices.has(edge.targetVertex)) {
      throw new Error(
        `CellularSheaf: edge '${edge.id}' references non-existent target vertex '${edge.targetVertex}'`,
      );
    }

    const sourceVertex = this._vertices.get(edge.sourceVertex)!;
    const targetVertex = this._vertices.get(edge.targetVertex)!;

    this._validateRestrictionMap(
      edge.sourceRestriction,
      edge,
      sourceVertex.stalkSpace.dim,
      "source",
    );
    this._validateRestrictionMap(
      edge.targetRestriction,
      edge,
      targetVertex.stalkSpace.dim,
      "target",
    );
  }

  private _validateRestrictionMap(
    map: RestrictionMap,
    edge: SheafEdge,
    expectedSourceDim: number,
    role: "source" | "target",
  ): void {
    const edgeDim = edge.stalkSpace.dim;
    const { sourceDim, targetDim, entries } = map;

    // Check sourceDim matches the corresponding vertex stalk dim.
    if (sourceDim !== expectedSourceDim) {
      throw new Error(
        `CellularSheaf: dimension mismatch on edge '${edge.id}' ${role}Restriction: ` +
          `sourceDim=${sourceDim} does not match ${role} vertex stalkSpace.dim=${expectedSourceDim}`,
      );
    }

    // Check targetDim matches the edge stalk dim.
    if (targetDim !== edgeDim) {
      throw new Error(
        `CellularSheaf: dimension mismatch on edge '${edge.id}' ${role}Restriction: ` +
          `targetDim=${targetDim} does not match edge stalkSpace.dim=${edgeDim}`,
      );
    }

    // Check entries length matches targetDim * sourceDim.
    const expectedLength = targetDim * sourceDim;
    if (entries.length !== expectedLength) {
      throw new Error(
        `CellularSheaf: dimension mismatch on edge '${edge.id}' ${role}Restriction: ` +
          `entries.length=${entries.length} does not match targetDim*sourceDim=${expectedLength}`,
      );
    }

    // Check all entries are finite.
    for (let i = 0; i < entries.length; i++) {
      if (!isFinite(entries[i])) {
        throw new Error(
          `CellularSheaf: dimension mismatch on edge '${edge.id}' ${role}Restriction: ` +
            `entries[${i}]=${entries[i]} is not a finite number`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public dimension API
  // ---------------------------------------------------------------------------

  /**
   * c0Dimension — total dimension of C^0 = ⊕_{v} F(v).
   * Equal to the sum of all vertex stalk dimensions.
   */
  get c0Dimension(): number {
    return this._c0Dimension;
  }

  /**
   * c1Dimension — total dimension of C^1 = ⊕_{e} F(e).
   * Equal to the sum of all edge stalk dimensions.
   */
  get c1Dimension(): number {
    return this._c1Dimension;
  }

  // ---------------------------------------------------------------------------
  // Public offset API
  // ---------------------------------------------------------------------------

  /**
   * getVertexOffset — cumulative sum of preceding vertex stalk dims in insertion order.
   * Used to locate a vertex's block in the C^0 vector.
   */
  getVertexOffset(vertexId: VertexId): number {
    const offset = this._vertexOffsets.get(vertexId);
    if (offset === undefined) {
      throw new Error(`CellularSheaf: unknown vertex '${vertexId}'`);
    }
    return offset;
  }

  /**
   * getEdgeOffset — cumulative sum of preceding edge stalk dims in insertion order.
   * Used to locate an edge's block in the C^1 vector.
   */
  getEdgeOffset(edgeId: EdgeId): number {
    const offset = this._edgeOffsets.get(edgeId);
    if (offset === undefined) {
      throw new Error(`CellularSheaf: unknown edge '${edgeId}'`);
    }
    return offset;
  }

  // ---------------------------------------------------------------------------
  // Public lookup API
  // ---------------------------------------------------------------------------

  /**
   * getVertexIds — vertex IDs in insertion order.
   */
  getVertexIds(): VertexId[] {
    return [...this._vertexOrder];
  }

  /**
   * getEdgeIds — edge IDs in insertion order.
   */
  getEdgeIds(): EdgeId[] {
    return [...this._edgeOrder];
  }

  /**
   * getVertex — lookup vertex by ID. Throws if not found.
   */
  getVertex(vertexId: VertexId): SheafVertex {
    const v = this._vertices.get(vertexId);
    if (!v) throw new Error(`CellularSheaf: unknown vertex '${vertexId}'`);
    return v;
  }

  /**
   * getEdge — lookup edge by ID. Throws if not found.
   */
  getEdge(edgeId: EdgeId): SheafEdge {
    const e = this._edges.get(edgeId);
    if (!e) throw new Error(`CellularSheaf: unknown edge '${edgeId}'`);
    return e;
  }

  /**
   * getEdgeRestrictions — convenience accessor for both restriction maps of an edge.
   */
  getEdgeRestrictions(edgeId: EdgeId): {
    source: RestrictionMap;
    target: RestrictionMap;
  } {
    const edge = this.getEdge(edgeId);
    return { source: edge.sourceRestriction, target: edge.targetRestriction };
  }

  /**
   * getEdgeDim — convenience for edge.stalkSpace.dim.
   */
  getEdgeDim(edgeId: EdgeId): number {
    return this.getEdge(edgeId).stalkSpace.dim;
  }

  // ---------------------------------------------------------------------------
  // Wave 2: Laplacian and coboundary operator (delegate to SheafLaplacian)
  // ---------------------------------------------------------------------------

  // Lazily initialized SheafLaplacian computer.
  private laplacianComputer: SheafLaplacian | null = null;

  private getLaplacianComputer(): SheafLaplacian {
    if (!this.laplacianComputer) {
      this.laplacianComputer = new SheafLaplacian(this);
    }
    return this.laplacianComputer;
  }

  /**
   * getCoboundaryMatrix — assemble and return the coboundary operator B.
   * Shape: [c1Dimension, c0Dimension] = [N_1, N_0].
   *
   * Delegates to SheafLaplacian.getCoboundaryMatrix() with lazy caching.
   */
  getCoboundaryMatrix(): math.Matrix {
    return this.getLaplacianComputer().getCoboundaryMatrix();
  }

  /**
   * getSheafLaplacian — compute and return L_sheaf = B^T B.
   * Shape: [c0Dimension, c0Dimension] = [N_0, N_0].
   *
   * Delegates to SheafLaplacian.getSheafLaplacian() with lazy caching.
   */
  getSheafLaplacian(): math.Matrix {
    return this.getLaplacianComputer().getSheafLaplacian();
  }

  /**
   * getEigenspectrum — compute eigenvalues of L_sheaf, sorted ascending.
   * Returns a SheafEigenspectrum with a Float64Array of length N_0.
   *
   * Delegates to SheafLaplacian.getEigenspectrum().
   */
  getEigenspectrum(): SheafEigenspectrum {
    return this.getLaplacianComputer().getEigenspectrum();
  }
}
