/**
 * Asset Pipeline
 * Image optimization, font subsetting, SVG optimization, and compression
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

export interface AssetPipelineOptions {
  /**
   * Enable image optimization
   * @default true
   */
  optimizeImages?: boolean;

  /**
   * Image formats to generate
   * @default ['webp', 'avif']
   */
  imageFormats?: Array<'webp' | 'avif' | 'jpeg' | 'png'>;

  /**
   * Image quality (0-100)
   * @default 80
   */
  imageQuality?: number;

  /**
   * Enable font subsetting
   * @default true
   */
  subsetFonts?: boolean;

  /**
   * Font formats to generate
   * @default ['woff2']
   */
  fontFormats?: Array<'woff' | 'woff2' | 'ttf'>;

  /**
   * Enable SVG optimization
   * @default true
   */
  optimizeSVG?: boolean;

  /**
   * Enable asset fingerprinting
   * @default true
   */
  fingerprint?: boolean;

  /**
   * CDN base URL
   */
  cdnUrl?: string;

  /**
   * Enable compression
   * @default true
   */
  compress?: boolean;

  /**
   * Compression formats
   * @default ['gzip', 'brotli']
   */
  compressionFormats?: Array<'gzip' | 'brotli'>;

  /**
   * Output directory
   * @default 'dist/assets'
   */
  outputDir?: string;

  /**
   * Public path
   * @default '/assets/'
   */
  publicPath?: string;
}

export interface AssetPipelineResult {
  /**
   * Processed assets
   */
  assets: Map<string, ProcessedAsset>;

  /**
   * Asset manifest
   */
  manifest: AssetManifest;

  /**
   * Statistics
   */
  stats: {
    totalAssets: number;
    totalOriginalSize: number;
    totalOptimizedSize: number;
    savings: number;
    savingsPercent: number;
  };
}

export interface ProcessedAsset {
  /**
   * Original file path
   */
  originalPath: string;

  /**
   * Output path
   */
  outputPath: string;

  /**
   * CDN URL (if configured)
   */
  cdnUrl?: string;

  /**
   * Asset hash
   */
  hash: string;

  /**
   * Original size
   */
  originalSize: number;

  /**
   * Optimized size
   */
  optimizedSize: number;

  /**
   * Generated variants (WebP, AVIF, etc.)
   */
  variants: Array<{
    format: string;
    path: string;
    size: number;
  }>;

  /**
   * Compressed versions
   */
  compressed: Array<{
    format: 'gzip' | 'brotli';
    path: string;
    size: number;
  }>;
}

export interface AssetManifest {
  assets: Record<string, string>;
  metadata: Record<
    string,
    {
      size: number;
      hash: string;
      variants?: Record<string, string>;
    }
  >;
}

/**
 * Asset pipeline processor
 */
export class AssetPipeline {
  private options: Required<AssetPipelineOptions>;
  private assets: Map<string, ProcessedAsset> = new Map();

  constructor(options: AssetPipelineOptions = {}) {
    this.options = {
      optimizeImages: true,
      imageFormats: ['webp', 'avif'],
      imageQuality: 80,
      subsetFonts: true,
      fontFormats: ['woff2'],
      optimizeSVG: true,
      fingerprint: true,
      compress: true,
      compressionFormats: ['gzip', 'brotli'],
      outputDir: 'dist/assets',
      publicPath: '/assets/',
      cdnUrl: '',
      ...options,
    };
  }

