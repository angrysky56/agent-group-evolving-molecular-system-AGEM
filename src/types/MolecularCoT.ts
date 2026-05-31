/**
 * MolecularCoT.ts
 *
 * Molecular Chain-of-Thought (Molecular-CoT) bond type interfaces.
 *
 * Bond types classify relationships between reasoning steps in the Molecular-CoT
 * framework (ORCH-03). The key design decision (STATE.md: ORCH-03 in Phase 3):
 * bond type invariants MUST be enforced at the type-system level, not as
 * runtime metadata checks. The BondGraph class makes it impossible to create
 * bonds that violate behavioral constraints.
 *
 * Bond behavioral invariants:
 *   - CovalentBond removal triggers cascadeInvalidate on all transitively
 *     dependent steps (strong logical dependency).
 *   - HydrogenBond creation rejected if semanticDistance > HYDROGEN_DISTANCE_THRESHOLD
 *     (weak association — only created when concepts are semantically close).
 *   - VanDerWaalsBond creation rejected if trajectoryLength < VAN_DER_WAALS_MIN_TRAJECTORY
 *     (transient association — only created for sufficiently long reasoning paths).
 *
 * ZERO external imports — pure TypeScript + runtime logic only.
 */

// ---------------------------------------------------------------------------
// Branded ID type
// ---------------------------------------------------------------------------

/**
 * StepId — opaque branded string type for reasoning step IDs.
 * Matches the VertexId/EdgeId/TextNodeId pattern from GraphTypes.ts.
 */
export type StepId = string & { readonly __brand: "StepId" };

// ---------------------------------------------------------------------------
// Bond type discriminant
// ---------------------------------------------------------------------------

/**
 * BondType — string literal union for the three Molecular-CoT bond classifications.
 */
export type BondType = "covalent" | "hydrogen" | "vanDerWaals";

// ---------------------------------------------------------------------------
// Bond type constants
// ---------------------------------------------------------------------------

/**
 * HYDROGEN_DISTANCE_THRESHOLD — maximum semantic distance allowed for hydrogen bonds.
 *
 * HydrogenBond creation is rejected if semanticDistance > this value.
 * Configurable per-instance via BondGraph constructor, but 0.7 is the default
 * (cosine similarity-based distance: 1.0 = identical, 0.0 = orthogonal).
 */
export const HYDROGEN_DISTANCE_THRESHOLD = 0.7;

/**
 * VAN_DER_WAALS_MIN_TRAJECTORY — minimum trajectory length for Van der Waals bonds.
 *
 * VanDerWaalsBond creation is rejected if trajectoryLength < this value.
 * Based on paper's 5.32 average trajectory length; 5.0 is the minimum viable.
 */
export const VAN_DER_WAALS_MIN_TRAJECTORY = 5.0;

// ---------------------------------------------------------------------------
// Bond interfaces (immutable, type-discriminated)
// ---------------------------------------------------------------------------

/**
 * CovalentBond — strong logical dependency between reasoning steps.
 *
 * Behavioral invariant: removing a covalent bond MUST trigger cascadeInvalidate
 * on the target and all transitively dependent steps. The BondGraph.removeCovalentBond()
 * method enforces this — it returns all invalidated step IDs.
 *
 * Use case: step B is logically derived from step A. If A changes, B must be
 * re-derived (and anything that depends on B, transitively).
 */
export interface CovalentBond {
  readonly type: "covalent";
  readonly source: StepId;
  readonly target: StepId;
  /**
   * Logical dependency strength (0.0 to 1.0).
   * 1.0 = full logical derivation; 0.5 = partial dependency.
   */
  readonly strength: number;
}

/**
 * HydrogenBond — weak semantic association between reasoning steps.
 *
 * Behavioral invariant: creation MUST be rejected if semanticDistance > HYDROGEN_DISTANCE_THRESHOLD.
 * The BondGraph.addHydrogenBond() method enforces this with a thrown Error.
 *
 * Use case: step A and step B discuss related but independently derived concepts.
 * Hydrogen bonds are non-structural — removing one does NOT cascade.
 */
