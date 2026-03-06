/**
 * VdWAgentSpawner.test.ts
 *
 * Comprehensive unit tests for VdWAgent and VdWAgentSpawner (ORCH-06).
 *
 * Tests:
 *   VdWAgent lifecycle: T1-T9
 *   VdWAgentSpawner — H^1 hysteresis: T10-T14
 *   VdWAgentSpawner — Regime gating: T15-T19
 *   VdWAgentSpawner — Spawn count computation: T20-T24
 *   VdWAgentSpawner — Token budget: T25-T28
 *   VdWAgentSpawner — Spawn cooldown: T29-T31
 *   VdWAgentSpawner — Event emission: T32-T35
 *   VdWAgentSpawner — Agent execution: T36-T38
 *   VdWAgentSpawner — Cleanup: T39-T40
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VdWAgent, VdWAgentSpawner } from './VdWAgentSpawner.js';
import type { VdWSpawnParams, VdWSpawnerConfig } from './VdWAgentSpawner.js';
import { EventBus } from './EventBus.js';
import type { AnyEvent } from './interfaces.js';
import type { GapMetrics } from '../tna/interfaces.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * makeGap — create a GapMetrics fixture for two communities.
 */
function makeGap(communityA: number, communityB: number): GapMetrics {
  return {
    communityA,
    communityB,
    interCommunityDensity: 0.05,
    shortestPathLength: 3,
    modularityDelta: 0.2,
    bridgeNodes: [],
  };
}

/**
 * makeParams — create VdWSpawnParams for a gap between two communities.
 */
function makeParams(communityA: number = 0, communityB: number = 1): VdWSpawnParams {
  return {
    h1Dimension: 3,
    gapId: `gap-${communityA}-${communityB}`,
    tokenBudget: 1000,
    maxIterations: 3,
    communityA,
    communityB,
  };
}

/**
 * createSpawner — factory that sets up an EventBus, captures all events, and
 * returns a spawner with optional configuration overrides.
 */
function createSpawner(config?: Partial<VdWSpawnerConfig>): {
  spawner: VdWAgentSpawner;
  eventBus: EventBus;
  events: AnyEvent[];
} {
  const eventBus = new EventBus();
  const events: AnyEvent[] = [];
  eventBus.subscribe('orch:vdw-agent-spawned', (e) => { events.push(e); });
  eventBus.subscribe('orch:vdw-agent-complete', (e) => { events.push(e); });
  const spawner = new VdWAgentSpawner(eventBus, config);
  return { spawner, eventBus, events };
}

/**
 * sustainH1 — call updateH1Dimension() N times to build up hysteresis count.
 */
function sustainH1(spawner: VdWAgentSpawner, h1: number, times: number): void {
  for (let i = 0; i < times; i++) {
    spawner.updateH1Dimension(h1);
  }
}

// ---------------------------------------------------------------------------
// VdWAgent tests
// ---------------------------------------------------------------------------

