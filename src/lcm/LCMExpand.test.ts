/**
 * LCMExpand.test.ts
 *
 * Tests for lcm_expand — async generator for hierarchical context unrolling.
 *
 * Test coverage:
 *   T12  — lcm_expand yields summary first
 *   T12b — lcm_expand yields compressions second (when present)
 *   T12c — lcm_expand yields original entries last
 *   T12d — lcm_expand entry content matches ImmutableStore exactly (ROADMAP criterion 4)
 *   T13  — lcm_expand is lazy — early break stops iteration
 *   T13b — lcm_expand handles empty compressions
 *   T13c — lcm_expand handles SummaryNode with one entry
 *
 * ROADMAP Success Criterion 4 (pointer fidelity): T12d
 * Laziness guarantee: T13
 */

import { describe, it, expect, vi } from 'vitest';
import { ImmutableStore } from './ImmutableStore.js';
import { SummaryIndex } from './SummaryIndex.js';
import { ContextDAG } from './ContextDAG.js';
import { lcm_expand } from './LCMExpand.js';
import { GptTokenCounter } from './interfaces.js';
import type { SummaryNode } from './interfaces.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshSetup() {
  const tokenCounter = new GptTokenCounter();
  const store = new ImmutableStore(tokenCounter);
  const summaryIndex = new SummaryIndex();
  const dag = new ContextDAG(store, summaryIndex);
  return { store, summaryIndex, dag };
}

/**
 * Create a SummaryNode with the specified entry IDs and intermediate compressions.
 */
function makeSummaryNode(
  id: string,
  content: string,
  originalEntryIds: string[],
  intermediateCompressions: Array<{ level: number; content: string; childIds: string[] }> = [],
): SummaryNode {
  return {
    id,
    content,
    originalEntryIds,
    createdAt: Date.now(),
    version: 1,
    metrics: {},
    metricHistory: [],
    intermediateCompressions,
  };
}

// ---------------------------------------------------------------------------
// T12: lcm_expand yields summary first
// ---------------------------------------------------------------------------

describe('T12: lcm_expand yields summary first', () => {
  it('first yielded value has kind="summary" with summaryNode content', async () => {
    const { store, dag } = freshSetup();

    // Append 3 entries
    const e1 = store.append('Entry one content');
    const e2 = store.append('Entry two content');
    const e3 = store.append('Entry three content');

    const summaryNode = makeSummaryNode(
      'summary-1',
      'This is the summary of three entries',
      [e1.id, e2.id, e3.id],
    );
    dag.addSummaryNode(summaryNode);

    const gen = lcm_expand('summary-1', dag);
    const first = await gen.next();

    expect(first.done).toBe(false);
    expect(first.value).toBeDefined();
    const firstValue = first.value as Record<string, unknown>;
    expect(firstValue['kind']).toBe('summary');
    expect(firstValue['nodeId']).toBe('summary-1');
    expect(firstValue['content']).toBe('This is the summary of three entries');
  });
});

// ---------------------------------------------------------------------------
// T12b: lcm_expand yields compressions second
// ---------------------------------------------------------------------------

describe('T12b: lcm_expand yields compressions second', () => {
  it('after summary, intermediate compressions are yielded with kind="compression"', async () => {
    const { store, dag } = freshSetup();

    const e1 = store.append('Entry one');
    const e2 = store.append('Entry two');

    const summaryNode = makeSummaryNode(
      'summary-2',
      'Summary content',
      [e1.id, e2.id],
      [
        { level: 1, content: 'Level 1 compression text', childIds: [e1.id] },
        { level: 2, content: 'Level 2 compression text', childIds: [e2.id] },
      ],
    );
    dag.addSummaryNode(summaryNode);

    const results: unknown[] = [];
    for await (const item of lcm_expand('summary-2', dag)) {
      results.push(item);
    }

    // First is summary
    expect((results[0] as Record<string, unknown>)['kind']).toBe('summary');

    // Next two are compressions in order
    expect((results[1] as Record<string, unknown>)['kind']).toBe('compression');
    expect((results[1] as Record<string, unknown>)['level']).toBe(1);
    expect((results[1] as Record<string, unknown>)['content']).toBe('Level 1 compression text');
    expect((results[2] as Record<string, unknown>)['kind']).toBe('compression');
    expect((results[2] as Record<string, unknown>)['level']).toBe(2);
    expect((results[2] as Record<string, unknown>)['content']).toBe('Level 2 compression text');
  });
});

// ---------------------------------------------------------------------------
// T12c: lcm_expand yields original entries last
// ---------------------------------------------------------------------------

describe('T12c: lcm_expand yields original entries last', () => {
  it('after summary and compressions, original entries are yielded with kind="entry"', async () => {
    const { store, dag } = freshSetup();

    const e1 = store.append('First original entry');
    const e2 = store.append('Second original entry');
    const e3 = store.append('Third original entry');

    const summaryNode = makeSummaryNode(
      'summary-3',
      'Summary covering all entries',
      [e1.id, e2.id, e3.id],
    );
    dag.addSummaryNode(summaryNode);

    const results: unknown[] = [];
    for await (const item of lcm_expand('summary-3', dag)) {
      results.push(item);
    }

    // Summary is first
    expect((results[0] as Record<string, unknown>)['kind']).toBe('summary');

    // Entries follow (no intermediate compressions in this node)
    const entryResults = results.slice(1);
    expect(entryResults).toHaveLength(3);
    for (const r of entryResults) {
      expect((r as Record<string, unknown>)['kind']).toBe('entry');
    }
    expect((entryResults[0] as Record<string, unknown>)['content']).toBe('First original entry');
    expect((entryResults[1] as Record<string, unknown>)['content']).toBe('Second original entry');
    expect((entryResults[2] as Record<string, unknown>)['content']).toBe('Third original entry');
  });
});

