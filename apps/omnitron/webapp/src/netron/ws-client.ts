/**
 * Daemon events, pushed — over the daemon's Netron WebSocket transport, in
 * the protocol that transport speaks.
 *
 * This opened a raw WebSocket to that transport and waited for JSON
 * `{channel, timestamp, data}` nobody sent, pinging it with `{type:'ping'}`
 * it did not understand — and on the other side `OmnitronEvents.subscribe`
 * registered an empty callback. Not one event ever arrived. Worse, the
 * socket OPENED, so this reported itself connected, and the apps, dashboard
 * and nodes pages slowed their polling from 5 s to 15 s on the strength of a
 * feed that delivered nothing: the operator had a console three times slower
 * to notice anything, saying it was live.
 *
 * Now it is a Netron client. It opens `/ws` with no token in the URL (a URL
 * is written to the proxy's access log, and a token there is a session
 * there), authenticates over the open connection — the `authenticate` core
 * task — subscribes (`OmnitronEvents.subscribe`), and only then says it is
 * connected. Events arrive as the daemon's `emit` of `DAEMON_EVENT_TASK`, to
 * this connection alone. A reconnect is a new peer to the daemon, so it
 * authenticates and subscribes again.
 */

import { WebSocketClient } from '@omnitron-dev/prism/netron';
import { DAEMON_EVENT_TASK, type DaemonEvent } from '@omnitron-dev/omnitron/dto/events';

import { getStorageToken } from './client';

type EventCallback = (event: DaemonEvent) => void;
type ConnectionCallback = (connected: boolean) => void;

/** Every group the console's store listens to (`stores/realtime.store.ts`). */
export const CONSOLE_CHANNELS = [
  'app.*',
  'infra.*',
  'alert.*',
  'metrics.collected',
  'project.*',
  'stack.*',
  'node.*',
  'daemon.*',
];

/** What this needs of a Netron WebSocket client — the real one, or a court's. */
export interface EventSocket {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runTask<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
  invoke(service: string, method: string, args: unknown[]): Promise<unknown>;
  onTask(name: string, handler: (...args: any[]) => unknown): unknown;
  on(event: string, handler: (...args: any[]) => void): unknown;
}

interface DaemonWsClientOptions {
  url?: string;
  /** The session to authenticate with; the console's own by default. */
  token?: () => string | null | undefined;
  channels?: string[];
  socket?: (url: string) => EventSocket;
}

/**
 * Where the console's WebSocket lives, given the page it is running on.
 *
 * The answer is always "this origin, path `/ws`": both nginx in front of the
 * built console and the vite dev server proxy `/ws` to the daemon's Netron WS
 * transport, so the client never needs to know that port — and must not
 * guess it.
 *
 * It used to guess. The port came from `window.location.port || '9802'`, and
 * the fallback fires exactly when the console is served on a default port —
 * that is, behind a real proxy on 80 or 443. There it produced
 * `wss://host:9802/ws`: past the proxy, straight at a daemon port that
 * deployment does not publish, over a plaintext transport the browser blocks
 * from an https page. The failure is silent — the socket never opens, the
 * console falls back to polling, and nothing says why.
 *
 * `location.host` carries the port when there is one and omits it when the
 * protocol's default applies, which is precisely the rule wanted here.
 */
export function resolveWsUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

export class DaemonWsClient {
  private socket: EventSocket | null = null;
  private readonly eventListeners = new Map<string, Set<EventCallback>>();
  private readonly connectionListeners = new Set<ConnectionCallback>();
  private _connected = false;

  constructor(private readonly options: DaemonWsClientOptions = {}) {}

  /** Subscribed and receiving — not merely a socket that opened. */
  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.socket) return;
    const url = this.options.url ?? resolveWsUrl(window.location);
    const socket =
      this.options.socket?.(url) ??
      (new WebSocketClient({ url, reconnect: true, maxReconnectAttempts: Infinity }) as unknown as EventSocket);
    this.socket = socket;

    socket.onTask('emit', (name: unknown, event: unknown) => {
      if (name === DAEMON_EVENT_TASK) this.dispatchEvent(event as DaemonEvent);
    });
    socket.on('disconnect', () => this.setConnected(false));
    // After Netron's own handshake, which `connect()` also waits for: a
    // request sent before it has nowhere to be answered.
    socket.on('reconnect', () => void this.handshake(socket));
    socket
      .connect()
      .then(() => this.handshake(socket))
      .catch(() => this.setConnected(false));
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.setConnected(false);
    void socket?.disconnect().catch(() => undefined);
  }

  /** Listen to a channel (`app.started`), a group (`app.*`), or everything (`*`). */
  on(channel: string, callback: EventCallback): () => void {
    let listeners = this.eventListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(channel, listeners);
    }
    listeners.add(callback);

    return () => {
      listeners!.delete(callback);
      if (listeners!.size === 0) {
        this.eventListeners.delete(channel);
      }
    };
  }

  onConnection(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    return () => this.connectionListeners.delete(callback);
  }

  /** Authenticate over the open connection, then subscribe; connected only once both answered. */
  private async handshake(socket: EventSocket): Promise<void> {
    const token = (this.options.token ?? getStorageToken)();
    if (!token || socket !== this.socket) return this.setConnected(false);
    try {
      const auth = await socket.runTask<{ success?: boolean }>('authenticate', { token });
      if (!auth?.success) return this.setConnected(false);
      await socket.invoke('OmnitronEvents', 'subscribe', [{ channels: this.options.channels ?? CONSOLE_CHANNELS }]);
      if (socket === this.socket) this.setConnected(true);
    } catch {
      this.setConnected(false);
    }
  }

  private setConnected(connected: boolean): void {
    if (this._connected === connected) return;
    this._connected = connected;
    for (const cb of this.connectionListeners) {
      try {
        cb(connected);
      } catch {
        // A listener's fault is not the connection's.
      }
    }
  }

  private dispatchEvent(event: DaemonEvent): void {
    const exact = this.eventListeners.get(event.channel);
    if (exact) {
      for (const cb of exact) cb(event);
    }

    for (const [pattern, listeners] of this.eventListeners) {
      if (pattern === '*') {
        for (const cb of listeners) cb(event);
      } else if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (event.channel.startsWith(prefix + '.')) {
          for (const cb of listeners) cb(event);
        }
      }
    }
  }
}

let _wsClient: DaemonWsClient | null = null;

export function getDaemonWsClient(): DaemonWsClient {
  if (!_wsClient) {
    _wsClient = new DaemonWsClient();
  }
  return _wsClient;
}
