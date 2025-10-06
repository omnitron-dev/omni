# Theming System — Design Tokens and Theming

## Introduction

The theming system in Nexus is a comprehensive solution for managing application design via typed tokens. It combines design system best practices with full TypeScript integration and compile-time validation.

### Key Features

- **Type-Safe Tokens** — Full typing for design tokens
- **CSS Variables** — Automatic generation of CSS custom properties
- **Theme Inheritance** — Inherit and extend themes
- **Runtime Switching** — Switch themes without reloads
- **SSR Support** — Server-side rendering with themes
- **Dark Mode** — Built-in dark theme support
- **Responsive Theming** — Adaptive tokens
- **Compile-Time Validation** — Token checks at compile time

## Defining a Theme

### Basic Syntax

```typescript
// themes/light.theme.ts
import { defineTheme } from 'nexus/theming';

export const LightTheme = defineTheme({
  name: 'light',

  // Color palette
  colors: {
    // Base colors (Tailwind-style)
    primary: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9', // Base
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c4a6e',
      950: '#082f49'
    },

    secondary: {
      50: '#faf5ff',
      500: '#a855f7',
      900: '#581c87'
    },

    // Semantic colors
    background: {
      primary: '#ffffff',
      secondary: '#f8fafc',
      tertiary: '#f1f5f9',
      inverse: '#1e293b'
    },

    text: {
      primary: '#0f172a',
      secondary: '#475569',
      tertiary: '#94a3b8',
      inverse: '#f8fafc',
      disabled: '#cbd5e1'
    },

    border: {
      default: '#e2e8f0',
      light: '#f1f5f9',
      dark: '#cbd5e1',
      focus: '#0ea5e9',
      error: '#ef4444'
    },

    // State colors
    state: {
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6'
    },

    // Overlay
    overlay: 'rgba(15, 23, 42, 0.6)'
  },

  // Typography
  typography: {
    fontFamily: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      serif: 'Georgia, "Times New Roman", Times, serif',
      mono: 'Menlo, Monaco, "Courier New", monospace'
    },

    fontSize: {
      xs: '0.75rem',      // 12px
      sm: '0.875rem',     // 14px
      base: '1rem',       // 16px
      lg: '1.125rem',     // 18px
      xl: '1.25rem',      // 20px
      '2xl': '1.5rem',    // 24px
      '3xl': '1.875rem',  // 30px
      '4xl': '2.25rem',   // 36px
      '5xl': '3rem',      // 48px
      '6xl': '3.75rem',   // 60px
      '7xl': '4.5rem',    // 72px
      '8xl': '6rem',      // 96px
      '9xl': '8rem'       // 128px
    },

    fontWeight: {
      thin: 100,
      extralight: 200,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
      black: 900
    },

    lineHeight: {
      none: 1,
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2
    },

    letterSpacing: {
      tighter: '-0.05em',
      tight: '-0.025em',
      normal: '0em',
      wide: '0.025em',
      wider: '0.05em',
      widest: '0.1em'
    }
  },

  // Spacing (base unit: 0.25rem = 4px)
  spacing: {
    0: '0',
    px: '1px',
    0.5: '0.125rem',   // 2px
    1: '0.25rem',      // 4px
    1.5: '0.375rem',   // 6px
    2: '0.5rem',       // 8px
    2.5: '0.625rem',   // 10px
    3: '0.75rem',      // 12px
    3.5: '0.875rem',   // 14px
    4: '1rem',         // 16px
    5: '1.25rem',      // 20px
    6: '1.5rem',       // 24px
    7: '1.75rem',      // 28px
    8: '2rem',         // 32px
    9: '2.25rem',      // 36px
    10: '2.5rem',      // 40px
    11: '2.75rem',     // 44px
    12: '3rem',        // 48px
    14: '3.5rem',      // 56px
    16: '4rem',        // 64px
    20: '5rem',        // 80px
    24: '6rem',        // 96px
    28: '7rem',        // 112px
    32: '8rem',        // 128px
    36: '9rem',        // 144px
    40: '10rem',       // 160px
    44: '11rem',       // 176px
    48: '12rem',       // 192px
    52: '13rem',       // 208px
    56: '14rem',       // 224px
    60: '15rem',       // 240px
    64: '16rem',       // 256px
    72: '18rem',       // 288px
    80: '20rem',       // 320px
    96: '24rem'        // 384px
  },

  // Border radius
  borderRadius: {
    none: '0',
    sm: '0.125rem',    // 2px
    DEFAULT: '0.25rem', // 4px
    md: '0.375rem',    // 6px
    lg: '0.5rem',      // 8px
    xl: '0.75rem',     // 12px
    '2xl': '1rem',     // 16px
    '3xl': '1.5rem',   // 24px
    full: '9999px'
  },

  // Shadows
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
    none: 'none'
  },

  // Z-index
  zIndex: {
    0: 0,
    10: 10,
    20: 20,
    30: 30,
    40: 40,
    50: 50,
    auto: 'auto',
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modalBackdrop: 1040,
    modal: 1050,
    popover: 1060,
    tooltip: 1070
  },

  // Transitions
  transitions: {
    duration: {
      fastest: '75ms',
      faster: '100ms',
      fast: '150ms',
      normal: '200ms',
      slow: '300ms',
      slower: '500ms',
      slowest: '700ms'
    },

    timing: {
      linear: 'linear',
      ease: 'ease',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
      bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
    }
  },

  // Breakpoints (for responsive theming)
  breakpoints: {
    xs: '320px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px'
  }
});
```

