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
import "./index.css";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app-layout">
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Header onOpenSettings={() => setSettingsOpen(true)} />
        <ChatPanel />
      </div>
      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
