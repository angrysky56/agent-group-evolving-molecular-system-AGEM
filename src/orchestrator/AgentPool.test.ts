/**
 * AgentPool.test.ts
 *
 * Tests for AgentPool (ORCH-01): agent lifecycle management and heartbeat.
 *
 * Test cases T1-T10 cover:
 *   T1:  initialize() spawns all agents and marks them active
 *   T2:  getIdleAgents() returns only idle agents
 *   T3:  Heartbeat interval fires periodically and calls heartbeat() on all agents
 *   T4:  Per-agent heartbeat timeout doesn't block other agents
 *   T5:  shutdown() calls cleanup() on all agents
 *   T6:  Idempotent shutdown — calling shutdown() twice is safe
 *   T7:  getAgents() returns all agents including terminated ones
 *   T8:  Agent status transitions: spawning -> active -> idle -> terminated
 *   T9:  Heartbeat failure doesn't crash pool
 *   T10: Multiple shutdown calls don't duplicate cleanup work
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentPool } from './AgentPool.js';
import type { Agent, PoolConfig } from './interfaces.js';

// ---------------------------------------------------------------------------
// MockAgent — simple agent for testing
// ---------------------------------------------------------------------------

class MockAgent implements Agent {
  id: string;
  status: Agent['status'] = 'spawning';

  spawnCalled = 0;
  heartbeatCalled = 0;
  cleanupCalled = 0;

  // Controllable behaviors
  heartbeatFn: () => Promise<void> = async () => {
    /* success by default */
  };

  constructor(id: string) {
    this.id = id;
  }

  async spawn(): Promise<void> {
    this.spawnCalled++;
    this.status = 'active';
  }

  async heartbeat(): Promise<void> {
    this.heartbeatCalled++;
    return this.heartbeatFn();
  }

  async cleanup(): Promise<void> {
    this.cleanupCalled++;
    this.status = 'terminated';
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

let agentCounter = 0;

function makeAgent(): MockAgent {
  return new MockAgent(`agent-${++agentCounter}`);
}

function makePool(
  size: number,
  overrideConfig?: Partial<PoolConfig>
): { pool: AgentPool; agents: MockAgent[] } {
  const agents: MockAgent[] = [];
  const config: PoolConfig = {
    poolSize: size,
    heartbeatIntervalMs: overrideConfig?.heartbeatIntervalMs ?? 100,
    heartbeatTimeoutMs: overrideConfig?.heartbeatTimeoutMs ?? 50,
    ...overrideConfig,
  };
  const pool = new AgentPool(() => {
    const agent = makeAgent();
    agents.push(agent);
    return agent;
  }, config);
  return { pool, agents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentPool', () => {
  beforeEach(() => {
    agentCounter = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // T1: initialize() spawns all agents and marks them active
  it('T1: initialize() spawns all agents in parallel and marks them active', async () => {
    const { pool, agents } = makePool(3);

    // Initially all spawning
    expect(agents.every((a) => a.status === 'spawning')).toBe(true);

    await pool.initialize();

    // After initialize, all should be active
    expect(agents).toHaveLength(3);
    expect(agents.every((a) => a.status === 'active')).toBe(true);
    expect(agents.every((a) => a.spawnCalled === 1)).toBe(true);

    // Pool has all agents
    expect(pool.getAgents()).toHaveLength(3);

    await pool.shutdown();
  });

  // T2: getIdleAgents() returns only idle agents
  it('T2: getIdleAgents() returns only agents with status idle', async () => {
    const { pool, agents } = makePool(4);
    await pool.initialize();

    // Manually set 2 agents to idle
    agents[0].status = 'idle';
    agents[2].status = 'idle';

    const idleAgents = pool.getIdleAgents();
    expect(idleAgents).toHaveLength(2);
    expect(idleAgents).toContain(agents[0]);
    expect(idleAgents).toContain(agents[2]);
    expect(idleAgents).not.toContain(agents[1]);
    expect(idleAgents).not.toContain(agents[3]);

    await pool.shutdown();
  });

  // T3: Heartbeat interval fires periodically and calls heartbeat() on all agents
  it('T3: heartbeat interval fires periodically on all active agents', async () => {
    const { pool, agents } = makePool(2, { heartbeatIntervalMs: 50, heartbeatTimeoutMs: 30 });
    await pool.initialize();

    // Fast-forward time to trigger 2 heartbeat cycles
    await vi.advanceTimersByTimeAsync(130); // 2.6x interval = 2 full cycles

    // Each agent should have heartbeat called at least twice
    expect(agents[0].heartbeatCalled).toBeGreaterThanOrEqual(2);
    expect(agents[1].heartbeatCalled).toBeGreaterThanOrEqual(2);

    await pool.shutdown();
  });

  // T4: Per-agent heartbeat timeout doesn't block other agents
  it('T4: per-agent heartbeat timeout marks timed-out agent terminated without blocking others', async () => {
    const { pool, agents } = makePool(2, { heartbeatIntervalMs: 50, heartbeatTimeoutMs: 30 });

    // Agent 0 hangs forever in heartbeat
    agents[0].heartbeatFn = () => new Promise<void>(() => {
      /* never resolves */
    });
    // Agent 1 heartbeat succeeds immediately
    agents[1].heartbeatFn = async () => {
      /* success */
    };

    await pool.initialize();

    // Advance time past heartbeat interval + timeout
    await vi.advanceTimersByTimeAsync(100); // interval(50) + timeout(30) + margin

    // Agent 0 should be terminated (heartbeat timed out)
    expect(agents[0].status).toBe('terminated');

    // Agent 1 should still be active (not blocked by agent 0's timeout)
    expect(agents[1].status).toBe('active');

    await pool.shutdown();
  });

  // T5: shutdown() calls cleanup() on all agents
  it('T5: shutdown() calls cleanup() on all agents', async () => {
    const { pool, agents } = makePool(2);
    await pool.initialize();
    await pool.shutdown();

    expect(agents[0].cleanupCalled).toBe(1);
    expect(agents[1].cleanupCalled).toBe(1);
  });

  // T6: Idempotent shutdown — calling shutdown() twice is safe
  it('T6: shutdown() is idempotent — calling twice does not throw', async () => {
    const { pool } = makePool(2);
    await pool.initialize();

    await expect(pool.shutdown()).resolves.toBeUndefined();
    await expect(pool.shutdown()).resolves.toBeUndefined(); // second call is no-op
  });

  // T7: getAgents() returns all agents including terminated ones
  it('T7: getAgents() includes terminated agents', async () => {
    const { pool, agents } = makePool(3);
    await pool.initialize();

    // Mark agent 1 as terminated
    agents[1].status = 'terminated';

    const all = pool.getAgents();
    expect(all).toHaveLength(3);
    expect(all).toContain(agents[1]); // terminated agent is still in pool

    await pool.shutdown();
  });

  // T8: Agent status transitions: spawning -> active -> idle -> terminated
  it('T8: agent status transitions follow lifecycle order', async () => {
    const { pool, agents } = makePool(1);

    // Initial status
    expect(agents[0].status).toBe('spawning');

    await pool.initialize();

    // After spawn
    expect(agents[0].status).toBe('active');

    // Manually transition to idle
    agents[0].status = 'idle';
    expect(agents[0].status).toBe('idle');

    // Shutdown transitions to terminated
    await pool.shutdown();
    expect(agents[0].status).toBe('terminated');
  });

  // T9: Heartbeat failure doesn't crash pool
  it('T9: heartbeat failure is caught, agent marked terminated, pool remains responsive', async () => {
    const { pool, agents } = makePool(1, { heartbeatIntervalMs: 50, heartbeatTimeoutMs: 200 });

    // Agent heartbeat throws
    agents[0].heartbeatFn = async () => {
      throw new Error('heartbeat failure');
    };

    await pool.initialize();

    // Advance past heartbeat interval
    await vi.advanceTimersByTimeAsync(70);

    // Pool should not crash; agent should be terminated
    expect(agents[0].status).toBe('terminated');

    // Pool is still responsive — shutdown works without error
    await expect(pool.shutdown()).resolves.toBeUndefined();
  });

  // T10: Multiple shutdown calls don't duplicate cleanup work
  it('T10: multiple shutdown calls result in exactly one cleanup() per agent', async () => {
    const { pool, agents } = makePool(2);
    await pool.initialize();

    await pool.shutdown();
    await pool.shutdown(); // second call
    await pool.shutdown(); // third call

    // Each agent's cleanup() should be called exactly once
    expect(agents[0].cleanupCalled).toBe(1);
    expect(agents[1].cleanupCalled).toBe(1);
  });

  // Additional: getAgentCount() helper
  it('getAgentCount() returns total pool size', async () => {
    const { pool } = makePool(5);
    expect(pool.getAgentCount()).toBe(5);
    await pool.initialize();
    expect(pool.getAgentCount()).toBe(5);
    await pool.shutdown();
    expect(pool.getAgentCount()).toBe(5); // count doesn't change on shutdown
  });

  // Additional: empty pool initializes without error
  it('empty pool (size=0) initializes and shuts down cleanly', async () => {
    const { pool, agents } = makePool(0);
    expect(agents).toHaveLength(0);
    await expect(pool.initialize()).resolves.toBeUndefined();
    await expect(pool.shutdown()).resolves.toBeUndefined();
  });
});
