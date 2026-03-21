/**
 * ContextDAG.ts
 *
 * DAG structure linking SummaryNodes to ImmutableStore entries.
 *
 * Architecture:
 *   - ContextDAG accepts an ImmutableStore (raw entries) and a SummaryIndex (summaries).
 *   - SummaryNodes are stored in SummaryIndex; raw entries stay in ImmutableStore.
 *   - ContextDAG coordinates between the two: addSummaryNode validates acyclicity,
 *     then delegates storage to SummaryIndex; getEntry delegates to ImmutableStore.
 *
 * Cycle detection:
 *   - The DAG enforces acyclicity when adding a SummaryNode.
 *   - A cycle occurs if a node's intermediateCompressions.childIds transitively leads
 *     back to that same node's ID.
 *   - Detection: DFS traversal of the child graph starting from the new node's
 *     intermediateCompressions childIds. If we encounter the new node's own ID,
 *     we throw an error.
 *
 * Lineage tracking (parent-child relationships):
 *   - When S2.intermediateCompressions contains childIds that include S1.id,
 *     S2 is considered the "parent" of S1 (S2 compresses S1).
 *   - getParentSummary(nodeId) finds which SummaryNode references nodeId in its
 *     intermediateCompressions.childIds.
 *
 * Per LCM-02 requirement: ContextDAG is the source of truth for hierarchical
 * context compression structure. EscalationProtocol and lcm_expand both consume
 * the ContextDAG in Wave 3.
 */
export class ContextDAG {
    #store;
    #summaryIndex;
    constructor(store, summaryIndex) {
        this.#store = store;
        this.#summaryIndex = summaryIndex;
    }
    /**
     * addSummaryNode(node) — validates acyclicity, then delegates to SummaryIndex.
     *
     * Cycle detection: Performs DFS traversal of intermediateCompressions.childIds
     * starting from the new node. If the new node's own ID appears in any reachable
     * child subtree, we throw a cycle error.
     *
     * @param node - The SummaryNode to add.
     * @throws Error matching /cycle/i if the node would create a cycle.
     */
    addSummaryNode(node) {
        this.#detectCycle(node);
        this.#summaryIndex.add(node);
    }
    /**
     * #detectCycle(node) — DFS-based cycle detection.
     *
     * Starting from the new node's intermediateCompressions childIds,
     * walk the existing DAG. If we find node.id in any visited subtree, throw.
     *
     * @param node - The candidate node being added.
     * @throws Error matching /cycle/i if a cycle is detected.
     */
    #detectCycle(node) {
        const targetId = node.id;
        const visited = new Set();
        // Gather all child IDs referenced by the new node's intermediateCompressions
        const startIds = [];
        for (const compression of node.intermediateCompressions) {
            for (const childId of compression.childIds) {
                startIds.push(childId);
            }
        }
        // DFS: starting from direct children of the new node, check if any path
        // leads back to the new node's own ID.
        const stack = [...startIds];
        while (stack.length > 0) {
            const currentId = stack.pop();
            // If we've found ourselves, it's a cycle
            if (currentId === targetId) {
                throw new Error(`ContextDAG: cycle detected — node '${targetId}' is reachable from its own intermediateCompressions childIds`);
            }
            if (visited.has(currentId))
                continue;
            visited.add(currentId);
            // Recurse into this node's own intermediateCompressions childIds (if it exists in the DAG)
            const existingNode = this.#summaryIndex.get(currentId);
            if (existingNode !== undefined) {
                for (const compression of existingNode.intermediateCompressions) {
                    for (const childId of compression.childIds) {
                        if (!visited.has(childId)) {
                            stack.push(childId);
                        }
                    }
                }
            }
        }
    }
    /**
     * getEntry(entryId) — resolves a raw LCMEntry from the ImmutableStore by ID.
     *
     * @param entryId - The UUIDv7 ID of the entry.
     * @returns The frozen LCMEntry, or undefined if not found.
     */
    getEntry(entryId) {
        return this.#store.get(entryId);
    }
    /**
     * getSummaryNode(nodeId) — retrieves a SummaryNode from SummaryIndex by ID.
     *
     * @param nodeId - The SummaryNode ID.
     * @returns The SummaryNode, or undefined if not found.
     */
    getSummaryNode(nodeId) {
        return this.#summaryIndex.get(nodeId);
    }
    /**
     * getEntriesForSummary(summaryId) — resolves all originalEntryIds in a SummaryNode
     * to actual LCMEntry objects from the ImmutableStore.
     *
     * @param summaryId - The ID of the SummaryNode.
     * @returns ReadonlyArray of resolved LCMEntry objects (skips any missing IDs).
     */
    getEntriesForSummary(summaryId) {
        const node = this.#summaryIndex.get(summaryId);
        if (node === undefined)
            return [];
        const entries = [];
        for (const entryId of node.originalEntryIds) {
            const entry = this.#store.get(entryId);
            if (entry !== undefined) {
                entries.push(entry);
            }
        }
        return entries;
    }
    /**
     * getParentSummary(nodeId) — finds the SummaryNode that compresses the given node.
     *
     * A SummaryNode P is the parent of node N if P.intermediateCompressions contains
     * a compression whose childIds includes N's ID.
     *
     * @param nodeId - The ID of the child SummaryNode.
     * @returns The parent SummaryNode's ID, or undefined if no parent exists.
     */
    getParentSummary(nodeId) {
        for (const node of this.#summaryIndex.list()) {
            for (const compression of node.intermediateCompressions) {
                if (compression.childIds.includes(nodeId)) {
                    return node.id;
                }
            }
        }
        return undefined;
    }
}
//# sourceMappingURL=ContextDAG.js.map