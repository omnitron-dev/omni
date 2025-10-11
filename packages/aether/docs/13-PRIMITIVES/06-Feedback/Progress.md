### Progress

Progress bars with determinate and indeterminate states.

#### Features

- Determinate (value 0-100) and indeterminate (loading) modes
- WAI-ARIA progressbar pattern
- Custom value label formatting
- Configurable max value
- Accessible to screen readers

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Progress } from 'aether/primitives';

// Determinate progress
export const FileUpload = defineComponent(() => {
  const uploadProgress = signal(45);

  return () => (
    <div class="upload-container">
      <span>Uploading... {uploadProgress()}%</span>
      <Progress value={uploadProgress()} class="progress">
        <Progress.Indicator class="progress-indicator" />
      </Progress>
    </div>
  );
});

// Indeterminate progress
export const Loading = defineComponent(() => {
  return () => (
    <Progress value={null} class="progress">
      <Progress.Indicator class="progress-indicator" />
    </Progress>
  );
});

// Custom value label
export const CustomProgress = defineComponent(() => {
  const value = signal(75);

  return () => (
    <Progress
      value={value()}
      max={100}
      getValueLabel={(v, max) => `${v} of ${max} items`}
      class="progress"
    >
      <Progress.Indicator class="progress-indicator" />
    </Progress>
  );
});
```

#### Styling Example

```css
.progress {
  position: relative;
  width: 100%;
  height: 8px;
  background: var(--color-background-secondary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-indicator {
  width: 100%;
  height: 100%;
  background: var(--color-primary-500);
  transition: transform 200ms ease;
}

/* Indeterminate animation */
.progress[data-state="indeterminate"] .progress-indicator {
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(100%);
  }
}
```

#### API Reference

**`<Progress>`** - Progress container

Props:
- `value: number | null` - Progress value (0-max) or null for indeterminate
- `max?: number` - Maximum value (default: 100)
- `getValueLabel?: (value: number, max: number) => string` - Custom label formatter
- `...HTMLAttributes` - Standard div props

**`<Progress.Indicator>`** - Progress indicator bar

Props:
- `...HTMLAttributes` - Standard div props

---

