/**
 * EventBus.ts
 *
 * Event-driven coordination bus (ORCH-04).
 *
 * Provides: EventBus class with subscribe/emit/unsubscribe/getSubscriberCount methods.
 *
 * Extends EventEmitter from 'node:events' for future integration with Node.js
 * event infrastructure, but implements its own internal subscriber map.
 * Do NOT use EventEmitter .on()/.off() — we manage subscribers explicitly.
 *
 * Imports: AnyEvent, EventSubscriber from ./interfaces.js only.
 * No external npm dependencies.
 */

import { EventEmitter } from 'node:events';
import type { AnyEvent, EventSubscriber } from './interfaces.js';

// Re-export types for barrel-friendly imports
export type { AnyEvent, EventSubscriber } from './interfaces.js';

/**
 * EventBus — async event routing bus for orchestrator cross-component messaging.
 *
 * Architecture:
 *   - Subscribers register per event type string (e.g., 'soc:metrics', 'sheaf:consensus-reached').
 *   - Emitting an event calls all registered handlers for that event type in parallel.
 *   - Promise.all() is used: all handlers run concurrently; if any handler throws,
 *     the emit() Promise rejects immediately (fail-fast semantics).
 *   - Handler removal via unsubscribe() is by reference equality.
 *
 * Thread safety: EventBus is single-threaded (Node.js event loop). Concurrent
 * emit() calls are safe — each call operates on an independent snapshot of handlers
 * captured at the time of the call.
 *
 * @example
 *   const bus = new EventBus();
 *   const handler = async (event: AnyEvent) => { process(event); };
 *   bus.subscribe('soc:metrics', handler);
 *   await bus.emit(metricsEvent);
 *   bus.unsubscribe('soc:metrics', handler);
 */
export class EventBus extends EventEmitter {
  /** Internal subscriber registry: eventType → ordered array of handlers. */
  #subscribers: Map<string, EventSubscriber[]> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a handler for a specific event type.
   *
   * Multiple handlers may be registered for the same event type.
   * They will all be called in parallel when that event type is emitted.
   * Registering the same handler twice will result in it being called twice.
   *
   * @param eventType - The event type discriminant string (e.g., 'soc:metrics').
   * @param handler   - Function to call when an event of this type is emitted.
   *
   * @example
   *   bus.subscribe('sheaf:consensus-reached', (event) => {
   *     console.log('Consensus at iteration', (event as SheafConsensusReachedEvent).iteration);
   *   });
   */
  subscribe(eventType: string, handler: EventSubscriber): void {
    if (!this.#subscribers.has(eventType)) {
      this.#subscribers.set(eventType, []);
    }
    this.#subscribers.get(eventType)!.push(handler);
  }

  /**
   * Emit event to all subscribed handlers for this event type.
   *
   * All handlers for event.type are called in parallel via Promise.all().
   * Both sync handlers (returning void) and async handlers (returning Promise<void>)
   * are supported — each is wrapped in Promise.resolve() for uniform awaiting.
   *
   * If no handlers are registered for the event type, resolves immediately (no-op).
   * If any handler throws or rejects, this Promise rejects with that error.
   *
   * @param event - The event to dispatch. Routes by event.type discriminant.
   * @returns Promise that resolves when all handlers have completed.
   *
   * @example
   *   await bus.emit({
   *     type: 'soc:metrics',
   *     iteration: 42,
   *     timestamp: Date.now(),
   *     vonNeumannEntropy: 1.5,
   *     embeddingEntropy: 1.2,
   *     cdp: 0.3,
   *     surprisingEdgeRatio: 0.08,
   *     correlationCoefficient: 0.6,
   *     isPhaseTransition: false,
   *   });
   */
  async emit(event: AnyEvent): Promise<void> {
    const handlers = this.#subscribers.get(event.type) ?? [];
    await Promise.all(handlers.map((handler) => Promise.resolve(handler(event))));
  }

  /**
   * Unregister a handler; it will no longer receive events of this type.
   *
   * Uses reference equality to find and remove the handler. If the handler
   * was registered multiple times, only the first occurrence is removed.
   * If the handler is not found, this is a no-op.
   *
   * @param eventType - The event type the handler was registered for.
   * @param handler   - The exact function reference passed to subscribe().
   *
   * @example
   *   const handler = (event: AnyEvent) => { ... };
   *   bus.subscribe('soc:metrics', handler);
   *   bus.unsubscribe('soc:metrics', handler); // handler no longer called
   */
  unsubscribe(eventType: string, handler: EventSubscriber): void {
    const handlers = this.#subscribers.get(eventType);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Return the number of registered handlers for the given event type.
   *
   * Used in tests to verify subscriber management and cleanup.
   *
   * @param eventType - The event type to count subscribers for.
   * @returns Number of registered handlers (0 if none).
   */
  getSubscriberCount(eventType: string): number {
    return this.#subscribers.get(eventType)?.length ?? 0;
  }
}
