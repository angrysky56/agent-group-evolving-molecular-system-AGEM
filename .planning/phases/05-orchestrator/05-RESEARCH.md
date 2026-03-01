# Phase 5: Orchestrator Integration - Research

**Researched:** 2026-02-28
**Domain:** Agent pool lifecycle management, parallel task dispatch, event-driven coordination, module composition (TypeScript)
**Confidence:** HIGH

---

## Summary

Phase 5 is the integration phase. It brings together the four independent, fully-tested modules from Phases 1-4 (Sheaf coordination, LCM dual-memory, Text Network Analysis + Molecular-CoT, Self-Organized Criticality Tracking) under a single orchestrator that manages agent pool lifecycle, dispatches parallel reasoning tasks with context preservation, and broadcasts events asynchronously across components.

The primary architectural constraint is **strict module isolation**: Phases 1-4 modules have zero cross-dependencies. Only the Phase 5 orchestrator (and test helpers like isolation.test.ts guards in each module) import from multiple modules. This design eliminates circular dependency risk and keeps each module independently testable.

The core Phase 5 components are:

1. **AgentPool** (ORCH-01) — Manage a pool of reasoning agents with async lifecycle (spawn, heartbeat/keepalive, graceful shutdown/cleanup). No built-in agent implementation; the pool stores opaque `Agent` instances and coordinates their lifecycle via callbacks.

2. **llm_map Primitive** (ORCH-02) — Dispatch N parallel tasks to a cluster of LLM workers, preserving call order and context state. Returns results in original call order. Must handle partial failures gracefully (some tasks fail, others succeed; return both successes and errors to caller).

3. **EventBus** (ORCH-04) — Async event broker for inter-component communication. Components emit events (sheaf consensus, SOC metrics, phase transitions) to the bus; subscribers receive them asynchronously. Bus is event-type-agnostic and uses discriminated-union event types from `src/types/Events.ts`.

4. **Composition Root** (ORCH-05) — Single module that imports all four Phase 1-4 modules, instantiates them with shared interfaces and injectable dependencies, wires the event bus for cross-component messaging, and exports the fully-wired Orchestrator instance. This is the ONLY place cross-module imports occur in production code.

**Primary recommendation:** Build in waves — Wave 1: EventBus (simpler, no LLM concern); Wave 2: AgentPool (lifecycle, no parallel dispatch yet); Wave 3: llm_map primitive (parallel dispatch + context preservation + error handling); Wave 4: Composition Root (wiring everything together with deterministic tests). This layering isolates each concern and prevents the integration phase from becoming a monolithic, untestable blob.

---

## Standard Stack

### Core (already in package.json)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:events` (built-in) | Node 22 LTS | EventEmitter base class for event bus and component subscriptions | Already used in CohomologyAnalyzer and SOCTracker; consistent pattern |
| `node:worker_threads` (built-in) | Node 22 LTS | Worker thread pool for parallel task dispatch in llm_map | Native Node.js; zero dependencies; supports CPU-bound and async I/O workloads |
| `node:async_hooks` (built-in) | Node 22 LTS | AsyncContext for propagating execution context through worker threads | ES2024 feature; enables context preservation across worker boundaries |
| `typescript` | 5.9.3 | Strict typing, discriminated unions for event types, branded ID types | Project-wide; NodeNext module resolution with `.js` imports |
| `vitest` | 4.0.18 | Test runner with `pool: 'forks'` for worker thread isolation | Project-wide; allows testing worker pool without native binding issues |

### Supporting (already in package.json)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:path`, `node:url` (built-in) | — | Worker thread script path resolution (ESM `import.meta.url` → file paths) | Required for spawning worker threads with ESM modules |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:worker_threads` | External pool library (`piscina`, `node-worker-threads-pool`) | External libraries add dependencies and NPM risk; Node.js built-in `worker_threads` is stable and sufficient for Phase 5 |
| `node:async_hooks` + manual propagation | Class-based context wrapper (e.g., `AsyncLocalStorage`) | `AsyncLocalStorage` (Node 12.17+) is simpler but less flexible; `async_hooks` allows custom context propagation logic |
| EventEmitter | Custom callback registry | EventEmitter is the Node.js standard; callbacks-only loses the ability for subscribers to unsubscribe cleanly |
| Manual error handling | `Promise.allSettled()` | Manual error handling is more explicit; `allSettled()` is simpler but less flexible for partial failure strategies |

**Installation:**
```bash
# No new packages — all dependencies are Node.js built-ins or already installed
npm list node:events node:worker_threads node:async_hooks typescript vitest
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/orchestrator/
├── AgentPool.ts              # ORCH-01: agent lifecycle (spawn, heartbeat, cleanup)
├── AgentPool.test.ts         # Lifecycle tests, mock agent heartbeats
├── EventBus.ts               # ORCH-04: event broker with discriminated unions
├── EventBus.test.ts          # Event subscription, emit, error propagation
├── llm_map.ts                # ORCH-02: parallel task dispatch with context
├── llm_map.test.ts           # Parallel dispatch, order preservation, error handling
├── ComposeRootModule.ts      # ORCH-05: wires all four modules together
├── ComposeRootModule.test.ts # Integration test: all modules wired, events flow
├── interfaces.ts             # Agent, Task, TaskResult, PoolConfig, etc.
├── index.ts                  # Public barrel export
├── workers/
│   └── TaskWorker.ts         # Worker thread script: receives tasks, executes, returns results
└── isolation.test.ts         # T-ISO: orchestrator imports ONLY from src/types/
```

