# 11. Styling

## Table of Contents

- [Overview](#overview)
- [Philosophy](#philosophy)
- [Scoped Styles](#scoped-styles)
- [CSS Modules](#css-modules)
- [CSS-in-JS](#css-in-js)
- [Utility-First (Tailwind)](#utility-first-tailwind)
- [Styled Components](#styled-components)
- [Global Styles](#global-styles)
- [Theming Integration](#theming-integration)
- [Animations](#animations)
- [Responsive Design](#responsive-design)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Comparisons](#comparisons)
- [Advanced Patterns](#advanced-patterns)
- [API Reference](#api-reference)
- [Examples](#examples)

## Overview

Aether provides **multiple styling approaches** to fit different preferences and use cases:

1. **Scoped Styles**: Component-scoped CSS with automatic scoping
2. **CSS Modules**: File-based scoped CSS with hashed class names
3. **CSS-in-JS**: Runtime and zero-runtime solutions
4. **Utility-First**: Tailwind CSS integration
5. **Styled Components**: Tagged template literals for styling
6. **Global Styles**: Application-wide styles

All approaches are **type-safe, performant, and support theming**.

### Quick Example

```typescript
// 1. Scoped styles
export default defineComponent(() => {
  return () => (
    <div>
      <h1>Hello World</h1>
      <style>{`
        h1 {
          color: blue;
          font-size: 24px;
        }
      `}</style>
    </div>
  );
});

// 2. CSS Modules
import styles from './Button.module.css';

export default defineComponent(() => {
  return () => <button class={styles.button}>Click me</button>;
});

// 3. CSS-in-JS
import { css } from 'aether/styles';

const buttonStyle = css({
  background: 'blue',
  color: 'white',
  padding: '10px 20px',
  borderRadius: '4px'
});

export default defineComponent(() => {
  return () => <button class={buttonStyle}>Click me</button>;
});

// 4. Tailwind
export default defineComponent(() => {
  return () => (
    <button class="bg-blue-500 text-white px-4 py-2 rounded">
      Click me
    </button>
  );
});

// 5. Styled Components
import { styled } from 'aether/styles';

const Button = styled.button`
  background: blue;
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
`;

export default defineComponent(() => {
  return () => <Button>Click me</Button>;
});
```

## Philosophy

### Flexibility Over Prescription

Aether **doesn't force a single styling solution**. Choose what works best for your project:

- **Scoped styles**: Simple, familiar, great for small components
- **CSS Modules**: Good for medium projects, design systems
- **CSS-in-JS**: Dynamic styles, theming, type safety
- **Tailwind**: Rapid prototyping, utility-first approach
- **Styled Components**: Component-centric, familiar to React developers

### Performance First

All styling solutions are optimized for:

- **Zero runtime overhead** (where possible)
- **Dead code elimination**
- **Minimal CSS bundle size**
- **Efficient hydration**
- **Cache-friendly output**

### Type Safety

Full TypeScript support for:

- **Theme tokens**: Autocomplete for colors, spacing, etc.
- **CSS properties**: Type-safe CSS objects
- **Dynamic styles**: Type-safe props and variants
- **Media queries**: Type-safe breakpoints

### Developer Experience

- **Hot reload**: Instant style updates in development
- **IntelliSense**: Autocomplete for theme tokens
- **Error messages**: Clear, actionable style errors
- **DevTools**: Inspect styles in browser DevTools

## Scoped Styles

### Basic Scoped Styles

Styles defined in a component are **automatically scoped** to that component:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <h1>Hello World</h1>
      <p>This is scoped.</p>

      <style>{`
        h1 {
          color: blue;
          font-size: 24px;
        }

        p {
          color: gray;
        }
      `}</style>
    </div>
  );
});
```

**Generated CSS**:

```css
h1[data-scope="c1"] {
  color: blue;
  font-size: 24px;
}

p[data-scope="c1"] {
  color: gray;
}
```

### Multiple Scoped Styles

Define multiple `<style>` tags:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <header>Header</header>
      <style>{`
        header {
          background: blue;
          color: white;
        }
      `}</style>

      <main>Content</main>
      <style>{`
        main {
          padding: 20px;
        }
      `}</style>
    </div>
  );
});
```

### Dynamic Scoped Styles

Use signals for dynamic styles:

```typescript
export default defineComponent(() => {
  const color = signal('blue');

  return () => (
    <div>
      <h1>Hello World</h1>
      <button onClick={() => color.set('red')}>Change Color</button>

      <style>{`
        h1 {
          color: ${color()};
        }
      `}</style>
    </div>
  );
});
```

### Scoped with Preprocessors

Use SCSS/LESS/Stylus:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <button class="primary">Primary</button>
      <button class="secondary">Secondary</button>

      <style lang="scss">{`
        $primary-color: blue;
        $secondary-color: gray;

        .primary {
          background: $primary-color;
          color: white;

          &:hover {
            background: darken($primary-color, 10%);
          }
        }

        .secondary {
          background: $secondary-color;
          color: white;

          &:hover {
            background: darken($secondary-color, 10%);
          }
        }
      `}</style>
    </div>
  );
});
```

### Global from Scoped

Define global styles within a scoped context:

```typescript
export default defineComponent(() => {
  return () => (
    <div>
      <h1>Hello</h1>

      <style>{`
        /* Scoped */
        h1 {
          color: blue;
        }

        /* Global */
        :global(body) {
          margin: 0;
          font-family: sans-serif;
        }
      `}</style>
    </div>
  );
});
```

## CSS Modules

### Basic CSS Modules

Create a `.module.css` file:

```css
/* Button.module.css */
.button {
  background: blue;
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
}

.button:hover {
  background: darkblue;
}

.primary {
  background: blue;
}

.secondary {
  background: gray;
}
```

Import and use:

```typescript
import styles from './Button.module.css';

export default defineComponent(() => {
  return () => (
    <div>
      <button class={styles.button}>Click me</button>
      <button class={`${styles.button} ${styles.primary}`}>Primary</button>
    </div>
  );
});
```

### Type-Safe CSS Modules

Generate TypeScript definitions:

```typescript
// Button.module.css.d.ts (auto-generated)
export const button: string;
export const primary: string;
export const secondary: string;
```

Use with IntelliSense:

```typescript
import styles from './Button.module.css';

// Autocomplete for styles.button, styles.primary, etc.
<button class={styles.button}>Click me</button>
```

### Composing Styles

Compose classes in CSS Modules:

```css
/* Button.module.css */
.base {
  padding: 10px 20px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

.primary {
  composes: base;
  background: blue;
  color: white;
}

.secondary {
  composes: base;
  background: gray;
  color: white;
}
```

```typescript
import styles from './Button.module.css';

<button class={styles.primary}>Primary</button>
<button class={styles.secondary}>Secondary</button>
```

### Global Classes

Define global classes in CSS Modules:

```css
/* App.module.css */
:global(.container) {
  max-width: 1200px;
  margin: 0 auto;
}

:global(.text-center) {
  text-align: center;
}
```

### CSS Modules with Preprocessors

Use SCSS modules:

```scss
/* Button.module.scss */
$primary-color: blue;
$secondary-color: gray;

.button {
  padding: 10px 20px;
  border-radius: 4px;

  &.primary {
    background: $primary-color;
    color: white;
  }

  &.secondary {
    background: $secondary-color;
    color: white;
  }
}
```

```typescript
import styles from './Button.module.scss';

<button class={`${styles.button} ${styles.primary}`}>Primary</button>
```

## CSS-in-JS

### Runtime CSS-in-JS

Use the `css` function for runtime styles:

```typescript
import { css } from 'aether/styles';

const buttonStyle = css({
  background: 'blue',
  color: 'white',
  padding: '10px 20px',
  borderRadius: '4px',

  '&:hover': {
    background: 'darkblue'
  }
});

export default defineComponent(() => {
  return () => <button class={buttonStyle}>Click me</button>;
});
```

### Type-Safe CSS

Full TypeScript support:

```typescript
import { css } from 'aether/styles';

const style = css({
  display: 'flex',
  flexDirection: 'column', // ✅ Typed
  justifyContent: 'center', // ✅ Typed
  alignItems: 'stretch', // ✅ Typed

  // ❌ Type error
  invalidProperty: 'value'
});
```

### Dynamic Styles

Create dynamic styles with props:

```typescript
import { css } from 'aether/styles';

const createButtonStyle = (props: { variant: 'primary' | 'secondary' }) => css({
  background: props.variant === 'primary' ? 'blue' : 'gray',
  color: 'white',
  padding: '10px 20px',
  borderRadius: '4px'
});

export default defineComponent<{ variant: 'primary' | 'secondary' }>((props) => {
  const buttonStyle = computed(() => createButtonStyle({ variant: props.variant }));

  return () => <button class={buttonStyle()}>Click me</button>;
});
```

### Nested Selectors

Use nested selectors:

```typescript
const cardStyle = css({
  padding: '20px',
  borderRadius: '8px',
  background: 'white',

  '& > h2': {
    fontSize: '24px',
    marginBottom: '10px'
  },

  '& > p': {
    color: 'gray',
    lineHeight: 1.5
  },

  '&:hover': {
    boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
  }
});
```

### Media Queries

Define responsive styles:

```typescript
const responsiveStyle = css({
  fontSize: '16px',

  '@media (min-width: 768px)': {
    fontSize: '18px'
  },

  '@media (min-width: 1024px)': {
    fontSize: '20px'
  }
});
```

### Keyframe Animations

Define animations:

```typescript
import { css, keyframes } from 'aether/styles';

const fadeIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 }
});

const animatedStyle = css({
  animation: `${fadeIn} 0.3s ease-in-out`
});
```

### Zero-Runtime CSS-in-JS

Use zero-runtime extraction for production:

```typescript
import { css } from 'aether/styles/zero-runtime';

// Extracted at build time, no runtime overhead
const buttonStyle = css({
  background: 'blue',
  color: 'white',
  padding: '10px 20px'
});
```

**Build output**:

```css
/* app.css */
.button_a1b2c3 {
  background: blue;
  color: white;
  padding: 10px 20px;
}
```

```typescript
// app.js
const buttonStyle = 'button_a1b2c3';
```

## Utility-First (Tailwind)

### Tailwind Integration

Install and configure Tailwind:

```bash
npm install -D tailwindcss
npx tailwindcss init
```

**tailwind.config.js**:

```javascript
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {}
  },
  plugins: []
};
```

**app.css**:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Using Tailwind Classes

```typescript
export default defineComponent(() => {
  return () => (
    <div class="container mx-auto px-4">
      <h1 class="text-3xl font-bold text-blue-600">Hello World</h1>
      <p class="text-gray-600 mt-4">This is styled with Tailwind.</p>
      <button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
        Click me
      </button>
    </div>
  );
});
```

### Dynamic Tailwind Classes

Use signals for dynamic classes:

```typescript
export default defineComponent(() => {
  const variant = signal<'primary' | 'secondary'>('primary');

  const buttonClass = computed(() =>
    variant() === 'primary'
      ? 'bg-blue-500 hover:bg-blue-700'
      : 'bg-gray-500 hover:bg-gray-700'
  );

  return () => (
    <button class={`text-white font-bold py-2 px-4 rounded ${buttonClass()}`}>
      Click me
    </button>
  );
});
```

### Tailwind + Theme Tokens

Use Tailwind with theme tokens:

```javascript
// tailwind.config.js
import { theme } from './src/theme';

export default {
  theme: {
    colors: theme.colors,
    spacing: theme.spacing,
    borderRadius: theme.borderRadius
  }
};
```

```typescript
// Now use theme tokens via Tailwind
<div class="bg-primary text-on-primary p-4 rounded-md">
  Themed with Tailwind
</div>
```

### Tailwind @apply

Create custom classes with @apply:

```css
/* components.css */
.btn {
  @apply font-bold py-2 px-4 rounded;
}

.btn-primary {
  @apply bg-blue-500 text-white;
  @apply hover:bg-blue-700;
}

.btn-secondary {
  @apply bg-gray-500 text-white;
  @apply hover:bg-gray-700;
}
```

```typescript
<button class="btn btn-primary">Primary</button>
<button class="btn btn-secondary">Secondary</button>
```

### Tailwind Variants

Create custom variants:

```javascript
// tailwind.config.js
export default {
  theme: {
    extend: {
      variants: {
        extend: {
          backgroundColor: ['active'],
          textColor: ['active']
        }
      }
    }
  }
};
```

```typescript
<button class="bg-blue-500 active:bg-blue-700">Click me</button>
```

## Styled Components

### Basic Styled Components

Use tagged template literals:

```typescript
import { styled } from 'aether/styles';

const Button = styled.button`
  background: blue;
  color: white;
  padding: 10px 20px;
  border-radius: 4px;

  &:hover {
    background: darkblue;
  }
`;

export default defineComponent(() => {
  return () => <Button>Click me</Button>;
});
```

### Props-Based Styling

Style based on props:

```typescript
import { styled } from 'aether/styles';

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
}

const Button = styled.button<ButtonProps>`
  padding: ${props => {
    switch (props.size) {
      case 'small': return '5px 10px';
      case 'large': return '15px 30px';
      default: return '10px 20px';
    }
  }};

  background: ${props =>
    props.variant === 'secondary' ? 'gray' : 'blue'
  };

  color: white;
  border-radius: 4px;

  &:hover {
    opacity: 0.9;
  }
`;

export default defineComponent(() => {
  return () => (
    <div>
      <Button variant="primary" size="small">Small Primary</Button>
      <Button variant="secondary" size="large">Large Secondary</Button>
    </div>
  );
});
```

### Extending Styled Components

Extend existing styled components:

```typescript
const Button = styled.button`
  padding: 10px 20px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
`;

const PrimaryButton = styled(Button)`
  background: blue;
  color: white;
`;

const SecondaryButton = styled(Button)`
  background: gray;
  color: white;
`;
```

### Styled Component Variants

Use the `variants` helper:

```typescript
import { styled, variants } from 'aether/styles';

const Button = styled.button(
  {
    padding: '10px 20px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer'
  },
  variants({
    variant: {
      primary: {
        background: 'blue',
        color: 'white'
      },
      secondary: {
        background: 'gray',
        color: 'white'
      }
    },
    size: {
      small: {
        padding: '5px 10px',
        fontSize: '12px'
      },
      medium: {
        padding: '10px 20px',
        fontSize: '14px'
      },
      large: {
        padding: '15px 30px',
        fontSize: '16px'
      }
    }
  })
);

<Button variant="primary" size="large">Click me</Button>
```

### As Prop

Render as different element:

```typescript
const Button = styled.button`
  padding: 10px 20px;
  background: blue;
  color: white;
`;

<Button>Regular button</Button>
<Button as="a" href="/login">Link styled as button</Button>
```

### Theming with Styled Components

Access theme in styled components:

```typescript
import { styled } from 'aether/styles';

const Button = styled.button`
  background: ${props => props.theme.colors.primary};
  color: ${props => props.theme.colors.onPrimary};
  padding: ${props => props.theme.spacing.md};
  border-radius: ${props => props.theme.borderRadius.md};
`;
```

## Global Styles

### Defining Global Styles

Define global styles in `app.css`:

```css
/* app.css */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  margin: 0;
}

a {
  color: inherit;
  text-decoration: none;
}
```

Import in main file:

```typescript
// main.ts
import './app.css';

Application.create(AppModule).then(app => app.start());
```

### Programmatic Global Styles

Define global styles programmatically:

```typescript
import { globalStyle } from 'aether/styles';

globalStyle(`
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    font-family: sans-serif;
  }
`);
```

### CSS Reset

Apply a CSS reset:

```typescript
import { cssReset } from 'aether/styles';

// Apply modern CSS reset
cssReset();
```

Or use a custom reset:

```css
/* reset.css */
/* Modern CSS Reset by Andy Bell */
*,
*::before,
*::after {
  box-sizing: border-box;
}

* {
  margin: 0;
}

html,
body {
  height: 100%;
}

body {
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

img,
picture,
video,
canvas,
svg {
  display: block;
  max-width: 100%;
}

input,
button,
textarea,
select {
  font: inherit;
}

p,
h1,
h2,
h3,
h4,
h5,
h6 {
  overflow-wrap: break-word;
}
```

```typescript
import './reset.css';
```

## Theming Integration

### Using Theme Tokens

Access theme tokens in styles:

```typescript
import { css, theme } from 'aether/styles';

const buttonStyle = css({
  background: theme.colors.primary,
  color: theme.colors.onPrimary,
  padding: `${theme.spacing.sm} ${theme.spacing.md}`,
  borderRadius: theme.borderRadius.md,

  '&:hover': {
    background: theme.colors.primaryHover
  }
});
```

### Type-Safe Theme Access

Full autocomplete for theme tokens:

```typescript
const style = css({
  color: theme.colors.primary, // ✅ Autocomplete
  padding: theme.spacing.lg, // ✅ Autocomplete
  borderRadius: theme.borderRadius.full // ✅ Autocomplete
});
```

### Dynamic Theming

Switch themes dynamically:

```typescript
import { useTheme } from 'aether/theming';

export default defineComponent(() => {
  const { currentTheme, setTheme } = useTheme();

  const buttonStyle = computed(() => css({
    background: currentTheme().colors.primary,
    color: currentTheme().colors.onPrimary
  }));

  return () => (
    <div>
      <button class={buttonStyle()} onClick={() => theme.set('dark')}>
        Switch to Dark
      </button>
    </div>
  );
});
```

### CSS Variables

Use CSS variables for theming:

```typescript
import { css } from 'aether/styles';

const buttonStyle = css({
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary)',
  padding: 'var(--spacing-md)',
  borderRadius: 'var(--border-radius-md)'
});
```

Theme changes update CSS variables:

```typescript
// Theme A
:root {
  --color-primary: blue;
  --color-on-primary: white;
}

// Theme B
:root {
  --color-primary: green;
  --color-on-primary: white;
}
```

## Animations

### CSS Transitions

Define transitions:

```typescript
const buttonStyle = css({
  background: 'blue',
  color: 'white',
  padding: '10px 20px',
  transition: 'background 0.3s ease',

  '&:hover': {
    background: 'darkblue'
  }
});
```

### Keyframe Animations

Create animations:

```typescript
import { css, keyframes } from 'aether/styles';

const fadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(10px)' },
  to: { opacity: 1, transform: 'translateY(0)' }
});

