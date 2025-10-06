# 30. Progressive Web Apps

## Table of Contents
- [Overview](#overview)
- [Web App Manifest](#web-app-manifest)
- [Service Workers](#service-workers)
- [Caching Strategies](#caching-strategies)
- [Offline Support](#offline-support)
- [Push Notifications](#push-notifications)
- [Background Sync](#background-sync)
- [Installation](#installation)
- [App-Like Experience](#app-like-experience)
- [Platform Features](#platform-features)
- [Performance](#performance)
- [Testing](#testing)
- [Tools](#tools)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Progressive Web Apps (PWAs) combine the best of web and native apps, providing app-like experiences with web technologies.

### PWA Benefits

```typescript
/**
 * Benefits of PWAs:
 *
 * 1. Installable
 *    - Add to home screen
 *    - Launch like native app
 *    - No app store required
 *
 * 2. Offline-First
 *    - Work without internet
 *    - Fast loading
 *    - Resilient to network issues
 *
 * 3. Re-engageable
 *    - Push notifications
 *    - Background sync
 *    - Keep users engaged
 *
 * 4. Cross-Platform
 *    - Single codebase
 *    - Works everywhere
 *    - Progressive enhancement
 *
 * 5. Discoverable
 *    - SEO-friendly
 *    - Shareable URLs
 *    - Deep linking
 *
 * 6. Safe
 *    - HTTPS required
 *    - Secure by default
 */
```

### PWA Requirements

```typescript
/**
 * PWA Checklist:
 *
 * [ ] Served over HTTPS
 * [ ] Web App Manifest
 * [ ] Service Worker registered
 * [ ] Responsive design
 * [ ] Works offline
 * [ ] Fast load time (< 3s)
 * [ ] App-like interactions
 */
```

## Web App Manifest

The manifest provides metadata about your app.

### Basic Manifest

```json
// public/manifest.json
{
  "name": "Nexus App",
  "short_name": "Nexus",
  "description": "A progressive web app built with Nexus",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/home.png",
      "sizes": "1280x720",
      "type": "image/png",
      "label": "Home screen"
    },
    {
      "src": "/screenshots/dashboard.png",
      "sizes": "1280x720",
      "type": "image/png",
      "label": "Dashboard"
    }
  ],
  "categories": ["productivity", "business"],
  "lang": "en-US",
  "dir": "ltr"
}
```

### Include Manifest in HTML

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#3b82f6">
  <meta name="description" content="A progressive web app built with Nexus">

  <!-- Manifest -->
  <link rel="manifest" href="/manifest.json">

  <!-- iOS specific -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Nexus">
  <link rel="apple-touch-icon" href="/icons/icon-192x192.png">

  <title>Nexus App</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

### Dynamic Manifest

```typescript
// Generate manifest dynamically
export const generateManifest = (theme: Theme) => {
  return {
    name: 'Nexus App',
    short_name: 'Nexus',
    start_url: '/',
    display: 'standalone',
    background_color: theme.colors.background,
    theme_color: theme.colors.primary,
    icons: [
      // ... icons
    ]
  };
};

// Server endpoint
app.get('/manifest.json', (req, res) => {
  const theme = getUserTheme(req);
  const manifest = generateManifest(theme);
  res.json(manifest);
});
```

## Service Workers

Service workers enable offline functionality and caching.

### Register Service Worker

```typescript
// main.tsx
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', registration);

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available
            showUpdateNotification();
          }
        });
      });
    } catch (error) {
      console.error('SW registration failed:', error);
    }
  });
}

// Show update notification
const showUpdateNotification = () => {
  const updateBanner = document.createElement('div');
  updateBanner.innerHTML = `
    <div class="update-banner">
      <p>New version available!</p>
      <button onclick="window.location.reload()">Update</button>
    </div>
  `;
  document.body.appendChild(updateBanner);
};
```

### Service Worker Lifecycle

```typescript
// public/sw.js
const CACHE_VERSION = 'v1';
const CACHE_NAME = `nexus-cache-${CACHE_VERSION}`;

const STATIC_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/main.js',
  '/manifest.json',
  '/offline.html'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('SW: Installing');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Caching static assets');
      return cache.addAll(STATIC_CACHE);
    }).then(() => {
      // Activate immediately
      return self.skipWaiting();
    })
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('SW: Activating');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Take control immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached response or fetch from network
      return response || fetch(event.request);
    }).catch(() => {
      // Return offline page for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/offline.html');
      }
    })
  );
});
```

## Caching Strategies

Different strategies for different types of content.

### Cache First

```typescript
// Cache first, fallback to network
// Good for: Static assets, images
self.addEventListener('fetch', (event) => {
  if (event.request.destination === 'image') {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request).then((fetchResponse) => {
          // Cache new images
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
    );
  }
});
```

### Network First

```typescript
// Network first, fallback to cache
// Good for: API requests, dynamic content
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        // Update cache with latest
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response.clone());
        });
        return response;
      }).catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
    );
  }
});
```

### Stale While Revalidate

```typescript
// Return cache immediately, update in background
// Good for: Frequently updated content
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((response) => {
        // Fetch in background
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });

        // Return cached response immediately or wait for network
        return response || fetchPromise;
      });
    })
  );
});
```

### Cache Only

```typescript
// Only serve from cache
// Good for: App shell
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/app-shell')) {
    event.respondWith(
      caches.match(event.request)
    );
  }
});
```

### Network Only

```typescript
// Always fetch from network
// Good for: Real-time data
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/real-time/')) {
    event.respondWith(
      fetch(event.request)
    );
  }
});
```

## Offline Support

Provide graceful offline experience.

### Offline Page

```html
<!-- public/offline.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline - Nexus App</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .offline-content {
      text-align: center;
      padding: 2rem;
    }
    .offline-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="offline-content">
    <div class="offline-icon">📡</div>
    <h1>You're offline</h1>
    <p>Check your internet connection and try again.</p>
    <button onclick="window.location.reload()">Retry</button>
  </div>
</body>
</html>
```

### Detect Online/Offline

```typescript
// Detect network status
export const useOnlineStatus = () => {
  const online = signal(navigator.onLine);

  onMount(() => {
    const handleOnline = () => online.set(true);
    const handleOffline = () => online.set(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    onCleanup(() => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
  });

  return online;
};

// Usage
export default defineComponent(() => {
  const online = useOnlineStatus();

  return () => (
    <>
      {!online() && (
        <div class="offline-banner">
          You're offline. Some features may not be available.
        </div>
      )}
      <App />
    </>
  );
});
```

### Queue Offline Actions

```typescript
// Queue requests when offline
class OfflineQueue {
  private queue: Array<{
    url: string;
    method: string;
    body?: any;
  }> = [];

  add(request: { url: string; method: string; body?: any }) {
    this.queue.push(request);
    this.save();
  }

  async process() {
    if (!navigator.onLine) return;

    for (const request of this.queue) {
      try {
        await fetch(request.url, {
          method: request.method,
          body: request.body ? JSON.stringify(request.body) : undefined,
          headers: { 'Content-Type': 'application/json' }
        });

        // Remove from queue on success
        this.queue = this.queue.filter(r => r !== request);
      } catch (error) {
        console.error('Failed to process queued request:', error);
      }
    }

    this.save();
  }

  private save() {
    localStorage.setItem('offline-queue', JSON.stringify(this.queue));
  }

  private load() {
    const saved = localStorage.getItem('offline-queue');
    if (saved) {
      this.queue = JSON.parse(saved);
    }
  }
}

const offlineQueue = new OfflineQueue();

// Process queue when online
window.addEventListener('online', () => {
  offlineQueue.process();
});

// Usage
export const saveData = async (data: any) => {
  if (!navigator.onLine) {
    offlineQueue.add({
      url: '/api/save',
      method: 'POST',
      body: data
    });
    return { queued: true };
  }

  return fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};
```

## Push Notifications

Engage users with push notifications.

### Request Permission

```typescript
// Request notification permission
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!('Notification' in window)) {
    console.log('Notifications not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
};

// Subscribe to push notifications
export const subscribeToPush = async (): Promise<PushSubscription | null> => {
  const registration = await navigator.serviceWorker.ready;

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.VITE_VAPID_PUBLIC_KEY!
      )
    });

    // Send subscription to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe:', error);
    return null;
  }
};

// Helper function
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
```

### Handle Push Events

```typescript
// public/sw.js

// Push event
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};

  const title = data.title || 'Nexus App';
  const options = {
    body: data.body || 'New notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: {
      url: data.url || '/',
      ...data.data
    },
    actions: data.actions || [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' }
    ],
    tag: data.tag,
    requireInteraction: data.requireInteraction || false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.openWindow(url)
  );
});
```

### Server-Side Push

```typescript
// server.ts
import webpush from 'web-push';

// Configure VAPID keys
webpush.setVapidDetails(
  'mailto:example@example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// Send push notification
export const sendPushNotification = async (
  subscription: PushSubscription,
  payload: {
    title: string;
    body: string;
    url?: string;
    data?: any;
  }
) => {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );
  } catch (error) {
    console.error('Error sending push:', error);
  }
};

// Subscribe endpoint
app.post('/api/push/subscribe', async (req, res) => {
  const subscription = req.body;

  // Save subscription to database
  await db.pushSubscription.create({
    data: {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      userId: req.userId
    }
  });

  res.json({ success: true });
});

// Send notification to user
export const notifyUser = async (userId: string, message: any) => {
  const subscriptions = await db.pushSubscription.findMany({
    where: { userId }
  });

  await Promise.all(
    subscriptions.map(sub =>
      sendPushNotification(sub as any, message)
    )
  );
};
```

## Background Sync

Sync data in the background.

### Background Sync API

```typescript
// Register background sync
export const registerBackgroundSync = async (tag: string) => {
  const registration = await navigator.serviceWorker.ready;

  try {
    await registration.sync.register(tag);
  } catch (error) {
    console.error('Background sync failed:', error);
  }
};

// Usage
export const savePost = async (post: Post) => {
  // Try to save immediately
  try {
    await fetch('/api/posts', {
      method: 'POST',
      body: JSON.stringify(post)
    });
  } catch (error) {
    // Queue for background sync
    await storeInIndexedDB('pending-posts', post);
    await registerBackgroundSync('sync-posts');
  }
};
```

### Handle Sync Events

```typescript
// public/sw.js

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-posts') {
    event.waitUntil(
      syncPosts()
    );
  }
});

async function syncPosts() {
  const posts = await getFromIndexedDB('pending-posts');

  for (const post of posts) {
    try {
      await fetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify(post)
      });

      // Remove from IndexedDB on success
      await removeFromIndexedDB('pending-posts', post.id);
    } catch (error) {
      console.error('Failed to sync post:', error);
    }
  }
}
```

## Installation

Make your app installable.

### Installation Prompt

```typescript
// Handle beforeinstallprompt event
let deferredPrompt: any = null;

window.addEventListener('beforeinstallprompt', (event) => {
  // Prevent default prompt
  event.preventDefault();

  // Store for later
  deferredPrompt = event;

  // Show custom install button
  showInstallButton();
});

export const showInstallPrompt = async () => {
  if (!deferredPrompt) return;

  // Show prompt
  deferredPrompt.prompt();

  // Wait for user choice
  const { outcome } = await deferredPrompt.userChoice;

  if (outcome === 'accepted') {
    console.log('User accepted install');
  }

  // Clear prompt
  deferredPrompt = null;
};

// Track installation
window.addEventListener('appinstalled', () => {
  console.log('PWA installed');

  // Track event
  analytics.track('app_installed');
});
```

### Install Button Component

```typescript
export const InstallButton = defineComponent(() => {
  const canInstall = signal(false);

  onMount(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      deferredPrompt = event;
      canInstall.set(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    onCleanup(() => {
      window.removeEventListener('beforeinstallprompt', handler);
    });
  });

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      canInstall.set(false);
    }

    deferredPrompt = null;
  };

  return () => (
    <Show when={canInstall()}>
      <button onClick={handleInstall} class="install-button">
        📱 Install App
      </button>
    </Show>
  );
});
```

## App-Like Experience

Create an app-like experience.

### Standalone Mode Detection

```typescript
// Check if running as installed PWA
export const isStandalone = (): boolean => {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
};

// Different UI for standalone
export default defineComponent(() => {
  const standalone = isStandalone();

  return () => (
    <div class={standalone ? 'standalone' : 'browser'}>
      {!standalone && <BrowserHeader />}
      <App />
    </div>
  );
});
```

### App Shell Pattern

```typescript
// App shell - cached static content
export const AppShell = defineComponent(() => {
  return () => (
    <div class="app-shell">
      <Header />
      <Nav />
      <main>
        <Suspense fallback={<Loading />}>
          <Router />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
});
```

### iOS Specific

```html
<!-- Add to home screen icon (iOS) -->
<link rel="apple-touch-icon" href="/icons/icon-180x180.png">

<!-- Status bar style (iOS) -->
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">

<!-- Prevent auto-detection of phone numbers (iOS) -->
<meta name="format-detection" content="telephone=no">

<!-- Splash screens (iOS) -->
<link rel="apple-touch-startup-image" href="/splash/iphone5.png" media="(device-width: 320px)">
<link rel="apple-touch-startup-image" href="/splash/iphone6.png" media="(device-width: 375px)">
<link rel="apple-touch-startup-image" href="/splash/iphoneplus.png" media="(device-width: 414px)">
<link rel="apple-touch-startup-image" href="/splash/iphonex.png" media="(device-width: 375px) and (device-height: 812px)">
```

## Platform Features

Leverage platform-specific features.

### Share API

```typescript
// Web Share API
export const shareContent = async (data: {
  title: string;
  text: string;
  url: string;
}) => {
  if (!navigator.share) {
    // Fallback to copy URL
    await navigator.clipboard.writeText(data.url);
    alert('Link copied to clipboard!');
    return;
  }

  try {
    await navigator.share(data);
  } catch (error) {
    console.error('Error sharing:', error);
  }
};

// Usage
<button onClick={() => shareContent({
  title: 'Check this out!',
  text: 'Great article',
  url: window.location.href
})}>
  Share
</button>
```

### File System Access

```typescript
// File System Access API
export const saveFile = async (content: string, filename: string) => {
  if (!('showSaveFilePicker' in window)) {
    // Fallback to download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return;
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Text file',
        accept: { 'text/plain': ['.txt'] }
      }]
    });

    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (error) {
    console.error('Error saving file:', error);
  }
};
```

### Badging API

```typescript
// Update app badge (notification count)
export const setBadge = (count: number) => {
  if ('setAppBadge' in navigator) {
    (navigator as any).setAppBadge(count);
  }
};

export const clearBadge = () => {
  if ('clearAppBadge' in navigator) {
    (navigator as any).clearAppBadge();
  }
};

// Usage
setBadge(5); // Show "5" on app icon
clearBadge(); // Remove badge
```

## Performance

Optimize PWA performance.

### Precaching

```typescript
// Precache critical resources
const PRECACHE_URLS = [
  '/',
  '/app-shell',
  '/styles/critical.css',
  '/scripts/main.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});
```

### Lazy Loading

```typescript
// Lazy load routes
const routes = [
  {
    path: '/',
    component: lazy(() => import('./routes/Home'))
  },
  {
    path: '/about',
    component: lazy(() => import('./routes/About'))
  }
];
```

### Resource Hints

```html
<!-- Preconnect to API -->
<link rel="preconnect" href="https://api.example.com">

<!-- Prefetch next page -->
<link rel="prefetch" href="/dashboard">

<!-- Preload critical resources -->
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
```

## Testing

Test PWA functionality.

### Lighthouse

```bash
# Run Lighthouse audit
npx lighthouse https://example.com --view

# PWA-specific audit
npx lighthouse https://example.com --only-categories=pwa --view
```

### Manual Testing

```typescript
/**
 * PWA Testing Checklist:
 *
 * Installation:
 * [ ] Install prompt appears
 * [ ] App installs successfully
 * [ ] App opens in standalone mode
 * [ ] App icon displays correctly
 *
 * Offline:
 * [ ] App loads when offline
 * [ ] Offline page displays
 * [ ] Queued actions sync when online
 *
 * Service Worker:
 * [ ] Service worker registers
 * [ ] Updates work correctly
 * [ ] Caching works as expected
 *
 * Notifications:
 * [ ] Permission request works
 * [ ] Notifications display correctly
 * [ ] Notification actions work
 *
 * Performance:
 * [ ] Fast initial load (< 3s)
 * [ ] Smooth animations (60fps)
 * [ ] Lighthouse score > 90
 */
```

### Automated Tests

```typescript
// test/pwa.spec.ts
import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
  test('has valid manifest', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(() => {
      const link = document.querySelector('link[rel="manifest"]');
      return link?.getAttribute('href');
    });

    expect(manifest).toBeTruthy();

    const response = await page.goto(manifest!);
    const json = await response!.json();

    expect(json.name).toBeTruthy();
    expect(json.start_url).toBeTruthy();
    expect(json.icons).toBeTruthy();
  });

  test('registers service worker', async ({ page }) => {
    await page.goto('/');

    const registered = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration()
        .then(reg => !!reg);
    });

    expect(registered).toBe(true);
  });

  test('works offline', async ({ page, context }) => {
    await page.goto('/');

    // Go offline
    await context.setOffline(true);

    // Navigate
    await page.goto('/about');

    // Should still load
    await expect(page).toHaveURL(/about/);
  });
});
```

## Tools

Tools for PWA development.

### Workbox

```typescript
// Use Workbox for advanced service worker
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// Precache
precacheAndRoute(self.__WB_MANIFEST);

// Cache images
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
      })
    ]
  })
);

// Cache API requests
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60 // 5 minutes
      })
    ]
  })
);

// Cache CSS/JS
registerRoute(
  ({ request }) => request.destination === 'style' || request.destination === 'script',
  new StaleWhileRevalidate({
    cacheName: 'static-resources'
  })
);
```

### vite-plugin-pwa

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      manifest: {
        name: 'Nexus App',
        short_name: 'Nexus',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.example\.com\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60
              }
            }
          }
        ]
      }
    })
  ]
});
```

## Best Practices

### Performance

```typescript
/**
 * PWA Performance Best Practices:
 *
 * 1. Cache Efficiently
 *    - Cache critical resources
 *    - Set appropriate expiration
 *    - Limit cache size
 *
 * 2. Optimize Loading
 *    - Implement app shell
 *    - Lazy load routes
 *    - Preload critical resources
 *
 * 3. Handle Offline Gracefully
 *    - Provide offline page
 *    - Queue failed requests
 *    - Show network status
 *
 * 4. Update Wisely
 *    - Skip waiting carefully
 *    - Notify users of updates
 *    - Test update flow
 *
 * 5. Monitor Metrics
 *    - Track install rate
 *    - Monitor cache hit rate
 *    - Measure performance
 */
```

## Examples

### Complete PWA Setup

```typescript
// main.tsx - Complete PWA setup
import { render } from 'solid-js/web';
import App from './App';

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered');

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // Show update notification
            if (confirm('New version available! Reload?')) {
              window.location.reload();
            }
          }
        });
      });
    } catch (error) {
      console.error('SW registration failed:', error);
    }
  });
}

// Request notification permission
const requestPermission = async () => {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
};

// Handle install prompt
let deferredPrompt: any;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Render app
render(() => <App />, document.getElementById('root')!);
```

## Summary

PWAs provide app-like experiences on the web:

1. **Manifest**: Define app metadata and appearance
2. **Service Workers**: Enable offline functionality and caching
3. **Caching**: Implement appropriate caching strategies
4. **Offline**: Provide graceful offline experience
5. **Notifications**: Engage users with push notifications
6. **Background Sync**: Sync data in the background
7. **Installation**: Make app installable on home screen
8. **Platform Features**: Use native-like features
9. **Performance**: Optimize for fast loading
10. **Testing**: Test all PWA features

PWAs bridge the gap between web and native apps.
