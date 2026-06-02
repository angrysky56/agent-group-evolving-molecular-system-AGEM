/**
 * SystemVitals — compact status strip showing AGEM vital signs.
 *
 * Always visible at the top of the dashboard panel.
 * Shows: iteration count, regime badge, kernel status, CDP gauge.
 */

import { useAgemStore } from "../../stores/agem";
import {
  Activity,
  Zap,
  Shield,
  TrendingUp,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react";

const REGIME_COLORS: Record<string, string> = {
  nascent: "var(--info)",
  stable: "var(--success)",
  critical: "var(--error)",
  transitioning: "var(--warning)",
};

const STATE_COLORS: Record<string, string> = {
  NORMAL: "var(--success)",
  OBSTRUCTED: "var(--warning)",
  CRITICAL: "var(--error)",
};

export function SystemVitals() {
  const state = useAgemStore((s) => s.state);
  const sseConnected = useAgemStore((s) => s.sseConnected);
  const socHistory = useAgemStore((s) => s.socHistory);

  const regime = state?.regime?.regime ?? "—";
  const regimeColor = REGIME_COLORS[regime] ?? "var(--text-tertiary)";
  const opState = state?.operational_state ?? "—";
  const opColor = STATE_COLORS[opState] ?? "var(--text-tertiary)";
  const iteration = state?.iteration ?? 0;
  const cdp = socHistory.length > 0
    ? socHistory[socHistory.length - 1]!.cdp
    : null;
  const h1 = state?.cohomology?.h1_dimension ?? 0;

  return (
    <div className="vitals">
      <div className="vitals__item" title="Server-Sent Events (SSE) Live Connection Status">
        {sseConnected
          ? <Wifi size={12} color="var(--success)" />
          : <WifiOff size={12} color="var(--text-muted)" />
        }
      </div>

      <div className="vitals__item" title="The current reasoning cycle iteration count of the system.">
        <Activity size={12} />
        <span className="vitals__label">Iteration</span>
        <span className="vitals__value">{iteration}</span>
      </div>

      <div className="vitals__divider" />

      <div className="vitals__item" title={`Self-Organized Criticality (SOC) Regime: ${regime}. Represents the stability and evolution phase of the system's reasoning.`}>
        <Zap size={12} color={regimeColor} />
        <span className="vitals__badge" style={{
          background: regimeColor + "20",
          color: regimeColor,
        }}>
          {regime}
        </span>
      </div>

      <div className="vitals__item" title={`Operational Flow State: ${opState}. NORMAL means knowledge flows freely, OBSTRUCTED or CRITICAL indicate structural bottlenecks.`}>
        <Shield size={12} color={opColor} />
        <span className="vitals__badge" style={{
          background: opColor + "20",
          color: opColor,
        }}>
          {opState}
        </span>
      </div>

      <div className="vitals__divider" />

      {cdp !== null && (
        <div className="vitals__item" title={`Critical Divergence Parameter (CDP): ${cdp.toFixed(3)}. Measures the gap between structural complexity and semantic alignment (VNE - EE).`}>
          <TrendingUp size={12} />
          <span className="vitals__label">CDP</span>
          <span className="vitals__value">{cdp.toFixed(2)}</span>
        </div>
      )}

      {h1 > 0 && (
        <div className="vitals__item vitals__item--alert" title={`Sheaf Cohomology Obstruction (H¹): Dimension ${h1}. A non-zero value indicates structural conflict or disagreement between agent views.`}>
          <AlertTriangle size={12} color="var(--warning)" />
          <span className="vitals__label">H¹ Conflict</span>
          <span className="vitals__value" style={{ color: "var(--warning)" }}>{h1}</span>
        </div>
      )}

      <div className="vitals__item" title="Total number of concept nodes, relational edges, and concept communities in the topological network.">
        <span className="vitals__label" style={{ display: "flex", gap: "6px" }}>
          <span><strong>{state?.graph_summary?.node_count ?? 0}</strong> Nodes</span>
          <span>•</span>
          <span><strong>{state?.graph_summary?.edge_count ?? 0}</strong> Edges</span>
          <span>•</span>
          <span><strong>{state?.communities ?? 0}</strong> Communities</span>
        </span>
      </div>
    </div>
  );
}
