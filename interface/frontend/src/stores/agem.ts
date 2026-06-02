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

/** Information about an active VdW sub-agent probe. */
export interface SubAgentInfo {
  id: string;
  gapId: string;
  startTime: number;
  steps: number;
  status: "running" | "complete" | "failed";
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
  /** Active sub-agents (VdW probes) */
  activeSubAgents: SubAgentInfo[];
  /** Token usage history */
  usageHistory: { timestamp: number; total: number }[];

  // Actions
  updateState: (state: AgemStateSnapshot) => void;
  addSOCDataPoint: (point: SOCDataPoint) => void;
  addEvent: (event: SystemEvent) => void;
  spawnSubAgent: (
    info: Omit<SubAgentInfo, "startTime" | "status" | "steps">,
  ) => void;
  completeSubAgent: (id: string, success: boolean, steps: number) => void;
  setActiveTab: (tab: DashboardTab) => void;
  setSseConnected: (connected: boolean) => void;
  addToast: (event: SystemEvent) => void;
  removeToast: (id: string) => void;
  clearEvents: () => void;
  setSocHistory: (history: SOCDataPoint[]) => void;
  addUsageDataPoint: (total: number) => void;
  /** Clear all session-scoped state (graph, metrics, events) for session switching. */
  resetForSession: () => void;
}

let toastCounter = 0;

export const useAgemStore = create<AgemSystemState>((set) => ({
  state: null,
  socHistory: [],
  eventLog: [],
  activeTab: "graph",
  sseConnected: false,
  toasts: [],
  activeSubAgents: [],
  usageHistory: [],

  updateState: (state) => set({ state }),

  addSOCDataPoint: (point) =>
    set((s) => ({
      socHistory: [...s.socHistory.slice(-99), point],
    })),

  setSocHistory: (history) => set({ socHistory: history }),

  addEvent: (event) =>
    set((s) => ({
      eventLog: [...s.eventLog.slice(-199), event],
    })),

  spawnSubAgent: (info) =>
    set((s) => ({
      activeSubAgents: [
        ...s.activeSubAgents,
        { ...info, startTime: Date.now(), status: "running", steps: 0 },
      ],
    })),

  completeSubAgent: (id, success, steps) =>
    set((s) => ({
      activeSubAgents: s.activeSubAgents.map((a) =>
        a.id === id
          ? { ...a, status: success ? "complete" : ("failed" as const), steps }
          : a,
      ),
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
  addUsageDataPoint: (total) =>
    set((s) => ({
      usageHistory: [
        ...s.usageHistory.slice(-49),
        { timestamp: Date.now(), total },
      ],
    })),

  resetForSession: () =>
    set({
      state: null,
      socHistory: [],
      eventLog: [],
      toasts: [],
      activeSubAgents: [],
      usageHistory: [],
    }),
}));