describe('VdWAgent', () => {

  it('T1: Agent starts in "spawning" status', () => {
    const agent = new VdWAgent('test-1', makeParams());
    expect(agent.status).toBe('spawning');
  });

  it('T2: activate() transitions to "active"', () => {
    const agent = new VdWAgent('test-2', makeParams());
    agent.activate();
    expect(agent.status).toBe('active');
  });

  it('T3: executeStep() increments stepsExecuted', async () => {
    const agent = new VdWAgent('test-3', makeParams(0, 1));
    agent.activate();
    await agent.executeStep();
    expect(agent.stepsExecuted).toBe(1);
    await agent.executeStep();
    expect(agent.stepsExecuted).toBe(2);
  });

  it('T4: executeStep() generates synthetic query', async () => {
    const agent = new VdWAgent('test-4', makeParams(0, 1));
    agent.activate();
    await agent.executeStep();
    const results = agent.getResults();
    expect(results.synthQueries).toHaveLength(1);
    expect(results.synthQueries[0]).toContain('VdW probe');
    expect(results.synthQueries[0]).toContain('community 0');
    expect(results.synthQueries[0]).toContain('community 1');
  });

  it('T5: Agent self-terminates after maxIterations steps', async () => {
    const params: VdWSpawnParams = { ...makeParams(), maxIterations: 3 };
    const agent = new VdWAgent('test-5', params);
    agent.activate();

    let keepGoing = true;
    let steps = 0;
    while (keepGoing) {
      keepGoing = await agent.executeStep();
      steps++;
    }

    expect(steps).toBe(3); // exactly maxIterations steps
    expect(agent.status).toBe('terminated');
    expect(agent.stepsExecuted).toBe(3);
  });

  it('T6: terminate() forces agent to "terminated" status', () => {
    const agent = new VdWAgent('test-6', makeParams());
    agent.activate();
    agent.terminate();
    expect(agent.status).toBe('terminated');
  });

  it('T7: getResults() returns accumulated queries, entities, and relations', async () => {
    const agent = new VdWAgent('test-7', makeParams(2, 5));
    agent.activate();
    await agent.executeStep(); // step 1: creates bridge entity
    await agent.executeStep(); // step 2: another query

    const results = agent.getResults();
    expect(results.synthQueries).toHaveLength(2);
    expect(results.entitiesAdded).toHaveLength(1); // only 1 entity (created on step 1)
    expect(results.relationsAdded).toHaveLength(1);
    expect(results.stepsExecuted).toBe(2);
    expect(results.success).toBe(true);
  });

  it('T8: executeStep() returns false when already terminated', async () => {
    const agent = new VdWAgent('test-8', makeParams());
    agent.activate();
    agent.terminate();
    const result = await agent.executeStep();
    expect(result).toBe(false);
  });

  it('T9: First executeStep() creates bridge entity', async () => {
    const agent = new VdWAgent('test-9', makeParams(3, 7));
    agent.activate();
    await agent.executeStep();

    const results = agent.getResults();
    expect(results.entitiesAdded).toHaveLength(1);
    expect(results.entitiesAdded[0]).toContain('vdw-bridge');
    expect(results.entitiesAdded[0]).toContain('gap-3-7');
    expect(results.relationsAdded).toHaveLength(1);
    expect(results.relationsAdded[0]!.type).toBe('vdw-bridge');
    expect(results.relationsAdded[0]!.to).toBe('community-3');
  });

});

// ---------------------------------------------------------------------------
// VdWAgentSpawner tests
// ---------------------------------------------------------------------------

