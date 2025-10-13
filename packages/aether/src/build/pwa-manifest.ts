/**
 * PWA Manifest Generation
 * Generates PWA manifests, icons, and service worker integration
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Icon configuration
 */
export interface IconConfig {
  /**
   * Icon source path
   */
  src: string;

  /**
   * Icon sizes (e.g., "192x192", "512x512")
   */
  sizes: string;

  /**
   * Icon MIME type
   * @default "image/png"
   */
  type?: string;

  /**
   * Icon purpose
   * @default "any"
   */
  purpose?: 'any' | 'maskable' | 'monochrome';
}

/**
 * Shortcut configuration
 */
export interface ShortcutConfig {
  /**
   * Shortcut name
   */
  name: string;

  /**
   * Short name
   */
  short_name?: string;

  /**
   * Shortcut description
   */
  description?: string;

  /**
   * Shortcut URL
   */
  url: string;

  /**
   * Shortcut icons
   */
  icons?: IconConfig[];
}

/**
 * Screenshot configuration
 */
export interface ScreenshotConfig {
  /**
   * Screenshot source path
   */
  src: string;

  /**
   * Screenshot sizes (e.g., "1280x720")
   */
  sizes: string;

  /**
   * Screenshot MIME type
   * @default "image/png"
   */
  type?: string;

  /**
   * Screenshot form factor
   */
  platform?: 'narrow' | 'wide';
}

/**
 * PWA Manifest configuration
 */
export interface PWAManifestConfig {
  /**
   * Application name
   */
  name: string;

  /**
   * Short name
   */
  short_name?: string;

  /**
   * Application description
   */
  description?: string;

  /**
   * Theme color
   * @default "#000000"
   */
  theme_color?: string;

  /**
   * Background color
   * @default "#ffffff"
   */
  background_color?: string;

  /**
   * Display mode
   * @default "standalone"
   */
  display?: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';

  /**
   * Screen orientation
   * @default "any"
   */
  orientation?:
    | 'any'
    | 'portrait'
    | 'landscape'
    | 'portrait-primary'
    | 'portrait-secondary'
    | 'landscape-primary'
    | 'landscape-secondary';

  /**
   * Application scope
   * @default "/"
   */
  scope?: string;

  /**
   * Start URL
   * @default "/"
   */
  start_url?: string;

  /**
   * Application icons
   */
  icons?: IconConfig[];

  /**
   * Application shortcuts
   */
  shortcuts?: ShortcutConfig[];

  /**
   * Application screenshots
   */
  screenshots?: ScreenshotConfig[];

  /**
   * Application categories
   */
  categories?: string[];

  /**
   * Language
   * @default "en"
   */
  lang?: string;

  /**
   * Text direction
   * @default "ltr"
   */
  dir?: 'ltr' | 'rtl' | 'auto';

  /**
   * ID for identifying the app
   */
  id?: string;

  /**
   * Prefer related applications
   * @default false
   */
  prefer_related_applications?: boolean;

  /**
   * Related applications
   */
  related_applications?: Array<{
    platform: string;
    url?: string;
    id?: string;
  }>;
}

/**
 * Icon generation configuration
 */
export interface IconGenerationConfig {
  /**
   * Source icon path (should be high resolution)
   */
  source: string;

  /**
   * Output directory for generated icons
   */
  outputDir: string;

  /**
   * Sizes to generate (e.g., [72, 96, 128, 144, 152, 192, 384, 512])
   * @default [72, 96, 128, 144, 152, 192, 384, 512]
   */
  sizes?: number[];

  /**
   * Generate favicon
   * @default true
   */
  favicon?: boolean;

  /**
   * Generate Apple touch icons
   * @default true
   */
  appleTouchIcon?: boolean;

  /**
   * Generate MS tile icons
   * @default true
   */
  msTileIcon?: boolean;

  /**
   * Generate maskable icons
   * @default true
   */
  maskable?: boolean;
}

/**
 * Service worker configuration
 */
export interface ServiceWorkerConfig {
  /**
   * Service worker file path
   */
  src: string;

  /**
   * Service worker scope
   * @default "/"
   */
  scope?: string;

