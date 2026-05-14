/**
 * MessageBubble — Renders a single chat message with markdown.
 */

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ToolResultBubble } from "./ToolResultBubble";
import { Cpu, User, Bot } from "lucide-react";
import type { ChatMessage } from "@shared/types";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [message.content]);

  const isUser = message.role === "user";
  const toolResults = message.metadata?.tool_results || [];
  const usage = message.metadata?.usage;

  return (
    <div className="message" ref={ref}>
      <div
        className={`message__avatar message__avatar--${isUser ? "user" : "assistant"}`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="message__body">
        <div className="message__role">
          {message.role}
          {usage && (
            <span className="message__usage">
              <Cpu size={10} /> {usage.total_tokens} tokens
            </span>
          )}
        </div>
        <div className="message__content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p({ children, ...props }) {
                // Check if this paragraph contains a tool result marker
                // We handle both string children and array of children (e.g. if some parts were already parsed)
                const text = Array.isArray(children)
                  ? children.map((c) => (typeof c === "string" ? c : "")).join("")
                  : typeof children === "string"
                    ? children
                    : "";

                const match = /:::tool_result\[(\d+)\]:::/.exec(text);
                if (match) {
                  const idx = parseInt(match[1], 10);
                  const result = toolResults[idx];
                  if (result) {
                    return (
                      <ToolResultBubble
                        key={`tool-${idx}`}
                        tool={result.tool}
                        elapsedMs={result.elapsed_ms}
                        output={result.output}
                      />
                    );
                  }
                }
                return <p {...props}>{children}</p>;
              },
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? "");
                const codeStr = String(children).replace(/\n$/, "");
                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                    >
                      {codeStr}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
