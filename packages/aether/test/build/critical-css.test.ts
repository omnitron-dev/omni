/**
 * Tests for Critical CSS Extraction
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CriticalCSSExtractor,
  extractCriticalCSS,
  RouteBasedCriticalCSS,
} from '../../src/build/critical-css.js';

describe('CriticalCSSExtractor', () => {
  const sampleHTML = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Page</title>
      </head>
      <body>
        <header class="header">
          <nav class="nav">Navigation</nav>
        </header>
        <main class="main">
          <h1 class="title">Title</h1>
          <p class="content">Content</p>
        </main>
        <footer class="footer">Footer</footer>
      </body>
    </html>
  `;

  const sampleCSS = `
    body { margin: 0; padding: 0; }
    .header { background: blue; height: 60px; }
    .nav { color: white; }
    .main { padding: 20px; }
    .title { font-size: 24px; }
    .content { font-size: 16px; }
    .footer { background: gray; margin-top: 100px; }
    .unused { color: red; }
  `;

  it('should extract critical CSS from HTML and CSS', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
    });

    const result = await extractor.extract();

    expect(result.critical).toBeTruthy();
    expect(result.nonCritical).toBeTruthy();
    expect(result.coverage.total).toBeGreaterThan(0);
    expect(result.coverage.percentage).toBeGreaterThan(0);
  });

  it('should inline critical CSS in HTML', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
      inline: true,
    });

    const result = await extractor.extract();

    expect(result.html).toContain('<style>');
    expect(result.html).toContain('</style>');
  });

  it('should respect force include patterns', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
      forceInclude: ['footer'],
    });

    const result = await extractor.extract();
    const footerSelector = result.selectors.find((s) => s.selector.includes('footer'));

    expect(footerSelector?.critical).toBe(true);
    expect(footerSelector?.reason).toBe('force-included');
  });

  it('should exclude specified patterns', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
      exclude: ['footer'],
    });

    const result = await extractor.extract();
    const footerSelector = result.selectors.find((s) => s.selector.includes('footer'));

    expect(footerSelector?.critical).toBe(false);
    expect(footerSelector?.reason).toBe('excluded');
  });

  it('should detect above-the-fold selectors', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
    });

    const result = await extractor.extract();
    const headerSelector = result.selectors.find((s) => s.selector.includes('header'));

    expect(headerSelector?.critical).toBe(true);
    expect(headerSelector?.reason).toBe('above-the-fold');
  });

  it('should calculate coverage statistics', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
    });

    const result = await extractor.extract();

    expect(result.coverage.total).toBeGreaterThan(0);
    expect(result.coverage.used).toBeGreaterThan(0);
    expect(result.coverage.unused).toBeGreaterThanOrEqual(0);
    expect(result.coverage.percentage).toBeGreaterThanOrEqual(0);
    expect(result.coverage.percentage).toBeLessThanOrEqual(100);
  });

  it('should defer non-critical CSS', async () => {
    const extractor = new CriticalCSSExtractor({
      html: sampleHTML,
      css: sampleCSS,
      inline: true,
      deferNonCritical: true,
      basePath: '/assets/',
    });

    const result = await extractor.extract();

    expect(result.html).toContain('rel="preload"');
    expect(result.html).toContain('as="style"');
  });
});

describe('extractCriticalCSS', () => {
  it('should be a convenience wrapper', async () => {
    const html = '<div class="test">Test</div>';
    const css = '.test { color: blue; }';

    const result = await extractCriticalCSS({ html, css });

    expect(result.critical).toBeTruthy();
    expect(result.coverage).toBeDefined();
  });
});

describe('RouteBasedCriticalCSS', () => {
  let manager: RouteBasedCriticalCSS;

  beforeEach(() => {
    manager = new RouteBasedCriticalCSS();
  });

  it('should add routes with critical CSS', async () => {
    await manager.addRoute('/home', {
      html: '<div class="home">Home</div>',
      css: '.home { color: blue; }',
    });

    const route = manager.getRoute('/home');

    expect(route).toBeDefined();
    expect(route?.critical).toBeTruthy();
  });

  it('should get all routes', async () => {
    await manager.addRoute('/home', {
      html: '<div class="home">Home</div>',
      css: '.home { color: blue; }',
    });
    await manager.addRoute('/about', {
      html: '<div class="about">About</div>',
      css: '.about { color: red; }',
    });

    const routes = manager.getAllRoutes();

    expect(routes.size).toBe(2);
    expect(routes.has('/home')).toBe(true);
    expect(routes.has('/about')).toBe(true);
  });

  it('should extract common critical CSS across routes', async () => {
    const commonCSS = 'body { margin: 0; }';

    await manager.addRoute('/home', {
      html: '<body><div class="home">Home</div></body>',
      css: `${commonCSS} .home { color: blue; }`,
    });
    await manager.addRoute('/about', {
      html: '<body><div class="about">About</div></body>',
      css: `${commonCSS} .about { color: red; }`,
    });

    const common = manager.getCommonCriticalCSS();

    expect(common).toContain('body');
  });

  it('should generate coverage report', async () => {
    await manager.addRoute('/home', {
      html: '<div class="home">Home</div>',
      css: '.home { color: blue; } .unused { color: red; }',
    });
    await manager.addRoute('/about', {
      html: '<div class="about">About</div>',
      css: '.about { color: red; }',
    });

    const report = manager.getCoverageReport();

    expect(report.routes).toBe(2);
    expect(report.totalRules).toBeGreaterThan(0);
    expect(report.criticalRules).toBeGreaterThan(0);
    expect(report.averageCoverage).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty routes', () => {
    const report = manager.getCoverageReport();

    expect(report.routes).toBe(0);
    expect(report.totalRules).toBe(0);
    expect(report.averageCoverage).toBe(0);
  });
});
