---
phase: 05-orchestrator
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/orchestrator/interfaces.ts
  - src/orchestrator/EventBus.ts
  - src/orchestrator/EventBus.test.ts
  - src/orchestrator/AgentPool.ts
  - src/orchestrator/AgentPool.test.ts
autonomous: true
user_setup: []

must_haves:
  truths:
    - "Event subscribers receive all emitted events of their subscribed type without exception"
    - "Event subscribers can unsubscribe and stop receiving events"
    - "Multiple subscribers receive the same event in parallel"
    - "Agent lifecycle (spawn, heartbeat, cleanup) executes in order"
    - "Agents with failed heartbeats are marked as terminated but don't block other agents"
    - "AgentPool can track active/idle/terminated agents"
  artifacts:
    - path: "src/orchestrator/interfaces.ts"
      provides: "Agent interface, PoolConfig, Task, TaskResult, EventSubscriber, AnyEvent type definitions"
      min_lines: 80
    - path: "src/orchestrator/EventBus.ts"
      provides: "EventBus class extending EventEmitter with subscribe/emit/unsubscribe methods"
      exports: ["EventBus", "EventSubscriber", "AnyEvent"]
      min_lines: 100
    - path: "src/orchestrator/AgentPool.ts"
      provides: "AgentPool class with initialize/shutdown/getAgents/getIdleAgents methods"
      exports: ["AgentPool"]
      min_lines: 120
  key_links:
    - from: "EventBus"
      to: "src/types/Events.ts"
      via: "import SheafEvent, SOCEvent"
      pattern: "import.*Events\.js"
    - from: "AgentPool"
      to: "src/orchestrator/interfaces.ts"
      via: "Agent interface + PoolConfig"
      pattern: "interface Agent.*status.*spawn.*heartbeat"
    - from: "EventBus subscribers"
      to: "handlers array"
      via: "Map<string, EventSubscriber[]>"
      pattern: "#subscribers.*Map"
---

<objective>
Build the foundational orchestrator infrastructure: event bus for cross-component messaging and agent pool for managing reasoning agent lifecycle.

Purpose: Phases 1-4 are complete and independently tested. Phase 5 integrates them under a single orchestrator that routes events asynchronously and manages agent spawn/heartbeat/cleanup cycles. This plan establishes the two core primitives that all later integration depends on.

Output: Two fully-tested modules (EventBus, AgentPool) that conform to the research patterns, with no cross-module imports and deterministic behavior under unit tests.
</objective>

<execution_context>
@/home/ty/.claude/get-shit-done/workflows/execute-plan.md
@/home/ty/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/05-orchestrator/05-RESEARCH.md

# Prior phase summaries (for reference patterns only):
@.planning/phases/01-sheaf/04-SUMMARY.md
@.planning/phases/02-lcm/02-05-SUMMARY.md
@.planning/phases/03-tna-molecular-cot/03-03-SUMMARY.md
@.planning/phases/04-soc/04-02-SUMMARY.md

# Existing types used by this phase:
@src/types/Events.ts
@src/types/MolecularCoT.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Define orchestrator interfaces and types (Agent, PoolConfig, EventSubscriber)</name>
  <files>src/orchestrator/interfaces.ts</files>
  <action>
Create src/orchestrator/interfaces.ts with the following exports (per 05-RESEARCH.md Pattern 2 and Pattern 3):

1. Agent interface:
   - id: string
   - status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated' (mutable field)
   - spawn(): Promise<void>
   - heartbeat(): Promise<void>
   - cleanup(): Promise<void>

2. PoolConfig interface:
   - poolSize: number
   - heartbeatIntervalMs: number
   - heartbeatTimeoutMs: number

3. Task<T> generic interface (for llm_map in later plan):
   - id: string
   - payload: unknown
   - metadata?: Record<string, unknown>

4. TaskResult<T> generic interface (for llm_map in later plan):
   - taskId: string
   - success: boolean
   - result?: T
   - error?: Error

5. EventSubscriber type:
   - Type alias: (event: AnyEvent) => void | Promise<void>

6. AnyEvent type:
   - Union of SheafEvent | SOCEvent from src/types/Events.js

Use strict readonly modifiers on all immutable fields. No external dependencies beyond src/types/. Add JSDoc comments explaining Agent lifecycle stages and configuration defaults. Export all types and interfaces (barrel-friendly).
  </action>
  <verify>
Compile check: tsc --noEmit src/orchestrator/interfaces.ts

