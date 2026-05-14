/**
 * SubAgentStatusPanel — Visualizes active and recent VdW probes.
 * Provides real-time visibility into the multi-agent reasoning process.
 */

import { useAgemStore } from "../../stores/agem";
import { Activity, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export function SubAgentStatusPanel() {
  const subAgents = useAgemStore((s) => s.activeSubAgents);

  if (subAgents.length === 0) {
    return (
      <div className="sub-agent-panel empty">
        <Activity size={16} className="text-muted" />
        <span>No sub-agents active in the current cycle</span>
      </div>
    );
  }

  // Sort: running first, then most recent
  const sorted = [...subAgents].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return b.startTime - a.startTime;
  }).slice(0, 8); // Only show last 8

  return (
    <div className="sub-agent-panel">
      <div className="sub-agent-panel__header">
        <Activity size={14} />
        <span>VdW Agent Fleet</span>
      </div>
      <div className="sub-agent-list">
        {sorted.map((agent) => (
          <div key={agent.id} className={`sub-agent-item sub-agent-item--${agent.status}`}>
            <div className="sub-agent-item__icon">
              {agent.status === "running" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : agent.status === "complete" ? (
                <CheckCircle2 size={12} />
              ) : (
                <XCircle size={12} />
              )}
            </div>
            <div className="sub-agent-item__details">
              <div className="sub-agent-item__id">
                {agent.id.replace("vdw-agent-", "Probe-")}
              </div>
              <div className="sub-agent-item__meta">
                Gap: {agent.gapId.substring(0, 8)} • {agent.steps} steps
              </div>
            </div>
            {agent.status === "running" && (
              <div className="sub-agent-item__progress-bar">
                <div className="sub-agent-item__progress-fill" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
