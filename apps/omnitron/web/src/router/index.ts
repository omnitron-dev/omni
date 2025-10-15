import { createRouter } from '@omnitron-dev/aether/router';
import { lazy } from '@omnitron-dev/aether';

/**
 * Omnitron Router Configuration
 *
 * Defines SPA routes for the application.
 * Routes are now organized by feature modules for better code splitting and maintainability.
 *
 * Each route lazy-loads its corresponding module component, ensuring optimal bundle sizes
 * and faster initial load times.
 */

// Lazy load module view components for code splitting
// These import from the module directories rather than the views directory
const CanvasView = lazy(() => import('../modules/canvas/components/CanvasView'));
const EditorView = lazy(() => import('../modules/editor/components/EditorView'));
const TerminalView = lazy(() => import('../modules/terminal/components/TerminalView'));
const ChatView = lazy(() => import('../modules/chat/components/ChatView'));
const SettingsView = lazy(() => import('../modules/settings/components/SettingsView'));

// Legacy views that aren't part of modules yet
const NotFoundView = lazy(() => import('../views/NotFoundView'));

// Create router with route definitions
export const router = createRouter({
  routes: [
    {
      path: '/',
      component: CanvasView,
      meta: {
        title: 'Flow Canvas - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '/canvas',
      component: CanvasView,
      meta: {
        title: 'Flow Canvas - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '/editor',
      component: EditorView,
      meta: {
        title: 'Code Editor - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '/terminal',
      component: TerminalView,
      meta: {
        title: 'Terminal - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '/chat',
      component: ChatView,
      meta: {
        title: 'AI Chat - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '/settings',
      component: SettingsView,
      meta: {
        title: 'Settings - Omnitron',
        requiresAuth: false,
      }
    },
    {
      path: '*',
      component: NotFoundView,
      meta: {
        title: '404 - Not Found',
      }
    }
  ],

  // Router configuration
  mode: 'history', // Use HTML5 history mode for clean URLs

  // Scroll behavior
  scrollBehavior: (to, from, savedPosition) => {
    if (savedPosition) {
      return savedPosition;
    } else if (to.hash) {
      return { el: to.hash, behavior: 'smooth' };
    } else {
      return { top: 0, behavior: 'smooth' };
    }
  },

  // Prefetch configuration
  prefetch: {
    enabled: true,
    strategy: 'hover', // Prefetch on hover
    timeout: 100, // Delay before prefetching (ms)
  },

  // View transitions
  viewTransitions: {
    enabled: true,
    defaultTransition: 'fade',
  },
});

// Navigation guards
router.beforeEach((to, from, next) => {
  // Update document title
  if (to.meta?.title) {
    document.title = to.meta.title as string;
  }

  // Check authentication if required
  if (to.meta?.requiresAuth) {
    // TODO: Implement auth check
    // const isAuthenticated = checkAuth();
    // if (!isAuthenticated) {
    //   return next('/login');
    // }
  }

  next();
});

// After each navigation
router.afterEach((to, from) => {
  // Log navigation for analytics
  console.log(`[Router] Navigated from ${from.path} to ${to.path}`);

  // Send analytics event
  // analytics.track('page_view', { path: to.path });
});

export default router;