const animatedStyle = css({
  animation: `${fadeIn} 0.3s ease-in-out`
});

export default defineComponent(() => {
  return () => <div class={animatedStyle}>Fades in</div>;
});
```

### Animation Utilities

Use animation utilities:

```typescript
import { css, animations } from 'aether/styles';

const style = css({
  animation: animations.fadeIn('0.3s', 'ease-in-out'),

  '&:hover': {
    animation: animations.pulse('1s', 'infinite')
  }
});
```

**Built-in animations**:

- `fadeIn`, `fadeOut`
- `slideIn`, `slideOut`
- `zoomIn`, `zoomOut`
- `bounce`, `pulse`, `spin`

### Transition Groups

Animate lists:

```typescript
import { TransitionGroup } from 'aether/transitions';

const itemStyle = css({
  transition: 'all 0.3s ease'
});

export default defineComponent(() => {
  const items = signal([1, 2, 3]);

  return () => (
    <TransitionGroup
      enter={css({ opacity: 0, transform: 'translateX(-10px)' })}
      enterActive={css({ opacity: 1, transform: 'translateX(0)' })}
      exit={css({ opacity: 1 })}
      exitActive={css({ opacity: 0, transform: 'translateX(10px)' })}
    >
      {#each items() as item}
        <div key={item} class={itemStyle}>{item}</div>
      {/each}
    </TransitionGroup>
  );
});
```

### Enter/Exit Animations

Animate component mount/unmount:

```typescript
import { Transition } from 'aether/transitions';

export default defineComponent(() => {
  const show = signal(false);

  return () => (
    <div>
      <button onClick={() => show.set(!show())}>Toggle</button>

      <Transition
        show={show()}
        enter="transition-opacity duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div>Content</div>
      </Transition>
    </div>
  );
});
```

## Responsive Design

### Media Queries

Use media queries:

```typescript
const responsiveStyle = css({
  fontSize: '14px',
  padding: '10px',

  '@media (min-width: 768px)': {
    fontSize: '16px',
    padding: '15px'
  },

  '@media (min-width: 1024px)': {
    fontSize: '18px',
    padding: '20px'
  }
});
```

### Breakpoint Helpers

Use breakpoint utilities:

```typescript
import { css, breakpoints } from 'aether/styles';

const style = css({
  fontSize: '14px',

  [breakpoints.md]: {
    fontSize: '16px'
  },

  [breakpoints.lg]: {
    fontSize: '18px'
  }
});
```

**Built-in breakpoints**:

```typescript
export const breakpoints = {
  sm: '@media (min-width: 640px)',
  md: '@media (min-width: 768px)',
  lg: '@media (min-width: 1024px)',
  xl: '@media (min-width: 1280px)',
  '2xl': '@media (min-width: 1536px)'
};
```

### Container Queries

Use container queries:

```typescript
const cardStyle = css({
  padding: '10px',

  '@container (min-width: 400px)': {
    padding: '20px'
  }
});

const containerStyle = css({
  containerType: 'inline-size'
});

<div class={containerStyle}>
  <div class={cardStyle}>Card</div>
</div>
```

### Responsive Utilities

Use responsive utility classes:

```typescript
<div class="text-sm md:text-base lg:text-lg">
  Responsive text
</div>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

## Performance

### CSS Bundle Optimization

Aether automatically:

- **Tree-shakes unused styles**
- **Minifies CSS**
- **Deduplicates rules**
- **Generates critical CSS**

### Critical CSS

Extract critical CSS:

```typescript
// nexus.config.ts
export default {
  styles: {
    extractCritical: true,
    critical: {
      inline: true, // Inline critical CSS
      minify: true
    }
  }
};
```

### Code Splitting

CSS is automatically split by route:

```
dist/
├── app.css           # Global styles
├── routes/
│   ├── home.css      # Home route styles
│   ├── about.css     # About route styles
│   └── products.css  # Products route styles
```

### Lazy Loading Styles

Lazy load styles:

```typescript
const lazyStyle = lazy(() => import('./expensive-styles.module.css'));

export default defineComponent(() => {
  const show = signal(false);

  return () => (
    <div>
      <button onClick={() => show.set(true)}>Show</button>

      {#if show()}
        <div class={lazyStyle().container}>
          Heavy content
        </div>
      {/if}
    </div>
  );
});
```

### Style Deduplication

Styles are automatically deduplicated:

```typescript
// ComponentA.tsx
const style1 = css({ color: 'blue' });

// ComponentB.tsx
const style2 = css({ color: 'blue' }); // Same style

// Generated CSS (deduplicated)
.css_abc123 {
  color: blue;
}
```

## Best Practices

### 1. Choose the Right Approach

- **Scoped styles**: Simple components, prototypes
- **CSS Modules**: Design systems, medium-large projects
- **CSS-in-JS**: Dynamic styles, complex theming
- **Tailwind**: Rapid development, utility-first mindset
- **Styled Components**: Component-centric, familiar API

### 2. Avoid Inline Styles

```typescript
// ❌ Inline styles (not cached, not optimized)
<div style={{ background: 'blue', padding: '10px' }}>Content</div>

// ✅ CSS-in-JS (cached, optimized)
const style = css({ background: 'blue', padding: '10px' });
<div class={style}>Content</div>
```

### 3. Use Theme Tokens

```typescript
// ❌ Hardcoded values
const style = css({
  color: '#007bff',
  padding: '16px'
});

// ✅ Theme tokens
const style = css({
  color: theme.colors.primary,
  padding: theme.spacing.md
});
```

### 4. Optimize for Production

```typescript
// nexus.config.ts
export default {
  styles: {
    minify: true,
    extractCritical: true,
    purgeUnused: true
  }
};
```

### 5. Leverage Composition

```typescript
// ✅ Compose styles
const baseButton = css({
  padding: '10px 20px',
  borderRadius: '4px',
  border: 'none'
});

const primaryButton = css(baseButton, {
  background: 'blue',
  color: 'white'
});
```

### 6. Use CSS Variables for Dynamic Values

```typescript
// ✅ CSS variables (better performance)
const style = css({
  '--dynamic-color': props.color,
  background: 'var(--dynamic-color)'
});

// ❌ Regenerating styles (worse performance)
const style = computed(() => css({
  background: props.color
}));
```

### 7. Avoid Deep Nesting

```typescript
// ❌ Deep nesting
const style = css({
  '& > div': {
    '& > span': {
      '& > a': {
        color: 'blue'
      }
    }
  }
});

// ✅ Flatter structure
const linkStyle = css({ color: 'blue' });
<a class={linkStyle}>Link</a>
```

## Comparisons

### vs Emotion

**Emotion**:
```typescript
import { css } from '@emotion/react';

const style = css`
  color: blue;
  font-size: 16px;
`;

<div css={style}>Content</div>
```

**Aether**:
```typescript
import { css } from 'aether/styles';

const style = css({
  color: 'blue',
  fontSize: '16px'
});

<div class={style}>Content</div>
```

**Advantages**:
- ✅ Type-safe CSS objects (no template strings)
- ✅ Zero-runtime option
- ✅ Better tree-shaking
- ✅ Smaller bundle size

### vs Styled Components

**Styled Components**:
```typescript
import styled from 'styled-components';

const Button = styled.button`
  background: ${props => props.primary ? 'blue' : 'gray'};
  color: white;
`;

<Button primary>Click</Button>
```

**Aether**:
```typescript
import { styled } from 'aether/styles';

const Button = styled.button<{ primary?: boolean }>`
  background: ${props => props.primary ? 'blue' : 'gray'};
  color: white;
`;

<Button primary>Click</Button>
```

**Advantages**:
- ✅ Similar API (easy migration)
- ✅ Better TypeScript support
- ✅ Server-side rendering optimized
- ✅ Smaller runtime

### vs CSS Modules

**CSS Modules**:
```css
/* Button.module.css */
.button {
  background: blue;
  color: white;
}
```

```typescript
import styles from './Button.module.css';

<button className={styles.button}>Click</button>
```

**Aether**:
```typescript
// Same as above, plus:
// - Type-safe imports
// - Better dev experience
// - Automatic optimization
```

**Advantages**:
- ✅ Type-safe class names
- ✅ Better IntelliSense
- ✅ Auto-generated TypeScript definitions

## Advanced Patterns

### Variant System

Create a reusable variant system:

```typescript
import { css, variant } from 'aether/styles';

const button = variant({
  base: {
    padding: '10px 20px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer'
  },
  variants: {
    color: {
      primary: { background: 'blue', color: 'white' },
      secondary: { background: 'gray', color: 'white' },
      danger: { background: 'red', color: 'white' }
    },
    size: {
      small: { padding: '5px 10px', fontSize: '12px' },
      medium: { padding: '10px 20px', fontSize: '14px' },
      large: { padding: '15px 30px', fontSize: '16px' }
    },
    outlined: {
      true: {
        background: 'transparent',
        border: '2px solid currentColor'
      }
    }
  },
  compoundVariants: [
    {
      color: 'primary',
      outlined: true,
      style: { color: 'blue', borderColor: 'blue' }
    }
  ],
  defaultVariants: {
    color: 'primary',
    size: 'medium'
  }
});

<button class={button({ color: 'primary', size: 'large' })}>
  Click me
</button>
```

### Style Polymorphism

Create polymorphic styled components:

```typescript
import { styled } from 'aether/styles';

const Text = styled('span', {
  variants: {
    size: {
      sm: { fontSize: '14px' },
      md: { fontSize: '16px' },
      lg: { fontSize: '18px' }
    },
    weight: {
      normal: { fontWeight: 400 },
      medium: { fontWeight: 500 },
      bold: { fontWeight: 700 }
    }
  }
});

<Text as="h1" size="lg" weight="bold">Heading</Text>
<Text as="p" size="md">Paragraph</Text>
<Text as="span" size="sm">Small text</Text>
```

### CSS Mixins

Create reusable CSS mixins:

```typescript
import { css } from 'aether/styles';

const truncate = (lines = 1) => css({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical'
});

const visuallyHidden = css({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
});

const focusRing = css({
  '&:focus': {
    outline: '2px solid',
    outlineColor: 'blue',
    outlineOffset: '2px'
  }
});

// Usage
const style = css(
  truncate(2),
  focusRing
);
```

### Runtime Theme Switching

Switch themes at runtime:

```typescript
import { createTheme, setTheme } from 'aether/styles';

const lightTheme = createTheme({
  colors: {
    background: '#ffffff',
    text: '#000000'
  }
});

const darkTheme = createTheme({
  colors: {
    background: '#000000',
    text: '#ffffff'
  }
});

// Switch theme
theme.set(darkTheme);

// CSS automatically updates via CSS variables
```

### Atomic CSS

Generate atomic CSS utilities:

```typescript
import { atomicCss } from 'aether/styles';

const utilities = atomicCss({
  m: (value: string) => ({ margin: value }),
  p: (value: string) => ({ padding: value }),
  bg: (value: string) => ({ background: value }),
  text: (value: string) => ({ color: value })
});

<div class={utilities.m('10px') + ' ' + utilities.bg('blue')}>
  Content
</div>
```

## API Reference

### css

```typescript
function css(
  ...styles: (CSSObject | string | false | null | undefined)[]
): string;

interface CSSObject {
  [key: string]: string | number | CSSObject;
}
```

### styled

```typescript
function styled<T extends keyof JSX.IntrinsicElements>(
  tag: T,
  styles: CSSObject | TemplateStringsArray
): StyledComponent<T>;

interface StyledComponent<T> {
  (props: JSX.IntrinsicElements[T]): JSX.Element;
}
```

### keyframes

```typescript
function keyframes(frames: {
  [key: string]: CSSObject;
}): string;
```

### globalStyle

```typescript
function globalStyle(styles: string | CSSObject): void;
```

### variant

```typescript
function variant<V extends Record<string, Record<string, CSSObject>>>(config: {
  base?: CSSObject;
  variants?: V;
  compoundVariants?: Array<{
    [K in keyof V]?: keyof V[K];
  } & { style: CSSObject }>;
  defaultVariants?: {
    [K in keyof V]?: keyof V[K];
  };
}): (props: {
  [K in keyof V]?: keyof V[K];
}) => string;
```

## Examples

### Button Component

```typescript
// Button.tsx
import { styled, variant } from 'aether/styles';

const buttonVariants = variant({
  base: {
    padding: '10px 20px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.2s'
  },
  variants: {
    color: {
      primary: {
        background: 'blue',
        color: 'white',
        '&:hover': { background: 'darkblue' }
      },
      secondary: {
        background: 'gray',
        color: 'white',
        '&:hover': { background: 'darkgray' }
      },
      danger: {
        background: 'red',
        color: 'white',
        '&:hover': { background: 'darkred' }
      }
    },
    size: {
      small: { padding: '5px 10px', fontSize: '12px' },
      medium: { padding: '10px 20px', fontSize: '14px' },
      large: { padding: '15px 30px', fontSize: '16px' }
    },
    outlined: {
      true: {
        background: 'transparent',
        border: '2px solid currentColor'
      }
    }
  },
  compoundVariants: [
    {
      color: 'primary',
      outlined: true,
      style: { color: 'blue', borderColor: 'blue' }
    }
  ]
});

interface ButtonProps {
  color?: 'primary' | 'secondary' | 'danger';
  size?: 'small' | 'medium' | 'large';
  outlined?: boolean;
  children: any;
  onClick?: () => void;
}

export const Button = defineComponent<ButtonProps>((props) => {
  const className = computed(() => buttonVariants({
    color: props.color,
    size: props.size,
    outlined: props.outlined
  }));

  return () => (
    <button class={className()} onClick={props.onClick}>
      {props.children}
    </button>
  );
});
```

### Card Component

```typescript
// Card.tsx
import { css } from 'aether/styles';

const cardStyle = css({
  background: 'white',
  borderRadius: '8px',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  padding: '20px',
  transition: 'box-shadow 0.3s',

  '&:hover': {
    boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
  }
});

const headerStyle = css({
  fontSize: '20px',
  fontWeight: 600,
  marginBottom: '10px'
});

const contentStyle = css({
  color: '#666',
  lineHeight: 1.6
});

export const Card = defineComponent<{
  title: string;
  children: any;
}>((props) => {
  return () => (
    <div class={cardStyle}>
      <h3 class={headerStyle}>{props.title}</h3>
      <div class={contentStyle}>{props.children}</div>
    </div>
  );
});
```

### Responsive Grid

```typescript
// Grid.tsx
import { css } from 'aether/styles';

const gridStyle = css({
  display: 'grid',
  gap: '20px',
  gridTemplateColumns: '1fr',

  '@media (min-width: 768px)': {
    gridTemplateColumns: 'repeat(2, 1fr)'
  },

  '@media (min-width: 1024px)': {
    gridTemplateColumns: 'repeat(3, 1fr)'
  }
});

export const Grid = defineComponent<{ children: any }>((props) => {
  return () => <div class={gridStyle}>{props.children}</div>;
});
```

---

**Aether provides flexible, performant styling solutions** that work with your preferred approach. Whether you choose scoped styles, CSS Modules, CSS-in-JS, Tailwind, or Styled Components, you get the same great developer experience with type safety, theming support, and optimal performance.

**Next**: [15. Forms and Validation →](./15-FORMS.md)
