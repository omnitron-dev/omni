# Aether Monitoring System

Comprehensive production monitoring and analytics for the Aether framework.

## Features

### Core Modules

- **Error Tracking**: Automatic error capture with stack traces, breadcrumbs, and context
- **Performance Monitoring**: Core Web Vitals (LCP, FID, CLS, FCP, TTI, TTFB, INP)
- **Analytics**: Event tracking, page views, user identification, and custom metrics
- **Privacy & GDPR**: Cookie consent, data anonymization, and compliance tools
- **Developer Tools**: Performance profiler, memory leak detection, and network viewer

### Integrations

- **Sentry**: Error tracking and performance monitoring
- **Google Analytics**: GA4 event and page tracking
- **Mixpanel**: Product analytics and user tracking
- **Custom Backend**: Send data to your own backend
- **Webhooks**: Real-time notifications

## Installation

```typescript
import { monitor } from '@omnitron-dev/aether/monitoring';
```

## Quick Start

### Basic Setup

```typescript
import { monitor } from '@omnitron-dev/aether/monitoring';

// Initialize monitoring
monitor.init({
  enabled: true,
  environment: 'production',
  version: '1.0.0',
  performance: true,
  errorTracking: true,
  analytics: true,
  sampleRate: 1.0,
});

// Set user
monitor.setUser({
  id: 'user-123',
  email: 'user@example.com',
  username: 'john_doe',
});

// Track events
monitor.trackEvent('button_click', {
  button: 'checkout',
  page: 'product',
});

// Track errors
try {
  // Your code
} catch (error) {
  monitor.trackError(error, {
    severity: 'error',
    context: { action: 'checkout' },
  });
}
```

### With Integrations

```typescript
import { monitor } from '@omnitron-dev/aether/monitoring';

monitor.init({
  enabled: true,
  environment: 'production',

  // Sentry integration
  sentry: {
    dsn: 'https://xxx@sentry.io/xxx',
    environment: 'production',
    release: '1.0.0',
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
  },

  // Google Analytics
  googleAnalytics: {
    measurementId: 'G-XXXXXXXXXX',
    sendPageViews: true,
  },

  // Mixpanel
  mixpanel: {
    token: 'your-mixpanel-token',
    trackPageViews: true,
  },

  // Privacy settings
  privacy: {
    cookieConsent: true,
    respectDoNotTrack: true,
    anonymizeIp: true,
    gdprCompliance: true,
  },
});
```

## Core Features

### Error Tracking

```typescript
// Track errors manually
monitor.trackError(new Error('Something went wrong'), {
  severity: 'error',
  tags: { feature: 'checkout' },
  context: { userId: '123', cart: { items: 5 } },
});

// Add breadcrumbs
monitor.addBreadcrumb({
  type: 'navigation',
  message: 'User navigated to checkout',
  level: 'info',
  timestamp: Date.now(),
});

// Integrate with Error Boundary
import { ErrorBoundary } from '@omnitron-dev/aether/suspense';
import { ErrorBoundaryIntegration } from '@omnitron-dev/aether/monitoring';

const tracker = getErrorTracker();
const integration = new ErrorBoundaryIntegration(tracker);

<ErrorBoundary onError={integration.createHandler()}>
  <YourApp />
</ErrorBoundary>
```

### Performance Monitoring

```typescript
// Track Core Web Vitals automatically
const vitals = monitor.getWebVitals();
console.log('LCP:', vitals.LCP);
console.log('FID:', vitals.FID);
console.log('CLS:', vitals.CLS);

// Custom performance marks
monitor.startMark('api_call');
await fetchData();
monitor.endMark('api_call');

const duration = monitor.measure('api_call', 'api_call');
console.log('API call took:', duration, 'ms');

// Track custom metrics
monitor.trackMetric({
  name: 'bundle_size',
  value: 245,
  unit: 'kb',
  tags: { version: '1.0.0' },
});
```

### Analytics

```typescript
// Track events
monitor.trackEvent('purchase_completed', {
  amount: 99.99,
  currency: 'USD',
  items: 3,
  plan: 'premium',
});

// Track page views
monitor.trackPageView({
  url: window.location.href,
  title: document.title,
  referrer: document.referrer,
});

// Set custom dimensions
const analytics = getAnalytics();
analytics.setCustomDimension('user_plan', 'premium');
analytics.setCustomDimension('experiment', 'variant_a');

// Track conversions
const conversionTracker = new ConversionTracker(analytics);
conversionTracker.trackConversion('signup', 100, {
  source: 'landing_page',
});
```

### A/B Testing

```typescript
import { ABTest, getAnalytics } from '@omnitron-dev/aether/monitoring';

const analytics = getAnalytics();
const abTest = new ABTest(analytics);

// Create experiment
const variant = abTest.variant('checkout_flow', ['control', 'variant_a', 'variant_b']);

// Show different UI based on variant
if (variant === 'variant_a') {
  // Show variant A
} else if (variant === 'variant_b') {
  // Show variant B
} else {
  // Show control
}

// Track conversion
abTest.trackConversion('checkout_flow', 'completed_purchase', 99.99);
```

