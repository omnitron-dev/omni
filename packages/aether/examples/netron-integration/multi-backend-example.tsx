/**
 * Multi-Backend Netron Integration Example
 *
 * This example demonstrates advanced multi-backend configuration
 * for complex applications that need to communicate with multiple
 * backend services.
 *
 * Use Cases:
 * - Microservices architecture
 * - Separate auth/analytics services
 * - Multi-region deployments
 * - Third-party API integration
 */

import { defineComponent, signal, computed, onMount } from '@omnitron-dev/aether';
import { Injectable, Module, inject, bootstrapModule } from '@omnitron-dev/aether/di';
import {
  NetronModule,
  NetronService,
  NetronStore,
  NetronClient,
  useQuery,
  useMutation,
  Backend,
  Service,
} from '@omnitron-dev/aether/netron';

// ============================================================================
// CONTRACTS FOR DIFFERENT SERVICES
// ============================================================================

// Main API Service
interface User {
  id: string;
  name: string;
  email: string;
}

interface IUserService {
  getUsers(): Promise<User[]>;
  createUser(data: { name: string; email: string }): Promise<User>;
}

// Analytics Service
interface AnalyticsEvent {
  type: string;
  userId: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

interface IAnalyticsService {
  trackEvent(event: Omit<AnalyticsEvent, 'timestamp'>): Promise<void>;
  getEvents(userId: string): Promise<AnalyticsEvent[]>;
  getStats(): Promise<{ totalEvents: number; uniqueUsers: number }>;
}

// Auth Service
interface AuthToken {
  token: string;
  expiresAt: Date;
}

interface IAuthService {
  login(email: string, password: string): Promise<AuthToken>;
  logout(token: string): Promise<void>;
  verifyToken(token: string): Promise<boolean>;
  refreshToken(token: string): Promise<AuthToken>;
}

// Payment Service
interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
}

interface IPaymentService {
  createPaymentIntent(amount: number, currency: string): Promise<PaymentIntent>;
  confirmPayment(intentId: string): Promise<PaymentIntent>;
  refundPayment(intentId: string): Promise<void>;
}

// ============================================================================
// SERVICE IMPLEMENTATIONS (Each with its own backend)
// ============================================================================

/**
 * Main API Service
 * Backend: main (api.example.com)
 */
@Injectable()
@Backend('main')
@Service('users@1.0.0')
export class UserService extends NetronService<IUserService> {
  // Auto-configured to use 'main' backend
}

/**
 * Analytics Service
 * Backend: analytics (analytics.example.com)
 */
@Injectable()
@Backend('analytics')
@Service('analytics@1.0.0')
export class AnalyticsService extends NetronService<IAnalyticsService> {
  // Auto-configured to use 'analytics' backend

  // Optional: Add convenience methods
  async trackPageView(path: string, userId: string): Promise<void> {
    await this.mutate('trackEvent', [
      {
        type: 'page_view',
        userId,
        metadata: { path, referrer: document.referrer },
      },
    ]);
  }

  async trackClick(elementId: string, userId: string): Promise<void> {
    await this.mutate('trackEvent', [
      {
        type: 'click',
        userId,
        metadata: { elementId, timestamp: new Date() },
      },
    ]);
  }
}

/**
 * Auth Service
 * Backend: auth (auth.example.com)
 */
@Injectable()
@Backend('auth')
@Service('auth@1.0.0')
export class AuthService extends NetronService<IAuthService> {
  // Auto-configured to use 'auth' backend
}

/**
 * Payment Service
 * Backend: payment (payment.example.com)
 */
@Injectable()
@Backend('payment')
@Service('payment@1.0.0')
export class PaymentService extends NetronService<IPaymentService> {
  // Auto-configured to use 'payment' backend
}

/**
 * User Store - Combines data from multiple backends
 */
@Injectable()
@Backend('main')
@Service('users@1.0.0')
export class UserStore extends NetronStore<IUserService> {
  // State
  users = signal<User[]>([]);
  selectedUser = signal<User | null>(null);
  loading = signal(false);
  error = signal<Error | null>(null);

  // Inject other services
  private analytics = inject(AnalyticsService);

  // Computed
  userCount = computed(() => this.users().length);

  // Actions
  async loadUsers() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const data = await this.query('getUsers', [], {
        cache: { maxAge: 60000, tags: ['users'] },
      });
      this.users.set(data);

