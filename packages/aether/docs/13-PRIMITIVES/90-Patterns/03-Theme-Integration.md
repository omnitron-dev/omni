## Theme Integration

Primitives automatically integrate with the Aether theming system:

```typescript
// theme.ts
export const LightTheme = defineTheme({
  name: 'light',
  colors: {
    primary: {
      500: '#0ea5e9'
    },
    background: {
      primary: '#ffffff',
      secondary: '#f8fafc'
    },
    border: '#e2e8f0'
  },
  radii: {
    md: '0.375rem',
    lg: '0.5rem'
  },
  spacing: {
    4: '1rem',
    6: '1.5rem'
  },
  shadows: {
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
  }
});
```

```css
/* Primitives use CSS variables from theme */
.dialog-content {
  background: var(--color-background-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--spacing-6);
}
```

---