  /**
   * Process asset
   */
  async processAsset(filePath: string, content: Buffer): Promise<ProcessedAsset> {
    const ext = path.extname(filePath).toLowerCase();
    const assetType = this.getAssetType(ext);

    let processedAsset: ProcessedAsset = {
      originalPath: filePath,
      outputPath: '',
      hash: this.hashContent(content),
      originalSize: content.length,
      optimizedSize: content.length,
      variants: [],
      compressed: [],
    };

    // Process based on asset type
    switch (assetType) {
      case 'image':
        processedAsset = await this.processImage(filePath, content, processedAsset);
        break;
      case 'font':
        processedAsset = await this.processFont(filePath, content, processedAsset);
        break;
      case 'svg':
        processedAsset = await this.processSVG(filePath, content, processedAsset);
        break;
      default:
        processedAsset = await this.processGeneric(filePath, content, processedAsset);
    }

    // Apply fingerprinting
    if (this.options.fingerprint) {
      processedAsset.outputPath = this.fingerprintPath(filePath, processedAsset.hash);
    } else {
      processedAsset.outputPath = filePath;
    }

    // Generate CDN URL
    if (this.options.cdnUrl) {
      processedAsset.cdnUrl = this.generateCDNUrl(processedAsset.outputPath);
    }

    // Compress asset
    if (this.options.compress) {
      processedAsset.compressed = await this.compressAsset(content);
    }

    this.assets.set(filePath, processedAsset);
    return processedAsset;
  }

  /**
   * Process multiple assets
   */
  async processAssets(assets: Map<string, Buffer>): Promise<AssetPipelineResult> {
    // Process all assets in parallel
    await Promise.all(Array.from(assets.entries()).map(([path, content]) => this.processAsset(path, content)));

    const manifest = this.generateManifest();
    const stats = this.calculateStats();

    return {
      assets: this.assets,
      manifest,
      stats,
    };
  }

  /**
   * Process image asset
   */
  private async processImage(filePath: string, content: Buffer, asset: ProcessedAsset): Promise<ProcessedAsset> {
    if (!this.options.optimizeImages) {
      return asset;
    }

    // Simulate image optimization (in real implementation, use sharp or similar)
    const optimizedContent = await this.optimizeImageContent(content);
    asset.optimizedSize = optimizedContent.length;

    // Generate variants
    for (const format of this.options.imageFormats) {
      const variantContent = await this.convertImageFormat(content, format);
      const variantPath = this.getVariantPath(filePath, format);

      asset.variants.push({
        format,
        path: variantPath,
        size: variantContent.length,
      });
    }

    return asset;
  }

  /**
   * Process font asset
   */
  private async processFont(filePath: string, content: Buffer, asset: ProcessedAsset): Promise<ProcessedAsset> {
    if (!this.options.subsetFonts) {
      return asset;
    }

    // Simulate font subsetting (in real implementation, use fontmin or similar)
    const subsetContent = await this.subsetFont(content);
    asset.optimizedSize = subsetContent.length;

    // Generate format variants
    for (const format of this.options.fontFormats) {
      if (format !== path.extname(filePath).slice(1)) {
        const variantContent = await this.convertFontFormat(content, format);
        const variantPath = this.getVariantPath(filePath, format);

        asset.variants.push({
          format,
          path: variantPath,
          size: variantContent.length,
        });
      }
    }

    return asset;
  }

  /**
   * Process SVG asset
   */
  private async processSVG(_filePath: string, content: Buffer, asset: ProcessedAsset): Promise<ProcessedAsset> {
    if (!this.options.optimizeSVG) {
      return asset;
    }

    // Simulate SVG optimization (in real implementation, use svgo)
    const optimizedContent = await this.optimizeSVGContent(content);
    asset.optimizedSize = optimizedContent.length;

    return asset;
  }

  /**
   * Process generic asset
   */
  private async processGeneric(_filePath: string, _content: Buffer, asset: ProcessedAsset): Promise<ProcessedAsset> {
    // No special processing for generic assets
    return asset;
  }

  /**
   * Optimize image content (placeholder)
   */
  private async optimizeImageContent(content: Buffer): Promise<Buffer> {
    // In real implementation, use sharp or similar
    // For now, simulate 20% size reduction
    return Buffer.from(content.slice(0, Math.floor(content.length * 0.8)));
  }

  /**
   * Convert image format (placeholder)
   */
  private async convertImageFormat(content: Buffer, _format: string): Promise<Buffer> {
    // In real implementation, use sharp or similar
    // For now, simulate format conversion
    return Buffer.from(content);
  }

  /**
   * Subset font (placeholder)
   */
  private async subsetFont(content: Buffer): Promise<Buffer> {
    // In real implementation, use fontmin or similar
    // For now, simulate 30% size reduction
    return Buffer.from(content.slice(0, Math.floor(content.length * 0.7)));
  }