      // Track analytics event (different backend!)
      await this.analytics.trackPageView('/users', 'system');
    } catch (err) {
      this.error.set(err as Error);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async createUser(name: string, email: string) {
    const newUser = await this.mutate('createUser', [{ name, email }], {
      optimistic: () => {
        // Optimistic update
        this.users.set([...this.users(), { id: 'temp-' + Date.now(), name, email }]);
      },
      invalidate: ['users'],
    });

    // Track analytics event
    await this.analytics.trackEvent({
      type: 'user_created',
      userId: newUser.id,
      metadata: { name, email },
    });

    return newUser;
  }
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Dashboard - Demonstrates multi-backend data aggregation
 */
const Dashboard = defineComponent(() => {
  const userStore = inject(UserStore);
  const analytics = inject(AnalyticsService);
  const auth = inject(AuthService);
  const netron = inject(NetronClient);

  // Query data from multiple backends simultaneously
  const { data: stats } = useQuery(AnalyticsService, 'getStats', [], { cache: 30000 });

  const isAuthenticated = signal(false);

  onMount(async () => {
    // Verify authentication (auth backend)
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const valid = await auth.query('verifyToken', [token]);
        isAuthenticated.set(valid);
      } catch (err) {
        isAuthenticated.set(false);
      }
    }

    // Load users (main backend)
    await userStore.loadUsers();

    // Track page view (analytics backend)
    await analytics.trackPageView('/dashboard', 'user-123');
  });

  // Get cache statistics across all backends
  const cacheStats = computed(() => netron.getCacheStats());

  return () => (
    <div class="dashboard">
      <h1>Multi-Backend Dashboard</h1>

      {/* Auth Status */}
      <div class="auth-status">
        <strong>Auth Status:</strong> {isAuthenticated() ? '✅ Authenticated' : '❌ Not authenticated'}
      </div>

      {/* Analytics Stats (analytics backend) */}
      {stats() && (
        <div class="stats-panel">
          <h2>Analytics (analytics.example.com)</h2>
          <div class="stat">
            <strong>Total Events:</strong> {stats()!.totalEvents}
          </div>
          <div class="stat">
            <strong>Unique Users:</strong> {stats()!.uniqueUsers}
          </div>
        </div>
      )}

      {/* Users (main backend) */}
      <div class="users-panel">
        <h2>Users (api.example.com)</h2>
        {userStore.loading() && <div>Loading users...</div>}
        {userStore.error() && <div class="error">{userStore.error()!.message}</div>}
        <div class="user-count">Total Users: {userStore.userCount()}</div>
        <ul>
          {userStore.users().map((user) => (
            <li key={user.id}>
              {user.name} ({user.email})
            </li>
          ))}
        </ul>
      </div>

      {/* Cache Statistics (all backends) */}
      <div class="cache-panel">
        <h2>Cache Statistics (Shared Cache Manager)</h2>
        <div class="cache-stat">
          <strong>Hit Rate:</strong> {(cacheStats().hitRate * 100).toFixed(1)}%
        </div>
        <div class="cache-stat">
          <strong>Hits:</strong> {cacheStats().hits}
        </div>
        <div class="cache-stat">
          <strong>Misses:</strong> {cacheStats().misses}
        </div>
        <div class="cache-stat">
          <strong>Entries:</strong> {cacheStats().entries}
        </div>
      </div>

      {/* Backend Info */}
      <div class="backend-info">
        <h2>Configured Backends</h2>
        <ul>
          {netron.getBackends().map((name) => (
            <li key={name}>✅ {name}</li>
          ))}
        </ul>
      </div>
    </div>
  );
});

/**
 * Payment Component - Demonstrates payment backend
 */
const PaymentComponent = defineComponent<{ amount: number }>((props) => {
  const paymentService = inject(PaymentService);
  const analytics = inject(AnalyticsService);

  const {
    mutate,
    loading,
    data: paymentIntent,
  } = useMutation(PaymentService, 'createPaymentIntent', {
    onSuccess: async (intent) => {
      console.log('Payment intent created:', intent);
      // Track analytics (different backend!)
      await analytics.trackEvent({
        type: 'payment_initiated',
        userId: 'user-123',
        metadata: { amount: props.amount, intentId: intent.id },
      });
    },
  });

  const handlePayment = async () => {
    await mutate(props.amount, 'USD');
  };

  return () => (
    <div class="payment">
      <h3>Payment (payment.example.com)</h3>
      <p>Amount: ${props.amount}</p>

      <button onClick={handlePayment} disabled={loading()}>
        {loading() ? 'Processing...' : `Pay $${props.amount}`}
      </button>

      {paymentIntent() && (
        <div class="payment-status">
          <strong>Status:</strong> {paymentIntent()!.status}
        </div>
      )}
    </div>
  );
});

/**
 * Login Component - Demonstrates auth backend
 */
