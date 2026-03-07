/**
 * SettingsPanel — Slide-out settings drawer.
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useSettingsStore } from "../../stores/settings";
import { listModels } from "../../api";
import type { ModelInfo, LLMProviderType } from "@shared/types";

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const settings = useSettingsStore();

  return (
    <>
      <div className="settings-overlay" onClick={onClose} />
      <div className="settings-panel" id="settings-panel">
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Settings</h2>
          <button
            className="btn--icon"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="settings-panel__body">
          {/* Provider Toggle */}
          <div className="settings-group">
            <div className="settings-group__label">LLM Provider</div>
            <div className="provider-toggle">
              <button
                className={`provider-toggle__btn ${
                  settings.provider === "ollama"
                    ? "provider-toggle__btn--active"
                    : ""
                }`}
                onClick={() => settings.setProvider("ollama")}
              >
                Ollama
              </button>
              <button
                className={`provider-toggle__btn ${
                  settings.provider === "openrouter"
                    ? "provider-toggle__btn--active"
                    : ""
                }`}
                onClick={() => settings.setProvider("openrouter")}
              >
                OpenRouter
              </button>
              <button
                className={`provider-toggle__btn ${
                  settings.provider === "anthropic"
                    ? "provider-toggle__btn--active"
                    : ""
                }`}
                onClick={() => settings.setProvider("anthropic")}
              >
                Anthropic
              </button>
            </div>
          </div>

          {/* Ollama Settings */}
          {settings.provider === "ollama" && (
            <div className="settings-group">
              <div className="settings-group__label">Ollama</div>
              <div className="settings-field">
                <label className="settings-field__label">Base URL</label>
                <input
                  className="settings-field__input settings-field__input--mono"
                  value={settings.ollamaUrl}
                  onChange={(e) => settings.setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </div>
            </div>
          )}

          {/* API Key Settings (OpenRouter/Anthropic) */}
          {(settings.provider === "openrouter" ||
            settings.provider === "anthropic") && (
            <div className="settings-group">
              <div className="settings-group__label">
                {settings.provider === "openrouter"
                  ? "OpenRouter"
                  : "Anthropic"}
              </div>
              <div className="settings-field">
                <label className="settings-field__label">API Key</label>
                <input
                  className="settings-field__input settings-field__input--mono"
                  type="password"
                  value={settings.apiKey}
                  onChange={(e) => settings.setApiKey(e.target.value)}
                  placeholder={
                    settings.provider === "anthropic"
                      ? "sk-ant-..."
                      : "sk-or-..."
                  }
                />
              </div>
            </div>
          )}

          {/* Model Selection */}
          <div className="settings-group">
            <div className="settings-group__label">Models</div>
            <div className="settings-field">
              <label className="settings-field__label">Chat Model</label>
              {settings.availableModels.length > 0 ? (
                <select
                  className="settings-field__select"
                  value={settings.chatModel}
                  onChange={(e) => settings.setChatModel(e.target.value)}
                >
                  {settings.availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="settings-field__input settings-field__input--mono"
                  value={settings.chatModel}
                  onChange={(e) => settings.setChatModel(e.target.value)}
                  placeholder="Model name"
                />
              )}
            </div>
            <div className="settings-field">
              <label className="settings-field__label">Embedding Model</label>
              <input
                className="settings-field__input settings-field__input--mono"
                value={settings.embeddingModel}
                onChange={(e) => settings.setEmbeddingModel(e.target.value)}
                placeholder="nomic-embed-text"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
