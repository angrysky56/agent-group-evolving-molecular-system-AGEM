/**
 * LCMExpand.ts
 *
 * Async generator for hierarchical context unrolling.
 *
 * lcm_expand provides a lazy, streaming interface for traversing the summary hierarchy.
 * The Orchestrator (Phase 5) uses this to retrieve context on-demand without loading
 * all entries eagerly.
 *
 * Expansion order (hierarchical table of contents):
 *   1. Summary node: the high-level compressed representation (kind="summary")
 *   2. Intermediate compressions (if any): ordered by level (kind="compression")
 *   3. Original entries: resolved from ImmutableStore via ContextDAG (kind="entry")
 *
 * Laziness guarantee:
 *   Entries are yielded one-at-a-time via `yield`. If the consumer breaks early,
 *   remaining entries are never fetched from the DAG. This prevents unnecessary
 *   I/O and enables streaming consumption.
 *
 * Pointer fidelity guarantee (ROADMAP success criterion 4):
 *   Entry content is fetched directly from the DAG (which delegates to ImmutableStore).
 *   No inference modifies the content — yielded entry.content === store.get(id)!.content.
 *
 * Dependencies:
 *   - ContextDAG: getSummaryNode + getEntry for hierarchical traversal
 *   - ExpandLevel: discriminated union for type-safe yields
 */
import type { ExpandLevel } from "./interfaces.js";
import { ContextDAG } from "./ContextDAG.js";
/**
 * lcm_expand(summaryNodeId, dag) — async generator for hierarchical context traversal.
 *
 * Yields items in order: summary → compressions → entries.
 *
 * Usage:
 * ```typescript
 * for await (const item of lcm_expand(summaryId, dag)) {
 *   if (item.kind === 'summary') { ... }
 *   if (item.kind === 'compression') { ... }
 *   if (item.kind === 'entry') { ... }
 *   break; // safe — generator is lazy, no more entries fetched
 * }
 * ```
 *
 * @param summaryNodeId - The ID of the SummaryNode to expand.
 * @param dag           - The ContextDAG providing both SummaryNode and entry access.
 * @yields ExpandLevel items: summary, then compressions, then entries.
 */
export declare function lcm_expand(summaryNodeId: string, dag: ContextDAG): AsyncGenerator<ExpandLevel, void, unknown>;
//# sourceMappingURL=LCMExpand.d.ts.map