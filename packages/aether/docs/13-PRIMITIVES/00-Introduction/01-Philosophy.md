## Philosophy

### Why Headless Components?

Traditional component libraries couple **behavior** with **presentation**, leading to:

**Problems**:
- **Limited Customization**: Hard to override styles without `!important` hacks
- **Bundle Bloat**: Shipping CSS you might not use
- **Design Lock-in**: Forced to use the library's design system
- **Accessibility Gaps**: Often bolted on as an afterthought
- **Framework Coupling**: Tied to specific styling solutions (CSS-in-JS, CSS Modules, etc.)

**Aether Primitives Solution**:
```typescript
// Headless = Unstyled but fully functional + accessible
import { Dialog } from 'aether/primitives';

// You control 100% of the presentation
<Dialog>
  <Dialog.Trigger class="my-button">Open</Dialog.Trigger>
  <Dialog.Content class="my-modal">
    <Dialog.Title class="my-title">Welcome</Dialog.Title>
    <Dialog.Description class="my-text">
      This is your custom styled modal
    </Dialog.Description>
    <Dialog.Close class="my-close-btn">Close</Dialog.Close>
  </Dialog.Content>
</Dialog>
```

**Benefits**:
- **Full Design Control**: Style with CSS, Tailwind, theme tokens, anything
- **Zero Bundle Overhead**: No unused CSS shipped to production
- **Accessibility First**: WAI-ARIA compliant out of the box
- **Composable**: Build complex UIs from simple primitives
- **Type-Safe**: Full TypeScript support with autocomplete
- **Framework Coherent**: Integrates with Aether reactivity and DI

### Headless vs Traditional Libraries

| Aspect | Traditional (Material-UI) | Headless (Aether Primitives) |
|--------|---------------------------|------------------------------|
| **Styling** | Pre-styled (theme overrides) | Unstyled (you provide all styles) |
| **Bundle Size** | 150KB+ (with styles) | 12KB (behavior only) |
| **Customization** | Theme API, `sx` prop, CSS override | Direct CSS/Tailwind/CSS-in-JS |
| **Accessibility** | Variable (community maintained) | Built-in (WAI-ARIA by design) |
| **Learning Curve** | Library-specific API + theme system | Web standards + small API surface |
| **Design System** | Material Design by default | Your design system |

### Inspiration

Aether Primitives draws from the best:

- **Radix UI**: WAI-ARIA compliance, composable API
- **Headless UI**: Simplicity, framework integration
- **Ark UI**: Advanced state machines, framework agnostic
- **React Aria**: Adobe's accessibility expertise
- **shadcn/ui**: Developer experience, copy-paste philosophy

**But with Aether advantages**:
- Fine-grained reactivity (no Virtual DOM overhead)
- Compile-time optimizations
- Deep TypeScript integration
- Unified with Aether DI and theming
- SSR/Islands architecture support

---

