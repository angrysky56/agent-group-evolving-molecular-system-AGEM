/**
 * EventBus.test.ts
 *
 * Tests for EventBus (ORCH-04): subscriber routing, async emit, unsubscribe.
 *
 * Test cases T1-T10 cover:
 *   T1:  Single subscriber receives emitted event
 *   T2:  Multiple subscribers for same event receive in parallel
 *   T3:  Different event types route to different subscribers
 *   T4:  Unsubscribe prevents further events
 *   T5:  Async handlers in emit() all await (parallel, not sequential)
 *   T6:  emit() with no subscribers succeeds silently
 *   T7:  Handler that throws propagates via Promise.all() rejection
 *   T8:  Same handler subscribed twice is called twice
 *   T9:  EventType is case-sensitive
 *   T10: getSubscriberCount() accuracy before/during/after subscribe/unsubscribe
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "./EventBus.js";
import type { AnyEvent } from "./interfaces.js";
import type {
  SOCMetricsEvent,
  SheafConsensusReachedEvent,
} from "../types/Events.js";

// ---------------------------------------------------------------------------
// Test data factories — realistic event objects
// ---------------------------------------------------------------------------

function makeSOCMetricsEvent(iteration = 1): SOCMetricsEvent {
  return {
    type: "soc:metrics",
    iteration,
    timestamp: Date.now(),
    vonNeumannEntropy: 1.386,
    embeddingEntropy: 1.098,
    cdp: 0.288,
    surprisingEdgeRatio: 0.08,
    correlationCoefficient: 0.72,
    isPhaseTransition: false,
  };
}

function makeSheafConsensusEvent(iteration = 1): SheafConsensusReachedEvent {
  return {
    type: "sheaf:consensus-reached",
    iteration,
    h0Dimension: 3,
    dirichletEnergy: 0.001,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // T1: Single subscriber receives emitted event
  it("T1: single subscriber receives emitted event", async () => {
    const handler = vi.fn();
    bus.subscribe("soc:metrics", handler);

    const event = makeSOCMetricsEvent(1);
    await bus.emit(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  // T2: Multiple subscribers for same event receive in parallel
  it("T2: multiple subscribers for same event all receive it", async () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const handlerC = vi.fn();

    bus.subscribe("soc:metrics", handlerA);
    bus.subscribe("soc:metrics", handlerB);
    bus.subscribe("soc:metrics", handlerC);

    const event = makeSOCMetricsEvent(2);
    await bus.emit(event);

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith(event);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledWith(event);
    expect(handlerC).toHaveBeenCalledTimes(1);
    expect(handlerC).toHaveBeenCalledWith(event);
  });

  // T3: Different event types route to different subscribers
  it("T3: different event types route to different subscribers only", async () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bus.subscribe("sheaf:consensus-reached", handlerA);
    bus.subscribe("soc:metrics", handlerB);

    const sheafEvent = makeSheafConsensusEvent(3);
    await bus.emit(sheafEvent);

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith(sheafEvent);
    expect(handlerB).not.toHaveBeenCalled(); // SOC handler should NOT fire on sheaf event
  });

  // T4: Unsubscribe prevents further events
  it("T4: unsubscribe prevents handler from receiving subsequent events", async () => {
    const handler = vi.fn();
    bus.subscribe("soc:metrics", handler);

    // First emit — should be received
    await bus.emit(makeSOCMetricsEvent(1));
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    bus.unsubscribe("soc:metrics", handler);

    // Second emit — should NOT be received
    await bus.emit(makeSOCMetricsEvent(2));
    expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
  });

  // T5: Async handlers in emit() all await (parallel, not sequential)
  it("T5: async handlers run in parallel, not sequentially", async () => {
    const callOrder: number[] = [];

    const handler1 = async (): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      callOrder.push(1);
    };

    const handler2 = async (): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      callOrder.push(2);
    };

    bus.subscribe("soc:metrics", handler1);
    bus.subscribe("soc:metrics", handler2);

    const start = Date.now();
    await bus.emit(makeSOCMetricsEvent(5));
    const elapsed = Date.now() - start;

    // Both handlers completed
    expect(callOrder).toContain(1);
    expect(callOrder).toContain(2);

    // Parallel: total time should be ~20ms (max), not sequential 25ms (20+5)
    // Allow generous margin for CI — must be less than 40ms (sequential would be ~25ms
    // but we're testing that it runs parallel, i.e., much less than 20+5=25 sequential)
    expect(elapsed).toBeLessThan(100); // Much less than sequential; parallel completes at ~20ms

    // Handler 2 (5ms) finishes first in parallel execution
    expect(callOrder[0]).toBe(2);
    expect(callOrder[1]).toBe(1);
  });

  // T6: emit() with no subscribers succeeds silently
  it("T6: emit with no subscribers resolves without error", async () => {
    const event = makeSOCMetricsEvent(6);
    await expect(bus.emit(event)).resolves.toBeUndefined();
  });

  // T7: Handler that throws propagates via Promise.all() rejection
  it("T7: handler that throws causes emit() to reject", async () => {
    const throwingHandler = vi.fn(async () => {
      throw new Error("test error from handler");
    });

    bus.subscribe("soc:metrics", throwingHandler);

    await expect(bus.emit(makeSOCMetricsEvent(7))).rejects.toThrow(
      "test error from handler",
    );
    expect(throwingHandler).toHaveBeenCalledTimes(1);
  });

  // T8: Same handler subscribed twice is called twice
  it("T8: same handler subscribed twice is called twice per emit", async () => {
    const handler = vi.fn();
    bus.subscribe("soc:metrics", handler);
    bus.subscribe("soc:metrics", handler); // register again

    await bus.emit(makeSOCMetricsEvent(8));

    expect(handler).toHaveBeenCalledTimes(2);

    // Unsubscribe once — only removes first occurrence
    bus.unsubscribe("soc:metrics", handler);
    await bus.emit(makeSOCMetricsEvent(8));

    expect(handler).toHaveBeenCalledTimes(3); // 2 + 1 remaining subscription
  });

  // T9: EventType is case-sensitive
  it("T9: event type matching is case-sensitive", async () => {
    const handler = vi.fn();
    bus.subscribe("SOC:METRICS", handler); // uppercase — different from 'soc:metrics'

    await bus.emit(makeSOCMetricsEvent(9)); // emits lowercase 'soc:metrics'

    expect(handler).not.toHaveBeenCalled(); // uppercase handler should not fire
  });

  // T10: getSubscriberCount() accuracy
  it("T10: getSubscriberCount returns accurate counts through subscribe/unsubscribe", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    expect(bus.getSubscriberCount("soc:metrics")).toBe(0);

    bus.subscribe("soc:metrics", handlerA);
    expect(bus.getSubscriberCount("soc:metrics")).toBe(1);

    bus.subscribe("soc:metrics", handlerB);
    expect(bus.getSubscriberCount("soc:metrics")).toBe(2);

    bus.unsubscribe("soc:metrics", handlerA);
    expect(bus.getSubscriberCount("soc:metrics")).toBe(1);

    bus.unsubscribe("soc:metrics", handlerB);
    expect(bus.getSubscriberCount("soc:metrics")).toBe(0);

    // Unsubscribing non-existent handler is no-op
    bus.unsubscribe("soc:metrics", handlerA);
    expect(bus.getSubscriberCount("soc:metrics")).toBe(0);

    // Unsubscribing from unknown event type is no-op
    bus.unsubscribe("unknown:event", handlerA);
    expect(bus.getSubscriberCount("unknown:event")).toBe(0);
  });

  // Additional: EventBus holds an internal EventEmitter for Node.js integration
  it("EventBus has an accessible EventEmitter via .emitter property", () => {
    const { EventEmitter } = require("node:events");
    expect(bus.emitter).toBeInstanceOf(EventEmitter);
  });

  // Additional: Multiple different event types tracked independently
  it("multiple event types tracked independently", async () => {
    const socHandler = vi.fn();
    const sheafHandler = vi.fn();

    bus.subscribe("soc:metrics", socHandler);
    bus.subscribe("sheaf:consensus-reached", sheafHandler);

    expect(bus.getSubscriberCount("soc:metrics")).toBe(1);
    expect(bus.getSubscriberCount("sheaf:consensus-reached")).toBe(1);

    await bus.emit(makeSOCMetricsEvent(100));

    expect(socHandler).toHaveBeenCalledTimes(1);
    expect(sheafHandler).not.toHaveBeenCalled();

    await bus.emit(makeSheafConsensusEvent(100));

    expect(socHandler).toHaveBeenCalledTimes(1);
    expect(sheafHandler).toHaveBeenCalledTimes(1);
  });
});
