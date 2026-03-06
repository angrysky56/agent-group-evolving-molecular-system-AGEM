/**
 * Header — Top bar with model selector and action buttons.
 */

import { Settings, Activity } from "lucide-react";
import { useSettingsStore } from "../stores/settings";

interface Props {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: Props) {
  const provider = useSettingsStore((s) => s.provider);
  const chatModel = useSettingsStore((s) => s.chatModel);

  return (
    <header className="header" id="header">
      <div className="header__model-selector">
        <span
          className={`status-badge status-badge--online`}
        >
          <span className="status-badge__dot" />
          {provider === "ollama" ? "Ollama" : "OpenRouter"}
        </span>
        <span
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {chatModel}
        </span>
      </div>

      <div className="header__actions">
        <button
          className="btn--icon"
          onClick={onOpenSettings}
          aria-label="Open settings"
          id="settings-button"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
