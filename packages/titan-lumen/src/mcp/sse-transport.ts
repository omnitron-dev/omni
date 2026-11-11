import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccessFilterService } from '../access/access-filter.service.js';
import { LiveEditService } from '../live/live-edit.service.js';
import type { LumenSessionContext, SseMcpTransportOptions, TransportAuthResult } from '../interfaces.js';

export const DEFAULT_MAX_SSE_CONNECTIONS = 100;
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

const activeSseConnections = new WeakMap<LiveEditService, number>();

export function getActiveSseConnections(liveEditService: LiveEditService): number {
  return activeSseConnections.get(liveEditService) ?? 0;
}

function isPromiseLike<T>(val: unknown): val is PromiseLike<T> {
  return (
    val !== null &&
    (typeof val === 'object' || typeof val === 'function') &&
    typeof (val as { then?: unknown }).then === 'function'
  );
}

function getHeaderString(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers?.[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return typeof raw === 'string' ? raw : undefined;
}

function sendSseError(res: ServerResponse, statusCode: number, message: string): void {
  if (res.writableEnded || (res as { destroyed?: boolean }).destroyed) {
    return;
  }
  res.statusCode = statusCode;
  if (typeof res.writeHead === 'function') {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  } else if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  res.end(JSON.stringify({ error: message }));
}

function evaluateAuthResult(authResult: TransportAuthResult): {
  authorized: boolean;
  session?: LumenSessionContext;
} {
  if (authResult === false || authResult === null || authResult === undefined) {
    return { authorized: false };
  }
  if (authResult === true) {
    return { authorized: true };
  }
  if (typeof authResult === 'object' && 'valid' in authResult) {
    if (authResult.valid !== true) {
      return { authorized: false };
    }
    return { authorized: true, session: authResult };
  }
  return { authorized: false };
}

function establishSseStream(
  req: IncomingMessage,
  res: ServerResponse,
  liveEditService: LiveEditService,
  accessFilter: AccessFilterService,
  clientRoles: string[],
  maxConnections: number,
  heartbeatIntervalMs: number
): void {
  if (res.writableEnded || (res as { destroyed?: boolean }).destroyed) {
    return;
  }

  const currentCount = activeSseConnections.get(liveEditService) ?? 0;
  if (currentCount >= maxConnections) {
    sendSseError(res, 429, 'Too Many Requests: SSE connection limit exceeded');
    return;
  }

  activeSseConnections.set(liveEditService, currentCount + 1);

  if (liveEditService.getMaxListeners() < maxConnections + 10) {
    liveEditService.setMaxListeners(maxConnections + 10);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Initial connection readiness event
  res.write(`event: ready\ndata: ${JSON.stringify({ status: 'connected', timestamp: Date.now() })}\n\n`);

  let cleanedUp = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const listener = (event: { access?: string; [key: string]: unknown }): void => {
    if (res.writableEnded || (res as { destroyed?: boolean }).destroyed) {
      cleanup();
      return;
    }

    const eventAccess = typeof event?.access === 'string' && event.access.length > 0 ? event.access : 'public';
    if (!accessFilter.isAllowed(clientRoles, eventAccess)) {
      return;
    }

    try {
      res.write(`event: live-edit\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      cleanup();
    }
  };

  function cleanup(): void {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    liveEditService.off('live-edit', listener);
    const active = activeSseConnections.get(liveEditService) ?? 1;
    activeSseConnections.set(liveEditService, Math.max(0, active - 1));
  }

  if (heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      if (res.writableEnded || (res as { destroyed?: boolean }).destroyed) {
        cleanup();
        return;
      }
      try {
        res.write(': keep-alive\n\n');
      } catch {
        cleanup();
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
  }

  liveEditService.on('live-edit', listener);

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function handleSseMcpConnection(
  req: IncomingMessage,
  res: ServerResponse,
  liveEditService: LiveEditService,
  transportOptions?: SseMcpTransportOptions
): void {
  // Origin allowlist check (HTTP 403)
  if (transportOptions?.allowedOrigins) {
    const origin = getHeaderString(req, 'origin');
    const allowWildcard = transportOptions.allowedOrigins.includes('*');
    if (!allowWildcard && (!origin || !transportOptions.allowedOrigins.includes(origin))) {
      sendSseError(res, 403, 'Forbidden: Origin not allowed');
      return;
    }
  }

  const maxConnections = transportOptions?.maxConnections ?? DEFAULT_MAX_SSE_CONNECTIONS;
  const heartbeatIntervalMs = transportOptions?.heartbeatIntervalMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const accessFilter = transportOptions?.accessFilter ?? new AccessFilterService();

  // Fast synchronous capacity check before authorization work
  const initialCount = activeSseConnections.get(liveEditService) ?? 0;
  if (initialCount >= maxConnections) {
    sendSseError(res, 429, 'Too Many Requests: SSE connection limit exceeded');
    return;
  }

  // Fast synchronous path when no async hooks are returned
  let pendingAuth: PromiseLike<TransportAuthResult> | undefined;
  let resolvedSession: LumenSessionContext | null | undefined;

  if (transportOptions?.authorize) {
    try {
      const authOutcome = transportOptions.authorize(req);
      if (isPromiseLike<TransportAuthResult>(authOutcome)) {
        pendingAuth = authOutcome;
      } else {
        const verdict = evaluateAuthResult(authOutcome);
        if (!verdict.authorized) {
          sendSseError(res, 401, 'Unauthorized');
          return;
        }
        resolvedSession = verdict.session;
      }
    } catch {
      sendSseError(res, 401, 'Unauthorized');
      return;
    }
  }

  if (!pendingAuth && resolvedSession === undefined && transportOptions?.resolveSession) {
    try {
      const sessionOutcome = transportOptions.resolveSession(req);
      if (isPromiseLike<LumenSessionContext | null | undefined>(sessionOutcome)) {
        void Promise.resolve(sessionOutcome).then(
          (asyncSession) => {
            const roles = accessFilter.getEffectiveRoles(asyncSession);
            establishSseStream(req, res, liveEditService, accessFilter, roles, maxConnections, heartbeatIntervalMs);
          },
          () => {
            establishSseStream(
              req,
              res,
              liveEditService,
              accessFilter,
              ['anonymous'],
              maxConnections,
              heartbeatIntervalMs
            );
          }
        );
        return;
      }
      resolvedSession = sessionOutcome;
    } catch {
      resolvedSession = undefined;
    }
  }

  if (pendingAuth) {
    void Promise.resolve(pendingAuth).then(
      async (asyncOutcome) => {
        const verdict = evaluateAuthResult(asyncOutcome);
        if (!verdict.authorized) {
          sendSseError(res, 401, 'Unauthorized');
          return;
        }
        let session = verdict.session;
        if (!session && transportOptions?.resolveSession) {
          try {
            session = (await transportOptions.resolveSession(req)) ?? undefined;
          } catch {
            session = undefined;
          }
        }
        const roles = accessFilter.getEffectiveRoles(session);
        establishSseStream(req, res, liveEditService, accessFilter, roles, maxConnections, heartbeatIntervalMs);
      },
      () => {
        sendSseError(res, 401, 'Unauthorized');
      }
    );
    return;
  }

  const clientRoles = accessFilter.getEffectiveRoles(resolvedSession);
  establishSseStream(req, res, liveEditService, accessFilter, clientRoles, maxConnections, heartbeatIntervalMs);
}
