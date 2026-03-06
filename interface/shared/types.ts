/**
 * Shared types between AGEM backend and frontend.
 * Single source of truth for all API contracts.
 */

/* ─── LLM Provider Types ─── */

/** Supported LLM provider identifiers. */
export type LLMProviderType = "ollama" | "openrouter";

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
  graph_summary?: GraphSummary;
}

/** Summary of the graph for visualization. */
export interface GraphSummary {
  node_count: number;
  edge_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
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
