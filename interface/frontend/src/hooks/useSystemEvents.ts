/**
 * useSystemEvents — SSE connection hook for AGEM system events.
 *
 * Connects to /api/v1/system/events on mount, parses incoming
 * system_event SSE messages, and populates useAgemStore.
 * Handles reconnection with exponential backoff.
 */

import { useEffect, useRef } from "react";
import { useAgemStore } from "../stores/agem";
import type { SOCDataPoint } from "../stores/agem";
import type { SystemEvent } from "@shared/types";

/** Event types that should trigger toast notifications. */
const TOAST_TYPES = new Set([
  "soc:system1-early-convergence",
  "lumpability:weak-compression",
  "phase:transition",
  "sheaf:h1-obstruction-detected",
]);

export function useSystemEvents() {
  const retryRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  const updateState = useAgemStore((s) => s.updateState);
  const addSOCDataPoint = useAgemStore((s) => s.addSOCDataPoint);
  const addEvent = useAgemStore((s) => s.addEvent);
  const addToast = useAgemStore((s) => s.addToast);
  const setSseConnected = useAgemStore((s) => s.setSseConnected);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      const es = new EventSource("/api/v1/system/events");
      esRef.current = es;

      es.onopen = () => {
        setSseConnected(true);
        retryRef.current = 0;
      };

      es.addEventListener("system_event", (e) => {
        try {
          const event: SystemEvent = JSON.parse(e.data);

          // Always add to event log
          addEvent(event);

          // Route by event type
          if (event.type === "agem:state-update" && event.data?.state) {
            updateState(event.data.state as any);
          }

          if (event.type === "soc:metrics" && event.data) {
            const d = event.data;
            const point: SOCDataPoint = {
              iteration: (d.iteration as number) ?? 0,
              vne: (d.vne as number) ?? 0,
              ee: (d.ee as number) ?? 0,
              cdp: (d.cdp as number) ?? 0,
              ser: (d.ser as number) ?? 0,
              correlation: (d.correlation as number) ?? 0,
            };
            addSOCDataPoint(point);
          }

          // Toast for critical events
          if (TOAST_TYPES.has(event.type)) {
            addToast(event);
          }
        } catch {
          // Skip malformed events
        }
      });

      es.onerror = () => {
        setSseConnected(false);
        es.close();
        esRef.current = null;

        // Exponential backoff reconnect (max 30s)
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000);
        retryRef.current++;
        setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      mounted = false;
      esRef.current?.close();
      esRef.current = null;
      setSseConnected(false);
    };
  }, [updateState, addSOCDataPoint, addEvent, addToast, setSseConnected]);
}
