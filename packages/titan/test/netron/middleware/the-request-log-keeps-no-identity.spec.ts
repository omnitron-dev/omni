/**
 * A built-in request logger must not decide, on the operator's behalf, to keep
 * who sent a request or what secret travelled in its URL.
 *
 * `requestLoggingMiddleware` logged `ctx.request.url` whole on all three of its
 * lines, plus `ip` and `user-agent` on the request line. That is two distinct
 * leaks in one helper:
 *
 *   - a query string is where share tokens, signed-URL signatures and
 *     reset codes travel, and the log is where they outlive the request;
 *   - `ip` + `user-agent` together are an identity, and this framework runs a
 *     platform reached over Tor, where the log is the only place that identity
 *     can reappear.
 *
 * Nothing mounts this middleware today. That is the argument for fixing it, not
 * against: whoever mounts it next will assume the framework chose the safe
 * default.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpBuiltinMiddleware } from '../../../src/netron/transport/http/middleware/http-builtin.js';

function contextFor(url: string) {
  return {
    request: {
      method: 'GET',
      url,
      headers: { 'user-agent': 'Mozilla/5.0 (very distinctive build 12345)' },
      socket: { remoteAddress: '198.51.100.77' },
    },
    response: { statusCode: 200, setHeader: vi.fn() },
    metadata: new Map(),
  } as any;
}

function recordingLogger() {
  const lines: string[] = [];
  const sink = (o: unknown, m: string) => lines.push(JSON.stringify(o) + ' ' + m);
  return { lines, logger: { info: sink, error: sink, warn: sink, debug: sink, child: () => null } as any };
}

const SECRET_URL = '/s/abcdef?k=sh_live_9f3c2b1a&next=/inbox';

describe('the request log keeps no identity', () => {
  it('logs the path and drops the query string', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

    await mw(contextFor(SECRET_URL), async () => {});

    const all = lines.join('\n');
    expect(all, 'the share token reached the log').not.toContain('sh_live_9f3c2b1a');
    expect(all).toContain('/s/abcdef');
  });

  it('drops the query string on the response line too', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

    await mw(contextFor(SECRET_URL), async () => {});

    expect(lines.length, 'both a request and a response line are expected').toBe(2);
    expect(lines[1]).not.toContain('sh_live_9f3c2b1a');
  });

  it('drops the query string on the error line too', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

    await expect(
      mw(contextFor(SECRET_URL), async () => {
        throw new Error('handler failed');
      })
    ).rejects.toThrow('handler failed');

    expect(lines.join('\n')).not.toContain('sh_live_9f3c2b1a');
  });

  it('records neither the client address nor the user agent by default', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

    await mw(contextFor('/api/thing'), async () => {});

    const all = lines.join('\n');
    expect(all, 'the client IP reached the log').not.toContain('198.51.100.77');
    expect(all, 'the user agent reached the log').not.toContain('very distinctive build 12345');
  });

  it('records them when the operator asks, and then owns the decision', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger, { includeClientIdentity: true });

    await mw(contextFor('/api/thing'), async () => {});

    const all = lines.join('\n');
    expect(all).toContain('198.51.100.77');
    expect(all).toContain('very distinctive build 12345');
  });

  it('keeps the query string only when the operator asks', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger, { includeQueryString: true });

    await mw(contextFor(SECRET_URL), async () => {});

    expect(lines.join('\n')).toContain('sh_live_9f3c2b1a');
  });

  it('leaves a URL with no query string alone', async () => {
    const { lines, logger } = recordingLogger();
    const mw = HttpBuiltinMiddleware.requestLoggingMiddleware(logger);

    await mw(contextFor('/netron/invoke'), async () => {});

    expect(lines[0]).toContain('/netron/invoke');
  });
});
