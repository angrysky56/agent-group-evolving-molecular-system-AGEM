/**
 * Header — Top bar with model selector and action buttons.
 */

import { useEffect } from "react";
import { Settings } from "lucide-react";
import { useSettingsStore } from "../stores/settings";
import * as api from "../api";

interface Props {
  onOpenSettings: () => void;
}

export function Header({ onOpenSettings }: Props) {
  const provider = useSettingsStore((s) => s.provider);
  const chatModel = useSettingsStore((s) => s.chatModel);
  const setChatModel = useSettingsStore((s) => s.setChatModel);
  const availableModels = useSettingsStore((s) => s.availableModels);
  const setAvailableModels = useSettingsStore((s) => s.setAvailableModels);
  const apiKey = useSettingsStore((s) => s.apiKey);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const models = await api.listModels(provider, apiKey);
        setAvailableModels(models);
      } catch (err) {
        console.error("Failed to fetch models:", err);
      }
    };
    fetchModels();
  }, [provider, apiKey, setAvailableModels]);

  return (
    <header className="header" id="header">
      <div className="header__model-selector">
        <span className={`status-badge status-badge--online`}>
          <span className="status-badge__dot" />
          {provider === "ollama"
            ? "Ollama"
            : provider === "anthropic"
              ? "Anthropic"
              : "OpenRouter"}
        </span>
        <select
          className="header__select"
          value={chatModel}
          onChange={(e) => setChatModel(e.target.value)}
          aria-label="Select model"
          id="model-selector"
        >
          {availableModels.length > 0 ? (
            availableModels
              .filter((m) => m.type !== "embedding")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.supports_tools ? "🔧 " : ""}{m.name || m.id}
                  {m.context_length ? ` (${Math.round(m.context_length / 1024)}k)` : ""}
                </option>
              ))
          ) : (
            <option value={chatModel}>{chatModel}</option>
          )}
        </select>
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
