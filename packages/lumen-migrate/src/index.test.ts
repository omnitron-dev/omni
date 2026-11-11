import { describe, expect, it } from 'vitest';
import { convertDocusaurusConfig, runLumenMigrateCli, verifyUrlAndAnchorParity } from './index.js';

describe('@omnitron-dev/lumen-migrate', () => {
  it('converts basic Docusaurus configuration to Lumen schema', () => {
    const lumenConfig = convertDocusaurusConfig({
      title: 'Legacy Docs',
      url: 'https://docs.example.com',
      baseUrl: '/subpath/',
      i18n: { defaultLocale: 'en', locales: ['en', 'fr', 'de'] },
    });

    expect(lumenConfig.title).toBe('Legacy Docs');
    expect(lumenConfig.baseUrl).toBe('/subpath/');
    expect(lumenConfig.locales).toEqual(['en', 'fr', 'de']);
    expect(lumenConfig.defaultLocale).toBe('en');
  });

  it('verifies route and anchor parity correctly', () => {
    const passed = verifyUrlAndAnchorParity(
      ['/docs/intro', '/docs/setup', '/docs/setup#install'],
      ['/docs/intro', '/docs/setup', '/docs/setup#install', '/docs/extra']
    );
    expect(passed.passed).toBe(true);
    expect(passed.missingRoutes).toEqual([]);
    expect(passed.missingAnchors).toEqual([]);
    expect(passed.totalRoutes).toBe(2);
    expect(passed.matchedRoutes).toBe(2);
    expect(passed.totalAnchors).toBe(1);
    expect(passed.matchedAnchors).toBe(1);

    const failedRoute = verifyUrlAndAnchorParity(['/docs/intro', '/docs/missing-doc'], ['/docs/intro']);
    expect(failedRoute.passed).toBe(false);
    expect(failedRoute.missingRoutes).toEqual(['/docs/missing-doc']);

    const failedAnchor = verifyUrlAndAnchorParity(['/docs/intro#missing-anchor'], ['/docs/intro']);
    expect(failedAnchor.passed).toBe(false);
    expect(failedAnchor.missingAnchors).toEqual(['/docs/intro#missing-anchor']);
  });

  it('runs lumen-migrate cli without throwing', async () => {
    await expect(runLumenMigrateCli(['--version'])).resolves.not.toThrow();
    await expect(runLumenMigrateCli(['help'])).resolves.not.toThrow();
  });
});
