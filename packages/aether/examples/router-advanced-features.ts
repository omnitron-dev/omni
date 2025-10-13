/**
 * Advanced Router Features - Usage Examples
 *
 * This file demonstrates all advanced router features in action
 */

import {
  createRouter,
  lazyRoute,
  PrefetchPriority,
  PrefetchManager,
  ViewTransitionsManager,
  CodeSplittingManager,
  ScrollRestorationManager,
  scrollToElement,
  scrollToTop,
} from '@omnitron-dev/aether/router';

// =============================================================================
// 1. Basic Router Setup with All Features Enabled
// =============================================================================

const router = createRouter({
  mode: 'history',
  base: '/',

  // Enable view transitions
  viewTransitions: {
    enabled: true,
    defaultType: 'fade',
    fallbackDuration: 300,
    skipTransition: (from, to) => {
      // Skip transitions for same page
      return from === to;
    },
  },

  // Enable advanced prefetching
  prefetch: {
    enabled: true,
    strategy: 'viewport',
    maxCacheSize: 50,
    maxCacheAge: 5 * 60 * 1000, // 5 minutes
    maxConcurrent: 3,
    adaptToNetwork: true,
  },

  // Enable code splitting
  codeSplitting: {
    enabled: true,
    preloadStrategy: 'hover',
    extractCriticalCSS: false,
  },

  // Enable scroll restoration
  scrollRestoration: {
    enabled: true,
    behavior: 'smooth',
    scrollToTop: true,
    savePosition: true,
    maxSavedPositions: 100,
    restoreDelay: 50,
    hashScrolling: true,
    hashScrollOffset: 80,
  },

  // Route definitions with code splitting
  routes: [
    {
      path: '/',
      component: () => '<h1>Home</h1>',
    },
    {
      path: '/about',
      component: () => '<h1>About</h1>',
      loader: async () => {
        return { pageTitle: 'About Us' };
      },
    },
    // Lazy loaded route
    lazyRoute(() => import('./pages/Blog'), {
      path: '/blog',
      chunkName: 'blog',
      loading: () => '<div>Loading blog...</div>',
    }),
    // Dynamic route with lazy loading
    {
      path: '/blog/:id',
      lazy: () => import('./pages/BlogPost'),
      loading: () => '<div>Loading post...</div>',
    },
  ],
});

// =============================================================================
// 2. Advanced Prefetching Examples
// =============================================================================

async function prefetchingExamples() {
  const prefetchManager = new PrefetchManager(router, {
    maxCacheSize: 100,
    maxConcurrent: 5,
  });

  // Prefetch with high priority
  await prefetchManager.prefetch('/important-page', {
    priority: PrefetchPriority.HIGH,
  });

  // Prefetch with delay
  await prefetchManager.prefetch('/delayed-page', {
    priority: PrefetchPriority.MEDIUM,
    delay: 500,
  });

  // Prefetch with resource hints
  await prefetchManager.prefetch('/api-page', {
    priority: PrefetchPriority.HIGH,
    hints: {
      preconnect: ['https://api.example.com'],
      dnsPrefetch: ['https://cdn.example.com'],
      preload: [
        { href: '/critical.css', as: 'style' },
        { href: '/main.js', as: 'script' },
      ],
    },
  });

  // Setup viewport prefetching for a link
  const linkElement = document.querySelector('a[href="/about"]');
  if (linkElement) {
    const cleanup = prefetchManager.prefetchOnViewport(linkElement, '/about', {
      priority: PrefetchPriority.MEDIUM,
    });
    // Call cleanup() when no longer needed
  }

  // Setup hover prefetching
  const hoverElement = document.querySelector('a[href="/blog"]');
  if (hoverElement) {
    const cleanup = prefetchManager.prefetchOnHover(hoverElement, '/blog', {
      hoverDelay: 100,
      priority: PrefetchPriority.HIGH,
    });
    // Call cleanup() when no longer needed
  }

  // Get statistics
  const stats = prefetchManager.getStats();
  console.log('Prefetch Statistics:', {
    totalPrefetched: stats.totalPrefetched,
    cacheHits: stats.cacheHits,
    cacheMisses: stats.cacheMisses,
    failedPrefetches: stats.failedPrefetches,
    averagePrefetchTime: `${stats.averagePrefetchTime.toFixed(2)}ms`,
    queueSize: stats.queueSize,
  });
}

// =============================================================================
// 3. View Transitions Examples
// =============================================================================

async function viewTransitionsExamples() {
  const transitionsManager = new ViewTransitionsManager(
    {
      enabled: true,
      defaultType: 'fade',
      fallbackDuration: 400,
    },
    {
      onBeforeTransition: (from, to) => {
        console.log(`Transitioning from ${from} to ${to}`);
      },
      onAfterTransition: (from, to) => {
        console.log(`Transition complete: ${from} → ${to}`);
      },
      onTransitionError: (error) => {
        console.error('Transition failed:', error);
      },
    }
  );

  // Execute a custom transition
  await transitionsManager.executeTransition(
    '/current',
    '/next',
    async () => {
      // Update DOM
      document.getElementById('app')!.innerHTML = '<h1>New Page</h1>';
    },
    {
      type: 'slide',
    }
  );

  // Set up element morphing
  const fromElement = document.querySelector('.hero-image');
  const toElement = document.querySelector('.detail-image');
  if (fromElement && toElement) {
    transitionsManager.setTransitionName(fromElement, 'hero-morph');
    transitionsManager.setTransitionName(toElement, 'hero-morph');
  }

  // Use transition groups
  const items = document.querySelectorAll('.list-item');
  items.forEach((item) => {
    transitionsManager.addToGroup('list-items', item);
  });
  transitionsManager.applyGroupTransitions('list-items');
}

