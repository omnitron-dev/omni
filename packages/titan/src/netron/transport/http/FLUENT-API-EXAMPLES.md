# Enhanced Fluent API - Complete Examples

> **Real-world examples demonstrating all features of the Enhanced Fluent API**
> **Version**: 1.0.0
> **Last Updated**: 2025-10-08

---

## Table of Contents

1. [E-Commerce Application](#e-commerce-application)
2. [User Management System](#user-management-system)
3. [Real-Time Analytics Dashboard](#real-time-analytics-dashboard)
4. [Microservices Communication](#microservices-communication)
5. [Social Media Platform](#social-media-platform)
6. [Financial Trading System](#financial-trading-system)

---

## E-Commerce Application

### Service Definition

```typescript
interface IProductService {
  getProducts(filters?: ProductFilters): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  searchProducts(query: string): Promise<Product[]>;
  updateStock(productId: string, quantity: number): Promise<Product>;
  getCategories(): Promise<Category[]>;
}

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  rating: number;
  sales: number;
}

interface ProductFilters {
  category?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
}
```

### Setup

```typescript
import { HttpRemotePeer } from '@omnitron-dev/titan/netron';
import { HttpCacheManager, RetryManager } from '@omnitron-dev/titan/netron/transport/http';

// Create cache and retry managers
const cache = new HttpCacheManager({
  maxEntries: 1000,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  defaultMaxAge: 60000
});

const retry = new RetryManager({
  defaultOptions: {
    attempts: 3,
    backoff: 'exponential'
  }
});

// Create fluent interface
const productService = await peer.createFluentInterface<IProductService>(
  'ProductService@1.0.0',
  {
    cache,
    retry
  }
);
```

### Example 1: Product Catalog with Caching

```typescript
/**
 * Get products with caching and filtering
 * - Cache for 5 minutes
 * - Serve stale for 1 minute while revalidating
 * - Filter out-of-stock items
 * - Fallback to empty array on error
 */
async function getAvailableProducts(category: string) {
  return productService
    .cache({
      maxAge: 300000,              // 5 minutes
      staleWhileRevalidate: 60000, // 1 minute
      tags: ['products', `category:${category}`]
    })
    .retry(3)
    .transform(products => products.filter(p => p.stock > 0))
    .validate(products => Array.isArray(products))
    .fallback([])
    .getProducts({ category, inStock: true });
}

// Usage
const electronics = await getAvailableProducts('electronics');
console.log(`Found ${electronics.length} products in stock`);
```

### Example 2: Real-Time Search (No Cache)

```typescript
/**
 * Search products in real-time
 * - No caching (fresh results)
 * - Short timeout for responsiveness
 * - Retry on network errors only
 * - Metrics tracking
 */
async function searchProducts(query: string) {
  return productService
    .retry({
      attempts: 2,
      shouldRetry: (error) => error.code === 'NETWORK_ERROR'
    })
    .timeout(3000)
    .validate(results => Array.isArray(results))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Search completed in ${duration}ms (cache: ${cacheHit})`);
    })
    .fallback([])
    .searchProducts(query);
}

// Usage
const laptops = await searchProducts('laptop');
```

### Example 3: Optimistic Stock Update

```typescript
/**
 * Update stock with optimistic UI
 * - Immediate cache update for instant feedback
 * - Automatic rollback on error
 * - Invalidate product cache
 */
async function decreaseStock(productId: string, quantity: number) {
  return productService
    .cache(60000)
    .optimistic((product: Product | undefined) => {
      if (!product) return undefined;
      return {
        ...product,
        stock: Math.max(0, product.stock - quantity)
      };
    })
    .invalidateOn(['products', `product:${productId}`])
    .retry(3)
    .updateStock(productId, -quantity);
}

// Usage
try {
  const updated = await decreaseStock('prod-123', 1);
  console.log(`Stock updated: ${updated.stock} remaining`);
} catch (error) {
  console.error('Stock update failed, cache rolled back');
}
```

### Example 4: Background-Refreshed Categories

```typescript
/**
 * Get categories with background refresh
 * - Cache for 10 minutes
 * - Auto-refresh every 5 minutes
 * - Always return cached data instantly
 */
async function getCategories() {
  return productService
    .cache({ maxAge: 600000 })
    .background(300000)  // Refresh every 5 minutes
    .retry(3)
    .fallback([])
    .getCategories();
}

// First call: Fetches from server
const categories = await getCategories();

// Subsequent calls: Instant (from cache)
const cachedCategories = await getCategories();

// Every 5 minutes: Silent background refresh keeps cache fresh
```

### Example 5: High-Priority Checkout

```typescript
/**
 * Get product for checkout
 * - High priority (fast-lane processing)
 * - Aggressive retry
 * - Long timeout for reliability
 */
async function getProductForCheckout(productId: string) {
  return productService
    .priority('high')
    .retry({
      attempts: 5,
      backoff: 'exponential',
      initialDelay: 500
    })
    .timeout(10000)
    .getProduct(productId);
}

// Usage in checkout flow
const product = await getProductForCheckout('prod-123');
```

### Example 6: Top-Rated Products Pipeline

```typescript
/**
 * Get top-rated products with transformation pipeline
 * - Cache for 15 minutes
 * - Multi-stage transformation
 * - Metrics tracking
 */
async function getTopRatedProducts(count: number = 10) {
  return productService
    .cache({ maxAge: 900000, tags: ['top-products'] })
    .transform(products => products.filter(p => p.rating >= 4.5))
    .transform(products => products.sort((a, b) => b.rating - a.rating))
    .transform(products => products.slice(0, count))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Top products loaded in ${duration}ms (cache: ${cacheHit})`);
    })
    .getProducts();
}

// Usage
const topProducts = await getTopRatedProducts(10);
```

---

## User Management System

### Service Definition

```typescript
interface IUserService {
  authenticate(credentials: Credentials): Promise<AuthResult>;
  getProfile(userId: string): Promise<UserProfile>;
  updateProfile(userId: string, data: Partial<UserProfile>): Promise<UserProfile>;
  getPreferences(userId: string): Promise<UserPreferences>;
  updatePreferences(userId: string, prefs: Partial<UserPreferences>): Promise<UserPreferences>;
  logout(): Promise<void>;
}

interface Credentials {
  email: string;
  password: string;
}

interface AuthResult {
  userId: string;
  token: string;
  expiresAt: number;
}

interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatar: string;
  bio: string;
}
```

### Setup

```typescript
const userService = await peer.createFluentInterface<IUserService>(
  'UserService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager()
  }
);
```

### Example 1: Login with Retry and Metrics

```typescript
/**
 * Authenticate user with comprehensive error handling
 * - Retry only on network errors (not auth errors)
 * - Track metrics for monitoring
 * - Long timeout for slow networks
 */
async function login(email: string, password: string) {
  return userService
    .retry({
      attempts: 3,
      shouldRetry: (error) => {
        // Don't retry auth failures, only network issues
        return error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT';
      },
      backoff: 'linear',
      initialDelay: 1000
    })
    .timeout(10000)
    .metrics(({ duration }) => {
      console.log(`Login attempt took ${duration}ms`);
      analytics.track('login_attempt', { duration });
    })
    .authenticate({ email, password });
}

// Usage
try {
  const auth = await login('user@example.com', 'password');
  console.log(`Logged in as ${auth.userId}`);
} catch (error) {
  if (error.code === 'INVALID_CREDENTIALS') {
    console.error('Invalid email or password');
  } else {
    console.error('Login failed:', error.message);
  }
}
```

### Example 2: Cached User Profile

```typescript
/**
 * Get user profile with caching
 * - Cache for 5 minutes
 * - Tagged for invalidation
 * - Fallback to guest profile
 */
const GUEST_PROFILE: UserProfile = {
  id: 'guest',
  email: 'guest@example.com',
  displayName: 'Guest User',
  avatar: '/default-avatar.png',
  bio: ''
};

async function getUserProfile(userId: string) {
  return userService
    .cache({
      maxAge: 300000,
      tags: ['user-profile', `user:${userId}`]
    })
    .retry(3)
    .fallback(GUEST_PROFILE)
    .getProfile(userId);
}

// Usage
const profile = await getUserProfile('user-123');
```

### Example 3: Optimistic Profile Update

```typescript
/**
 * Update profile with optimistic UI
 * - Immediate cache update
 * - Automatic rollback on error
 * - Invalidate related caches
 */
async function updateDisplayName(userId: string, displayName: string) {
  return userService
    .cache({ maxAge: 300000 })
    .optimistic((current: UserProfile | undefined) => {
      if (!current) return undefined;
      return {
        ...current,
        displayName
      };
    })
    .invalidateOn(['user-profile', `user:${userId}`])
    .retry(3)
    .updateProfile(userId, { displayName });
}

// Usage - UI updates instantly
const updated = await updateDisplayName('user-123', 'New Name');
console.log(`Profile updated: ${updated.displayName}`);
```

### Example 4: Deduplication Example

```typescript
/**
 * Get preferences with deduplication
 * - Multiple concurrent calls share single request
 * - Cache for 2 minutes
 */
async function getPreferences(userId: string) {
  return userService
    .dedupe(`prefs-${userId}`)
    .cache(120000)
    .retry(3)
    .getPreferences(userId);
}

// Multiple components call this simultaneously
const [prefs1, prefs2, prefs3] = await Promise.all([
  getPreferences('user-123'),
  getPreferences('user-123'),
  getPreferences('user-123')
]);

// Only 1 HTTP request made, all three get same result
console.log(prefs1 === prefs2); // true (same object reference)
```

### Example 5: Logout (No Cache, No Retry)

```typescript
/**
 * Logout user
 * - No caching
 * - No retry (logout should be immediate)
 * - Clear related caches
 */
async function logout(userId: string) {
  // Invalidate user caches first
  userService.invalidate([`user:${userId}`, 'user-profile']);

  // Then logout
  await userService
    .timeout(5000)
    .logout();
}

// Usage
await logout('user-123');
```

---

## Real-Time Analytics Dashboard

### Service Definition

```typescript
interface IAnalyticsService {
  getDashboard(timeRange: TimeRange): Promise<DashboardData>;
  getMetrics(metric: string, timeRange: TimeRange): Promise<MetricData>;
  getAlerts(): Promise<Alert[]>;
  getSystemStatus(): Promise<SystemStatus>;
}

interface TimeRange {
  start: Date;
  end: Date;
}

interface DashboardData {
  metrics: Record<string, number>;
  charts: ChartData[];
  summary: string;
}
```

### Setup

```typescript
const analyticsService = await peer.createFluentInterface<IAnalyticsService>(
  'AnalyticsService@1.0.0',
  {
    cache: new HttpCacheManager(),
    retry: new RetryManager(),
    globalOptions: {
      retry: {
        attempts: 5,
        backoff: 'exponential'
      },
      timeout: 30000
    }
  }
);
```

### Example 1: Dashboard with SWR and Background Refresh

```typescript
/**
 * Get dashboard data with aggressive caching
 * - Stale-while-revalidate for instant loading
 * - Background refresh every minute
 * - Transform to add timestamp
 * - Metrics tracking
 */
async function getDashboard() {
  const timeRange = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
    end: new Date()
  };

  return analyticsService
    .cache({
      maxAge: 60000,               // 1 minute fresh
      staleWhileRevalidate: 30000, // 30s stale acceptable
      tags: ['dashboard']
    })
    .background(60000)  // Auto-refresh every minute
    .transform((data: DashboardData) => ({
      ...data,
      lastUpdated: Date.now()
    }))
    .metrics(({ duration, cacheHit }) => {
      console.log(`Dashboard ${cacheHit ? 'cached' : 'fetched'} in ${duration}ms`);
    })
    .getDashboard(timeRange);
}

// First call: Fetches data (1000ms)
const dashboard1 = await getDashboard();

// Second call immediately: Returns cached (instant)
const dashboard2 = await getDashboard();

// After 70s: Returns stale data instantly, refetches in background
const dashboard3 = await getDashboard();

// After 2 minutes: Returns fresh data from background refetch (instant)
const dashboard4 = await getDashboard();
```

### Example 2: Critical Alerts (High Priority)

```typescript
/**
 * Get critical alerts
 * - High priority for fast processing
 * - Short timeout for responsiveness
 * - Aggressive retry
 * - No cache (always fresh)
 * - Fallback to empty array
 */
async function getCriticalAlerts() {
  return analyticsService
    .priority('high')
    .retry({
      attempts: 3,
      backoff: 'constant',
      initialDelay: 500
    })
    .timeout(5000)
    .fallback([])
    .getAlerts();
}

// Usage in monitoring loop
setInterval(async () => {
  const alerts = await getCriticalAlerts();
  if (alerts.length > 0) {
    console.warn(`${alerts.length} critical alerts!`);
    notifyAdmin(alerts);
  }
}, 10000); // Check every 10 seconds
```

### Example 3: Specific Metric with Validation

```typescript
/**
 * Get specific metric with validation
 * - Cache for 30 seconds
 * - Validate data structure
 * - Fallback to safe defaults
 * - Transform for UI
 */
async function getMetric(metric: string) {
  const timeRange = {
    start: new Date(Date.now() - 60 * 60 * 1000), // Last hour
    end: new Date()
  };

  return analyticsService
    .cache({ maxAge: 30000, tags: [`metric:${metric}`] })
    .retry(5)
    .validate((data: MetricData) => {
      return data && typeof data.value === 'number';
    })
    .transform((data: MetricData) => ({
      ...data,
      displayValue: formatNumber(data.value),
      trend: calculateTrend(data)
    }))
    .fallback({
      value: 0,
      trend: 'stable',
      displayValue: '0'
    })
    .getMetrics(metric, timeRange);
}

// Usage
const cpuMetric = await getMetric('cpu_usage');
const memoryMetric = await getMetric('memory_usage');
```

### Example 4: System Status with Cancellation

```typescript
/**
 * Get system status with cancellation support
 * - Can cancel if user navigates away
 * - Cache for 10 seconds
 */
async function getSystemStatus(signal?: AbortSignal) {
  const builder = analyticsService
    .cache(10000)
    .retry(3)
    .call('getSystemStatus');

  // Cancel if abort signal fires
  signal?.addEventListener('abort', () => {
    builder.cancel();
  });

  return builder.execute();
}

// Usage with AbortController
const controller = new AbortController();

const statusPromise = getSystemStatus(controller.signal);

// User navigates away - cancel request
setTimeout(() => {
  controller.abort();
}, 1000);

try {
  const status = await statusPromise;
} catch (error) {
  if (error.message === 'Query cancelled') {
    console.log('Status check cancelled');
  }
}
```

---

## Microservices Communication

### Service Definitions

```typescript
interface IOrderService {
  createOrder(order: CreateOrderDto): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
}

interface IInventoryService {
  checkAvailability(productId: string): Promise<InventoryCheck>;
  reserveStock(productId: string, quantity: number): Promise<boolean>;
  releaseStock(productId: string, quantity: number): Promise<boolean>;
}

interface IPaymentService {
  processPayment(orderId: string, payment: PaymentInfo): Promise<PaymentResult>;
  refund(orderId: string): Promise<RefundResult>;
}
```

### Setup with Circuit Breaker

```typescript
// Configure with circuit breaker for fault tolerance
const orderService = await peer.createFluentInterface<IOrderService>(
  'OrderService@1.0.0',
  {
    retry: new RetryManager({
      circuitBreaker: {
        threshold: 5,       // Open after 5 failures
        windowTime: 60000,  // In 60 second window
        cooldownTime: 30000 // Wait 30s before retry
      }
    })
  }
);

const inventoryService = await peer.createFluentInterface<IInventoryService>(
  'InventoryService@1.0.0',
  {
    retry: new RetryManager({
      circuitBreaker: {
        threshold: 3,
        windowTime: 30000,
        cooldownTime: 15000
      }
    })
  }
);

const paymentService = await peer.createFluentInterface<IPaymentService>(
  'PaymentService@1.0.0',
  {
    retry: new RetryManager({
      defaultOptions: {
        attempts: 5,
        backoff: 'exponential'
      }
    })
  }
);
```

### Example 1: Create Order Workflow

```typescript
/**
 * Create order with multi-service coordination
 * - Check inventory
 * - Reserve stock
 * - Process payment
 * - Create order
 * - Handle failures with rollback
 */
async function createOrder(orderData: CreateOrderDto) {
  const { productId, quantity, payment } = orderData;

  try {
    // Step 1: Check inventory
    const availability = await inventoryService
      .retry(3)
      .timeout(5000)
      .checkAvailability(productId);

    if (!availability.available || availability.quantity < quantity) {
      throw new Error('Product not available');
    }

    // Step 2: Reserve stock
    const reserved = await inventoryService
      .retry(3)
      .timeout(10000)
      .reserveStock(productId, quantity);

    if (!reserved) {
      throw new Error('Failed to reserve stock');
    }

    try {
      // Step 3: Process payment
      const paymentResult = await paymentService
        .retry(5)
        .timeout(30000)
        .metrics(({ duration }) => {
          console.log(`Payment processed in ${duration}ms`);
        })
        .processPayment('temp-order-id', payment);

      if (!paymentResult.success) {
        throw new Error('Payment failed');
      }

      // Step 4: Create order
      const order = await orderService
        .retry(3)
        .invalidateOn(['orders'])
        .createOrder({
          ...orderData,
          paymentId: paymentResult.paymentId
        });

      return order;

    } catch (error) {
      // Rollback: Release reserved stock
      await inventoryService
        .retry(3)
        .releaseStock(productId, quantity);
      throw error;
    }

  } catch (error) {
    console.error('Order creation failed:', error);
    throw error;
  }
}

// Usage
try {
  const order = await createOrder({
    productId: 'prod-123',
    quantity: 2,
    payment: { /* ... */ }
  });
  console.log(`Order created: ${order.id}`);
} catch (error) {
  console.error('Failed to create order:', error.message);
}
```

### Example 2: Get Order with Caching

```typescript
/**
 * Get order details with caching
 * - Cache for 1 minute
 * - Tagged for invalidation
 * - Deduplicated
 */
async function getOrder(orderId: string) {
  return orderService
    .dedupe(`order-${orderId}`)
    .cache({
      maxAge: 60000,
      tags: ['orders', `order:${orderId}`]
    })
    .retry(3)
    .getOrder(orderId);
}

// Multiple components can call this without duplicate requests
const [order1, order2, order3] = await Promise.all([
  getOrder('order-123'),
  getOrder('order-123'),
  getOrder('order-123')
]);
```

### Example 3: Update Order Status with Optimistic UI

```typescript
/**
 * Update order status with optimistic update
 * - Immediate cache update
 * - Invalidate order cache
 * - Rollback on error
 */
async function updateOrderStatus(orderId: string, status: OrderStatus) {
  return orderService
    .cache({ maxAge: 60000 })
    .optimistic((order: Order | undefined) => {
      if (!order) return undefined;
      return {
        ...order,
        status,
        updatedAt: new Date()
      };
    })
    .invalidateOn(['orders', `order:${orderId}`])
    .retry(3)
    .updateOrderStatus(orderId, status);
}

// Usage - UI updates instantly
await updateOrderStatus('order-123', 'shipped');
```

---

## Social Media Platform

### Service Definition

```typescript
interface ISocialService {
  getFeed(userId: string, page: number): Promise<Post[]>;
  getPost(postId: string): Promise<Post>;
  createPost(post: CreatePostDto): Promise<Post>;
  likePost(postId: string): Promise<Post>;
  unlikePost(postId: string): Promise<Post>;
  getNotifications(userId: string): Promise<Notification[]>;
}

interface Post {
  id: string;
  authorId: string;
  content: string;
  likes: number;
  comments: number;
  createdAt: Date;
}
```

### Example 1: Feed with Pagination and Background Refresh

```typescript
/**
 * Get user feed with smart caching
 * - Cache first page aggressively
 * - Background refresh every 30 seconds
 * - Transform to add UI metadata
 */
async function getFeed(userId: string, page: number = 1) {
  const cacheConfig = page === 1
    ? {
        maxAge: 60000,
        staleWhileRevalidate: 30000,
        tags: ['feed', `user:${userId}`]
      }
    : { maxAge: 300000 }; // Cache other pages longer

  return socialService
    .cache(cacheConfig)
    .background(page === 1 ? 30000 : 0) // Only refresh first page
    .transform((posts: Post[]) =>
      posts.map(post => ({
        ...post,
        isLiked: false, // Will be populated by client
        displayDate: formatDate(post.createdAt)
      }))
    )
    .retry(3)
    .fallback([])
    .getFeed(userId, page);
}

// Usage
const feed = await getFeed('user-123', 1);
```

### Example 2: Like with Optimistic Update

```typescript
/**
 * Like post with optimistic UI
 * - Immediate like count update
 * - Rollback if server rejects
 */
async function likePost(postId: string) {
  return socialService
    .cache({ maxAge: 60000 })
    .optimistic((post: Post | undefined) => {
      if (!post) return undefined;
      return {
        ...post,
        likes: post.likes + 1
      };
    })
    .invalidateOn(['feed', `post:${postId}`])
    .retry(3)
    .likePost(postId);
}

// Usage - UI updates instantly
const updatedPost = await likePost('post-123');
```

### Example 3: Notifications with Polling

```typescript
/**
 * Poll for notifications
 * - Short cache (5 seconds)
 * - High priority
 * - Deduplicated
 */
async function pollNotifications(userId: string) {
  return socialService
    .dedupe(`notifications-${userId}`)
    .cache({ maxAge: 5000 })
    .priority('high')
    .retry(2)
    .fallback([])
    .getNotifications(userId);
}

// Poll every 10 seconds
setInterval(async () => {
  const notifications = await pollNotifications('user-123');
  updateUI(notifications);
}, 10000);
```

---

## Financial Trading System

### Service Definition

```typescript
interface ITradingService {
  getQuote(symbol: string): Promise<Quote>;
  getOrderBook(symbol: string): Promise<OrderBook>;
  placeOrder(order: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getPortfolio(userId: string): Promise<Portfolio>;
}

interface Quote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}
```

### Example 1: Real-Time Quotes (No Cache)

```typescript
/**
 * Get real-time quote
 * - No caching (always fresh)
 * - High priority
 * - Short timeout
 * - Aggressive retry
 */
async function getRealTimeQuote(symbol: string) {
  return tradingService
    .priority('high')
    .timeout(1000)
    .retry({
      attempts: 3,
      backoff: 'constant',
      initialDelay: 100
    })
    .metrics(({ duration }) => {
      console.log(`Quote fetched in ${duration}ms`);
    })
    .getQuote(symbol);
}

// Usage in trading loop
setInterval(async () => {
  const quote = await getRealTimeQuote('AAPL');
  updateChart(quote);
}, 1000); // Update every second
```

### Example 2: Order Book with Short Cache

```typescript
/**
 * Get order book
 * - Very short cache (1 second)
 * - Background refresh every 500ms
 * - Transform for UI
 */
async function getOrderBook(symbol: string) {
  return tradingService
    .cache({ maxAge: 1000 })
    .background(500)
    .transform((orderBook: OrderBook) => ({
      ...orderBook,
      totalBids: calculateTotal(orderBook.bids),
      totalAsks: calculateTotal(orderBook.asks)
    }))
    .retry(3)
    .getOrderBook(symbol);
}
```

### Example 3: Place Order (Critical Operation)

```typescript
/**
 * Place trading order
 * - Maximum reliability
 * - Aggressive retry
 * - Long timeout
 * - Metrics for monitoring
 */
async function placeOrder(order: OrderRequest) {
  return tradingService
    .priority('high')
    .retry({
      attempts: 10,
      backoff: 'exponential',
      initialDelay: 500,
      maxDelay: 5000,
      shouldRetry: (error) => {
        // Don't retry on business logic errors
        return !['INSUFFICIENT_FUNDS', 'INVALID_ORDER'].includes(error.code);
      }
    })
    .timeout(30000)
    .metrics(({ duration }) => {
      console.log(`Order placed in ${duration}ms`);
      monitoring.track('order_placed', { duration });
    })
    .placeOrder(order);
}

// Usage
try {
  const order = await placeOrder({
    symbol: 'AAPL',
    type: 'limit',
    side: 'buy',
    quantity: 100,
    price: 150.00
  });
  console.log(`Order placed: ${order.id}`);
} catch (error) {
  console.error('Order failed:', error);
  alertUser('Failed to place order');
}
```

### Example 4: Portfolio with Optimistic Updates

```typescript
/**
 * Get portfolio with caching
 * - Cache for 10 seconds
 * - Background refresh
 */
async function getPortfolio(userId: string) {
  return tradingService
    .cache({ maxAge: 10000, tags: [`portfolio:${userId}`] })
    .background(5000)
    .retry(5)
    .getPortfolio(userId);
}

// Usage
const portfolio = await getPortfolio('user-123');
```

---

## Summary

These examples demonstrate:

1. **Caching strategies** - From aggressive (dashboards) to none (real-time quotes)
2. **Retry patterns** - Custom retry logic for different scenarios
3. **Optimistic updates** - Instant UI feedback with automatic rollback
4. **Background refresh** - Keep data fresh without user intervention
5. **Request deduplication** - Prevent duplicate requests automatically
6. **Priority handling** - Fast-lane critical operations
7. **Error handling** - Graceful degradation with fallbacks
8. **Metrics tracking** - Monitor performance and usage
9. **Transformation pipelines** - Multi-stage data processing
10. **Cancellation** - Cancel requests when no longer needed

Adapt these patterns to your specific use cases for optimal performance and user experience!