The separation of concerns is critical:
- **AgentPool**: async lifecycle only; no event bus, no llm_map, no component wiring.
- **EventBus**: pure event routing; no agents, no tasks, no component knowledge.
- **llm_map**: parallel dispatch; no components, no lifecycle, just task-to-worker mapping.
- **ComposeRootModule**: the ONLY place components are imported together.

### Pattern 1: Event Bus with Discriminated Unions

**What:** Subscribers register handlers for specific event types. The bus routes events to all registered handlers for that type. Event types are discriminated unions from `src/types/Events.ts` (SheafEvent, SOCEvent).

**When to use:** Anytime a component needs to broadcast state changes asynchronously to one or more consumers without tight coupling.

```typescript
// Source: Node.js EventEmitter pattern + discriminated union events
import { EventEmitter } from 'events';
import type { SheafEvent, SOCEvent } from '../types/Events.js';

export type AnyEvent = SheafEvent | SOCEvent;

export interface EventSubscriber {
  (event: AnyEvent): void | Promise<void>;
}

export class EventBus extends EventEmitter {
  // Map event type to array of subscribers
  readonly #subscribers: Map<string, EventSubscriber[]> = new Map();

  subscribe(eventType: string, handler: EventSubscriber): void {
    if (!this.#subscribers.has(eventType)) {
      this.#subscribers.set(eventType, []);
    }
    this.#subscribers.get(eventType)!.push(handler);
  }

  async emit(event: AnyEvent): Promise<void> {
    const handlers = this.#subscribers.get(event.type) ?? [];
    // All handlers run in parallel; use Promise.all() to await all
    await Promise.all(handlers.map((h) => Promise.resolve(h(event))));
  }

  unsubscribe(eventType: string, handler: EventSubscriber): void {
    const handlers = this.#subscribers.get(eventType);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }
}
```

**Anti-pattern:** Do NOT create per-component event buses. A single EventBus instance is the coordination point for the entire orchestrator.

### Pattern 2: Agent Pool with Async Lifecycle

**What:** A pool maintains N agent instances. Each agent has a `spawn()` lifecycle (initialization), `heartbeat()` keepalive, and `cleanup()` shutdown. The pool tracks agent status (active, idle, terminated) and coordinates lifecycle transitions.

**When to use:** Whenever you need to manage multiple concurrent workers with deterministic startup/shutdown semantics.

```typescript
// Source: Lifecycle management pattern for long-lived worker objects
export interface Agent {
  id: string;
  status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated';
  spawn(): Promise<void>;
  heartbeat(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface PoolConfig {
  poolSize: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export class AgentPool {
  readonly #config: PoolConfig;
  readonly #agents: Agent[] = [];
  #heartbeatTimer: NodeJS.Timer | null = null;
  #isShuttingDown = false;

  constructor(agentFactory: () => Agent, config: PoolConfig) {
    this.#config = config;
    for (let i = 0; i < config.poolSize; i++) {
      this.#agents.push(agentFactory());
    }
  }

  async initialize(): Promise<void> {
    // Spawn all agents in parallel
    await Promise.all(this.#agents.map((agent) => agent.spawn()));
    // Start heartbeat timer
    this.#heartbeatTimer = setInterval(
      () => this.#runHeartbeat(),
      this.#config.heartbeatIntervalMs
    );
  }

  async #runHeartbeat(): Promise<void> {
    const promises = this.#agents.map((agent) =>
      Promise.race([
        agent.heartbeat(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Heartbeat timeout')),
            this.#config.heartbeatTimeoutMs
          )
        ),
      ]).catch((err) => {
        console.error(`Agent ${agent.id} heartbeat failed:`, err);
        agent.status = 'terminated';
      })
    );
    await Promise.all(promises);
  }

  async shutdown(): Promise<void> {
    if (this.#isShuttingDown) return;
    this.#isShuttingDown = true;

    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    // Cleanup all agents in parallel
    await Promise.all(this.#agents.map((agent) => agent.cleanup()));
  }

  getAgents(): readonly Agent[] {
    return this.#agents;
  }

  getIdleAgents(): readonly Agent[] {
    return this.#agents.filter((agent) => agent.status === 'idle');
  }
}
```

**Anti-pattern:** Do NOT make agents responsible for their own heartbeat. The pool must coordinate heartbeats across all agents so that a single stuck agent doesn't block the others.

### Pattern 3: llm_map Primitive with Context Preservation

**What:** Dispatch N tasks to a worker pool, await results in original call order, preserve execution context across worker boundaries using `AsyncLocalStorage`.

