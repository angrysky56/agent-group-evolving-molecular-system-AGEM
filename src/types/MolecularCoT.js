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
    #bonds = new Map();
    #hydrogenThreshold;
    #vdwMinTrajectory;
    constructor(options) {
        this.#hydrogenThreshold =
            options?.hydrogenThreshold ?? HYDROGEN_DISTANCE_THRESHOLD;
        this.#vdwMinTrajectory =
            options?.vdwMinTrajectory ?? VAN_DER_WAALS_MIN_TRAJECTORY;
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
    addCovalentBond(source, target, strength) {
        const bond = { type: "covalent", source, target, strength };
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
    addHydrogenBond(source, target, semanticDistance) {
        if (semanticDistance > this.#hydrogenThreshold) {
            throw new Error(`HydrogenBond rejected: semanticDistance ${semanticDistance} exceeds threshold ${this.#hydrogenThreshold}. ` +
                `Steps are too semantically distant for a hydrogen bond.`);
        }
        const bond = {
            type: "hydrogen",
            source,
            target,
            semanticDistance,
        };
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
    addVanDerWaalsBond(source, target, trajectoryLength) {
        if (trajectoryLength < this.#vdwMinTrajectory) {
            throw new Error(`VanDerWaalsBond rejected: trajectoryLength ${trajectoryLength} is below minimum ${this.#vdwMinTrajectory}. ` +
                `Trajectory too short for a meaningful proximity association.`);
        }
        const bond = {
            type: "vanDerWaals",
            source,
            target,
            trajectoryLength,
        };
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
    removeCovalentBond(source, target) {
        const key = `${source}:${target}`;
        const bond = this.#bonds.get(key);
        if (!bond || bond.type !== "covalent") {
            throw new Error(`No covalent bond found from ${source} to ${target}. ` +
                `Cannot cascade invalidate.`);
        }
        // Remove the bond.
        this.#bonds.delete(key);
        // DFS from target through all covalent bonds to find transitive dependents.
        const invalidated = [];
        const visited = new Set();
        const stack = [target];
        while (stack.length > 0) {
            const current = stack.pop();
            const currentStr = current;
            if (visited.has(currentStr))
                continue;
            visited.add(currentStr);
            invalidated.push(current);
            // Find all covalent bonds where current is the source.
            for (const [, b] of this.#bonds) {
                if (b.type === "covalent" && b.source === currentStr) {
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
    getBonds() {
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
    getDependents(stepId) {
        const dependents = [];
        const visited = new Set();
        const stack = [];
        // Find immediate covalent dependents of stepId.
        const stepIdStr = stepId;
        for (const [, b] of this.#bonds) {
            if (b.type === "covalent" && b.source === stepIdStr) {
                stack.push(b.target);
            }
        }
        while (stack.length > 0) {
            const current = stack.pop();
            const currentStr = current;
            if (visited.has(currentStr))
                continue;
            visited.add(currentStr);
            dependents.push(current);
            for (const [, b] of this.#bonds) {
                if (b.type === "covalent" && b.source === currentStr) {
                    stack.push(b.target);
                }
            }
        }
        return dependents;
    }
    /**
     * hasBond — checks if a bond exists between source and target.
     */
    hasBond(source, target) {
        return this.#bonds.has(`${source}:${target}`);
    }
    /**
     * getBond — retrieves a specific bond by source and target.
     */
    getBond(source, target) {
        return this.#bonds.get(`${source}:${target}`);
    }
}
//# sourceMappingURL=MolecularCoT.js.map