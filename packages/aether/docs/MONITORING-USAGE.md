# Aether Monitoring & Error Tracking - Usage Guide

## Overview

This guide provides comprehensive examples of using Aether's performance monitoring and error tracking capabilities in your applications.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Performance Monitoring](#performance-monitoring)
3. [Component Tracking](#component-tracking)
4. [Signal Tracking](#signal-tracking)
5. [Memory Profiling](#memory-profiling)
6. [Network Monitoring](#network-monitoring)
7. [Error Tracking](#error-tracking)
8. [DevTools Enhancements](#devtools-enhancements)
9. [Production Setup](#production-setup)
10. [Best Practices](#best-practices)

## Getting Started

### Installation

The monitoring system is included in `@aether/core`. No additional packages required.

### Basic Setup

```typescript
import {
  getPerformanceMonitor,
  getComponentTracker,
  getSignalTracker,
  getPerformanceDashboard,
} from '@aether/monitoring';

// Enable monitoring in development
if (import.meta.env.DEV) {
  const perfMonitor = getPerformanceMonitor({
    enabled: true,
    budget: {
      maxRenderTime: 16, // 16ms for 60fps
      maxSignalUpdateTime: 1,
      maxEffectTime: 5,
    },
    onViolation: (violation) => {
      console.warn('Performance budget exceeded:', violation);
    },
  });

  const componentTracker = getComponentTracker({
    enabled: true,
    trackProps: true,
    trackEffects: true,
  });

  const signalTracker = getSignalTracker({
    enabled: true,
    detectCircular: true,
  });
}
```

## Performance Monitoring

### Manual Performance Tracking

```typescript
import { mark, measure } from '@aether/monitoring';

function expensiveOperation() {
  mark('operation-start');
  
  // Perform expensive work
  const data = processData();
  
  mark('operation-end');
  const result = measure('operation', 'operation-start', 'operation-end');
  
  console.log(`Operation took ${result?.duration}ms`);
  return data;
}
```

### Component Performance Tracking

```typescript
import { defineComponent } from '@aether/core';
import { getComponentTracker } from '@aether/monitoring';

const MyComponent = defineComponent((props) => {
  const tracker = getComponentTracker();
  
  onMount(() => {
    tracker.trackMount('MyComponent', props);
    
    return () => {
      tracker.trackUnmount('MyComponent');
    };
  });
  
  return () => {
    tracker.trackRenderStart('MyComponent');
    
    const view = (
      <div>Component Content</div>
    );
    
    tracker.trackRenderEnd('MyComponent');
    return view;
  };
});
```

### Performance Budget Monitoring

```typescript
import { getPerformanceMonitor } from '@aether/monitoring';

const monitor = getPerformanceMonitor({
  budget: {
    maxRenderTime: 16,
    maxSignalUpdateTime: 1,
    maxEffectTime: 5,
    maxNetworkTime: 500,
    custom: {
      'heavy-computation': 50,
      'data-fetch': 200,
    },
  },
  onViolation: (violation) => {
    // Send to analytics
    sendToAnalytics({
      type: 'performance-violation',
      ...violation,
    });
  },
});
```

## Component Tracking

### Track Component Lifecycle

```typescript
import { defineComponent, onMount } from '@aether/core';
import { getComponentTracker } from '@aether/monitoring';

const TrackedComponent = defineComponent((props) => {
  const tracker = getComponentTracker();
  const componentName = 'TrackedComponent';
  
  onMount(() => {
    tracker.trackMount(componentName, props);
    
    // Track render
    tracker.trackRenderStart(componentName);
    
    return () => {
      tracker.trackUnmount(componentName);
    };
  });
  
  // Track props changes
  effect(() => {
    const newProps = { ...props };
    tracker.trackPropsChange(
      componentName,
      Object.keys(newProps),
      {},
      newProps
    );
  });
  
  return () => {
    const view = <div>Content</div>;
    tracker.trackRenderEnd(componentName);
    return view;
  };
});
```

### Get Component Statistics

```typescript
import { getComponentTracker } from '@aether/monitoring';

const tracker = getComponentTracker();

// Get stats for specific component
const stats = tracker.getComponentStats('MyComponent');
console.log('Render count:', stats?.totalRenders);
console.log('Average duration:', stats?.averageRenderDuration);

// Get top re-rendering components
const topRerendering = tracker.getTopRerenderingComponents(10);
console.log('Most re-rendered:', topRerendering);

// Get slowest components
const slowest = tracker.getSlowestComponents(10);
console.log('Slowest components:', slowest);
```

## Signal Tracking

### Track Signal Updates

```typescript
import { signal } from '@aether/core';
import { getSignalTracker } from '@aether/monitoring';

const tracker = getSignalTracker({
  enabled: true,
  trackValues: true,
  detectCircular: true,
  onCircularDetected: (cycle) => {
    console.error('Circular dependency detected:', cycle);
  },
  onExcessiveUpdates: (signalId, count) => {
    console.warn(`Signal ${signalId} updated ${count} times in 1 second`);
  },
});

// Track signal creation
const count = signal(0);
const signalId = tracker.trackSignalCreation('count');

// Signals are automatically tracked
count.set(1); // Tracked by the system
```

### Analyze Signal Dependencies

```typescript
import { getSignalTracker } from '@aether/monitoring';

const tracker = getSignalTracker();

// Get dependency graph
const graph = tracker.getDependencyGraph();
console.log('Total signals:', graph.size);

// Visualize dependencies
const visualization = tracker.visualizeDependencyGraph();
console.log('Nodes:', visualization.nodes);
console.log('Edges:', visualization.edges);

// Check for circular dependencies
const circular = tracker.getCircularDependencies();
if (circular.length > 0) {
  console.error('Found circular dependencies:', circular);
}

// Get most active signals
const mostUpdated = tracker.getMostUpdatedSignals(10);
console.log('Most updated signals:', mostUpdated);
```

## Memory Profiling

### Basic Memory Tracking

```typescript
import { getMemoryProfiler } from '@aether/monitoring';

const profiler = getMemoryProfiler({
  enabled: true,
  snapshotInterval: 5000,
  leakDetectionThreshold: 0.1,
  onLeakDetected: (leak) => {
    console.error('Memory leak detected:', leak);
  },
});

// Take manual snapshot
const snapshot = profiler.takeSnapshot();
console.log('Memory usage:', snapshot?.usedJSHeapSize);
console.log('Memory percentage:', snapshot?.percentage);

// Track component memory
profiler.trackComponent('MyComponent', 10, 5); // 10 DOM nodes, 5 listeners

// Get metrics
const snapshots = profiler.getSnapshots();
const domNodes = profiler.getTotalDOMNodes();
const listeners = profiler.getTotalEventListeners();
```

### Detect Memory Leaks

```typescript
import { getMemoryProfiler } from '@aether/monitoring';

const profiler = getMemoryProfiler({
  leakDetectionThreshold: 0.15, // 15% growth
  onLeakDetected: (leak) => {
    // Send alert
    sendAlert({
      type: 'memory-leak',
      description: leak.description,
      growthRate: leak.growthRate,
    });
  },
});

// Monitor specific component
class ComponentWithCleanup {
  constructor() {
    profiler.trackComponent('ComponentWithCleanup', 5, 3);
  }
  
  dispose() {
    profiler.untrackComponent('ComponentWithCleanup');
  }
}
```

## Network Monitoring

### Track Network Requests

```typescript
import { getNetworkMonitor } from '@aether/monitoring';

const monitor = getNetworkMonitor({
  enabled: true,
  slowRequestThreshold: 1000,
  onSlowRequest: (request) => {
    console.warn('Slow request:', request);
  },
  onFailedRequest: (request) => {
    console.error('Failed request:', request);
  },
});

// Track fetch request
async function fetchData(url: string) {
  const requestId = monitor.trackRequestStart(url, 'GET');
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    monitor.trackRequestEnd(
      requestId,
      response.status,
      response.statusText,
      JSON.stringify(data).length
    );
    
    return data;
  } catch (error) {
    monitor.trackRequestError(requestId, error as Error);
    throw error;
  }
}
```

### Network Statistics

```typescript
import { getNetworkMonitor } from '@aether/monitoring';

const monitor = getNetworkMonitor();

// Get statistics
const stats = monitor.getStats();
console.log('Total requests:', stats.totalRequests);
console.log('Success rate:', (stats.successfulRequests / stats.totalRequests) * 100);
console.log('Cache hit rate:', monitor.getCacheHitRate());
console.log('Average duration:', stats.averageDuration);

// Get slow requests
const slowRequests = monitor.getSlowRequests(500);
console.log('Requests slower than 500ms:', slowRequests);

// Get failed requests
const failed = monitor.getFailedRequests();
console.log('Failed requests:', failed);
```

## Error Tracking

### Basic Error Tracking

```typescript
import { getErrorReporter } from '@aether/error-tracking';

const reporter = getErrorReporter({
  dsn: 'https://your-sentry-dsn',
  environment: 'production',
  release: '1.0.0',
  integration: 'sentry',
  beforeSend: (event) => {
    // Filter sensitive data
    if (event.extra?.password) {
      delete event.extra.password;
    }
    return event;
  },
});

// Set user context
reporter.setUser({
  id: 'user-123',
  username: 'john_doe',
  email: 'john@example.com',
});

// Set tags
reporter.setTag('environment', 'production');
reporter.setTag('version', '1.0.0');

// Capture error
try {
  throw new Error('Something went wrong');
} catch (error) {
  reporter.captureError(error as Error, {
    feature: 'checkout',
    step: 'payment',
  });
}
```

### Error Analytics

```typescript
import { getErrorAnalytics } from '@aether/error-tracking';

const analytics = getErrorAnalytics({
  enabled: true,
  trendWindow: 3600000, // 1 hour
});

// Track errors
analytics.trackError('TypeError:undefined', 'user-123', 'checkout');

// Get insights
const topErrors = analytics.getTopErrors(10);
console.log('Most common errors:', topErrors);

const increasing = analytics.getIncreasingErrors();
console.log('Errors with increasing trend:', increasing);

const affectedUsers = analytics.getMostAffectedUsers(10);
console.log('Most affected users:', affectedUsers);

const trends = analytics.getTrends();
console.log('Error trends:', trends);

const errorRate = analytics.getErrorRate();
console.log('Current error rate:', errorRate, 'errors/sec');
```

### Production Monitoring

```typescript
import {
  getProductionMonitor,
  createDefaultAlertRules,
} from '@aether/error-tracking';

const monitor = getProductionMonitor({
  enabled: true,
  sampleRate: 0.1, // Sample 10% in production
  errorThreshold: 10,
  criticalThreshold: 5,
  alertRules: [
    ...createDefaultAlertRules(),
    {
      name: 'custom-alert',
      condition: (metrics) => metrics.uniqueErrors > 50,
      action: (metrics) => {
        // Send to monitoring service
        sendToMonitoring({
          alert: 'too-many-unique-errors',
          count: metrics.uniqueErrors,
        });
      },
      cooldown: 300000, // 5 minutes
    },
  ],
});

// Get current metrics
const metrics = monitor.getMetrics();
console.log('Production metrics:', metrics);

// Check session errors
const sessionErrors = monitor.getSessionErrors();
console.log('Errors in this session:', sessionErrors);
```

## DevTools Enhancements

### Performance Overlay

```typescript
import { getPerformanceOverlay } from '@aether/devtools/enhancements';

const overlay = getPerformanceOverlay({
  enabled: import.meta.env.DEV,
  position: 'top-right',
  showRenderTimes: true,
  showUpdateFrequency: true,
  showMemoryUsage: true,
  highlightSlowRenders: true,
  slowRenderThreshold: 16,
});

// Control visibility
overlay.show();
overlay.hide();
```

### State Diff Viewer

```typescript
import { getStateDiffViewer } from '@aether/devtools/enhancements';

const diffViewer = getStateDiffViewer({
  enabled: true,
  maxDiffs: 100,
  autoExpand: false,
});

// Track state changes
const count = signal(0);
effect(() => {
  const prev = count.peek();
  const next = count();
  diffViewer.trackChange('count', prev, next);
});

// View diffs
const diffs = diffViewer.getDiffs();
console.log('State changes:', diffs);

// Format diff
const formatted = diffViewer.formatDiff(diffs[0]);
console.log(formatted);
```

### Action Replay

```typescript
import { getActionReplaySystem } from '@aether/devtools/enhancements';

const replay = getActionReplaySystem({
  enabled: true,
  recordClicks: true,
  recordInputs: true,
  recordKeypress: true,
});

// Start recording
replay.startRecording();

// User interactions are automatically recorded...

// Stop recording
replay.stopRecording();

// Export actions
const actions = replay.exportActions();
localStorage.setItem('recorded-actions', actions);

// Import and replay
const savedActions = localStorage.getItem('recorded-actions');
if (savedActions) {
  replay.importActions(savedActions);
  await replay.replay(1.0); // Play at normal speed
}
```

### Network Inspector

```typescript
import { getNetworkInspector } from '@aether/devtools/enhancements';

const inspector = getNetworkInspector({
  enabled: true,
  position: 'bottom',
  height: 300,
});

// Get requests (reactive)
effect(() => {
  const requests = inspector.getRequests();
  console.log('Network requests:', requests);
});

// Select request for details
inspector.selectRequest('req-123');

// Get selected request details (reactive)
effect(() => {
  const details = inspector.getSelectedRequestDetails();
  if (details) {
    console.log('Request details:', inspector.formatRequest(details));
  }
});

// Filter requests
inspector.setFilter('api');
```

### Console Integration

```typescript
import { getConsoleIntegration } from '@aether/devtools/enhancements';

const console = getConsoleIntegration({
  enabled: true,
  maxMessages: 1000,
  captureStackTrace: true,
  groupByComponent: true,
});

// Console messages are automatically captured...

// Get messages
const messages = console.getMessages();
console.log('All console messages:', messages);

// Filter by level
const errors = console.getMessagesByLevel('error');
console.log('Error messages:', errors);

// Filter by component
const componentMessages = console.getMessagesByComponent('MyComponent');
console.log('Messages from MyComponent:', componentMessages);

// Clear messages
console.clearMessages();
```

## Production Setup

### Recommended Configuration

```typescript
// config/monitoring.ts
import {
  getPerformanceMonitor,
  getErrorReporter,
  getProductionMonitor,
} from '@aether/monitoring';

export function setupMonitoring() {
  const isProduction = import.meta.env.PROD;
  const isDevelopment = import.meta.env.DEV;
  
  if (isDevelopment) {
    // Enable all monitoring in development
    getPerformanceMonitor({
      enabled: true,
      budget: {
        maxRenderTime: 16,
        maxSignalUpdateTime: 1,
      },
      onViolation: console.warn,
    });
  }
  
  if (isProduction) {
    // Error tracking in production
    getErrorReporter({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: 'production',
      release: import.meta.env.VITE_APP_VERSION,
      integration: 'sentry',
      beforeSend: (event) => {
        // Sanitize sensitive data
        return sanitizeEvent(event);
      },
    });
    
    // Production monitoring with sampling
    getProductionMonitor({
      enabled: true,
      sampleRate: 0.1, // 10% sampling
      errorThreshold: 10,
      criticalThreshold: 5,
    });
  }
}
```

## Best Practices

### 1. Use Sampling in Production

```typescript
const monitor = getPerformanceMonitor({
  enabled: Math.random() < 0.1, // 10% sampling
});
```

### 2. Disable Detailed Tracking in Production

```typescript
const tracker = getComponentTracker({
  enabled: import.meta.env.DEV,
  trackProps: import.meta.env.DEV,
  trackEffects: import.meta.env.DEV,
});
```

### 3. Set Performance Budgets

```typescript
const monitor = getPerformanceMonitor({
  budget: {
    maxRenderTime: 16, // 60fps
    maxSignalUpdateTime: 1,
    maxEffectTime: 5,
    maxNetworkTime: 500,
  },
});
```

### 4. Clean Up Resources

```typescript
import { onCleanup } from '@aether/core';

function MyComponent() {
  const profiler = getMemoryProfiler();
  
  profiler.trackComponent('MyComponent', 10, 5);
  
  onCleanup(() => {
    profiler.untrackComponent('MyComponent');
  });
}
```

### 5. Use Error Boundaries

```typescript
import { ErrorBoundary } from '@aether/core';
import { getErrorReporter } from '@aether/error-tracking';

function App() {
  const reporter = getErrorReporter();
  
  return (
    <ErrorBoundary
      fallback={ErrorFallback}
      onError={(error, info) => {
        reporter.captureError(error, info);
      }}
    >
      <Router />
    </ErrorBoundary>
  );
}
```

### 6. Monitor Critical Paths

```typescript
import { mark, measure } from '@aether/monitoring';

async function criticalOperation() {
  mark('critical-start');
  
  try {
    const result = await performOperation();
    mark('critical-end');
    
    const timing = measure('critical-path', 'critical-start', 'critical-end');
    
    if (timing && timing.duration > 100) {
      console.warn('Critical path exceeded budget:', timing.duration);
    }
    
    return result;
  } catch (error) {
    getErrorReporter().captureError(error as Error, {
      context: 'critical-operation',
    });
    throw error;
  }
}
```

## Conclusion

Aether's monitoring and error tracking system provides comprehensive insights into your application's performance and errors. Use these tools during development for debugging and in production for monitoring and analytics.

For more information, see the API documentation in each module.
