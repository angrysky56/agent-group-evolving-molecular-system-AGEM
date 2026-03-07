/**
 * TaskWorker.mock.mjs
 *
 * JavaScript mock worker for testing llm_map in vitest.
 *
 * This is a pure JavaScript ESM file — no TypeScript, no cross-imports.
 * It implements the same protocol as TaskWorker.ts but is directly loadable
 * by Node.js without tsx or compilation.
 *
 * Used by: llm_map.test.ts (via workerScriptPath pointing to this file)
 *
 * Behavior matches TaskWorker.ts:
 * - { shouldFail: true } → returns { taskId, success: false, error }
 * - { value: number } → returns { taskId, success: true, result: { result: value * 2, _context } }
 * - { prompt: string } → returns { taskId, success: true, result: { response: '...', _context } }
 * - { delay: ms } → waits ms milliseconds before responding (for order preservation tests)
 * - Otherwise → returns { taskId, success: true, result: { _value: 'OK', _context } }
 */

import { parentPort } from "node:worker_threads";

if (parentPort === null) {
  throw new Error("TaskWorker.mock.mjs must be run as a worker thread");
}

// Worker-local message count for tracking (used in round-robin tests)
let messageCount = 0;

parentPort.on("message", async ({ task, context }) => {
  messageCount++;
  const payload = task.payload ?? {};
  const contextEntries = context ?? {};

  // Simulate async delay if requested (for order preservation tests T2)
  const delay = typeof payload.delay === "number" ? payload.delay : 0;
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // Failure injection
  if (payload.shouldFail === true) {
    parentPort.postMessage({
      taskId: task.id,
      success: false,
      error: new Error(`Task ${task.id} intentionally failed`),
    });
    return;
  }

  // Value doubling
  if (typeof payload.value === "number") {
    parentPort.postMessage({
      taskId: task.id,
      success: true,
      result: {
        result: payload.value * 2,
        workerMessageCount: messageCount,
        _context: contextEntries,
      },
    });
    return;
  }

  // Prompt echo
  if (typeof payload.prompt === "string") {
    parentPort.postMessage({
      taskId: task.id,
      success: true,
      result: {
        response: `Response to: ${payload.prompt}`,
        workerMessageCount: messageCount,
        _context: contextEntries,
      },
    });
    return;
  }

  // Default: OK with message count for round-robin tracking
  parentPort.postMessage({
    taskId: task.id,
    success: true,
    result: {
      _value: "OK",
      workerMessageCount: messageCount,
      _context: contextEntries,
    },
  });
});