export interface HydrogenBond {
  readonly type: "hydrogen";
  readonly source: StepId;
  readonly target: StepId;
  /**
   * Semantic distance between the two steps (0.0 = identical, 1.0 = unrelated).
   * Must be <= HYDROGEN_DISTANCE_THRESHOLD at creation time.
   */
  readonly semanticDistance: number;
}

/**
 * VanDerWaalsBond — transient proximity association between reasoning steps.
 *
 * Behavioral invariant: creation MUST be rejected if trajectoryLength < VAN_DER_WAALS_MIN_TRAJECTORY.
 * The BondGraph.addVanDerWaalsBond() method enforces this with a thrown Error.
 *
 * Use case: step A and step B appear close together in a long enough reasoning
 * trajectory (>= 5 steps). Short trajectories don't have meaningful proximity.
 */
export interface VanDerWaalsBond {
  readonly type: "vanDerWaals";
  readonly source: StepId;
  readonly target: StepId;
  /**
   * Length of the reasoning trajectory in which this proximity was observed.
   * Must be >= VAN_DER_WAALS_MIN_TRAJECTORY at creation time.
   */
  readonly trajectoryLength: number;
}

/**
 * MolecularBond — discriminated union of all three bond types.
 * TypeScript's narrowing on `.type` gives full type safety.
 */
export type MolecularBond = CovalentBond | HydrogenBond | VanDerWaalsBond;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Helper: cosineSimilarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA < 1e-12 || normB < 1e-12) return 0;
  return dot / (normA * normB);
}

// ---------------------------------------------------------------------------
// Interfaces for event sourcing & observe options
// ---------------------------------------------------------------------------

export interface ObserveOptions {
  readonly isLogicalDependency?: boolean;
  readonly strength?: number;
  readonly trajectoryLength?: number;
  readonly sourceEmbedding?: Float64Array;
  readonly targetEmbedding?: Float64Array;
}

export interface BondObservation {
  readonly source: StepId;
  readonly target: StepId;
  readonly isLogicalDependency?: boolean;
  readonly strength?: number;
  readonly trajectoryLength?: number;
  readonly sourceEmbedding?: Float64Array;
  readonly targetEmbedding?: Float64Array;
}

export interface BondGraphSnapshot {
  readonly observations: Array<{
    readonly source: string;
    readonly target: string;
    readonly isLogicalDependency?: boolean;
    readonly strength?: number;
    readonly trajectoryLength?: number;
    readonly sourceEmbedding?: number[];
    readonly targetEmbedding?: number[];
  }>;
}

// ---------------------------------------------------------------------------
// BondGraph — manages a collection of MolecularBond instances with emergent
// types and event-sourced rehydration.
// ---------------------------------------------------------------------------

export class BondGraph {
  readonly #bonds: Map<string, MolecularBond> = new Map();
  readonly #observations: BondObservation[] = [];
  readonly #hydrogenThreshold: number;
  readonly #vdwMinTrajectory: number;

  constructor(options?: {
    hydrogenThreshold?: number;
    vdwMinTrajectory?: number;
  }) {
    this.#hydrogenThreshold =
      options?.hydrogenThreshold ?? HYDROGEN_DISTANCE_THRESHOLD;
    this.#vdwMinTrajectory =
      options?.vdwMinTrajectory ?? VAN_DER_WAALS_MIN_TRAJECTORY;
  }

  // -------------------------------------------------------------------------
  // Emergent Observation API (The MEAO Core)
  // -------------------------------------------------------------------------

  /**
   * observe — records an observation between two steps and derives the bond type
   * dynamically. Recomputes the active bond projection.
   *
   * Priority hierarchy for classification:
   *   1. Covalent (if isLogicalDependency === true)
   *   2. Hydrogen (if semanticDistance <= threshold)
   *   3. VanDerWaals (if trajectoryLength >= minimum)
   *
   * @param source  - Source step ID.
   * @param target  - Target step ID.
   * @param options - Classification inputs (embeddings, dependency, trajectory).
   * @returns Derived MolecularBond or undefined if no criteria matched.
   */
  observe(
    source: StepId,
    target: StepId,
    options?: ObserveOptions,
  ): MolecularBond | undefined {
    // Record observation
    const obs: BondObservation = {
      source,
      target,
      isLogicalDependency: options?.isLogicalDependency,
      strength: options?.strength,
      trajectoryLength: options?.trajectoryLength,
      sourceEmbedding: options?.sourceEmbedding,
      targetEmbedding: options?.targetEmbedding,
    };
    this.#observations.push(obs);

    // Recompute the projection
    this.#recomputeBonds();

    return this.getBond(source, target);
  }

