/**
 * src/orchestrator/index.ts
 *
 * Public barrel export for the Orchestrator module (Phase 5).
 *
 * This is the ONLY module that imports from src/sheaf, src/lcm, src/tna, and src/soc
 * simultaneously (via ComposeRootModule.ts). All other modules maintain strict
 * independence, verified by isolation.test.ts.
 *
 * Exports:
 *   - Orchestrator: Main composition root wiring all four AGEM modules
 *   - ObstructionHandler: H^1 obstruction → gapDetector spawn pipeline (ROADMAP #3)
 *   - OrchestratorState: Three-mode state machine enum (NORMAL/OBSTRUCTED/CRITICAL)
 *   - OrchestratorStateManager: State machine driven by H^1 dimension metrics
 *   - EventBus: Async event coordination bus (ORCH-04)
 *   - AgentPool: Agent lifecycle management pool (ORCH-01)
 *   - llm_map: Parallel task dispatch with order preservation (ORCH-02)
 *   - contextStorage: AsyncLocalStorage for context propagation
 *   - Supporting types: Agent, PoolConfig, Task, TaskResult, AnyEvent, etc.
 *
 * Usage:
 *   import { Orchestrator } from 'src/orchestrator/index.js';
 *   const embedder = new MyEmbedder();
 *   const orch = new Orchestrator(embedder);
 *   await orch.runReasoning('What is the relationship between X and Y?');
 */
export { Orchestrator } from "./ComposeRootModule.js";
export { ObstructionHandler } from "./ObstructionHandler.js";
export type { GapFillResult } from "./ObstructionHandler.js";
export { OrchestratorState, OrchestratorStateManager, } from "./OrchestratorState.js";
export type { StateChangeEvent } from "./OrchestratorState.js";
export { EventBus } from "./EventBus.js";
export { AgentPool } from "./AgentPool.js";
export { llm_map, contextStorage, formatTaskForWorker } from "./llm_map.js";
export type { WorkerInboundMessage, WorkerOutboundMessage } from "./llm_map.js";
export { VdWAgentSpawner, VdWAgent } from "./VdWAgentSpawner.js";
export type { VdWSpawnParams, VdWSpawnerConfig } from "./VdWAgentSpawner.js";
export type { Agent, PoolConfig, Task, TaskResult, AnyEvent, EventSubscriber, } from "./interfaces.js";
export type { IEmbedder } from "../lcm/interfaces.js";
//# sourceMappingURL=index.d.ts.map