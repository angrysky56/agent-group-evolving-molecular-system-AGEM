/**
 * SummaryIndex.ts
 *
 * Separate mutable-but-tracked storage for SummaryNodes.
 *
 * Design principles:
 *   - SummaryNode content is immutable once created (frozen at add time).
 *   - SummaryNode metrics are mutable-but-tracked: every change is recorded in
 *     metricHistory as a MetricUpdate with old value, new value, and timestamp.
 *   - SummaryIndex is independent of ImmutableStore — it handles only SummaryNodes.
 *   - ContextDAG wires SummaryIndex to ImmutableStore for pointer resolution.
 *
 * Per user decision (STATE.md): SummaryNodes live separately from ImmutableStore.
 * ImmutableStore holds raw LCMEntry objects; SummaryIndex holds compressed SummaryNodes.
 */
import type { SummaryNode } from "./interfaces.js";
export declare class SummaryIndex {
    #private;
    /**
     * add(node) — stores a SummaryNode in the index.
     *
     * The `content` field of the stored node is frozen to prevent mutation.
     * We freeze the node object itself at the top level, but since SummaryNode.metrics
     * and SummaryNode.metricHistory must remain mutable-but-tracked, we apply a
     * selective freeze strategy:
     *   - A new object is stored internally with content frozen via Object.defineProperty.
     *   - The node object exposed via get() has content as a non-writable property.
     *
     * Implementation: We store a frozen-content wrapper by using Object.freeze on
     * a shallow copy of the node with all writable fields intact except `content`.
     *
     * @param node - The SummaryNode to store. Its content becomes immutable.
     */
    add(node: SummaryNode): void;
    /**
     * get(id) — retrieves a SummaryNode by ID.
     *
     * @param id - The SummaryNode ID.
     * @returns The SummaryNode, or undefined if not found.
     */
    get(id: string): SummaryNode | undefined;
    /**
     * updateMetric(nodeId, field, value) — updates a metric on a SummaryNode.
     *
     * Records the change in metricHistory with:
     *   - timestamp: Date.now()
     *   - field: the metric field name
     *   - oldValue: the previous value (or undefined if first update)
     *   - newValue: the new value
     *
     * The content field is NOT affected — it remains immutable.
     *
     * @param nodeId - The ID of the SummaryNode to update.
     * @param field  - The metric field name to update.
     * @param value  - The new value for the metric field.
     * @throws Error if nodeId is not found.
     */
    updateMetric(nodeId: string, field: string, value: unknown): void;
    /**
     * list() — returns all SummaryNodes in the index.
     *
     * @returns ReadonlyArray of all stored SummaryNodes.
     */
    list(): ReadonlyArray<SummaryNode>;
    /**
     * has(id) — checks whether a SummaryNode exists in the index.
     *
     * @param id - The SummaryNode ID to check.
     * @returns True if the node exists, false otherwise.
     */
    has(id: string): boolean;
}
//# sourceMappingURL=SummaryIndex.d.ts.map