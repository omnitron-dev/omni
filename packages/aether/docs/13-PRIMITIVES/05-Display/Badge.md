### Badge

Status badge for notifications, counts, and status indicators.

#### Features

- Simple, lightweight component
- ARIA live region for screen readers
- Customizable via CSS
- Works with any content (text, numbers, icons)

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Badge } from 'aether/primitives';

export const NotificationBadge = defineComponent(() => {
  return () => (
    <div class="notification-container">
      <BellIcon />
      <Badge class="badge">3</Badge>
    </div>
  );
});

// Status badges
export const StatusBadges = defineComponent(() => {
  return () => (
    <div class="status-list">
      <Badge class="badge badge-success">Active</Badge>
      <Badge class="badge badge-warning">Pending</Badge>
      <Badge class="badge badge-error">Failed</Badge>
    </div>
  );
});
```

#### Styling Example

```css
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 12px;
  background: var(--color-primary-500);
  color: white;
}

.badge-success {
  background: var(--color-success-500);
}

.badge-warning {
  background: var(--color-warning-500);
}

.badge-error {
  background: var(--color-error-500);
}

/* Notification badge */
.notification-container {
  position: relative;
  display: inline-flex;
}

.notification-container .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
}
```

#### API Reference

**`<Badge>`** - Badge component

Props:
- `...HTMLAttributes` - Standard span props

---