  /**
   * Update strategy
   * @default "auto"
   */
  updateStrategy?: 'auto' | 'manual';

  /**
   * Cache strategy
   * @default "network-first"
   */
  cacheStrategy?: 'cache-first' | 'network-first' | 'cache-only' | 'network-only' | 'stale-while-revalidate';

  /**
   * Assets to precache
   */
  precache?: string[];

  /**
   * Runtime caching rules
   */
  runtimeCaching?: Array<{
    urlPattern: string | RegExp;
    handler: 'CacheFirst' | 'NetworkFirst' | 'CacheOnly' | 'NetworkOnly' | 'StaleWhileRevalidate';
    options?: {
      cacheName?: string;
      expiration?: {
        maxEntries?: number;
        maxAgeSeconds?: number;
      };
    };
  }>;
}

/**
 * PWA options
 */
export interface PWAOptions {
  /**
   * Manifest configuration
   */
  manifest: PWAManifestConfig;

  /**
   * Icon generation configuration
   */
  iconGeneration?: IconGenerationConfig;

  /**
   * Service worker configuration
   */
  serviceWorker?: ServiceWorkerConfig;

  /**
   * Output directory
   * @default "dist"
   */
  outDir?: string;

  /**
   * Inject manifest link in HTML
   * @default true
   */
  injectManifest?: boolean;

  /**
   * Generate offline page
   * @default true
   */
  generateOfflinePage?: boolean;

  /**
   * Offline page path
   * @default "/offline.html"
   */
  offlinePage?: string;
}

/**
 * PWA Manifest result
 */
export interface PWAManifestResult {
  /**
   * Generated manifest content
   */
  manifest: string;

  /**
   * Generated icons
   */
  icons: Map<string, Buffer>;

  /**
   * Service worker content
   */
  serviceWorker?: string;

  /**
   * Manifest file path
   */
  manifestPath: string;

  /**
   * Generated files
   */
  files: string[];
}

/**
 * PWA Manifest Generator
 */
export class PWAManifestGenerator {
  private config: PWAOptions;

  constructor(config: PWAOptions) {
    this.config = {
      outDir: 'dist',
      injectManifest: true,
      generateOfflinePage: true,
      offlinePage: '/offline.html',
      ...config,
    };
  }

  /**
   * Generate PWA manifest and assets
   */
  async generate(): Promise<PWAManifestResult> {
    // Validate configuration
    this.validateConfig();

    // Generate manifest
    const manifest = this.generateManifest();

    // Generate icons if configured
    const icons = new Map<string, Buffer>();
    if (this.config.iconGeneration) {
      // Icon generation would use a library like sharp
      // For now, we'll track the icon paths
      await this.generateIcons(icons);
    }

    // Generate service worker if configured
    let serviceWorker: string | undefined;
    if (this.config.serviceWorker) {
      serviceWorker = await this.generateServiceWorker();
    }

    // Write manifest file
    const manifestPath = path.join(this.config.outDir!, 'manifest.json');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, manifest, 'utf-8');

    // Write service worker if generated
    const files: string[] = [manifestPath];
    if (serviceWorker && this.config.serviceWorker) {
      const swPath = path.join(this.config.outDir!, 'sw.js');
      await fs.writeFile(swPath, serviceWorker, 'utf-8');
      files.push(swPath);
    }

    // Generate offline page if configured
    if (this.config.generateOfflinePage) {
      const offlinePath = await this.generateOfflinePage();
      files.push(offlinePath);
    }

