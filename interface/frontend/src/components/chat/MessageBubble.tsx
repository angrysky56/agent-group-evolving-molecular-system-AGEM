/**
 * MessageBubble — Renders a single chat message with markdown.
 */

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { User, Bot } from "lucide-react";
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

  return (
    <div className="message" ref={ref}>
      <div
        className={`message__avatar message__avatar--${isUser ? "user" : "assistant"}`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="message__body">
        <div className="message__role">{message.role}</div>
        <div className="message__content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
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
