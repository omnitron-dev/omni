/**
 * NetronTelemetryTransport — Implements TelemetryTransport via Netron HTTP
 *
 * Ships telemetry entries from follower nodes to the leader's aggregator
 * using the Netron RPC protocol over HTTP. Uses the OmnitronTelemetry
 * service's pushBatch method on the leader's HTTP transport (port 9800).
 *
 * Connection lifecycle:
 *   connect() → validates leader is reachable via ping
 *   send()    → POSTs batch to leader's Netron HTTP invoke endpoint
 *   disconnect() → clears connected state
 *
 * Designed for store-and-forward — the TelemetryRelay handles buffering
 * and WAL persistence. This transport only needs to be a thin delivery pipe.
 */

import type {
  TelemetryTransport,
  TelemetryEntry,
} from '@omnitron-dev/titan-telemetry-relay';

// =============================================================================
// Transport
// =============================================================================

export class NetronTelemetryTransport implements TelemetryTransport {
  private _connected = false;
  private readonly nodeId: string;

  constructor(
    private readonly leaderHost: string,
    private readonly leaderPort: number,
    nodeId?: string
  ) {
    this.nodeId = nodeId ?? `node-${process.pid}`;
  }

  /**
   * Send a batch of telemetry entries to the leader aggregator.
   * Uses Netron HTTP invoke protocol to call OmnitronTelemetry.pushBatch().
   * Returns the number of acknowledged entries.
   */
  async send(entries: TelemetryEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const url = `http://${this.leaderHost}:${this.leaderPort}/netron/invoke`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'OmnitronTelemetry',
        method: 'pushBatch',
        input: [{ nodeId: this.nodeId, entries }],
        id: crypto.randomUUID(),
        version: '1.0',
        timestamp: Date.now(),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      this._connected = false;
      throw new Error(`Telemetry push failed: HTTP ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as { data?: { ackd?: number } };
    return result?.data?.ackd ?? entries.length;
  }

  /**
   * Check if the transport considers itself connected to the leader.
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the leader — validates reachability via a lightweight ping.
   */
  async connect(): Promise<void> {
    try {
      const url = `http://${this.leaderHost}:${this.leaderPort}/netron/invoke`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'Omnitron',
          method: 'ping',
          input: [],
          id: crypto.randomUUID(),
          version: '1.0',
          timestamp: Date.now(),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      this._connected = response.ok;
    } catch {
      this._connected = false;
      throw new Error(`Cannot connect to leader at ${this.leaderHost}:${this.leaderPort}`);
    }
  }

  /**
   * Disconnect from the leader — clears connected state.
   */
  async disconnect(): Promise<void> {
    this._connected = false;
  }
}
