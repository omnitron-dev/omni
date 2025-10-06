# 28. Monitoring

## Table of Contents
- [Overview](#overview)
- [Application Performance Monitoring](#application-performance-monitoring)
- [Error Tracking](#error-tracking)
- [Real User Monitoring](#real-user-monitoring)
- [Web Vitals](#web-vitals)
- [Custom Metrics](#custom-metrics)
- [Distributed Tracing](#distributed-tracing)
- [Logging](#logging)
- [Alerting](#alerting)
- [Dashboards](#dashboards)
- [Analytics](#analytics)
- [Synthetic Monitoring](#synthetic-monitoring)
- [Performance Profiling](#performance-profiling)
- [Titan Integration](#titan-integration)
- [DevTools](#devtools)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Monitoring is essential for understanding application health, performance, and user experience in production.

### Monitoring Pillars

```typescript
/**
 * The Three Pillars of Observability:
 *
 * 1. Metrics
 *    - Quantitative measurements over time
 *    - CPU, memory, response time, error rates
 *    - Aggregated data for trends
 *
 * 2. Logs
 *    - Discrete events with context
 *    - Application events, errors, warnings
 *    - Searchable and filterable
 *
 * 3. Traces
 *    - Request flow through system
 *    - Distributed transaction tracking
 *    - Identify bottlenecks
 */
```

### Monitoring Stack

```typescript
// Recommended monitoring stack for Nexus
export const monitoringStack = {
  // APM (Application Performance Monitoring)
  apm: 'Sentry', // or 'New Relic', 'Datadog', 'Elastic APM'

  // Error Tracking
  errors: 'Sentry', // or 'Rollbar', 'Bugsnag'

  // RUM (Real User Monitoring)
  rum: 'Vercel Analytics', // or 'Google Analytics', 'Plausible'

  // Logging
  logs: 'Better Stack', // or 'Datadog', 'Elastic', 'CloudWatch'

  // Metrics
  metrics: 'Prometheus', // or 'Datadog', 'CloudWatch'

  // Tracing
  tracing: 'OpenTelemetry', // or 'Jaeger', 'Zipkin'

  // Uptime Monitoring
  uptime: 'UptimeRobot', // or 'Pingdom', 'StatusCake'
};
```

## Application Performance Monitoring

Monitor application performance and health.

### Sentry Integration

```typescript
// app.tsx
import * as Sentry from '@sentry/browser';
import { BrowserTracing } from '@sentry/tracing';

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,

    // Performance monitoring
    integrations: [
      new BrowserTracing({
        // Track route changes
        routingInstrumentation: Sentry.routingInstrumentation
      })
    ],

    // Sample rate for performance monitoring
    tracesSampleRate: 1.0,

    // Filter sensitive data
    beforeSend(event) {
      // Remove sensitive information
      if (event.request?.headers?.Authorization) {
        delete event.request.headers.Authorization;
      }
      return event;
    },

    // Ignore specific errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured'
    ]
  });
}

// Set user context
export const setUser = (user: User) => {
  Sentry.user.set({
    id: user.id,
    email: user.email,
    username: user.username
  });
};

// Clear user on logout
export const clearUser = () => {
  Sentry.user.set(null);
};

// Add breadcrumbs
export const addBreadcrumb = (message: string, data?: any) => {
  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info'
  });
};

// Capture exceptions
export const captureException = (error: Error, context?: any) => {
  Sentry.captureException(error, {
    extra: context
  });
};

// Capture messages
export const captureMessage = (message: string, level: Sentry.SeverityLevel = 'info') => {
  Sentry.captureMessage(message, level);
};
```

### New Relic Integration

```typescript
// main.tsx
import { newrelic } from 'new-relic-browser';

if (import.meta.env.PROD) {
  newrelic.start({
    accountID: import.meta.env.VITE_NR_ACCOUNT_ID,
    trustKey: import.meta.env.VITE_NR_TRUST_KEY,
    agentID: import.meta.env.VITE_NR_AGENT_ID,
    licenseKey: import.meta.env.VITE_NR_LICENSE_KEY,
    applicationID: import.meta.env.VITE_NR_APP_ID
  });
}

// Custom events
export const trackEvent = (name: string, attributes?: Record<string, any>) => {
  if (window.newrelic) {
    window.newrelic.addPageAction(name, attributes);
  }
};

// Custom metrics
export const recordMetric = (name: string, value: number) => {
  if (window.newrelic) {
    window.newrelic.recordMetric(name, value);
  }
};
```

### Datadog RUM

```typescript
// app.tsx
import { datadogRum } from '@datadog/browser-rum';

if (import.meta.env.PROD) {
  datadogRum.init({
    applicationId: import.meta.env.VITE_DD_APP_ID,
    clientToken: import.meta.env.VITE_DD_CLIENT_TOKEN,
    site: 'datadoghq.com',
    service: 'nexus-app',
    env: import.meta.env.MODE,
    version: import.meta.env.VITE_APP_VERSION,

    // Session sampling
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,

    // Track user interactions
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,

    // Default privacy level
    defaultPrivacyLevel: 'mask-user-input'
  });

  datadogRum.startSessionReplayRecording();
}

// Track custom actions
export const trackAction = (name: string, context?: object) => {
  datadogRum.addAction(name, context);
};

// Track custom errors
export const trackError = (error: Error, context?: object) => {
  datadogRum.addError(error, context);
};
```

## Error Tracking

Capture and track errors in production.

### Error Boundary

```typescript
import { createSignal, JSX } from 'solid-js';
import { captureException } from './monitoring';

export const ErrorBoundary = (props: {
  fallback: (error: Error, reset: () => void) => JSX.Element;
  children: JSX.Element;
}) => {
  const [error, setError] = createSignal<Error | null>(null);

  const reset = () => {
    error.set(null);
  };

  onError((err: Error) => {
    console.error('Error caught by boundary:', err);
    captureException(err);
    error.set(err);
  });

  return (
    <>
      {error() ? props.fallback(error()!, reset) : props.children}
    </>
  );
};

// Usage
export default defineComponent(() => {
  return () => (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div class="error-page">
          <h1>Something went wrong</h1>
          <p>{error.message}</p>
          <button onClick={reset}>Try again</button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  );
});
```

### Global Error Handler

```typescript
// error-handler.ts
import { captureException, captureMessage } from './monitoring';

// Catch unhandled errors
window.addEventListener('error', (event) => {
  console.error('Unhandled error:', event.error);
  captureException(event.error, {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  captureException(new Error(event.reason), {
    type: 'unhandledRejection',
    promise: event.promise
  });
});

// Catch network errors
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  try {
    const response = await originalFetch(...args);

    if (!response.ok) {
      captureMessage(`HTTP ${response.status}: ${args[0]}`, 'warning');
    }

    return response;
  } catch (error) {
    captureException(error as Error, {
      url: args[0],
      options: args[1]
    });
    throw error;
  }
};
```

### Source Maps

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: true, // Generate source maps for production

    // Upload source maps to Sentry
    rollupOptions: {
      plugins: [
        sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: {
            assets: './dist/**'
          }
        })
      ]
    }
  }
});
```

## Real User Monitoring

Track real user interactions and performance.

### Vercel Analytics

```typescript
// app.tsx
import { inject } from '@vercel/analytics';

if (import.meta.env.PROD) {
  inject();
}

// Track custom events
import { track } from '@vercel/analytics';

export const trackEvent = (name: string, data?: Record<string, any>) => {
  track(name, data);
};

// Usage
const handlePurchase = () => {
  trackEvent('purchase', {
    value: cart.total,
    items: cart.items.length
  });
};
```

### Google Analytics 4

```typescript
// analytics.ts
import ReactGA from 'react-ga4';

if (import.meta.env.PROD) {
  ReactGA.initialize(import.meta.env.VITE_GA_MEASUREMENT_ID);
}

// Track page views
export const trackPageView = (path: string) => {
  ReactGA.send({ hitType: 'pageview', page: path });
};

// Track events
export const trackEvent = (category: string, action: string, label?: string, value?: number) => {
  ReactGA.event({
    category,
    action,
    label,
    value
  });
};

// Track timing
export const trackTiming = (category: string, variable: string, value: number, label?: string) => {
  ReactGA.send({
    hitType: 'timing',
    timingCategory: category,
    timingVar: variable,
    timingValue: value,
    timingLabel: label
  });
};

// E-commerce tracking
export const trackPurchase = (transaction: {
  id: string;
  revenue: number;
  items: Array<{ id: string; name: string; price: number; quantity: number }>;
}) => {
  ReactGA.event('purchase', {
    transaction_id: transaction.id,
    value: transaction.revenue,
    items: transaction.items
  });
};
```

### Plausible Analytics

```typescript
// Lightweight, privacy-friendly analytics
// Add script to index.html
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>

// Track custom events
declare global {
  interface Window {
    plausible: (event: string, options?: { props: Record<string, any> }) => void;
  }
}

export const trackEvent = (event: string, props?: Record<string, any>) => {
  if (window.plausible) {
    window.plausible(event, { props });
  }
};

// Usage
trackEvent('Signup', { method: 'email' });
trackEvent('Purchase', { value: 99.99, items: 3 });
```

## Web Vitals

Track Core Web Vitals for performance monitoring.

### Web Vitals Tracking

```typescript
// web-vitals.ts
import { onCLS, onFID, onFCP, onLCP, onTTFB, onINP, Metric } from 'web-vitals';

// Send to analytics
const sendToAnalytics = (metric: Metric) => {
  // Send to your analytics endpoint
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      delta: metric.delta,
      rating: metric.rating,
      navigationType: metric.navigationType
    })
  }).catch(console.error);

  // Also send to Sentry
  if (window.Sentry) {
    window.Sentry.captureMessage(`Web Vital: ${metric.name}`, {
      level: metric.rating === 'good' ? 'info' : 'warning',
      extra: {
        value: metric.value,
        rating: metric.rating
      }
    });
  }
};

// Track all Core Web Vitals
export const initWebVitals = () => {
  onCLS(sendToAnalytics);  // Cumulative Layout Shift
  onFID(sendToAnalytics);  // First Input Delay (deprecated, use INP)
  onINP(sendToAnalytics);  // Interaction to Next Paint
  onFCP(sendToAnalytics);  // First Contentful Paint
  onLCP(sendToAnalytics);  // Largest Contentful Paint
  onTTFB(sendToAnalytics); // Time to First Byte
};

// Initialize in app
if (import.meta.env.PROD) {
  initWebVitals();
}
```

### Web Vitals Dashboard

```typescript
// Track and display Web Vitals in development
export const WebVitalsDebugger = defineComponent(() => {
  const vitals = signal<Metric[]>([]);

  onMount(() => {
    const track = (metric: Metric) => {
      vitals.set([...vitals(), metric]);
    };

    onCLS(track);
    onFID(track);
    onINP(track);
    onFCP(track);
    onLCP(track);
    onTTFB(track);
  });

  return () => (
    <Show when={import.meta.env.DEV}>
      <div class="web-vitals-debugger">
        <h3>Web Vitals</h3>
        <For each={vitals()}>
          {(metric) => (
            <div class={`metric metric-${metric.rating}`}>
              <span class="name">{metric.name}</span>
              <span class="value">{metric.value.toFixed(2)}ms</span>
              <span class="rating">{metric.rating}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
});
```

## Custom Metrics

Track custom application metrics.

### Performance Metrics

```typescript
// metrics.ts
export class PerformanceMetrics {
  private metrics: Map<string, number[]> = new Map();

  // Measure execution time
  measure<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = performance.now() - start;
      this.record(name, duration);
    }
  }

  // Measure async execution time
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      const duration = performance.now() - start;
      this.record(name, duration);
    }
  }

  // Record metric value
  record(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);

    // Send to monitoring service
    this.sendMetric(name, value);
  }

  // Get statistics
  getStats(name: string) {
    const values = this.metrics.get(name) || [];
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  // Clear metrics
  clear(name?: string) {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }

  private sendMetric(name: string, value: number) {
    // Send to your monitoring service
    fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value, timestamp: Date.now() })
    }).catch(() => {
      // Silently fail
    });
  }
}

export const metrics = new PerformanceMetrics();

// Usage
const data = await metrics.measureAsync('api.fetchUser', () =>
  fetch('/api/user').then(r => r.json())
);

metrics.record('cart.items', cart.items.length);
metrics.record('search.results', searchResults.length);
```

### Business Metrics

```typescript
// Track business-specific metrics
export const businessMetrics = {
  // Track conversions
  trackConversion(type: string, value?: number) {
    this.track('conversion', { type, value });
  },

  // Track feature usage
  trackFeatureUsage(feature: string) {
    this.track('feature_usage', { feature });
  },

  // Track user engagement
  trackEngagement(action: string, duration?: number) {
    this.track('engagement', { action, duration });
  },

  // Track errors by category
  trackErrorCategory(category: string, error: string) {
    this.track('error_category', { category, error });
  },

  // Generic tracking
  track(event: string, data: Record<string, any>) {
    // Send to analytics
    if (window.gtag) {
      window.gtag('event', event, data);
    }

    // Send to your backend
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data, timestamp: Date.now() })
    }).catch(() => {});
  }
};

