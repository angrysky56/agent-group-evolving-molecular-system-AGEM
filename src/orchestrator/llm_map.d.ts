/**
 * llm_map.ts
 *
 * ORCH-02: Parallel task dispatch primitive with context preservation and order guarantees.
 *
 * Dispatches N tasks to a pool of worker threads, preserves execution context via
 * AsyncLocalStorage, and returns results in original call order regardless of
 * worker completion order (CRITICAL: Pitfall 5 guard).
 *
 * Key design decisions:
 * - Order preservation: results sorted by original task index before returning
 * - Context serialization: plain objects only (no functions, class instances, circular refs)
 * - Partial failures: all errors caught and returned as TaskResult; llm_map never rejects
 * - No retry logic: caller decides retry strategy
 * - Workers created fresh per call (clean state); terminated in finally block (no leaks)
 *
 * Example usage:
 * ```typescript
 * // Dispatch 3 parallel tasks to a 2-worker pool
 * const results = await llm_map([
 *   { id: 'task-1', payload: { prompt: 'A' } },
 *   { id: 'task-2', payload: { prompt: 'B' } },
 *   { id: 'task-3', payload: { prompt: 'C' } },
 * ], new URL('./workers/TaskWorker.js', import.meta.url).pathname, 2);
 * // Results are in [task-1, task-2, task-3] order regardless of completion order
 * for (const r of results) {
 *   if (r.success) console.log(r.result);
 *   else console.error(r.error);
 * }
 * ```
 *
 * @module llm_map
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Task, TaskResult } from "./interfaces.js";
/**
 * contextStorage — AsyncLocalStorage instance for propagating execution context.
 *
 * Usage (main thread):
 *   contextStorage.run(new Map([['userId', '123']]), () => llm_map(tasks, path));
 *
 * The context snapshot is serialized before dispatch to each worker.
 * Workers receive a plain object (Record<string, unknown>) via postMessage.
 *
 * Exported so TaskWorker.ts can use it to restore context within the worker.
 */
export declare const contextStorage: AsyncLocalStorage<Map<string, unknown>>;
/**
 * WorkerInboundMessage — structure sent from main thread to worker.
 * Contains the task to execute and a serialized context snapshot.
 *
 * NOTE: Only primitives and plain objects survive postMessage().
 * Functions, class instances, and circular references are NOT supported.
 */
export interface WorkerInboundMessage<T = unknown> {
    readonly task: Task<T>;
    readonly context: Record<string, unknown>;
}
/**
 * WorkerOutboundMessage — structure sent from worker back to main thread.
 * Must match TaskResult<T> with taskId correlation.
 */
export type WorkerOutboundMessage<T = unknown> = TaskResult<T>;
/**
 * formatTaskForWorker — deep-clone task payload as plain object.
 *
 * Workers can't deserialize functions, methods, or class instances — only
 * primitives and plain data objects survive postMessage() structured clone.
 * This helper validates that payload is serializable before dispatch.
 *
 * @param task - Task to format
 * @returns Task with deep-cloned plain-object payload
 * @throws Error if payload contains non-serializable values (functions, symbols)
 */
export declare function formatTaskForWorker<T>(task: Task<T>): Task<T>;
/**
 * llm_map — dispatch N tasks to a worker thread pool and return results in
 * original task order.
 *
 * ORDER PRESERVATION GUARANTEE:
 *   results[i].taskId === tasks[i].id for all i, regardless of worker
 *   completion order. Workers complete tasks at different speeds; results are
 *   sorted by original task index before returning.
 *
 * PARTIAL FAILURE HANDLING:
 *   If some tasks succeed and others fail, ALL results are returned (both
 *   successes and errors). llm_map() resolves with the full array; it never
 *   rejects due to individual task failures.
 *
 * CONTEXT PROPAGATION:
 *   If contextStorage.getStore() is non-null, its key-value pairs are
 *   serialized as a plain object and sent with each task. Workers restore
 *   context via contextStorage.run() for the duration of task execution.
 *
 * WORKER LIFECYCLE:
 *   Workers are spawned fresh at the start of each llm_map() call and
 *   terminated in the finally block. No workers outlive the call (no leaks).
 *
 * @template T - Type of the task payload (and result value, by convention)
 * @param tasks - Tasks to dispatch; empty array returns [] immediately
 * @param workerScriptPath - Absolute path to the worker thread script
 * @param poolSize - Number of worker threads (default: 4); tasks distributed round-robin
 * @returns Promise resolving to results in original task order
 *
 * @example
 * const results = await llm_map(
 *   [{ id: 'a', payload: { value: 1 } }, { id: 'b', payload: { value: 2 } }],
 *   new URL('./workers/TaskWorker.js', import.meta.url).pathname,
 *   2
 * );
 * // results[0].taskId === 'a', results[1].taskId === 'b' always
 */
export declare function llm_map<T>(tasks: readonly Task<T>[], workerScriptPath: string, poolSize?: number): Promise<readonly TaskResult<T>[]>;
//# sourceMappingURL=llm_map.d.ts.map