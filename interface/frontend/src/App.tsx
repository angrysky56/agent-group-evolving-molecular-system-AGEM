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
import { GraphVisualization } from "./components/graph/GraphVisualization";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        }}
      >
        <Header onOpenSettings={() => setSettingsOpen(true)} />
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <ErrorBoundary>
            <ChatPanel />
          </ErrorBoundary>
          <div
            style={{
              flex: 1,
              borderLeft: "1px solid var(--border-default)",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface-sunken)",
            }}
          >
            <ErrorBoundary>
              <GraphVisualization />
            </ErrorBoundary>
          </div>
        </div>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