// Usage
businessMetrics.trackConversion('purchase', 99.99);
businessMetrics.trackFeatureUsage('dark_mode');
businessMetrics.trackEngagement('video_watch', 120);
```

## Distributed Tracing

Track requests across services.

### OpenTelemetry

```typescript
// opentelemetry.ts
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Create tracer provider
const provider = new WebTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'nexus-app',
    [SemanticResourceAttributes.SERVICE_VERSION]: import.meta.env.VITE_APP_VERSION
  })
});

// Configure exporter
const exporter = new OTLPTraceExporter({
  url: 'https://api.honeycomb.io/v1/traces',
  headers: {
    'x-honeycomb-team': import.meta.env.VITE_HONEYCOMB_API_KEY
  }
});

// Add span processor
provider.addSpanProcessor(new BatchSpanProcessor(exporter));

// Register the provider
provider.register({
  contextManager: new ZoneContextManager()
});

// Auto-instrument fetch and XHR
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/api\.example\.com/],
      clearTimingResources: true
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [/api\.example\.com/]
    })
  ]
});

// Create custom spans
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('nexus-app');

export const traceOperation = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const span = tracer.startSpan(name);

  try {
    const result = await fn();
    span.status.set({ code: 0 }); // OK
    return result;
  } catch (error) {
    span.status.set({ code: 2, message: error.message }); // ERROR
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
};