**When to use:** Parallel execution of I/O-bound or CPU-bound tasks (LLM inference, text processing) with deterministic ordering guarantees.

```typescript
// Source: Worker thread pool + AsyncLocalStorage pattern
import { Worker } from 'worker_threads';
import { AsyncLocalStorage } from 'async_hooks';

export interface Task<T> {
  id: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface TaskResult<T> {
  taskId: string;
  success: boolean;
  result?: T;
  error?: Error;
}

export const contextStorage = new AsyncLocalStorage<Map<string, unknown>>();

export async function llm_map<T>(
  tasks: Task<T>[],
  workerScriptPath: string,
  poolSize: number = 4
): Promise<TaskResult<T>[]> {
  // Create a pool of worker threads
  const workers = Array.from({ length: poolSize }, () =>
    new Worker(workerScriptPath)
  );

  try {
    // Dispatch all tasks; track which task goes to which worker
    const taskPromises = tasks.map((task, index) => {
      const worker = workers[index % poolSize];
      return new Promise<TaskResult<T>>((resolve) => {
        const handler = (message: TaskResult<T>) => {
          if (message.taskId === task.id) {
            worker.off('message', handler);
            resolve(message);
          }
        };
        worker.on('message', handler);
        worker.on('error', (err) => {
          worker.off('message', handler);
          resolve({
            taskId: task.id,
            success: false,
            error: err,
          });
        });

        // Preserve context when sending to worker
        const context = contextStorage.getStore();
        worker.postMessage({
          task,
          context: context ? Object.fromEntries(context) : {},
        });
      });
    });

    // Await all tasks and return in original order
    const results = await Promise.all(taskPromises);
    return results.sort((a, b) => {
      const indexA = tasks.findIndex((t) => t.id === a.taskId);
      const indexB = tasks.findIndex((t) => t.id === b.taskId);
      return indexA - indexB;
    });
  } finally {
    // Cleanup: terminate all workers
    workers.forEach((w) => w.terminate());
  }
}
```

**Anti-pattern:** Do NOT assume worker execution order. Always map results back to original task IDs and re-sort before returning.

### Pattern 4: Composition Root — Single Entry Point

**What:** One module that imports Sheaf, LCM, TNA, and SOC, instantiates them with shared injectable dependencies (embedders, event bus), wires their event emissions together, and exports the fully-configured orchestrator.

**When to use:** Exactly once at the application level. All other modules import from this single entry point.

```typescript
// Source: Composition root pattern (Dependency Injection)
import { CellularSheaf, CohomologyAnalyzer } from '../sheaf/index.js';
import { LCMClient, ImmutableStore, EmbeddingCache } from '../lcm/index.js';
import { Preprocessor, CooccurrenceGraph, LouvainDetector } from '../tna/index.js';
import { SOCTracker } from '../soc/index.js';
import { EventBus } from './EventBus.js';
import type { IEmbedder } from '../lcm/interfaces.js';

export class Orchestrator {
  readonly eventBus: EventBus;
  readonly sheaf: CellularSheaf;
  readonly cohomologyAnalyzer: CohomologyAnalyzer;
  readonly lcmClient: LCMClient;
  readonly tnaPreprocessor: Preprocessor;
  readonly tnaGraph: CooccurrenceGraph;
  readonly tnaLouvain: LouvainDetector;
  readonly socTracker: SOCTracker;

  constructor(embedder: IEmbedder) {
    // 1. Create event bus (central coordination point)
    this.eventBus = new EventBus();

    // 2. Instantiate LCM (independent)
    const store = new ImmutableStore();
    const cache = new EmbeddingCache(embedder);
    this.lcmClient = new LCMClient(store, cache, embedder);

    // 3. Instantiate Sheaf (independent)
    this.sheaf = new CellularSheaf();
    this.cohomologyAnalyzer = new CohomologyAnalyzer();

    // 4. Instantiate TNA (independent)
    this.tnaPreprocessor = new Preprocessor();
    this.tnaGraph = new CooccurrenceGraph();
    this.tnaLouvain = new LouvainDetector();

    // 5. Instantiate SOC (independent)
    this.socTracker = new SOCTracker({ correlationWindowSize: 10 });

    // 6. Wire event emissions to event bus
    this.cohomologyAnalyzer.on('sheaf:consensus-reached', (event) =>
      this.eventBus.emit(event)
    );
    this.cohomologyAnalyzer.on('sheaf:h1-obstruction-detected', (event) =>
      this.eventBus.emit(event)
    );

    this.socTracker.on('soc:metrics', (event) => this.eventBus.emit(event));
    this.socTracker.on('phase:transition', (event) => this.eventBus.emit(event));

    // 7. Register event subscribers (e.g., logging, decisions, re-triggering)
    this.eventBus.subscribe('sheaf:consensus-reached', (event) => {
      console.log(`[ORCH] Sheaf consensus at iteration ${event.iteration}`);
    });
    this.eventBus.subscribe('soc:metrics', (event) => {
      console.log(
        `[ORCH] SOC metrics: CDP=${event.cdp.toFixed(3)}, SER=${event.surprisingEdgeRatio.toFixed(2)}`
      );
    });
  }

  async runReasoning(prompt: string): Promise<void> {
    // 1. Preprocess text via TNA
    const preprocessed = this.tnaPreprocessor.process(prompt);

    // 2. Build co-occurrence graph
    for (const token of preprocessed.tokens) {
      this.tnaGraph.addNode(token);
    }

    // 3. Run Louvain community detection
    const communities = this.tnaLouvain.detectCommunities(this.tnaGraph);

    // 4. Append context to LCM
    const entryId = await this.lcmClient.append(prompt);

    // 5. Run sheaf consensus (simplified)
    const cohomology = this.cohomologyAnalyzer.analyze(this.sheaf);

    // 6. Compute SOC metrics (simplified)
    const socInputs = {
      nodeCount: this.tnaGraph.order,
      edges: Array.from(this.tnaGraph.getEdges()),
      embeddings: new Map(), // Would be populated from embedder
      communityAssignments: new Map(),
      newEdges: [],
      iteration: 1,
    };
    this.socTracker.computeAndEmit(socInputs);

    // Events are automatically emitted and routed via eventBus
  }
}
```

