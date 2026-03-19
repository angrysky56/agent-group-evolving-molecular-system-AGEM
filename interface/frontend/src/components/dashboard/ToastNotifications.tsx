/**
 * ToastNotifications — overlay for critical AGEM system events.
 *
 * Shows auto-dismissing toast cards for System 1 overrides,
 * weak lumpability, phase transitions, and H^1 obstructions.
 * Positioned bottom-right of the viewport.
 */

import { useEffect } from "react";
import { useAgemStore } from "../../stores/agem";
import { X, AlertTriangle, Zap, Brain, ShieldAlert } from "lucide-react";

const EVENT_ICONS: Record<string, typeof AlertTriangle> = {
  "soc:system1-early-convergence": Brain,
  "lumpability:weak-compression": ShieldAlert,
  "phase:transition": Zap,
  "sheaf:h1-obstruction-detected": AlertTriangle,
};

const EVENT_COLORS: Record<string, string> = {
  "soc:system1-early-convergence": "var(--error)",
  "lumpability:weak-compression": "var(--warning)",
  "phase:transition": "var(--accent-secondary)",
  "sheaf:h1-obstruction-detected": "var(--warning)",
};

export function ToastNotifications() {
  const toasts = useAgemStore((s) => s.toasts);
  const removeToast = useAgemStore((s) => s.removeToast);

  // Auto-dismiss expired toasts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      toasts.forEach((t) => {
        if (t.expiresAt <= now) removeToast(t.id);
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((toast) => {
        const Icon = EVENT_ICONS[toast.event.type] ?? AlertTriangle;
        const color = EVENT_COLORS[toast.event.type] ?? "var(--warning)";
        return (
          <div key={toast.id} className="toast" style={{ borderLeftColor: color }}>
            <Icon size={18} color={color} style={{ flexShrink: 0 }} />
            <div className="toast__body">
              <span className="toast__type">{toast.event.type}</span>
              <span className="toast__summary">{toast.event.summary}</span>
            </div>
            <button className="toast__close" onClick={() => removeToast(toast.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
