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
export type StepId = string & { readonly __brand: 'StepId' };

// ---------------------------------------------------------------------------
// Bond type discriminant
// ---------------------------------------------------------------------------

/**
 * BondType — string literal union for the three Molecular-CoT bond classifications.
 */
export type BondType = 'covalent' | 'hydrogen' | 'vanDerWaals';

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
  readonly type: 'covalent';
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
  readonly type: 'hydrogen';
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
  readonly type: 'vanDerWaals';
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
// BondGraph — enforces behavioral invariants at creation/removal time
// ---------------------------------------------------------------------------

/**
 * BondGraph — manages a collection of MolecularBond instances with enforced
 * behavioral invariants.
 *
 * This is NOT metadata tagging. The class makes it IMPOSSIBLE to:
 *   - Create a HydrogenBond with semanticDistance > threshold
 *   - Create a VanDerWaalsBond with trajectoryLength < minimum
 *   - Remove a CovalentBond without getting the set of invalidated steps back
 *
 * Internal storage: Map<string, MolecularBond> keyed on `${source}:${target}`.
 */
export class BondGraph {
  readonly #bonds: Map<string, MolecularBond> = new Map();
  readonly #hydrogenThreshold: number;
  readonly #vdwMinTrajectory: number;

  constructor(options?: {
    hydrogenThreshold?: number;
    vdwMinTrajectory?: number;
  }) {
    this.#hydrogenThreshold = options?.hydrogenThreshold ?? HYDROGEN_DISTANCE_THRESHOLD;
    this.#vdwMinTrajectory = options?.vdwMinTrajectory ?? VAN_DER_WAALS_MIN_TRAJECTORY;
  }

  // -------------------------------------------------------------------------
  // Bond creation
  // -------------------------------------------------------------------------

  /**
   * addCovalentBond — creates a strong logical dependency bond.
   * Always succeeds (no constraints on covalent bond creation).
   *
   * @param source - The step that the target depends on.
   * @param target - The step derived from source.
   * @param strength - Dependency strength (0.0 to 1.0).
   */
  addCovalentBond(source: StepId, target: StepId, strength: number): CovalentBond {
    const bond: CovalentBond = { type: 'covalent', source, target, strength };
    this.#bonds.set(`${source}:${target}`, bond);
    return bond;
  }

  /**
   * addHydrogenBond — creates a weak semantic association bond.
   *
   * @throws {Error} if semanticDistance > hydrogenThreshold.
   *
   * @param source - Source step.
   * @param target - Target step (semantically related).
   * @param semanticDistance - Semantic distance (0.0 to 1.0).
   */
  addHydrogenBond(source: StepId, target: StepId, semanticDistance: number): HydrogenBond {
    if (semanticDistance > this.#hydrogenThreshold) {
      throw new Error(
        `HydrogenBond rejected: semanticDistance ${semanticDistance} exceeds threshold ${this.#hydrogenThreshold}. ` +
          `Steps are too semantically distant for a hydrogen bond.`
      );
    }
    const bond: HydrogenBond = { type: 'hydrogen', source, target, semanticDistance };
    this.#bonds.set(`${source}:${target}`, bond);
    return bond;
  }

  /**
   * addVanDerWaalsBond — creates a transient proximity bond.
   *
   * @throws {Error} if trajectoryLength < vdwMinTrajectory.
   *
   * @param source - Source step.
   * @param target - Target step (appeared nearby in trajectory).
   * @param trajectoryLength - Length of the reasoning trajectory.
   */
  addVanDerWaalsBond(source: StepId, target: StepId, trajectoryLength: number): VanDerWaalsBond {
    if (trajectoryLength < this.#vdwMinTrajectory) {
      throw new Error(
        `VanDerWaalsBond rejected: trajectoryLength ${trajectoryLength} is below minimum ${this.#vdwMinTrajectory}. ` +
          `Trajectory too short for a meaningful proximity association.`
      );
    }
    const bond: VanDerWaalsBond = { type: 'vanDerWaals', source, target, trajectoryLength };
    this.#bonds.set(`${source}:${target}`, bond);
    return bond;
  }

  // -------------------------------------------------------------------------
  // Bond removal
  // -------------------------------------------------------------------------

  /**
   * removeCovalentBond — removes a covalent bond AND returns all transitively
   * dependent step IDs that must be re-derived (cascadeInvalidate).
   *
   * Uses DFS from `target` through all covalent bonds to find transitive dependents.
   * The returned array includes `target` itself and all steps reachable via covalent
   * bonds FROM target.
   *
   * @param source - Source step of the bond to remove.
   * @param target - Target step of the bond to remove.
   * @returns Array of StepIds that need re-derivation (cascadeInvalidate result).
   * @throws {Error} if the covalent bond does not exist.
   */
  removeCovalentBond(source: StepId, target: StepId): StepId[] {
    const key = `${source}:${target}`;
    const bond = this.#bonds.get(key);
    if (!bond || bond.type !== 'covalent') {
      throw new Error(
        `No covalent bond found from ${source} to ${target}. ` +
          `Cannot cascade invalidate.`
      );
    }

    // Remove the bond.
    this.#bonds.delete(key);

    // DFS from target through all covalent bonds to find transitive dependents.
    const invalidated: StepId[] = [];
    const visited = new Set<string>();
    const stack: StepId[] = [target];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const currentStr = current as string;
      if (visited.has(currentStr)) continue;
      visited.add(currentStr);
      invalidated.push(current);

      // Find all covalent bonds where current is the source.
      for (const [, b] of this.#bonds) {
        if (b.type === 'covalent' && (b.source as string) === currentStr) {
          stack.push(b.target);
        }
      }
    }

    return invalidated;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /**
   * getBonds — returns all bonds in the graph.
   */
  getBonds(): ReadonlyArray<MolecularBond> {
    return Array.from(this.#bonds.values());
  }

  /**
   * getDependents — returns all transitive dependents of stepId via covalent bonds.
   *
   * Does NOT include stepId itself. Useful for read-only dependency analysis
   * without modifying the bond graph.
   *
   * @param stepId - The step to find dependents for.
   */
  getDependents(stepId: StepId): ReadonlyArray<StepId> {
    const dependents: StepId[] = [];
    const visited = new Set<string>();
    const stack: StepId[] = [];

    // Find immediate covalent dependents of stepId.
    const stepIdStr = stepId as string;
    for (const [, b] of this.#bonds) {
      if (b.type === 'covalent' && (b.source as string) === stepIdStr) {
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
        if (b.type === 'covalent' && (b.source as string) === currentStr) {
          stack.push(b.target);
        }
      }
    }

    return dependents;
  }

  /**
   * hasBond — checks if a bond exists between source and target.
   */
  hasBond(source: StepId, target: StepId): boolean {
    return this.#bonds.has(`${source}:${target}`);
  }

  /**
   * getBond — retrieves a specific bond by source and target.
   */
  getBond(source: StepId, target: StepId): MolecularBond | undefined {
    return this.#bonds.get(`${source}:${target}`);
  }
}
