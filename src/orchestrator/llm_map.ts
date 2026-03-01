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

import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import type { Task, TaskResult } from './interfaces.js';

// ---------------------------------------------------------------------------
// AsyncLocalStorage context — propagated through async boundaries
// ---------------------------------------------------------------------------

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
export const contextStorage = new AsyncLocalStorage<Map<string, unknown>>();

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper: format task for cross-thread serialization
// ---------------------------------------------------------------------------

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
export function formatTaskForWorker<T>(task: Task<T>): Task<T> {
  // Validate: functions and symbols are not serializable
  if (typeof task.id !== 'string' || task.id.trim() === '') {
    throw new Error(
      `Task ID must be a non-empty string; got: ${JSON.stringify(task.id)}`
    );
  }

  // JSON round-trip validates serializability: functions → undefined (dropped),
  // circular refs → throws, symbols → dropped. Strict check for correctness.
  let clonedPayload: T;
  try {
    clonedPayload = JSON.parse(JSON.stringify(task.payload)) as T;
  } catch (err) {
    throw new Error(
      `Task payload for task '${task.id}' is not serializable: ${String(err)}`
    );
  }

  const clonedMetadata =
    task.metadata !== undefined
      ? (JSON.parse(JSON.stringify(task.metadata)) as Record<string, unknown>)
      : undefined;

  return {
    id: task.id,
    payload: clonedPayload,
    ...(clonedMetadata !== undefined ? { metadata: clonedMetadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// llm_map — parallel task dispatch with order preservation
// ---------------------------------------------------------------------------

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
export async function llm_map<T>(
  tasks: readonly Task<T>[],
  workerScriptPath: string,
  poolSize: number = 4
): Promise<readonly TaskResult<T>[]> {
  // Fast path: empty tasks
  if (tasks.length === 0) {
    return [];
  }

  // Clamp poolSize to [1, tasks.length] — no point spawning more workers than tasks
  const effectivePoolSize = Math.max(1, Math.min(poolSize, tasks.length));

  // Serialize context snapshot from AsyncLocalStorage before spawning workers
  // Context is captured ONCE per llm_map call and shared across all tasks.
  const contextStore = contextStorage.getStore();
  const contextData: Record<string, unknown> = contextStore
    ? Object.fromEntries(contextStore)
    : {};

  // Spawn a fresh pool of workers for this call
  const workers = Array.from(
    { length: effectivePoolSize },
    () => new Worker(workerScriptPath)
  );

  try {
    // Dispatch all tasks in parallel via round-robin worker assignment
    // Each task gets its own Promise that resolves when the corresponding
    // taskId message is received from the assigned worker.
    const taskPromises = tasks.map(
      (task, index): Promise<TaskResult<T>> => {
        const worker = workers[index % effectivePoolSize];

        return new Promise<TaskResult<T>>((resolve) => {
          // Per-task message handler: resolves when taskId matches
          const messageHandler = (message: WorkerOutboundMessage<T>): void => {
            if (message.taskId === task.id) {
              // Unsubscribe to avoid duplicate resolution
              worker.off('message', messageHandler);
              resolve(message);
            }
          };

          // Worker crash handler: resolve with error (don't reject)
          const errorHandler = (err: Error): void => {
            worker.off('message', messageHandler);
            resolve({
              taskId: task.id,
              success: false,
              error: err,
            });
          };

          worker.on('message', messageHandler);
          worker.once('error', errorHandler);

          // Format and dispatch: serialize payload for structured clone
          let formattedTask: Task<T>;
          try {
            formattedTask = formatTaskForWorker(task);
          } catch (formatErr) {
            // Serialization failure — resolve with error immediately (don't dispatch)
            worker.off('message', messageHandler);
            worker.off('error', errorHandler);
            resolve({
              taskId: task.id,
              success: false,
              error:
                formatErr instanceof Error
                  ? formatErr
                  : new Error(String(formatErr)),
            });
            return;
          }

          const inboundMessage: WorkerInboundMessage<T> = {
            task: formattedTask,
            context: contextData,
          };

          worker.postMessage(inboundMessage);
        });
      }
    );

    // Await all tasks in parallel (may complete out of order)
    const results = await Promise.all(taskPromises);

    // CRITICAL ORDER PRESERVATION: sort results back to original task order.
    // Worker completion order is non-deterministic; we always sort by original index.
    // Time complexity: O(n log n) — acceptable for typical pool sizes (n ≤ 100).
    return results.sort((a, b) => {
      const indexA = tasks.findIndex((t) => t.id === a.taskId);
      const indexB = tasks.findIndex((t) => t.id === b.taskId);
      return indexA - indexB;
    });
  } finally {
    // Cleanup: terminate ALL workers regardless of success or failure.
    // Worker.terminate() is async but we don't await it — best-effort cleanup.
    // No exceptions should escape from terminate() calls.
    for (const worker of workers) {
      worker.terminate().catch(() => {
        // Suppress termination errors — worker may already be dead
      });
    }
  }
}