// Usage
const user = await traceOperation('fetchUser', async () => {
  return await fetch('/api/user').then(r => r.json());
});
```

## Logging

Structured logging for debugging and analysis.

### Console Logging

```typescript
// logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private context: Record<string, any> = {};

  setContext(context: Record<string, any>) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  private log(level: LogLevel, message: string, data?: any) {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: this.context,
      data
    };

    // Log to console
    console[level](message, entry);

    // Send to logging service in production
    if (import.meta.env.PROD) {
      this.sendLog(entry);
    }
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | any) {
    this.log('error', message, {
      error: error?.message,
      stack: error?.stack,
      ...error
    });
  }

  private async sendLog(entry: any) {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    } catch {
      // Silently fail
    }
  }
}

export const logger = new Logger();

// Usage
logger.setContext({ userId: '123', session: 'abc' });
logger.info('User logged in');
logger.error('Failed to save', new Error('Database error'));
```

### Better Stack (Logtail)

```typescript
// logtail.ts
import { Logtail } from '@logtail/browser';

const logtail = new Logtail(import.meta.env.VITE_LOGTAIL_TOKEN);

export const logger = {
  debug: (message: string, context?: object) => {
    logtail.debug(message, context);
  },

  info: (message: string, context?: object) => {
    logtail.info(message, context);
  },

  warn: (message: string, context?: object) => {
    logtail.warn(message, context);
  },

  error: (message: string, error?: Error, context?: object) => {
    logtail.error(message, { error: error?.message, stack: error?.stack, ...context });
  }
};
```

## Alerting

Set up alerts for critical issues.

### Alert Configuration

```typescript
// alerts.config.ts
export const alertsConfig = {
  // Error rate threshold
  errorRate: {
    threshold: 5, // % errors
    window: '5m',
    channels: ['email', 'slack']
  },

  // Response time threshold
  responseTime: {
    threshold: 1000, // ms
    percentile: 95,
    window: '10m',
    channels: ['slack']
  },

  // Availability threshold
  availability: {
    threshold: 99.9, // %
    window: '1h',
    channels: ['email', 'pagerduty']
  },

  // Custom alerts
  custom: [
    {
      name: 'high_cart_abandonment',
      condition: 'cart_abandonments > 50',
      window: '1h',
      channels: ['slack']
    },
    {
      name: 'failed_payments',
      condition: 'payment_failures > 10',
      window: '15m',
      channels: ['email', 'pagerduty']
    }
  ]
};