**Anti-pattern:** Do NOT create dependency injection containers that hide wiring. The Composition Root should be explicit and readable — you should be able to see exactly which components are instantiated and how they're wired together.

---

## Integration Points

### From Phase 1: Sheaf-Theoretic Coordination

**What the orchestrator needs:**
- `CellularSheaf` instance (manages graph structure and restriction maps)
- `CohomologyAnalyzer` instance (computes H^0, H^1, emits consensus and obstruction events)
- Event subscriptions: `'sheaf:consensus-reached'` and `'sheaf:h1-obstruction-detected'`

**No changes to Phase 1:** The sheaf module is complete. Import its public barrel export (`src/sheaf/index.ts`) and wire its EventEmitter into the central EventBus.

### From Phase 2: LCM Dual-Memory Architecture

**What the orchestrator needs:**
- `LCMClient` instance (single write path for context append with embedding caching)
- `ImmutableStore` instance (read access for context retrieval)
- `lcm_expand()` function for hierarchical context unrolling
- `lcm_grep()` for semantic context search

**No changes to Phase 2:** The LCM module is complete. The Orchestrator creates a fresh `LCMClient` with an injected `IEmbedder` and stores results via `append()`.

### From Phase 3: Text Network Analysis + Molecular-CoT

**What the orchestrator needs:**
- `Preprocessor` instance (tokenization, lemmatization, TF-IDF filtering)
- `CooccurrenceGraph` instance (4-gram sliding window, edge co-occurrence weights)
- `LouvainDetector` instance (community detection for gap metrics)
- `CentralityAnalyzer` instance (optional: betweenness centrality for bridge nodes)
- `GapDetector` instance (structural gap analysis for Molecular-CoT bridging)

**No changes to Phase 3:** The TNA module is complete. The Orchestrator instantiates each component in sequence and passes outputs to SOC (e.g., community assignments, embeddings, graph structure).

### From Phase 4: Self-Organized Criticality Tracking

**What the orchestrator needs:**
- `SOCTracker` instance (computes five SOC metrics each iteration)
- Event subscriptions: `'soc:metrics'` and `'phase:transition'`

**No changes to Phase 4:** The SOC module is complete. The Orchestrator populates `SOCInputs` from TNA outputs (graph structure, embeddings, community assignments) and calls `socTracker.computeAndEmit(inputs)` each iteration.

### Cross-Module Data Flow

