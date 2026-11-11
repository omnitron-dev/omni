import { describe, it, expect } from 'vitest';
import { verifyUrlAndAnchorParity } from '../src/parity/parity-engine.js';
import { normalizeUrl, normalizeAnchor } from '../src/parity/normalizer.js';

describe('Parity Engine', () => {
  it('normalizes trailing slashes', () => {
    expect(normalizeUrl('/docs/intro/')).toBe('/docs/intro');
    expect(normalizeUrl('/')).toBe('/');
  });

  it('normalizes and decodes Cyrillic anchors', () => {
    expect(normalizeAnchor('#%D0%BE%D0%B1%D0%B7%D0%BE%D1%80')).toBe('#обзор');
    expect(normalizeUrl('/docs/intro#%D0%BE%D0%B1%D0%B7%D0%BE%D1%80')).toBe('/docs/intro#обзор');
  });

  it('verifies 100% parity on matching route arrays', () => {
    const urls = ['/docs/intro', '/docs/intro#overview', '/docs/guides/installation'];
    const report = verifyUrlAndAnchorParity(urls, urls);

    expect(report.passed).toBe(true);
    expect(report.totalRoutes).toBe(2);
    expect(report.matchedRoutes).toBe(2);
    expect(report.totalAnchors).toBe(1);
    expect(report.matchedAnchors).toBe(1);
    expect(report.missingRoutes).toHaveLength(0);
    expect(report.missingAnchors).toHaveLength(0);
    expect(report.parityScore).toBe(1.0);
  });

  it('detects missing routes and missing anchors', () => {
    const source = ['/docs/a', '/docs/b', '/docs/a#h1', '/docs/a#h2'];
    const target = ['/docs/a', '/docs/a#h1'];

    const report = verifyUrlAndAnchorParity(source, target);
    expect(report.passed).toBe(false);
    expect(report.missingRoutes).toEqual(['/docs/b']);
    expect(report.missingAnchors).toEqual(['/docs/a#h2']);
    expect(report.matchedRoutes).toBe(1);
    expect(report.matchedAnchors).toBe(1);
  });

  it('completes 10,000 routes in under 500ms', () => {
    const count = 10_000;
    const source: string[] = [];
    const target: string[] = [];
    for (let i = 0; i < count; i++) {
      const url = `/docs/section-${i % 50}/page-${i}`;
      source.push(url);
      target.push(url);
    }

    const t0 = performance.now();
    const report = verifyUrlAndAnchorParity(source, target);
    const duration = performance.now() - t0;

    expect(report.passed).toBe(true);
    expect(duration).toBeLessThan(500);
  });
});