// Send alert
export const sendAlert = async (alert: {
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  data?: any;
}) => {
  // Send to alerting service
  await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(alert)
  });
};

// Usage
if (errorRate > 5) {
  sendAlert({
    severity: 'critical',
    title: 'High Error Rate',
    message: `Error rate is ${errorRate}%, exceeding threshold of 5%`,
    data: { errorRate, threshold: 5 }
  });
}
```

### PagerDuty Integration

```typescript
// pagerduty.ts
export const triggerIncident = async (incident: {
  severity: 'info' | 'warning' | 'error' | 'critical';
  summary: string;
  source: string;
  details?: any;
}) => {
  await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token token=${import.meta.env.VITE_PAGERDUTY_TOKEN}`
    },
    body: JSON.stringify({
      routing_key: import.meta.env.VITE_PAGERDUTY_ROUTING_KEY,
      event_action: 'trigger',
      payload: {
        summary: incident.summary,
        severity: incident.severity,
        source: incident.source,
        custom_details: incident.details
      }
    })
  });
};

// Usage
triggerIncident({
  severity: 'critical',
  summary: 'Database connection pool exhausted',
  source: 'nexus-app',
  details: {
    poolSize: 100,
    activeConnections: 100,
    waitingRequests: 50
  }
});
```

## Dashboards

Visualize metrics and logs.

### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "Nexus Application Dashboard",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{path}}"
          }
        ]
      },
      {
        "title": "Response Time (p95)",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "5xx errors"
          }
        ]
      },
      {
        "title": "Active Users",
        "type": "stat",
        "targets": [
          {
            "expr": "active_users"
          }
        ]
      }
    ]
  }
}
```

### Custom Dashboard

```typescript
// dashboard.tsx
import { defineComponent, signal, onMount } from '@nexus/core';
import { Chart } from 'chart.js';

