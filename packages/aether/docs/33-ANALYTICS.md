# 33. Analytics

## Table of Contents
- [Overview](#overview)
- [Google Analytics 4](#google-analytics-4)
- [Event Tracking](#event-tracking)
- [E-commerce Tracking](#e-commerce-tracking)
- [User Properties](#user-properties)
- [Conversion Tracking](#conversion-tracking)
- [Privacy and Consent](#privacy-and-consent)
- [Alternative Analytics](#alternative-analytics)
- [Custom Analytics](#custom-analytics)
- [A/B Testing](#ab-testing)
- [Debugging](#debugging)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

Analytics help you understand user behavior and improve your app.

### Why Analytics Matter

```typescript
/**
 * Analytics Benefits:
 *
 * 1. Understand Users
 *    - Who visits your app
 *    - Where they come from
 *    - What they do
 *
 * 2. Measure Performance
 *    - Page views
 *    - Session duration
 *    - Bounce rate
 *
 * 3. Track Conversions
 *    - Goals and funnels
 *    - E-commerce transactions
 *    - User journeys
 *
 * 4. Optimize Experience
 *    - Identify issues
 *    - Test improvements
 *    - Data-driven decisions
 *
 * 5. Business Insights
 *    - Revenue tracking
 *    - Customer lifetime value
 *    - ROI measurement
 */
```

### Analytics Tools

```typescript
/**
 * Popular Analytics Platforms:
 *
 * - Google Analytics 4 (free, comprehensive)
 * - Plausible (privacy-focused, simple)
 * - Fathom (privacy-focused)
 * - Mixpanel (product analytics)
 * - Amplitude (behavioral analytics)
 * - Segment (analytics hub)
 * - PostHog (open-source, self-hosted)
 * - Matomo (open-source)
 */
```

## Google Analytics 4

Most popular analytics platform.

### Setup

```bash
npm install react-ga4
# or
npm install gtag.js
```

```typescript
// analytics.ts
import ReactGA from 'react-ga4';

export const initializeAnalytics = () => {
  ReactGA.initialize(import.meta.env.VITE_GA_MEASUREMENT_ID, {
    gaOptions: {
      send_page_view: false // We'll handle this manually
    },
    gtagOptions: {
      anonymize_ip: true,
      cookie_flags: 'SameSite=None;Secure'
    }
  });
};

// Initialize in app
if (import.meta.env.PROD) {
  initializeAnalytics();
}
```

### Page View Tracking

```typescript
import { useLocation } from '@aether/router';
import ReactGA from 'react-ga4';

export const usePageTracking = () => {
  const location = useLocation();

  createEffect(() => {
    const path = location.pathname + location.search;

    // Track page view
    ReactGA.send({
      hitType: 'pageview',
      page: path,
      title: document.title
    });
  });
};

// Usage in app
export default defineComponent(() => {
  usePageTracking();

  return () => <Router />;
});
```

### Manual Setup (gtag.js)

```html
<!-- Add to index.html -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX', {
    send_page_view: false,
    anonymize_ip: true
  });
</script>
```

```typescript
// Helper function
export const gtag = (...args: any[]) => {
  if (window.dataLayer) {
    window.dataLayer.push(args);
  }
};

// Track page view
gtag('event', 'page_view', {
  page_path: window.location.pathname,
  page_title: document.title
});
```

## Event Tracking

Track user interactions.

### Basic Events

```typescript
import ReactGA from 'react-ga4';

// Track event
ReactGA.event({
  category: 'User',
  action: 'Sign Up',
  label: 'Email'
});

// With custom parameters
ReactGA.event({
  category: 'Video',
  action: 'Play',
  label: 'Tutorial Video',
  value: 5, // Video duration or position
  nonInteraction: false
});

// GA4 recommended events
ReactGA.event('sign_up', {
  method: 'email'
});

ReactGA.event('login', {
  method: 'google'
});

ReactGA.event('search', {
  search_term: 'nexus framework'
});

ReactGA.event('share', {
  method: 'twitter',
  content_type: 'article',
  item_id: 'post-123'
});
```

### Click Tracking

```typescript
export const Button = defineComponent((props: {
  onClick?: () => void;
  analyticsCategory?: string;
  analyticsLabel?: string;
}) => {
  const handleClick = () => {
    // Track click
    if (props.analyticsCategory) {
      ReactGA.event({
        category: props.analyticsCategory,
        action: 'Click',
        label: props.analyticsLabel
      });
    }

    // Execute handler
    props.onClick?.();
  };

  return () => (
    <button onClick={handleClick}>
      {props.children}
    </button>
  );
});

// Usage
<Button
  analyticsCategory="CTA"
  analyticsLabel="Sign Up"
  onClick={handleSignUp}
>
  Sign Up
</Button>
```

### Form Tracking

```typescript
export const ContactForm = defineComponent(() => {
  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    // Track form start
    ReactGA.event('form_start', {
      form_id: 'contact_form'
    });

    try {
      await submitForm(formData);

      // Track success
      ReactGA.event('form_submit', {
        form_id: 'contact_form',
        success: true
      });
    } catch (error) {
      // Track error
      ReactGA.event('form_submit', {
        form_id: 'contact_form',
        success: false,
        error_message: error.message
      });
    }
  };

  return () => (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
    </form>
  );
});
```

### Scroll Depth Tracking

```typescript
export const useScrollDepth = () => {
  const trackedDepths = new Set<number>();

  onMount(() => {
    const handleScroll = () => {
      const scrollPercent = Math.round(
        (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      );

      // Track at 25%, 50%, 75%, 100%
      [25, 50, 75, 100].forEach((depth) => {
        if (scrollPercent >= depth && !trackedDepths.has(depth)) {
          trackedDepths.add(depth);

          ReactGA.event('scroll_depth', {
            percent: depth,
            page: window.location.pathname
          });
        }
      });
    };

    window.addEventListener('scroll', handleScroll);
    onCleanup(() => window.removeEventListener('scroll', handleScroll));
  });
};

// Usage
export default defineComponent(() => {
  useScrollDepth();

  return () => <Article />;
});
```

## E-commerce Tracking

Track purchases and revenue.

### View Item

```typescript
ReactGA.event('view_item', {
  currency: 'USD',
  value: 99.99,
  items: [{
    item_id: 'SKU_12345',
    item_name: 'Aether Pro License',
    item_category: 'Software',
    price: 99.99,
    quantity: 1
  }]
});
```

### Add to Cart

```typescript
export const ProductCard = defineComponent((props: { product: Product }) => {
  const handleAddToCart = () => {
    // Add to cart
    addToCart(props.product);

    // Track event
    ReactGA.event('add_to_cart', {
      currency: 'USD',
      value: props.product.price,
      items: [{
        item_id: props.product.id,
        item_name: props.product.name,
        item_category: props.product.category,
        price: props.product.price,
        quantity: 1
      }]
    });
  };

  return () => (
    <button onClick={handleAddToCart}>Add to Cart</button>
  );
});
```

### Begin Checkout

```typescript
ReactGA.event('begin_checkout', {
  currency: 'USD',
  value: cart.total,
  items: cart.items.map(item => ({
    item_id: item.id,
    item_name: item.name,
    item_category: item.category,
    price: item.price,
    quantity: item.quantity
  }))
});
```

### Purchase

```typescript
export const handlePurchase = (order: Order) => {
  ReactGA.event('purchase', {
    transaction_id: order.id,
    value: order.total,
    currency: 'USD',
    tax: order.tax,
    shipping: order.shipping,
    items: order.items.map(item => ({
      item_id: item.id,
      item_name: item.name,
      item_category: item.category,
      price: item.price,
      quantity: item.quantity
    }))
  });
};
```

### Refund

```typescript
ReactGA.event('refund', {
  transaction_id: order.id,
  value: order.total,
  currency: 'USD'
});
```

## User Properties

Set custom user properties.

### User ID

```typescript
// Set user ID for cross-device tracking
ReactGA.set({ userId: user.id });

// Or during initialization
ReactGA.initialize(measurementId, {
  gaOptions: {
    userId: user.id
  }
});
```

### Custom Dimensions

```typescript
// Set user properties
ReactGA.set({
  user_properties: {
    account_type: 'premium',
    signup_date: '2024-01-15',
    preferred_language: 'en'
  }
});

// Set individual property
ReactGA.gtag('set', 'user_properties', {
  plan: 'pro',
  role: 'admin'
});
```

## Conversion Tracking

Track goals and conversions.

### Define Goals

```typescript
// Sign up conversion
export const trackSignupConversion = () => {
  ReactGA.event('sign_up', {
    method: 'email'
  });

  // Also track as conversion
  ReactGA.event('conversion', {
    send_to: 'AW-CONVERSION_ID/CONVERSION_LABEL',
    value: 0,
    currency: 'USD'
  });
};

// Purchase conversion
export const trackPurchaseConversion = (order: Order) => {
  ReactGA.event('purchase', {
    transaction_id: order.id,
    value: order.total,
    currency: 'USD'
  });

  // Google Ads conversion
  ReactGA.event('conversion', {
    send_to: 'AW-CONVERSION_ID/CONVERSION_LABEL',
    value: order.total,
    currency: 'USD',
    transaction_id: order.id
  });
};
```

### Funnel Tracking

```typescript
// Track funnel steps
export const trackFunnelStep = (step: string, data?: any) => {
  const funnelSteps = {
    view_product: 1,
    add_to_cart: 2,
    begin_checkout: 3,
    add_payment_info: 4,
    purchase: 5
  };

  ReactGA.event(step, {
    ...data,
    funnel_step: funnelSteps[step as keyof typeof funnelSteps]
  });
};

// Usage
trackFunnelStep('view_product', { item_id: 'SKU_123' });
trackFunnelStep('add_to_cart', { item_id: 'SKU_123' });
trackFunnelStep('begin_checkout', { value: 99.99 });
trackFunnelStep('purchase', { transaction_id: 'ORDER_123', value: 99.99 });
```

## Privacy and Consent

Respect user privacy and comply with regulations.

### Cookie Consent

```typescript
export const CookieConsent = defineComponent(() => {
  const accepted = signal(false);

  onMount(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (consent === 'accepted') {
      accepted.set(true);
      initializeAnalytics();
    }
  });

  const handleAccept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    accepted.set(true);

    // Initialize analytics after consent
    initializeAnalytics();

    // Update consent
    ReactGA.gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'granted'
    });
  };

  const handleReject = () => {
    localStorage.setItem('cookie-consent', 'rejected');
    accepted.set(false);

    // Deny consent
    ReactGA.gtag('consent', 'update', {
      analytics_storage: 'denied',
      ad_storage: 'denied'
    });
  };

  return () => (
    <Show when={!accepted()}>
      <div class="cookie-banner">
        <p>We use cookies to improve your experience.</p>
        <button onClick={handleAccept}>Accept</button>
        <button onClick={handleReject}>Reject</button>
      </div>
    </Show>
  );
});
```

### GDPR Compliance

```typescript
// Set default consent
ReactGA.gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  wait_for_update: 500
});

// Anonymize IP
ReactGA.initialize(measurementId, {
  gtagOptions: {
    anonymize_ip: true
  }
});

// Opt-out function
export const optOutAnalytics = () => {
  // Set opt-out cookie
  document.cookie = `ga-disable-${measurementId}=true; expires=Thu, 31 Dec 2099 23:59:59 UTC; path=/`;

  // Disable analytics
  (window as any)[`ga-disable-${measurementId}`] = true;
};
```

## Alternative Analytics

Privacy-focused alternatives.

### Plausible

```html
<!-- Add script to index.html -->
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

```typescript
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
trackEvent('Sign Up', { method: 'email' });
trackEvent('Purchase', { value: 99.99 });
```

### Fathom

```html
<script src="https://cdn.usefathom.com/script.js" data-site="YOUR-SITE-ID" defer></script>
```

```typescript
declare global {
  interface Window {
    fathom: {
      trackGoal: (goalId: string, value: number) => void;
      trackPageview: () => void;
    };
  }
}

export const trackGoal = (goalId: string, value: number = 0) => {
  if (window.fathom) {
    window.fathom.trackGoal(goalId, value);
  }
};

// Usage
trackGoal('SIGNUP_GOAL_ID', 0);
trackGoal('PURCHASE_GOAL_ID', 99.99);
```

### Mixpanel

```bash
npm install mixpanel-browser
```

```typescript
import mixpanel from 'mixpanel-browser';

mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN);

export const analytics = {
  track: (event: string, properties?: Record<string, any>) => {
    mixpanel.track(event, properties);
  },

  identify: (userId: string) => {
    mixpanel.identify(userId);
  },

  people: {
    set: (properties: Record<string, any>) => {
      mixpanel.people.set(properties);
    }
  },

  reset: () => {
    mixpanel.reset();
  }
};

// Usage
analytics.identify(user.id);
analytics.people.set({
  $email: user.email,
  $name: user.name,
  plan: 'pro'
});
analytics.track('Purchase', {
  product: 'Aether Pro',
  value: 99.99
});
```

## Custom Analytics

Build your own analytics.

### Basic Analytics

```typescript
// analytics.ts
class Analytics {
  private endpoint = '/api/analytics';

  track(event: string, data?: Record<string, any>) {
    const payload = {
      event,
      data,
      timestamp: Date.now(),
      url: window.location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      screenSize: `${window.screen.width}x${window.screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`
    };

    // Send beacon (works even when page is closing)
    if ('sendBeacon' in navigator) {
      navigator.sendBeacon(this.endpoint, JSON.stringify(payload));
    } else {
      fetch(this.endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      }).catch(() => {});
    }
  }

  pageView(path: string) {
    this.track('page_view', { path });
  }
}

export const analytics = new Analytics();
```

### Server-Side Analytics

```typescript
// server/analytics.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

export const trackEvent = async (event: {
  event: string;
  data?: any;
  userId?: string;
  sessionId?: string;
  timestamp: number;
  url: string;
  referrer?: string;
  userAgent?: string;
}) => {
  await supabase.from('analytics_events').insert({
    event_name: event.event,
    event_data: event.data,
    user_id: event.userId,
    session_id: event.sessionId,
    timestamp: new Date(event.timestamp),
    url: event.url,
    referrer: event.referrer,
    user_agent: event.userAgent
  });
};

// API endpoint
app.post('/api/analytics', async (req, res) => {
  await trackEvent(req.body);
  res.status(204).end();
});
```

## A/B Testing

Test variations and optimize conversions.

### Google Optimize

```html
<!-- Add Optimize snippet before Analytics -->
<script src="https://www.googleoptimize.com/optimize.js?id=OPT-XXXXXX"></script>
```

```typescript
// Wait for experiment
export const useExperiment = (experimentId: string) => {
  const variant = signal<string | null>(null);

  onMount(() => {
    const checkVariant = setInterval(() => {
      const variant = (window as any).google_optimize?.get(experimentId);
      if (variant !== undefined) {
        variant.set(variant);
        clearInterval(checkVariant);
      }
    }, 100);

    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkVariant);
      if (variant() === null) {
        variant.set('0'); // Default variant
      }
    }, 5000);
  });

  return variant;
};

// Usage
export default defineComponent(() => {
  const variant = useExperiment('EXPERIMENT_ID');

  return () => (
    <Show when={variant()}>
      <Switch>
        <Match when={variant() === '0'}>
          <OriginalVersion />
        </Match>
        <Match when={variant() === '1'}>
          <VariantA />
        </Match>
        <Match when={variant() === '2'}>
          <VariantB />
        </Match>
      </Switch>
    </Show>
  );
});
```

### Custom A/B Testing

```typescript
export const useABTest = (testName: string, variants: string[]) => {
  const variant = signal<string>('');

  onMount(() => {
    // Check if user already assigned
    let assigned = localStorage.getItem(`ab_${testName}`);

    if (!assigned) {
      // Assign random variant
      assigned = variants[Math.floor(Math.random() * variants.length)];
      localStorage.setItem(`ab_${testName}`, assigned);
    }

    variant.set(assigned);

    // Track assignment
    ReactGA.event('ab_test_assignment', {
      test_name: testName,
      variant: assigned
    });
  });

  return variant;
};

// Usage
export default defineComponent(() => {
  const variant = useABTest('cta_button', ['control', 'variant_a', 'variant_b']);

  return () => (
    <Switch>
      <Match when={variant() === 'control'}>
        <button>Sign Up</button>
      </Match>
      <Match when={variant() === 'variant_a'}>
        <button>Get Started Free</button>
      </Match>
      <Match when={variant() === 'variant_b'}>
        <button>Try It Now</button>
      </Match>
    </Switch>
  );
});
```

## Debugging

Debug analytics implementation.

### GA4 Debug Mode

```typescript
// Enable debug mode
ReactGA.initialize(measurementId, {
  gaOptions: {
    debug_mode: true
  }
});

// Or via URL parameter
// ?gtm_debug=true
```

### Console Logging

```typescript
export const analytics = {
  track: (event: string, data?: Record<string, any>) => {
    // Log in development
    if (import.meta.env.DEV) {
      console.log('[Analytics]', event, data);
    }

    // Send to analytics
    ReactGA.event(event, data);
  }
};
```

### Analytics Debugger Extension

```typescript
/**
 * Browser Extensions for Debugging:
 *
 * - Google Analytics Debugger (Chrome)
 * - GA Debug (Chrome/Firefox)
 * - Facebook Pixel Helper
 * - Tag Assistant (Google)
 */
```

## Best Practices

### Guidelines

```typescript
/**
 * Analytics Best Practices:
 *
 * 1. Track What Matters
 *    - Focus on business goals
 *    - Don't track everything
 *    - Quality over quantity
 *
 * 2. Consistent Naming
 *    - Use clear event names
 *    - Follow naming conventions
 *    - Document your schema
 *
 * 3. Respect Privacy
 *    - Get user consent
 *    - Anonymize data
 *    - Provide opt-out
 *
 * 4. Test Implementation
 *    - Verify events fire correctly
 *    - Check data in reports
 *    - Use debug mode
 *
 * 5. Avoid PII
 *    - Don't track emails, names, etc.
 *    - Use hashed IDs
 *    - Follow GDPR/CCPA
 *
 * 6. Performance
 *    - Load analytics async
 *    - Don't block rendering
 *    - Use sendBeacon for exit events
 *
 * 7. Documentation
 *    - Document all events
 *    - Maintain tracking plan
 *    - Share with team
 */
```

## Examples

### Complete Analytics Setup

```typescript
// analytics/index.ts
import ReactGA from 'react-ga4';

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

// Initialize
export const initAnalytics = () => {
  if (!MEASUREMENT_ID || import.meta.env.DEV) return;

  ReactGA.initialize(MEASUREMENT_ID, {
    gtagOptions: {
      anonymize_ip: true,
      cookie_flags: 'SameSite=None;Secure'
    }
  });
};

// Track page view
export const trackPageView = (path: string) => {
  ReactGA.send({ hitType: 'pageview', page: path });
};

// Track event
export const trackEvent = (
  category: string,
  action: string,
  label?: string,
  value?: number
) => {
  ReactGA.event({
    category,
    action,
    label,
    value
  });
};

// Track GA4 event
export const trackGA4Event = (event: string, params?: Record<string, any>) => {
  ReactGA.event(event, params);
};

// E-commerce
export const trackPurchase = (order: Order) => {
  ReactGA.event('purchase', {
    transaction_id: order.id,
    value: order.total,
    currency: 'USD',
    items: order.items
  });
};

// Set user
export const setUser = (userId: string) => {
  ReactGA.set({ userId });
};

// main.tsx
import { initAnalytics } from './analytics';

if (import.meta.env.PROD) {
  initAnalytics();
}

// App.tsx
import { useLocation } from '@aether/router';
import { trackPageView } from './analytics';

export default defineComponent(() => {
  const location = useLocation();

  createEffect(() => {
    trackPageView(location.pathname + location.search);
  });

  return () => <Router />;
});
```

## Summary

Analytics provide valuable insights:

1. **GA4**: Most comprehensive analytics platform
2. **Events**: Track user interactions
3. **E-commerce**: Track purchases and revenue
4. **Properties**: Segment users
5. **Conversions**: Track goals and funnels
6. **Privacy**: Respect user privacy with consent
7. **Alternatives**: Privacy-focused options available
8. **Custom**: Build your own if needed
9. **A/B Testing**: Optimize with experiments
10. **Debugging**: Verify implementation

Make data-driven decisions with Aether analytics.
