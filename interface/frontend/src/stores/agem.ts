/**
 * AGEM Interface — System Store.
 *
 * Manages AGEM engine state, SOC metrics history, event log,
 * and dashboard UI state. Separate from chat store to enable
 * independent system event streaming.
 */

import { create } from "zustand";
import type { AgemStateSnapshot, SystemEvent } from "@shared/types";

/** A single SOC metrics data point for sparkline rendering. */
export interface SOCDataPoint {
  iteration: number;
  vne: number;
  ee: number;
  cdp: number;
  ser: number;
  correlation: number;
}

export type DashboardTab = "graph" | "metrics" | "events" | "tools";

export interface AgemSystemState {
  /** Most recent engine state snapshot */
  state: AgemStateSnapshot | null;
  /** SOC metrics time series (last 100 data points) */
  socHistory: SOCDataPoint[];
  /** System event log (last 200 events) */
  eventLog: SystemEvent[];
  /** Active dashboard tab */
  activeTab: DashboardTab;
  /** Whether the system events SSE is connected */
  sseConnected: boolean;
  /** Toast notifications queue */
  toasts: Array<{ id: string; event: SystemEvent; expiresAt: number }>;

  // Actions
  updateState: (state: AgemStateSnapshot) => void;
  addSOCDataPoint: (point: SOCDataPoint) => void;
  addEvent: (event: SystemEvent) => void;
  setActiveTab: (tab: DashboardTab) => void;
  setSseConnected: (connected: boolean) => void;
  addToast: (event: SystemEvent) => void;
  removeToast: (id: string) => void;
  clearEvents: () => void;
}

let toastCounter = 0;

export const useAgemStore = create<AgemSystemState>((set) => ({
  state: null,
  socHistory: [],
  eventLog: [],
  activeTab: "graph",
  sseConnected: false,
  toasts: [],

  updateState: (state) => set({ state }),

  addSOCDataPoint: (point) =>
    set((s) => ({
      socHistory: [...s.socHistory.slice(-99), point],
    })),

  addEvent: (event) =>
    set((s) => ({
      eventLog: [...s.eventLog.slice(-199), event],
    })),

  setActiveTab: (activeTab) => set({ activeTab }),
  setSseConnected: (sseConnected) => set({ sseConnected }),

  addToast: (event) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id: `toast-${++toastCounter}`,
          event,
          expiresAt: Date.now() + 8000,
        },
      ].slice(-5), // max 5 toasts visible
    })),

  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  clearEvents: () => set({ eventLog: [] }),
}));
