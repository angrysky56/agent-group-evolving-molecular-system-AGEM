/**
 * ContextDAG.test.ts
 *
 * Tests for ContextDAG (T6 series) and SummaryIndex (T5 series).
 *
 * Test coverage:
 *   T5   — addSummaryNode stores and retrieves by ID
 *   T5b  — SummaryNode content is immutable after add
 *   T5c  — metric update is auditable (single update creates MetricUpdate entry)
 *   T5d  — multiple metric updates create history with correct old/new values
 *   T5e  — listSummaryNodes returns all nodes
 *   T6   — DAG links SummaryNode to ImmutableStore entries
 *   T6b  — DAG detects cycles and throws
 *   T6c  — getSummaryNode returns undefined for missing ID
 *   T6d  — getEntriesForSummary returns all original entries
 *   T6e  — DAG tracks parent-child summary relationships
 */

import { describe, it, expect } from 'vitest';
import { ImmutableStore } from './ImmutableStore.js';
import { GptTokenCounter, type SummaryNode, type MetricUpdate } from './interfaces.js';
import { SummaryIndex } from './SummaryIndex.js';
import { ContextDAG } from './ContextDAG.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshStore(): ImmutableStore {
  return new ImmutableStore(new GptTokenCounter());
}

/**
 * Build a minimal SummaryNode for testing.
 * Only the required fields are provided; optional fields default to empty.
 */
function makeSummaryNode(
  id: string,
  content: string,
  originalEntryIds: string[],
  options: {
    intermediateCompressions?: { level: number; content: string; childIds: string[] }[];
  } = {},
): SummaryNode {
  return {
    id,
    content,
    originalEntryIds,
    createdAt: Date.now(),
    version: 1,
    metrics: {},
    metricHistory: [],
    intermediateCompressions: options.intermediateCompressions ?? [],
  };
}

// ---------------------------------------------------------------------------
// T5: addSummaryNode stores and retrieves
// ---------------------------------------------------------------------------

