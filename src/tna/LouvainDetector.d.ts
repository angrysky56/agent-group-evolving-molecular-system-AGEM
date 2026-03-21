/**
 * LouvainDetector.ts
 *
 * Deterministic Louvain community detection for TNA co-occurrence graphs.
 *
 * Core requirement: same graph + same seed = identical community assignments every time.
 * This is ROADMAP success criterion 2 and guards against Pitfall 5 (non-deterministic
 * Louvain causing test flakiness and divergent CDP trajectories).
 *
 * Determinism strategy: The graphology-communities-louvain library accepts an `rng`
 * function option for its randomWalk phase. We pass a Mulberry32 seeded PRNG when
 * a seed is provided. Mulberry32 is a fast, high-quality 32-bit PRNG that requires
 * only a single 32-bit seed — ideal for this use case.
 *
 * Dependencies:
 *   - graphology-communities-louvain (Louvain algorithm with rng option)
 *   - src/tna/CooccurrenceGraph.ts (source of graphology graph instance)
 *
 * NO imports from lcm/, sheaf/, soc/, or orchestrator/.
 */
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";
export interface LouvainResult {
    /** Map from node ID to community label (integer). */
    readonly assignments: ReadonlyMap<string, number>;
    /** Final modularity Q of the detected partition. */
    readonly modularity: number;
    /** Number of distinct communities found. */
    readonly communityCount: number;
}
/**
 * LouvainDetector — community detection via the Louvain algorithm with
 * deterministic seeding.
 *
 * Uses `graphology-communities-louvain` with the `rng` option to inject a
 * seeded Mulberry32 PRNG, guaranteeing: same graph + same seed = same output.
 *
 * Usage:
 *   const detector = new LouvainDetector(cooccurrenceGraph);
 *   const result = detector.detect(42);
 *   console.log(result.communityCount);   // number of communities
 *   console.log(result.modularity);       // partition quality
 *   console.log(detector.getAssignment('concept')); // community ID for a node
 */
export declare class LouvainDetector {
    #private;
    constructor(cooccurrenceGraph: CooccurrenceGraph);
    /**
     * detect — run Louvain community detection on the co-occurrence graph.
     *
     * @param seed - Optional integer seed for deterministic results. When provided,
     *   the same seed on the same graph ALWAYS produces the same assignments.
     *   Without a seed, uses Math.random (non-deterministic).
     * @returns LouvainResult with assignments, modularity, and community count.
     */
    detect(seed?: number): LouvainResult;
    /**
     * getAssignment — returns the community ID for a given node.
     *
     * @param nodeId - The node's identifier (canonical lemma string).
     * @returns Community ID (integer) or undefined if node not in assignments.
     */
    getAssignment(nodeId: string): number | undefined;
    /**
     * getCommunityMembers — returns all nodes in the specified community.
     *
     * @param communityId - The community label to look up.
     * @returns Read-only array of node IDs in that community (empty if not found).
     */
    getCommunityMembers(communityId: number): ReadonlyArray<string>;
    /**
     * getCommunityCount — returns the number of distinct communities detected.
     */
    getCommunityCount(): number;
    /**
     * getModularity — returns the modularity score from the last detection.
     *
     * Modularity Q measures partition quality:
     *   Q > 0: partition is better than random (clear community structure)
     *   Q ≈ 0: no clear structure (e.g., fully connected graph)
     */
    getModularity(): number;
}
//# sourceMappingURL=LouvainDetector.d.ts.map