```
TNA Pipeline:
  Preprocessor.process()
    → tokenized + lemmatized text

CooccurrenceGraph.addNode()
  → TextNode with TF-IDF weight

CooccurrenceGraph.addEdge()
  → TextEdge with createdAtIteration timestamp

LouvainDetector.detectCommunities()
  → CommunityAssignment for each node

SOC Pipeline (receives from TNA):
  SOCTracker.computeAndEmit({
    nodeCount: graph.order,
    edges: Array.from(graph.edges),
    embeddings: Map<TextNodeId, Float64Array>,
    communityAssignments: Map<TextNodeId, number>,
    newEdges: edges with createdAtIteration === current,
    iteration: orchestrator iteration counter
  })
    → SOCMetricsEvent emitted to EventBus
    → SOCPhaseTransitionEvent emitted when correlation sign changes

EventBus:
  Routes all events to registered subscribers
  (Orchestrator logic, dashboards, decision-making, etc.)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event routing between components | Custom callback map | `EventBus` with EventEmitter base class | EventEmitter is the Node.js standard; hand-rolled systems miss edge cases (unsubscribe, async error handling, ordering guarantees) |
| Agent lifecycle coordination | Custom state machine | `AgentPool` with explicit state transitions and heartbeat timer | State machines are error-prone (missing transitions, deadlocks); explicit lifecycle methods are clearer and testable |
| Worker thread pooling | Custom worker spawn/management | `node:worker_threads` + `llm_map` wrapper | Custom pooling risks thread leaks, context loss, and ordering violations; built-in workers have battle-tested lifecycle management |
| Dependency injection | Hand-wired class instantiation | `ComposeRootModule` with explicit constructor injection | Explicit wiring is verbose but reveals dependencies; hidden DI (containers, globals) masks tight coupling |
| Parallel task dispatch with ordering | Manual promise array handling | `llm_map` with task ID mapping and sort | Manual dispatch loses track of which result belongs to which task; llm_map sorts results by original order |
| Context propagation across async boundaries | Manual context threading | `AsyncLocalStorage` from `node:async_hooks` | Manual threading loses context on worker spawning; AsyncLocalStorage is the standard mechanism in Node.js for async context |

**Key insight:** Phase 5 integrates existing modules, not new ones. The temptation to hand-roll "simpler" versions of EventBus or AgentPool will introduce subtle bugs (missed events, orphaned agents, dropped errors). Use the patterns documented here.

---

## Common Pitfalls

### Pitfall 1: Circular Component Dependencies in Orchestrator

**What goes wrong:** The orchestrator wires Sheaf, LCM, TNA, and SOC together. If SOC tries to import from TNA directly (outside of orchestrator), and TNA imports from LCM (outside of orchestrator), a subtle circular dependency can form through the orchestrator's imports.

**Why it happens:** Module isolation is disciplined. Under pressure to integrate, developers skip it and let modules import from each other.

**How to avoid:**
- Run the isolation test suite in every module: `src/*/isolation.test.ts`
- These tests verify zero cross-imports (except orchestrator importing all four)
- Add pre-commit hook: `npm test -- isolation.test.ts` must pass before committing

**Warning signs:**
- TypeScript compile error "Circular dependency detected" (rare in Node.js but happens with strict configurations)
- A module's isolation.test.ts fails (explicit guard test)
- You need to `import ... from '../some-other-module'` in a Phase 1-4 module

### Pitfall 2: EventBus Subscriber Never Unsubscribes, Leaks Events

**What goes wrong:** A subscriber registers for `'soc:metrics'` events but never unsubscribes. If the orchestrator runs many reasoning rounds, events accumulate and subscribers are called multiple times per event (exponential blowup).

**Why it happens:** EventEmitter pattern requires explicit `unsubscribe()` calls. Forgetting them is a classic memory leak in event systems.

**How to avoid:**
- Always pair `subscribe()` with corresponding `unsubscribe()` in cleanup paths
- Store subscription function references so they can be unsubscribed later:
  ```typescript
  const metricsHandler = (event: SOCMetricsEvent) => { /* ... */ };
  this.eventBus.subscribe('soc:metrics', metricsHandler);
  // Later, in shutdown:
  this.eventBus.unsubscribe('soc:metrics', metricsHandler);
  ```
- Test: verify subscriber count decreases after unsubscribe

**Warning signs:**
- Memory usage increases with each reasoning round (not per-task, but per orchestrator instance)
- Test logs show the same event firing multiple times in a single round
- `eventBus.getSubscriberCount('soc:metrics')` returns > 1 unexpectedly

### Pitfall 3: Worker Thread Context Loss on Task Dispatch

**What goes wrong:** A task includes a reference to an object that was created in the main thread's context. The worker thread receives the task, tries to use the context object, and gets `undefined` or a shallow copy with no methods.

**Why it happens:** Worker threads have separate heap memory. Complex objects (functions, instances, circular references) cannot be serialized to the worker. Only primitive types and plain objects survive `postMessage()`.

**How to avoid:**
- Serialize context explicitly before passing to worker:
  ```typescript
  // BAD: passing a class instance
  worker.postMessage({ task, contextObject: myInstance }); // myInstance becomes {}

  // GOOD: serialize to plain object
  const contextData = {
    userId: myInstance.userId,
    sessionId: myInstance.sessionId,
    // Only primitives and plain data
  };
  worker.postMessage({ task, context: contextData });
  ```
- Document what context data is available in `TaskWorker.ts`
- Test with `typeof` checks in worker script to catch serialization failures

**Warning signs:**
- Worker receives undefined values for context fields
- Methods on context objects are missing in worker
- `llm_map` tests fail with "object has no method" errors

### Pitfall 4: AgentPool Heartbeat Blocks All Other Agents

**What goes wrong:** One agent's `heartbeat()` call hangs or times out. The heartbeat loop awaits all agents in parallel with `Promise.all()`, but if one hangs, the entire pool is stuck waiting.

**Why it happens:** Using `Promise.all()` without per-agent timeouts means one slow agent delays heartbeat checks for all others.

**How to avoid:**
- Wrap each agent's heartbeat in a race against a timeout promise:
  ```typescript
  const heartbeatWithTimeout = Promise.race([
    agent.heartbeat(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Heartbeat timeout')),
        this.#config.heartbeatTimeoutMs
      )
    ),
  ]);
  ```
- Mark timed-out agents as terminated so they don't hold up the pool
- Log and monitor heartbeat failures per agent ID

**Warning signs:**
- Heartbeat interval increases over time (one stuck agent delays the next heartbeat)
- Logs show only some agents being checked per heartbeat cycle
- Pool status shows all agents as "idle" even though one is actually hanging

### Pitfall 5: Partial Worker Failure Results in Corrupted Output Order

**What goes wrong:** One worker crashes during task processing. `llm_map` returns a mix of successful results and error objects. Caller assumes all results are successful and tries to index into them by original task order — but the error object doesn't have the expected result fields.

**Why it happens:** `llm_map` must handle partial failures gracefully but return all results (not just successes) so the caller can decide what to do.

**How to avoid:**
- Always check `TaskResult.success` before accessing `result` field:
  ```typescript
  const results = await llm_map(tasks, workerScriptPath);
  for (const result of results) {
    if (result.success) {
      // Process result.result
    } else {
      // Handle result.error
    }
  }
  ```
- Never assume all results are successful just because `llm_map` resolved
- Test partial failure scenarios explicitly (1 success + 1 failure in pool of 4)

**Warning signs:**
- Tests pass with all-success case but fail with mixed success/failure
- Logs show "Cannot read property 'field' of undefined" after worker errors
- Caller code doesn't check `success` field before accessing results

### Pitfall 6: Orchestrator Couples to Specific Agent Implementation

**What goes wrong:** The orchestrator hardcodes assumptions about agent type (e.g., "all agents are LLM-based reasoners"). A test tries to use a different agent type and the orchestrator breaks.

**Why it happens:** The orchestrator should accept any object conforming to the `Agent` interface; instead, it checks `instanceof MySpecificAgent`.

**How to avoid:**
- Define a minimal `Agent` interface with only the methods orchestrator needs (spawn, heartbeat, cleanup)
- Accept agents as constructor arguments or factory functions, not by hardcoded class
- Test with a `MockAgent` that implements the interface but is a simple stub

**Warning signs:**
- Orchestrator imports a specific agent class from `src/agents/SpecificAgent.ts`
- Test setup requires creating instances of that specific class
- Adding a new agent type requires modifying orchestrator code

---

## Code Examples

### Pattern: Subscribe to Event Bus

```typescript
// Source: EventBus subscription pattern
import { Orchestrator } from './orchestrator/index.js';
import type { SOCMetricsEvent } from './types/Events.js';

