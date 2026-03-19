/**
 * QuickActions — clickable buttons for common AGEM operations.
 *
 * Each button sends a message through the chat that triggers
 * the corresponding AGEM tool on the backend.
 */

import { useChatStore } from "../../stores/chat";
import { streamChat } from "../../api";
import { useAgemStore } from "../../stores/agem";
import {
  Play,
  BarChart3,
  Search,
  Crosshair,
  HelpCircle,
  RefreshCw,
  GitBranch,
  Brain,
} from "lucide-react";

const ACTIONS = [
  { icon: Play, label: "Run Cycle", prompt: "Use the run_agem_cycle tool to execute one AGEM reasoning cycle on the current conversation topic.", color: "var(--accent-primary)" },
  { icon: BarChart3, label: "SOC Metrics", prompt: "Use the get_soc_metrics tool to show current Self-Organized Criticality metrics.", color: "var(--info)" },
  { icon: GitBranch, label: "Cohomology", prompt: "Use the get_cohomology tool to analyze the current sheaf cohomology state.", color: "var(--accent-secondary)" },
  { icon: Search, label: "Detect Gaps", prompt: "Use the detect_gaps tool to find structural gaps in the TNA graph.", color: "var(--warning)" },
  { icon: HelpCircle, label: "Catalyst Q's", prompt: "Use the generate_catalyst_questions tool to create bridging questions for detected gaps.", color: "var(--success)" },
  { icon: Crosshair, label: "Graph Topology", prompt: "Use the get_graph_topology tool to show the current TNA graph for visualization.", color: "var(--info)" },
  { icon: Brain, label: "Engine State", prompt: "Use the get_agem_state tool to retrieve the current AGEM engine state.", color: "var(--text-secondary)" },
  { icon: RefreshCw, label: "Reset Engine", prompt: "Use the reset_agem_engine tool to reset the AGEM engine to a clean state.", color: "var(--error)" },
] as const;

export function QuickActions() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const addMessage = useChatStore((s) => s.addMessage);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const appendStreamingContent = useChatStore((s) => s.appendStreamingContent);
  const setStreamingContent = useChatStore((s) => s.setStreamingContent);
  const setAbortController = useChatStore((s) => s.setAbortController);
  const updateState = useAgemStore((s) => s.updateState);

  const handleAction = (prompt: string) => {
    if (isStreaming) return;

    // Add user message to chat
    const userMsg = {
      id: `qa-${Date.now()}`,
      role: "user" as const,
      content: prompt,
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setIsStreaming(true);
    setStreamingContent("");

    const controller = streamChat(
      { message: prompt, session_id: activeSessionId ?? undefined },
      {
        onToken: (text) => appendStreamingContent(text),
        onAgemState: (data) => updateState(data as any),
        onDone: (message) => {
          addMessage(message);
          setIsStreaming(false);
          setStreamingContent("");
          setAbortController(null);
        },
        onError: (error) => {
          console.error("[QuickAction]", error);
          setIsStreaming(false);
          setStreamingContent("");
          setAbortController(null);
        },
      },
    );
    setAbortController(controller);
  };

  return (
    <div className="quick-actions">
      <div className="quick-actions__title">Quick Actions</div>
      <div className="quick-actions__grid">
        {ACTIONS.map(({ icon: Icon, label, prompt, color }) => (
          <button
            key={label}
            className="quick-actions__btn"
            onClick={() => handleAction(prompt)}
            disabled={isStreaming}
            title={label}
          >
            <Icon size={16} color={color} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