Export verification: Confirm all 6 types are exported from the module
  </verify>
  <done>src/orchestrator/interfaces.ts exists with Agent, PoolConfig, Task, TaskResult, EventSubscriber, and AnyEvent fully typed and documented; compilation succeeds</done>
</task>

<task type="auto">
  <name>Task 2: Implement EventBus with subscriber routing and async emit (ORCH-04)</name>
  <files>src/orchestrator/EventBus.ts, src/orchestrator/EventBus.test.ts</files>
  <action>
Create src/orchestrator/EventBus.ts implementing ORCH-04 (event-driven coordination bus) per 05-RESEARCH.md Pattern 1:

EventBus class:
- Extend EventEmitter (from 'events')
- Private field: #subscribers: Map<string, EventSubscriber[]> = new Map()
- Constructor(): no parameters

Methods:
1. subscribe(eventType: string, handler: EventSubscriber): void
   - If eventType not in map, create empty array
   - Push handler to array for that type
   - Docstring: "Register a handler for a specific event type"

2. async emit(event: AnyEvent): Promise<void>
   - Get handlers for event.type from #subscribers (default empty array)
   - Use Promise.all() to run all handlers in parallel
   - Map each handler: Promise.resolve(handler(event)) to handle sync/async
   - Await all promises
   - Docstring: "Emit event to all subscribed handlers for this event type"

3. unsubscribe(eventType: string, handler: EventSubscriber): void
   - Get handlers array for eventType
   - Find handler index and splice it out
   - Docstring: "Unregister a handler; it will no longer receive events"

4. getSubscriberCount(eventType: string): number
   - Return array length for eventType (or 0 if not found)
   - Used in tests to verify subscriber management

Critical implementation notes:
- Do NOT use EventEmitter.on/off — we implement our own subscribe/unsubscribe logic
- EventBus IS an EventEmitter but we don't use its .on/.off methods; this is for future extension
- Import AnyEvent from './interfaces.js'
- No console.log or side effects in emit()
- All handlers run in parallel via Promise.all() — if one fails, Promise.all() rejects immediately
- Test data: emit events with iteration number, timestamps, metrics (realistic SOC/Sheaf events)

Create src/orchestrator/EventBus.test.ts with tests:

T1: Single subscriber receives emitted event
- Create EventBus
- Create mock handler (jest.fn or vitest.fn)
- Subscribe handler to 'soc:metrics'
- Emit SOCMetricsEvent
- Assert handler was called with event

T2: Multiple subscribers for same event receive in parallel
- Create EventBus
- Create 3 handlers
- Subscribe all to 'soc:metrics'
- Emit SOCMetricsEvent
- Assert all 3 handlers called

T3: Different event types route to different subscribers
- Create EventBus
- Handler A subscribed to 'sheaf:consensus-reached'
- Handler B subscribed to 'soc:metrics'
- Emit sheaf event
- Assert only A called, not B

T4: Unsubscribe prevents further events
- Create EventBus
- Subscribe handler to 'soc:metrics'
- Emit first event (assert called once)
- Unsubscribe
- Emit second event
- Assert handler not called for second event

T5: Async handlers in emit() all await
- Create EventBus
- Handler 1: Promise that resolves after 10ms
- Handler 2: Promise that resolves after 5ms
- emit() returns Promise
- Await emit() and verify both resolved (total time ~10ms, not sequential 15ms)

T6: emit() with no subscribers succeeds silently
- Create EventBus
- Emit event with no subscribers
- Assert no error thrown

T7: Handler that throws is caught and propagated via Promise.all() rejection
- Create EventBus
- Handler throws Error('test error')
- emit() should reject with that error
- Assert rejection caught

T8-T10: Edge cases (multiple subscribe/unsubscribe of same handler, eventType case-sensitive, getSubscriberCount accuracy)

Use realistic SOCMetricsEvent and SheafConsensusReachedEvent objects as test data.
  </action>
  <verify>
npm test -- src/orchestrator/EventBus.test.ts

All tests T1-T10 pass. No type errors. getSubscriberCount returns correct numbers. Parallel execution verified (timing assertions show parallel, not sequential).
  </verify>
  <done>EventBus class fully implements subscribe/emit/unsubscribe with async handler dispatch; 10+ tests passing; all subscribers receive all routed events</done>
</task>

<task type="auto">
  <name>Task 3: Implement AgentPool with lifecycle management and per-agent heartbeat timeouts (ORCH-01)</name>
  <files>src/orchestrator/AgentPool.ts, src/orchestrator/AgentPool.test.ts</files>
  <action>
