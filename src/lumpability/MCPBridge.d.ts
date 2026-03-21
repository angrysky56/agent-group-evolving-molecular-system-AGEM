/**
 * MCPBridge.ts — Bridge between AGEM's internal lumpability auditing and
 * external MCP servers for cross-session coordination.
 *
 * Maps LumpabilityAuditor events to MCP tool calls:
 *   - sheaf-consistency-enforcer: registers pre/post compaction states as
 *     agent stalks, enabling H^1 obstruction detection across sessions.
 *   - verifier-graph: logs audit results as provenance nodes for reasoning
 *     chain traceability.
 *   - hipai-montague: registers invariant beliefs that should survive
 *     compaction — if post-compaction state can't support them, that's a
 *     weak lumpability violation.
 *
 * Architecture:
 *   MCPBridge subscribes to LumpabilityAuditor events and translates them
 *   into MCP tool calls. It does NOT import MCP client libraries directly —
 *   it accepts an injectable IMCPClient interface that the host application
 *   provides. This keeps the AGEM core dependency-free from MCP transport.
 *
 * Isolation: imports from ./interfaces only. The IMCPClient is injected.
 */
import type { AuditResult } from "./interfaces.js";
/**
 * IMCPToolCall — a single MCP tool invocation.
 * Generic enough to map to any MCP transport (stdio, SSE, HTTP).
 */
export interface IMCPToolCall {
    readonly server: string;
    readonly tool: string;
    readonly args: Record<string, unknown>;
}
/**
 * IMCPClient — injectable MCP client interface.
 * Host application provides the concrete implementation.
 */
export interface IMCPClient {
    /** Execute a tool call on a named MCP server. */
    callTool(call: IMCPToolCall): Promise<unknown>;
    /** Check if a server is connected and available. */
    isConnected(server: string): boolean;
}
/**
 * MCPBridge — translates lumpability audit events into MCP tool calls.
 *
 * Usage:
 *   const bridge = new MCPBridge(mcpClient);
 *   auditor.on('lumpability:audit-complete', (r) => bridge.onAuditComplete(r));
 *   auditor.on('lumpability:weak-compression', (r) => bridge.onWeakCompression(r));
 */
export declare class MCPBridge {
    #private;
    constructor(client: IMCPClient);
    /**
     * onAuditComplete — register the audit result with sheaf-consistency-enforcer.
     *
     * Maps the auditor's entropy metrics to an agent state registration,
     * treating the compaction boundary as a sheaf edge between
     * "pre-compaction" and "post-compaction" agent stalks.
     */
    onAuditComplete(result: AuditResult): Promise<void>;
    /**
     * onWeakCompression — handle weak lumpability detection across MCP servers.
     *
     * Three-pronged response:
     *   1. verifier-graph: log a provenance node recording the weak compression
     *      event, enabling reasoning chain traceability (which compaction broke what).
     *   2. hipai-montague: register the weak compression as a belief to be tracked,
     *      enabling cross-session invariant checking.
     *   3. sheaf-consistency-enforcer: set restriction maps between the compaction
     *      agent and reasoning agents, so the H^1 obstruction detection can catch
     *      downstream inconsistencies caused by information loss.
     */
    onWeakCompression(result: AuditResult): Promise<void>;
    /**
     * checkClosureStatus — query sheaf-consistency-enforcer for current closure state.
     *
     * After registering compaction states, this method checks whether the
     * weak compressions have triggered H^1 obstructions in the sheaf.
     * Returns null if the enforcer is not connected.
     */
    checkClosureStatus(): Promise<unknown>;
    /**
     * triggerRecovery — request the sheaf enforcer to recover from detected obstructions.
     *
     * Called when checkClosureStatus() reveals H^1 obstructions caused by
     * weak compressions propagating downstream.
     *
     * @param strategy - Recovery strategy: 'soft_relax' for minor issues,
     *                   're_partition' to force re-registration of a specific agent,
     *                   'kernel_retreat' to remove the highest-pressure agent.
     * @param targetAgent - Optional agent ID for targeted recovery.
     */
    triggerRecovery(strategy: "kernel_retreat" | "re_partition" | "admm_reset" | "soft_relax" | "fusion", targetAgent?: string): Promise<unknown>;
}
//# sourceMappingURL=MCPBridge.d.ts.map