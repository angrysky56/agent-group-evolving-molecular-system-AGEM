/**
 * MetricsPanel — SOC sparklines and lumpability summary.
 *
 * Renders mini SVG sparkline charts for VNE, EE, CDP, SER, Correlation
 * from the socHistory array in the agem store.
 * Shows lumpability audit stats at the bottom.
 */

import { useAgemStore } from "../../stores/agem";

/** Render a mini sparkline as an SVG polyline. */
function Sparkline({
  data,
  color,
  label,
  currentValue,
  width = 200,
  height = 32,
}: {
  data: number[];
  color: string;
  label: string;
  currentValue: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 1) {
    return (
      <div className="spark">
        <div className="spark__header">
          <span className="spark__label">{label}</span>
          <span className="spark__value" style={{ color }}>—</span>
        </div>
        <div className="spark__empty">awaiting data</div>
      </div>
    );
  }

  // Single data point: show a dot at center
  if (data.length === 1) {
    return (
      <div className="spark">
        <div className="spark__header">
          <span className="spark__label">{label}</span>
          <span className="spark__value" style={{ color }}>{currentValue}</span>
        </div>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="spark__svg"
        >
          <circle cx={width / 2} cy={height / 2} r="3" fill={color} />
        </svg>
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="spark">
      <div className="spark__header">
        <span className="spark__label">{label}</span>
        <span className="spark__value" style={{ color }}>{currentValue}</span>
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="spark__svg"
      >
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function MetricsPanel() {
  const socHistory = useAgemStore((s) => s.socHistory);
  const state = useAgemStore((s) => s.state);
  const latest = socHistory[socHistory.length - 1];

  const vneData = socHistory.map((p) => p.vne);
  const eeData = socHistory.map((p) => p.ee);
  const cdpData = socHistory.map((p) => p.cdp);
  const serData = socHistory.map((p) => p.ser);
  const corrData = socHistory.map((p) => p.correlation);

  return (
    <div className="metrics-panel">
      <div className="metrics-panel__section">
        <div className="metrics-panel__title">SOC Metrics</div>
        <div className="metrics-panel__grid">
          <Sparkline
            data={vneData}
            color="var(--info)"
            label="Von Neumann Entropy"
            currentValue={latest?.vne.toFixed(3) ?? "—"}
          />
          <Sparkline
            data={eeData}
            color="var(--success)"
            label="Embedding Entropy"
            currentValue={latest?.ee.toFixed(3) ?? "—"}
          />
          <Sparkline
            data={cdpData}
            color="var(--accent-secondary)"
            label="CDP (VNE − EE)"
            currentValue={latest?.cdp.toFixed(3) ?? "—"}
          />
          <Sparkline
            data={serData}
            color="var(--warning)"
            label="Surprising Edge Ratio"
            currentValue={latest?.ser.toFixed(3) ?? "—"}
          />
          <Sparkline
            data={corrData}
            color="var(--error)"
            label="Correlation Coefficient"
            currentValue={latest?.correlation.toFixed(3) ?? "—"}
          />
        </div>
      </div>

      {state?.lumpability && (
        <div className="metrics-panel__section">
          <div className="metrics-panel__title">Lumpability Auditing</div>
          <div className="metrics-panel__stats">
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">Weak Rate</span>
              <span className="metrics-panel__stat-value" style={{
                color: state.lumpability.weak_compression_rate > 0.3
                  ? "var(--warning)" : "var(--success)"
              }}>
                {(state.lumpability.weak_compression_rate * 100).toFixed(1)}%
              </span>
            </div>
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">Avg Entropy Preservation</span>
              <span className="metrics-panel__stat-value">
                {isNaN(state.lumpability.avg_entropy_preservation)
                  ? "—"
                  : state.lumpability.avg_entropy_preservation.toFixed(3)}
              </span>
            </div>
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">Last Classification</span>
              <span className="metrics-panel__stat-value" style={{
                color: state.lumpability.last_classification === "weak"
                  ? "var(--warning)"
                  : state.lumpability.last_classification === "strong"
                    ? "var(--success)"
                    : "var(--text-tertiary)"
              }}>
                {state.lumpability.last_classification ?? "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {state?.regime && (
        <div className="metrics-panel__section">
          <div className="metrics-panel__title">Regime Analysis</div>
          <div className="metrics-panel__stats">
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">CDP Variance</span>
              <span className="metrics-panel__stat-value">
                {state.regime.cdp_variance.toFixed(4)}
              </span>
            </div>
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">Corr. Consistency</span>
              <span className="metrics-panel__stat-value">
                {state.regime.correlation_consistency.toFixed(4)}
              </span>
            </div>
            <div className="metrics-panel__stat">
              <span className="metrics-panel__stat-label">Persistence</span>
              <span className="metrics-panel__stat-value">
                {state.regime.persistence_iterations} iter
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