export const MonitoringDashboard = defineComponent(() => {
  const metrics = signal<any>(null);
  let chartRef: HTMLCanvasElement;

  onMount(async () => {
    // Fetch metrics
    const data = await fetch('/api/metrics').then(r => r.json());
    metrics.set(data);

    // Create chart
    new Chart(chartRef, {
      type: 'line',
      data: {
        labels: data.timestamps,
        datasets: [{
          label: 'Response Time (ms)',
          data: data.responseTimes,
          borderColor: 'rgb(75, 192, 192)'
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });

    // Auto-refresh every 30 seconds
    const interval = setInterval(async () => {
      const newData = await fetch('/api/metrics').then(r => r.json());
      metrics.set(newData);
    }, 30000);

    onCleanup(() => clearInterval(interval));
  });

  return () => (
    <div class="dashboard">
      <h1>Application Metrics</h1>

      <div class="stats">
        <div class="stat">
          <h3>Requests/min</h3>
          <p>{metrics()?.requestsPerMinute || 0}</p>
        </div>
        <div class="stat">
          <h3>Avg Response Time</h3>
          <p>{metrics()?.avgResponseTime || 0}ms</p>
        </div>
        <div class="stat">
          <h3>Error Rate</h3>
          <p>{metrics()?.errorRate || 0}%</p>
        </div>
        <div class="stat">
          <h3>Active Users</h3>
          <p>{metrics()?.activeUsers || 0}</p>
        </div>
      </div>

      <div class="chart">
        <canvas ref={chartRef}></canvas>
      </div>
    </div>
  );
});
```

## Analytics

User behavior and product analytics.

### Mixpanel

```typescript
// mixpanel.ts
import mixpanel from 'mixpanel-browser';

if (import.meta.env.PROD) {
  mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN);
}

export const analytics = {
  identify: (userId: string, traits?: object) => {
    mixpanel.identify(userId);
    if (traits) {
      mixpanel.people.set(traits);
    }
  },

  track: (event: string, properties?: object) => {
    mixpanel.track(event, properties);
  },

  trackPageView: (path: string) => {
    mixpanel.track('Page View', { path });
  },

  reset: () => {
    mixpanel.reset();
  }
};

// Usage
analytics.identify('user-123', {
  name: 'Alice',
  email: 'alice@example.com',
  plan: 'pro'
});

analytics.track('Purchase', {
  product: 'Pro Plan',
  value: 99.99
});
```

### Amplitude

```typescript
// amplitude.ts
import * as amplitude from '@amplitude/analytics-browser';

if (import.meta.env.PROD) {
  amplitude.init(import.meta.env.VITE_AMPLITUDE_API_KEY, {
    defaultTracking: {
      sessions: true,
      pageViews: true,
      formInteractions: true,
      fileDownloads: true
    }
  });
}

export const analytics = {
  setUserId: (userId: string) => {
    amplitude.userId.set(userId);
  },

  track: (event: string, properties?: object) => {
    amplitude.track(event, properties);
  },

  identify: (traits: object) => {
    const identifyEvent = new amplitude.Identify();
    Object.entries(traits).forEach(([key, value]) => {
      identifyEvent.set(key, value);
    });
    amplitude.identify(identifyEvent);
  }
};
```

## Synthetic Monitoring

Proactively monitor application availability.

### Uptime Monitoring

```typescript
// Set up with UptimeRobot, Pingdom, or similar

// Health check endpoint
// server.ts
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.APP_VERSION
  });
});

