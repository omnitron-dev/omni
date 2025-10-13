/**
 * Tests for Asset Pipeline
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AssetPipeline, ImageOptimizer, FontSubsetter, SVGOptimizer } from '../../src/build/asset-pipeline.js';

describe('AssetPipeline', () => {
  let pipeline: AssetPipeline;

  beforeEach(() => {
    pipeline = new AssetPipeline({
      outputDir: 'dist/assets',
      publicPath: '/assets/',
    });
  });

  it('should process image assets', async () => {
    const imageContent = Buffer.from('fake-image-data');
    const result = await pipeline.processAsset('image.jpg', imageContent);

    expect(result.originalPath).toBe('image.jpg');
    expect(result.hash).toBeTruthy();
    expect(result.originalSize).toBe(imageContent.length);
  });

  it('should generate image variants', async () => {
    const imageContent = Buffer.from('fake-image-data');
    const result = await pipeline.processAsset('image.png', imageContent);

    expect(result.variants.length).toBeGreaterThan(0);
  });

  it('should process font assets', async () => {
    const fontContent = Buffer.from('fake-font-data');
    const result = await pipeline.processAsset('font.woff2', fontContent);

    expect(result.originalPath).toBe('font.woff2');
    expect(result.optimizedSize).toBeLessThanOrEqual(result.originalSize);
  });

  it('should process SVG assets', async () => {
    const svgContent = Buffer.from('<svg><rect width="100" height="100"/></svg>');
    const result = await pipeline.processAsset('icon.svg', svgContent);

    expect(result.originalPath).toBe('icon.svg');
    expect(result.optimizedSize).toBeLessThanOrEqual(result.originalSize);
  });

  it('should fingerprint asset paths', async () => {
    const content = Buffer.from('test-data');
    const result = await pipeline.processAsset('style.css', content);

    expect(result.outputPath).toMatch(/style\.[a-f0-9]{8}\.css/);
  });

  it('should generate CDN URLs', async () => {
    const pipelineWithCDN = new AssetPipeline({
      cdnUrl: 'https://cdn.example.com',
    });

    const content = Buffer.from('test-data');
    const result = await pipelineWithCDN.processAsset('image.jpg', content);

    expect(result.cdnUrl).toContain('https://cdn.example.com');
  });

  it('should compress assets', async () => {
    const content = Buffer.from('test data to compress');
    const result = await pipeline.processAsset('file.js', content);

    expect(result.compressed.length).toBeGreaterThan(0);
    expect(result.compressed.some((c) => c.format === 'gzip')).toBe(true);
    expect(result.compressed.some((c) => c.format === 'brotli')).toBe(true);
  });

  it('should process multiple assets', async () => {
    const assets = new Map<string, Buffer>([
      ['image.jpg', Buffer.from('image')],
      ['font.woff2', Buffer.from('font')],
      ['icon.svg', Buffer.from('<svg/>')],
    ]);

    const result = await pipeline.processAssets(assets);

    expect(result.assets.size).toBe(3);
    expect(result.manifest.assets).toBeDefined();
    expect(result.stats.totalAssets).toBe(3);
  });

  it('should generate asset manifest', async () => {
    const assets = new Map<string, Buffer>([['style.css', Buffer.from('.class { color: red; }')]]);

    const result = await pipeline.processAssets(assets);

    expect(result.manifest.assets['style.css']).toBeDefined();
    expect(result.manifest.metadata['style.css']).toBeDefined();
    expect(result.manifest.metadata['style.css'].hash).toBeTruthy();
  });

  it('should calculate optimization statistics', async () => {
    const assets = new Map<string, Buffer>([
      ['image1.jpg', Buffer.from('x'.repeat(1000))],
      ['image2.png', Buffer.from('y'.repeat(2000))],
    ]);

    const result = await pipeline.processAssets(assets);

    expect(result.stats.totalAssets).toBe(2);
    expect(result.stats.totalOriginalSize).toBe(3000);
    expect(result.stats.savingsPercent).toBeGreaterThanOrEqual(0);
  });

  it('should retrieve processed assets', async () => {
    const content = Buffer.from('test');
    await pipeline.processAsset('test.js', content);

    const asset = pipeline.getAsset('test.js');

    expect(asset).toBeDefined();
    expect(asset?.originalPath).toBe('test.js');
  });

  it('should get all processed assets', async () => {
    await pipeline.processAsset('file1.js', Buffer.from('a'));
    await pipeline.processAsset('file2.js', Buffer.from('b'));

    const allAssets = pipeline.getAllAssets();

    expect(allAssets.size).toBe(2);
  });
});

describe('ImageOptimizer', () => {
  let optimizer: ImageOptimizer;

  beforeEach(() => {
    optimizer = new ImageOptimizer(80, ['webp', 'avif']);
  });

  it('should optimize images', async () => {
    const content = Buffer.from('fake-image-data');
    const results = await optimizer.optimize(content, 'jpeg');

    expect(results.has('jpeg')).toBe(true);
    expect(results.has('webp')).toBe(true);
    expect(results.has('avif')).toBe(true);
  });

  it('should not duplicate original format', async () => {
    const content = Buffer.from('fake-image-data');
    const results = await optimizer.optimize(content, 'webp');

    // Should have webp (optimized) and avif (converted)
    expect(results.has('webp')).toBe(true);
    expect(results.has('avif')).toBe(true);
    expect(results.size).toBe(2);
  });
});

describe('FontSubsetter', () => {
  let subsetter: FontSubsetter;

  beforeEach(() => {
    subsetter = new FontSubsetter();
  });

  it('should subset fonts', async () => {
    const fontContent = Buffer.from('fake-font-data');
    const glyphs = new Set(['a', 'b', 'c']);

    const result = await subsetter.subset(fontContent, glyphs);

    expect(result.length).toBeLessThanOrEqual(fontContent.length);
  });

  it('should extract glyphs from text', () => {
    const text = 'Hello World';
    const glyphs = subsetter.extractGlyphs(text);

    expect(glyphs.has('H')).toBe(true);
    expect(glyphs.has('e')).toBe(true);
    expect(glyphs.has('o')).toBe(true);
    expect(glyphs.has(' ')).toBe(true);
  });

  it('should generate unicode ranges', () => {
    const glyphs = new Set(['a', 'b', 'c']);
    const ranges = subsetter.generateUnicodeRanges(glyphs);

    expect(ranges.length).toBeGreaterThan(0);
  });
});

describe('SVGOptimizer', () => {
  let optimizer: SVGOptimizer;

  beforeEach(() => {
    optimizer = new SVGOptimizer({
      removeComments: true,
      removeMetadata: true,
      removeHiddenElements: true,
      minifyStyles: true,
    });
  });

  it('should optimize SVG content', async () => {
    const svg = `
      <!-- Comment -->
      <svg>
        <metadata>Some metadata</metadata>
        <rect width="100" height="100"/>
      </svg>
    `;
    const content = Buffer.from(svg);

    const result = await optimizer.optimize(content);

    expect(result.length).toBeLessThan(content.length);
    expect(result.toString()).not.toContain('Comment');
  });

  it('should remove comments', async () => {
    const svg = '<!-- Comment --><svg><rect/></svg>';
    const content = Buffer.from(svg);

    const result = await optimizer.optimize(content);

    expect(result.toString()).not.toContain('Comment');
  });

  it('should remove metadata', async () => {
    const svg = '<svg><metadata>Data</metadata><rect/></svg>';
    const content = Buffer.from(svg);

    const result = await optimizer.optimize(content);

    expect(result.toString()).not.toContain('metadata');
  });

  it('should remove hidden elements', async () => {
    const svg = '<svg><rect display="none"/><circle/></svg>';
    const content = Buffer.from(svg);

    const result = await optimizer.optimize(content);

    expect(result.toString()).not.toContain('display="none"');
  });

  it('should minify styles', async () => {
    const svg = '<svg>  <rect   width="100"   />  </svg>';
    const content = Buffer.from(svg);

    const result = await optimizer.optimize(content);

    // Should have less whitespace
    expect(result.length).toBeLessThan(content.length);
  });

  it('should respect disabled options', async () => {
    const optimizerNoOptions = new SVGOptimizer({
      removeComments: false,
      removeMetadata: false,
      removeHiddenElements: false,
      minifyStyles: false,
    });

    const svg = '<!-- Comment --><svg><metadata>Data</metadata></svg>';
    const content = Buffer.from(svg);

    const result = await optimizerNoOptions.optimize(content);

    expect(result.toString()).toContain('Comment');
    expect(result.toString()).toContain('metadata');
  });
});
