# Aether Examples & Recipes

> **Status**: ✅ Phase 3 - Examples & Recipes
> **Last Updated**: 2025-10-07

This directory contains practical examples and recipes for building applications with Aether's TypeScript JSX + Utilities approach.

## 📁 Directory Structure

```
examples/
├── components/     # Reusable component examples
├── patterns/       # Common patterns cookbook
├── forms/          # Form handling examples
├── animations/     # Animation patterns
└── directives/     # Custom directive examples
```

## 🎯 What You'll Find

### 1. Components Examples

Production-ready component examples using Aether utilities:

- **Button** - Variant-based button with full utility integration
- **Input** - Form input with validation and binding
- **Modal** - Modal dialog with focus trap and click-outside
- **Dropdown** - Dropdown menu with keyboard navigation
- **Tabs** - Tab component with keyboard support
- **Tooltip** - Positioned tooltip component
- **Card** - Card component with variants

**Location**: [`components/`](./components/)

### 2. Common Patterns Cookbook

Cookbook of common development patterns:

- **Responsive Design** - Using utilities for responsive layouts
- **Theme Switching** - Dark/light theme implementation
- **Data Fetching** - Loading states and error handling
- **Infinite Scroll** - Virtual scrolling with intersection observer
- **Optimistic Updates** - UI updates before server confirmation
- **Debounced Search** - Search with debouncing
- **Form Validation** - Real-time form validation patterns

**Location**: [`patterns/`](./patterns/)

### 3. Form Handling Examples

Complete form examples with validation:

- **Login Form** - Simple login with validation
- **Registration Form** - Multi-field registration
- **Complex Form** - Multi-step form with conditional fields
- **Dynamic Form** - Form with dynamic field generation
- **File Upload** - File upload with progress

**Location**: [`forms/`](./forms/)

### 4. Animation Patterns

Animation examples (no custom compiler needed):

- **Fade Transitions** - Fade in/out with CSS
- **Slide Animations** - Slide transitions
- **List Transitions** - Animated list additions/removals
- **Page Transitions** - Route transition animations
- **Gesture Animations** - Swipe and drag animations

**Location**: [`animations/`](./animations/)

### 5. Custom Directive Examples

Advanced custom directive patterns:

- **Form Validation Directive** - Inline validation
- **Auto-save Directive** - Auto-save form data
- **Drag and Drop Directive** - Drag and drop functionality
- **Infinite Scroll Directive** - Infinite scrolling
- **Keyboard Shortcut Directive** - Global keyboard shortcuts
- **Copy to Clipboard Directive** - Click to copy

**Location**: [`directives/`](./directives/)

## 🚀 Quick Start

All examples are production-ready and can be copied directly into your project.

### Running Examples

Examples are tested and documented. To use an example:

1. Copy the component file to your project
2. Install any required dependencies
3. Import and use in your application

```typescript
import { Button } from './examples/components/Button';

const App = defineComponent(() => {
  return () => (
    <Button variant="primary" size="md" onClick={() => console.log('clicked')}>
      Click Me
    </Button>
  );
});
```

## 📚 Learning Path

**Beginners**: Start with `components/` to see how utilities work in practice

**Intermediate**: Explore `patterns/` for common development patterns

**Advanced**: Check `directives/` for custom directive creation

## 🧪 Testing

All examples include:
- ✅ TypeScript type safety
- ✅ Unit tests (where applicable)
- ✅ Usage documentation
- ✅ Best practices notes

## 💡 Philosophy

These examples demonstrate:

1. **No Magic** - Everything is standard TypeScript/JSX
2. **Type Safe** - Full TypeScript support
3. **Composable** - Utilities combine naturally
4. **Testable** - Easy to test without special setup
5. **Production Ready** - Real-world, battle-tested patterns

## 🔗 Related Documentation

- [04-TEMPLATE-SYNTAX.md](../04-TEMPLATE-SYNTAX.md) - Template syntax guide
- [05-DIRECTIVES.md](../05-DIRECTIVES.md) - Directives documentation
- [TEMPLATE-DIRECTIVES-EVALUATION.md](../TEMPLATE-DIRECTIVES-EVALUATION.md) - Architecture decision

## 🤝 Contributing Examples

When adding examples:

1. **Keep it simple** - Focus on one concept
2. **Add types** - Full TypeScript types required
3. **Document well** - Explain why, not just what
4. **Test it** - Include tests if complex
5. **Follow patterns** - Use existing examples as templates

---

**Ready to explore?** Start with [`components/Button.tsx`](./components/Button.tsx) to see a complete example!