  /**
   * #recomputeBonds — projects current #observations into active bonds.
   */
  #recomputeBonds(): void {
    this.#bonds.clear();
    for (const obs of this.#observations) {
      const key = `${obs.source}:${obs.target}`;

      // 1. Covalent Check
      if (obs.isLogicalDependency === true) {
        const bond: CovalentBond = {
          type: "covalent",
          source: obs.source,
          target: obs.target,
          strength: obs.strength ?? 1.0,
        };
        this.#bonds.set(key, bond);
        continue;
      }

      // 2. Hydrogen Check
      if (obs.sourceEmbedding && obs.targetEmbedding) {
        const sim = cosineSimilarity(obs.sourceEmbedding, obs.targetEmbedding);
        const semanticDistance = 1.0 - sim;
        if (semanticDistance <= this.#hydrogenThreshold) {
          const bond: HydrogenBond = {
            type: "hydrogen",
            source: obs.source,
            target: obs.target,
            semanticDistance,
          };
          this.#bonds.set(key, bond);
          continue;
        }
      }

      // 3. Van Der Waals Check
      if (
        obs.trajectoryLength !== undefined &&
        obs.trajectoryLength >= this.#vdwMinTrajectory
      ) {
        const bond: VanDerWaalsBond = {
          type: "vanDerWaals",
          source: obs.source,
          target: obs.target,
          trajectoryLength: obs.trajectoryLength,
        };
        this.#bonds.set(key, bond);
        continue;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Classic wrappers for backward compatibility and test conformance
  // -------------------------------------------------------------------------

  /**
   * addCovalentBond — wrapper around observe() for strong logical dependency.
   */
  addCovalentBond(
    source: StepId,
    target: StepId,
    strength: number,
  ): CovalentBond {
    this.observe(source, target, {
      isLogicalDependency: true,
      strength,
    });
    return this.getBond(source, target) as CovalentBond;
  }

  /**
   * addHydrogenBond — wrapper around observe() for weak semantic association.
   */
  addHydrogenBond(
    source: StepId,
    target: StepId,
    semanticDistance: number,
  ): HydrogenBond {
    if (semanticDistance > this.#hydrogenThreshold) {
      throw new Error(
        `HydrogenBond rejected: semanticDistance ${semanticDistance} exceeds threshold ${this.#hydrogenThreshold}. ` +
          `Steps are too semantically distant for a hydrogen bond.`,
      );
    }
    // We mock embeddings to generate the requested exact semanticDistance:
    // since semanticDistance = 1.0 - dotProduct(a, b) for L2 normalized vectors,
    // we can pass two vectors whose dot product equals 1.0 - semanticDistance.
    const sim = 1.0 - semanticDistance;
    const sourceEmbedding = new Float64Array([1.0, 0.0]);
    const targetEmbedding = new Float64Array([sim, Math.sqrt(Math.max(0, 1.0 - sim * sim))]);

    this.observe(source, target, {
      sourceEmbedding,
      targetEmbedding,
    });
    return this.getBond(source, target) as HydrogenBond;
  }

  /**
   * addVanDerWaalsBond — wrapper around observe() for transient proximity.
   */
  addVanDerWaalsBond(
    source: StepId,
    target: StepId,
    trajectoryLength: number,
  ): VanDerWaalsBond {
    if (trajectoryLength < this.#vdwMinTrajectory) {
      throw new Error(
        `VanDerWaalsBond rejected: trajectoryLength ${trajectoryLength} is below minimum ${this.#vdwMinTrajectory}. ` +
          `Trajectory too short for a meaningful proximity association.`,
      );
    }
    this.observe(source, target, {
      trajectoryLength,
    });
    return this.getBond(source, target) as VanDerWaalsBond;
  }

  // -------------------------------------------------------------------------
  // Covalent removal (with cascade invalidation)
  // -------------------------------------------------------------------------

  /**
   * removeCovalentBond — removes a covalent bond AND returns all transitively
   * dependent step IDs that must be re-derived (cascadeInvalidate).
   *
   * Under event-sourcing, this deletes the corresponding Covalent observation
   * and triggers dynamic projection recomputation.
   */
  removeCovalentBond(source: StepId, target: StepId): StepId[] {
    const key = `${source}:${target}`;
    const bond = this.#bonds.get(key);
    if (!bond || bond.type !== "covalent") {
      throw new Error(
        `No covalent bond found from ${source} to ${target}. ` +
          `Cannot cascade invalidate.`,
      );
    }

    // DFS from target through all covalent bonds to find transitive dependents BEFORE removal
    const invalidated: StepId[] = [];
    const visited = new Set<string>();
    const stack: StepId[] = [target];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const currentStr = current as string;
      if (visited.has(currentStr)) continue;
      visited.add(currentStr);
      invalidated.push(current);

      for (const [, b] of this.#bonds) {
        if (b.type === "covalent" && (b.source as string) === currentStr) {
          stack.push(b.target);
        }
      }
    }

    // Remove the observation representing this bond
    const index = this.#observations.findIndex(
      (o) => o.source === source && o.target === target && o.isLogicalDependency === true,
    );
    if (index !== -1) {
      this.#observations.splice(index, 1);
    }

    // Recompute projection without this observation
    this.#recomputeBonds();

    return invalidated;
  }

