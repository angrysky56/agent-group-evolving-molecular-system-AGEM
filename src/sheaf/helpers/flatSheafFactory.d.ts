/**
 * flatSheafFactory.ts
 *
 * Test helper: builds flat sheaves (identity restriction maps) for various topologies.
 *
 * A flat sheaf has all restriction maps equal to identity matrices.
 * For trees: H^1 = 0 always.
 * For graphs with cycles: H^1 = d * (|E| - |V| + 1), where d = stalkDim.
 *
 * This factory is the FLAT half of the mandatory dual-config test.
 * The non-flat counterpart is threeCycleFactory (task w1-t7).
 */
import { CellularSheaf } from "../CellularSheaf.js";
/**
 * buildFlatSheaf — create a CellularSheaf with identity restriction maps.
 *
 * @param numVertices - Number of vertices (>= 2 for path/complete; exactly 3 for triangle).
 * @param stalkDim - Stalk dimension at each vertex and edge.
 * @param topology - Graph topology: 'path' (default), 'triangle', or 'complete'.
 *
 * Topologies:
 * - 'path': v0-v1-v2-...-v(n-1). Total edges = numVertices - 1.
 * - 'triangle': requires numVertices = 3. Edges: v0-v1, v1-v2, v2-v0. Total edges = 3.
 * - 'complete': all pairs (i, j) with i < j. Total edges = n*(n-1)/2.
 */
export declare function buildFlatSheaf(numVertices: number, stalkDim: number, topology?: "path" | "triangle" | "complete"): CellularSheaf;
//# sourceMappingURL=flatSheafFactory.d.ts.map