/**
 * Generated nginx configuration.
 *
 * The console is served by omnitron-nginx, not by the daemon — so this
 * template, not any TypeScript, decides what security headers the operator's
 * browser receives and how long assets are cached. It shipped with neither:
 * no CSP, no nosniff, no framing protection, and a blanket `expires 7d` that
 * applied to `index.html` as readily as to hashed assets.
 *
 * `nginx -t` accepts the output (verified against nginx:alpine); these tests
 * pin the properties that matter so a future edit can't quietly drop them.
 */

import { describe, it, expect } from 'vitest';

import { generateNginxConfig } from '../../src/webapp/webapp.service.js';

const config = generateNginxConfig('127.0.0.1', 9801, 9802);

describe('generateNginxConfig — security headers', () => {
  it('sets a Content-Security-Policy without unsafe script sources', () => {
    expect(config).toContain('Content-Security-Policy');
    expect(config).toContain("script-src 'self'");
    // Emotion needs inline styles; scripts must never get the same licence.
    expect(config).not.toMatch(/script-src[^;"]*unsafe-inline/);
    expect(config).not.toMatch(/script-src[^;"]*unsafe-eval/);
  });

  it('forbids framing — the console can start and stop infrastructure', () => {
    expect(config).toContain("frame-ancestors 'none'");
  });

  it('sets nosniff, a referrer policy and a permissions policy', () => {
    expect(config).toContain('X-Content-Type-Options "nosniff"');
    expect(config).toContain('Referrer-Policy');
    expect(config).toContain('Permissions-Policy');
  });

  it('repeats the full header set in every location that sets any header', () => {
    // nginx does not merge add_header with an outer scope: a location that
    // declares one header drops all inherited ones. The first deployment of
    // this config lost Referrer-Policy and Permissions-Policy on index.html
    // exactly this way — confirmed live with curl before the fix.
    const blocks = config.split(/location [^{]*\{/).slice(1);
    for (const block of blocks) {
      const body = block.slice(0, block.indexOf('}'));
      if (!body.includes('add_header')) continue;
      expect(body, body.trim().slice(0, 80)).toContain('X-Content-Type-Options');
      expect(body, body.trim().slice(0, 80)).toContain('Referrer-Policy');
      expect(body, body.trim().slice(0, 80)).toContain('Permissions-Policy');
      expect(body, body.trim().slice(0, 80)).toContain('Content-Security-Policy');
    }
  });

  it('marks headers `always` so they survive error responses', () => {
    const headerLines = config.split('\n').filter((l) => l.trim().startsWith('add_header'));
    expect(headerLines.length).toBeGreaterThan(0);
    for (const line of headerLines) {
      expect(line.trimEnd().endsWith('always;'), line.trim()).toBe(true);
    }
  });

  it('does not advertise the nginx version', () => {
    expect(config).toContain('server_tokens off');
  });
});

describe('generateNginxConfig — caching', () => {
  it('caches content-hashed assets immutably', () => {
    expect(config).toContain('max-age=31536000, immutable');
  });

  it('matches the filenames Vite actually emits', () => {
    // Real output: "alerts-CEojylud.js" — a DASH then a base64url hash. The
    // first version of this rule expected ".<lowercase hex>." and matched
    // nothing, so every asset silently fell through to the 1-hour bucket.
    // Verified live against http://localhost:9800 before the fix.
    const immutableLocation = config
      .split('\n')
      .find((l) => l.includes('location ~*') && l.includes('map)$'));
    expect(immutableLocation).toBeDefined();

    const pattern = immutableLocation!.match(/location ~\* "([^"]+)"/)![1]!;
    const regex = new RegExp(pattern.replace(/\\\\/g, '\\'), 'i');

    for (const name of ['alerts-CEojylud.js', 'chunk-DtcAfS_W.js', 'index-lxgzFdPS.js', 'Chip-CMHg7RbG.js']) {
      expect(regex.test(name), name).toBe(true);
    }
    // Unhashed files must NOT get the immutable treatment.
    for (const name of ['index.html', 'favicon.ico', 'manifest.json']) {
      expect(regex.test(name), name).toBe(false);
    }
  });

  it('never caches index.html — it names the hashed assets', () => {
    expect(config).toMatch(/location = \/index\.html \{[\s\S]*?no-cache/);
  });

  it('quotes the regex locations so `{n,}` is not read as a block', () => {
    // nginx parses an unquoted `{` as a block opener: `location ~* \.[0-9a-f]{8,}\.`
    // fails to load with `unknown directive`. Quoting is what makes it valid.
    for (const line of config.split('\n').filter((l) => l.includes('location ~*'))) {
      expect(line, line.trim()).toMatch(/location ~\* "/);
    }
  });
});

describe('generateNginxConfig — proxying', () => {
  it('forwards the full Host (with port) on the WebSocket upgrade', () => {
    // $host strips the port; the daemon's same-origin guard then compares
    // "localhost" against "localhost:9800" and rejects every upgrade.
    expect(config).toMatch(/location \/ws \{[\s\S]*?proxy_set_header Host \$http_host;/);
  });

  it('routes RPC and health to the daemon ports it was given', () => {
    expect(config).toContain('proxy_pass http://127.0.0.1:9801/netron/');
    expect(config).toContain('proxy_pass http://127.0.0.1:9802/');
  });
});