// Deep health check
app.get('/health/deep', async (req, res) => {
  try {
    // Check database
    await db.$queryRaw`SELECT 1`;

    // Check Redis
    await redis.ping();

    // Check external APIs
    const apiStatus = await fetch('https://api.external.com/health')
      .then(r => r.ok)
      .catch(() => false);

    res.status(200).json({
      status: 'healthy',
      checks: {
        database: 'ok',
        redis: 'ok',
        externalApi: apiStatus ? 'ok' : 'degraded'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```

### Synthetic Transactions

```typescript
// Use Playwright for synthetic monitoring
import { test, expect } from '@playwright/test';

test('critical user flow', async ({ page }) => {
  // Navigate to homepage
  await page.goto('https://myapp.com');
  await expect(page).toHaveTitle(/My App/);

  // Login
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/dashboard/);

  // Perform action
  await page.click('text=Create New');
  await page.fill('[name="title"]', 'Test Item');
  await page.click('button:has-text("Save")');
  await expect(page.locator('.success-message')).toBeVisible();

  // Measure performance
  const performanceMetrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      domContentLoaded: navigation.domContentLoadedEventEnd,
      loadComplete: navigation.loadEventEnd,
      responseTime: navigation.responseEnd - navigation.requestStart
    };
  });

  // Assert performance
  expect(performanceMetrics.responseTime).toBeLessThan(1000);
});
```

## Performance Profiling

Profile application performance.

### React DevTools Profiler

```typescript
import { Profiler } from 'react';

const onRenderCallback = (
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) => {
  console.log(`${id} (${phase}) took ${actualDuration}ms`);

  // Send to analytics
  if (actualDuration > 16) { // Longer than 1 frame
    metrics.record(`component.${id}.render`, actualDuration);
  }
};

export default () => (
  <Profiler id="App" onRender={onRenderCallback}>
    <App />
  </Profiler>
);
```

### Performance Observer

```typescript
// Observe long tasks
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) { // Long task threshold
      console.warn('Long task detected:', entry);
      metrics.record('longtask', entry.duration);
    }
  }
});

