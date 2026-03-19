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
      <div className="vitals__item" title="SSE Connection">
        {sseConnected
          ? <Wifi size={12} color="var(--success)" />
          : <WifiOff size={12} color="var(--text-muted)" />
        }
      </div>

      <div className="vitals__item" title="Iteration">
        <Activity size={12} />
        <span className="vitals__label">Iter</span>
        <span className="vitals__value">{iteration}</span>
      </div>

      <div className="vitals__divider" />

      <div className="vitals__item" title={`Regime: ${regime}`}>
        <Zap size={12} color={regimeColor} />
        <span className="vitals__badge" style={{
          background: regimeColor + "20",
          color: regimeColor,
        }}>
          {regime}
        </span>
      </div>

      <div className="vitals__item" title={`State: ${opState}`}>
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
        <div className="vitals__item" title={`CDP: ${cdp.toFixed(3)}`}>
          <TrendingUp size={12} />
          <span className="vitals__label">CDP</span>
          <span className="vitals__value">{cdp.toFixed(2)}</span>
        </div>
      )}

      {h1 > 0 && (
        <div className="vitals__item vitals__item--alert" title={`H¹ obstruction: dim=${h1}`}>
          <AlertTriangle size={12} color="var(--warning)" />
          <span className="vitals__label">H¹</span>
          <span className="vitals__value" style={{ color: "var(--warning)" }}>{h1}</span>
        </div>
      )}

      <div className="vitals__item" title="Nodes / Edges / Communities">
        <span className="vitals__label">
          {state?.graph_summary?.node_count ?? 0}n / {state?.graph_summary?.edge_count ?? 0}e / {state?.communities ?? 0}c
        </span>
      </div>
    </div>
  );
}