const LoginComponent = defineComponent(() => {
  const email = signal('');
  const password = signal('');

  const {
    mutate,
    loading,
    error,
    data: token,
  } = useMutation(AuthService, 'login', {
    onSuccess: (authToken) => {
      localStorage.setItem('auth_token', authToken.token);
      console.log('Logged in successfully!');
    },
  });

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    await mutate(email(), password());
  };

  return () => (
    <form onSubmit={handleLogin} class="login-form">
      <h3>Login (auth.example.com)</h3>

      <div class="form-group">
        <input
          type="email"
          placeholder="Email"
          value={email()}
          onInput={(e) => email.set((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="form-group">
        <input
          type="password"
          placeholder="Password"
          value={password()}
          onInput={(e) => password.set((e.target as HTMLInputElement).value)}
        />
      </div>

      {error() && <div class="error">{error()!.message}</div>}

      {token() && <div class="success">Login successful!</div>}

      <button type="submit" disabled={loading()}>
        {loading() ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
});

// ============================================================================
// APP MODULE WITH MULTI-BACKEND CONFIGURATION
// ============================================================================

/**
 * Root Application Module
 *
 * Demonstrates zero-config setup for multiple backends
 */
@Module({
  imports: [
    NetronModule.forRoot({
      // Configure multiple backends
      backends: {
        // Main API
        main: {
          url: 'https://api.example.com',
          headers: {
            'X-API-Version': '1.0.0',
          },
          timeout: 30000,
        },

        // Analytics API
        analytics: {
          url: 'https://analytics.example.com',
          headers: {
            'X-Analytics-Key': 'your-analytics-key',
          },
          cache: {
            maxEntries: 500,
            defaultMaxAge: 30000, // 30 seconds
          },
        },

        // Auth API
        auth: {
          url: 'https://auth.example.com',
          headers: {
            'X-Auth-Client': 'aether-app',
          },
          retry: {
            attempts: 1, // Don't retry auth failures
            backoff: 'constant',
          },
        },

        // Payment API
        payment: {
          url: 'https://payment.example.com',
          headers: {
            'X-Payment-Key': 'your-payment-key',
          },
          timeout: 60000, // Longer timeout for payments
          retry: {
            attempts: 3,
            backoff: 'exponential',
            initialDelay: 2000,
          },
        },
      },

      // Default backend (used if @Backend() decorator is omitted)
      default: 'main',

      // Global cache configuration (shared across all backends)
      cache: {
        maxEntries: 2000,
        maxSizeBytes: 20_000_000, // 20MB
        defaultMaxAge: 60000,
        debug: true, // Enable cache debugging
      },

      // Global retry configuration (can be overridden per backend)
      retry: {
        attempts: 3,
        backoff: 'exponential',
        initialDelay: 1000,
        maxDelay: 30000,
        jitter: 0.1,
        circuitBreaker: {
          threshold: 5,
          windowTime: 60000,
          cooldownTime: 30000,
        },
      },
    }),
  ],
  providers: [UserService, UserStore, AnalyticsService, AuthService, PaymentService],
  bootstrap: Dashboard,
})
export class AppModule {}

// ============================================================================
// BOOTSTRAP
// ============================================================================

export async function startApp() {
  const { container, component } = bootstrapModule(AppModule);

  console.log('Multi-backend app started!');
  console.log('Configured backends:', container.get(NetronClient).getBackends());

  return { container, component };
}

if (typeof window !== 'undefined') {
  startApp().catch(console.error);
}

/**
 * KEY FEATURES DEMONSTRATED:
 *
 * 1. ✅ Multiple Backend Configuration
 *    - Each backend has its own URL and configuration
 *    - Per-backend headers, timeouts, and retry policies
 *
 * 2. ✅ Shared Cache Manager
 *    - One cache manager for ALL backends
 *    - Efficient memory usage
 *    - Unified cache statistics
 *
 * 3. ✅ @Backend() Decorator
 *    - Each service explicitly declares its backend
 *    - Type-safe service routing
 *    - No manual peer management
 *
 * 4. ✅ Cross-Backend Operations
 *    - UserStore queries main backend
 *    - Automatically tracks analytics on different backend
 *    - Seamless multi-backend coordination
 *
 * 5. ✅ Service Isolation
 *    - Each service knows only its own backend
 *    - Clear separation of concerns
 *    - Easy to test and maintain
 *
 * 6. ✅ Zero Boilerplate
 *    - No manual HttpRemotePeer creation
 *    - No cache manager configuration per service
 *    - No retry manager configuration per service
 *    - Everything handled by NetronModule
 *
 * COMPARISON:
 *
 * ❌ Manual Setup (before):
 * - 50+ lines per service
 * - Duplicate cache/retry configuration
 * - Manual peer management
 * - Error-prone configuration
 *
 * ✅ Zero-Config (now):
 * - 5 lines per service
 * - Centralized configuration
 * - Automatic peer management
 * - Type-safe and foolproof
 *
 * RESULT: 90% reduction in boilerplate + better architecture
 */
