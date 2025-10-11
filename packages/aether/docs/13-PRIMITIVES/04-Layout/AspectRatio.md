### AspectRatio

Maintain consistent aspect ratios for images, videos, and embeds.

#### Features

- Maintains aspect ratio regardless of container size
- Responsive by default
- Supports custom ratios
- Common presets (16/9, 4/3, 1/1, 3/2, 21/9)

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { AspectRatio } from 'aether/primitives';

// 16:9 video embed
export const VideoEmbed = defineComponent(() => {
  return () => (
    <AspectRatio ratio={16 / 9}>
      <iframe
        src="https://www.youtube.com/embed/..."
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </AspectRatio>
  );
});

// Square image
export const SquareImage = defineComponent(() => {
  return () => (
    <AspectRatio ratio={1}>
      <img
        src="/product.jpg"
        alt="Product"
        style={{ objectFit: 'cover' }}
      />
    </AspectRatio>
  );
});

// Ultra-wide banner
export const Banner = defineComponent(() => {
  return () => (
    <AspectRatio ratio={21 / 9}>
      <img
        src="/banner.jpg"
        alt="Banner"
        style={{ objectFit: 'cover' }}
      />
    </AspectRatio>
  );
});
```

#### Styling Example

```css
/* AspectRatio renders with position: relative by default */
/* Child content is absolutely positioned */

.aspect-ratio-container {
  max-width: 600px;
}

.aspect-ratio-container img,
.aspect-ratio-container iframe,
.aspect-ratio-container video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: none;
}
```

#### API Reference

**`<AspectRatio>`** - Aspect ratio container

Props:
- `ratio: number` - Aspect ratio (width / height), e.g., 16/9 = 1.777...
- `...HTMLAttributes` - Standard div props

Common ratios:
- `1` - Square (1:1)
- `4/3` - Standard (1.333...)
- `16/9` - Widescreen (1.777...)
- `3/2` - Classic photo (1.5)
- `21/9` - Ultra-wide (2.333...)

---