## Dark Theme with Inheritance

```typescript
// themes/dark.theme.ts
import { defineTheme } from 'nexus/theming';
import { LightTheme } from './light.theme';

export const DarkTheme = defineTheme({
  name: 'dark',

  // Inherit everything from LightTheme
  extends: LightTheme,

  // Override only colors
  colors: {
    background: {
      primary: '#0f172a',
      secondary: '#1e293b',
      tertiary: '#334155',
      inverse: '#f8fafc'
    },

    text: {
      primary: '#f8fafc',
      secondary: '#cbd5e1',
      tertiary: '#94a3b8',
      inverse: '#0f172a',
      disabled: '#64748b'
    },

    border: {
      default: '#334155',
      light: '#1e293b',
      dark: '#475569',
      focus: '#0ea5e9',
      error: '#ef4444'
    },

    overlay: 'rgba(0, 0, 0, 0.8)'

    // primary, secondary, state remain from LightTheme
  }
});
```

## TypeScript Typing

The compiler automatically generates types:

```typescript
// Generated types (.nexus/theming.d.ts)
export interface Theme {
  name: string;
  colors: {
    primary: Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>;
    secondary: Record<50 | 500 | 900, string>;
    background: {
      primary: string;
      secondary: string;
      tertiary: string;
      inverse: string;
    };
    text: {
      primary: string;
      secondary: string;
      tertiary: string;
      inverse: string;
      disabled: string;
    };
    border: {
      default: string;
      light: string;
      dark: string;
      focus: string;
      error: string;
    };
    state: {
      success: string;
      warning: string;
      error: string;
      info: string;
    };
    overlay: string;
  };
  typography: {
    fontFamily: Record<'sans' | 'serif' | 'mono', string>;
    fontSize: Record<'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | '8xl' | '9xl', string>;
    // ... and so on
  };
  // ... other tokens
}

// Helper types
export type ThemeColors = Theme['colors'];
export type ThemeSpacing = keyof Theme['spacing'];
export type ThemeFontSize = keyof Theme['typography']['fontSize'];

// Type-safe token access
export function token<K extends keyof Theme>(
  key: K
): Theme[K];

export function token<K extends keyof Theme, NK extends keyof Theme[K]>(
  key: K,
  nestedKey: NK
): Theme[K][NK];

// Usage
const primaryColor = token('colors', 'primary'); // Type: Record<50 | 100 | ..., string>
const spacing = token('spacing'); // Type: Theme['spacing']
```

## CSS Variables Generation

The compiler automatically generates CSS custom properties:

```css
/* Generated CSS for LightTheme */
:root,
[data-theme="light"] {
  /* Colors - Primary */
  --color-primary-50: #f0f9ff;
  --color-primary-100: #e0f2fe;
  --color-primary-200: #bae6fd;
  --color-primary-300: #7dd3fc;
  --color-primary-400: #38bdf8;
  --color-primary-500: #0ea5e9;
  --color-primary-600: #0284c7;
  --color-primary-700: #0369a1;
  --color-primary-800: #075985;
  --color-primary-900: #0c4a6e;
  --color-primary-950: #082f49;

  /* Colors - Semantic */
  --color-background-primary: #ffffff;
  --color-background-secondary: #f8fafc;
  --color-background-tertiary: #f1f5f9;
  --color-background-inverse: #1e293b;

  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-tertiary: #94a3b8;
  --color-text-inverse: #f8fafc;
  --color-text-disabled: #cbd5e1;

  /* Typography */
  --font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-family-serif: Georgia, "Times New Roman", Times, serif;
  --font-family-mono: Menlo, Monaco, "Courier New", monospace;

  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  /* ... */

  /* Spacing */
  --spacing-0: 0;
  --spacing-px: 1px;
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  /* ... */

  /* Border Radius */
  --radius-none: 0;
  --radius-sm: 0.125rem;
  --radius: 0.25rem;
  --radius-md: 0.375rem;
  /* ... */

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  /* ... */

  /* Transitions */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  --timing-ease: ease;
  --timing-ease-in: cubic-bezier(0.4, 0, 1, 1);
  /* ... */

  /* Z-Index */
  --z-dropdown: 1000;
  --z-modal: 1050;
  --z-tooltip: 1070;
  /* ... */
}

[data-theme="dark"] {
  --color-background-primary: #0f172a;
  --color-background-secondary: #1e293b;
  /* ... only overridden values */
}
```

