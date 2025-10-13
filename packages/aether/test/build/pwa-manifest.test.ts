/**
 * PWA Manifest Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PWAManifestGenerator,
  createPWAManifest,
  type PWAOptions,
  type PWAManifestConfig,
  type IconConfig,
  type ShortcutConfig,
} from '../../src/build/pwa-manifest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('PWA Manifest', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = path.join(os.tmpdir(), `aether-pwa-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PWAManifestGenerator', () => {
    describe('Basic Manifest Generation', () => {
      it('should generate basic manifest with required fields', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            short_name: 'Test',
            description: 'Test application',
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        expect(result.manifest).toBeDefined();
        expect(result.manifestPath).toBe(path.join(tempDir, 'manifest.json'));

        const manifest = JSON.parse(result.manifest);
        expect(manifest.name).toBe('Test App');
        expect(manifest.short_name).toBe('Test');
        expect(manifest.description).toBe('Test application');
      });

      it('should use defaults for optional fields', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.short_name).toBe('Test App'); // Defaults to name
        expect(manifest.theme_color).toBe('#000000');
        expect(manifest.background_color).toBe('#ffffff');
        expect(manifest.display).toBe('standalone');
        expect(manifest.orientation).toBe('any');
        expect(manifest.scope).toBe('/');
        expect(manifest.start_url).toBe('/');
        expect(manifest.lang).toBe('en');
        expect(manifest.dir).toBe('ltr');
      });

      it('should validate required fields', async () => {
        const config: PWAOptions = {
          manifest: {} as PWAManifestConfig,
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);

        await expect(generator.generate()).rejects.toThrow('PWA manifest must have a name');
      });
    });

    describe('Icons', () => {
      it('should include icons in manifest', async () => {
        const icons: IconConfig[] = [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ];

        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            icons,
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.icons).toHaveLength(2);
        expect(manifest.icons[0]).toEqual({
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        });
      });

      it('should support maskable icons', async () => {
        const icons: IconConfig[] = [{ src: '/icons/icon-192.png', sizes: '192x192', purpose: 'maskable' }];

        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            icons,
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.icons[0].purpose).toBe('maskable');
      });
    });

    describe('Shortcuts', () => {
      it('should include shortcuts in manifest', async () => {
        const shortcuts: ShortcutConfig[] = [
          {
            name: 'New Document',
            short_name: 'New',
            description: 'Create a new document',
            url: '/new',
            icons: [{ src: '/icons/new.png', sizes: '96x96' }],
          },
        ];

        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            shortcuts,
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.shortcuts).toHaveLength(1);
        expect(manifest.shortcuts[0].name).toBe('New Document');
        expect(manifest.shortcuts[0].url).toBe('/new');
      });
    });

    describe('Screenshots', () => {
      it('should include screenshots in manifest', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            screenshots: [
              {
                src: '/screenshots/desktop.png',
                sizes: '1920x1080',
                type: 'image/png',
                platform: 'wide',
              },
              {
                src: '/screenshots/mobile.png',
                sizes: '750x1334',
                type: 'image/png',
                platform: 'narrow',
              },
            ],
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.screenshots).toHaveLength(2);
        expect(manifest.screenshots[0].platform).toBe('wide');
        expect(manifest.screenshots[1].platform).toBe('narrow');
      });
    });

    describe('Display Modes', () => {
      it('should support all display modes', async () => {
        const displays = ['fullscreen', 'standalone', 'minimal-ui', 'browser'] as const;

        for (const display of displays) {
          const config: PWAOptions = {
            manifest: {
              name: 'Test App',
              display,
            },
            outDir: tempDir,
          };

          const generator = new PWAManifestGenerator(config);
          const result = await generator.generate();

          const manifest = JSON.parse(result.manifest);
          expect(manifest.display).toBe(display);
        }
      });
    });

    describe('Orientation', () => {
      it('should support orientation settings', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            orientation: 'portrait',
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.orientation).toBe('portrait');
      });
    });

    describe('Categories', () => {
      it('should include categories in manifest', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            categories: ['productivity', 'utilities'],
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.categories).toEqual(['productivity', 'utilities']);
      });
    });

    describe('Related Applications', () => {
      it('should include related applications', async () => {
        const config: PWAOptions = {
          manifest: {
            name: 'Test App',
            prefer_related_applications: true,
            related_applications: [
              {
                platform: 'play',
                url: 'https://play.google.com/store/apps/details?id=com.example.app',
                id: 'com.example.app',
              },
            ],
          },
          outDir: tempDir,
        };

        const generator = new PWAManifestGenerator(config);
        const result = await generator.generate();

        const manifest = JSON.parse(result.manifest);
        expect(manifest.prefer_related_applications).toBe(true);
        expect(manifest.related_applications).toHaveLength(1);
        expect(manifest.related_applications[0].platform).toBe('play');
      });
    });
  });

  describe('Icon Generation', () => {
    it('should track generated icon paths', async () => {
      // Create a dummy icon file
      const iconPath = path.join(tempDir, 'icon.png');
      await fs.writeFile(iconPath, Buffer.from('fake-image-data'));

      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        iconGeneration: {
          source: iconPath,
          outputDir: path.join(tempDir, 'icons'),
          sizes: [192, 512],
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.icons.size).toBeGreaterThan(0);
      expect(Array.from(result.icons.keys())).toContain(path.join(tempDir, 'icons', 'icon-192x192.png'));
    });

    it('should validate icon source exists', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        iconGeneration: {
          source: '/nonexistent/icon.png',
          outputDir: path.join(tempDir, 'icons'),
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);

      await expect(generator.generate()).rejects.toThrow('Failed to read source icon');
    });

    it('should generate maskable icons when configured', async () => {
      const iconPath = path.join(tempDir, 'icon.png');
      await fs.writeFile(iconPath, Buffer.from('fake-image-data'));

      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        iconGeneration: {
          source: iconPath,
          outputDir: path.join(tempDir, 'icons'),
          sizes: [192],
          maskable: true,
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const maskablePath = path.join(tempDir, 'icons', 'icon-192x192-maskable.png');
      expect(result.icons.has(maskablePath)).toBe(true);
    });

    it('should generate favicon when configured', async () => {
      const iconPath = path.join(tempDir, 'icon.png');
      await fs.writeFile(iconPath, Buffer.from('fake-image-data'));

      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        iconGeneration: {
          source: iconPath,
          outputDir: path.join(tempDir, 'icons'),
          favicon: true,
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const faviconPath = path.join(tempDir, 'favicon.ico');
      expect(result.icons.has(faviconPath)).toBe(true);
    });
  });

  describe('Service Worker', () => {
    it('should generate basic service worker', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          precache: ['/index.html', '/styles.css', '/script.js'],
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.serviceWorker).toBeDefined();
      expect(result.serviceWorker).toContain('CACHE_NAME');
      expect(result.serviceWorker).toContain('/index.html');
      expect(result.files).toContain(path.join(tempDir, 'sw.js'));
    });

    it('should support cache-first strategy', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          cacheStrategy: 'cache-first',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.serviceWorker).toContain('cache-first');
    });

    it('should support network-first strategy', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          cacheStrategy: 'network-first',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.serviceWorker).toContain('network-first');
    });

    it('should support stale-while-revalidate strategy', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          cacheStrategy: 'stale-while-revalidate',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.serviceWorker).toContain('stale-while-revalidate');
    });

    it('should use custom service worker source if provided', async () => {
      const customSW = '// Custom service worker\nconsole.log("Custom SW");';
      const swPath = path.join(tempDir, 'custom-sw.js');
      await fs.writeFile(swPath, customSW);

      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: swPath,
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      expect(result.serviceWorker).toBe(customSW);
    });
  });

  describe('Offline Page', () => {
    it('should generate offline page by default', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const offlinePath = path.join(tempDir, 'offline.html');
      expect(result.files).toContain(offlinePath);

      const content = await fs.readFile(offlinePath, 'utf-8');
      expect(content).toContain("You're offline");
      expect(content).toContain('Test App');
    });

    it('should skip offline page generation when disabled', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        generateOfflinePage: false,
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const offlinePath = path.join(tempDir, 'offline.html');
      expect(result.files).not.toContain(offlinePath);
    });

    it('should use theme colors in offline page', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
          theme_color: '#ff0000',
          background_color: '#00ff00',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      await generator.generate();

      const offlinePath = path.join(tempDir, 'offline.html');
      const content = await fs.readFile(offlinePath, 'utf-8');
      expect(content).toContain('#ff0000');
      expect(content).toContain('#00ff00');
    });
  });

  describe('HTML Injection', () => {
    it('should inject manifest link in HTML', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
          theme_color: '#123456',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const result = await generator.injectManifestInHTML(html);

      expect(result).toContain('<link rel="manifest" href="/manifest.json">');
      expect(result).toContain('<meta name="theme-color" content="#123456">');
      expect(result).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    });

    it('should inject service worker registration', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
</body>
</html>`;

      const result = await generator.injectServiceWorkerRegistration(html);

      expect(result).toContain('serviceWorker');
      expect(result).toContain('navigator.serviceWorker.register');
      expect(result).toContain('/sw.js');
    });

    it('should support auto update strategy', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          updateStrategy: 'auto',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const html = '<html><body></body></html>';

      const result = await generator.injectServiceWorkerRegistration(html);

      expect(result).toContain('updatefound');
      expect(result).toContain('New version available');
    });

    it('should support manual update strategy', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        serviceWorker: {
          src: '',
          updateStrategy: 'manual',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const html = '<html><body></body></html>';

      const result = await generator.injectServiceWorkerRegistration(html);

      expect(result).not.toContain('updatefound');
    });
  });

  describe('Factory Function', () => {
    it('should create generator via factory function', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        outDir: tempDir,
      };

      const generator = createPWAManifest(config);
      expect(generator).toBeInstanceOf(PWAManifestGenerator);

      const result = await generator.generate();
      expect(result.manifest).toBeDefined();
    });
  });

  describe('File System Operations', () => {
    it('should create output directory if it does not exist', async () => {
      const nonExistentDir = path.join(tempDir, 'nested', 'dir');

      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        outDir: nonExistentDir,
      };

      const generator = new PWAManifestGenerator(config);
      await generator.generate();

      const manifestPath = path.join(nonExistentDir, 'manifest.json');
      const exists = await fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should write manifest.json file', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      await generator.generate();

      const manifestPath = path.join(tempDir, 'manifest.json');
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.name).toBe('Test App');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty icon array', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
          icons: [],
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const manifest = JSON.parse(result.manifest);
      expect(manifest.icons).toBeUndefined();
    });

    it('should handle special characters in app name', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test & Demo <App>',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const manifest = JSON.parse(result.manifest);
      expect(manifest.name).toBe('Test & Demo <App>');
    });

    it('should handle custom scope and start_url', async () => {
      const config: PWAOptions = {
        manifest: {
          name: 'Test App',
          scope: '/app/',
          start_url: '/app/index.html',
        },
        outDir: tempDir,
      };

      const generator = new PWAManifestGenerator(config);
      const result = await generator.generate();

      const manifest = JSON.parse(result.manifest);
      expect(manifest.scope).toBe('/app/');
      expect(manifest.start_url).toBe('/app/index.html');
    });
  });
});
