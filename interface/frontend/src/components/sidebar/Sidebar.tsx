/**
 * Sidebar — Session list, new session button, and knowledge explorer.
 */

import { useEffect, useCallback } from "react";
import { Plus, MessageSquare, Trash2, Folder, FileText } from "lucide-react";
import { useChatStore } from "../../stores/chat";
import { useSessionStore } from "../../stores/sessions";
import {
  listSessions,
  createSession,
  deleteSession,
  getSession,
} from "../../api";

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const setSessions = useSessionStore((s) => s.setSessions);
  const removeSession = useSessionStore((s) => s.removeSession);
  const addSession = useSessionStore((s) => s.addSession);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSessionId = useChatStore((s) => s.setActiveSessionId);
  const setMessages = useChatStore((s) => s.setMessages);

  // Load sessions on mount
  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((err) => console.error("Failed to load sessions:", err));
  }, [setSessions]);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await createSession({});
      addSession(session);
      setActiveSessionId(session.id);
      setMessages([]);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }, [addSession, setActiveSessionId, setMessages]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      setActiveSessionId(id);
      try {
        const session = await getSession(id);
        setMessages(session.messages ?? []);
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [setActiveSessionId, setMessages],
  );

  const handleDeleteSession = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await deleteSession(id);
        removeSession(id);
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [activeSessionId, removeSession, setActiveSessionId, setMessages],
  );

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__title">AGEM</span>
        <button
          className="btn--icon"
          onClick={handleNewSession}
          aria-label="New session"
          id="new-session-button"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="sidebar__section">
        <div className="sidebar__section-label">Sessions</div>
        {sessions.length === 0 ? (
          <div
            style={{
              padding: "12px 20px",
              fontSize: "12px",
              color: "var(--text-muted)",
            }}
          >
            No sessions yet
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`session-item ${
                activeSessionId === session.id ? "session-item--active" : ""
              }`}
              onClick={() => handleSelectSession(session.id)}
            >
              <MessageSquare size={14} />
              <span className="session-item__title">
                {session.title || "New Session"}
              </span>
              <button
                className="session-item__delete"
                onClick={(e) => handleDeleteSession(session.id, e)}
                aria-label={`Delete session ${session.title}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar__section" style={{ flex: "0 0 auto" }}>
        <div className="sidebar__section-label">Knowledge Base</div>
        <div className="knowledge-explorer">
          <div className="knowledge-file">
            <Folder size={12} />
            <span>reports/</span>
          </div>
          <div className="knowledge-file">
            <Folder size={12} />
            <span>analysis/</span>
          </div>
          <div className="knowledge-file">
            <Folder size={12} />
            <span>outputs/</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
