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
/**
 * StepId — opaque branded string type for reasoning step IDs.
 * Matches the VertexId/EdgeId/TextNodeId pattern from GraphTypes.ts.
 */
export type StepId = string & {
    readonly __brand: "StepId";
};
/**
 * BondType — string literal union for the three Molecular-CoT bond classifications.
 */
export type BondType = "covalent" | "hydrogen" | "vanDerWaals";
/**
 * HYDROGEN_DISTANCE_THRESHOLD — maximum semantic distance allowed for hydrogen bonds.
 *
 * HydrogenBond creation is rejected if semanticDistance > this value.
 * Configurable per-instance via BondGraph constructor, but 0.7 is the default
 * (cosine similarity-based distance: 1.0 = identical, 0.0 = orthogonal).
 */
export declare const HYDROGEN_DISTANCE_THRESHOLD = 0.7;
/**
 * VAN_DER_WAALS_MIN_TRAJECTORY — minimum trajectory length for Van der Waals bonds.
 *
 * VanDerWaalsBond creation is rejected if trajectoryLength < this value.
 * Based on paper's 5.32 average trajectory length; 5.0 is the minimum viable.
 */
export declare const VAN_DER_WAALS_MIN_TRAJECTORY = 5;
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
export declare class BondGraph {
    #private;
    constructor(options?: {
        hydrogenThreshold?: number;
        vdwMinTrajectory?: number;
    });
    /**
     * addCovalentBond — creates a strong logical dependency bond.
     * Always succeeds (no constraints on covalent bond creation).
     *
     * @param source - The step that the target depends on.
     * @param target - The step derived from source.
     * @param strength - Dependency strength (0.0 to 1.0).
     */
    addCovalentBond(source: StepId, target: StepId, strength: number): CovalentBond;
    /**
     * addHydrogenBond — creates a weak semantic association bond.
     *
     * @throws {Error} if semanticDistance > hydrogenThreshold.
     *
     * @param source - Source step.
     * @param target - Target step (semantically related).
     * @param semanticDistance - Semantic distance (0.0 to 1.0).
     */
    addHydrogenBond(source: StepId, target: StepId, semanticDistance: number): HydrogenBond;
    /**
     * addVanDerWaalsBond — creates a transient proximity bond.
     *
     * @throws {Error} if trajectoryLength < vdwMinTrajectory.
     *
     * @param source - Source step.
     * @param target - Target step (appeared nearby in trajectory).
     * @param trajectoryLength - Length of the reasoning trajectory.
     */
    addVanDerWaalsBond(source: StepId, target: StepId, trajectoryLength: number): VanDerWaalsBond;
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
    removeCovalentBond(source: StepId, target: StepId): StepId[];
    /**
     * getBonds — returns all bonds in the graph.
     */
    getBonds(): ReadonlyArray<MolecularBond>;
    /**
     * getDependents — returns all transitive dependents of stepId via covalent bonds.
     *
     * Does NOT include stepId itself. Useful for read-only dependency analysis
     * without modifying the bond graph.
     *
     * @param stepId - The step to find dependents for.
     */
    getDependents(stepId: StepId): ReadonlyArray<StepId>;
    /**
     * hasBond — checks if a bond exists between source and target.
     */
    hasBond(source: StepId, target: StepId): boolean;
    /**
     * getBond — retrieves a specific bond by source and target.
     */
    getBond(source: StepId, target: StepId): MolecularBond | undefined;
}
//# sourceMappingURL=MolecularCoT.d.ts.map