Create src/orchestrator/AgentPool.ts implementing ORCH-01 (agent pool with lifecycle management) per 05-RESEARCH.md Pattern 2:

AgentPool class:
- Private fields:
  - #config: PoolConfig
  - #agents: Agent[] = []
  - #heartbeatTimer: NodeJS.Timer | null = null
  - #isShuttingDown: boolean = false

- Constructor(agentFactory: () => Agent, config: PoolConfig)
  - Store config
  - For i in 0..config.poolSize, append agentFactory() to #agents
  - All agents start with status 'spawning' (set in factory or here)

- async initialize(): Promise<void>
  - Spawn all agents in parallel: await Promise.all(#agents.map(a => a.spawn()))
  - On success, all agents should have status 'active'
  - Set #heartbeatTimer = setInterval(() => this.#runHeartbeat(), config.heartbeatIntervalMs)

- Private async #runHeartbeat(): Promise<void>
  - Construct promises array: agents.map(agent => Promise.race([
      agent.heartbeat(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Heartbeat timeout')), config.heartbeatTimeoutMs))
    ]).catch(err => {
      console.error(`Agent ${agent.id} heartbeat failed:`, err);
      agent.status = 'terminated';  // Mark as dead on timeout or error
    }))
  - await Promise.all(promises) to complete all heartbeats (or timeouts) in parallel
  - Do NOT propagate heartbeat errors up; catch and mark agent as terminated

- async shutdown(): Promise<void>
  - If #isShuttingDown already true, return early
  - Set #isShuttingDown = true
  - clearInterval(#heartbeatTimer) and null it
  - Cleanup all agents in parallel: await Promise.all(#agents.map(a => a.cleanup()))

- getAgents(): readonly Agent[]
  - Return #agents (or Object.freeze(#agents.slice()))

- getIdleAgents(): readonly Agent[]
  - Return #agents.filter(a => a.status === 'idle') as readonly array

- getAgentCount(): number (helper)
  - Return #agents.length

Key implementation notes:
- Per-agent timeouts (Promise.race) are CRITICAL: prevents one slow agent from blocking heartbeat checks for others (05-RESEARCH.md Pitfall 4)
- Heartbeat errors are caught and logged, not propagated (graceful degradation)
- Idempotent shutdown: calling shutdown() twice is safe
- Agent factory pattern allows test mocks to be injected

Create src/orchestrator/AgentPool.test.ts with tests:

T1: initialize() spawns all agents and marks them active
- Create pool with 3 agents via factory
- Call initialize()
- Assert all agents have status 'active'
- Assert agents are stored in pool

T2: getIdleAgents() returns only idle agents
- Create pool with 4 agents
- initialize()
- Manually set 2 agents to 'idle' status
- Assert getIdleAgents() returns exactly 2

T3: Heartbeat interval fires periodically and calls heartbeat() on all agents
- Create pool with 2 agents
- Mock heartbeat() via jest.spyOn/vitest.spyOn
- initialize()
- Wait 2.5 * heartbeatIntervalMs (config with short interval)
- Assert heartbeat() called at least 2 times on each agent
- shutdown()

T4: Per-agent heartbeat timeout doesn't block other agents
- Create pool with 2 agents
- Agent 1: heartbeat() hangs forever
- Agent 2: heartbeat() succeeds immediately
- initialize() with heartbeatTimeoutMs=100
- Wait for heartbeat cycle
- Assert Agent 1 marked as 'terminated' due to timeout
- Assert Agent 2 still 'active' (not blocked by Agent 1's timeout)

T5: shutdown() calls cleanup() on all agents
- Create pool with 2 agents
- Mock cleanup() via spyOn
- initialize() then shutdown()
- Assert cleanup() called on each agent
- Assert agents can't be re-spawned after shutdown (idempotent)

T6: Idempotent shutdown — calling shutdown() twice is safe
- Create pool, initialize(), shutdown(), shutdown() again
- Assert no error thrown

T7: getAgents() returns all agents including terminated ones
- Create pool, initialize()
- Mark some agents terminated
- Assert getAgents() includes terminated agents (pool doesn't filter them)

T8: Agent status transitions: spawning -> active -> idle -> terminated
- Create pool with 1 agent
- Verify initial status
- After initialize(), status is 'active'
- Manually set to 'idle'
- Call shutdown(), set to 'terminated'

T9: Heartbeat failure doesn't crash pool
- Create pool with 1 agent
- Agent.heartbeat() throws Error
- initialize()
- Wait for heartbeat cycle
- Assert Error caught, agent marked terminated, pool still responsive

T10: Multiple shutdown calls don't duplicate cleanup work
- Create pool with mock cleanup
- initialize()
- Call shutdown() twice
- Assert cleanup() called exactly once per agent (not twice)

Use simple MockAgent for tests:
```typescript
class MockAgent implements Agent {
  id: string;
  status: Agent['status'] = 'spawning';
  async spawn() { this.status = 'active'; }
  async heartbeat() { /* success by default */ }
  async cleanup() { this.status = 'terminated'; }
}
```
  </action>
  <verify>
npm test -- src/orchestrator/AgentPool.test.ts

All tests T1-T10 pass. Heartbeat timing verified (parallel, not sequential). Per-agent timeouts work correctly (one timeout doesn't block others). Shutdown is idempotent. No type errors.
  </verify>
  <done>AgentPool class fully manages agent lifecycle with initialize/shutdown; per-agent heartbeat timeouts prevent pool-wide hangs; 10+ tests passing</done>
</task>

</tasks>

<verification>
**Phase 5 Plan 01 Success Criteria:**

1. **EventBus Routing (ORCH-04):**
   - [ ] EventBus.subscribe() registers handlers for event types
   - [ ] EventBus.emit() routes events to all subscribed handlers in parallel
   - [ ] EventBus.unsubscribe() prevents future events
   - [ ] Multiple subscribers receive the same event simultaneously
   - [ ] Async/sync handlers both work correctly
   - All 10+ EventBus tests pass

2. **AgentPool Lifecycle (ORCH-01):**
   - [ ] AgentPool.initialize() spawns all agents in parallel
   - [ ] AgentPool.shutdown() cleans up all agents gracefully
   - [ ] Heartbeat timer fires at configured interval
   - [ ] Per-agent heartbeat timeout prevents one slow agent blocking others
   - [ ] Failed/timed-out agents marked terminated without crashing pool
   - [ ] getIdleAgents() returns only agents with status='idle'
   - All 10+ AgentPool tests pass

3. **No Cross-Module Imports:**
   - [ ] src/orchestrator/interfaces.ts imports only from src/types/Events.ts
   - [ ] src/orchestrator/EventBus.ts imports from interfaces.ts + node:events only
   - [ ] src/orchestrator/AgentPool.ts imports from interfaces.ts only

4. **Compilation and Type Safety:**
   - [ ] tsc --noEmit passes with no errors
   - [ ] All interfaces properly exported (barrel-friendly)
   - [ ] AnyEvent properly typed as SheafEvent | SOCEvent union

5. **Documentation:**
   - [ ] JSDoc comments on Agent interface explain lifecycle stages
   - [ ] PoolConfig documented with reasonable defaults
   - [ ] Agent.status enum documented with state descriptions
   - [ ] EventBus.subscribe/emit/unsubscribe documented with examples in comments
</verification>

<success_criteria>
**After Plan 01 completion:**

1. `npm test -- src/orchestrator/` returns **25+ passing tests** (EventBus 10+, AgentPool 10+, interfaces compile)
2. EventBus and AgentPool can be imported and used in downstream plans (02, 03, 04, 05)
3. No circular dependencies — `src/sheaf/`, `src/lcm/`, `src/tna/`, `src/soc/` all import-independent of orchestrator
4. Agent lifecycle is fully deterministic and testable with mock agents
5. Event routing is async-safe: concurrent emit() calls don't lose events or misorient handler dispatch

**Code characteristics:**
- All event subscribers run in parallel (Promise.all), not serialized
- Heartbeat timeouts are per-agent (via Promise.race), preventing cascading hangs
- Shutdown is idempotent (safe to call multiple times)
- No external npm dependencies beyond node:events (built-in)
</success_criteria>

<output>
After completion, create `.planning/phases/05-orchestrator/05-01-SUMMARY.md` with:
- Architecture: How EventBus routes events, how AgentPool manages lifecycle
- Test results: Test names, coverage (T1-T10 EventBus, T1-T10 AgentPool)
- Integration readiness: Event types properly mapped, Agent interface stable
- State for next plan (02): Both modules ready for llm_map and composition root integration
</output>

---

## Planning Complete

Generated by gsd-planner on 2026-02-28
Ready for verification via gsd-plan-checker