## Runtime Theme Service

```typescript
// services/theme.service.ts
import { injectable, signal, computed, effect } from 'nexus';
import { LightTheme, DarkTheme } from '@/themes';

export const ThemeService = injectable(() => {
  // Current theme
  const currentThemeName = signal<'light' | 'dark'>('light');

  // Theme map
  const themes = {
    light: LightTheme,
    dark: DarkTheme
  };

  // Computed current theme
  const currentTheme = computed(() => themes[currentThemeName()]);

  // Effect to apply the theme
  effect(() => {
    const themeName = currentThemeName();

    // Set data attribute
    document.documentElement.setAttribute('data-theme', themeName);

    // Save to localStorage
    localStorage.setItem('theme', themeName);

    // Reflect system preference
    if (themeName === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  });

  // Detect system theme
  const detectSystemTheme = () => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  };

  // System changes listener
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    currentThemeName(e.matches ? 'dark' : 'light');
  });

  // Initialization
  const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
  if (savedTheme) {
    currentThemeName(savedTheme);
  } else {
    currentThemeName(detectSystemTheme());
  }

  return {
    currentTheme,
    currentThemeName,

    // Switch theme
    theme.set(name: 'light' | 'dark') {
      currentThemeName(name);
    },

    // Toggle
    toggle() {
      currentThemeName(currentThemeName() === 'light' ? 'dark' : 'light');
    },

    // Type-safe token access
    token<K extends keyof typeof LightTheme>(key: K) {
      return computed(() => currentTheme()[key]);
    }
  };
});
```

### Using ThemeService

```typescript
// components/ThemeToggle.tsx
import { defineComponent, inject, Show } from 'nexus';
import { ThemeService } from '@/services/theme.service';

const ThemeToggle = defineComponent(() => {
  const theme = inject(ThemeService);

  return () => (
    <button
      on:click={() => theme.toggle()}
      aria-label={theme.currentThemeName() === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      <Show when={theme.currentThemeName() === 'light'} fallback={<span>☀️</span>}>
        <span>🌙</span>
      </Show>
    </button>
  );
});

// components/ThemedButton.tsx
import { defineComponent, inject } from 'nexus';
import { ThemeService } from '@/services/theme.service';

const ThemedButton = defineComponent(() => {
  const theme = inject(ThemeService);

  // Programmatic access to tokens
  const primaryColor = () => theme.token('colors')().primary[500];
  const inverseColor = () => theme.token('colors')().text.inverse;

  return () => (
    <button
      style:background={primaryColor()}
      style:color={inverseColor()}
    >
      <slot />
    </button>
  );
});
```

## Usage in Components

### CSS Variables

```typescript
// components/Card.tsx
import { defineComponent } from 'nexus';

const Card = defineComponent(() => {
  return () => (
    <div class="card">
      <div class="card-header">
        <slot name="header" />
      </div>
      <div class="card-body">
        <slot />
      </div>
</div>

<style>
.card {
  background: var(--color-background-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  padding: var(--spacing-6);
  box-shadow: var(--shadow-md);
  transition: box-shadow var(--duration-normal) var(--timing-ease);
}

.card:hover {
  box-shadow: var(--shadow-lg);
}

.card-header {
  margin-bottom: var(--spacing-4);
  padding-bottom: var(--spacing-4);
  border-bottom: 1px solid var(--color-border-light);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.card-body {
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}
</style>
```

### Dynamic Styling

