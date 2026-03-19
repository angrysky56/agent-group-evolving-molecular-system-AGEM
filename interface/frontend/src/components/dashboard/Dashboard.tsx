/**
 * Dashboard — right panel shell composing all dashboard sub-components.
 *
 * Layout: SystemVitals strip (top) → Tab bar → Active tab content → QuickActions (bottom).
 * Tabs: Graph | Metrics | Events
 */

import { useAgemStore } from "../../stores/agem";
import type { DashboardTab } from "../../stores/agem";
import { SystemVitals } from "./SystemVitals";
import { MetricsPanel } from "./MetricsPanel";
import { EventLog } from "./EventLog";
import { QuickActions } from "./QuickActions";
import { GraphVisualization } from "../graph/GraphVisualization";
import {
  Network,
  BarChart3,
  ScrollText,
} from "lucide-react";

const TABS: { id: DashboardTab; label: string; icon: typeof Network }[] = [
  { id: "graph", label: "Graph", icon: Network },
  { id: "metrics", label: "Metrics", icon: BarChart3 },
  { id: "events", label: "Events", icon: ScrollText },
];

export function Dashboard() {
  const activeTab = useAgemStore((s) => s.activeTab);
  const setActiveTab = useAgemStore((s) => s.setActiveTab);
  const eventCount = useAgemStore((s) => s.eventLog.length);

  return (
    <div className="dashboard">
      <SystemVitals />

      <div className="dashboard__tabs">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`dashboard__tab ${activeTab === id ? "dashboard__tab--active" : ""}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
            {id === "events" && eventCount > 0 && (
              <span className="dashboard__tab-badge">{eventCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="dashboard__content">
        {activeTab === "graph" && <GraphVisualization />}
        {activeTab === "metrics" && <MetricsPanel />}
        {activeTab === "events" && <EventLog />}
      </div>

      <QuickActions />
    </div>
  );
}
