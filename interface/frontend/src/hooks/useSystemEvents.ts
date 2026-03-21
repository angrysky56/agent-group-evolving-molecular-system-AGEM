/**
 * useSystemEvents — SSE connection hook for AGEM system events.
 *
 * Connects to /api/v1/system/events on mount, parses incoming
 * system_event SSE messages, and populates useAgemStore.
 * Handles reconnection with exponential backoff.
 * Hydrates state + SOC history from REST on initial connect.
 */

import { useEffect, useRef } from "react";
import { useAgemStore } from "../stores/agem";
import type { SOCDataPoint } from "../stores/agem";
import type { SystemEvent } from "@shared/types";
import { getAgemSOC } from "../api";

/** Event types that should trigger toast notifications. */
const TOAST_TYPES = new Set([
  "soc:system1-early-convergence",
  "lumpability:weak-compression",
  "phase:transition",
  "sheaf:h1-obstruction-detected",
]);

/** Hydrate SOC sparkline history from REST endpoint. */
async function hydrateSOCHistory() {
  try {
    const soc = await getAgemSOC();
    if (soc?.history?.length > 0) {
      const store = useAgemStore.getState();
      const points: SOCDataPoint[] = soc.history.map((h: any) => ({
        iteration: h.iteration ?? 0,
        vne: h.von_neumann_entropy ?? 0,
        ee: h.embedding_entropy ?? 0,
        cdp: h.cdp ?? 0,
        ser: h.surprising_edge_ratio ?? 0,
        correlation: h.correlation_coefficient ?? 0,
      }));
      store.setSocHistory(points);
    }
  } catch {
    // Backend may not be ready yet
  }
}

export function useSystemEvents() {
  const retryRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let mounted = true;
    let hydrated = false;

    function connect() {
      if (!mounted) return;

      const es = new EventSource("/api/v1/system/events");
      esRef.current = es;

      es.onopen = () => {
        useAgemStore.getState().setSseConnected(true);
        retryRef.current = 0;
        // Hydrate SOC history on first connect (or reconnect)
        if (!hydrated) {
          hydrated = true;
          void hydrateSOCHistory();
        }
      };

      es.addEventListener("system_event", (e) => {
        try {
          const event: SystemEvent = JSON.parse(e.data);
          const store = useAgemStore.getState();

          // Always add to event log
          store.addEvent(event);

          // Route by event type
          if (event.type === "agem:state-update" && event.data?.state) {
            const state = event.data.state as any;
            if (state.iteration > 0 || !store.state) {
              store.updateState(state);
            }
            // Extract SOC data point from embedded metrics
            if (state.soc?.latest) {
              const soc = state.soc.latest;
              store.addSOCDataPoint({
                iteration: soc.iteration ?? state.iteration ?? 0,
                vne: soc.von_neumann_entropy ?? 0,
                ee: soc.embedding_entropy ?? 0,
                cdp: soc.cdp ?? 0,
                ser: soc.surprising_edge_ratio ?? 0,
                correlation: soc.correlation_coefficient ?? 0,
              });
            }
          }

          if (event.type === "soc:metrics" && event.data) {
            const d = event.data;
            store.addSOCDataPoint({
              iteration: (d.iteration as number) ?? 0,
              vne: (d.vne as number) ?? 0,
              ee: (d.ee as number) ?? 0,
              cdp: (d.cdp as number) ?? 0,
              ser: (d.ser as number) ?? 0,
              correlation: (d.correlation as number) ?? 0,
            });
          }

          if (TOAST_TYPES.has(event.type)) {
            store.addToast(event);
          }
        } catch {
          // Skip malformed events
        }
      });

      es.onerror = () => {
        useAgemStore.getState().setSseConnected(false);
        es.close();
        esRef.current = null;
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
      useAgemStore.getState().setSseConnected(false);
    };
  }, []);
}
