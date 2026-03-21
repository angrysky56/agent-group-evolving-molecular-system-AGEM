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
import type { VertexId, EdgeId, SheafVertex, SheafEdge, RestrictionMap, SheafEigenspectrum } from "../types/index.js";
export declare class CellularSheaf {
    protected readonly _vertices: Map<VertexId, SheafVertex>;
    protected readonly _edges: Map<EdgeId, SheafEdge>;
    protected readonly _vertexOrder: VertexId[];
    protected readonly _edgeOrder: EdgeId[];
    private readonly _vertexOffsets;
    private readonly _edgeOffsets;
    private readonly _c0Dimension;
    private readonly _c1Dimension;
    constructor(vertices: SheafVertex[], edges: SheafEdge[]);
    private _validateEdge;
    private _validateRestrictionMap;
    /**
     * c0Dimension — total dimension of C^0 = ⊕_{v} F(v).
     * Equal to the sum of all vertex stalk dimensions.
     */
    get c0Dimension(): number;
    /**
     * c1Dimension — total dimension of C^1 = ⊕_{e} F(e).
     * Equal to the sum of all edge stalk dimensions.
     */
    get c1Dimension(): number;
    /**
     * getVertexOffset — cumulative sum of preceding vertex stalk dims in insertion order.
     * Used to locate a vertex's block in the C^0 vector.
     */
    getVertexOffset(vertexId: VertexId): number;
    /**
     * getEdgeOffset — cumulative sum of preceding edge stalk dims in insertion order.
     * Used to locate an edge's block in the C^1 vector.
     */
    getEdgeOffset(edgeId: EdgeId): number;
    /**
     * getVertexIds — vertex IDs in insertion order.
     */
    getVertexIds(): VertexId[];
    /**
     * getEdgeIds — edge IDs in insertion order.
     */
    getEdgeIds(): EdgeId[];
    /**
     * getVertex — lookup vertex by ID. Throws if not found.
     */
    getVertex(vertexId: VertexId): SheafVertex;
    /**
     * getEdge — lookup edge by ID. Throws if not found.
     */
    getEdge(edgeId: EdgeId): SheafEdge;
    /**
     * getEdgeRestrictions — convenience accessor for both restriction maps of an edge.
     */
    getEdgeRestrictions(edgeId: EdgeId): {
        source: RestrictionMap;
        target: RestrictionMap;
    };
    /**
     * getEdgeDim — convenience for edge.stalkSpace.dim.
     */
    getEdgeDim(edgeId: EdgeId): number;
    private laplacianComputer;
    private getLaplacianComputer;
    /**
     * getCoboundaryMatrix — assemble and return the coboundary operator B.
     * Shape: [c1Dimension, c0Dimension] = [N_1, N_0].
     *
     * Delegates to SheafLaplacian.getCoboundaryMatrix() with lazy caching.
     */
    getCoboundaryMatrix(): math.Matrix;
    /**
     * getSheafLaplacian — compute and return L_sheaf = B^T B.
     * Shape: [c0Dimension, c0Dimension] = [N_0, N_0].
     *
     * Delegates to SheafLaplacian.getSheafLaplacian() with lazy caching.
     */
    getSheafLaplacian(): math.Matrix;
    /**
     * getEigenspectrum — compute eigenvalues of L_sheaf, sorted ascending.
     * Returns a SheafEigenspectrum with a Float64Array of length N_0.
     *
     * Delegates to SheafLaplacian.getEigenspectrum().
     */
    getEigenspectrum(): SheafEigenspectrum;
}
//# sourceMappingURL=CellularSheaf.d.ts.map