/**
 * Realtime Store — Zustand store for WebSocket-pushed daemon events
 *
 * Replaces polling patterns (setInterval → fetch → setState) with:
 *   ws.on('app.*', event => updateState)
 *
 * Components subscribe to specific slices of this store and get
 * instant updates when the daemon pushes events.
 */

import { create } from 'zustand';
import { getDaemonWsClient, type DaemonWsClient } from '../netron/ws-client.js';

interface AppEvent {
  name: string;
  pid: number | null;
  status: string;
  timestamp: number;
}

interface InfraEvent {
  service: string;
  status: string;
  timestamp: number;
}

interface AlertEvent {
  ruleId: string;
  ruleName: string;
  severity: string;
  message?: string;
  timestamp: number;
}

interface RealtimeState {
  /** WebSocket connection state */
  connected: boolean;

  /** Recent app events (last 50) */
  appEvents: AppEvent[];

  /** Recent infra events (last 20) */
  infraEvents: InfraEvent[];

  /** Active alerts from push */
  alerts: AlertEvent[];

  /** Last metrics update timestamp */
  lastMetricsUpdate: number;

  /** Last daemon event of any type */
  lastEvent: { channel: string; timestamp: number; data: unknown } | null;

  /** Active deploy progress events (stack.deploy_progress) */
  deployProgress: Array<{ node: string; app: string; status: string; progress: number; message: string; timestamp: number }>;

  /** Initialize WebSocket connection and event handlers */
  initialize: () => () => void;
}

// Module-level refcount for the shared WebSocket. Pre-fix every page
// that called `initialize()` returned a cleanup that called
// `ws.disconnect()` — when Dashboard unmounted, the singleton WS
// went down even though StatusBar + a freshly-mounted Apps page
// still needed it. Other pages then reported `connected=false`
// until something re-mounted Dashboard. The refcount fixes this: the
// last consumer's cleanup is the only one that actually tears down
// the socket; intermediate cleanups just decrement.
let activeConsumers = 0;
let teardown: (() => void) | null = null;

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  connected: false,
  appEvents: [],
  infraEvents: [],
  alerts: [],
  lastMetricsUpdate: 0,
  lastEvent: null,
  deployProgress: [],

  initialize: () => {
    activeConsumers += 1;
    if (teardown) {
      // Already initialised by an earlier consumer; reuse the live
      // socket and just hand back a refcount-aware cleanup.
      return () => {
        activeConsumers = Math.max(0, activeConsumers - 1);
        if (activeConsumers === 0 && teardown) {
          teardown();
          teardown = null;
        }
      };
    }
    const ws: DaemonWsClient = getDaemonWsClient();
    const unsubscribers: Array<() => void> = [];

    // Track connection state
    unsubscribers.push(
      ws.onConnection((connected) => {
        set({ connected });
      })
    );

    // App lifecycle events
    unsubscribers.push(
      ws.on('app.*', (event) => {
        const data = event.data as any;
        const appEvent: AppEvent = {
          name: data.name ?? 'unknown',
          pid: data.pid ?? null,
          status: event.channel.split('.')[1] ?? 'unknown',
          timestamp: event.timestamp,
        };

        set((state) => ({
          appEvents: [appEvent, ...state.appEvents].slice(0, 50),
          lastEvent: event,
        }));
      })
    );

    // Infrastructure events
    unsubscribers.push(
      ws.on('infra.*', (event) => {
        const data = event.data as any;
        const infraEvent: InfraEvent = {
          service: data.service ?? data.services?.join(', ') ?? 'unknown',
          status: event.channel.split('.')[1] ?? 'unknown',
          timestamp: event.timestamp,
        };

        set((state) => ({
          infraEvents: [infraEvent, ...state.infraEvents].slice(0, 20),
          lastEvent: event,
        }));
      })
    );

    // Alert events
    unsubscribers.push(
      ws.on('alert.*', (event) => {
        const data = event.data as any;
        const alertEvent: AlertEvent = {
          ruleId: data.ruleId ?? '',
          ruleName: data.ruleName ?? '',
          severity: data.severity ?? 'info',
          message: data.message,
          timestamp: event.timestamp,
        };

        set((state) => {
          if (event.channel === 'alert.resolved') {
            // Remove resolved alert
            return {
              alerts: state.alerts.filter((a) => a.ruleId !== alertEvent.ruleId),
              lastEvent: event,
            };
          }
          return {
            alerts: [alertEvent, ...state.alerts.filter((a) => a.ruleId !== alertEvent.ruleId)],
            lastEvent: event,
          };
        });
      })
    );

    // Metrics collected events (just update timestamp — actual data fetched on demand)
    unsubscribers.push(
      ws.on('metrics.collected', (event) => {
        set({ lastMetricsUpdate: event.timestamp, lastEvent: event });
      })
    );

    // Project events (project added/removed, config reloaded)
    unsubscribers.push(
      ws.on('project.*', (event) => {
        set({ lastEvent: event });
      })
    );

    // Stack events (stack lifecycle, deploy progress, node connectivity)
    unsubscribers.push(
      ws.on('stack.*', (event) => {
        // Track deploy progress for UI
        if (event.channel === 'stack.deploy_progress') {
          const data = event.data as any;
          set((state) => {
            const filtered = state.deployProgress.filter(
              (p) => !(p.node === data.node && p.app === data.app),
            );
            // Remove completed/failed entries after 30s
            const active = filtered.filter(
              (p) => Date.now() - p.timestamp < 30_000 || (p.status !== 'success' && p.status !== 'failed'),
            );
            return {
              deployProgress: [...active, { ...data, timestamp: event.timestamp }],
              lastEvent: event,
            };
          });
        } else {
          set({ lastEvent: event });
        }
      })
    );

    // Daemon events
    unsubscribers.push(
      ws.on('daemon.*', (event) => {
        set({ lastEvent: event });
      })
    );

    // Connect
    ws.connect();

    // Register the real teardown once. Per-consumer cleanups decrement
    // the refcount; only the last one drives `teardown()`.
    teardown = () => {
      for (const unsub of unsubscribers) unsub();
      ws.disconnect();
    };

    return () => {
      activeConsumers = Math.max(0, activeConsumers - 1);
      if (activeConsumers === 0 && teardown) {
        teardown();
        teardown = null;
      }
    };
  },
}));
