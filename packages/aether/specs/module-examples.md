# Aether Module System - Real-World Examples

> **Version**: 1.0.0
> **Status**: Examples & Best Practices
> **Created**: 2025-10-14

## Table of Contents

1. [E-Commerce Application](#1-e-commerce-application)
2. [SaaS Dashboard](#2-saas-dashboard)
3. [Blog Platform](#3-blog-platform)
4. [Real-Time Chat Application](#4-real-time-chat-application)
5. [Best Practices](#5-best-practices)

---

## 1. E-Commerce Application

Complete example of a modular e-commerce application with products, cart, and checkout.

### 1.1 Application Structure

```
src/
├── modules/
│   ├── core/
│   │   ├── index.ts
│   │   ├── services/
│   │   │   ├── api.service.ts
│   │   │   ├── auth.service.ts
│   │   │   └── config.service.ts
│   │   └── stores/
│   │       └── app.store.ts
│   ├── products/
│   │   ├── index.ts
│   │   ├── components/
│   │   │   ├── ProductList.tsx
│   │   │   ├── ProductCard.tsx
│   │   │   └── ProductDetail.tsx
│   │   ├── services/
│   │   │   └── product.service.ts
│   │   └── stores/
│   │       └── product.store.ts
│   ├── cart/
│   │   ├── index.ts
│   │   ├── components/
│   │   │   ├── CartIcon.tsx
│   │   │   ├── CartDrawer.tsx
│   │   │   └── CartSummary.tsx
│   │   ├── services/
│   │   │   └── cart.service.ts
│   │   └── stores/
│   │       └── cart.store.ts
│   ├── checkout/
│   │   ├── index.ts
│   │   ├── components/
│   │   │   ├── CheckoutForm.tsx
│   │   │   ├── PaymentMethod.tsx
│   │   │   └── OrderSummary.tsx
│   │   └── services/
│   │       └── checkout.service.ts
│   └── shared/
│       ├── index.ts
│       ├── components/
│       │   ├── Button.tsx
│       │   ├── Input.tsx
│       │   └── Modal.tsx
│       └── utils/
│           ├── validators.ts
│           └── formatters.ts
├── app.ts
└── main.ts
```

### 1.2 Core Module

```typescript
// modules/core/index.ts
import { defineModule } from '@aether/core';
import { NetronModule } from '@aether/netron';
import { ApiService } from './services/api.service';
import { AuthService } from './services/auth.service';
import { ConfigService } from './services/config.service';
import { defineAppStore } from './stores/app.store';

export const CoreModule = defineModule({
  id: 'core',
  version: '1.0.0',

  // Import Netron for RPC
  imports: [
    NetronModule.forRoot({
      baseUrl: import.meta.env.VITE_API_URL,
      timeout: 30000
    })
  ],

  // Core services
  providers: [
    ConfigService,
    ApiService,
    AuthService,
    {
      provide: 'API_BASE_URL',
      useFactory: (config: ConfigService) => config.get('apiUrl'),
      deps: [ConfigService]
    }
  ],

  // Global app store
  stores: [
    () => defineAppStore()
  ],

  // Core routes
  routes: [
    {
      path: '/',
      component: () => import('./components/Home'),
      rendering: 'static'  // Static home page
    },
    {
      path: '/login',
      component: () => import('./components/Login'),
      action: async ({ request, container }) => {
        const formData = await request.formData();
        const auth = container.get(AuthService);
        return auth.login(
          formData.get('email'),
          formData.get('password')
        );
      }
    }
  ],

  // Setup
  setup: async ({ container, stores }) => {
    // Initialize config
    const config = container.get(ConfigService);
    await config.load();

    // Initialize auth
    const auth = container.get(AuthService);
    await auth.checkSession();

    // Set up global error handling
    window.addEventListener('error', (event) => {
      console.error('Global error:', event.error);
      // Send to monitoring
    });

    return { config, auth };
  },

  // Export core services for other modules
  exports: {
    providers: [ApiService, AuthService, ConfigService],
    stores: ['app']
  },

  // Optimization hints
  optimization: {
    preloadModules: ['shared'],  // Always preload shared
    priority: 'high'
  }
});
```

### 1.3 Products Module

```typescript
// modules/products/index.ts
import { defineModule } from '@aether/core';
import { ProductService } from './services/product.service';
import { defineProductStore } from './stores/product.store';

export const ProductsModule = defineModule({
  id: 'products',

  imports: [CoreModule, SharedModule],

  providers: [ProductService],

  stores: [
    () => defineProductStore()
  ],

  routes: [
    {
      path: '/products',
      component: () => import('./components/ProductList'),

      // Load products before rendering
      loader: async ({ container, url }) => {
        const service = container.get(ProductService);
        const params = new URLSearchParams(url.search);

        return service.getProducts({
          category: params.get('category'),
          sort: params.get('sort') || 'popular',
          page: parseInt(params.get('page') || '1')
        });
      },

      // SSG with ISR
      rendering: 'static',
      revalidate: 300,  // Revalidate every 5 minutes

      // Generate static paths for categories
      staticPaths: async () => {
        const categories = ['electronics', 'clothing', 'books'];
        return {
          paths: categories.map(cat => `/products?category=${cat}`),
          fallback: 'blocking'
        };
      }
    },
    {
      path: '/products/:id',
      component: () => import('./components/ProductDetail'),

      loader: async ({ params, container }) => {
        const service = container.get(ProductService);
        return service.getProduct(params.id);
      },

      // Server-side rendering for SEO
      rendering: 'server',
      cache: {
        maxAge: 3600,  // Cache for 1 hour
        swr: 86400      // Serve stale for 1 day
      }
    }
  ],

  // Interactive islands
  islands: [
    {
      id: 'product-filters',
      component: () => import('./components/ProductFilters'),
      strategy: 'interaction',  // Hydrate on first interaction
      props: { categories: ['electronics', 'clothing', 'books'] }
    },
    {
      id: 'product-reviews',
      component: () => import('./components/ProductReviews'),
      strategy: 'visible',      // Hydrate when visible
      rootMargin: '100px'       // Start loading 100px before visible
    }
  ],

  exports: {
    providers: [ProductService],
    stores: ['products']
  }
});

// stores/product.store.ts
import { signal, computed } from '@aether/core';
import { defineStore } from '@aether/store';

export const defineProductStore = () =>
  defineStore('products', ({ netron }) => {
    // State
    const products = signal<Product[]>([]);
    const loading = signal(false);
    const filters = signal<ProductFilters>({
      category: null,
      minPrice: 0,
      maxPrice: 1000,
      inStock: true
    });

    // Computed
    const filteredProducts = computed(() => {
      const f = filters();
      return products().filter(product => {
        if (f.category && product.category !== f.category) return false;
        if (product.price < f.minPrice || product.price > f.maxPrice) return false;
        if (f.inStock && !product.inStock) return false;
        return true;
      });
    });

    const categories = computed(() => {
      const cats = new Set<string>();
      products().forEach(p => cats.add(p.category));
      return Array.from(cats);
    });

    // Actions
    const loadProducts = async () => {
      loading.set(true);
      try {
        const service = await netron.service<IProductService>('products');
        const data = await service.getProducts();
        products.set(data);
      } finally {
        loading.set(false);
      }
    };

    const searchProducts = async (query: string) => {
      loading.set(true);
      try {
        const service = await netron.service<IProductService>('products');
        const data = await service.searchProducts(query);
        products.set(data);
      } finally {
        loading.set(false);
      }
    };

    const updateFilters = (newFilters: Partial<ProductFilters>) => {
      filters.set({ ...filters(), ...newFilters });
    };

    return {
      // State
      products,
      loading,
      filters,

      // Computed
      filteredProducts,
      categories,

      // Actions
      loadProducts,
      searchProducts,
      updateFilters
    };
  });
```

### 1.4 Cart Module with Islands

```typescript
// modules/cart/index.ts
import { defineModule } from '@aether/core';
import { CartService } from './services/cart.service';
import { defineCartStore } from './stores/cart.store';

export const CartModule = defineModule({
  id: 'cart',

  imports: [CoreModule, ProductsModule],

  providers: [
    CartService,
    {
      provide: 'MAX_CART_ITEMS',
      useValue: 99
    }
  ],

  stores: [
    () => defineCartStore()
  ],

  routes: [
    {
      path: '/cart',
      component: () => import('./components/CartPage'),

      // Guard: Redirect to products if cart empty
      beforeEnter: ({ container }) => {
        const store = container.get('STORE_cart');
        if (store.items().length === 0) {
          return '/products';
        }
      }
    }
  ],

  // Cart uses islands for interactivity
  islands: [
    {
      id: 'cart-icon',
      component: () => import('./components/CartIcon'),
      strategy: 'immediate',  // Always interactive

      // Island-specific store scope
      scope: 'global'  // Share cart across all pages
    },
    {
      id: 'cart-drawer',
      component: () => import('./components/CartDrawer'),
      strategy: 'interaction',  // Hydrate on click

      // Preload when hovering cart icon
      preload: {
        trigger: 'hover',
        selector: '[data-island="cart-icon"]',
        delay: 100
      }
    },
    {
      id: 'cart-summary',
      component: () => import('./components/CartSummary'),
      strategy: 'idle',  // Hydrate when browser idle
      timeout: 2000
    }
  ],

  // Setup cart persistence
  setup: async ({ container, stores }) => {
    const cartStore = stores.get('cart');
    const cartService = container.get(CartService);

    // Load cart from localStorage
    const saved = localStorage.getItem('cart');
    if (saved) {
      cartStore.loadCart(JSON.parse(saved));
    }

    // Auto-save cart changes
    cartStore.subscribe((state) => {
      localStorage.setItem('cart', JSON.stringify(state.items));
    });

    // Sync with backend
    if (container.get(AuthService).isAuthenticated()) {
      await cartService.syncCart(cartStore.items());
    }

    return { cartStore, cartService };
  },

  exports: {
    stores: ['cart']
  }
});

// components/CartIcon.tsx (Island Component)
import { useStore } from '@aether/core';

export function CartIcon() {
  const cart = useStore('cart');
  const itemCount = cart.itemCount;  // Computed value

  return (
    <button
      className="cart-icon"
      onClick={() => cart.toggleDrawer()}
      aria-label={`Cart with ${itemCount()} items`}
    >
      <svg>...</svg>
      {itemCount() > 0 && (
        <span className="badge">{itemCount()}</span>
      )}
    </button>
  );
}
```

### 1.5 Checkout Module (Lazy Loaded)

```typescript
// modules/checkout/index.ts
import { defineModule } from '@aether/core';
import { CheckoutService } from './services/checkout.service';
import { PaymentService } from './services/payment.service';

export const CheckoutModule = defineModule({
  id: 'checkout',

  imports: [CoreModule, CartModule],

  providers: [
    CheckoutService,
    PaymentService,
    {
      provide: 'STRIPE_KEY',
      useFactory: (config: ConfigService) => config.get('stripePublicKey'),
      deps: [ConfigService]
    }
  ],

  routes: [
    {
      path: '/checkout',
      component: () => import('./components/CheckoutFlow'),

      // Multi-step checkout
      children: [
        {
          path: 'shipping',
          component: () => import('./components/ShippingForm')
        },
        {
          path: 'payment',
          component: () => import('./components/PaymentForm')
        },
        {
          path: 'review',
          component: () => import('./components/OrderReview')
        },
        {
          path: 'success',
          component: () => import('./components/OrderSuccess')
        }
      ],

      // Require authentication
      beforeEnter: ({ container }) => {
        const auth = container.get(AuthService);
        if (!auth.isAuthenticated()) {
          return '/login?redirect=/checkout';
        }
      },

      // Load checkout data
      loader: async ({ container }) => {
        const checkoutService = container.get(CheckoutService);
        const cartStore = container.get('STORE_cart');

        return {
          cart: cartStore.items(),
          shipping: await checkoutService.getShippingOptions(),
          payment: await checkoutService.getPaymentMethods()
        };
      }
    }
  ],

  // Payment form as an island
  islands: [
    {
      id: 'payment-form',
      component: () => import('./components/PaymentForm'),
      strategy: 'visible',  // Load when user scrolls to it

      // Inject Stripe script
      scripts: [
        {
          src: 'https://js.stripe.com/v3/',
          async: true,
          onLoad: () => {
            console.log('Stripe loaded');
          }
        }
      ]
    }
  ],

  // Cleanup on module unload
  teardown: async ({ container }) => {
    // Cancel any pending orders
    const checkoutService = container.get(CheckoutService);
    await checkoutService.cancelPendingOrder();
  },

  optimization: {
    lazyBoundary: true,  // This is a lazy loading boundary
    splitChunk: true,    // Create separate chunk
    priority: 'low'      // Not critical for initial load
  }
});
```

### 1.6 App Module (Root)

```typescript
// app.ts
import { defineModule, lazy } from '@aether/core';
import { CoreModule } from './modules/core';
import { SharedModule } from './modules/shared';
import { ProductsModule } from './modules/products';
import { CartModule } from './modules/cart';

export const AppModule = defineModule({
  id: 'app',
  version: '2.0.0',

  imports: [
    // Always load core modules
    CoreModule,
    SharedModule,

    // Feature modules
    ProductsModule,
    CartModule,

    // Lazy load heavy modules
    lazy(() => import('./modules/checkout'), {
      preload: 'interaction',  // Preload on any checkout button click
      prefetch: 'visible'      // Or when checkout button visible
    }),

    lazy(() => import('./modules/admin'), {
      condition: () => {
        // Only load admin for admin users
        const auth = inject(AuthService);
        return auth.hasRole('admin');
      }
    }),

    // Development only modules
    ...(import.meta.env.DEV ? [
      lazy(() => import('./modules/devtools'))
    ] : [])
  ],

  setup: async ({ container, router, stores }) => {
    // Global setup
    const auth = container.get(AuthService);

    // Set up global navigation guards
    router.beforeEach(async (to, from) => {
      // Track page views
      if (typeof gtag !== 'undefined') {
        gtag('event', 'page_view', {
          page_path: to.path
        });
      }

      // Check auth for protected routes
      if (to.meta?.requiresAuth && !auth.isAuthenticated()) {
        return `/login?redirect=${to.path}`;
      }
    });

    // Initialize global stores
    const appStore = stores.get('app');
    await appStore.initialize();

    // Set up error boundary
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      appStore.setError(event.reason);
    });

    return { appStore };
  },

  optimization: {
    // Preload critical modules
    preloadModules: ['products', 'cart'],

    // Prefetch likely next modules
    prefetchModules: ['checkout'],

    // Performance budget
    budget: {
      maxSize: 500000,  // 500KB max for initial load
      maxAsyncRequests: 6
    }
  }
});
```

### 1.7 Main Entry Point

```typescript
// main.ts
import { createApp } from '@aether/core';
import { AppModule } from './app';

async function bootstrap() {
  const app = await createApp({
    module: AppModule,

    // Rendering mode
    mode: import.meta.env.SSR ? 'universal' : 'spa',

    // Hydration for SSR
    hydrate: import.meta.env.SSR,

    // Performance monitoring
    monitoring: {
      enabled: true,
      sampleRate: import.meta.env.PROD ? 0.1 : 1.0,

      reportTo: (metrics) => {
        // Send to analytics
        if (typeof gtag !== 'undefined') {
          gtag('event', 'performance', metrics);
        }
      }
    },

    // Error handling
    errorHandler: (error, context) => {
      console.error('App error:', error, context);

      // Send to Sentry in production
      if (import.meta.env.PROD && window.Sentry) {
        window.Sentry.captureException(error, { extra: context });
      }
    }
  });

  // Mount app
  await app.mount('#app');

  // Enable hot module replacement in development
  if (import.meta.hot) {
    import.meta.hot.accept('./app', async (newApp) => {
      await app.reload(newApp.AppModule);
    });
  }
}

// Start the app
bootstrap().catch(console.error);
```

---

## 2. SaaS Dashboard

Example of a complex dashboard with real-time updates, charts, and multiple data sources.

### 2.1 Dashboard Module Structure

```typescript
// modules/dashboard/index.ts
import { defineModule } from '@aether/core';
import { RealtimeModule } from './realtime';
import { AnalyticsModule } from './analytics';
import { ReportsModule } from './reports';

export const DashboardModule = defineModule({
  id: 'dashboard',

  imports: [
    CoreModule,
    RealtimeModule,     // WebSocket connections
    AnalyticsModule,    // Charts and metrics
    ReportsModule       // Report generation
  ],

  routes: [
    {
      path: '/dashboard',
      component: () => import('./layouts/DashboardLayout'),

      // Nested routes with data preloading
      children: [
        {
          path: '',
          component: () => import('./pages/Overview'),
          loader: ({ container }) => {
            const analytics = container.get(AnalyticsService);
            return analytics.getOverviewData();
          }
        },
        {
          path: 'analytics',
          component: () => import('./pages/Analytics'),

          // Heavy charts - lazy load
          islands: [
            {
              id: 'revenue-chart',
              component: () => import('./components/RevenueChart'),
              strategy: 'visible',
              rootMargin: '50px'
            },
            {
              id: 'user-activity',
              component: () => import('./components/UserActivityChart'),
              strategy: 'visible'
            }
          ]
        },
        {
          path: 'realtime',
          component: () => import('./pages/RealtimeMonitor'),

          // Real-time components
          islands: [
            {
              id: 'realtime-metrics',
              component: () => import('./components/RealtimeMetrics'),
              strategy: 'immediate',  // Always active

              // WebSocket connection
              setup: async ({ container }) => {
                const realtime = container.get(RealtimeService);
                await realtime.connect();

                return () => {
                  realtime.disconnect();
                };
              }
            }
          ]
        }
      ]
    }
  ],

  // Dashboard-wide services
  providers: [
    DashboardService,
    MetricsService,
    {
      provide: 'REFRESH_INTERVAL',
      useValue: 30000  // Refresh every 30 seconds
    }
  ],

  // Dashboard stores
  stores: [
    () => defineDashboardStore(),
    () => defineMetricsStore()
  ],

  setup: async ({ container, stores }) => {
    const dashboard = container.get(DashboardService);
    const metricsStore = stores.get('metrics');

    // Start background refresh
    const interval = setInterval(() => {
      metricsStore.refresh();
    }, container.get('REFRESH_INTERVAL'));

    // Return cleanup function
    return {
      cleanup: () => clearInterval(interval)
    };
  },

  teardown: async ({ context }) => {
    // Stop background refresh
    context.cleanup();
  }
});
```

### 2.2 Real-time Module

```typescript
// modules/dashboard/realtime/index.ts
import { defineModule } from '@aether/core';

export const RealtimeModule = defineModule({
  id: 'dashboard.realtime',

  providers: [
    {
      provide: RealtimeService,
      useFactory: (config: ConfigService) => {
        return new RealtimeService({
          url: config.get('wsUrl'),
          reconnect: true,
          maxRetries: 5
        });
      },
      deps: [ConfigService],
      scope: 'singleton'  // Single connection
    }
  ],

  stores: [
    () => defineRealtimeStore()
  ],

  setup: async ({ container }) => {
    const realtime = container.get(RealtimeService);

    // Set up event handlers
    realtime.on('connect', () => {
      console.log('Connected to realtime server');
    });

    realtime.on('metrics', (data) => {
      const store = container.get('STORE_realtime');
      store.updateMetrics(data);
    });

    realtime.on('alert', (alert) => {
      // Show notification
      showNotification(alert);
    });

    // Connect on module load
    await realtime.connect();
  },

  teardown: async ({ container }) => {
    const realtime = container.get(RealtimeService);
    await realtime.disconnect();
  }
});
```

---

## 3. Blog Platform

Static blog with dynamic comments and search.

### 3.1 Blog Module

```typescript
// modules/blog/index.ts
import { defineModule } from '@aether/core';

export const BlogModule = defineModule({
  id: 'blog',

  routes: [
    {
      path: '/blog',
      component: () => import('./pages/BlogIndex'),

      // Static generation for blog index
      rendering: 'static',
      revalidate: 3600,  // ISR: revalidate every hour

      loader: async ({ container }) => {
        const blogService = container.get(BlogService);
        return blogService.getPosts({ limit: 10 });
      }
    },
    {
      path: '/blog/:slug',
      component: () => import('./pages/BlogPost'),

      // Static generation for all posts
      rendering: 'static',

      // Generate paths for all posts
      staticPaths: async ({ container }) => {
        const blogService = container.get(BlogService);
        const posts = await blogService.getAllPosts();

        return {
          paths: posts.map(post => `/blog/${post.slug}`),
          fallback: 'blocking'  // Generate new posts on demand
        };
      },

      loader: async ({ params, container }) => {
        const blogService = container.get(BlogService);
        return blogService.getPost(params.slug);
      }
    }
  ],

  // Interactive islands
  islands: [
    {
      id: 'blog-search',
      component: () => import('./components/BlogSearch'),
      strategy: 'idle',  // Load when idle
      timeout: 1000
    },
    {
      id: 'blog-comments',
      component: () => import('./components/Comments'),
      strategy: 'visible',  // Load when scrolled to comments
      rootMargin: '200px'
    },
    {
      id: 'newsletter-signup',
      component: () => import('./components/NewsletterSignup'),
      strategy: 'interaction'  // Load on focus/click
    }
  ],

  providers: [BlogService],

  stores: [
    () => defineBlogStore()
  ]
});
```

---

## 4. Real-Time Chat Application

WebSocket-based chat with presence and typing indicators.

### 4.1 Chat Module

```typescript
// modules/chat/index.ts
import { defineModule } from '@aether/core';

export const ChatModule = defineModule({
  id: 'chat',

  providers: [
    ChatService,
    PresenceService,
    {
      provide: 'WS_URL',
      useValue: import.meta.env.VITE_WS_URL
    }
  ],

  stores: [
    () => defineChatStore(),
    () => definePresenceStore()
  ],

  routes: [
    {
      path: '/chat',
      component: () => import('./pages/ChatApp'),

      // Server-side rendering for initial state
      rendering: 'server',

      loader: async ({ container }) => {
        const chatService = container.get(ChatService);
        return {
          rooms: await chatService.getRooms(),
          recentMessages: await chatService.getRecentMessages()
        };
      }
    }
  ],

  islands: [
    {
      id: 'chat-room',
      component: () => import('./components/ChatRoom'),
      strategy: 'immediate',  // Always interactive

      // Establish WebSocket connection
      setup: async ({ container, props }) => {
        const chatService = container.get(ChatService);
        const presenceService = container.get(PresenceService);

        // Connect to room
        await chatService.joinRoom(props.roomId);
        presenceService.announcePresence(props.roomId);

        // Cleanup on unmount
        return () => {
          chatService.leaveRoom(props.roomId);
          presenceService.removePresence(props.roomId);
        };
      }
    },
    {
      id: 'typing-indicator',
      component: () => import('./components/TypingIndicator'),
      strategy: 'immediate'
    },
    {
      id: 'user-list',
      component: () => import('./components/UserList'),
      strategy: 'immediate'
    }
  ],

  setup: async ({ container, stores }) => {
    const chatService = container.get(ChatService);
    const chatStore = stores.get('chat');
    const presenceStore = stores.get('presence');

    // Set up message handler
    chatService.on('message', (message) => {
      chatStore.addMessage(message);
    });

    // Set up presence updates
    chatService.on('user-joined', (user) => {
      presenceStore.addUser(user);
    });

    chatService.on('user-left', (user) => {
      presenceStore.removeUser(user);
    });

    chatService.on('typing', ({ userId, isTyping }) => {
      presenceStore.setTyping(userId, isTyping);
    });

    // Connect to WebSocket
    await chatService.connect();
  },

  teardown: async ({ container }) => {
    const chatService = container.get(ChatService);
    await chatService.disconnect();
  }
});
```

---

## 5. Best Practices

### 5.1 Module Organization

```typescript
// ✅ Good: Clear module boundaries
export const FeatureModule = defineModule({
  id: 'feature',
  imports: [SharedModule],  // Explicit dependencies
  providers: [FeatureService],
  exports: {
    providers: [FeatureService]  // Explicit exports
  }
});

// ❌ Bad: Unclear dependencies
export const FeatureModule = defineModule({
  id: 'feature',
  providers: [FeatureService],
  setup: () => {
    // Accessing global services directly
    const globalService = window.someGlobalService;
  }
});
```

### 5.2 Lazy Loading Strategy

```typescript
// ✅ Good: Strategic lazy loading
export const AppModule = defineModule({
  imports: [
    CoreModule,      // Always needed
    SharedModule,    // Frequently used

    // Lazy load feature modules
    lazy(() => import('./admin'), {
      condition: () => hasAdminRole()  // Conditional loading
    }),

    lazy(() => import('./analytics'), {
      preload: 'interaction',  // Preload on interaction
      prefetch: 'visible'       // Or when visible
    })
  ]
});

// ❌ Bad: Everything lazy
export const AppModule = defineModule({
  imports: [
    lazy(() => import('./core')),     // Core should not be lazy
    lazy(() => import('./shared')),   // Shared is used everywhere
    lazy(() => import('./feature'))
  ]
});
```

### 5.3 Store Scoping

```typescript
// ✅ Good: Appropriate scoping
export const UserModule = defineModule({
  stores: [
    // Global user state
    () => defineStore('user', {
      scope: 'singleton'
    }),

    // Module-specific UI state
    () => defineStore('userUI', {
      scope: 'module'
    }),

    // Island-specific state
    () => defineStore('userForm', {
      scope: 'island'
    })
  ]
});

// ❌ Bad: Everything global
export const UserModule = defineModule({
  stores: [
    () => defineUserStore(),      // Implicitly global
    () => defineUserUIStore(),    // Should be module-scoped
    () => defineUserFormStore()   // Should be island-scoped
  ]
});
```

### 5.4 Performance Optimization

```typescript
// ✅ Good: Optimization hints
export const FeatureModule = defineModule({
  id: 'feature',

  optimization: {
    lazyBoundary: true,        // Clear split point
    splitChunk: true,          // Separate bundle
    sideEffects: false,        // Pure module
    budget: {
      maxSize: 200000          // 200KB max
    }
  },

  islands: [
    {
      id: 'heavy-component',
      component: () => import('./HeavyComponent'),
      strategy: 'visible',     // Load when needed
      rootMargin: '500px'       // Start loading early
    }
  ]
});

// ❌ Bad: No optimization
export const FeatureModule = defineModule({
  id: 'feature',
  islands: [
    {
      id: 'heavy-component',
      component: () => import('./HeavyComponent'),
      strategy: 'immediate'    // Always load immediately
    }
  ]
});
```

### 5.5 Error Handling

```typescript
// ✅ Good: Graceful error handling
export const FeatureModule = defineModule({
  setup: async ({ container }) => {
    try {
      const service = container.get(FeatureService);
      await service.initialize();
    } catch (error) {
      console.error('Feature initialization failed:', error);

      // Fallback to degraded mode
      return {
        degraded: true,
        error
      };
    }
  },

  teardown: async ({ container }) => {
    try {
      const service = container.get(FeatureService);
      await service.cleanup();
    } catch (error) {
      // Log but don't throw - allow cleanup to continue
      console.error('Cleanup error:', error);
    }
  }
});
```

### 5.6 Testing Modules

```typescript
// ✅ Good: Testable modules
describe('FeatureModule', () => {
  let module: TestModule;

  beforeEach(() => {
    module = createTestModule({
      imports: [FeatureModule],
      mocks: {
        providers: [
          { provide: ApiService, useValue: mockApiService }
        ],
        stores: [
          { id: 'feature', value: mockFeatureStore }
        ]
      }
    });
  });

  it('should initialize correctly', async () => {
    const context = await module.setup();
    expect(context.degraded).toBe(false);
  });

  it('should handle errors gracefully', async () => {
    mockApiService.initialize.mockRejectedValue(new Error('API Error'));
    const context = await module.setup();
    expect(context.degraded).toBe(true);
    expect(context.error).toBeDefined();
  });
});
```

### 5.7 Module Communication

```typescript
// ✅ Good: Explicit module communication
export const ModuleA = defineModule({
  id: 'moduleA',
  exports: {
    api: {
      doSomething: () => inject(ServiceA).doSomething()
    }
  }
});

export const ModuleB = defineModule({
  id: 'moduleB',
  imports: [ModuleA],
  setup: ({ modules }) => {
    const moduleA = modules.get('moduleA');
    moduleA.api.doSomething();
  }
});

// ❌ Bad: Direct cross-module access
export const ModuleB = defineModule({
  setup: () => {
    // Reaching into another module's internals
    const serviceA = inject(ServiceA);  // ServiceA is from ModuleA
  }
});
```

---

## Conclusion

These examples demonstrate how Aether's module system enables building scalable, performant applications while maintaining code clarity and developer experience. Key takeaways:

1. **Modules provide clear boundaries** for features and optimizations
2. **Lazy loading and islands** optimize performance automatically
3. **DI and stores** integrate seamlessly with modules
4. **SSR/SSG/ISR** work naturally with module structure
5. **Testing is straightforward** with module isolation

The module system scales from simple applications to complex enterprise systems while maintaining Aether's philosophy of simplicity and performance.