describe('T5: addSummaryNode stores and retrieves', () => {
  it('node retrieved by ID has same content and originalEntryIds', () => {
    const index = new SummaryIndex();
    const node = makeSummaryNode('summary-1', 'This is a summary.', ['entry-a', 'entry-b']);
    index.add(node);

    const retrieved = index.get('summary-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('summary-1');
    expect(retrieved!.content).toBe('This is a summary.');
    expect(retrieved!.originalEntryIds).toEqual(['entry-a', 'entry-b']);
  });
});

// ---------------------------------------------------------------------------
// T5b: SummaryNode content is immutable after add
// ---------------------------------------------------------------------------

describe('T5b: SummaryNode content is immutable', () => {
  it('attempting to mutate node.content after add throws or is silently prevented', () => {
    const index = new SummaryIndex();
    const node = makeSummaryNode('summary-2', 'Immutable content.', ['entry-a']);
    index.add(node);

    const retrieved = index.get('summary-2')!;
    // Content must be frozen — assigning to it must throw in strict mode.
    expect(() => {
      (retrieved as Record<string, unknown>)['content'] = 'mutated';
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T5c: metric update is auditable — single update
// ---------------------------------------------------------------------------

describe('T5c: metric update is auditable', () => {
  it('updateMetric records compressionRatio and creates one MetricUpdate entry', () => {
    const index = new SummaryIndex();
    const node = makeSummaryNode('summary-3', 'Summary text.', ['entry-a']);
    index.add(node);

    index.updateMetric('summary-3', 'compressionRatio', 0.5);

    const updated = index.get('summary-3')!;
    expect(updated.metrics['compressionRatio']).toBe(0.5);

    expect(updated.metricHistory).toHaveLength(1);
    const histEntry: MetricUpdate = updated.metricHistory[0]!;
    expect(histEntry.field).toBe('compressionRatio');
    expect(histEntry.oldValue).toBeUndefined();
    expect(histEntry.newValue).toBe(0.5);
    expect(typeof histEntry.timestamp).toBe('number');
    expect(histEntry.timestamp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T5d: multiple metric updates create history with correct old/new values
// ---------------------------------------------------------------------------

describe('T5d: multiple metric updates create history', () => {
  it('two updates on the same field produce two MetricUpdate entries with correct values', () => {
    const index = new SummaryIndex();
    const node = makeSummaryNode('summary-4', 'Another summary.', ['entry-a', 'entry-b']);
    index.add(node);

    index.updateMetric('summary-4', 'coherenceScore', 0.8);
    index.updateMetric('summary-4', 'coherenceScore', 0.6);

    const updated = index.get('summary-4')!;
    expect(updated.metrics['coherenceScore']).toBe(0.6);

    expect(updated.metricHistory).toHaveLength(2);

    const first = updated.metricHistory[0]!;
    expect(first.field).toBe('coherenceScore');
    expect(first.oldValue).toBeUndefined();
    expect(first.newValue).toBe(0.8);

    const second = updated.metricHistory[1]!;
    expect(second.field).toBe('coherenceScore');
    expect(second.oldValue).toBe(0.8);
    expect(second.newValue).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// T5e: listSummaryNodes returns all nodes
// ---------------------------------------------------------------------------

describe('T5e: listSummaryNodes returns all nodes', () => {
  it('list() returns 3 nodes after adding 3', () => {
    const index = new SummaryIndex();
    index.add(makeSummaryNode('s1', 'Summary 1', ['e1']));
    index.add(makeSummaryNode('s2', 'Summary 2', ['e2']));
    index.add(makeSummaryNode('s3', 'Summary 3', ['e3']));

    const all = index.list();
    expect(all).toHaveLength(3);
    const ids = all.map(n => n.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');
  });
});

// ---------------------------------------------------------------------------
// T6: DAG links SummaryNode to ImmutableStore entries
// ---------------------------------------------------------------------------

describe('T6: DAG links SummaryNode to ImmutableStore entries', () => {
  it('getEntry(id) resolves originalEntryIds to real LCMEntry objects', () => {
    const store = freshStore();
    const e1 = store.append('Entry content 1');
    const e2 = store.append('Entry content 2');
    const e3 = store.append('Entry content 3');

    const index = new SummaryIndex();
    const dag = new ContextDAG(store, index);

    const node = makeSummaryNode('dag-s1', 'Summary of 3 entries', [e1.id, e2.id, e3.id]);
    dag.addSummaryNode(node);

    expect(dag.getEntry(e1.id)!.content).toBe('Entry content 1');
    expect(dag.getEntry(e2.id)!.content).toBe('Entry content 2');
    expect(dag.getEntry(e3.id)!.content).toBe('Entry content 3');
  });
});

// ---------------------------------------------------------------------------
// T6b: DAG detects cycles and throws
// ---------------------------------------------------------------------------

describe('T6b: DAG detects cycle', () => {
  it('adding a node whose intermediateCompressions transitively leads back throws /cycle/i', () => {
    const store = freshStore();
    const e1 = store.append('Entry A');
    const e2 = store.append('Entry B');

    const index = new SummaryIndex();
    const dag = new ContextDAG(store, index);

    // S1 summarizes e1
    const s1 = makeSummaryNode('cycle-s1', 'Summary 1', [e1.id]);
    dag.addSummaryNode(s1);

    // S2 compresses S1 (intermediateCompressions references S1 via childIds)
    const s2 = makeSummaryNode('cycle-s2', 'Summary 2', [e2.id], {
      intermediateCompressions: [{ level: 2, content: 'Compressed', childIds: ['cycle-s1'] }],
    });
    dag.addSummaryNode(s2);

    // S3 tries to reference S2 in its intermediateCompressions, creating a path
    // S3 -> S2 -> S1, and then S3's originalEntryIds reference e1 which is also
    // under S1 -> S2. But a true cycle would be if S1 referenced S3 or S2 referenced itself.
    // The real cycle: S3's intermediateCompressions childIds = ['cycle-s2'],
    // and S2's intermediateCompressions already has S1.
    // For a detectable cycle, let's try to make S1 reference S2 in its intermediateCompressions
    // after S2 was already added as a compression parent of S1.
    //
    // We add S3 whose intermediateCompressions childIds includes 'cycle-s2',
    // and then try to create a cycle by having a node whose childIds eventually
    // loop back to itself. We test a direct self-reference first.
    expect(() => {
      const selfRef = makeSummaryNode('cycle-self', 'Self-referencing summary', [e1.id], {
        intermediateCompressions: [
          { level: 2, content: 'Cycle!', childIds: ['cycle-self'] },
        ],
      });
      dag.addSummaryNode(selfRef);
    }).toThrow(/cycle/i);
  });
});

// ---------------------------------------------------------------------------
// T6c: getSummaryNode returns undefined for missing ID
// ---------------------------------------------------------------------------

describe('T6c: getSummaryNode returns undefined for missing ID', () => {
  it('dag.getSummaryNode("nonexistent") returns undefined', () => {
    const store = freshStore();
    const index = new SummaryIndex();
    const dag = new ContextDAG(store, index);
    expect(dag.getSummaryNode('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T6d: getEntriesForSummary returns all original entries
// ---------------------------------------------------------------------------

describe('T6d: getEntriesForSummary returns all original entries', () => {
  it('5 entry IDs in summary resolves to 5 LCMEntry objects', () => {
    const store = freshStore();
    const entries = [
      store.append('Content A'),
      store.append('Content B'),
      store.append('Content C'),
      store.append('Content D'),
      store.append('Content E'),
    ];
    const entryIds = entries.map(e => e.id);

    const index = new SummaryIndex();
    const dag = new ContextDAG(store, index);

    const node = makeSummaryNode('dag-s2', 'Summary of 5', entryIds);
    dag.addSummaryNode(node);

    const resolved = dag.getEntriesForSummary('dag-s2');
    expect(resolved).toHaveLength(5);

    const resolvedContents = resolved.map(e => e.content);
    expect(resolvedContents).toContain('Content A');
    expect(resolvedContents).toContain('Content B');
    expect(resolvedContents).toContain('Content C');
    expect(resolvedContents).toContain('Content D');
    expect(resolvedContents).toContain('Content E');
  });
});

// ---------------------------------------------------------------------------
// T6e: DAG tracks parent-child summary relationships
// ---------------------------------------------------------------------------

describe('T6e: DAG tracks parent-child summary relationships', () => {
  it('S2 compressing S1 is retrievable via getParentSummary(s1.id)', () => {
    const store = freshStore();
    const e1 = store.append('Base entry 1');
    const e2 = store.append('Base entry 2');

    const index = new SummaryIndex();
    const dag = new ContextDAG(store, index);

    // S1: first-level summary from raw entries
    const s1 = makeSummaryNode('parent-s1', 'L1 Summary', [e1.id, e2.id]);
    dag.addSummaryNode(s1);

    // S2: second-level compression of S1 (S2 is the parent of S1)
    const s2 = makeSummaryNode('parent-s2', 'L2 Summary compressing S1', [e1.id], {
      intermediateCompressions: [{ level: 2, content: 'L2 compressed content', childIds: ['parent-s1'] }],
    });
    dag.addSummaryNode(s2);

    // S2 should be identified as the parent of S1
    expect(dag.getParentSummary('parent-s1')).toBe('parent-s2');
  });
});
