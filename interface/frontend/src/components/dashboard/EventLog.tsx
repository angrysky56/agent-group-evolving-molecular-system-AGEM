/**
 * EventLog — scrollable filtered stream of AGEM system events.
 *
 * Shows recent events with severity badges and timestamps.
 * Auto-scrolls to bottom on new events.
 */

import { useRef, useEffect } from "react";
import { useAgemStore } from "../../stores/agem";
import {
  CheckCircle,
  Info,
  AlertTriangle,
  AlertOctagon,
  Trash2,
} from "lucide-react";

const SEVERITY_ICON = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  critical: AlertOctagon,
};

const SEVERITY_COLOR = {
  info: "var(--info)",
  success: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--error)",
};

export function EventLog() {
  const events = useAgemStore((s) => s.eventLog);
  const clearEvents = useAgemStore((s) => s.clearEvents);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [events.length]);

  return (
    <div className="event-log">
      <div className="event-log__header">
        <span className="event-log__count">
          {events.length} events
        </span>
        <button
          className="btn--icon"
          onClick={clearEvents}
          title="Clear events"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="event-log__scroll" ref={scrollRef}>
        {events.length === 0 ? (
          <div className="event-log__empty">
            No events yet. Run an AGEM cycle to see system activity.
          </div>
        ) : (
          events.map((evt) => {
            const Icon = SEVERITY_ICON[evt.severity];
            const color = SEVERITY_COLOR[evt.severity];
            const time = new Date(evt.timestamp)
              .toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
            return (
              <div key={evt.id} className="event-log__item">
                <Icon size={14} color={color} style={{ flexShrink: 0 }} />
                <span className="event-log__time">{time}</span>
                <span className="event-log__type">{evt.type}</span>
                <span className="event-log__summary">{evt.summary}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