observer.observe({ entryTypes: ['longtask'] });

// Observe layout shifts
const clsObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.hadRecentInput) continue; // Ignore user-initiated shifts

    console.warn('Layout shift:', entry);
    metrics.record('cls', entry.value);
  }
});

clsObserver.observe({ entryTypes: ['layout-shift'] });
```

## Titan Integration

Monitor Titan backend alongside Nexus frontend.

### Unified Monitoring

```typescript
// Shared monitoring configuration
// packages/shared/monitoring.ts

export const monitoringConfig = {
  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.APP_VERSION
  },

  metrics: {
    endpoint: process.env.METRICS_ENDPOINT
  }
};

// Frontend (Nexus)
import * as Sentry from '@sentry/browser';
Sentry.init(monitoringConfig.sentry);

// Backend (Titan)
import * as Sentry from '@sentry/node';
Sentry.init({
  ...monitoringConfig.sentry,
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express()
  ]
});
```

### End-to-End Tracing

```typescript
// Trace requests from frontend to backend

// Frontend
const traceId = generateTraceId();
fetch('/api/users', {
  headers: {
    'X-Trace-Id': traceId
  }
});

// Backend (Titan middleware)
@Injectable()
export class TracingMiddleware implements INexusMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const traceId = req.headers['x-trace-id'] || generateTraceId();
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);

    // Add to logger context
    logger.setContext({ traceId });

    next();
  }
}
```

## DevTools

Built-in development tools for monitoring.

### Nexus DevTools

```typescript
// Enable DevTools in development
if (import.meta.env.DEV) {
  import('@nexus/devtools').then(({ enableDevTools }) => {
    enableDevTools({
      // Component inspector
      inspector: true,

      // Performance monitor
      performance: true,

      // Network inspector
      network: true,

      // State debugger
      state: true,

      // Accessibility checker
      a11y: true
    });
  });
}

