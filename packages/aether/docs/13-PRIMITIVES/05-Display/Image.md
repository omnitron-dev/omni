### Image

Advanced image component with lazy loading, fallback support, and loading states.

#### Features

- Lazy loading with Intersection Observer
- Loading states (idle, loading, loaded, error)
- Fallback image support
- Object-fit modes (cover, contain, fill, etc.)
- Custom placeholder while loading
- Error handling with retry
- ARIA support for accessibility

#### Basic Usage

```typescript
import { defineComponent } from 'aether';
import { Image } from 'aether/primitives';

const Example226 = defineComponent(() => {
  return () => (
    <Image
      src="/images/hero.jpg"
      alt="Hero image"
      fallbackSrc="/images/placeholder.jpg"
      fit="cover"
      lazy={true}
      class="hero-image"
    />
  );
});
```

#### Advanced Usage

```typescript
// With loading states and error handling
const Example227 = defineComponent(() => {
  const handleLoad = () => {
    console.log('Image loaded successfully');
  };

  const handleError = (error: Event) => {
    console.error('Failed to load image:', error);
  };

  return () => (
    <Image
      src="/images/large-photo.jpg"
      alt="Large photo"
      fallbackSrc="/images/error-placeholder.jpg"
      fit="contain"
      lazy={true}
      onLoad={handleLoad}
      onError={handleError}
      style={{
        width: '100%',
        height: 'auto',
        borderRadius: '8px'
      }}
    />
  );
});

// Gallery with lazy loading
const Example228 = defineComponent(() => {
  const images = signal([
    { id: 1, src: '/gallery/1.jpg', alt: 'Photo 1' },
    { id: 2, src: '/gallery/2.jpg', alt: 'Photo 2' },
    { id: 3, src: '/gallery/3.jpg', alt: 'Photo 3' },
    // ... more images
  ]);

  return () => (
    <div class="gallery-grid">
      <For each={images()}>
        {(image) => (
          <Image
            src={image.src}
            alt={image.alt}
            fallbackSrc="/placeholder.jpg"
            fit="cover"
            lazy={true}
            class="gallery-item"
          />
        )}
      </For>
    </div>
  );
});
```

**API:**

**`<Image>`** - Image component
- `src: string` - Image source URL
- `alt: string` - Alternative text
- `fallbackSrc?: string` - Fallback image on error
- `fit?: 'fill' | 'contain' | 'cover' | 'none' | 'scale-down'` - Object-fit mode (default: 'cover')
- `lazy?: boolean` - Enable lazy loading (default: true)
- `onLoad?: () => void` - Load success callback
- `onError?: (error: Event) => void` - Load error callback

---

