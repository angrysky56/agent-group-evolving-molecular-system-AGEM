/**
 * ChatPanel — Main chat area with messages and input.
 */

import { useCallback, useRef, useEffect } from "react";
import { Atom } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { useAgemStore } from "../../stores/agem";
import { useSettingsStore } from "../../stores/settings";
import { useSessionStore } from "../../stores/sessions";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import { streamChat, createSession, getSession } from "../../api";
import type { ChatMessage } from "@shared/types";

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const chatAreaRef = useRef<HTMLDivElement>(null);

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
        const session = await createSession({ title: content.slice(0, 60) });
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

      // Collect all assistant text
      let assistantText = "";

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
            // Could show thinking state
            console.log("[thinking]", text);
          },
          onAgemState: (data) => {
            chat.setAgemState(data as never);
            // Update dashboard store with state
            const agemStore = useAgemStore.getState();
            agemStore.updateState(data as never);
            // Extract SOC data point from embedded metrics
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
            // Model output a tool call as text — clear the displayed JSON
            assistantText = "";
            chat.setStreamingContent("");
          },
          onDone: (message) => {
            chat.setIsStreaming(false);
            chat.setStreamingContent("");
            chat.addMessage(message);
            chat.setAbortController(null);
          },
          onError: (error) => {
            chat.setIsStreaming(false);
            chat.setStreamingContent("");
            chat.setAbortController(null);
            // Add error as system message
            chat.addMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: `⚠️ Error: ${error}`,
              timestamp: Date.now(),
            });
          },
        },
        settings.provider === "openrouter" ? settings.apiKey : undefined,
      );

      chat.setAbortController(controller);
    },
    [activeSessionId],
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
            <div className="chat-area__empty-title">AGEM Interface</div>
            <div className="chat-area__empty-subtitle">
              Agent Group Evolving Molecular System — Ask me anything about
              multi-agent coordination, sheaf-theoretic reasoning, or start an
              orchestration cycle.
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isStreaming && streamingContent && (
              <MessageBubble
                message={{
                  id: "__streaming__",
                  role: "assistant",
                  content: streamingContent,
                  timestamp: Date.now(),
                }}
              />
            )}
            {isStreaming && !streamingContent && (
              <div className="message">
                <div className="message__avatar message__avatar--assistant">
                  <Atom size={16} />
                </div>
                <div className="message__body">
                  <div className="message__role">assistant</div>
                  <div className="thinking">
                    <div className="thinking__dots">
                      <div className="thinking__dot" />
                      <div className="thinking__dot" />
                      <div className="thinking__dot" />
                    </div>
                    <span>Thinking...</span>
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
