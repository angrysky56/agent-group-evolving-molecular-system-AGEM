/**
 * OrchestratorState.test.ts
 *
 * Tests for OrchestratorState enum and OrchestratorStateManager state machine.
 *
 * Test cases T1-T8:
 *   T1: NORMAL → OBSTRUCTED transition when H1 crosses threshold
 *   T2: OBSTRUCTED → CRITICAL transition when H1 exceeds critical threshold
 *   T3: CRITICAL → NORMAL transition when H1 drops below obstruction threshold
 *   T4: State change event emissions (payload structure verification)
 *   T5: getState() and getLastStateChangeTime() return correct values
 *   T6: No transition if already in target state (idempotent)
 *   T7: Thresholds are configurable
 *   T8: H1 = 0 always results in NORMAL state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorState, OrchestratorStateManager } from './OrchestratorState.js';
import type { StateChangeEvent } from './OrchestratorState.js';
import { EventBus } from './EventBus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock EventBus that captures emitted events.
 * Returns the bus plus a list of captured StateChangeEvents.
 */
function createMockEventBus(): { bus: EventBus; events: StateChangeEvent[] } {
  const bus = new EventBus();
  const events: StateChangeEvent[] = [];

  // We subscribe to 'orch:state-changed' to capture events.
  // Note: StateChangeEvent is not in AnyEvent union, so we cast via any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bus.subscribe('orch:state-changed', (event: any) => {
    events.push(event as StateChangeEvent);
  });

  return { bus, events };
}

/**
 * Create an OrchestratorStateManager with optional custom thresholds.
 */
function createStateManager(
  bus: EventBus,
  obstructionThreshold?: number,
  criticalThreshold?: number
): OrchestratorStateManager {
  return new OrchestratorStateManager(bus, obstructionThreshold, criticalThreshold);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestratorState enum', () => {
  it('exports NORMAL, OBSTRUCTED, CRITICAL enum values', () => {
    expect(OrchestratorState.NORMAL).toBe('NORMAL');
    expect(OrchestratorState.OBSTRUCTED).toBe('OBSTRUCTED');
    expect(OrchestratorState.CRITICAL).toBe('CRITICAL');
  });
});

