/**
 * ChatPanel — Main chat area with messages and input.
 */

import { useCallback, useRef, useEffect, useState } from "react";
import { Atom } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { useAgemStore } from "../../stores/agem";
import { useSettingsStore } from "../../stores/settings";
import { useSessionStore } from "../../stores/sessions";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import { streamChat, createSession } from "../../api";
import type { ChatMessage } from "@shared/types";

const LOCAL_STRINGS = {
  interfaceTitle: "AGEM Interface",
  interfaceSubtitle: "Agent Group Evolving Molecular System",
  thinking: "Thinking...",
  assistant: "assistant",
};

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const isStreaming = useChatStore((s) => s.isStreaming);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const [activeToolResults, setActiveToolResults] = useState<
    Array<{
      tool: string;
      elapsed_ms: number;
      output: string;
    }>
  >([]);

  // Auto-scroll on new content
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleSend = useCallback(
    async (content: string) => {
      const settings = useSettingsStore.getState();
      const chat = useChatStore.getState();
      const sessionState = useSessionStore.getState();

      // Get or create session
      let sessionId = chat.activeSessionId;
      if (!sessionId) {
        const session = await createSession({});
        sessionId = session.id;
        chat.setActiveSessionId(sessionId);
        sessionState.addSession(session);
      }

      // Add user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: Date.now(),
      };
      chat.addMessage(userMessage);
      chat.setStreamingContent("");
      chat.setIsStreaming(true);
      setActiveToolResults([]);

      // Collect all assistant text and structured metadata
      let assistantText = "";
      const toolResults: Array<{
        tool: string;
        elapsed_ms: number;
        output: string;
      }> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let finalUsage: any = null;

      const controller = streamChat(
        {
          message: content,
          session_id: sessionId,
          model: settings.chatModel,
          provider: settings.provider,
        },
        {
          onToken: (text) => {
            assistantText += text;
            chat.appendStreamingContent(text);
          },
          onThinking: (text) => {
            console.log("[thinking]", text);
          },
          onToolResult: (tool, elapsedMs, output) => {
            const tr = { tool, elapsed_ms: elapsedMs, output };
            toolResults.push(tr);
            setActiveToolResults([...toolResults]);
            // For now, we still append a marker so the UI knows where tools happened
            // but we'll render it properly in MessageBubble
            const marker = `\n\n:::tool_result[${toolResults.length - 1}]:::\n\n`;
            assistantText += marker;
            chat.appendStreamingContent(marker);
          },
          onUsage: (usage) => {
            finalUsage = usage;
            if (usage.total_tokens) {
              useAgemStore.getState().addUsageDataPoint(usage.total_tokens);
            }
          },
          onAgemState: (data) => {
            chat.setAgemState(data as never);
            // Update dashboard store with state
            const agemStore = useAgemStore.getState();
            agemStore.updateState(data as never);
            // Extract SOC data point from embedded metrics
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const state = data as any;
            if (state.soc?.latest) {
              const soc = state.soc.latest;
              agemStore.addSOCDataPoint({
                iteration: soc.iteration ?? state.iteration ?? 0,
                vne: soc.von_neumann_entropy ?? 0,
                ee: soc.embedding_entropy ?? 0,
                cdp: soc.cdp ?? 0,
                ser: soc.surprising_edge_ratio ?? 0,
                correlation: soc.correlation_coefficient ?? 0,
              });
            }
          },
          onClearStream: () => {
            const current = assistantText.trim();
            if (current.startsWith("{") || current.startsWith("[")) {
              assistantText = "";
              chat.setStreamingContent("");
            }
          },
          onDone: (message) => {
            chat.setIsStreaming(false);
            chat.setStreamingContent("");
            // Attach accumulated metadata
            message.metadata = {
              ...message.metadata,
              tool_results: toolResults,
              usage: finalUsage,
            };
            if (assistantText.length > (message.content?.length ?? 0)) {
              message = { ...message, content: assistantText };
            }
            chat.addMessage(message);
            chat.setAbortController(null);
            // Refresh the session list in case the backend auto-titled it
            void sessionState.fetchSessions();
          },
          onError: (error) => {
            chat.setIsStreaming(false);
            chat.setStreamingContent("");
            chat.setAbortController(null);
            // Preserve accumulated text and append the error
            const errorSuffix = `\n\n⚠️ Error: ${error}`;
            chat.addMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: assistantText
                ? assistantText + errorSuffix
                : errorSuffix.trim(),
              timestamp: Date.now(),
            });
          },
        },
        settings.provider === "openrouter" ? settings.apiKey : undefined,
      );

      chat.setAbortController(controller);
    },
    [],
  );

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="main-content">
      <div className="chat-area" ref={chatAreaRef}>
        {isEmpty ? (
          <div className="chat-area__empty">
            <div className="chat-area__empty-icon">
              <Atom size={32} />
            </div>
            <div className="chat-area__empty-title">{LOCAL_STRINGS.interfaceTitle}</div>
            <div className="chat-area__empty-subtitle">
              {LOCAL_STRINGS.interfaceSubtitle}
            </div>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                maxWidth: "460px",
                marginTop: "12px",
                lineHeight: "1.5",
                textAlign: "center",
              }}
            >
              Collaborate with self-evolving agent groups to construct topological semantic graphs, detect logical gaps, and synthesize bridging insights.
            </p>
          </div>
        ) : (
          <>
            {messages
              .filter((msg) => msg.role !== "tool" && msg.role !== "system")
              .map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            {isStreaming && streamingContent && (
              <MessageBubble
                message={{
                  id: "__streaming__",
                  role: "assistant",
                  content: streamingContent,
                  timestamp: 0,
                  metadata: {
                    tool_results: activeToolResults,
                  },
                }}
              />
            )}
            {isStreaming && !streamingContent && (
              <div className="message">
                <div className="message__avatar message__avatar--assistant">
                  <Atom size={16} />
                </div>
                <div className="message__body">
                  <div className="message__role">{LOCAL_STRINGS.assistant}</div>
                  <div className="thinking">
                    <div className="thinking__dots">
                      <div className="thinking__dot" />
                      <div className="thinking__dot" />
                      <div className="thinking__dot" />
                    </div>
                    <span>{LOCAL_STRINGS.thinking}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <InputBar onSend={handleSend} />
    </div>
  );
}