    return {
      manifest,
      icons,
      serviceWorker,
      manifestPath,
      files,
    };
  }

  /**
   * Validate configuration
   */
  private validateConfig(): void {
    if (!this.config.manifest.name) {
      throw new Error('PWA manifest must have a name');
    }

    if (this.config.iconGeneration && !this.config.iconGeneration.source) {
      throw new Error('Icon generation requires a source icon');
    }
  }

  /**
   * Generate manifest JSON
   */
  private generateManifest(): string {
    const manifest: Record<string, any> = {
      name: this.config.manifest.name,
      short_name: this.config.manifest.short_name || this.config.manifest.name,
      description: this.config.manifest.description,
      theme_color: this.config.manifest.theme_color || '#000000',
      background_color: this.config.manifest.background_color || '#ffffff',
      display: this.config.manifest.display || 'standalone',
      orientation: this.config.manifest.orientation || 'any',
      scope: this.config.manifest.scope || '/',
      start_url: this.config.manifest.start_url || '/',
      lang: this.config.manifest.lang || 'en',
      dir: this.config.manifest.dir || 'ltr',
    };

    // Add optional fields
    if (this.config.manifest.id) {
      manifest.id = this.config.manifest.id;
    }

    if (this.config.manifest.icons && this.config.manifest.icons.length > 0) {
      manifest.icons = this.config.manifest.icons.map((icon) => ({
        src: icon.src,
        sizes: icon.sizes,
        type: icon.type || 'image/png',
        purpose: icon.purpose || 'any',
      }));
    }

    if (this.config.manifest.shortcuts && this.config.manifest.shortcuts.length > 0) {
      manifest.shortcuts = this.config.manifest.shortcuts;
    }

    if (this.config.manifest.screenshots && this.config.manifest.screenshots.length > 0) {
      manifest.screenshots = this.config.manifest.screenshots.map((screenshot) => ({
        src: screenshot.src,
        sizes: screenshot.sizes,
        type: screenshot.type || 'image/png',
        ...(screenshot.platform && { platform: screenshot.platform }),
      }));
    }

    if (this.config.manifest.categories && this.config.manifest.categories.length > 0) {
      manifest.categories = this.config.manifest.categories;
    }

    if (this.config.manifest.prefer_related_applications !== undefined) {
      manifest.prefer_related_applications = this.config.manifest.prefer_related_applications;
    }

    if (this.config.manifest.related_applications && this.config.manifest.related_applications.length > 0) {
      manifest.related_applications = this.config.manifest.related_applications;
    }

    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Generate icons from source
   */
  private async generateIcons(icons: Map<string, Buffer>): Promise<void> {
    const iconConfig = this.config.iconGeneration!;
    const sizes = iconConfig.sizes || [72, 96, 128, 144, 152, 192, 384, 512];

    // Read source icon
    try {
      const sourceBuffer = await fs.readFile(iconConfig.source);

      // Generate icons for each size
      for (const size of sizes) {
        const iconPath = path.join(iconConfig.outputDir, `icon-${size}x${size}.png`);
        // In a real implementation, you would use a library like sharp to resize
        // For now, we'll just store the source buffer as a placeholder
        icons.set(iconPath, sourceBuffer);

        // Generate maskable version if configured
        if (iconConfig.maskable) {
          const maskablePath = path.join(iconConfig.outputDir, `icon-${size}x${size}-maskable.png`);
          icons.set(maskablePath, sourceBuffer);
        }
      }

      // Generate favicon
      if (iconConfig.favicon !== false) {
        const faviconPath = path.join(this.config.outDir!, 'favicon.ico');
        icons.set(faviconPath, sourceBuffer);
      }

      // Generate Apple touch icon
      if (iconConfig.appleTouchIcon !== false) {
        const appleTouchIconPath = path.join(this.config.outDir!, 'apple-touch-icon.png');
        icons.set(appleTouchIconPath, sourceBuffer);
      }

      // Generate MS tile icon
      if (iconConfig.msTileIcon !== false) {
        const msTilePath = path.join(this.config.outDir!, 'mstile-150x150.png');
        icons.set(msTilePath, sourceBuffer);
      }
    } catch (error) {
      throw new Error(`Failed to read source icon: ${error}`);
    }
  }

  /**
   * Generate service worker
   */
  private async generateServiceWorker(): Promise<string> {
    const swConfig = this.config.serviceWorker!;

    // If source file is provided, use it
    if (swConfig.src) {
      try {
        return await fs.readFile(swConfig.src, 'utf-8');
      } catch (error) {
        console.warn(`Failed to read service worker source: ${error}`);
      }
    }

    // Generate basic service worker
    const precacheAssets = swConfig.precache || [];
    const cacheStrategy = swConfig.cacheStrategy || 'network-first';
    const cacheName = `aether-cache-${this.generateCacheVersion()}`;

    let sw = `// Aether PWA Service Worker
const CACHE_NAME = '${cacheName}';
const PRECACHE_URLS = ${JSON.stringify(precacheAssets, null, 2)};

// Install event - precache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

`;

    // Add fetch handler based on cache strategy
    if (cacheStrategy === 'cache-first') {
      sw += `// Fetch event - cache-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
`;
    } else if (cacheStrategy === 'network-first') {
      sw += `// Fetch event - network-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
          return response || caches.match('${this.config.offlinePage}');
        });
      })
  );
});
`;
    } else if (cacheStrategy === 'stale-while-revalidate') {
      sw += `// Fetch event - stale-while-revalidate strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
      return cachedResponse || fetchPromise;
    })
  );
});
`;
    }

    // Add runtime caching rules if configured
    if (swConfig.runtimeCaching && swConfig.runtimeCaching.length > 0) {
      sw += `
// Runtime caching rules
`;
      for (const rule of swConfig.runtimeCaching) {
        const pattern = typeof rule.urlPattern === 'string' ? `'${rule.urlPattern}'` : rule.urlPattern.toString();
        sw += `// ${rule.handler} for ${pattern}\n`;
      }
    }

    return sw;
  }

  /**
   * Generate offline page
   */
  private async generateOfflinePage(): Promise<string> {
    const offlineHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - ${this.config.manifest.name}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: ${this.config.manifest.background_color || '#ffffff'};
      color: ${this.config.manifest.theme_color || '#000000'};
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.1rem;
      color: #666;
    }
    button {
      margin-top: 2rem;
      padding: 0.75rem 2rem;
      font-size: 1rem;
      background: ${this.config.manifest.theme_color || '#000000'};
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>You're offline</h1>
    <p>Please check your internet connection and try again.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`;

    const offlinePath = path.join(this.config.outDir!, 'offline.html');
    await fs.mkdir(path.dirname(offlinePath), { recursive: true });
    await fs.writeFile(offlinePath, offlineHtml, 'utf-8');

    return offlinePath;
  }

  /**
   * Generate cache version
   */
  private generateCacheVersion(): string {
    const content = JSON.stringify(this.config);
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
  }

  /**
   * Inject manifest link in HTML
   */
  async injectManifestInHTML(html: string, manifestPath: string = '/manifest.json'): Promise<string> {
    if (!this.config.injectManifest) {
      return html;
    }

    const manifestLink = `<link rel="manifest" href="${manifestPath}">`;
    const themeColorMeta = `<meta name="theme-color" content="${this.config.manifest.theme_color || '#000000'}">`;
    const appleMobileCapable = `<meta name="apple-mobile-web-app-capable" content="yes">`;
    const appleMobileStatus = `<meta name="apple-mobile-web-app-status-bar-style" content="default">`;
    const appleMobileTitle = `<meta name="apple-mobile-web-app-title" content="${this.config.manifest.short_name || this.config.manifest.name}">`;

    // Inject in head
    const headClosingTag = '</head>';
    const injection = `  ${manifestLink}\n  ${themeColorMeta}\n  ${appleMobileCapable}\n  ${appleMobileStatus}\n  ${appleMobileTitle}\n${headClosingTag}`;

    return html.replace(headClosingTag, injection);
  }

  /**
   * Inject service worker registration in HTML
   */
  async injectServiceWorkerRegistration(html: string, swPath: string = '/sw.js'): Promise<string> {
    if (!this.config.serviceWorker) {
      return html;
    }

    const updateStrategy = this.config.serviceWorker.updateStrategy || 'auto';

    const swRegistration = `
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('${swPath}')
          .then((registration) => {
            console.log('Service Worker registered:', registration);

            ${
              updateStrategy === 'auto'
                ? `
            // Check for updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New service worker available
                  if (confirm('New version available! Reload to update?')) {
                    window.location.reload();
                  }
                }
              });
            });
            `
                : ''
            }
          })
          .catch((error) => {
            console.error('Service Worker registration failed:', error);
          });
      });
    }
  </script>
</body>`;

    return html.replace('</body>', swRegistration);
  }
}

/**
 * Create PWA manifest generator
 */
export function createPWAManifest(config: PWAOptions): PWAManifestGenerator {
  return new PWAManifestGenerator(config);
}