```typescript
// components/Button.tsx
import { defineComponent, inject, computed } from 'nexus';
import { ThemeService } from '@/services/theme.service';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const Button = defineComponent<ButtonProps>((props) => {
  const variant = () => props.variant ?? 'primary';
  const size = () => props.size ?? 'md';
  const theme = inject(ThemeService);

  const buttonStyles = computed(() => {
    const colors = theme.token('colors')();
    const spacing = theme.token('spacing')();
    const typography = theme.token('typography')();

    const variantStyles = {
      primary: {
        background: colors.primary[500],
        color: colors.text.inverse,
        hover: colors.primary[600]
      },
      secondary: {
        background: colors.secondary[500],
        color: colors.text.inverse,
        hover: colors.secondary[600]
      },
      danger: {
        background: colors.state.error,
        color: colors.text.inverse,
        hover: '#dc2626'
      }
    };

    const sizeStyles = {
      sm: { padding: `${spacing[2]} ${spacing[3]}`, fontSize: typography.fontSize.sm },
      md: { padding: `${spacing[3]} ${spacing[4]}`, fontSize: typography.fontSize.base },
      lg: { padding: `${spacing[4]} ${spacing[6]}`, fontSize: typography.fontSize.lg }
    };

    return {
      ...variantStyles[variant()],
      ...sizeStyles[size()]
    };
  });

  return () => (
    <button
      class="btn"
      style:background={buttonStyles().background}
      style:color={buttonStyles().color}
      style:padding={buttonStyles().padding}
      style:font-size={buttonStyles().fontSize}
      on:click
    >
      <slot />
    </button>
  );
});
```

## Responsive Theming

Tokens can be responsive:

```typescript
// themes/responsive.theme.ts
export const ResponsiveTheme = defineTheme({
  name: 'responsive',

  // Base values
  spacing: {
    card: '1rem' // 16px on mobile
  },

  typography: {
    fontSize: {
      heading: '1.5rem' // 24px on mobile
    }
  },

  // Responsive overrides
  responsive: {
    // md breakpoint (768px)
    md: {
      spacing: {
        card: '1.5rem' // 24px on tablets
      },
      typography: {
        fontSize: {
          heading: '2rem' // 32px on tablets
        }
      }
    },

    // lg breakpoint (1024px)
    lg: {
      spacing: {
        card: '2rem' // 32px on desktop
      },
      typography: {
        fontSize: {
          heading: '2.5rem' // 40px on desktop
        }
      }
    }
  }
});

// Generates media queries:
/*
:root {
  --spacing-card: 1rem;
  --font-size-heading: 1.5rem;
}

@media (min-width: 768px) {
  :root {
    --spacing-card: 1.5rem;
    --font-size-heading: 2rem;
  }
}

@media (min-width: 1024px) {
  :root {
    --spacing-card: 2rem;
    --font-size-heading: 2.5rem;
  }
}
*/
```

## SSR Support

Themes work with server-side rendering:

```typescript
// routes/+layout.tsx
import { defineComponent } from 'nexus';
import { loader, useLoaderData } from 'nexus/routing';

export const load = loader(async ({ request }) => {
  // Determine theme from cookie or user-agent
  const theme = request.headers.get('cookie')?.includes('theme=dark')
    ? 'dark'
    : 'light';

  return { theme };
});

export default defineComponent(() => {
  const data = useLoaderData();

  return () => (
    <html data-theme={data.theme}>
      <head>
        <title>My App</title>
        {/* Inline critical CSS for the theme */}
        <style>
          {`:root { /* theme variables */ }`}
        </style>
      </head>
      <body>
        <slot />
      </body>
    </html>
  );
});
```

## Best Practices

### 1. Semantic Names

```typescript
// ✅ Good
colors: {
  text: {
    primary: '#000',
    secondary: '#666'
  }
}

// ❌ Bad
colors: {
  black: '#000',
  gray: '#666'
}
```

### 2. Use CSS Variables

```css
/* ✅ Good: use variables */
.button {
  background: var(--color-primary-500);
  padding: var(--spacing-4);
}

/* ❌ Bad: hardcoded values */
.button {
  background: #0ea5e9;
  padding: 1rem;
}
```

### 3. Minimize Theme Overrides

```typescript
// ✅ Good: override only what's necessary
export const DarkTheme = defineTheme({
  extends: LightTheme,
  colors: {
    background: { /* background only */ }
  }
});

// ❌ Bad: duplicate everything
export const DarkTheme = defineTheme({
  colors: { /* copy-paste of everything from LightTheme */ }
});
```

## Conclusion

The Nexus theming system provides:

- ✅ **Type Safety** — Full typing for tokens
- ✅ **DX** — Convenient theme workflows
- ✅ **Performance** — CSS Variables with no runtime overhead
- ✅ **Flexibility** — Inheritance and theme extension
- ✅ **SSR** — Server-side rendering with themes
- ✅ **Accessibility** — System preference support

Next section: [13-PRIMITIVES.md](./13-PRIMITIVES.md)
