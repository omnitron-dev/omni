import { describe, it, expect } from 'vitest';
import { verifyUrlAndAnchorParity } from '@omnitron-dev/lumen-migrate';
import { normalizeAnchor, expectAnchorParity } from '../harness/assertions.js';

describe('Feature 30: 100% Parity Verification Engine Boundaries', () => {
  it('TC-B30-01: handles completely empty source and target route arrays returning passing parity', () => {
    const report = verifyUrlAndAnchorParity([], []);

    expect(report.passed).toBe(true);
    expect(report.totalRoutes).toBe(0);
    expect(report.matchedRoutes).toBe(0);
    expect(report.totalAnchors).toBe(0);
    expect(report.matchedAnchors).toBe(0);
    expect(report.missingRoutes).toEqual([]);
    expect(report.missingAnchors).toEqual([]);
  });

  it('TC-B30-02: reconciles trailing slash discrepancies through URL normalization', () => {
    const sourceWithTrailingSlash = ['/docs/intro/', '/docs/guides/installation/', '/docs/api/reference/'];
    const targetWithoutTrailingSlash = ['/docs/intro', '/docs/guides/installation', '/docs/api/reference'];

    // Normalizing trailing slashes achieves 100% parity
    const normalizeUrl = (url: string) => (url.length > 1 && url.endsWith('/') ? url.slice(0, -1) : url);
    const normalizedSource = sourceWithTrailingSlash.map(normalizeUrl);
    const normalizedTarget = targetWithoutTrailingSlash.map(normalizeUrl);

    const report = verifyUrlAndAnchorParity(normalizedSource, normalizedTarget);
    expect(report.passed).toBe(true);
    expect(report.totalRoutes).toBe(3);
    expect(report.matchedRoutes).toBe(3);
    expect(report.missingRoutes).toEqual([]);
  });

  it('TC-B30-03: reconciles Cyrillic and non-ASCII anchor URI encoding differences', () => {
    const rawCyrillicAnchors = ['#обзор-системы', '#квантовая-теорема', '#введение'];
    const encodedCyrillicAnchors = [
      '#%D0%BE%D0%B1%D0%B7%D0%BE%D1%80-%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D1%8B',
      '#%D0%BA%D0%B2%D0%B0%D0%BD%D1%82%D0%BE%D0%B2%D0%B0%D1%8F-%D1%82%D0%B5%D0%BE%D1%80%D0%B5%D0%BC%D0%B0',
      '#%D0%B2%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5',
    ];

    // Using harness anchor normalization
    for (let i = 0; i < rawCyrillicAnchors.length; i++) {
      expect(normalizeAnchor(encodedCyrillicAnchors[i])).toBe(normalizeAnchor(rawCyrillicAnchors[i]));
    }

    // ExpectAnchorParity assertion passes
    expectAnchorParity(rawCyrillicAnchors, encodedCyrillicAnchors);
  });

  it('TC-B30-04: verifies 10,000 routes scale comparison completes under 500ms', () => {
    const count = 10_000;
    const sourceUrls: string[] = [];
    const targetUrls: string[] = [];

    for (let i = 0; i < count; i++) {
      const route = `/docs/section-${Math.floor(i / 100)}/page-${i}`;
      sourceUrls.push(route);
      targetUrls.push(route);
    }

    const startTime = performance.now();
    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);
    const durationMs = performance.now() - startTime;

    expect(report.passed).toBe(true);
    expect(report.totalRoutes).toBe(count);
    expect(report.matchedRoutes).toBe(count);
    expect(durationMs).toBeLessThan(500);
  });

  it('TC-B30-05: produces itemized diagnostic report for mixed missing routes and missing anchors', () => {
    const sourceUrls = [
      '/docs/intro',
      '/docs/intro#overview',
      '/docs/guides/quickstart',
      '/docs/guides/quickstart#step-1',
      '/docs/guides/quickstart#step-2',
      '/docs/missing-page-a',
      '/docs/missing-page-b',
    ];

    const targetUrls = [
      '/docs/intro',
      '/docs/intro#overview',
      '/docs/guides/quickstart',
      '/docs/guides/quickstart#step-1',
      // Missing: #step-2, /docs/missing-page-a, /docs/missing-page-b
    ];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(false);
    expect(report.missingRoutes).toEqual(['/docs/missing-page-a', '/docs/missing-page-b']);
    expect(report.missingAnchors).toEqual(['/docs/guides/quickstart#step-2']);
    expect(report.matchedRoutes).toBe(2);
    expect(report.totalRoutes).toBe(4);
    expect(report.matchedAnchors).toBe(2);
    expect(report.totalAnchors).toBe(3);
  });
});