  /**
   * Convert font format (placeholder)
   */
  private async convertFontFormat(content: Buffer, _format: string): Promise<Buffer> {
    // In real implementation, use font conversion library
    return Buffer.from(content);
  }

  /**
   * Optimize SVG content (placeholder)
   */
  private async optimizeSVGContent(content: Buffer): Promise<Buffer> {
    // In real implementation, use svgo
    // For now, simulate 15% size reduction
    return Buffer.from(content.slice(0, Math.floor(content.length * 0.85)));
  }

  /**
   * Compress asset
   */
  private async compressAsset(
    content: Buffer
  ): Promise<Array<{ format: 'gzip' | 'brotli'; path: string; size: number }>> {
    const compressed: Array<{
      format: 'gzip' | 'brotli';
      path: string;
      size: number;
    }> = [];

    for (const format of this.options.compressionFormats) {
      let compressedContent: Buffer;

      if (format === 'gzip') {
        compressedContent = await gzip(content);
      } else {
        compressedContent = await brotliCompress(content);
      }

      compressed.push({
        format,
        path: '', // Set by caller
        size: compressedContent.length,
      });
    }

    return compressed;
  }

  /**
   * Get asset type from extension
   */
  private getAssetType(ext: string): 'image' | 'font' | 'svg' | 'other' {
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
    const fontExts = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];

    if (imageExts.includes(ext)) return 'image';
    if (fontExts.includes(ext)) return 'font';
    if (ext === '.svg') return 'svg';
    return 'other';
  }

  /**
   * Fingerprint file path
   */
  private fingerprintPath(filePath: string, hash: string): string {
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const dirname = path.dirname(filePath);

    const fingerprinted = `${basename}.${hash.slice(0, 8)}${ext}`;
    return path.join(dirname, fingerprinted);
  }

  /**
   * Get variant path
   */
  private getVariantPath(filePath: string, format: string): string {
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const dirname = path.dirname(filePath);

    return path.join(dirname, `${basename}.${format}`);
  }

  /**
   * Generate CDN URL
   */
  private generateCDNUrl(assetPath: string): string {
    const normalizedPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
    return `${this.options.cdnUrl}/${normalizedPath}`;
  }

  /**
   * Hash content
   */
  private hashContent(content: Buffer): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate asset manifest
   */
  private generateManifest(): AssetManifest {
    const assets: Record<string, string> = {};
    const metadata: Record<
      string,
      {
        size: number;
        hash: string;
        variants?: Record<string, string>;
      }
    > = {};

    for (const [originalPath, asset] of this.assets) {
      const publicUrl = this.options.cdnUrl ? asset.cdnUrl! : path.join(this.options.publicPath, asset.outputPath);

      assets[originalPath] = publicUrl;

      const variants: Record<string, string> = {};
      for (const variant of asset.variants) {
        variants[variant.format] = path.join(this.options.publicPath, variant.path);
      }

      metadata[originalPath] = {
        size: asset.optimizedSize,
        hash: asset.hash,
        variants: Object.keys(variants).length > 0 ? variants : undefined,
      };
    }

    return { assets, metadata };
  }

  /**
   * Calculate statistics
   */
  private calculateStats(): {
    totalAssets: number;
    totalOriginalSize: number;
    totalOptimizedSize: number;
    savings: number;
    savingsPercent: number;
  } {
    let totalOriginalSize = 0;
    let totalOptimizedSize = 0;

    for (const asset of this.assets.values()) {
      totalOriginalSize += asset.originalSize;
      totalOptimizedSize += asset.optimizedSize;
    }

    const savings = totalOriginalSize - totalOptimizedSize;
    const savingsPercent = totalOriginalSize > 0 ? (savings / totalOriginalSize) * 100 : 0;

    return {
      totalAssets: this.assets.size,
      totalOriginalSize,
      totalOptimizedSize,
      savings,
      savingsPercent,
    };
  }

  /**
   * Get processed asset
   */
  getAsset(path: string): ProcessedAsset | undefined {
    return this.assets.get(path);
  }

  /**
   * Get all assets
   */
  getAllAssets(): Map<string, ProcessedAsset> {
    return new Map(this.assets);
  }
}

