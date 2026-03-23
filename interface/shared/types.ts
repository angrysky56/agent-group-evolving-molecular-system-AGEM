/**
 * Shared types between AGEM backend and frontend.
 * Single source of truth for all API contracts.
 */

/* ─── LLM Provider Types ─── */

/** Supported LLM provider identifiers. */
export type LLMProviderType = "ollama" | "openrouter" | "anthropic";

/** Model information returned by provider APIs. */
export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProviderType;
  context_length: number;
  description?: string;
  type?: "chat" | "embedding";
  pricing?: {
    prompt: string;
    completion: string;
  };
  supports_tools?: boolean;
}

/* ─── Chat Types ─── */

/** Role of a message participant. */
export type MessageRole = "user" | "assistant" | "system";

/** A single chat message. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
}

/** Optional metadata attached to a message. */
export interface MessageMetadata {
  model?: string;
  provider?: LLMProviderType;
  tokens_used?: number;
  thinking?: string;
  artifacts?: Artifact[];
  agem_state?: AgemStateSnapshot;
}

/** An artifact generated during AGEM processing. */
export interface Artifact {
  id: string;
  type:
    | "report"
    | "analysis"
    | "graph_snapshot"
    | "agent_summary"
    | "code"
    | "markdown";
  title: string;
  content: string;
  path?: string;
}

/* ─── Session Types ─── */

/** A chat session summary (list view). */
export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages?: ChatMessage[];
  model?: string;
  provider?: LLMProviderType;
}

/* ─── AGEM State Types ─── */

/** Snapshot of the AGEM engine state for UI rendering. */
export interface AgemStateSnapshot {
  agent_count: number;
  sheaf_energy: number;
  gap_count: number;
  iteration: number;
  communities: number;
  operational_state?: "NORMAL" | "OBSTRUCTED" | "CRITICAL";
  graph_summary?: GraphSummary;
  soc?: SOCSnapshot;
  cohomology?: CohomologySnapshot;
  regime?: {
    regime: string;
    cdp_variance: number;
    correlation_consistency: number;
    persistence_iterations: number;
  };
  lumpability?: {
    weak_compression_rate: number;
    avg_entropy_preservation: number;
    last_classification: "strong" | "weak" | "degenerate" | null;
  };
  evolution?: {
    selection: number;
    transmission: number;
    total_change: number;
    explore_exploit_ratio: number;
    learning_rate: number;
    mean_fitness: number;
    population_size: number;
  };
}

/* ─── AGEM Tool Response Types ─── */

/** Sheaf cohomology analysis snapshot. */
export interface CohomologySnapshot {
  h0_dimension: number;
  h1_dimension: number;
  has_obstruction: boolean;
  coboundary_rank: number;
  tolerance: number;
}

/** SOC metrics snapshot with regime analysis. */
export interface SOCSnapshot {
  latest: {
    iteration: number;
    von_neumann_entropy: number;
    embedding_entropy: number;
    cdp: number;
    surprising_edge_ratio: number;
    correlation_coefficient: number;
    is_phase_transition: boolean;
  } | null;
  regime: {
    regime: string;
    cdp_variance: number;
    correlation_consistency: number;
    persistence_iterations: number;
  } | null;
  trend: { mean: number; slope: number; window: number };
  history_length: number;
  history?: Array<{
    iteration: number;
    von_neumann_entropy: number;
    embedding_entropy: number;
    cdp: number;
    surprising_edge_ratio: number;
    correlation_coefficient: number;
    is_phase_transition: boolean;
  }>;
}

/** Structural gap between two communities. */
export interface GapSnapshot {
  community_a: number;
  community_b: number;
  density: number;
  shortest_path: number;
  modularity_delta: number;
  bridge_nodes: string[];
}

/** A catalyst bridging question generated for a gap. */
export interface CatalystQuestionResult {
  gap_id: string;
  question_text: string;
  seed_node_a: string;
  seed_node_b: string;
  semantic_distance: number;
  priority: number;
}

/** A context search result from LCMGrep. */
export interface ContextSearchResult {
  entry_id: string;
  content: string;
  similarity: number;
  timestamp: number;
}

/** Summary of the graph for visualization. */
export interface GraphSummary {
  node_count: number;
  edge_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Concept-level graph — communities as super-nodes. */
  concept_graph?: ConceptGraphSummary;
}

export interface GraphNode {
  id: string;
  label: string;
  community?: number;
  x?: number;
  y?: number;
  size?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
}

/** A named concept community (aggregated from word-level TNA nodes). */
export interface ConceptCommunitySummary {
  id: number;
  label: string;
  top_nodes: string[];
  members: string[];
  size: number;
  internal_weight: number;
  avg_tfidf: number;
  max_centrality: number;
}

/** An edge between two concept communities (aggregated inter-community links). */
export interface ConceptEdgeSummary {
  source: number;
  target: number;
  edge_count: number;
  total_weight: number;
  avg_weight: number;
}

/** Concept-level graph summary — communities as super-nodes. */
export interface ConceptGraphSummary {
  communities: ConceptCommunitySummary[];
  edges: ConceptEdgeSummary[];
  modularity: number;
  total_nodes: number;
  total_edges: number;
  text_summary: string;
}

/* ─── SSE Event Types ─── */

/** Server-Sent Event types for streaming chat. */
export type SSEEventType =
  | "token"
  | "thinking"
  | "artifact"
  | "agem_state"
  | "error"
  | "done"
  | "usage";

/** System event types streamed via /system/events SSE endpoint. */
export type SystemEventType =
  | "soc:metrics"
  | "phase:transition"
  | "regime:classification"
  | "sheaf:consensus-reached"
  | "sheaf:h1-obstruction-detected"
  | "lumpability:audit-complete"
  | "lumpability:weak-compression"
  | "soc:system1-early-convergence"
  | "orch:vdw-agent-spawned"
  | "orch:vdw-agent-complete"
  | "tna:catalyst-questions-generated"
  | "evolution:price-decomposition"
  | "agem:state-update";

/** A system event for the dashboard event log. */
export interface SystemEvent {
  id: string;
  type: SystemEventType;
  timestamp: number;
  iteration?: number;
  severity: "info" | "warning" | "critical" | "success";
  summary: string;
  data?: Record<string, unknown>;
}

/** Unified SSE event shape (backend sends these as `data:` lines). */
export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  metadata?: Record<string, unknown>;
}

/* ─── System Types ─── */

/** System configuration exposed via API. */
export interface SystemConfig {
  provider: LLMProviderType;
  model: string;
  embedding_model: string;
  ollama_base_url: string;
  openrouter_base_url: string;
  knowledge_base_path: string;
  /** True when the backend already has an API key from the environment (never exposes the key itself). */
  has_api_key?: boolean;
}

/** System status health check. */
export interface SystemStatus {
  status: "ok" | "degraded" | "error";
  uptime_seconds: number;
  provider: LLMProviderType;
  model: string;
  agem_engine: boolean;
}

/* ─── Knowledge Base Types ─── */

/** A file entry in the knowledge base. */
export interface KnowledgeFile {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: KnowledgeFile[];
}

/* ─── API Request/Response Types ─── */

export interface ChatRequest {
  message: string;
  session_id?: string;
  model?: string;
  provider?: LLMProviderType;
}

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  provider?: LLMProviderType;
}
