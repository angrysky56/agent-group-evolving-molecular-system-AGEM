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
  - src/orchestrator/OrchestratorState.ts
  - src/orchestrator/OrchestratorState.test.ts
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
    - "Orchestrator state transitions: NORMAL → OBSTRUCTED (H1 metric crosses threshold)"
    - "Orchestrator state transitions: OBSTRUCTED → CRITICAL (H1 exceeds critical threshold)"
    - "Orchestrator state transitions: CRITICAL → NORMAL (H1 drops + consistency restored)"
    - "State change events emit with old/new state in payload"
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
    - path: "src/orchestrator/OrchestratorState.ts"
      provides: "OrchestratorState enum, state transition logic, state change event types"
      exports: ["OrchestratorState", "OrchestratorStateManager"]
      min_lines: 100
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
    - from: "OrchestratorStateManager"
      to: "EventBus"
      via: "subscribe to state change events"
      pattern: "eventBus\\.subscribe"
---

<objective>
Build the foundational orchestrator infrastructure: event bus for cross-component messaging, agent pool for managing reasoning agent lifecycle, and state machine for tracking orchestrator operational modes (NORMAL/OBSTRUCTED/CRITICAL).

Purpose: Phases 1-4 are complete and independently tested. Phase 5 integrates them under a single orchestrator that routes events asynchronously, manages agent spawn/heartbeat/cleanup cycles, and tracks state transitions driven by topological obstruction. This plan establishes the three core primitives that all later integration depends on.

