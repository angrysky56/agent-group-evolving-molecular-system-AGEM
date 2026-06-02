/**
 * ToolResultBubble — Structured rendering for AGEM tool outputs.
 * Improves visibility of "what sub-agents are doing" by parsing
 * raw tool results into formatted UI summaries.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, Clock, Box } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface Props {
  tool: string;
  elapsedMs: number;
  output: string;
}

export function ToolResultBubble({ tool, elapsedMs, output }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  // Attempt to parse output if it's JSON for better summary
  let parsed = null;
  try {
    if (output.trim().startsWith("{") || output.trim().startsWith("[")) {
      parsed = JSON.parse(output);
    }
  } catch {
    // Keep as string
  }

  const isVdW = tool.toLowerCase().includes("vdw");


  return (
    <div className={`tool-result ${isVdW ? "tool-result--vdw" : ""}`}>
      <button
        className="tool-result__header"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="tool-result__icon">
          {isVdW ? <Box size={14} /> : <Terminal size={14} />}
        </div>
        <div className="tool-result__label">
          <span className="tool-result__name">{tool}</span>
          <span className="tool-result__time">
            <Clock size={10} /> {elapsedMs}ms
          </span>
        </div>
        <div className="tool-result__chevron">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {isOpen && (
        <div className="tool-result__content">
          {parsed ? (
            <SyntaxHighlighter
              style={oneDark}
              language="json"
              PreTag="div"
              className="tool-result__code"
              customStyle={{
                margin: 0,
                padding: "12px",
                fontSize: "12px",
                background: "transparent",
              }}
            >
              {JSON.stringify(parsed, null, 2)}
            </SyntaxHighlighter>
          ) : (
            <div className="tool-result__raw">{output}</div>
          )}
        </div>
      )}
    </div>
  );
}
