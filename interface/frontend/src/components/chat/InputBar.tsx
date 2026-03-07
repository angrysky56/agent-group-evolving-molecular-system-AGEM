/**
 * InputBar — Chat input with send/stop functionality.
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { useChatStore } from "../../stores/chat";

interface Props {
  onSend: (message: string) => void;
}

export function InputBar({ onSend }: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const stopStreaming = useChatStore((s) => s.stopStreaming);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, []);

  return (
    <div className="input-bar">
      <div className="input-bar__container">
        <textarea
          ref={textareaRef}
          className="input-bar__textarea"
          placeholder="Send a message to AGEM..."
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          id="chat-input"
        />
        {isStreaming ? (
          <button
            className="input-bar__stop"
            onClick={stopStreaming}
            aria-label="Stop generating"
            id="stop-button"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className="input-bar__send"
            onClick={handleSend}
            disabled={!input.trim()}
            aria-label="Send message"
            id="send-button"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