const orchestrator = new Orchestrator(embedder);

// Subscribe to SOC metrics events
const handleMetrics = (event: SOCMetricsEvent) => {
  console.log(`[SOC] Iteration ${event.iteration}`);
  console.log(`  Von Neumann Entropy: ${event.vonNeumannEntropy.toFixed(4)}`);
  console.log(`  Embedding Entropy: ${event.embeddingEntropy.toFixed(4)}`);
  console.log(`  CDP: ${event.cdp.toFixed(4)}`);
  console.log(`  Surprising Edge Ratio: ${event.surprisingEdgeRatio.toFixed(2)}`);
  console.log(`  Phase Transition: ${event.isPhaseTransition}`);
};

orchestrator.eventBus.subscribe('soc:metrics', handleMetrics);

// Run reasoning
await orchestrator.runReasoning('Some prompt');

// Unsubscribe when done
orchestrator.eventBus.unsubscribe('soc:metrics', handleMetrics);
```

### Pattern: Parallel Task Dispatch with Context

```typescript
// Source: llm_map usage for parallel LLM inference
import { llm_map } from './orchestrator/llm_map.js';
import type { Task, TaskResult } from './orchestrator/interfaces.js';

const tasks: Task<string>[] = [
  { id: 'task-1', payload: { prompt: 'What is X?' } },
  { id: 'task-2', payload: { prompt: 'What is Y?' } },
  { id: 'task-3', payload: { prompt: 'What is Z?' } },
];

// Dispatch to worker pool (4 workers, processes all 3 tasks in parallel)
const results = await llm_map(
  tasks,
  new URL('./orchestrator/workers/TaskWorker.ts', import.meta.url).pathname,
  4 // pool size
);

// Results are returned in original task order
for (const result of results) {
  if (result.success) {
    console.log(`Task ${result.taskId}: ${result.result}`);
  } else {
    console.error(`Task ${result.taskId} failed:`, result.error);
  }
}
```

### Pattern: Agent Pool Lifecycle

```typescript
// Source: AgentPool spawn/heartbeat/cleanup cycle
import { AgentPool } from './orchestrator/AgentPool.js';
import type { Agent } from './orchestrator/interfaces.js';

// Define a simple agent type
class ReasoningAgent implements Agent {
  id: string;
  status: 'spawning' | 'active' | 'idle' | 'terminating' | 'terminated' =
    'spawning';

  constructor(id: string) {
    this.id = id;
  }

  async spawn(): Promise<void> {
    console.log(`Agent ${this.id} spawning...`);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate init
    this.status = 'active';
    console.log(`Agent ${this.id} active`);
  }

  async heartbeat(): Promise<void> {
    if (this.status === 'active' || this.status === 'idle') {
      // Perform any periodic checks
      this.status = 'idle';
    }
  }

