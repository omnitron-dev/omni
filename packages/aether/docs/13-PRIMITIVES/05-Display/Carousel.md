### Carousel

A carousel/slider component for cycling through content with support for autoplay, keyboard navigation, and loop mode.

#### Features

- Horizontal and vertical orientation
- Autoplay with configurable interval
- Loop mode for infinite scrolling
- Keyboard navigation (arrows)
- Previous/Next controls
- Dot indicators
- ARIA carousel pattern
- Slide-based navigation
- Controlled and uncontrolled modes

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Carousel } from 'aether/primitives';

const Example = defineComponent(() => {
  const currentSlide = signal(0);

  return () => (
    <Carousel value={currentSlide()} onValueChange={currentSlide} loop>
      <Carousel.Viewport class="carousel-viewport">
        <Carousel.Slide class="carousel-slide">
          <img src="/images/slide-1.jpg" alt="Slide 1" />
        </Carousel.Slide>
        <Carousel.Slide class="carousel-slide">
          <img src="/images/slide-2.jpg" alt="Slide 2" />
        </Carousel.Slide>
        <Carousel.Slide class="carousel-slide">
          <img src="/images/slide-3.jpg" alt="Slide 3" />
        </Carousel.Slide>
      </Carousel.Viewport>

      <Carousel.Previous class="carousel-btn carousel-prev">
        ←
      </Carousel.Previous>
      <Carousel.Next class="carousel-btn carousel-next">
        →
      </Carousel.Next>

      <Carousel.Indicators class="carousel-indicators" />
    </Carousel>
  );
});
```

#### With Autoplay

```typescript
const Example = defineComponent(() => {
  return () => (
    <Carousel autoplay={3000} loop>
      <Carousel.Viewport>
        <Carousel.Slide>Slide 1</Carousel.Slide>
        <Carousel.Slide>Slide 2</Carousel.Slide>
        <Carousel.Slide>Slide 3</Carousel.Slide>
      </Carousel.Viewport>

      <Carousel.Indicators />
    </Carousel>
  );
});
```

#### API

**`<Carousel>`** - Root component
- `value?: number` - Controlled slide index
- `onValueChange?: (index: number) => void` - Index change callback
- `defaultValue?: number` - Default slide index (uncontrolled)
- `loop?: boolean` - Enable loop mode (default: false)
- `autoplay?: number` - Autoplay interval in ms (0 = disabled)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')

**`<Carousel.Viewport>`** - Container for slides with overflow management

**`<Carousel.Slide>`** - Individual slide content

**`<Carousel.Previous>`** - Previous slide button

**`<Carousel.Next>`** - Next slide button

**`<Carousel.Indicators>`** - Dot indicators for each slide

---

