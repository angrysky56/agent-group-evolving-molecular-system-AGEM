/**
 * AGEM Interface — Root Application Component.
 *
 * Layout: [Sidebar] [Header + ChatPanel]
 * With a slide-out settings drawer.
 */

import { useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Header } from "./components/Header";
import { ChatPanel } from "./components/chat/ChatPanel";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { Dashboard } from "./components/dashboard/Dashboard";
import { ToastNotifications } from "./components/dashboard/ToastNotifications";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSystemEvents } from "./hooks/useSystemEvents";
import "./App.css";
import "./index.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(true);

  // Connect to AGEM system events SSE on mount
  useSystemEvents();

  return (
    <div className="app-layout">
      <ErrorBoundary>
        <Sidebar />
      </ErrorBoundary>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg-primary)",
        }}
      >
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleDashboard={() => setDashboardOpen(!dashboardOpen)}
          dashboardOpen={dashboardOpen}
        />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <ErrorBoundary>
            <ChatPanel />
          </ErrorBoundary>
          {dashboardOpen && (
            <div
              style={{
                width: "380px",
                borderLeft: "1px solid var(--glass-border)",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-primary)",
              }}
            >
              <ErrorBoundary>
                <Dashboard />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </div>
      <ToastNotifications />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