// Access DevTools API
if (window.__NEXUS_DEVTOOLS__) {
  // Inspect component tree
  window.__NEXUS_DEVTOOLS__.inspectComponent(componentInstance);

  // Time-travel debugging
  window.__NEXUS_DEVTOOLS__.timeTravel(-5); // Go back 5 state changes

  // Performance metrics
  const metrics = window.__NEXUS_DEVTOOLS__.getPerformanceMetrics();
}
```

## Best Practices

### Monitoring Strategy

```typescript
/**
 * Monitoring Best Practices:
 *
 * 1. Layer Your Monitoring
 *    - Metrics: High-level health (response time, error rate)
 *    - Logs: Detailed events and debugging
 *    - Traces: Request flow through system
 *
 * 2. Define SLIs and SLOs
 *    - SLI (Service Level Indicator): Metric you measure
 *    - SLO (Service Level Objective): Target for SLI
 *    - Example: "99.9% of requests complete in < 500ms"
 *
 * 3. Alert on Symptoms, Not Causes
 *    - Alert on: "Users experiencing slow response times"
 *    - Not: "CPU usage is high"
 *
 * 4. Reduce Alert Fatigue
 *    - Only alert on actionable issues
 *    - Use appropriate severity levels
 *    - Implement alert aggregation
 *
 * 5. Monitor User Experience
 *    - Track Core Web Vitals
 *    - Monitor real user interactions
 *    - Measure business metrics
 *
 * 6. Protect User Privacy
 *    - Anonymize sensitive data
 *    - Comply with GDPR/CCPA
 *    - Use session replay carefully
 *
 * 7. Set up Dashboards
 *    - Overview dashboard for quick health check
 *    - Detailed dashboards for deep dives
 *    - Business metrics dashboard
 *
 * 8. Test Your Monitoring
 *    - Verify alerts fire correctly
 *    - Test synthetic monitors
 *    - Practice incident response
 */
```

## Examples

### Complete Monitoring Setup

```typescript
// monitoring/index.ts
import * as Sentry from '@sentry/browser';
import { BrowserTracing } from '@sentry/tracing';
import { onCLS, onFID, onFCP, onLCP, onTTFB } from 'web-vitals';
import mixpanel from 'mixpanel-browser';

// Initialize Sentry
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  integrations: [new BrowserTracing()],
  tracesSampleRate: 1.0
});

// Initialize analytics
mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN);

// Track Web Vitals
const sendToAnalytics = (metric) => {
  mixpanel.track('Web Vital', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating
  });

  Sentry.captureMessage(`Web Vital: ${metric.name}`, {
    level: metric.rating === 'good' ? 'info' : 'warning',
    extra: { value: metric.value, rating: metric.rating }
  });
};

onCLS(sendToAnalytics);
onFID(sendToAnalytics);
onFCP(sendToAnalytics);
onLCP(sendToAnalytics);
onTTFB(sendToAnalytics);

// Error tracking
window.addEventListener('error', (event) => {
  Sentry.captureException(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  Sentry.captureException(event.reason);
});

// Export monitoring API
export const monitoring = {
  setUser: (user: User) => {
    Sentry.user.set({ id: user.id, email: user.email });
    mixpanel.identify(user.id);
    mixpanel.people.set({
      $email: user.email,
      $name: user.name
    });
  },

  trackEvent: (event: string, properties?: object) => {
    mixpanel.track(event, properties);
  },

  captureError: (error: Error, context?: object) => {
    Sentry.captureException(error, { extra: context });
  },

  captureMessage: (message: string, level: Sentry.SeverityLevel = 'info') => {
    Sentry.captureMessage(message, level);
  }
};
```

## Summary

Effective monitoring is essential for production applications:

1. **APM**: Application performance monitoring with Sentry, New Relic, or Datadog
2. **Error Tracking**: Capture and track errors in production
3. **RUM**: Real user monitoring for actual user experience
4. **Web Vitals**: Track Core Web Vitals (LCP, FID, CLS)
5. **Custom Metrics**: Track business and performance metrics
6. **Distributed Tracing**: Track requests across services with OpenTelemetry
7. **Logging**: Structured logging for debugging
8. **Alerting**: Set up alerts for critical issues
9. **Dashboards**: Visualize metrics and trends
10. **Analytics**: Track user behavior and product usage

A comprehensive monitoring strategy combines metrics, logs, and traces to provide full observability.