describe('VdWAgentSpawner', () => {

  // -------------------------------------------------------------------------
  // H^1 Hysteresis
  // -------------------------------------------------------------------------

  describe('H^1 hysteresis', () => {

    it('T10: H^1 above threshold for 1 iteration → no spawn (hysteresis not met)', async () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2 });
      spawner.updateRegime('critical');
      spawner.updateH1Dimension(5); // only 1 iteration above threshold

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(agents).toHaveLength(0);
    });

    it('T11: H^1 above threshold for 2 consecutive iterations → spawn allowed', async () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2); // 2 iterations above threshold

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('T12: H^1 dips below threshold → hysteresis counter reset to 0', async () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2 });
      spawner.updateRegime('critical');

      // Build up 1 count
      spawner.updateH1Dimension(5);

      // Check hysteresis status shows count = 1
      expect(spawner.getH1HysteresisStatus().count).toBe(1);

      // Dip below threshold
      spawner.updateH1Dimension(1); // below threshold of 2

      // Count should be reset
      expect(spawner.getH1HysteresisStatus().count).toBe(0);

      // One more above threshold — still not enough (hysteresis count = 1, need 2)
      spawner.updateH1Dimension(5);
      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(agents).toHaveLength(0);
    });

    it('T13: H^1 exactly at threshold → counts toward hysteresis', async () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2, h1Threshold: 3 });
      spawner.updateRegime('critical');

      // h1=3 is exactly at threshold → should count
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('T14: Custom h1HysteresisCount = 5 → requires 5 iterations', async () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 5 });
      spawner.updateRegime('critical');

      // Only 4 iterations — should not spawn
      sustainH1(spawner, 5, 4);
      const agents4 = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(agents4).toHaveLength(0);

      // 5th iteration — should spawn
      spawner.updateH1Dimension(5);
      const agents5 = await spawner.evaluateAndSpawn([makeGap(0, 2)], 5, 2);
      expect(agents5.length).toBeGreaterThan(0);
    });

  });

  // -------------------------------------------------------------------------
  // Regime gating
  // -------------------------------------------------------------------------

  describe('Regime gating', () => {

    it('T15: regime="stable" → no agents spawned (suppressed)', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('stable');
      sustainH1(spawner, 5, 3);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1), makeGap(1, 2)], 5, 1);
      expect(agents).toHaveLength(0);
    });

    it('T16: regime="transitioning" → full spawn logic applied', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      expect(agents.length).toBe(1); // 1 agent per gap in transitioning
    });

    it('T17: regime="critical" → full spawn logic applied', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('critical');
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('T18: regime="nascent" → single agent with 500 token budget', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('nascent');
      sustainH1(spawner, 5, 2);

      const agents = await spawner.evaluateAndSpawn(
        [makeGap(0, 1), makeGap(1, 2), makeGap(2, 3)],
        5,
        1
      );

      // nascent: max 1 agent total
      expect(agents).toHaveLength(1);
      // nascent: budget forced to 500
      expect(agents[0]!.params.tokenBudget).toBe(500);
    });

    it('T19: Regime change from "stable" to "critical" → spawning resumes', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('stable');
      sustainH1(spawner, 5, 3);

      const stableAgents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(stableAgents).toHaveLength(0); // suppressed

      // Switch to critical
      spawner.updateRegime('critical');
      const criticalAgents = await spawner.evaluateAndSpawn([makeGap(0, 2)], 5, 2);
      expect(criticalAgents.length).toBeGreaterThan(0); // now enabled
    });

  });

  // -------------------------------------------------------------------------
  // Spawn count computation
  // -------------------------------------------------------------------------

  describe('Spawn count computation', () => {

    it('T20: 1 agent per gap in "transitioning" regime', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn(
        [makeGap(0, 1), makeGap(1, 2)],
        3,
        1
      );

      // transitioning + H^1=3 (< 5): 1 agent per gap
      expect(agents).toHaveLength(2);
    });

    it('T21: 2 agents per gap in "critical" regime with H^1 >= 5', async () => {
      const { spawner } = createSpawner({ maxConcurrentAgents: 20 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      const agents = await spawner.evaluateAndSpawn(
        [makeGap(0, 1), makeGap(1, 2)],
        5,
        1
      );

      // critical + H^1=5: 2 agents per gap × 2 gaps = 4
      expect(agents).toHaveLength(4);
    });

    it('T22: Total agents capped at maxConcurrentAgents (10)', async () => {
      const { spawner } = createSpawner({ maxConcurrentAgents: 5 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      // 5 gaps × 2 agents/gap = 10, but cap is 5
      const gaps = [
        makeGap(0, 1), makeGap(1, 2), makeGap(2, 3), makeGap(3, 4), makeGap(4, 5)
      ];
      const agents = await spawner.evaluateAndSpawn(gaps, 5, 1);

      expect(agents.length).toBeLessThanOrEqual(5);
    });

    it('T23: Already-running agents count toward cap', async () => {
      const { spawner } = createSpawner({ maxConcurrentAgents: 3 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      // Spawn 2 agents in iteration 1 (they stay active because we don't call runAgents)
      const batch1 = await spawner.evaluateAndSpawn(
        [makeGap(0, 1), makeGap(1, 2)],
        3,
        1
      );
      expect(batch1).toHaveLength(2);
      expect(spawner.getActiveAgentCount()).toBe(2);

      // Spawn again in iteration 2 with different gaps — cap is 3, 2 already running → only 1 more
      sustainH1(spawner, 3, 1); // ensure hysteresis still sustained
      const batch2 = await spawner.evaluateAndSpawn(
        [makeGap(2, 3), makeGap(3, 4)],
        3,
        5 // iteration 5: beyond cooldown for gap-0-1 and gap-1-2 but those gaps aren't being re-spawned
      );
      // Only 1 new agent can spawn (cap 3 - 2 active = 1)
      expect(batch2.length).toBeLessThanOrEqual(1);
    });

    it('T24: Zero gaps → zero agents spawned', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      const agents = await spawner.evaluateAndSpawn([], 5, 1);
      expect(agents).toHaveLength(0);
    });

  });

  // -------------------------------------------------------------------------
  // Token budget
  // -------------------------------------------------------------------------

  describe('Token budget', () => {

    it('T25: Budget = max(500, 5000/h1Dimension) — H^1=2 → budget=2500', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 2, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 2, 1);
      expect(agents).toHaveLength(1);
      // max(500, floor(5000/2)) = max(500, 2500) = 2500
      expect(agents[0]!.params.tokenBudget).toBe(2500);
    });

    it('T26: Budget = max(500, 5000/h1Dimension) — H^1=10 → budget=500', async () => {
      const { spawner } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 10, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 10, 1);
      expect(agents).toHaveLength(1);
      // max(500, floor(5000/10)) = max(500, 500) = 500
      expect(agents[0]!.params.tokenBudget).toBe(500);
    });

    it('T27: Budget = max(500, 5000/h1Dimension) — H^1=1 → budget=5000', async () => {
      // h1=1 is below default threshold of 2, so use custom threshold of 1
      const { spawner } = createSpawner({ h1Threshold: 1 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 1, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 1, 1);
      expect(agents).toHaveLength(1);
      // max(500, floor(5000/1)) = max(500, 5000) = 5000
      expect(agents[0]!.params.tokenBudget).toBe(5000);
    });

    it('T28: "nascent" regime → budget forced to 500 regardless of formula', async () => {
      // Even with H^1=1 (which would give budget=5000), nascent forces 500
      const { spawner } = createSpawner({ h1Threshold: 1 });
      spawner.updateRegime('nascent');
      sustainH1(spawner, 1, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1)], 1, 1);
      expect(agents).toHaveLength(1);
      expect(agents[0]!.params.tokenBudget).toBe(500);
    });

  });

  // -------------------------------------------------------------------------
  // Spawn cooldown
  // -------------------------------------------------------------------------

  describe('Spawn cooldown', () => {

    it('T29: Same gap not spawned twice within cooldown window', async () => {
      const { spawner } = createSpawner({ spawnCooldownIterations: 3 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      // First spawn at iteration 1
      const batch1 = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(batch1.length).toBeGreaterThan(0);

      // Second spawn at iteration 2 (within cooldown of 3)
      sustainH1(spawner, 5, 1);
      const batch2 = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 2);
      expect(batch2).toHaveLength(0); // suppressed by cooldown
    });

    it('T30: Gap spawned again after cooldown expires', async () => {
      const { spawner } = createSpawner({ spawnCooldownIterations: 3 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      // First spawn at iteration 1
      const batch1 = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);
      expect(batch1.length).toBeGreaterThan(0);

      // Spawn at iteration 4 — cooldown expired (4 - 1 = 3 >= spawnCooldownIterations=3)
      sustainH1(spawner, 5, 1);
      const batch2 = await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 4);
      expect(batch2.length).toBeGreaterThan(0); // cooldown expired, should spawn
    });

    it('T31: Different gaps unaffected by each other\'s cooldown', async () => {
      const { spawner } = createSpawner({ spawnCooldownIterations: 3 });
      spawner.updateRegime('critical');
      sustainH1(spawner, 5, 2);

      // Spawn gap-0-1 at iteration 1
      await spawner.evaluateAndSpawn([makeGap(0, 1)], 5, 1);

      // gap-1-2 is different — not in cooldown window
      sustainH1(spawner, 5, 1);
      const batch2 = await spawner.evaluateAndSpawn([makeGap(1, 2)], 5, 2);
      expect(batch2.length).toBeGreaterThan(0); // different gap, unaffected by gap-0-1 cooldown
    });

  });

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  describe('Event emission', () => {

    it('T32: "orch:vdw-agent-spawned" emitted for each spawned agent', async () => {
      const { spawner, events } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      await spawner.evaluateAndSpawn([makeGap(0, 1), makeGap(1, 2)], 3, 1);

      const spawnedEvents = events.filter((e) => e.type === 'orch:vdw-agent-spawned');
      expect(spawnedEvents).toHaveLength(2); // 1 per gap in transitioning regime
    });

    it('T33: Spawned event contains correct agentId, h1Dimension, gapId, tokenBudget', async () => {
      const { spawner, events } = createSpawner();
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 4, 2);

      await spawner.evaluateAndSpawn([makeGap(3, 7)], 4, 1);

      const spawnedEvent = events.find((e) => e.type === 'orch:vdw-agent-spawned') as unknown as Record<string, unknown>;
      expect(spawnedEvent).toBeDefined();
      expect(typeof spawnedEvent['agentId']).toBe('string');
      expect(spawnedEvent['h1Dimension']).toBe(4);
      expect(spawnedEvent['gapId']).toBe('gap-3-7');
      // Budget: max(500, floor(5000/4)) = max(500, 1250) = 1250
      expect(spawnedEvent['tokenBudget']).toBe(1250);
      expect(spawnedEvent['regime']).toBe('transitioning');
    });

    it('T34: "orch:vdw-agent-complete" emitted after runAgents() completes', async () => {
      const { spawner, events } = createSpawner({ agentMaxIterations: 2 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      await spawner.runAgents();

      const completeEvents = events.filter((e) => e.type === 'orch:vdw-agent-complete');
      expect(completeEvents).toHaveLength(1);
    });

    it('T35: Complete event contains synthQueries and entitiesAdded', async () => {
      const { spawner, events } = createSpawner({ agentMaxIterations: 2 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      await spawner.runAgents();

      const completeEvent = events.find(
        (e) => e.type === 'orch:vdw-agent-complete'
      ) as unknown as Record<string, unknown>;
      expect(completeEvent).toBeDefined();
      const synthQueries = completeEvent['synthQueries'] as string[];
      expect(Array.isArray(synthQueries)).toBe(true);
      expect(synthQueries.length).toBeGreaterThan(0);
      const entitiesAdded = completeEvent['entitiesAdded'] as string[];
      expect(Array.isArray(entitiesAdded)).toBe(true);
      expect(entitiesAdded.length).toBeGreaterThan(0);
      expect(completeEvent['success']).toBe(true);
    });

  });

  // -------------------------------------------------------------------------
  // Agent execution
  // -------------------------------------------------------------------------

  describe('Agent execution', () => {

    it('T36: runAgents() executes all active agents to completion', async () => {
      const { spawner } = createSpawner({ agentMaxIterations: 3 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1), makeGap(1, 2)], 3, 1);
      expect(agents).toHaveLength(2);

      await spawner.runAgents();

      // All agents should now be terminated
      for (const agent of agents) {
        expect(agent.status).toBe('terminated');
        expect(agent.stepsExecuted).toBe(3);
      }
    });

    it('T37: Agents removed from active list after completion', async () => {
      const { spawner } = createSpawner({ agentMaxIterations: 2 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      expect(spawner.getActiveAgentCount()).toBe(1);

      await spawner.runAgents();

      // After runAgents, agent is removed from active list
      expect(spawner.getActiveAgentCount()).toBe(0);
    });

    it('T38: getActiveAgentCount() returns correct count before and after run', async () => {
      const { spawner } = createSpawner({ agentMaxIterations: 5 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      expect(spawner.getActiveAgentCount()).toBe(0); // none initially

      await spawner.evaluateAndSpawn([makeGap(0, 1), makeGap(1, 2)], 3, 1);
      expect(spawner.getActiveAgentCount()).toBe(2); // 2 active

      await spawner.runAgents();
      expect(spawner.getActiveAgentCount()).toBe(0); // all done
    });

  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('Cleanup', () => {

    it('T39: cleanup() terminates all active agents', async () => {
      const { spawner } = createSpawner({ agentMaxIterations: 100 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      const agents = await spawner.evaluateAndSpawn([makeGap(0, 1), makeGap(1, 2)], 3, 1);
      expect(agents).toHaveLength(2);

      // Don't run agents — they remain active
      expect(agents.every((a) => a.status === 'active')).toBe(true);

      spawner.cleanup();

      // All agents should be terminated
      expect(agents.every((a) => a.status === 'terminated')).toBe(true);
    });

    it('T40: cleanup() clears agent list (getActiveAgentCount returns 0)', async () => {
      const { spawner } = createSpawner({ agentMaxIterations: 100 });
      spawner.updateRegime('transitioning');
      sustainH1(spawner, 3, 2);

      await spawner.evaluateAndSpawn([makeGap(0, 1)], 3, 1);
      expect(spawner.getActiveAgentCount()).toBe(1);

      spawner.cleanup();
      expect(spawner.getActiveAgentCount()).toBe(0);
    });

  });

  // -------------------------------------------------------------------------
  // getH1HysteresisStatus inspection
  // -------------------------------------------------------------------------

  describe('H^1 hysteresis status inspection', () => {

    it('returns correct count and sustained=false when below threshold', () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2 });
      spawner.updateH1Dimension(5);

      const status = spawner.getH1HysteresisStatus();
      expect(status.count).toBe(1);
      expect(status.threshold).toBe(2);
      expect(status.sustained).toBe(false);
    });

    it('returns sustained=true when threshold met', () => {
      const { spawner } = createSpawner({ h1HysteresisCount: 2 });
      sustainH1(spawner, 5, 2);

      const status = spawner.getH1HysteresisStatus();
      expect(status.count).toBe(2);
      expect(status.sustained).toBe(true);
    });

  });

});
