/**
 * ComposeRootModule.test.ts
 *
 * End-to-end integration tests for the Orchestrator composition root (ORCH-05).
 *
 * Tests cover:
 *   T1:  Orchestrator instantiation — all 11 properties non-null
 *   T2:  Event wiring — CohomologyAnalyzer events reach EventBus
 *   T3:  Event wiring — SOCTracker events reach EventBus
 *   T4:  State transitions on H^1 obstruction detection
 *   T5:  Single iteration runReasoning() executes without exception
 *   T6:  10-iteration loop completes without exceptions (KEY integration test)
 *   T7:  LCM appends text from runReasoning()
 *   T8:  TNA graph accumulates nodes over iterations
 *   T9:  SOC metrics computed each iteration
 *   T10: Sheaf cohomology computed each iteration
 *   T11: getIterationCount() returns correct count
 *   T12: getState() returns current orchestrator state
 *   T13: Obstruction triggers ObstructionHandler processing
 *   T14: Public API accessibility — all 11+ properties accessible
 *   T15: Edge cases (very long prompt, empty prompt, many iterations)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './ComposeRootModule.js';
import { CellularSheaf } from '../sheaf/CellularSheaf.js';
import { CohomologyAnalyzer } from '../sheaf/CohomologyAnalyzer.js';
import { EventBus } from './EventBus.js';
import { OrchestratorState, OrchestratorStateManager } from './OrchestratorState.js';
import { ObstructionHandler } from './ObstructionHandler.js';
import { SOCTracker } from '../soc/SOCTracker.js';
import type { IEmbedder } from '../lcm/interfaces.js';
import type { AnyEvent } from './interfaces.js';

// ---------------------------------------------------------------------------
// MockEmbedder — deterministic embedding for tests
// ---------------------------------------------------------------------------

/**
 * createMockEmbedder — creates a deterministic IEmbedder for testing.
 *
 * Returns a 384-dimensional Float64Array with values derived from text hash.
 * No model loading, no external dependencies — pure deterministic computation.
 */