Output: Three fully-tested modules (EventBus, AgentPool, OrchestratorState) that conform to the research patterns, with no cross-module imports and deterministic behavior under unit tests.
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
    agent.status = 'terminated'; // Mark as dead on timeout or error
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
- Wait 2.5 \* heartbeatIntervalMs (config with short interval)
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
  status: Agent["status"] = "spawning";
  async spawn() {
    this.status = "active";
  }
  async heartbeat() {
    /* success by default */
  }
  async cleanup() {
    this.status = "terminated";
  }
}
```

  </action>
  <verify>
npm test -- src/orchestrator/AgentPool.test.ts

All tests T1-T10 pass. Heartbeat timing verified (parallel, not sequential). Per-agent timeouts work correctly (one timeout doesn't block others). Shutdown is idempotent. No type errors.
</verify>
<done>AgentPool class fully manages agent lifecycle with initialize/shutdown; per-agent heartbeat timeouts prevent pool-wide hangs; 10+ tests passing</done>
</task>

<task type="auto">
  <name>Task 4: Implement OrchestratorState enum and state machine with transitions and events (ORCH-03)</name>
  <files>src/orchestrator/OrchestratorState.ts, src/orchestrator/OrchestratorState.test.ts</files>
  <action>
Create src/orchestrator/OrchestratorState.ts implementing state machine for orchestrator operational modes per ROADMAP criteria #4:

1. OrchestratorState enum:

   ```typescript
   export enum OrchestratorState {
     NORMAL = "NORMAL",
     OBSTRUCTED = "OBSTRUCTED",
     CRITICAL = "CRITICAL",
   }
   ```

2. State change event type:

   ```typescript
   export interface StateChangeEvent {
     type: "orch:state-changed";
     oldState: OrchestratorState;
     newState: OrchestratorState;
     timestamp: number;
     h1Metric?: number; // H^1 dimension that triggered transition
     reason: string; // Description of why transition occurred
   }
   ```

3. OrchestratorStateManager class:
   - Private fields:
     - #currentState: OrchestratorState = OrchestratorState.NORMAL
     - #h1ObstructionThreshold: number = 2 (H^1 dimension crossing this triggers OBSTRUCTED)
     - #h1CriticalThreshold: number = 5 (H^1 dimension crossing this triggers CRITICAL)
     - #eventBus: EventBus (dependency injection)
     - #lastStateChangeTime: number = Date.now()

   - Constructor(eventBus: EventBus, h1ObstructionThreshold?: number, h1CriticalThreshold?: number)
     - Store eventBus and thresholds
     - Initialize state to NORMAL

   - updateMetrics(h1Dimension: number): void
     - Check current state and h1Dimension to determine next state
     - Logic:
       1. If currentState === NORMAL and h1Dimension >= h1CriticalThreshold:
          - setState(CRITICAL, `H^1=${h1Dimension} exceeds critical threshold ${h1CriticalThreshold}`)
       2. Else if currentState === NORMAL and h1Dimension >= h1ObstructionThreshold:
          - setState(OBSTRUCTED, `H^1=${h1Dimension} crosses obstruction threshold ${h1ObstructionThreshold}`)
       3. Else if currentState === OBSTRUCTED and h1Dimension >= h1CriticalThreshold:
          - setState(CRITICAL, `H^1=${h1Dimension} escalates to critical`)
       4. Else if (currentState === OBSTRUCTED or CRITICAL) and h1Dimension < h1ObstructionThreshold:
          - setState(NORMAL, `H^1=${h1Dimension} returns below obstruction threshold`)
       5. Else: no transition

   - Private setState(newState: OrchestratorState, reason: string, h1Metric?: number): void
     - If newState === #currentState, return early (no-op)
     - oldState = #currentState
     - #currentState = newState
     - #lastStateChangeTime = Date.now()
     - Emit state change event via eventBus
     - Log transition: console.log(`[ORCH-STATE] ${oldState} → ${newState}: ${reason}`)

   - getState(): OrchestratorState
     - Return #currentState (for querying current state)

   - getLastStateChangeTime(): number
     - Return #lastStateChangeTime

Key implementation notes:

- State machine is ONE-DIRECTIONAL in certain ways:
  - NORMAL → OBSTRUCTED → CRITICAL only go forward by H^1 increase
  - CRITICAL → OBSTRUCTED → NORMAL only go backward if H^1 drops below thresholds
  - No jumping from CRITICAL directly to OBSTRUCTED (must pass through intermediate)
- updateMetrics() is called by Orchestrator after each Sheaf analysis iteration
- Events are emitted through EventBus for decoupling (other components can listen)
- Thresholds are configurable per constructor (testable)
- No async operations; state transitions are synchronous

Create src/orchestrator/OrchestratorState.test.ts with 5+ tests:

T1: NORMAL → OBSTRUCTED transition when H1 crosses threshold

- Create OrchestratorStateManager with defaults (threshold=2)
- Assert initial state is NORMAL
- Call updateMetrics(2) (H1 = threshold)
- Assert state is OBSTRUCTED
- Assert state change event emitted with oldState=NORMAL, newState=OBSTRUCTED, h1Metric=2

T2: OBSTRUCTED → CRITICAL transition when H1 exceeds critical threshold

- Create OrchestratorStateManager (obstructionThreshold=2, criticalThreshold=5)
- updateMetrics(2) → OBSTRUCTED
- updateMetrics(5) → CRITICAL
- Assert state is CRITICAL after second update
- Assert event emitted with reason mentioning critical threshold

T3: CRITICAL → NORMAL transition when H1 drops below obstruction threshold

- Create OrchestratorStateManager
- updateMetrics(5) → CRITICAL (skips OBSTRUCTED via direct path)
- updateMetrics(1) → NORMAL (H1 < 2)
- Assert state is NORMAL
- Assert event emitted

T4: State change event emissions (payload structure)

- Create OrchestratorStateManager
- Setup event listener on eventBus for 'orch:state-changed'
- Call updateMetrics(3)
- Assert event payload contains: oldState, newState, timestamp, h1Metric, reason
- Assert timestamp is recent (within 1 second)

T5: getState() and getLastStateChangeTime() return correct values

- Create OrchestratorStateManager
- Assert getState() === NORMAL initially
- updateMetrics(2)
- Assert getState() === OBSTRUCTED
- time1 = getLastStateChangeTime()
- Wait 10ms
- updateMetrics(5)
- time2 = getLastStateChangeTime()
- Assert time2 > time1 (state change time updated)

T6: No transition if already in target state (idempotent)

- Create OrchestratorStateManager
- updateMetrics(2) → OBSTRUCTED
- Listen for state change events
- Count events before = 1
- updateMetrics(2.5) (same state, different H1)
- Assert no new event (already OBSTRUCTED)

T7: Thresholds are configurable

- Create OrchestratorStateManager(eventBus, 5, 10)
- updateMetrics(3) → NORMAL (below custom threshold of 5)
- updateMetrics(5) → OBSTRUCTED (crosses custom threshold)
- Assert state is OBSTRUCTED (using custom thresholds)

T8: H1 = 0 always results in NORMAL state

- Create OrchestratorStateManager
- updateMetrics(100) → CRITICAL
- updateMetrics(0) → NORMAL
- Assert state is NORMAL
- Assert event reason mentions H1 returning to zero

Helpers:

- createMockEventBus(): Mock EventBus with subscribe/emit
- createStateManager(threshold?, critical?): Convenience factory

  </action>
  <verify>
npm test -- src/orchestrator/OrchestratorState.test.ts

All tests T1-T8 pass. State transitions verified. Event emissions verified. No type errors.
</verify>
<done>OrchestratorState enum and OrchestratorStateManager class fully implement state machine with NORMAL/OBSTRUCTED/CRITICAL transitions driven by H^1 metrics; 8+ tests passing</done>
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

3. **OrchestratorState Machine (ORCH-03):**
   - [ ] NORMAL → OBSTRUCTED transition when H^1 crosses threshold
   - [ ] OBSTRUCTED → CRITICAL transition when H^1 exceeds critical threshold
   - [ ] CRITICAL → NORMAL transition when H^1 drops and consistency restored
   - [ ] State change events emitted with old/new state payload
   - [ ] Transitions are synchronous and deterministic
   - [ ] Thresholds are configurable
   - All 8+ OrchestratorState tests pass

4. **No Cross-Module Imports:**
   - [ ] src/orchestrator/interfaces.ts imports only from src/types/Events.ts
   - [ ] src/orchestrator/EventBus.ts imports from interfaces.ts + node:events only
   - [ ] src/orchestrator/AgentPool.ts imports from interfaces.ts only
   - [ ] src/orchestrator/OrchestratorState.ts imports from interfaces.ts + EventBus.ts only

5. **Compilation and Type Safety:**
   - [ ] tsc --noEmit passes with no errors
   - [ ] All interfaces properly exported (barrel-friendly)
   - [ ] AnyEvent properly typed as SheafEvent | SOCEvent union
   - [ ] StateChangeEvent properly typed with all required fields

6. **Documentation:**
   - [ ] JSDoc comments on Agent interface explain lifecycle stages
   - [ ] PoolConfig documented with reasonable defaults
   - [ ] Agent.status enum documented with state descriptions
   - [ ] EventBus.subscribe/emit/unsubscribe documented with examples in comments
   - [ ] OrchestratorState enum and transitions documented
         </verification>

<success_criteria>
**After Plan 01 completion:**

1. `npm test -- src/orchestrator/` returns **35+ passing tests** (EventBus 10+, AgentPool 10+, OrchestratorState 8+, interfaces compile)
2. EventBus, AgentPool, and OrchestratorState can be imported and used in downstream plans (02, 03, 04, 05)
3. No circular dependencies — `src/sheaf/`, `src/lcm/`, `src/tna/`, `src/soc/` all import-independent of orchestrator
4. Agent lifecycle is fully deterministic and testable with mock agents
5. Event routing is async-safe: concurrent emit() calls don't lose events or misorient handler dispatch
6. State machine is deterministic: same H^1 metric input always produces same state transition

**Code characteristics:**

- All event subscribers run in parallel (Promise.all), not serialized
- Heartbeat timeouts are per-agent (via Promise.race), preventing cascading hangs
- Shutdown is idempotent (safe to call multiple times)
- State transitions are synchronous (no async operations)
- No external npm dependencies beyond node:events (built-in)
  </success_criteria>

<output>
After completion, create `.planning/phases/05-orchestrator/05-01-SUMMARY.md` with:
- Architecture: How EventBus routes events, how AgentPool manages lifecycle, how OrchestratorState tracks modes
- Test results: Test names, coverage (T1-T10 EventBus, T1-T10 AgentPool, T1-T8 OrchestratorState)
- Integration readiness: Event types properly mapped, Agent interface stable, state transitions verified
- State for next plan (02): All three modules ready for llm_map and composition root integration
</output>

---

## Revision Notes

Revised by gsd-planner on 2026-02-28

- Added Task 4: OrchestratorState enum + state machine (ORCH-03)
- All 5 ROADMAP success criteria now explicitly covered in Phase 5
- Test count increased: ~35 tests in Wave 1 (was ~20)
- Ready for verification
