import { describe, it, expect } from 'vitest';
import { verifyUrlAndAnchorParity } from '@omnitron-dev/lumen-migrate';

describe('Feature 30: 100% Parity Verification Engine', () => {
  it('TC-F30-01: verifies 100% route parity when all source routes match target routes', () => {
    const sourceUrls = ['/docs/intro', '/docs/guides/installation', '/docs/guides/configuration'];
    const targetUrls = ['/docs/intro', '/docs/guides/installation', '/docs/guides/configuration'];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(true);
    expect(report.routes.total).toBe(3);
    expect(report.routes.preserved).toBe(3);
    expect(report.routes.missing).toHaveLength(0);
  });

  it('TC-F30-02: verifies 100% in-page heading anchor parity for hash links', () => {
    const sourceUrls = ['/docs/intro', '/docs/intro#overview', '/docs/guides/installation#quick-start'];
    const targetUrls = ['/docs/intro', '/docs/intro#overview', '/docs/guides/installation#quick-start'];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(true);
    expect(report.anchors.total).toBe(2);
    expect(report.anchors.preserved).toBe(2);
    expect(report.anchors.missing).toHaveLength(0);
  });

  it('TC-F30-03: detects missing routes and marks verification as failed', () => {
    const sourceUrls = ['/docs/intro', '/docs/advanced/overview', '/docs/missing-page'];
    const targetUrls = ['/docs/intro', '/docs/advanced/overview'];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(false);
    expect(report.routes.missing).toContain('/docs/missing-page');
    expect(report.routes.preserved).toBe(2);
    expect(report.routes.total).toBe(3);
  });

  it('TC-F30-04: detects missing in-page heading anchors', () => {
    const sourceUrls = ['/docs/intro#system-overview', '/docs/intro#phantom-anchor'];
    const targetUrls = ['/docs/intro#system-overview'];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(false);
    expect(report.anchors.missing).toContain('/docs/intro#phantom-anchor');
    expect(report.anchors.preserved).toBe(1);
    expect(report.anchors.total).toBe(2);
  });

  it('TC-F30-05: correctly separates route URLs from anchor URLs in parity summary', () => {
    const sourceUrls = ['/docs/a', '/docs/a#anchor1', '/docs/b', '/docs/b#anchor2'];
    const targetUrls = ['/docs/a', '/docs/a#anchor1', '/docs/b'];

    const report = verifyUrlAndAnchorParity(sourceUrls, targetUrls);

    expect(report.passed).toBe(false);
    expect(report.routes.total).toBe(2);
    expect(report.routes.preserved).toBe(2);
    expect(report.anchors.total).toBe(2);
    expect(report.anchors.preserved).toBe(1);
    expect(report.anchors.missing).toEqual(['/docs/b#anchor2']);
  });
});