describe('OrchestratorStateManager', () => {
  let bus: EventBus;
  let events: StateChangeEvent[];
  let sm: OrchestratorStateManager;

  beforeEach(() => {
    ({ bus, events } = createMockEventBus());
    sm = createStateManager(bus); // default thresholds: obs=2, crit=5
  });

  // T1: NORMAL → OBSTRUCTED transition when H1 crosses threshold
  it('T1: NORMAL → OBSTRUCTED when H1 reaches obstruction threshold', async () => {
    expect(sm.getState()).toBe(OrchestratorState.NORMAL);

    sm.updateMetrics(2); // H1 = threshold (>= 2)

    // Allow EventBus emit to settle (it's async internally)
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.OBSTRUCTED);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('orch:state-changed');
    expect(events[0].oldState).toBe(OrchestratorState.NORMAL);
    expect(events[0].newState).toBe(OrchestratorState.OBSTRUCTED);
    expect(events[0].h1Metric).toBe(2);
  });

  // T2: OBSTRUCTED → CRITICAL transition when H1 exceeds critical threshold
  it('T2: OBSTRUCTED → CRITICAL when H1 exceeds critical threshold', async () => {
    sm.updateMetrics(2); // → OBSTRUCTED
    await Promise.resolve();
    expect(sm.getState()).toBe(OrchestratorState.OBSTRUCTED);

    sm.updateMetrics(5); // → CRITICAL
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);
    expect(events).toHaveLength(2);
    expect(events[1].oldState).toBe(OrchestratorState.OBSTRUCTED);
    expect(events[1].newState).toBe(OrchestratorState.CRITICAL);
    expect(events[1].h1Metric).toBe(5);
    expect(events[1].reason).toMatch(/escalates to critical/i);
  });

  // T3: CRITICAL → NORMAL transition when H1 drops below obstruction threshold
  it('T3: CRITICAL → NORMAL when H1 drops below obstruction threshold', async () => {
    sm.updateMetrics(5); // NORMAL → CRITICAL (direct skip)
    await Promise.resolve();
    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);

    sm.updateMetrics(1); // H1 = 1 < obs threshold of 2 → NORMAL
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.NORMAL);
    expect(events).toHaveLength(2);
    expect(events[1].oldState).toBe(OrchestratorState.CRITICAL);
    expect(events[1].newState).toBe(OrchestratorState.NORMAL);
  });

  // T4: State change event emissions (payload structure)
  it('T4: state change event has all required payload fields', async () => {
    const timeBefore = Date.now();
    sm.updateMetrics(3); // → OBSTRUCTED
    await Promise.resolve();
    const timeAfter = Date.now();

    expect(events).toHaveLength(1);
    const event = events[0];

    expect(event.type).toBe('orch:state-changed');
    expect(event.oldState).toBe(OrchestratorState.NORMAL);
    expect(event.newState).toBe(OrchestratorState.OBSTRUCTED);
    expect(event.h1Metric).toBe(3);
    expect(typeof event.reason).toBe('string');
    expect(event.reason.length).toBeGreaterThan(0);
    expect(typeof event.timestamp).toBe('number');
    expect(event.timestamp).toBeGreaterThanOrEqual(timeBefore);
    expect(event.timestamp).toBeLessThanOrEqual(timeAfter);
  });

  // T5: getState() and getLastStateChangeTime() return correct values
  it('T5: getState() and getLastStateChangeTime() update correctly', async () => {
    expect(sm.getState()).toBe(OrchestratorState.NORMAL);

    sm.updateMetrics(2);
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.OBSTRUCTED);
    const time1 = sm.getLastStateChangeTime();

    // Small wait to ensure time difference is measurable
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    sm.updateMetrics(5);
    await Promise.resolve();

    const time2 = sm.getLastStateChangeTime();
    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);
    expect(time2).toBeGreaterThanOrEqual(time1);
  });

  // T6: No transition if already in target state (idempotent)
  it('T6: no event emitted when state does not change', async () => {
    sm.updateMetrics(2); // → OBSTRUCTED
    await Promise.resolve();
    expect(events).toHaveLength(1);

    // Still within obstructed range: H1 = 3 (>= obs but < crit)
    sm.updateMetrics(3);
    await Promise.resolve();
    sm.updateMetrics(2.5);
    await Promise.resolve();
    sm.updateMetrics(4);
    await Promise.resolve();

    // Still OBSTRUCTED — no additional events
    expect(sm.getState()).toBe(OrchestratorState.OBSTRUCTED);
    expect(events).toHaveLength(1); // only the initial NORMAL→OBSTRUCTED event
  });

  // T7: Thresholds are configurable
  it('T7: custom thresholds control transition points', async () => {
    const { bus: bus7, events: events7 } = createMockEventBus();
    const sm7 = createStateManager(bus7, 5, 10); // custom: obs=5, crit=10

    sm7.updateMetrics(3); // below custom threshold of 5 → stays NORMAL
    await Promise.resolve();
    expect(sm7.getState()).toBe(OrchestratorState.NORMAL);
    expect(events7).toHaveLength(0);

    sm7.updateMetrics(5); // at custom threshold → OBSTRUCTED
    await Promise.resolve();
    expect(sm7.getState()).toBe(OrchestratorState.OBSTRUCTED);
    expect(events7).toHaveLength(1);

    sm7.updateMetrics(10); // at custom critical → CRITICAL
    await Promise.resolve();
    expect(sm7.getState()).toBe(OrchestratorState.CRITICAL);
    expect(events7).toHaveLength(2);
  });

  // T8: H1 = 0 always results in NORMAL state
  it('T8: H1=0 brings any state back to NORMAL', async () => {
    // Go to CRITICAL first
    sm.updateMetrics(100);
    await Promise.resolve();
    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);

    sm.updateMetrics(0); // → NORMAL
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.NORMAL);
    expect(events).toHaveLength(2);
    expect(events[1].newState).toBe(OrchestratorState.NORMAL);
    expect(events[1].reason).toMatch(/returns below/i);
  });

  // Additional: NORMAL → CRITICAL direct transition (skipping OBSTRUCTED)
  it('NORMAL can jump directly to CRITICAL if H1 >= criticalThreshold', async () => {
    expect(sm.getState()).toBe(OrchestratorState.NORMAL);

    sm.updateMetrics(5); // directly to CRITICAL
    await Promise.resolve();

    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);
    expect(events[0].oldState).toBe(OrchestratorState.NORMAL);
    expect(events[0].newState).toBe(OrchestratorState.CRITICAL);
    // Reason should mention "critical threshold"
    expect(events[0].reason).toMatch(/critical threshold/i);
  });

  // Additional: CRITICAL does not transition to OBSTRUCTED directly (must pass through NORMAL)
  it('CRITICAL stays CRITICAL when H1 is between obs and crit thresholds', async () => {
    sm.updateMetrics(5); // → CRITICAL
    await Promise.resolve();

    sm.updateMetrics(3); // 2 <= 3 < 5: between obs and crit — stays CRITICAL
    await Promise.resolve();

    // Should stay in CRITICAL (not drop to OBSTRUCTED)
    expect(sm.getState()).toBe(OrchestratorState.CRITICAL);
    expect(events).toHaveLength(1); // only the initial transition
  });

  // Additional: initial state is always NORMAL
  it('initial state is NORMAL regardless of construction arguments', () => {
    const { bus: b2 } = createMockEventBus();
    const sm2 = new OrchestratorStateManager(b2, 1, 2);
    expect(sm2.getState()).toBe(OrchestratorState.NORMAL);
  });
});
