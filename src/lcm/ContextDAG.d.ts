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
import type { LCMEntry, SummaryNode } from "./interfaces.js";
import { ImmutableStore } from "./ImmutableStore.js";
import { SummaryIndex } from "./SummaryIndex.js";
export declare class ContextDAG {
    #private;
    constructor(store: ImmutableStore, summaryIndex: SummaryIndex);
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
    addSummaryNode(node: SummaryNode): void;
    /**
     * getEntry(entryId) — resolves a raw LCMEntry from the ImmutableStore by ID.
     *
     * @param entryId - The UUIDv7 ID of the entry.
     * @returns The frozen LCMEntry, or undefined if not found.
     */
    getEntry(entryId: string): LCMEntry | undefined;
    /**
     * getSummaryNode(nodeId) — retrieves a SummaryNode from SummaryIndex by ID.
     *
     * @param nodeId - The SummaryNode ID.
     * @returns The SummaryNode, or undefined if not found.
     */
    getSummaryNode(nodeId: string): SummaryNode | undefined;
    /**
     * getEntriesForSummary(summaryId) — resolves all originalEntryIds in a SummaryNode
     * to actual LCMEntry objects from the ImmutableStore.
     *
     * @param summaryId - The ID of the SummaryNode.
     * @returns ReadonlyArray of resolved LCMEntry objects (skips any missing IDs).
     */
    getEntriesForSummary(summaryId: string): ReadonlyArray<LCMEntry>;
    /**
     * getParentSummary(nodeId) — finds the SummaryNode that compresses the given node.
     *
     * A SummaryNode P is the parent of node N if P.intermediateCompressions contains
     * a compression whose childIds includes N's ID.
     *
     * @param nodeId - The ID of the child SummaryNode.
     * @returns The parent SummaryNode's ID, or undefined if no parent exists.
     */
    getParentSummary(nodeId: string): string | undefined;
}
//# sourceMappingURL=ContextDAG.d.ts.map