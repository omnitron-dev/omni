### Avatar

User avatar display with image loading states and fallback support.

#### Features

- Image loading states (idle, loading, loaded, error)
- Fallback content when image fails to load
- Delayed fallback rendering
- Automatic image load/error handling
- Customizable via CSS

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Avatar } from 'aether/primitives';

export const UserAvatar = defineComponent(() => {
  return () => (
    <Avatar class="avatar">
      <Avatar.Image
        src="https://example.com/avatar.jpg"
        alt="John Doe"
      />
      <Avatar.Fallback class="avatar-fallback" delayMs={600}>
        JD
      </Avatar.Fallback>
    </Avatar>
  );
});
```

#### Styling Example

```css
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--color-background-secondary);
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--color-primary-500);
  color: white;
  font-weight: 600;
  font-size: 14px;
}
```

#### API Reference

**`<Avatar>`** - Avatar container

Props:
- `...HTMLAttributes` - Standard span props

**`<Avatar.Image>`** - Avatar image

Props:
- `src: string` - Image URL
- `alt: string` - Alt text
- `onLoad?: () => void` - Image load callback
- `onError?: () => void` - Image error callback

**`<Avatar.Fallback>`** - Fallback content

Props:
- `delayMs?: number` - Delay before showing fallback (default: 0)
- `...HTMLAttributes` - Standard span props

---