  async cleanup(): Promise<void> {
    console.log(`Agent ${this.id} cleaning up...`);
    this.status = 'terminating';
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate cleanup
    this.status = 'terminated';
    console.log(`Agent ${this.id} terminated`);
  }
}

// Create pool
const pool = new AgentPool(
  () => new ReasoningAgent(`agent-${Math.random()}`),
  {
    poolSize: 4,
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 2000,
  }
);

// Initialize (spawns all agents, starts heartbeat timer)
await pool.initialize();

// Use agents...
const idleAgents = pool.getIdleAgents();
console.log(`${idleAgents.length} agents ready`);

// Shutdown (terminates all agents, stops heartbeat)
await pool.shutdown();
```

### Pattern: Composition Root Integration

```typescript
// Source: Orchestrator wiring all four modules together
import { Orchestrator } from './orchestrator/ComposeRootModule.js';
import { TransformersEmbedder } from './lcm/TransformersEmbedder.js';

// Get real embedder
const embedder = await TransformersEmbedder.getInstance();

// Instantiate orchestrator with all modules wired
const orchestrator = new Orchestrator(embedder);

// All components are now accessible and event-connected
console.log('Orchestrator ready:');
console.log('  - Sheaf:', orchestrator.sheaf);
console.log('  - LCM:', orchestrator.lcmClient);
console.log('  - TNA:', orchestrator.tnaGraph);
console.log('  - SOC:', orchestrator.socTracker);
console.log('  - EventBus:', orchestrator.eventBus);

// Run a reasoning round
await orchestrator.runReasoning('Why is the sky blue?');
// Events are automatically emitted and routed

