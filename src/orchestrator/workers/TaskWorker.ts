/**
 * TaskWorker.ts
 *
 * Worker thread entry point for llm_map parallel task dispatch.
 *
 * CONTRACT:
 * - Receives { task, context } messages from the main thread (WorkerInboundMessage)
 * - Executes task.payload and sends back a TaskResult via parentPort.postMessage()
 * - Task execution errors are caught, serialized, and returned — worker NEVER crashes
 * - Context is available via contextStorage.getStore() during task execution
 *
 * CONTEXT PROPAGATION:
 * - The context received is a plain object (already serialized by main thread)
 * - Do NOT use complex objects (class instances) from context — they don't survive postMessage()
 * - Context contains primitives and plain objects only; no functions or methods
 *
 * NOTE ON contextStorage:
 * - Worker threads have a completely separate module graph from the main thread.
 * - The contextStorage in the worker is a DIFFERENT AsyncLocalStorage instance
 *   from the one in llm_map.ts. This is by design: worker context is restored
 *   from the serialized plain object received via postMessage.
 * - Do NOT try to share the main thread's contextStorage with workers —
 *   AsyncLocalStorage cannot cross worker thread boundaries.
 *
 * STUBBED EXECUTION:
 * - This worker provides a deterministic stub (no actual LLM call)
 * - Real implementations replace the execute() function with actual LLM inference
 * - Stub behavior: echoes context in result, applies payload transformations
 *
 * WORKER LIFECYCLE:
 * - Worker process exits naturally when main thread terminates it (w.terminate())
 * - No explicit shutdown needed from the worker side
 *
 * @module TaskWorker
 */

import { parentPort } from 'node:worker_threads';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Task, TaskResult } from '../interfaces.js';

// ---------------------------------------------------------------------------
// Worker-local AsyncLocalStorage — separate from main thread's contextStorage
// ---------------------------------------------------------------------------

/**
 * workerContextStorage — worker-local context storage.
 *
 * This is a SEPARATE instance from the main thread's contextStorage.
 * Worker threads do not share the main thread's module context.
 * Context is restored from the serialized plain object in each message.
 */
const workerContextStorage = new AsyncLocalStorage<Map<string, unknown>>();

// ---------------------------------------------------------------------------
// Message type (mirrored from llm_map.ts to avoid cross-thread import)
// ---------------------------------------------------------------------------

interface WorkerInboundMessage {
  readonly task: Task<unknown>;
  readonly context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stub task executor — replace with real LLM inference in production
// ---------------------------------------------------------------------------

/**
 * execute — deterministic stub task executor.
 *
 * Applies simple transformations to task.payload for testing:
 * - If payload has { shouldFail: true } → throws an Error
 * - If payload has { value: number } → returns { result: value * 2 }
 * - If payload has { prompt: string } → returns { response: 'Response to: ${prompt}' }
 * - Otherwise → returns 'OK'
 *
 * The current execution context (including userId, sessionId, etc.) is
 * accessible via workerContextStorage.getStore() during execution.
 *
 * Production implementations replace this with actual LLM inference:
 * ```typescript
 * async function execute(task: Task<unknown>): Promise<unknown> {
 *   const ctx = workerContextStorage.getStore();
 *   const userId = ctx?.get('userId');
 *   const llm = await getLLMInstance();
 *   return llm.generate((task.payload as { prompt: string }).prompt);
 * }
 * ```
 *
 * @param task - Task to execute
 * @returns Task execution result (any serializable value)
 * @throws Error if task.payload.shouldFail === true (for testing error handling)
 */
function execute(task: Task<unknown>): unknown {
  const payload = task.payload;

  if (payload !== null && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;

    // Failure injection: for testing partial failure handling (T4, T9)
    if (p['shouldFail'] === true) {
      throw new Error(`Task ${task.id} intentionally failed`);
    }

    // Value doubling: for testing numeric transformations
    if (typeof p['value'] === 'number') {
      return { result: p['value'] * 2 };
    }

    // Prompt echo: for testing string payloads
    if (typeof p['prompt'] === 'string') {
      return { response: `Response to: ${p['prompt']}` };
    }
  }

  return 'OK';
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

// Guard: ensure we are running in a worker thread context
if (parentPort === null) {
  throw new Error(
    'TaskWorker.ts must be run as a worker thread (parentPort is null). ' +
      'Do not import this file directly — spawn it via new Worker(workerScriptPath).'
  );
}

// Capture parentPort reference (non-null at this point)
const port = parentPort;

/**
 * Main message handler: receives tasks from llm_map and sends results back.
 *
 * Each message is processed independently:
 * 1. Extract task and context from message
 * 2. Restore context via workerContextStorage.run()
 * 3. Execute task; catch any errors
 * 4. Send TaskResult back via parentPort.postMessage()
 *
 * NOTE: Worker does NOT crash on task failure — errors are caught and returned
 * as TaskResult.success=false, TaskResult.error=err.
 */
port.on(
  'message',
  async (message: WorkerInboundMessage): Promise<void> => {
    const { task, context } = message;

    // Restore context from serialized plain object
    // workerContextStorage.run() makes context available via getStore()
    // for the duration of the async callback (including any awaits inside execute).
    const contextMap = new Map<string, unknown>(Object.entries(context));

    await workerContextStorage.run(contextMap, async () => {
      let result: TaskResult<unknown>;

      try {
        // Execute task — this is where real LLM inference would happen
        const output = execute(task);

        // Get restored context to echo back (so tests can verify propagation)
        const restoredContext = workerContextStorage.getStore();
        const contextEntries: Record<string, unknown> = restoredContext
          ? Object.fromEntries(restoredContext)
          : {};

        // Build success result; include echoed context for T5 (context propagation test)
        const baseResult =
          output !== null && output !== undefined && typeof output === 'object'
            ? (output as Record<string, unknown>)
            : { _value: output };

        result = {
          taskId: task.id,
          success: true,
          result: { ...baseResult, _context: contextEntries },
        };
      } catch (err) {
        // Task execution failed: serialize error and return as failure result
        // Error must be serializable (string message only, not full stack trace)
        const errorMessage =
          err instanceof Error
            ? err.message
            : `Task execution failed: ${String(err)}`;

        result = {
          taskId: task.id,
          success: false,
          error: new Error(errorMessage),
        };
      }

      // Send result back to main thread
      port.postMessage(result);
    });
  }
);

/**
 * Worker-level error handler: catches any unhandled errors from message handler.
 * Individual task errors are handled inside the message handler.
 * This handler catches catastrophic worker failures.
 */
port.on('error', (err: Error) => {
  console.error('[TaskWorker] Unhandled worker error:', err.message);
  // Don't throw — let the worker process exit naturally
});
