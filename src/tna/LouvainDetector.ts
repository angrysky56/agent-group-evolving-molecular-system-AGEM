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

import type {
  LouvainOptions,
  DetailedLouvainOutput,
} from "graphology-communities-louvain";
import type { CooccurrenceGraph } from "./CooccurrenceGraph.js";

// graphology-communities-louvain is a CJS module that exports `fn` with `fn.detailed`.
// With NodeNext module resolution, we import via createRequire to ensure we get the
// full object including the .detailed method. The type is cast via the ILouvain interface
// from the package's type definitions.
import { createRequire } from "module";

const _require = createRequire(import.meta.url);

interface ILouvain {
  (graph: unknown, options?: LouvainOptions): Record<string, number>;
  assign(graph: unknown, options?: LouvainOptions): void;
  detailed(graph: unknown, options?: LouvainOptions): DetailedLouvainOutput;
}

const louvain = _require("graphology-communities-louvain") as ILouvain;

// ---------------------------------------------------------------------------
// Mulberry32 — fast seeded PRNG
//
// Mulberry32 is a well-known, high-quality 32-bit PRNG with period 2^32.
// Source: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
//
// Usage: mulberry32(seed) returns a function () => number in [0, 1).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0; // ensure unsigned 32-bit
  return function (): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    z = (z ^ (z >>> 14)) >>> 0;
    return z / 0x100000000; // normalize to [0, 1)
  };
}

// ---------------------------------------------------------------------------
// LouvainResult type
// ---------------------------------------------------------------------------

export interface LouvainResult {
  /** Map from node ID to community label (integer). */
  readonly assignments: ReadonlyMap<string, number>;
  /** Final modularity Q of the detected partition. */
  readonly modularity: number;
  /** Number of distinct communities found. */
  readonly communityCount: number;
}

// ---------------------------------------------------------------------------
// LouvainDetector class
// ---------------------------------------------------------------------------

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
export class LouvainDetector {
  readonly #cooccurrenceGraph: CooccurrenceGraph;

  /** node ID → community label */
  #assignments: Map<string, number> = new Map();

  /** Last computed modularity score. */
  #modularity: number = 0;

  /** Number of distinct communities in last detection. */
  #communityCount: number = 0;

  constructor(cooccurrenceGraph: CooccurrenceGraph) {
    this.#cooccurrenceGraph = cooccurrenceGraph;
  }

  // --------------------------------------------------------------------------
  // Public: detect()
  // --------------------------------------------------------------------------

  /**
   * detect — run Louvain community detection on the co-occurrence graph.
   *
   * @param seed - Optional integer seed for deterministic results. When provided,
   *   the same seed on the same graph ALWAYS produces the same assignments.
   *   Without a seed, uses Math.random (non-deterministic).
   * @returns LouvainResult with assignments, modularity, and community count.
   */
  detect(seed?: number): LouvainResult {
    const graph = this.#cooccurrenceGraph.getGraph();

    // Build the options object.
    // If a seed is provided, inject a seeded Mulberry32 PRNG as the `rng` function.
    // The `rng` option is passed to the randomWalk phase of Louvain, which is the
    // source of non-determinism in the algorithm.
    const options: {
      randomWalk: boolean;
      resolution: number;
      getEdgeWeight: string;
      rng?: () => number;
    } = {
      randomWalk: true,
      resolution: 1,
      getEdgeWeight: "weight",
    };

    if (seed !== undefined) {
      options.rng = mulberry32(seed);
    }

    // Run Louvain with detailed output to get modularity.
    const details = louvain.detailed(graph, options);

    // Build assignments map from the returned communities object.
    const newAssignments = new Map<string, number>();
    for (const [nodeId, communityId] of Object.entries(details.communities)) {
      newAssignments.set(nodeId, communityId as number);
    }

    // Count distinct communities.
    const communityIds = new Set(newAssignments.values());

    // Store results.
    this.#assignments = newAssignments;
    this.#modularity = details.modularity;
    this.#communityCount = communityIds.size;

    return {
      assignments: this.#assignments as ReadonlyMap<string, number>,
      modularity: this.#modularity,
      communityCount: this.#communityCount,
    };
  }

  // --------------------------------------------------------------------------
  // Public: query methods
  // --------------------------------------------------------------------------

  /**
   * getAssignment — returns the community ID for a given node.
   *
   * @param nodeId - The node's identifier (canonical lemma string).
   * @returns Community ID (integer) or undefined if node not in assignments.
   */
  getAssignment(nodeId: string): number | undefined {
    return this.#assignments.get(nodeId);
  }

  /**
   * getCommunityMembers — returns all nodes in the specified community.
   *
   * @param communityId - The community label to look up.
   * @returns Read-only array of node IDs in that community (empty if not found).
   */
  getCommunityMembers(communityId: number): ReadonlyArray<string> {
    const members: string[] = [];
    for (const [nodeId, comm] of this.#assignments) {
      if (comm === communityId) {
        members.push(nodeId);
      }
    }
    return members;
  }

  /**
   * getCommunityCount — returns the number of distinct communities detected.
   */
  getCommunityCount(): number {
    return this.#communityCount;
  }

  /**
   * getModularity — returns the modularity score from the last detection.
   *
   * Modularity Q measures partition quality:
   *   Q > 0: partition is better than random (clear community structure)
   *   Q ≈ 0: no clear structure (e.g., fully connected graph)
   */
  getModularity(): number {
    return this.#modularity;
  }

  /**
   * getAssignments — returns the full node→community assignment map.
   *
   * Used by CommunitySummarizer to group all nodes by community.
   */
  getAssignments(): ReadonlyMap<string, number> {
    return this.#assignments;
  }
}