// ---------------------------------------------------------------------------
// T12d: pointer fidelity — entry content matches ImmutableStore exactly
// ---------------------------------------------------------------------------

describe('T12d: lcm_expand entry content matches ImmutableStore exactly', () => {
  it('yielded entry content is byte-identical to ImmutableStore original (ROADMAP criterion 4)', async () => {
    const { store, dag } = freshSetup();

    const contents = [
      'First entry: some specialized content with unicode characters: 日本語',
      'Second entry: another piece of content with special chars: <>&"',
      'Third entry: numeric content: 42 3.14159 -273.15',
    ];

    const entries = contents.map((c) => store.append(c));
    const summaryNode = makeSummaryNode(
      'summary-4',
      'Summary of three diverse entries',
      entries.map((e) => e.id),
    );
    dag.addSummaryNode(summaryNode);

    for await (const item of lcm_expand('summary-4', dag)) {
      if (item.kind === 'entry') {
        // ROADMAP criterion 4: pointer fidelity — no inference has modified it
        const storeEntry = store.get(item.entryId);
        expect(storeEntry).toBeDefined();
        // Byte-identical content
        expect(item.content).toBe(storeEntry!.content);
        // Token count matches
        expect(item.tokenCount).toBe(storeEntry!.tokenCount);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T13: lcm_expand is lazy — early break stops iteration
// ---------------------------------------------------------------------------

describe('T13: lcm_expand is lazy — early break stops iteration', () => {
  it('breaking after summary prevents entry fetch calls', async () => {
    const { store, dag } = freshSetup();

    // Create 10 entries
    const entries = Array.from({ length: 10 }, (_, i) =>
      store.append(`Entry ${i}: some content here`)
    );

    const summaryNode = makeSummaryNode(
      'summary-5',
      'Summary of 10 entries',
      entries.map((e) => e.id),
    );
    dag.addSummaryNode(summaryNode);

    // Spy on store.get to detect if entries are accessed
    const getSpy = vi.spyOn(store, 'get');

    // Iterate but break immediately after the first yield (summary)
    let iterationCount = 0;
    for await (const item of lcm_expand('summary-5', dag)) {
      iterationCount++;
      if (item.kind === 'summary') break; // Break immediately after summary
    }

    // We consumed only the summary
    expect(iterationCount).toBe(1);

    // The spy should show zero calls for entry IDs (entries never fetched)
    // store.get may be called to retrieve the SummaryNode but NOT for individual entries
    const entryIds = new Set(entries.map((e) => e.id));
    const entryGetCalls = getSpy.mock.calls.filter(([id]) => entryIds.has(id));
    expect(entryGetCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T13b: lcm_expand handles empty compressions
// ---------------------------------------------------------------------------

describe('T13b: lcm_expand handles empty compressions', () => {
  it('with no intermediateCompressions, generator yields summary then directly yields entries', async () => {
    const { store, dag } = freshSetup();

    const e1 = store.append('Direct entry one');
    const e2 = store.append('Direct entry two');

    const summaryNode = makeSummaryNode(
      'summary-6',
      'Summary with no compressions',
      [e1.id, e2.id],
      [], // empty intermediateCompressions
    );
    dag.addSummaryNode(summaryNode);

    const results: unknown[] = [];
    for await (const item of lcm_expand('summary-6', dag)) {
      results.push(item);
    }

    // summary + 2 entries = 3 total
    expect(results).toHaveLength(3);
    expect((results[0] as Record<string, unknown>)['kind']).toBe('summary');
    expect((results[1] as Record<string, unknown>)['kind']).toBe('entry');
    expect((results[2] as Record<string, unknown>)['kind']).toBe('entry');

    // No 'compression' kind in results
    const kinds = results.map((r) => (r as Record<string, unknown>)['kind']);
    expect(kinds).not.toContain('compression');
  });
});

// ---------------------------------------------------------------------------
// T13c: lcm_expand handles SummaryNode with one entry
// ---------------------------------------------------------------------------

describe('T13c: lcm_expand handles SummaryNode with one entry', () => {
  it('edge case: single entry yields summary + 1 entry only', async () => {
    const { store, dag } = freshSetup();

    const e1 = store.append('The single entry in this summary');

    const summaryNode = makeSummaryNode(
      'summary-7',
      'Summary of a single entry',
      [e1.id],
    );
    dag.addSummaryNode(summaryNode);

    const results: unknown[] = [];
    for await (const item of lcm_expand('summary-7', dag)) {
      results.push(item);
    }

    expect(results).toHaveLength(2);
    expect((results[0] as Record<string, unknown>)['kind']).toBe('summary');
    expect((results[1] as Record<string, unknown>)['kind']).toBe('entry');
    expect((results[1] as Record<string, unknown>)['content']).toBe(
      'The single entry in this summary',
    );
  });
});