function createMockEmbedder(): IEmbedder {
  return {
    embed: async (_text: string): Promise<Float64Array> => {
      return new Float64Array(384).fill(0.5);
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * waitForObstruction — wait for ObstructionHandler to finish processing.
 */
async function waitForObstruction(
  handler: ObstructionHandler,
  timeoutMs: number = 2000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = handler.getProcessingStatus();
    if (!status.isProcessing && status.queueLength === 0) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator (ComposeRootModule)', () => {

  describe('T1: Orchestrator instantiation', () => {
    it('instantiates with all 11+ properties non-null', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      // Core event bus
      expect(orchestrator.eventBus).toBeDefined();
      expect(orchestrator.eventBus).toBeInstanceOf(EventBus);

      // Sheaf module
      expect(orchestrator.sheaf).toBeDefined();
      expect(orchestrator.sheaf).toBeInstanceOf(CellularSheaf);
      expect(orchestrator.cohomologyAnalyzer).toBeDefined();
      expect(orchestrator.cohomologyAnalyzer).toBeInstanceOf(CohomologyAnalyzer);

      // LCM module
      expect(orchestrator.lcmClient).toBeDefined();

      // TNA module
      expect(orchestrator.tnaPreprocessor).toBeDefined();
      expect(orchestrator.tnaGraph).toBeDefined();
      expect(orchestrator.tnaLouvain).toBeDefined();
      expect(orchestrator.tnaCentrality).toBeDefined();
      expect(orchestrator.tnaGapDetector).toBeDefined();

      // SOC module
      expect(orchestrator.socTracker).toBeDefined();
      expect(orchestrator.socTracker).toBeInstanceOf(SOCTracker);

      // Orchestrator internals
      expect(orchestrator.stateManager).toBeDefined();
      expect(orchestrator.stateManager).toBeInstanceOf(OrchestratorStateManager);
      expect(orchestrator.obstructionHandler).toBeDefined();
      expect(orchestrator.obstructionHandler).toBeInstanceOf(ObstructionHandler);
    });

    it('starts with iteration count = 0 and state = NORMAL', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      expect(orchestrator.getIterationCount()).toBe(0);
      expect(orchestrator.getState()).toBe(OrchestratorState.NORMAL);
    });
  });

  describe('T2: CohomologyAnalyzer events reach EventBus', () => {
    it('forwards sheaf:consensus-reached from CohomologyAnalyzer to EventBus', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const receivedEvents: AnyEvent[] = [];
      orchestrator.eventBus.subscribe('sheaf:consensus-reached', (event) => {
        receivedEvents.push(event);
      });

      // Manually trigger CohomologyAnalyzer (which fires 'sheaf:consensus-reached'
      // for a flat sheaf with h1=0)
      orchestrator.cohomologyAnalyzer.analyze(orchestrator.sheaf, 1);

      // Allow event propagation
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents[0]!.type).toBe('sheaf:consensus-reached');
    });

    it('forwards sheaf:h1-obstruction-detected from CohomologyAnalyzer to EventBus', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const obstructionEvents: AnyEvent[] = [];
      orchestrator.eventBus.subscribe('sheaf:h1-obstruction-detected', (event) => {
        obstructionEvents.push(event);
      });

      // Build a sheaf with H^1 > 0 to trigger obstruction event
      // A triangle sheaf (3-vertex cycle) with flat restrictions has H^1 = 1
      const { buildFlatSheaf } = await import('../sheaf/helpers/flatSheafFactory.js');
      const triangleSheaf = buildFlatSheaf(3, 1, 'triangle');
      orchestrator.cohomologyAnalyzer.analyze(triangleSheaf, 1);

      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      expect(obstructionEvents.length).toBeGreaterThanOrEqual(1);
      expect(obstructionEvents[0]!.type).toBe('sheaf:h1-obstruction-detected');
    });
  });

  describe('T3: SOCTracker events reach EventBus', () => {
    it('forwards soc:metrics from SOCTracker to EventBus', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const metricsEvents: AnyEvent[] = [];
      orchestrator.eventBus.subscribe('soc:metrics', (event) => {
        metricsEvents.push(event);
      });

      // Manually trigger SOCTracker
      orchestrator.socTracker.emit('soc:metrics', {
        type: 'soc:metrics',
        iteration: 1,
        timestamp: Date.now(),
        vonNeumannEntropy: 0.5,
        embeddingEntropy: 0.3,
        cdp: 0.2,
        surprisingEdgeRatio: 0.1,
        correlationCoefficient: 0.0,
        isPhaseTransition: false,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(metricsEvents.length).toBeGreaterThanOrEqual(1);
      expect(metricsEvents[0]!.type).toBe('soc:metrics');
    });
  });

  describe('T4: State transitions on H^1 detection', () => {
    it('starts in NORMAL state', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      expect(orchestrator.getState()).toBe(OrchestratorState.NORMAL);
    });

    it('transitions to OBSTRUCTED when H^1 >= obstruction threshold (default: 2)', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      // Trigger stateManager with H^1 >= 2 (obstruction threshold)
      // This mimics what happens when cohomologyAnalyzer fires an obstruction event
      orchestrator.stateManager.updateMetrics(2);

      expect(orchestrator.getState()).toBe(OrchestratorState.OBSTRUCTED);
    });

    it('emits orch:state-changed event on state transition', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const stateChanges: unknown[] = [];
      orchestrator.eventBus.subscribe('orch:state-changed', (event) => {
        stateChanges.push(event);
      });

      // Trigger via stateManager (eventBus is wired through OrchestratorStateManager)
      orchestrator.stateManager.updateMetrics(3); // OBSTRUCTED

      // Allow async event propagation
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      expect(stateChanges.length).toBeGreaterThanOrEqual(1);
    });

    it('transitions to CRITICAL when H^1 >= critical threshold (default: 5)', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      orchestrator.stateManager.updateMetrics(5);

      expect(orchestrator.getState()).toBe(OrchestratorState.CRITICAL);
    });

    it('transitions back to NORMAL from OBSTRUCTED when H^1 drops below threshold', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      orchestrator.stateManager.updateMetrics(2); // OBSTRUCTED
      expect(orchestrator.getState()).toBe(OrchestratorState.OBSTRUCTED);

      orchestrator.stateManager.updateMetrics(0); // NORMAL
      expect(orchestrator.getState()).toBe(OrchestratorState.NORMAL);
    });
  });

  describe('T5: Single iteration runReasoning()', () => {
    it('executes without exception', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await expect(orchestrator.runReasoning('test prompt')).resolves.not.toThrow();
    });

    it('increments iteration count after one run', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      expect(orchestrator.getIterationCount()).toBe(0);
      await orchestrator.runReasoning('test prompt');
      expect(orchestrator.getIterationCount()).toBe(1);
    });
  });

  describe('T6: 10-iteration loop', () => {
    it('completes 10 iterations without exceptions', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      for (let i = 1; i <= 10; i++) {
        await expect(
          orchestrator.runReasoning(`Iteration ${i}: reasoning about concept ${i}`)
        ).resolves.not.toThrow();
      }

      expect(orchestrator.getIterationCount()).toBe(10);
    }, 30000);

    it('maintains valid state after 10 iterations', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      for (let i = 1; i <= 10; i++) {
        await orchestrator.runReasoning(`Iteration ${i}`);
      }

      // State should be one of the valid enum values
      const validStates = [OrchestratorState.NORMAL, OrchestratorState.OBSTRUCTED, OrchestratorState.CRITICAL];
      expect(validStates).toContain(orchestrator.getState());
    }, 30000);

    it('iterationCount equals 10 after 10-iteration loop', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      for (let i = 1; i <= 10; i++) {
        await orchestrator.runReasoning(`Iteration ${i}`);
      }

      expect(orchestrator.getIterationCount()).toBe(10);
    }, 30000);
  });

  describe('T7: LCM integration', () => {
    it('appends text to LCM store each iteration', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('test text for LCM');

      // LCM store should have one entry
      const entries = orchestrator.lcmClient.store.getAll();
      expect(entries.length).toBe(1);
      expect(entries[0]!.content).toBe('test text for LCM');
    });

    it('accumulates LCM entries across iterations', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('first entry');
      await orchestrator.runReasoning('second entry');
      await orchestrator.runReasoning('third entry');

      const entries = orchestrator.lcmClient.store.getAll();
      expect(entries.length).toBe(3);
    });
  });

  describe('T8: TNA graph accumulation', () => {
    it('accumulates nodes in TNA graph over iterations', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('hello world');
      const nodesAfterFirst = orchestrator.tnaGraph.order;
      expect(nodesAfterFirst).toBeGreaterThan(0);

      await orchestrator.runReasoning('quantum mechanics entropy systems');
      const nodesAfterSecond = orchestrator.tnaGraph.order;
      expect(nodesAfterSecond).toBeGreaterThanOrEqual(nodesAfterFirst);
    });

    it('graph has nodes after processing text with meaningful tokens', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('artificial intelligence neural networks deep learning');
      expect(orchestrator.tnaGraph.order).toBeGreaterThan(0);
    });
  });

  describe('T9: SOC metrics per iteration', () => {
    it('emits soc:metrics event each iteration', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      let metricsCount = 0;
      orchestrator.eventBus.subscribe('soc:metrics', () => {
        metricsCount++;
      });

      await orchestrator.runReasoning('test');
      await orchestrator.runReasoning('test');
      await orchestrator.runReasoning('test');

      expect(metricsCount).toBe(3);
    });

    it('soc:metrics event has all required fields', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      let capturedEvent: AnyEvent | null = null;
      orchestrator.eventBus.subscribe('soc:metrics', (event) => {
        capturedEvent = event;
      });

      await orchestrator.runReasoning('test');

      expect(capturedEvent).not.toBeNull();
      const ev = capturedEvent as unknown as Record<string, unknown>;
      expect(ev).toHaveProperty('type', 'soc:metrics');
      expect(ev).toHaveProperty('iteration');
      expect(ev).toHaveProperty('vonNeumannEntropy');
      expect(ev).toHaveProperty('embeddingEntropy');
      expect(ev).toHaveProperty('cdp');
      expect(ev).toHaveProperty('surprisingEdgeRatio');
      expect(ev).toHaveProperty('correlationCoefficient');
      expect(ev).toHaveProperty('isPhaseTransition');
    });
  });

  describe('T10: Sheaf cohomology per iteration', () => {
    it('emits at least one sheaf event per iteration', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      let cohomologyCount = 0;
      orchestrator.eventBus.subscribe('sheaf:consensus-reached', () => { cohomologyCount++; });
      orchestrator.eventBus.subscribe('sheaf:h1-obstruction-detected', () => { cohomologyCount++; });

      await orchestrator.runReasoning('test');
      await orchestrator.runReasoning('test');

      // Allow async event propagation
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      expect(cohomologyCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('T11: getIterationCount()', () => {
    it('returns correct count after multiple iterations', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      for (let i = 0; i < 5; i++) {
        await orchestrator.runReasoning('test');
      }

      expect(orchestrator.getIterationCount()).toBe(5);
    });

    it('starts at 0 before any iterations', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);
      expect(orchestrator.getIterationCount()).toBe(0);
    });
  });

  describe('T12: getState()', () => {
    it('returns NORMAL initially', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);
      expect(orchestrator.getState()).toBe(OrchestratorState.NORMAL);
    });

    it('returns OBSTRUCTED after updateMetrics with H^1 >= threshold', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      orchestrator.stateManager.updateMetrics(2); // OBSTRUCTED
      expect(orchestrator.getState()).toBe(OrchestratorState.OBSTRUCTED);
    });

    it('reflects state transitions after runReasoning()', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('test');
      // State should be valid after running
      const validStates = Object.values(OrchestratorState);
      expect(validStates).toContain(orchestrator.getState());
    });
  });

  describe('T13: Obstruction triggers ObstructionHandler', () => {
    it('ObstructionHandler receives obstruction events via EventBus', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      // Subscribe to obstruction-filled events (emitted by handler after processing)
      const filledEvents: unknown[] = [];
      orchestrator.eventBus.subscribe('orch:obstruction-filled', (event) => {
        filledEvents.push(event);
      });

      // Manually emit an H^1 obstruction event (simulating what CohomologyAnalyzer fires)
      await orchestrator.eventBus.emit({
        type: 'sheaf:h1-obstruction-detected',
        iteration: 1,
        h1Dimension: 2,
        h1Basis: [],
        affectedVertices: [],
      } as unknown as AnyEvent);

      // Wait for handler to process
      await waitForObstruction(orchestrator.obstructionHandler);

      // ObstructionHandler should have processed and emitted filled event
      expect(filledEvents.length).toBe(1);
    });

    it('ObstructionHandler status is accessible', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const status = orchestrator.obstructionHandler.getProcessingStatus();
      expect(status).toHaveProperty('isProcessing');
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('agentCount');
    });
  });

  describe('T14: Public API accessibility', () => {
    it('all 11+ properties are accessible', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      // All should be non-null and accessible
      expect(orchestrator.eventBus).toBeDefined();
      expect(orchestrator.sheaf).toBeDefined();
      expect(orchestrator.cohomologyAnalyzer).toBeDefined();
      expect(orchestrator.lcmClient).toBeDefined();
      expect(orchestrator.tnaPreprocessor).toBeDefined();
      expect(orchestrator.tnaGraph).toBeDefined();
      expect(orchestrator.tnaLouvain).toBeDefined();
      expect(orchestrator.tnaCentrality).toBeDefined();
      expect(orchestrator.tnaGapDetector).toBeDefined();
      expect(orchestrator.socTracker).toBeDefined();
      expect(orchestrator.stateManager).toBeDefined();
      expect(orchestrator.obstructionHandler).toBeDefined();
    });

    it('getIterationCount() and getState() are callable', () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      expect(typeof orchestrator.getIterationCount()).toBe('number');
      expect(typeof orchestrator.getState()).toBe('string');
    });

    it('shutdown() method resolves without error', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });
  });

  describe('T15: Edge cases', () => {
    it('handles empty prompt without throwing', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await expect(orchestrator.runReasoning('')).resolves.not.toThrow();
      expect(orchestrator.getIterationCount()).toBe(1);
    });

    it('handles very long prompt without throwing', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const longPrompt = 'artificial intelligence machine learning '.repeat(100);
      await expect(orchestrator.runReasoning(longPrompt)).resolves.not.toThrow();
    });

    it('handles 20+ iterations for memory stability', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      for (let i = 1; i <= 20; i++) {
        await orchestrator.runReasoning(`Iteration ${i}: stability test prompt ${i}`);
      }

      expect(orchestrator.getIterationCount()).toBe(20);
    }, 60000);

    it('handles repeated identical prompts', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      const prompt = 'same prompt repeated';
      for (let i = 0; i < 5; i++) {
        await expect(orchestrator.runReasoning(prompt)).resolves.not.toThrow();
      }

      expect(orchestrator.getIterationCount()).toBe(5);
    });

    it('shutdown() is safe to call after iterations', async () => {
      const embedder = createMockEmbedder();
      const orchestrator = new Orchestrator(embedder);

      await orchestrator.runReasoning('before shutdown');
      await expect(orchestrator.shutdown()).resolves.not.toThrow();
    });
  });
});