// =============================================================================
// 4. Code Splitting Examples
// =============================================================================

async function codeSplittingExamples() {
  const splittingManager = new CodeSplittingManager({
    enabled: true,
    preloadStrategy: 'hover',
    extractCriticalCSS: true,
  });

  // Create lazy route
  const blogRoute = splittingManager.lazy(() => import('./pages/Blog'), {
    path: '/blog',
    chunkName: 'blog-page',
    loading: () => '<div>Loading...</div>',
  });

  // Preload a chunk
  await splittingManager.preloadChunk('blog-page', () => import('./pages/Blog'));

  // Setup hover preload
  const linkElement = document.querySelector('a[href="/blog"]');
  if (linkElement) {
    const cleanup = splittingManager.setupHoverPreload(linkElement, '/blog', [blogRoute]);
    // Call cleanup() when no longer needed
  }

  // Get bundle statistics
  const stats = splittingManager.getBundleStats();
  console.log('Bundle Statistics:', {
    totalChunks: stats.totalChunks,
    loadedChunks: stats.loadedChunks,
    failedChunks: stats.failedChunks,
    pendingChunks: stats.pendingChunks,
    totalSize: `${(stats.totalSize / 1024).toFixed(2)} KB`,
  });

  // Get specific chunk info
  const chunk = splittingManager.getChunk('blog-page');
  if (chunk) {
    console.log('Blog Chunk:', {
      id: chunk.id,
      status: chunk.status,
      routes: chunk.routes,
    });
  }
}

// =============================================================================
// 5. Scroll Restoration Examples
// =============================================================================

async function scrollRestorationExamples() {
  const scrollManager = new ScrollRestorationManager({
    enabled: true,
    behavior: 'smooth',
    scrollToTop: true,
    savePosition: true,
    maxSavedPositions: 100,
    hashScrolling: true,
    hashScrollOffset: 80,
  });

  // Save current position
  scrollManager.saveCurrentPosition();

  // Restore saved position
  await scrollManager.restorePosition('/previous-route');

  // Scroll to specific position
  await scrollManager.scrollTo({ left: 0, top: 500 }, 'smooth');

  // Scroll to element
  await scrollManager.scrollToElement('#section', {
    offset: 80,
    behavior: 'smooth',
  });

  // Scroll to hash
  await scrollManager.scrollToHash('#about', {
    offset: 100,
  });

  // Register scrollable element
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    scrollManager.registerScrollElement('sidebar', sidebar);
    await scrollManager.scrollElement('sidebar', { left: 0, top: 200 }, 'smooth');
  }

  // Get saved positions
  const savedPositions = scrollManager.getSavedPositions();
  console.log(`Saved ${savedPositions.size} scroll positions`);

  // Helper functions
  await scrollToTop('smooth');
  await scrollToElement('#target', { offset: 60 });
}

// =============================================================================
// 6. Combined Example - Full Page Navigation
// =============================================================================

async function fullPageNavigation() {
  // Navigate with all features
  await router.navigate('/blog', {
    replace: false,
    state: { from: 'home' },
  });

  // The router will automatically:
  // 1. Execute view transition (fade animation)
  // 2. Prefetch linked routes in viewport
  // 3. Load code-split chunks
  // 4. Restore scroll position or scroll to top
  // 5. Update browser history
}

// =============================================================================
// 7. Performance Monitoring
// =============================================================================

function monitorPerformance() {
  const prefetchManager = new PrefetchManager(router);
  const splittingManager = new CodeSplittingManager();

  // Monitor prefetch performance
  setInterval(() => {
    const prefetchStats = prefetchManager.getStats();
    console.log('Prefetch Performance:', {
      hitRate:
        ((prefetchStats.cacheHits / (prefetchStats.cacheHits + prefetchStats.cacheMisses)) * 100).toFixed(2) + '%',
      avgTime: `${prefetchStats.averagePrefetchTime.toFixed(2)}ms`,
    });
  }, 30000); // Every 30 seconds

  // Monitor bundle loading
  const bundleStats = splittingManager.getBundleStats();
  console.log('Bundle Performance:', {
    loadedPercentage: ((bundleStats.loadedChunks / bundleStats.totalChunks) * 100).toFixed(2) + '%',
    failureRate: ((bundleStats.failedChunks / bundleStats.totalChunks) * 100).toFixed(2) + '%',
  });
}

// =============================================================================
// Export examples
// =============================================================================

export {
  router,
  prefetchingExamples,
  viewTransitionsExamples,
  codeSplittingExamples,
  scrollRestorationExamples,
  fullPageNavigation,
  monitorPerformance,
};
