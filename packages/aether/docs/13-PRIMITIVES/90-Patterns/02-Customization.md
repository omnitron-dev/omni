## Customization

### Styling Strategies

#### 1. Global CSS

```css
/* styles/primitives.css */
.dialog-overlay {
  background: rgba(0, 0, 0, 0.5);
}

.dialog-content {
  background: white;
  border-radius: 8px;
  padding: 24px;
}
```

#### 2. CSS Modules

```css
/* Dialog.module.css */
.overlay {
  background: rgba(0, 0, 0, 0.5);
}

.content {
  background: white;
  border-radius: 8px;
}
```

```typescript
import { defineComponent } from 'aether';
import styles from './Dialog.module.css';

const Example969 = defineComponent(() => {

  return () => (
    <Dialog.Overlay class={styles.overlay} />
    <Dialog.Content class={styles.content}>
      <!-- ... -->
    </Dialog.Content>
  );
});
```

#### 3. Tailwind CSS

```html
<Dialog.Overlay class="fixed inset-0 bg-black/50 backdrop-blur-sm" />
<Dialog.Content class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-lg shadow-xl p-6">
  <!-- ... -->
</Dialog.Content>
```

#### 4. CSS-in-JS (styled components)

```typescript
import { styled } from 'aether/styled';

const StyledOverlay = styled(Dialog.Overlay, {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)'
});

const StyledContent = styled(Dialog.Content, {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'white',
  borderRadius: '$md',
  padding: '$6'
});
```

### Creating Styled Wrapper Components

Build your own component library on top of primitives:

```typescript
// components/ui/Button.tsx
import { defineComponent } from 'aether';
import type { ComponentProps } from 'aether';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = defineComponent<ButtonProps>((props) => {
  const { variant = 'primary', size = 'md', class: className, ...rest } = props;

  const classes = computed(() => {
    return [
      'btn',
      `btn-${variant()}`,
      `btn-${size()}`,
      className?.()
    ].filter(Boolean).join(' ');
  });

  return () => (
    <button class={classes()} {...rest}>
      <slot />
    </button>
  );
});
```

```typescript
// components/ui/Dialog.tsx
import * as DialogPrimitive from 'aether/primitives/dialog';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogContent = defineComponent((props) => {
  return () => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="dialog-overlay" />
      <DialogPrimitive.Content class="dialog-content" {...props}>
        <slot />
        <DialogPrimitive.Close class="dialog-close">
          <XIcon />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
```

Usage:

```typescript
import { defineComponent } from 'aether';
import { Dialog, DialogTrigger, DialogContent } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

const Example43 = defineComponent(() => {

  return () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <h2>Dialog Title</h2>
        <p>Dialog content here</p>
      </DialogContent>
    </Dialog>
  );
});
```

---