### Privacy & GDPR

```typescript
import { PrivacyManager, ConsentBanner } from '@omnitron-dev/aether/monitoring';

const privacyManager = getPrivacyManager({
  cookieConsent: true,
  respectDoNotTrack: true,
  anonymizeIp: true,
  gdprCompliance: true,
  dataRetention: 90,
});

// Show consent banner
const banner = new ConsentBanner(privacyManager);
banner.show({
  position: 'bottom',
  message: 'We use cookies to improve your experience.',
});

// Request consent
const consent = await privacyManager.requestConsent({
  analytics: true,
  performance: true,
  errorTracking: true,
});

// Check consent
if (privacyManager.hasConsentFor('analytics')) {
  // Track analytics
}

// Listen to consent changes
privacyManager.onConsentChange((consent) => {
  console.log('Consent changed:', consent);
});

// GDPR rights
await privacyManager.exportUserData(); // Right to data portability
await privacyManager.deleteUserData(); // Right to be forgotten
```

### Developer Tools

```typescript
import { DevTools, Profile } from '@omnitron-dev/aether/monitoring';

// Only enabled in development
const devtools = getDevTools({
  profiler: true,
  memoryLeakDetection: true,
  networkViewer: true,
  componentTracking: true,
});

// Profile decorator
class MyService {
  @Profile('fetchData')
  async fetchData() {
    // Method will be automatically profiled
  }
}

// Manual profiling
devtools.startProfile('render');
// Do some work
devtools.endProfile('render');

// Access profiling data
const profile = devtools.getProfile('render');
console.table(profile);

// Memory monitoring
const snapshots = devtools.getMemorySnapshots();
console.log('Memory usage:', snapshots);

// Network requests
const requests = devtools.getNetworkRequests();
console.log('Network activity:', requests);

// Export all data
const data = devtools.export();
```

## Configuration

### Monitoring Config

```typescript
interface MonitoringConfig {
  enabled?: boolean;
  environment?: string;
  version?: string;
  performance?: boolean | PerformanceMonitoringConfig;
  errorTracking?: boolean | ErrorTrackingConfig;
  analytics?: boolean;
  rum?: boolean;
  sampleRate?: number;
  debug?: boolean;
  sentry?: SentryConfig;
  googleAnalytics?: GoogleAnalyticsConfig;
  mixpanel?: MixpanelConfig;
  customBackend?: CustomBackendConfig;
  webhook?: WebhookConfig;
  privacy?: PrivacyConfig;
  userInfoProvider?: () => UserInfo | Promise<UserInfo>;
  beforeSend?: (event: any) => any | null;
  devtools?: boolean | DevToolsConfig;
}
```

### Performance Config

```typescript
interface PerformanceMonitoringConfig {
  webVitals?: boolean;
  resourceTiming?: boolean;
  navigationTiming?: boolean;
  memoryUsage?: boolean;
  bundleSize?: boolean;
  sampleRate?: number;
  reportThreshold?: number;
}
```

### Error Tracking Config

```typescript
interface ErrorTrackingConfig {
  autoCapture?: boolean;
  maxBreadcrumbs?: number;
  attachStackTrace?: boolean;
  attachComponentStack?: boolean;
  grouping?: 'auto' | 'fingerprint';
  sampleRate?: number;
}
```

## Best Practices

### 1. Initialize Early

```typescript
// Initialize monitoring as early as possible
monitor.init(config);
```

### 2. Set User Context

```typescript
// Set user information for better error tracking
monitor.setUser({
  id: user.id,
  email: user.email,
  username: user.username,
});
```

### 3. Use Breadcrumbs

```typescript
// Add breadcrumbs for better debugging
monitor.addBreadcrumb({
  type: 'navigation',
  message: 'User navigated to checkout',
  level: 'info',
  timestamp: Date.now(),
});
```

### 4. Respect Privacy

```typescript
// Always check consent before tracking
if (privacyManager.hasConsentFor('analytics')) {
  monitor.trackEvent('user_action');
}
```

### 5. Use Sample Rates

```typescript
// Use sample rates in production to reduce costs
monitor.init({
  sampleRate: 0.1, // Sample 10% of users
  sentry: {
    sampleRate: 1.0,
    tracesSampleRate: 0.1, // Sample 10% of traces
  },
});
```

### 6. Clean Up

```typescript
// Clean up on app unmount
await monitor.shutdown();
```

## API Reference

### Monitor API

- `init(config)` - Initialize monitoring
- `trackError(error, info?)` - Track an error
- `trackEvent(name, properties?)` - Track an event
- `trackPageView(view)` - Track a page view
- `trackMetric(metric)` - Track a custom metric
- `setUser(user)` - Set user information
- `addBreadcrumb(breadcrumb)` - Add a breadcrumb
- `startMark(name)` - Start a performance mark
- `endMark(name)` - End a performance mark
- `measure(name, start, end?)` - Measure performance
- `getWebVitals()` - Get Core Web Vitals
- `flush()` - Flush pending events
- `shutdown()` - Shutdown monitoring

## Examples

See the `/test/monitoring/` directory for comprehensive usage examples.

## License

MIT