  // -------------------------------------------------------------------------
  // State Serialization / Persistence
  // -------------------------------------------------------------------------

  /** Export the entire observation log as a JSON-serializable snapshot. */
  snapshot(): BondGraphSnapshot {
    return {
      observations: this.#observations.map((o) => ({
        source: o.source as string,
        target: o.target as string,
        isLogicalDependency: o.isLogicalDependency,
        strength: o.strength,
        trajectoryLength: o.trajectoryLength,
        sourceEmbedding: o.sourceEmbedding ? Array.from(o.sourceEmbedding) : undefined,
        targetEmbedding: o.targetEmbedding ? Array.from(o.targetEmbedding) : undefined,
      })),
    };
  }

  /** Restore the observation log from a snapshot and recompute all bonds. */
  restore(snapshot: BondGraphSnapshot): void {
    this.#observations.length = 0;
    for (const o of snapshot.observations) {
      this.#observations.push({
        source: o.source as StepId,
        target: o.target as StepId,
        isLogicalDependency: o.isLogicalDependency,
        strength: o.strength,
        trajectoryLength: o.trajectoryLength,
        sourceEmbedding: o.sourceEmbedding ? new Float64Array(o.sourceEmbedding) : undefined,
        targetEmbedding: o.targetEmbedding ? new Float64Array(o.targetEmbedding) : undefined,
      });
    }
    this.#recomputeBonds();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getBonds(): ReadonlyArray<MolecularBond> {
    return Array.from(this.#bonds.values());
  }

  getDependents(stepId: StepId): ReadonlyArray<StepId> {
    const dependents: StepId[] = [];
    const visited = new Set<string>();
    const stack: StepId[] = [];

    const stepIdStr = stepId as string;
    for (const [, b] of this.#bonds) {
      if (b.type === "covalent" && (b.source as string) === stepIdStr) {
        stack.push(b.target);
      }
    }

    while (stack.length > 0) {
      const current = stack.pop()!;
      const currentStr = current as string;
      if (visited.has(currentStr)) continue;
      visited.add(currentStr);
      dependents.push(current);

      for (const [, b] of this.#bonds) {
        if (b.type === "covalent" && (b.source as string) === currentStr) {
          stack.push(b.target);
        }
      }
    }

    return dependents;
  }

  hasBond(source: StepId, target: StepId): boolean {
    return this.#bonds.has(`${source}:${target}`);
  }

  getBond(source: StepId, target: StepId): MolecularBond | undefined {
    return this.#bonds.get(`${source}:${target}`);
  }
}
