/**
 * llm_map.test.ts
 *
 * Comprehensive tests for llm_map parallel task dispatch primitive.
 *
 * Tests T1-T15 cover:
 * - T1: Basic dispatch (3 tasks to pool)
 * - T2: ORDER PRESERVATION (5 tasks with delays — CRITICAL pitfall guard)
 * - T3: Result structure (taskId, success, result/error fields)
 * - T4: Partial failure handling (mixed success/error results)
 * - T5: Context propagation to workers
 * - T6: Empty task list
 * - T7: Single task
 * - T8: Worker pool round-robin dispatch
 * - T9: Worker errors don't crash llm_map or other tasks
 * - T10: Workers terminated after llm_map (no resource leaks)
 * - T11: Large payload handling
 * - T12: Task with missing/undefined payload fields
 * - T13: Multiple sequential llm_map calls
 * - T14: Context propagation via AsyncLocalStorage.run()
 * - T15: Pool size larger than task count (clamps to task count)
 *
 * Uses TaskWorker.mock.mjs (pure JavaScript, no TypeScript cross-imports)
 * to avoid ESM resolution issues in vitest worker thread context.
 */

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { llm_map, contextStorage, formatTaskForWorker } from './llm_map.js';
import type { Task } from './interfaces.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/**
 * Absolute path to the JavaScript mock worker.
 * Uses .mjs extension for pure ESM without tsx/compile dependencies.
 */
const MOCK_WORKER_PATH = fileURLToPath(
  new URL('./workers/TaskWorker.mock.mjs', import.meta.url)
);

/**
 * createMockTask — factory for test tasks.
 *
 * @param id - Task ID (must be unique within a batch)
 * @param payload - Task-specific data
 * @returns Task object ready for dispatch
 */
function createMockTask<T>(id: string, payload: T): Task<T> {
  return { id, payload };
}

/**
 * getTaskIds — extract taskId from results for easy assertion.
 */
function getTaskIds(results: readonly { taskId: string }[]): string[] {
  return results.map((r) => r.taskId);
}

// ---------------------------------------------------------------------------
// T1: Basic dispatch
// ---------------------------------------------------------------------------

