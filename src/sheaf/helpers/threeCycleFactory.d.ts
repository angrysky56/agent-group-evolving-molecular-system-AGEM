/**
 * threeCycleFactory.ts
 *
 * Test helper: builds the canonical non-flat sheaf for H^1 testing.
 *
 * This is the exact three-cycle inconsistency configuration from the research
 * (01-RESEARCH.md Section 5.2). It is designed so that traveling around the
 * triangle accumulates non-trivial holonomy — each edge projects onto a DIFFERENT
 * axis of R^2, making it impossible for all three consistency conditions to be
 * satisfied simultaneously.
 *
 * Mathematical properties:
 *   N_0 = 6 (total vertex stalk dims: 3 vertices × R^2)
 *   N_1 = 3 (total edge stalk dims: 3 edges × R^1)
 *   rank(B) = 2 (coboundary operator rank, verified in Wave 2)
 *   dim(H^1) = N_1 - rank(B) = 3 - 2 = 1
 *   hasObstruction = true
 *
 * This factory is the NON-FLAT half of the mandatory dual-config test.
 * The flat counterpart is flatSheafFactory (task w1-t6).
 */
import { CellularSheaf } from "../CellularSheaf.js";
/**
 * buildThreeCycleInconsistentSheaf — canonical H^1 test configuration.
 *
 * Graph: triangle with vertices v0, v1, v2 and edges e01, e12, e20.
 *
 * Vertex stalks: all R^2 (dim = 2).
 * Edge stalks: all R^1 (dim = 1).
 *
 * Restriction maps (1×2 row vectors stored as Float64Array of length 2):
 *   e01: F_{v0←e01} = [1, 0]   (project onto first axis)
 *        F_{v1←e01} = [0, 1]   (project onto second axis)
 *   e12: F_{v1←e12} = [1, 0]   (project onto first axis)
 *        F_{v2←e12} = [0, 1]   (project onto second axis)
 *   e20: F_{v2←e20} = [1, 0]   (project onto first axis)
 *        F_{v0←e20} = [0, 1]   (project onto second axis)
 *
 * The holonomy around the triangle is non-trivial: composing the three
 * projection/inclusion maps gives a non-identity automorphism of R^1,
 * which is the source of the H^1 obstruction.
 */
export declare function buildThreeCycleInconsistentSheaf(): CellularSheaf;
//# sourceMappingURL=threeCycleFactory.d.ts.map