// Cleanup
await orchestrator.shutdown();
```

---

## Trade-offs & Decisions

### Trade-off 1: Module Isolation vs. Direct Imports

**Decision:** Strict module isolation (each Phase 1-4 module has zero cross-imports; only orchestrator imports all four).

**Why:** Circular dependency risk is eliminated. Each module can be tested and deployed independently. Orchestrator is the only place where integration tests needed.

**Cost:** Orchestrator has verbose wiring code (instantiates each module, wires their event emissions manually). For 4 modules this is acceptable; for 20+ modules this would be unmaintainable.

**When to revisit:** If Phase 6+ adds 5+ new modules with cross-module dependencies, consider a lightweight DI container to reduce wiring boilerplate.

### Trade-off 2: EventBus Asynchronous Dispatch vs. Synchronous

**Decision:** EventBus.emit() is async; all subscribers run in parallel via `Promise.all()`.

**Why:** SOC metrics are computed every iteration; a slow event handler (e.g., writing to disk) should not block other subscribers. Async dispatch scales better.

**Cost:** Caller must `await` `eventBus.emit()`. If a subscriber throws an error, `Promise.all()` rejects immediately, potentially losing other subscribers' results.

**When to revisit:** If a critical event handler fails and should not prevent others from running, switch to `Promise.allSettled()` and log failures separately.

### Trade-off 3: Agent Pool with Worker Threads vs. Simple Async Pool

**Decision:** Use `node:worker_threads` for parallel task dispatch (CPU-bound work, isolation). Could have used plain async function pool for I/O-bound tasks only.

**Why:** Worker threads provide true parallelism (not limited by JavaScript event loop). Safe for LLM inference (often CPU-bound embedding/tokenization). Built-in library, zero dependencies.

**Cost:** Worker threads have memory overhead (separate heap per worker). For small pool sizes (≤4), this is negligible. For very large pools (100+), would need a more efficient pooling strategy.

**When to revisit:** If benchmarks show memory overhead is unacceptable, switch to async-only pool with backpressure queuing (simpler but event-loop-limited).

### Trade-off 4: Context Serialization in llm_map vs. Shared Memory

**Decision:** Context is serialized via `postMessage()` (copied to worker). Alternative: use `SharedArrayBuffer` for zero-copy context.

**Why:** Serialization is simpler and safer (no concurrent access bugs). `SharedArrayBuffer` requires exact memory alignment and synchronization primitives. For Phase 5 context sizes (typically < 1MB), serialization overhead is acceptable.

**Cost:** Each task incurs serialization latency (~1-10ms depending on context size). For 100+ parallel tasks, latency adds up.

**When to revisit:** If benchmarks show serialization is the bottleneck, switch to `SharedArrayBuffer` for large context objects (requires careful locking to avoid race conditions).

### Trade-off 5: EventEmitter vs. RxJS Observables

**Decision:** Use Node.js `EventEmitter` (simple, built-in). Alternative: RxJS Observables (more powerful, composable operators).

**Why:** EventEmitter is the Node.js standard and sufficient for Phase 5's event routing needs. RxJS would require a new dependency and learning curve.

**Cost:** No operator composition (can't easily do `merge()`, `filter()`, `map()` on event streams). If events need complex pipelines, RxJS would be better.

**When to revisit:** If event routing logic becomes complex (e.g., "emit new event if three consecutive `soc:metrics` events show increasing CDP"), refactor to RxJS.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom callback maps for events | Node.js `EventEmitter` + `on()`/`off()` pattern | Node 0.10+ (standard) | Eliminates need to manage callback arrays manually; handles unsubscribe cleanup automatically |
| Spawning OS processes for parallelism | Node.js `worker_threads` (ES2022) | Node 10+ | True parallelism without OS process overhead; shared memory via `SharedArrayBuffer` optional |
| Manual thread pool management | `node:worker_threads` with graceful lifecycle | Node 18+ | Built-in API; no external pooling libraries needed |
| Implicit async context (rely on `this` binding) | `AsyncLocalStorage` from `node:async_hooks` | Node 12.17+ | Explicit context propagation across async boundaries; used by major frameworks (Express.js middleware, Next.js, etc.) |
| Single-threaded event loop | Hybrid: event loop + worker threads | Node 10+ | Main thread handles I/O and coordination; workers handle CPU-bound tasks (inference, transformation) |

**Deprecated/outdated:**
- **Custom EventEmitter implementations** — Node.js EventEmitter is the standard; hand-rolled callbacks are error-prone
- **OS process forking for parallelism** — Worker threads are lighter and share memory more efficiently
- **Hardcoded dependency instantiation** — Composition root / dependency injection is now the standard pattern
- **Promise.all() without error handling** — Should use `Promise.allSettled()` if partial failures are acceptable

---

## Open Questions

1. **Should AgentPool support dynamic pool resizing?**
   - What we know: Phase 5 spec assumes fixed pool size
   - What's unclear: Will reasoning workloads benefit from scaling agents up/down based on queue depth?
   - Recommendation: Start with fixed pool size (simpler); add dynamic resizing in Phase 6 if needed

2. **Should EventBus guarantee event ordering?**
   - What we know: Current design runs all subscribers in parallel via `Promise.all()`
   - What's unclear: If subscriber A depends on subscriber B finishing first, does ordering matter?
   - Recommendation: Document that subscribers run in parallel (no ordering guarantee); if order matters, manually sequence in subscriber logic or refactor to sequential subscriptions

3. **What context data should be available to llm_map workers?**
   - What we know: Context is serializable (primitives + plain objects)
   - What's unclear: Should workers have access to global state (cached embeddings, graph data)? Or only task-specific data?
   - Recommendation: Start with task-specific context only (cleaner isolation); use ComposeRootModule to make global data available if needed

4. **How should partial worker failures be handled?**
   - What we know: llm_map returns mixed success/error results
   - What's unclear: Should orchestrator retry failed tasks? Apply exponential backoff? Mark failed agents as "sick"?
   - Recommendation: Return all results (success + error) and let caller decide retry strategy; add simple retry wrapper in Phase 6 if common pattern emerges

5. **Should Orchestrator expose the four modules' internals or only provide high-level methods?**
   - What we know: ComposeRootModule instantiates all four and wires them
   - What's unclear: Should external code be able to call `orchestrator.tnaGraph.getEdges()` directly, or only through orchestrator methods?
   - Recommendation: Expose internal modules for flexibility (tests need direct access); document that direct module access bypasses orchestration logic

---

## Sources

### Primary (HIGH confidence)

- **Existing codebase analysis** — Examined all Phase 1-4 module structures:
  - `src/sheaf/CohomologyAnalyzer.ts` — EventEmitter pattern for event emission
  - `src/lcm/LCMClient.ts` — Dependency injection pattern (IEmbedder interface)
  - `src/soc/SOCTracker.ts` — EventEmitter extension, lifecycle coordination
  - `src/types/Events.ts` — Discriminated union event types (SheafEvent, SOCEvent)

- **Node.js built-in APIs** — Verified support for:
  - `node:events` (EventEmitter) — Standard since Node 0.10; fully stable
  - `node:worker_threads` (Worker) — Stable since Node 10; ES2022 async_hooks support in Node 18+
  - `node:async_hooks` (AsyncLocalStorage) — Stable since Node 12.17

- **TypeScript configuration** — Project uses ES2022 target with NodeNext module resolution; all APIs are native

### Secondary (MEDIUM confidence)

- **Worker threads best practices** — Multiple sources confirm:
  - Context serialization via `postMessage()` is standard approach
  - Per-task timeouts prevent pool-wide hangs
  - Worker thread memory overhead is acceptable for poolSize ≤ 4

- **Event-driven architecture patterns** — EventEmitter + discriminated unions is the Node.js standard for event routing

### Tertiary (LOW confidence — flagged for validation)

- **Dynamic pool resizing** — Not yet researched; placeholder for Phase 6 decision
- **EventBus ordering guarantees** — Current design is parallel-by-default; serial ordering would require rework

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — All dependencies are Node.js built-ins or already installed
- Architecture patterns: **HIGH** — EventEmitter, worker threads, and dependency injection are well-established Node.js patterns
- Integration points: **HIGH** — Examined all Phase 1-4 code and module boundaries
- Trade-offs: **MEDIUM** — Decisions are based on Phase 5 requirements and Phase 1-4 design; some trade-offs (e.g., dynamic pool resizing) deferred to Phase 6

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable APIs; EventEmitter/worker_threads unlikely to change)
