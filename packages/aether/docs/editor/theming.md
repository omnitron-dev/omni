# Theming Guide

Learn how to customize the appearance of the Advanced Editor.

## Table of Contents

- [Introduction](#introduction)
- [CSS Architecture](#css-architecture)
- [CSS Custom Properties](#css-custom-properties)
- [Component Styling](#component-styling)
- [Creating Custom Themes](#creating-custom-themes)
- [Dark Mode Support](#dark-mode-support)
- [Theme Examples](#theme-examples)
- [Best Practices](#best-practices)

---

## Introduction

The Advanced Editor uses a clean, modular CSS architecture that makes theming straightforward. The styling system is based on:

- **CSS Custom Properties** - For easy theme customization
- **BEM-style Classes** - For predictable, scoped styling
- **Minimal Base Styles** - Start with a clean slate
- **Composable Styles** - Mix and match components

**Design Philosophy:**

- Minimal opinionated styling
- Maximum flexibility for customization
- Performance-focused (minimal CSS)
- Accessible by default

---

## CSS Architecture

### Class Naming Convention

The editor follows a BEM-inspired naming convention:

```
.component-name           // Component root
.component-name__element  // Component element
.component-name--modifier // Component modifier
```

**Examples:**

```css
.prosemirror-editor              /* Editor root */
.prosemirror-editor__content     /* Editor content area */
.prosemirror-editor--focused     /* Focused state */

.toolbar                         /* Toolbar component */
.toolbar__button                 /* Toolbar button */
.toolbar__button--active         /* Active button */
.toolbar__divider                /* Toolbar divider */
```

### Component Structure

```
editor-container/
├── toolbar/                    // Toolbar component
│   ├── toolbar__button
│   ├── toolbar__dropdown
│   └── toolbar__divider
├── prosemirror-editor/         // Editor content
│   ├── ProseMirror             // ProseMirror default class
│   ├── ProseMirror-focused
│   └── ProseMirror-selectednode
├── bubble-menu/                // Bubble menu component
└── statusbar/                  // Status bar component
```

---

## CSS Custom Properties

The editor uses CSS custom properties (variables) for theming. All colors, sizes, and spacing can be customized.

### Color Variables

```css
:root {
  /* Primary colors */
  --editor-bg: #ffffff;
  --editor-text: #1a1a1a;
  --editor-border: #e0e0e0;

  /* Selection */
  --editor-selection-bg: #b4d5fe;
  --editor-selection-text: inherit;

  /* Toolbar */
  --toolbar-bg: #f5f5f5;
  --toolbar-border: #e0e0e0;
  --toolbar-button-bg: transparent;
  --toolbar-button-hover-bg: #e0e0e0;
  --toolbar-button-active-bg: #d0d0d0;
  --toolbar-button-text: #1a1a1a;

  /* Menu */
  --menu-bg: #ffffff;
  --menu-border: #e0e0e0;
  --menu-item-hover-bg: #f5f5f5;
  --menu-item-active-bg: #e0e0e0;

  /* Status bar */
  --statusbar-bg: #f5f5f5;
  --statusbar-border: #e0e0e0;
  --statusbar-text: #666666;

  /* Focus ring */
  --focus-ring-color: #4a90e2;
  --focus-ring-width: 2px;

  /* Code */
  --code-bg: #f5f5f5;
  --code-text: #e83e8c;
  --code-border: #e0e0e0;

  /* Code block */
  --code-block-bg: #282c34;
  --code-block-text: #abb2bf;
  --code-block-border: #3e4451;

  /* Links */
  --link-color: #4a90e2;
  --link-hover-color: #357abd;

  /* Tables */
  --table-border: #e0e0e0;
  --table-header-bg: #f5f5f5;
  --table-cell-bg: #ffffff;

  /* Blockquote */
  --blockquote-border: #e0e0e0;
  --blockquote-bg: #f9f9f9;
  --blockquote-text: #666666;

  /* Placeholder */
  --placeholder-color: #999999;

  /* Search */
  --search-highlight-bg: #fff3cd;
  --search-highlight-current-bg: #ffc107;
}
```

### Size Variables

```css
:root {
  /* Spacing */
  --editor-padding: 16px;
  --toolbar-padding: 8px;
  --statusbar-padding: 8px;

  /* Font sizes */
  --editor-font-size: 16px;
  --editor-line-height: 1.6;
  --toolbar-font-size: 14px;
  --statusbar-font-size: 12px;

  /* Component sizes */
  --toolbar-height: 44px;
  --statusbar-height: 32px;
  --button-size: 32px;
  --icon-size: 20px;

  /* Border radius */
  --border-radius: 4px;
  --border-radius-sm: 2px;
  --border-radius-lg: 8px;

  /* Borders */
  --border-width: 1px;
  --focus-ring-width: 2px;
}
```

### Typography Variables

```css
:root {
  /* Font families */
  --editor-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', Arial, sans-serif;
  --editor-code-font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono',
    Consolas, 'Courier New', monospace;

  /* Font weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Heading sizes */
  --h1-size: 2.5em;
  --h2-size: 2em;
  --h3-size: 1.75em;
  --h4-size: 1.5em;
  --h5-size: 1.25em;
  --h6-size: 1em;
}
```

---

## Component Styling

### Editor Container

```css
.prosemirror-editor {
  background: var(--editor-bg);
  color: var(--editor-text);
  font-family: var(--editor-font-family);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  padding: var(--editor-padding);
  border: var(--border-width) solid var(--editor-border);
  border-radius: var(--border-radius);
  min-height: 200px;
  outline: none;
}

.prosemirror-editor:focus {
  border-color: var(--focus-ring-color);
  box-shadow: 0 0 0 var(--focus-ring-width) rgba(74, 144, 226, 0.2);
}

/* Selection */
.prosemirror-editor ::selection {
  background: var(--editor-selection-bg);
  color: var(--editor-selection-text);
}
```

### Toolbar

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--toolbar-padding);
  background: var(--toolbar-bg);
  border: var(--border-width) solid var(--toolbar-border);
  border-radius: var(--border-radius);
  font-size: var(--toolbar-font-size);
}

.toolbar--sticky {
  position: sticky;
  top: 0;
  z-index: 10;
}

.toolbar__button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--button-size);
  height: var(--button-size);
  padding: 0;
  background: var(--toolbar-button-bg);
  color: var(--toolbar-button-text);
  border: none;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.toolbar__button:hover {
  background: var(--toolbar-button-hover-bg);
}

.toolbar__button:active,
.toolbar__button--active {
  background: var(--toolbar-button-active-bg);
}

.toolbar__button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar__divider {
  width: 1px;
  height: 24px;
  background: var(--toolbar-border);
  margin: 0 4px;
}

.toolbar__group {
  display: flex;
  gap: 2px;
}
```

### Bubble Menu

```css
.bubble-menu {
  position: absolute;
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--menu-bg);
  border: var(--border-width) solid var(--menu-border);
  border-radius: var(--border-radius);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 20;
}

.bubble-menu__button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--border-radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.bubble-menu__button:hover {
  background: var(--menu-item-hover-bg);
}

.bubble-menu__button--active {
  background: var(--menu-item-active-bg);
}
```

### Status Bar

```css
.statusbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--statusbar-padding);
  background: var(--statusbar-bg);
  border: var(--border-width) solid var(--statusbar-border);
  border-radius: var(--border-radius);
  font-size: var(--statusbar-font-size);
  color: var(--statusbar-text);
}

.statusbar__item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.statusbar__divider {
  width: 1px;
  height: 16px;
  background: var(--statusbar-border);
  margin: 0 8px;
}
```

### Content Nodes

```css
/* Paragraphs */
.prosemirror-editor p {
  margin: 0.75em 0;
}

/* Headings */
.prosemirror-editor h1 {
  font-size: var(--h1-size);
  font-weight: var(--font-weight-bold);
  margin: 1em 0 0.5em;
}

.prosemirror-editor h2 {
  font-size: var(--h2-size);
  font-weight: var(--font-weight-bold);
  margin: 0.83em 0 0.5em;
}

.prosemirror-editor h3 {
  font-size: var(--h3-size);
  font-weight: var(--font-weight-semibold);
  margin: 0.75em 0 0.5em;
}

/* Code */
.prosemirror-editor code {
  background: var(--code-bg);
  color: var(--code-text);
  padding: 2px 6px;
  border-radius: var(--border-radius-sm);
  font-family: var(--editor-code-font-family);
  font-size: 0.9em;
}

/* Code blocks */
.prosemirror-editor pre {
  background: var(--code-block-bg);
  color: var(--code-block-text);
  border: var(--border-width) solid var(--code-block-border);
  border-radius: var(--border-radius);
  padding: 12px 16px;
  overflow-x: auto;
  font-family: var(--editor-code-font-family);
  font-size: 0.9em;
  line-height: 1.5;
}

/* Blockquotes */
.prosemirror-editor blockquote {
  background: var(--blockquote-bg);
  color: var(--blockquote-text);
  border-left: 4px solid var(--blockquote-border);
  padding: 12px 16px;
  margin: 16px 0;
  font-style: italic;
}

/* Links */
.prosemirror-editor a {
  color: var(--link-color);
  text-decoration: underline;
  cursor: pointer;
}

.prosemirror-editor a:hover {
  color: var(--link-hover-color);
}

/* Lists */
.prosemirror-editor ul,
.prosemirror-editor ol {
  padding-left: 24px;
  margin: 0.75em 0;
}

.prosemirror-editor li {
  margin: 0.25em 0;
}

/* Tables */
.prosemirror-editor table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.prosemirror-editor th,
.prosemirror-editor td {
  border: var(--border-width) solid var(--table-border);
  padding: 8px 12px;
  text-align: left;
}

.prosemirror-editor th {
  background: var(--table-header-bg);
  font-weight: var(--font-weight-semibold);
}

.prosemirror-editor td {
  background: var(--table-cell-bg);
}

/* Horizontal rule */
.prosemirror-editor hr {
  border: none;
  border-top: var(--border-width) solid var(--editor-border);
  margin: 24px 0;
}

/* Placeholder */
.prosemirror-editor .is-empty::before {
  content: attr(data-placeholder);
  color: var(--placeholder-color);
  pointer-events: none;
  position: absolute;
}
```

### Search Highlights

```css
.prosemirror-editor .search-result {
  background: var(--search-highlight-bg);
  border-radius: var(--border-radius-sm);
}

.prosemirror-editor .search-result-current {
  background: var(--search-highlight-current-bg);
}
```

---

## Creating Custom Themes

### Method 1: Override CSS Variables

The simplest way to theme the editor is to override CSS variables:

```css
/* Custom theme: Oceanic */
.editor-oceanic {
  --editor-bg: #f0f8ff;
  --editor-text: #1e3a5f;
  --editor-border: #b0d4e8;

  --toolbar-bg: #e3f2fd;
  --toolbar-border: #b0d4e8;
  --toolbar-button-hover-bg: #d1e8f5;
  --toolbar-button-active-bg: #b0d4e8;

  --link-color: #0066cc;
  --link-hover-color: #0052a3;

  --code-block-bg: #263238;
  --code-block-text: #b2ccd6;
}
```

Apply the theme:

```typescript
jsx(AdvancedEditor, {
  class: 'editor-oceanic',
  // ...
});
```

### Method 2: Create a Theme File

Create a separate CSS file for your theme:

```css
/* themes/dark.css */
.editor-dark {
  /* Colors */
  --editor-bg: #1e1e1e;
  --editor-text: #d4d4d4;
  --editor-border: #3e3e3e;

  --editor-selection-bg: #264f78;

  /* Toolbar */
  --toolbar-bg: #252526;
  --toolbar-border: #3e3e3e;
  --toolbar-button-bg: transparent;
  --toolbar-button-hover-bg: #2d2d30;
  --toolbar-button-active-bg: #3e3e42;
  --toolbar-button-text: #cccccc;

  /* Menu */
  --menu-bg: #252526;
  --menu-border: #3e3e3e;
  --menu-item-hover-bg: #2d2d30;

  /* Status bar */
  --statusbar-bg: #252526;
  --statusbar-border: #3e3e3e;
  --statusbar-text: #8b8b8b;

  /* Code */
  --code-bg: #2d2d30;
  --code-text: #d7ba7d;

  /* Code block */
  --code-block-bg: #1e1e1e;
  --code-block-text: #d4d4d4;
  --code-block-border: #3e3e3e;

  /* Links */
  --link-color: #4fc3f7;
  --link-hover-color: #29b6f6;

  /* Tables */
  --table-border: #3e3e3e;
  --table-header-bg: #2d2d30;
  --table-cell-bg: #1e1e1e;

  /* Blockquote */
  --blockquote-border: #3e3e3e;
  --blockquote-bg: #2d2d30;
  --blockquote-text: #8b8b8b;

  /* Placeholder */
  --placeholder-color: #6a6a6a;

  /* Search */
  --search-highlight-bg: #515c6a;
  --search-highlight-current-bg: #6a7c8f;
}
```

Import and use:

```typescript
import './themes/dark.css';

jsx(AdvancedEditor, {
  class: 'editor-dark',
  // ...
});
```

### Method 3: Dynamic Theme Switching

Create a theme switcher component:

```typescript
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { computed } from '@omnitron-dev/aether/core/reactivity/computed';

const EditorWithTheme = defineComponent(() => {
  const theme = signal<'light' | 'dark'>('light');

  const editorClass = computed(() => {
    return theme() === 'dark' ? 'editor-dark' : 'editor-light';
  });

  const toggleTheme = () => {
    theme.set(theme() === 'light' ? 'dark' : 'light');
  };

  return () =>
    jsx('div', {
      children: [
        jsx('button', {
          onClick: toggleTheme,
          children: `Switch to ${theme() === 'light' ? 'dark' : 'light'} theme`,
        }),
        jsx(AdvancedEditor, {
          class: editorClass(),
          // ...
        }),
      ],
    });
}, 'EditorWithTheme');
```

---

## Dark Mode Support

### System Preference Detection

Use CSS media queries to respect system preferences:

```css
/* Light theme (default) */
:root {
  --editor-bg: #ffffff;
  --editor-text: #1a1a1a;
  /* ... */
}

/* Dark theme (system preference) */
@media (prefers-color-scheme: dark) {
  :root {
    --editor-bg: #1e1e1e;
    --editor-text: #d4d4d4;
    /* ... */
  }
}
```

### Manual Dark Mode Toggle

```typescript
import { signal } from '@omnitron-dev/aether/core/reactivity/signal';
import { onMount } from '@omnitron-dev/aether/core/component/lifecycle';

const DarkModeEditor = defineComponent(() => {
  const isDark = signal(false);

  onMount(() => {
    // Check system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    isDark.set(prefersDark);

    // Listen for changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      isDark.set(e.matches);
    };
    mediaQuery.addEventListener('change', listener);

    return () => {
      mediaQuery.removeEventListener('change', listener);
    };
  });

  return () =>
    jsx('div', {
      class: computed(() => (isDark() ? 'dark-mode' : 'light-mode')),
      children: jsx(AdvancedEditor, {
        // ...
      }),
    });
}, 'DarkModeEditor');
```

---

## Theme Examples

### Minimal Theme

Clean, minimal design with subtle colors:

```css
.editor-minimal {
  --editor-bg: #ffffff;
  --editor-text: #333333;
  --editor-border: #e8e8e8;

  --toolbar-bg: #ffffff;
  --toolbar-border: #e8e8e8;
  --toolbar-button-hover-bg: #f5f5f5;

  --border-radius: 2px;
  --editor-padding: 24px;
}
```

### Vibrant Theme

Bold, colorful design:

```css
.editor-vibrant {
  --editor-bg: #fff5f5;
  --editor-text: #2d3748;
  --editor-border: #fc8181;

  --toolbar-bg: #fed7d7;
  --toolbar-border: #fc8181;
  --toolbar-button-hover-bg: #feb2b2;
  --toolbar-button-active-bg: #fc8181;

  --link-color: #e53e3e;
  --link-hover-color: #c53030;

  --code-bg: #fef5e7;
  --code-text: #d69e2e;

  --border-radius: 8px;
}
```

### Monochrome Theme

Grayscale design:

```css
.editor-monochrome {
  --editor-bg: #ffffff;
  --editor-text: #000000;
  --editor-border: #999999;

  --toolbar-bg: #f0f0f0;
  --toolbar-border: #999999;
  --toolbar-button-hover-bg: #e0e0e0;
  --toolbar-button-active-bg: #d0d0d0;

  --link-color: #000000;
  --link-hover-color: #333333;

  --code-bg: #f0f0f0;
  --code-text: #000000;
  --code-block-bg: #000000;
  --code-block-text: #ffffff;
}
```

### Solarized Theme

Based on the popular Solarized color scheme:

```css
.editor-solarized-light {
  --editor-bg: #fdf6e3;
  --editor-text: #657b83;
  --editor-border: #eee8d5;

  --toolbar-bg: #eee8d5;
  --toolbar-border: #d3cbb7;
  --toolbar-button-hover-bg: #e5dcc3;

  --link-color: #268bd2;
  --link-hover-color: #2075b8;

  --code-bg: #eee8d5;
  --code-text: #dc322f;

  --code-block-bg: #002b36;
  --code-block-text: #839496;
}

.editor-solarized-dark {
  --editor-bg: #002b36;
  --editor-text: #839496;
  --editor-border: #073642;

  --toolbar-bg: #073642;
  --toolbar-border: #0d4753;
  --toolbar-button-hover-bg: #0f4d5a;

  --link-color: #268bd2;
  --link-hover-color: #2aa198;

  --code-bg: #073642;
  --code-text: #dc322f;

  --code-block-bg: #002b36;
  --code-block-text: #93a1a1;
}
```

### GitHub Theme

Inspired by GitHub's editor:

```css
.editor-github {
  --editor-bg: #ffffff;
  --editor-text: #24292e;
  --editor-border: #d1d5da;

  --toolbar-bg: #fafbfc;
  --toolbar-border: #d1d5da;
  --toolbar-button-hover-bg: #f3f4f6;
  --toolbar-button-active-bg: #edeff2;

  --link-color: #0366d6;
  --link-hover-color: #0256b5;

  --code-bg: #f6f8fa;
  --code-text: #d73a49;

  --code-block-bg: #f6f8fa;
  --code-block-text: #24292e;
  --code-block-border: #d1d5da;

  --border-radius: 6px;
}
```

---

## Best Practices

### 1. Use CSS Variables

Always use CSS variables for customization:

```css
/* Good */
.my-editor {
  background: var(--editor-bg);
}

/* Avoid */
.my-editor {
  background: #ffffff;
}
```

### 2. Namespace Your Themes

Prefix theme classes to avoid conflicts:

```css
/* Good */
.my-app-editor-dark { /* ... */ }

/* Avoid */
.dark { /* ... */ }
```

### 3. Maintain Contrast

Ensure sufficient contrast for accessibility:

```css
/* Good - 4.5:1 contrast ratio */
.editor-accessible {
  --editor-bg: #ffffff;
  --editor-text: #333333;
}

/* Avoid - low contrast */
.editor-low-contrast {
  --editor-bg: #f0f0f0;
  --editor-text: #c0c0c0;
}
```

### 4. Test Dark Mode

Always test your themes in both light and dark modes:

```css
/* Provide both */
.my-theme-light { /* ... */ }
.my-theme-dark { /* ... */ }

/* Or use media query */
@media (prefers-color-scheme: dark) {
  .my-theme {
    /* Dark mode overrides */
  }
}
```

### 5. Use Relative Units

Use relative units for better scalability:

```css
/* Good */
.my-editor {
  font-size: 1em;
  padding: 1rem;
}

/* Avoid */
.my-editor {
  font-size: 16px;
  padding: 16px;
}
```

### 6. Minimize Custom CSS

Prefer CSS variables over custom CSS:

```css
/* Good - uses variables */
.my-theme {
  --editor-bg: #f0f0f0;
}

/* Avoid - custom CSS */
.my-theme .prosemirror-editor {
  background: #f0f0f0;
  border: 1px solid #e0e0e0;
  padding: 16px;
}
```

### 7. Performance

Keep CSS selectors simple:

```css
/* Good */
.toolbar__button { /* ... */ }

/* Avoid */
div.editor-container > div.toolbar > button.toolbar__button { /* ... */ }
```

### 8. Print Styles

Provide print-friendly styles:

```css
@media print {
  .toolbar,
  .statusbar {
    display: none;
  }

  .prosemirror-editor {
    border: none;
    padding: 0;
    background: transparent;
  }
}
```

### 9. High Contrast Mode

Support high contrast mode:

```css
@media (prefers-contrast: high) {
  .prosemirror-editor {
    --editor-border: #000000;
    --toolbar-border: #000000;
    border-width: 2px;
  }
}
```

### 10. Responsive Design

Make the editor responsive:

```css
@media (max-width: 768px) {
  .toolbar {
    flex-wrap: wrap;
  }

  .prosemirror-editor {
    font-size: 14px;
    padding: 12px;
  }
}
```

---

## See Also

- **[Getting Started Guide](./getting-started.md)** - Installation and basic setup
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Extensions Guide](./extensions.md)** - Creating custom extensions
- **[Migration Guide](./migration.md)** - Migrating from other editors

---

**Last Updated:** 2025-10-16
**Package:** `@omnitron-dev/aether`
**Version:** 1.0.0
