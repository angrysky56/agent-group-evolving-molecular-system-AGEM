/**
 * QuickActions — clickable buttons for common AGEM operations.
 *
 * Each button sends a message through the chat that triggers
 * the corresponding AGEM tool on the backend. Hover tooltips
 * explain what each tool does and when to use it.
 */

import { useState, useRef, useEffect } from "react";
import { useChatStore } from "../../stores/chat";
import { useSettingsStore } from "../../stores/settings";
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
  {
    icon: Play,
    label: "Run Cycle",
    desc: "Execute one full reasoning cycle. Agents discuss the topic, build the semantic graph, compute entropy metrics, and check for inconsistencies. Use this first to seed the system with a problem.",
    prompt: "Use the run_agem_cycle tool to execute one AGEM reasoning cycle on the current conversation topic.",
    color: "var(--accent-primary)",
  },
  {
    icon: BarChart3,
    label: "SOC Metrics",
    desc: "View Self-Organized Criticality metrics: Von Neumann Entropy, Embedding Entropy, CDP divergence, correlation, and phase transitions. Use after cycles to see if reasoning has stabilized or is still evolving.",
    prompt: "Use the get_soc_metrics tool to show current Self-Organized Criticality metrics.",
    color: "var(--info)",
  },
  {
    icon: GitBranch,
    label: "Cohomology",
    desc: "Analyze sheaf cohomology: H⁰ shows connected components, H¹ reveals inconsistencies between agent perspectives. Non-zero H¹ means agents disagree — the system will try to resolve this by spawning new agents.",
    prompt: "Use the get_cohomology tool to analyze the current sheaf cohomology state.",
    color: "var(--accent-secondary)",
  },
  {
    icon: Search,
    label: "Detect Gaps",
    desc: "Find structural gaps between concept communities in the semantic graph. Gaps are under-connected regions where knowledge doesn't flow well — potential blind spots in reasoning.",
    prompt: "Use the detect_gaps tool to find structural gaps in the TNA graph.",
    color: "var(--warning)",
  },
  {
    icon: HelpCircle,
    label: "Catalyst Q's",
    desc: "Generate bridging questions designed to close detected gaps. These are questions that connect two disconnected concept clusters — answering them forces the system to build new semantic links.",
    prompt: "Use the generate_catalyst_questions tool to create bridging questions for detected gaps.",
    color: "var(--success)",
  },
  {
    icon: Crosshair,
    label: "Graph Topology",
    desc: "Fetch the full semantic network graph for visualization. Shows all concept nodes, their community groupings, and weighted edges. Switch to the Graph tab to see it rendered.",
    prompt: "Use the get_graph_topology tool to show the current TNA graph for visualization.",
    color: "var(--info)",
  },
  {
    icon: Brain,
    label: "Engine State",
    desc: "Get a snapshot of the full engine state: iteration count, operational mode, agent count, graph size, sheaf energy, and gap count. Good for a quick health check.",
    prompt: "Use the get_agem_state tool to retrieve the current AGEM engine state.",
    color: "var(--text-secondary)",
  },
  {
    icon: RefreshCw,
    label: "Reset",
    desc: "Wipe everything and start fresh. Clears the semantic graph, all metrics history, and resets iteration count to zero. Use when you want to analyze a completely new topic.",
    prompt: "Use the reset_agem_engine tool to reset the AGEM engine to a clean state.",
    color: "var(--error)",
  },
] as const;

/** Floating tooltip that appears above the hovered button. */
function Tooltip({ text, anchorRef }: {
  text: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const parent = anchorRef.current.closest(".quick-actions");
      const parentRect = parent?.getBoundingClientRect();
      if (parentRect) {
        setPos({
          left: rect.left - parentRect.left + rect.width / 2,
          bottom: parentRect.bottom - rect.top + 6,
        });
      }
    }
  }, [anchorRef]);

  return (
    <div className="qa-tooltip" style={{
      left: pos.left,
      bottom: pos.bottom,
    }}>
      {text}
    </div>
  );
}

/** Single action button with hover tooltip. */
function ActionButton({ action, disabled, onClick }: {
  action: typeof ACTIONS[number];
  disabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { icon: Icon, label, desc, color } = action;

  return (
    <>
      <button
        ref={ref}
        className="quick-actions__btn"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Icon size={16} color={color} />
        <span>{label}</span>
      </button>
      {hovered && <Tooltip text={desc} anchorRef={ref} />}
    </>
  );
}

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
      {
        message: prompt,
        session_id: activeSessionId ?? undefined,
        model: useSettingsStore.getState().chatModel,
        provider: useSettingsStore.getState().provider,
      },
      {
        onToken: (text) => appendStreamingContent(text),
        onAgemState: (data) => updateState(data as any),
        onClearStream: () => setStreamingContent(""),
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
      useSettingsStore.getState().provider === "openrouter"
        ? useSettingsStore.getState().apiKey
        : undefined,
    );
    setAbortController(controller);
  };

  return (
    <div className="quick-actions">
      <div className="quick-actions__title">Quick Actions</div>
      <div className="quick-actions__grid">
        {ACTIONS.map((action) => (
          <ActionButton
            key={action.label}
            action={action}
            disabled={isStreaming}
            onClick={() => handleAction(action.prompt)}
          />
        ))}
      </div>
    </div>
  );
}