/**
 * Image optimizer
 */
export class ImageOptimizer {
  // Reserved for future image optimization implementation
  private _quality: number;
  private _formats: Array<'webp' | 'avif' | 'jpeg' | 'png'>;

  constructor(quality: number = 80, formats: Array<'webp' | 'avif' | 'jpeg' | 'png'> = ['webp', 'avif']) {
    this._quality = quality;
    this._formats = formats;
  }

  /**
   * Optimize image
   */
  async optimize(content: Buffer, originalFormat: string): Promise<Map<string, Buffer>> {
    const results = new Map<string, Buffer>();

    // Original format optimization
    results.set(originalFormat, await this.optimizeFormat(content, originalFormat));

    // Generate additional formats
    for (const format of this._formats) {
      if (format !== originalFormat) {
        results.set(format, await this.convertAndOptimize(content, format));
      }
    }

    return results;
  }

  /**
   * Optimize in specific format
   */
  private async optimizeFormat(content: Buffer, _format: string): Promise<Buffer> {
    // Placeholder implementation
    return Buffer.from(content);
  }

  /**
   * Convert and optimize to target format
   */
  private async convertAndOptimize(content: Buffer, _format: string): Promise<Buffer> {
    // Placeholder implementation
    return Buffer.from(content);
  }
}

/**
 * Font subsetter
 */
export class FontSubsetter {
  // Reserved for future font subsetting implementation
  private _unicodeRanges: string[];

  constructor(unicodeRanges: string[] = []) {
    this._unicodeRanges = unicodeRanges;
  }

  /**
   * Subset font to include only used glyphs
   */
  async subset(content: Buffer, _glyphs: Set<string>): Promise<Buffer> {
    // Placeholder implementation
    // In real implementation, use fontmin or harfbuzz
    return Buffer.from(content.slice(0, Math.floor(content.length * 0.7)));
  }

  /**
   * Extract glyphs from text
   */
  extractGlyphs(text: string): Set<string> {
    return new Set(text.split(''));
  }

  /**
   * Generate unicode ranges for subset
   */
  generateUnicodeRanges(_glyphs: Set<string>): string[] {
    // Placeholder implementation
    return ['U+0020-007F']; // Basic Latin
  }
}

/**
 * SVG optimizer
 */
export class SVGOptimizer {
  private removeComments: boolean;
  private removeMetadata: boolean;
  private removeHiddenElements: boolean;
  private minifyStyles: boolean;

  constructor(
    options: {
      removeComments?: boolean;
      removeMetadata?: boolean;
      removeHiddenElements?: boolean;
      minifyStyles?: boolean;
    } = {}
  ) {
    this.removeComments = options.removeComments ?? true;
    this.removeMetadata = options.removeMetadata ?? true;
    this.removeHiddenElements = options.removeHiddenElements ?? true;
    this.minifyStyles = options.minifyStyles ?? true;
  }

  /**
   * Optimize SVG content
   */
  async optimize(content: Buffer): Promise<Buffer> {
    let svg = content.toString('utf-8');

    if (this.removeComments) {
      svg = this.stripComments(svg);
    }

    if (this.removeMetadata) {
      svg = this.stripMetadata(svg);
    }

    if (this.removeHiddenElements) {
      svg = this.stripHiddenElements(svg);
    }

    if (this.minifyStyles) {
      svg = this.minifySVGStyles(svg);
    }

    return Buffer.from(svg, 'utf-8');
  }

  /**
   * Remove comments
   */
  private stripComments(svg: string): string {
    return svg.replace(/<!--[\s\S]*?-->/g, '');
  }

  /**
   * Remove metadata
   */
  private stripMetadata(svg: string): string {
    return svg.replace(/<metadata[\s\S]*?<\/metadata>/g, '');
  }

  /**
   * Remove hidden elements
   */
  private stripHiddenElements(svg: string): string {
    return svg.replace(/<[^>]+display="none"[^>]*>[\s\S]*?<\/[^>]+>/g, '');
  }

  /**
   * Minify styles
   */
  private minifySVGStyles(svg: string): string {
    return svg.replace(/\s+/g, ' ').trim();
  }
}