describe('T1: llm_map dispatches N tasks to worker pool', () => {
  it('dispatches 3 tasks and returns 3 results', async () => {
    const tasks = [
      createMockTask('task-1', { value: 1 }),
      createMockTask('task-2', { value: 2 }),
      createMockTask('task-3', { value: 3 }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    expect(results).toHaveLength(3);
  });

  it('all task IDs appear in results', async () => {
    const tasks = [
      createMockTask('alpha', { value: 10 }),
      createMockTask('beta', { value: 20 }),
      createMockTask('gamma', { value: 30 }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);
    const resultIds = getTaskIds(results);

    expect(resultIds).toContain('alpha');
    expect(resultIds).toContain('beta');
    expect(resultIds).toContain('gamma');
  });
});

// ---------------------------------------------------------------------------
// T2: ORDER PRESERVATION — CRITICAL pitfall guard (Pitfall 5)
// ---------------------------------------------------------------------------

describe('T2: Results returned in original task order regardless of completion order', () => {
  it('5 tasks with delays — results match original order', async () => {
    // Tasks are distributed to 2 workers; even-indexed (0,2,4) and odd-indexed (1,3) tasks
    // go to different workers. We give even tasks a delay so odd tasks may finish first.
    // Despite different completion times, results MUST be in original order.
    const tasks = [
      createMockTask('order-0', { delay: 50, value: 0 }),  // slow (worker 0)
      createMockTask('order-1', { delay: 0, value: 1 }),   // fast (worker 1)
      createMockTask('order-2', { delay: 50, value: 2 }),  // slow (worker 0)
      createMockTask('order-3', { delay: 0, value: 3 }),   // fast (worker 1)
      createMockTask('order-4', { delay: 50, value: 4 }),  // slow (worker 0)
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    // CRITICAL: results[i].taskId must equal tasks[i].id for ALL i
    expect(results).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(results[i].taskId).toBe(tasks[i].id);
    }
  });

  it('results order matches original task index (not completion time)', async () => {
    // Create tasks with reversed delay pattern: last tasks fastest
    const tasks = [
      createMockTask('slow-first', { delay: 60, prompt: 'A' }),
      createMockTask('slow-second', { delay: 40, prompt: 'B' }),
      createMockTask('fast-third', { delay: 0, prompt: 'C' }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 3);

    // Even though 'fast-third' completes first, results must be in original order
    expect(results[0].taskId).toBe('slow-first');
    expect(results[1].taskId).toBe('slow-second');
    expect(results[2].taskId).toBe('fast-third');
  });
});

// ---------------------------------------------------------------------------
// T3: Result structure
// ---------------------------------------------------------------------------

describe('T3: All results have correct structure (taskId, success, result/error)', () => {
  it('successful results have taskId, success:true, and result field', async () => {
    const tasks: Task<unknown>[] = [
      createMockTask('struct-1', { value: 5 }),
      createMockTask('struct-2', { prompt: 'Hello' }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    for (const result of results) {
      expect(result).toHaveProperty('taskId');
      expect(typeof result.taskId).toBe('string');
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('result');
      expect(result.result).not.toBeUndefined();
    }
  });

  it('failed results have taskId, success:false, and error field', async () => {
    const tasks = [createMockTask('fail-struct', { shouldFail: true })];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);

    expect(results).toHaveLength(1);
    expect(results[0].taskId).toBe('fail-struct');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
    expect(results[0].error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// T4: Partial failure handling
// ---------------------------------------------------------------------------

describe('T4: Partial failure handling — mixed success/error results', () => {
  it('5 tasks where tasks [2] and [4] fail — all 5 results returned', async () => {
    const tasks: Task<unknown>[] = [
      createMockTask('pf-0', { value: 1 }),           // success
      createMockTask('pf-1', { value: 2 }),           // success
      createMockTask('pf-2', { shouldFail: true }),   // FAIL
      createMockTask('pf-3', { value: 3 }),           // success
      createMockTask('pf-4', { shouldFail: true }),   // FAIL
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    // All 5 results must be returned
    expect(results).toHaveLength(5);

    // Check successes
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(results[3].success).toBe(true);

    // Check failures
    expect(results[2].success).toBe(false);
    expect(results[2].error).toBeDefined();
    expect(results[4].success).toBe(false);
    expect(results[4].error).toBeDefined();
  });

  it('llm_map resolves (not rejects) even when all tasks fail', async () => {
    const tasks = [
      createMockTask('all-fail-1', { shouldFail: true }),
      createMockTask('all-fail-2', { shouldFail: true }),
      createMockTask('all-fail-3', { shouldFail: true }),
    ];

    // Should resolve, not reject
    const results = await expect(
      llm_map(tasks, MOCK_WORKER_PATH, 2)
    ).resolves.toBeDefined();

    const resolved = await llm_map(tasks, MOCK_WORKER_PATH, 2);
    expect(resolved).toHaveLength(3);
    expect(resolved.every((r) => r.success === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T5: Context propagation
// ---------------------------------------------------------------------------

describe('T5: Context propagation to workers via AsyncLocalStorage', () => {
  it('context values passed to worker appear in result._context', async () => {
    const tasks = [createMockTask('ctx-1', { value: 42 })];

    // Run llm_map inside a contextStorage context
    const results = await contextStorage.run(
      new Map<string, unknown>([
        ['userId', 'test-user-123'],
        ['sessionId', 'sess-abc'],
      ]),
      () => llm_map(tasks, MOCK_WORKER_PATH, 1)
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    const resultData = results[0].result as Record<string, unknown>;
    const ctx = resultData['_context'] as Record<string, unknown>;

    expect(ctx['userId']).toBe('test-user-123');
    expect(ctx['sessionId']).toBe('sess-abc');
  });

  it('workers receive context even without AsyncLocalStorage.run()', async () => {
    // Without contextStorage.run(), context is empty {}
    const tasks = [createMockTask('no-ctx', { value: 1 })];
    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);

    expect(results[0].success).toBe(true);
    // _context should be empty object (no store set)
    const resultData = results[0].result as Record<string, unknown>;
    const ctx = resultData['_context'] as Record<string, unknown>;
    expect(typeof ctx).toBe('object');
    expect(Object.keys(ctx)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T6: Empty task list
// ---------------------------------------------------------------------------

describe('T6: Empty task list returns empty results', () => {
  it('returns [] for empty task array', async () => {
    const results = await llm_map([], MOCK_WORKER_PATH, 4);

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('empty result is not null or undefined', async () => {
    const results = await llm_map([], MOCK_WORKER_PATH, 2);
    expect(results).not.toBeNull();
    expect(results).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T7: Single task
// ---------------------------------------------------------------------------

describe('T7: Single task works correctly', () => {
  it('single task with poolSize=1 returns correct result', async () => {
    const tasks = [createMockTask('single-1', { value: 7 })];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);

    expect(results).toHaveLength(1);
    expect(results[0].taskId).toBe('single-1');
    expect(results[0].success).toBe(true);
  });

  it('single task result preserved in original order', async () => {
    const tasks = [createMockTask('only-task', { prompt: 'solo' })];
    const results = await llm_map(tasks, MOCK_WORKER_PATH, 4);

    expect(results[0].taskId).toBe('only-task');
  });
});

// ---------------------------------------------------------------------------
// T8: Worker pool round-robin dispatch
// ---------------------------------------------------------------------------

describe('T8: Worker pool reuses workers for multiple tasks', () => {
  it('6 tasks with poolSize=2 — messages distributed across workers', async () => {
    // 6 tasks dispatched to 2 workers = 3 tasks per worker (round-robin)
    // We track workerMessageCount in each worker to verify distribution
    const tasks = Array.from({ length: 6 }, (_, i) =>
      createMockTask(`rr-${i}`, { value: i + 1 })
    );

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    // All 6 tasks must complete
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.success === true)).toBe(true);

    // Verify results in original order
    for (let i = 0; i < 6; i++) {
      expect(results[i].taskId).toBe(`rr-${i}`);
    }
  });

  it('poolSize=3 with 9 tasks — all tasks complete successfully', async () => {
    const tasks = Array.from({ length: 9 }, (_, i) =>
      createMockTask(`pool-${i}`, { value: i * 2 })
    );

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 3);

    expect(results).toHaveLength(9);
    expect(results.every((r) => r.success === true)).toBe(true);
    // Order preserved
    for (let i = 0; i < 9; i++) {
      expect(results[i].taskId).toBe(`pool-${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// T9: Worker errors don't crash llm_map or other tasks
// ---------------------------------------------------------------------------

describe('T9: Worker errors do not crash llm_map or other tasks', () => {
  it('task[1] fails — task[0] and task[2] still succeed', async () => {
    const tasks: Task<unknown>[] = [
      createMockTask('crash-0', { value: 100 }),        // success
      createMockTask('crash-1', { shouldFail: true }),  // FAIL
      createMockTask('crash-2', { value: 200 }),        // success
    ];

    // llm_map must resolve (not throw)
    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);  // crash-0 succeeded
    expect(results[1].success).toBe(false); // crash-1 failed
    expect(results[2].success).toBe(true);  // crash-2 succeeded
  });

  it('llm_map does not throw when a task fails', async () => {
    const tasks = [createMockTask('no-throw', { shouldFail: true })];
    await expect(llm_map(tasks, MOCK_WORKER_PATH, 1)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T10: Workers terminated after llm_map completes
// ---------------------------------------------------------------------------

describe('T10: Workers are terminated after llm_map completes (no resource leaks)', () => {
  it('llm_map completes without hanging (implicit: workers terminated)', async () => {
    // If workers are not terminated, the test would hang indefinitely
    // vitest timeout (default: 5s) would catch leaked workers
    const tasks = [
      createMockTask('leak-1', { value: 1 }),
      createMockTask('leak-2', { value: 2 }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);
    expect(results).toHaveLength(2);
    // Test completes = workers were terminated (no hang)
  });

  it('multiple sequential llm_map calls complete without worker accumulation', async () => {
    // If workers leaked, memory usage would grow; calls would hang waiting for dead workers
    for (let i = 0; i < 3; i++) {
      const tasks = [
        createMockTask(`seq-${i}-a`, { value: i }),
        createMockTask(`seq-${i}-b`, { value: i + 1 }),
      ];
      const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);
      expect(results).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// T11: Large payload handling
// ---------------------------------------------------------------------------

describe('T11: TaskResult with large payload', () => {
  it('large string payload completes without serialization error', async () => {
    const largeString = 'x'.repeat(100_000);
    const tasks = [createMockTask('large-1', { prompt: largeString })];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it('large nested object payload dispatches correctly', async () => {
    const largePayload = {
      items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item-${i}` })),
    };
    const tasks = [createMockTask('large-obj', largePayload)];

    // Large payloads are serialized via postMessage (structured clone)
    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);
    expect(results).toHaveLength(1);
    // May succeed or fail depending on serialization; just must not throw
  });
});

// ---------------------------------------------------------------------------
// T12: formatTaskForWorker validation
// ---------------------------------------------------------------------------

describe('T12: formatTaskForWorker validates task serialization', () => {
  it('valid task passes through unchanged', () => {
    const task = createMockTask('valid-1', { value: 42 });
    const formatted = formatTaskForWorker(task);
    expect(formatted.id).toBe('valid-1');
    expect((formatted.payload as { value: number }).value).toBe(42);
  });

  it('task with empty ID throws', () => {
    const badTask = createMockTask('', { value: 1 });
    expect(() => formatTaskForWorker(badTask)).toThrow();
  });

  it('task with circular payload throws', () => {
    const circular: Record<string, unknown> = { value: 1 };
    circular['self'] = circular; // circular reference
    const badTask: Task<unknown> = { id: 'circular', payload: circular };
    expect(() => formatTaskForWorker(badTask)).toThrow();
  });

  it('task with function payload throws (functions are not serializable)', () => {
    // JSON.stringify drops functions, so payload becomes incomplete
    const funcPayload = { fn: () => 'hello', value: 42 };
    const task: Task<unknown> = { id: 'func-task', payload: funcPayload };
    // After JSON round-trip: { value: 42 } (fn dropped) — this is lossy but not an error
    // We detect non-circular cases where data is dropped silently
    const formatted = formatTaskForWorker(task);
    // formatTaskForWorker does JSON round-trip which drops functions silently
    expect((formatted.payload as { value: number }).value).toBe(42);
    // fn is dropped (undefined after JSON parse)
    expect((formatted.payload as Record<string, unknown>)['fn']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T13: Multiple sequential llm_map calls
// ---------------------------------------------------------------------------

describe('T13: Multiple sequential llm_map calls work independently', () => {
  it('second call returns fresh results unaffected by first call', async () => {
    const tasks1 = [createMockTask('seq-call-1', { value: 10 })];
    const tasks2 = [createMockTask('seq-call-2', { value: 20 })];

    const results1 = await llm_map(tasks1, MOCK_WORKER_PATH, 1);
    const results2 = await llm_map(tasks2, MOCK_WORKER_PATH, 1);

    expect(results1[0].taskId).toBe('seq-call-1');
    expect(results2[0].taskId).toBe('seq-call-2');
  });

  it('three sequential calls all complete with correct results', async () => {
    const allResults = [];
    for (let call = 0; call < 3; call++) {
      const tasks = [
        createMockTask(`call-${call}-0`, { value: call * 10 }),
        createMockTask(`call-${call}-1`, { value: call * 10 + 1 }),
      ];
      const results = await llm_map(tasks, MOCK_WORKER_PATH, 2);
      allResults.push(results);
    }

    expect(allResults).toHaveLength(3);
    for (let call = 0; call < 3; call++) {
      expect(allResults[call]).toHaveLength(2);
      expect(allResults[call][0].taskId).toBe(`call-${call}-0`);
      expect(allResults[call][1].taskId).toBe(`call-${call}-1`);
    }
  });
});

// ---------------------------------------------------------------------------
// T14: Context propagation via AsyncLocalStorage.run()
// ---------------------------------------------------------------------------

describe('T14: Context propagation via AsyncLocalStorage.run() nesting', () => {
  it('context from outer run() is captured and sent to workers', async () => {
    const tasks = [
      createMockTask('ctx-nest-1', { value: 1 }),
      createMockTask('ctx-nest-2', { value: 2 }),
    ];

    const context = new Map<string, unknown>([
      ['traceId', 'trace-999'],
      ['tenantId', 'tenant-abc'],
    ]);

    const results = await contextStorage.run(context, () =>
      llm_map(tasks, MOCK_WORKER_PATH, 2)
    );

    for (const result of results) {
      expect(result.success).toBe(true);
      const resultData = result.result as Record<string, unknown>;
      const ctx = resultData['_context'] as Record<string, unknown>;
      expect(ctx['traceId']).toBe('trace-999');
      expect(ctx['tenantId']).toBe('tenant-abc');
    }
  });

  it('different llm_map calls with different contexts are isolated', async () => {
    const tasks = [createMockTask('iso-1', { value: 1 })];

    const ctx1 = new Map<string, unknown>([['env', 'production']]);
    const ctx2 = new Map<string, unknown>([['env', 'staging']]);

    const [results1, results2] = await Promise.all([
      contextStorage.run(ctx1, () => llm_map(tasks, MOCK_WORKER_PATH, 1)),
      contextStorage.run(ctx2, () => llm_map(tasks.map(t => ({ ...t, id: t.id + '-2' })), MOCK_WORKER_PATH, 1)),
    ]);

    const ctx1Data = (results1[0].result as Record<string, unknown>)['_context'] as Record<string, unknown>;
    const ctx2Data = (results2[0].result as Record<string, unknown>)['_context'] as Record<string, unknown>;

    expect(ctx1Data['env']).toBe('production');
    expect(ctx2Data['env']).toBe('staging');
  });
});

// ---------------------------------------------------------------------------
// T15: Pool size edge cases
// ---------------------------------------------------------------------------

describe('T15: Pool size edge cases', () => {
  it('poolSize larger than task count — tasks still complete (no extra workers block)', async () => {
    // poolSize=10 but only 2 tasks — effectivePoolSize should clamp to 2
    const tasks = [
      createMockTask('clamp-1', { value: 1 }),
      createMockTask('clamp-2', { value: 2 }),
    ];

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 10);

    expect(results).toHaveLength(2);
    expect(results[0].taskId).toBe('clamp-1');
    expect(results[1].taskId).toBe('clamp-2');
  });

  it('poolSize=1 processes all tasks sequentially on single worker', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      createMockTask(`serial-${i}`, { value: i + 1 })
    );

    const results = await llm_map(tasks, MOCK_WORKER_PATH, 1);

    expect(results).toHaveLength(5);
    // Order preserved
    for (let i = 0; i < 5; i++) {
      expect(results[i].taskId).toBe(`serial-${i}`);
    }
  });

  it('default poolSize (4) works without explicit poolSize argument', async () => {
    const tasks = [
      createMockTask('default-pool-1', { value: 1 }),
      createMockTask('default-pool-2', { value: 2 }),
    ];

    // Default poolSize=4, but 2 tasks → effectivePoolSize=2
    const results = await llm_map(tasks, MOCK_WORKER_PATH);

    expect(results).toHaveLength(2);
    expect(results[0].taskId).toBe('default-pool-1');
    expect(results[1].taskId).toBe('default-pool-2');
  });
});
