/**
 * SettingsPanel — Slide-out settings drawer.
 *
 * Features a rich OpenRouter model picker ported from graph-rlm:
 *  - Models grouped by sub-provider (Anthropic, Google, Meta, …)
 *  - Pricing per 1M tokens displayed on each row
 *  - 🛠️ badge for tool-capable models
 *  - Live fetch on open and on provider change
 *  - Manual refresh button
 */

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settings";
import type { ModelInfo, LLMProviderType } from "@shared/types";

interface Props {
  onClose: () => void;
}

/** Parse a pricing string to a float, defaulting 0 on null/undefined/"0". */
function parsePrice(val: string | undefined | null): number {
  if (!val) return 0;
  return parseFloat(val) || 0;
}

/** Group an array of models by the first path-segment of their id (sub-provider). */
function groupBySubProvider(models: ModelInfo[]): [string, ModelInfo[]][] {
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of models) {
    // e.g. "anthropic/claude-3-5-sonnet" → "Anthropic"
    const raw = m.id.split("/")[0] ?? "Other";
    const key = raw.charAt(0).toUpperCase() + raw.slice(1);
    (groups[key] ??= []).push(m);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

export function SettingsPanel({ onClose }: Props) {
  const settings = useSettingsStore();

  // Local draft key so we can re-fetch before save
  const [draftKey, setDraftKey] = useState(settings.apiKey);

  /** Fetch models for a provider, using the current draft key if appropriate. */
  const doFetch = useCallback(
    (provider: LLMProviderType) => {
      const key = provider === "openrouter" ? draftKey : undefined;
      settings.fetchModels(provider, key || undefined);
    },
    [draftKey, settings],
  );

  // Fetch on panel open
  useEffect(() => {
    doFetch(settings.provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Switch provider and immediately sync to backend + fetch models. */
  const handleProviderChange = (p: LLMProviderType) => {
    settings.setProvider(p);
    // Sync to backend so getLLMConfig() returns the right provider
    fetch("/api/v1/system/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ LLM_PROVIDER: p }),
    }).catch(() => { /* silent */ });
    const key = p === "openrouter" ? draftKey : undefined;
    settings.fetchModels(p, key || undefined);
  };

  /** Save the draft API key to the store, persist to backend, then re-fetch. */
  const handleKeyBlur = () => {
    settings.setApiKey(draftKey);
    // Persist to backend config so it survives server restarts
    if (draftKey) {
      const configKey = settings.provider === "openrouter"
        ? "OPENROUTER_API_KEY"
        : "ANTHROPIC_API_KEY";
      fetch("/api/v1/system/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [configKey]: draftKey }),
      }).catch(() => { /* silent */ });
    }
    if (settings.provider === "openrouter" && draftKey) {
      settings.fetchModels("openrouter", draftKey);
    }
    if (settings.provider === "anthropic" && draftKey) {
      settings.fetchModels("anthropic", draftKey);
    }
  };

  // Chat models (non-embedding) filtered to the current provider
  const chatModels = settings.availableModels.filter((m) => {
    if (m.type === "embedding") return false;
    if (settings.provider === "ollama") return m.provider === "ollama";
    if (settings.provider === "anthropic") return m.provider === "anthropic";
    // openrouter: everything that isn't a local provider
    return m.provider !== "ollama";
  });

  const grouped = groupBySubProvider(chatModels);

  return (
    <>
      <div className="settings-overlay" onClick={onClose} />
      <div className="settings-panel" id="settings-panel">
        {/* ── Header ── */}
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
          {/* ── Provider Toggle ── */}
          <div className="settings-group">
            <div className="settings-group__label">LLM Provider</div>
            <div className="provider-toggle">
              {(["ollama", "openrouter", "anthropic"] as LLMProviderType[]).map(
                (p) => (
                  <button
                    key={p}
                    className={`provider-toggle__btn ${settings.provider === p ? "provider-toggle__btn--active" : ""}`}
                    onClick={() => handleProviderChange(p)}
                  >
                    {p === "ollama"
                      ? "Ollama"
                      : p === "openrouter"
                        ? "OpenRouter"
                        : "Anthropic"}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* ── Ollama base URL ── */}
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

          {/* ── API Key (OpenRouter / Anthropic) ── */}
          {(settings.provider === "openrouter" ||
            settings.provider === "anthropic") && (
            <div className="settings-group">
              <div className="settings-group__label">
                {settings.provider === "openrouter" ? "OpenRouter" : "Anthropic"}
              </div>
              <div className="settings-field">
                <label className="settings-field__label">API Key</label>
                <input
                  className="settings-field__input settings-field__input--mono"
                  type="password"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  onBlur={handleKeyBlur}
                  onKeyDown={(e) => { if (e.key === "Enter") handleKeyBlur(); }}
                  placeholder={
                    settings.provider === "anthropic" ? "sk-ant-..." : "sk-or-..."
                  }
                />
                {settings.provider === "openrouter" && (
                  <p
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--color-text-muted, #64748b)",
                      marginTop: "0.25rem",
                    }}
                  >
                    Press Enter or click away to save and fetch models.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Chat Model — Rich Grouped Picker ── */}
          <div className="settings-group">
            <div
              className="settings-group__label"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span>Chat Model</span>
              <button
                title="Refresh model list"
                onClick={() => doFetch(settings.provider)}
                disabled={settings.modelsLoading}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  color: "var(--color-text-muted, #64748b)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <RefreshCw
                  size={12}
                  className={settings.modelsLoading ? "spin" : ""}
                />
              </button>
              {settings.modelsLoading && (
                <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted, #64748b)" }}>
                  Fetching…
                </span>
              )}
            </div>

            <div
              style={{
                border: "1px solid var(--color-border, #334155)",
                borderRadius: "0.375rem",
                background: "rgba(0,0,0,0.2)",
                maxHeight: "320px",
                overflowY: "auto",
              }}
            >
              {chatModels.length === 0 && !settings.modelsLoading ? (
                <div
                  style={{
                    padding: "1rem",
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted, #64748b)",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  {settings.provider === "openrouter" && !settings.apiKey
                    ? "Enter your OpenRouter API key above to fetch models."
                    : "No models found. Click ↻ to refresh."}
                </div>
              ) : settings.modelsLoading && chatModels.length === 0 ? (
                <div
                  style={{
                    padding: "1rem",
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted, #64748b)",
                    textAlign: "center",
                  }}
                >
                  Loading models…
                </div>
              ) : (
                grouped.map(([subProvider, models]) => {
                  const hasSelected = models.some(
                    (m) => m.id === settings.chatModel,
                  );
                  return (
                    <details
                      key={subProvider}
                      open={hasSelected}
                      style={{
                        borderBottom:
                          "1px solid var(--color-border, #1e293b)",
                      }}
                    >
                      <summary
                        style={{
                          padding: "0.4rem 0.6rem",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          cursor: "pointer",
                          color: "var(--color-text-secondary, #94a3b8)",
                          display: "flex",
                          justifyContent: "space-between",
                          userSelect: "none",
                          background: "rgba(0,0,0,0.15)",
                          listStyle: "none",
                        }}
                      >
                        <span>
                          {subProvider} ({models.length})
                        </span>
                        <span style={{ fontSize: "0.55rem" }}>▼</span>
                      </summary>

                      <div style={{ padding: "0.25rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                        {models.map((m) => {
                          const isSelected = m.id === settings.chatModel;
                          const promptPrice =
                            parsePrice(m.pricing?.prompt) * 1_000_000;
                          const complPrice =
                            parsePrice(m.pricing?.completion) * 1_000_000;
                          const hasPricing =
                            promptPrice > 0 || complPrice > 0;
                          const ctxK = m.context_length
                            ? `${Math.round(m.context_length / 1000)}k`
                            : null;

                          return (
                            <div
                              key={m.id}
                              onClick={() => settings.setChatModel(m.id)}
                              style={{
                                padding: "0.4rem 0.5rem",
                                borderRadius: "0.25rem",
                                cursor: "pointer",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                border: isSelected
                                  ? "1px solid rgba(59,130,246,0.5)"
                                  : "1px solid transparent",
                                background: isSelected
                                  ? "rgba(59,130,246,0.12)"
                                  : "transparent",
                                transition: "background 0.1s",
                              }}
                              onMouseEnter={(e) => {
                                if (!isSelected)
                                  (
                                    e.currentTarget as HTMLDivElement
                                  ).style.background = "rgba(255,255,255,0.04)";
                              }}
                              onMouseLeave={(e) => {
                                if (!isSelected)
                                  (
                                    e.currentTarget as HTMLDivElement
                                  ).style.background = "transparent";
                              }}
                            >
                              {/* Left: name + ctx */}
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.1rem",
                                  minWidth: 0,
                                  flex: 1,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "0.72rem",
                                    fontWeight: "500",
                                    color: isSelected
                                      ? "#93c5fd"
                                      : "var(--color-text, #e2e8f0)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {m.name || m.id}{" "}
                                  {m.supports_tools ? "🛠️" : ""}
                                </span>
                                {ctxK && (
                                  <span
                                    style={{
                                      fontSize: "0.6rem",
                                      color:
                                        "var(--color-text-muted, #64748b)",
                                    }}
                                  >
                                    {ctxK} ctx
                                  </span>
                                )}
                              </div>

                              {/* Right: pricing */}
                              {hasPricing && (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-end",
                                    flexShrink: 0,
                                    marginLeft: "0.5rem",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: "0.6rem",
                                      color:
                                        "var(--color-text-secondary, #94a3b8)",
                                    }}
                                  >
                                    ${promptPrice.toFixed(2)} / $
                                    {complPrice.toFixed(2)}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "0.55rem",
                                      color:
                                        "var(--color-text-muted, #64748b)",
                                    }}
                                  >
                                    per 1M tokens
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.6rem",
                color: "var(--color-text-muted, #64748b)",
                marginTop: "0.25rem",
                padding: "0 0.25rem",
              }}
            >
              <span>* Prices per Million Tokens</span>
              <span>🛠️ = Supports Tools</span>
            </div>
          </div>

          {/* ── Embedding Model ── */}
          <div className="settings-group">
            <div className="settings-group__label">Embedding Model</div>
            <div className="settings-field">
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
