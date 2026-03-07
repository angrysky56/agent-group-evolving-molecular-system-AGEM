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
export async function* lcm_expand(
  summaryNodeId: string,
  dag: ContextDAG,
): AsyncGenerator<ExpandLevel, void, unknown> {
  // Step 1: Retrieve the SummaryNode from the DAG.
  const summary = dag.getSummaryNode(summaryNodeId);

  // If not found, the generator ends immediately (yields nothing).
  if (summary === undefined) {
    return;
  }

  // Step 2: Yield the summary as the first item (highest-level, most compressed).
  yield {
    kind: "summary",
    nodeId: summaryNodeId,
    content: summary.content,
  };

  // Step 3: Yield intermediate compressions in order (if any).
  // These are ordered by index in the intermediateCompressions array.
  // Each compression is a compressed view of a subset of entries.
  for (const compression of summary.intermediateCompressions) {
    yield {
      kind: "compression",
      level: compression.level,
      content: compression.content,
      pointsTo: compression.childIds,
    };
  }

  // Step 4: Yield original entries one-at-a-time (lazy — early break stops here).
  // Each entry is resolved via dag.getEntry(), which delegates to ImmutableStore.
  // Pointer fidelity: the content is pulled directly from the store with no modification.
  for (const entryId of summary.originalEntryIds) {
    const entry = dag.getEntry(entryId);
    if (entry !== undefined) {
      yield {
        kind: "entry",
        entryId,
        content: entry.content,
        tokenCount: entry.tokenCount,
      };
    }
  }
}
