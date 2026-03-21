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
// ---------------------------------------------------------------------------
// MCPBridge class
// ---------------------------------------------------------------------------
/**
 * MCPBridge — translates lumpability audit events into MCP tool calls.
 *
 * Usage:
 *   const bridge = new MCPBridge(mcpClient);
 *   auditor.on('lumpability:audit-complete', (r) => bridge.onAuditComplete(r));
 *   auditor.on('lumpability:weak-compression', (r) => bridge.onWeakCompression(r));
 */
export class MCPBridge {
    #client;
    constructor(client) {
        this.#client = client;
    }
    /**
     * onAuditComplete — register the audit result with sheaf-consistency-enforcer.
     *
     * Maps the auditor's entropy metrics to an agent state registration,
     * treating the compaction boundary as a sheaf edge between
     * "pre-compaction" and "post-compaction" agent stalks.
     */
    async onAuditComplete(result) {
        if (!this.#client.isConnected("sheaf-consistency-enforcer"))
            return;
        await this.#client.callTool({
            server: "sheaf-consistency-enforcer",
            tool: "register_agent_state",
            args: {
                agent_id: `lcm-compaction-${result.summaryNodeId}`,
                state: {
                    last_assertion: `Compaction at L${result.escalationLevel}: ` +
                        `entropy ratio ${result.entropyPreservationRatio.toFixed(3)}, ` +
                        `centroid sim ${result.centroidSimilarity.toFixed(3)}`,
                    confidence_score: Math.min(1.0, result.entropyPreservationRatio),
                    current_hypothesis: `Classification: ${result.classification}`,
                    reasoning_depth: result.escalationLevel,
                    inconsistency_flag: result.classification === "weak",
                },
            },
        });
    }
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
    async onWeakCompression(result) {
        // 1. Log provenance in verifier-graph
        if (this.#client.isConnected("verifier-graph")) {
            await this.#client.callTool({
                server: "verifier-graph",
                tool: "propose_thought",
                args: {
                    content: `Weak lumpability detected at compaction boundary ` +
                        `${result.summaryNodeId} (L${result.escalationLevel}). ` +
                        `Entropy preservation: ${result.entropyPreservationRatio.toFixed(3)} ` +
                        `(threshold: ${result.threshold}). ` +
                        `Centroid similarity: ${result.centroidSimilarity.toFixed(3)}. ` +
                        `Source entries: ${result.sourceEntryIds.join(", ")}`,
                    nodeType: "observation",
                    confidence: 1.0 - result.entropyPreservationRatio,
                },
            });
        }
        // 2. Register as tracked belief in hipai-montague world model
        if (this.#client.isConnected("hipai-montague")) {
            await this.#client.callTool({
                server: "hipai-montague",
                tool: "add_belief",
                args: {
                    text: `Summary ${result.summaryNodeId} is a weakly lumpable ` +
                        `compression of entries ${result.sourceEntryIds.length} sources`,
                },
            });
        }
        // 3. Set restriction maps so sheaf enforcer tracks compaction-to-reasoning edges
        if (this.#client.isConnected("sheaf-consistency-enforcer")) {
            const compactionAgentId = `lcm-compaction-${result.summaryNodeId}`;
            // Map the compaction agent's inconsistency flag to reasoning agents' edge state.
            // When the sheaf enforcer runs ADMM, high coboundary residuals on these edges
            // indicate that the weak compression is propagating inconsistencies downstream.
            await this.#client.callTool({
                server: "sheaf-consistency-enforcer",
                tool: "set_restriction_map",
                args: {
                    from_agent: compactionAgentId,
                    to_agent: "advanced-reasoning",
                    mappings: [
                        { from_key: "inconsistency_flag", to_key: "edge_inconsistent", weight: 1.0 },
                        { from_key: "confidence_score", to_key: "edge_confidence", weight: 1.0 },
                        { from_key: "current_hypothesis", to_key: "edge_claim", weight: 1.0 },
                    ],
                },
            });
        }
    }
    /**
     * checkClosureStatus — query sheaf-consistency-enforcer for current closure state.
     *
     * After registering compaction states, this method checks whether the
     * weak compressions have triggered H^1 obstructions in the sheaf.
     * Returns null if the enforcer is not connected.
     */
    async checkClosureStatus() {
        if (!this.#client.isConnected("sheaf-consistency-enforcer"))
            return null;
        return await this.#client.callTool({
            server: "sheaf-consistency-enforcer",
            tool: "get_closure_status",
            args: {},
        });
    }
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
    async triggerRecovery(strategy, targetAgent) {
        if (!this.#client.isConnected("sheaf-consistency-enforcer"))
            return null;
        return await this.#client.callTool({
            server: "sheaf-consistency-enforcer",
            tool: "trigger_recovery",
            args: { strategy, target_agent: targetAgent ?? null },
        });
    }
}
//# sourceMappingURL=MCPBridge.js.map