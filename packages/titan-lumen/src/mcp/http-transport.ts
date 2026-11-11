import type { IncomingMessage, ServerResponse } from 'node:http';
import { LumenMcpServer } from './mcp-server.js';
import type { HttpMcpTransportOptions, LumenSessionContext, TransportAuthResult } from '../interfaces.js';

export const DEFAULT_MAX_HTTP_BODY_BYTES = 1_048_576; // 1 MiB
export const DEFAULT_HTTP_READ_TIMEOUT_MS = 10_000; // 10 seconds

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

function sendJsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.writableEnded || (res as { destroyed?: boolean }).destroyed) {
    return;
  }
  res.statusCode = statusCode;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  } else if (typeof res.writeHead === 'function') {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  }
  res.end(JSON.stringify(body));
}

function destroyRequest(req: IncomingMessage): void {
  if (typeof req.destroy === 'function') {
    try {
      req.destroy();
    } catch {
      // Ignore stream teardown errors
    }
  }
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

export async function handleHttpMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mcpServer: LumenMcpServer,
  transportOptions?: HttpMcpTransportOptions
): Promise<void> {
  if (req.method !== 'POST') {
    sendJsonResponse(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  // Origin allowlist check (HTTP 403)
  if (transportOptions?.allowedOrigins) {
    const origin = getHeaderString(req, 'origin');
    const allowWildcard = transportOptions.allowedOrigins.includes('*');
    if (!allowWildcard && (!origin || !transportOptions.allowedOrigins.includes(origin))) {
      sendJsonResponse(res, 403, { error: 'Forbidden: Origin not allowed' });
      destroyRequest(req);
      return;
    }
  }

  const maxBodyBytes = transportOptions?.maxBodyBytes ?? DEFAULT_MAX_HTTP_BODY_BYTES;
  const readTimeoutMs = transportOptions?.readTimeoutMs ?? DEFAULT_HTTP_READ_TIMEOUT_MS;

  // Fast pre-check on Content-Length header if provided
  const contentLengthHeader = getHeaderString(req, 'content-length');
  if (contentLengthHeader !== undefined) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBodyBytes) {
      sendJsonResponse(res, 413, { error: 'Payload Too Large' });
      destroyRequest(req);
      return;
    }
  }

  // Evaluate synchronous authorization upfront when possible before reading stream
  let pendingAuthPromise: PromiseLike<TransportAuthResult> | undefined;
  let resolvedSession: LumenSessionContext | undefined;

  if (transportOptions?.authorize) {
    try {
      const authOutcome = transportOptions.authorize(req);
      if (isPromiseLike<TransportAuthResult>(authOutcome)) {
        pendingAuthPromise = authOutcome;
      } else {
        const verdict = evaluateAuthResult(authOutcome);
        if (!verdict.authorized) {
          sendJsonResponse(res, 401, { error: 'Unauthorized' });
          destroyRequest(req);
          return;
        }
        resolvedSession = verdict.session;
      }
    } catch {
      sendJsonResponse(res, 401, { error: 'Unauthorized' });
      destroyRequest(req);
      return;
    }
  }

  await new Promise<void>((resolvePromise) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const clearHandlers = (): void => {
      clearTimeout(readTimer);
      if (typeof req.off === 'function') {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
      } else {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
      }
    };

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearHandlers();
      resolvePromise();
    };

    const readTimer = setTimeout(() => {
      if (settled) {
        return;
      }
      chunks.length = 0;
      sendJsonResponse(res, 408, { error: 'Request Timeout' });
      destroyRequest(req);
      finish();
    }, readTimeoutMs);
    readTimer.unref?.();

    function onData(chunk: Buffer | string): void {
      if (settled) {
        return;
      }
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      totalBytes += buf.byteLength;

      if (totalBytes > maxBodyBytes) {
        chunks.length = 0;
        sendJsonResponse(res, 413, { error: 'Payload Too Large' });
        destroyRequest(req);
        finish();
        return;
      }

      chunks.push(buf);
    }

    function onError(): void {
      if (settled) {
        return;
      }
      chunks.length = 0;
      sendJsonResponse(res, 400, { error: 'Bad Request' });
      finish();
    }

    function onEnd(): void {
      if (settled) {
        return;
      }
      clearHandlers();

      void (async () => {
        try {
          if (pendingAuthPromise) {
            try {
              const asyncAuth = await pendingAuthPromise;
              const verdict = evaluateAuthResult(asyncAuth);
              if (!verdict.authorized) {
                chunks.length = 0;
                sendJsonResponse(res, 401, { error: 'Unauthorized' });
                return;
              }
              resolvedSession = verdict.session;
            } catch {
              chunks.length = 0;
              sendJsonResponse(res, 401, { error: 'Unauthorized' });
              return;
            }
          }

          if (!resolvedSession && transportOptions?.resolveSession) {
            const customSession = await transportOptions.resolveSession(req);
            if (customSession) {
              resolvedSession = customSession;
            }
          }

          const rawBody = Buffer.concat(chunks).toString('utf8');
          chunks.length = 0;
          const json = JSON.parse(rawBody);
          const rpcResponse = await mcpServer.handleRequest(json, resolvedSession);
          sendJsonResponse(res, 200, rpcResponse);
        } catch (err: any) {
          sendJsonResponse(res, 400, {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error', data: err?.message },
          });
        } finally {
          settled = true;
          resolvePromise();
        }
      })();
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
