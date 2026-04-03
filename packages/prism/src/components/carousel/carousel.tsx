'use client';

/**
 * Carousel Component
 *
 * Responsive slider with autoplay, navigation arrows, dots,
 * and touch/drag support.
 *
 * @module @omnitron/prism/components/carousel
 */

import type { CarouselProps } from './types.js';

import { useState, useEffect, useCallback, useRef, Children, useMemo } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { styled, alpha } from '@mui/material/styles';

// MUI Icons
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import { cn } from '../../utils/cn.js';
import { carouselClasses } from './classes.js';

// =============================================================================
// CAROUSEL COMPONENT
// =============================================================================

/**
 * Responsive carousel/slider component.
 *
 * @example
 * ```tsx
 * import { Carousel } from '@omnitron/prism/components';
 *
 * function Gallery() {
 *   return (
 *     <Carousel
 *       slidesToShow={3}
 *       spacing={16}
 *       autoplay
 *       arrows
 *       dots
 *     >
 *       {images.map((img, i) => (
 *         <img key={i} src={img.src} alt={img.alt} />
 *       ))}
 *     </Carousel>
 *   );
 * }
 * ```
 */
export function Carousel({
  children,
  slidesToShow = 1,
  slidesToScroll = 1,
  spacing = 0,
  autoplay = false,
  autoplayInterval = 4000,
  pauseOnHover = true,
  loop = false,
  draggable = true,
  speed = 400,
  direction = 'horizontal',
  arrows = true,
  dots = false,
  dotsPosition = 'bottom',
  keyboard = true,
  initialSlide = 0,
  onSlideChange,
  centerMode = false,
  fade = false,
  responsive,
  sx,
  slotProps,
  className,
  ...other
}: CarouselProps) {
  // State
  const [currentIndex, setCurrentIndex] = useState(initialSlide);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Responsive settings
  const [activeSettings, setActiveSettings] = useState({
    slidesToShow,
    slidesToScroll,
    spacing,
    arrows,
    dots,
  });

  // Get slides from children
  const slides = Children.toArray(children);
  const totalSlides = slides.length;

  // Calculate settings based on responsive breakpoints
  useEffect(() => {
    if (!responsive?.length) {
      setActiveSettings({ slidesToShow, slidesToScroll, spacing, arrows, dots });
      return undefined;
    }

    const handleResize = () => {
      const width = window.innerWidth;
      let newSettings = { slidesToShow, slidesToScroll, spacing, arrows, dots };

      // Find matching breakpoint (smallest matching)
      const sortedBreakpoints = [...responsive].sort((a, b) => a.breakpoint - b.breakpoint);
      for (const bp of sortedBreakpoints) {
        if (width <= bp.breakpoint) {
          newSettings = { ...newSettings, ...bp.settings };
          break;
        }
      }

      setActiveSettings(newSettings);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [responsive, slidesToShow, slidesToScroll, spacing, arrows, dots]);

  // Calculate dimensions
  const maxIndex = Math.max(0, totalSlides - activeSettings.slidesToShow);
  const canPrev = loop || currentIndex > 0;
  const canNext = loop || currentIndex < maxIndex;
  const isHorizontal = direction === 'horizontal';

  // Calculate slide width percentage
  const slideWidth = useMemo(() => {
    if (activeSettings.slidesToShow <= 0) return 100;
    return 100 / activeSettings.slidesToShow;
  }, [activeSettings.slidesToShow]);

  // Track container width for drag calculations
  useEffect(() => {
    if (!containerRef.current) return undefined;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Navigation
  const goTo = useCallback(
    (index: number) => {
      let newIndex = index;

      if (loop) {
        if (index < 0) {
          newIndex = maxIndex;
        } else if (index > maxIndex) {
          newIndex = 0;
        }
      } else {
        newIndex = Math.max(0, Math.min(index, maxIndex));
      }

      setCurrentIndex(newIndex);
      onSlideChange?.(newIndex);
    },
    [loop, maxIndex, onSlideChange]
  );

  const next = useCallback(() => {
    if (canNext) {
      goTo(currentIndex + activeSettings.slidesToScroll);
    }
  }, [canNext, currentIndex, activeSettings.slidesToScroll, goTo]);

  const prev = useCallback(() => {
    if (canPrev) {
      goTo(currentIndex - activeSettings.slidesToScroll);
    }
  }, [canPrev, currentIndex, activeSettings.slidesToScroll, goTo]);

  // Autoplay
  useEffect(() => {
    if (isPlaying && totalSlides > activeSettings.slidesToShow) {
      autoplayRef.current = setInterval(next, autoplayInterval);
      return () => {
        if (autoplayRef.current) clearInterval(autoplayRef.current);
      };
    }
    return undefined;
  }, [isPlaying, totalSlides, activeSettings.slidesToShow, autoplayInterval, next]);

  // Pause on hover
  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover && autoplay) {
      setIsPlaying(false);
    }
  }, [pauseOnHover, autoplay]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover && autoplay) {
      setIsPlaying(true);
    }
  }, [pauseOnHover, autoplay]);

  // Keyboard navigation
  useEffect(() => {
    if (!keyboard) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return;

      if (isHorizontal) {
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
      } else {
        if (e.key === 'ArrowUp') prev();
        if (e.key === 'ArrowDown') next();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keyboard, isHorizontal, prev, next]);

  // Drag/Touch handlers
  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggable) return;
      setIsDragging(true);
      dragStartRef.current = { x: clientX, y: clientY };
      setDragOffset(0);
    },
    [draggable]
  );

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging) return;
      const delta = isHorizontal ? clientX - dragStartRef.current.x : clientY - dragStartRef.current.y;
      setDragOffset(delta);
    },
    [isDragging, isHorizontal]
  );

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const threshold = containerWidth * 0.15; // 15% threshold
    if (Math.abs(dragOffset) > threshold) {
      if (dragOffset > 0) {
        prev();
      } else {
        next();
      }
    }

    setDragOffset(0);
  }, [isDragging, containerWidth, dragOffset, prev, next]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleDragStart(e.clientX, e.clientY);
    },
    [handleDragStart]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    },
    [handleDragMove]
  );

  const handleMouseUp = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Touch handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragStart(touch.clientX, touch.clientY);
    },
    [handleDragStart]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleDragMove(touch.clientX, touch.clientY);
    },
    [handleDragMove]
  );

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // Calculate track transform
  const trackTransform = useMemo(() => {
    const baseOffset = currentIndex * slideWidth;
    const dragPercent = containerWidth > 0 ? (dragOffset / containerWidth) * 100 : 0;

    if (fade) return 'none';

    if (isHorizontal) {
      return `translateX(calc(-${baseOffset}% + ${dragPercent}%))`;
    }
    return `translateY(calc(-${baseOffset}% + ${dragPercent}%))`;
  }, [currentIndex, slideWidth, dragOffset, containerWidth, fade, isHorizontal]);

  // Dots count (number of pages)
  const dotsCount = Math.ceil(totalSlides / activeSettings.slidesToScroll);

  return (
    <CarouselRoot
      ref={containerRef}
      className={cn(
        carouselClasses.root,
        isHorizontal ? carouselClasses.horizontal : carouselClasses.vertical,
        isDragging && carouselClasses.dragging,
        fade && carouselClasses.fade,
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      tabIndex={0}
      sx={sx}
      {...other}
    >
      <CarouselContainer className={carouselClasses.container} sx={slotProps?.container}>
        <CarouselTrack
          ref={trackRef}
          className={carouselClasses.track}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          sx={{
            ...slotProps?.track,
            transform: trackTransform,
            transition: isDragging ? 'none' : `transform ${speed}ms ease`,
            flexDirection: isHorizontal ? 'row' : 'column',
            cursor: draggable ? (isDragging ? 'grabbing' : 'grab') : 'default',
          }}
        >
          {slides.map((slide, index) => (
            <CarouselSlide
              key={index}
              className={cn(carouselClasses.slide, {
                [carouselClasses.slideActive]: index === currentIndex,
              })}
              sx={{
                ...slotProps?.slide,
                width: isHorizontal ? `${slideWidth}%` : '100%',
                height: !isHorizontal ? `${slideWidth}%` : 'auto',
                padding: isHorizontal ? `0 ${activeSettings.spacing / 2}px` : `${activeSettings.spacing / 2}px 0`,
                opacity: fade ? (index === currentIndex ? 1 : 0) : 1,
                transition: fade ? `opacity ${speed}ms ease` : 'none',
                position: fade ? (index === currentIndex ? 'relative' : 'absolute') : 'relative',
                ...(fade && { top: 0, left: 0 }),
              }}
            >
              {slide}
            </CarouselSlide>
          ))}
        </CarouselTrack>
      </CarouselContainer>

      {/* Navigation Arrows */}
      {activeSettings.arrows && totalSlides > activeSettings.slidesToShow && (
        <>
          <ArrowButton
            className={cn(carouselClasses.arrow, carouselClasses.arrowPrev, {
              [carouselClasses.arrowDisabled]: !canPrev,
            })}
            onClick={prev}
            disabled={!canPrev}
            aria-label="Previous slide"
            isHorizontal={isHorizontal}
            direction="prev"
            sx={slotProps?.arrow}
          >
            {isHorizontal ? <ChevronLeftIcon /> : <KeyboardArrowUpIcon />}
          </ArrowButton>
          <ArrowButton
            className={cn(carouselClasses.arrow, carouselClasses.arrowNext, {
              [carouselClasses.arrowDisabled]: !canNext,
            })}
            onClick={next}
            disabled={!canNext}
            aria-label="Next slide"
            isHorizontal={isHorizontal}
            direction="next"
            sx={slotProps?.arrow}
          >
            {isHorizontal ? <ChevronRightIcon /> : <KeyboardArrowDownIcon />}
          </ArrowButton>
        </>
      )}

      {/* Dots Indicator */}
      {activeSettings.dots && totalSlides > activeSettings.slidesToShow && (
        <DotsContainer
          className={cn(carouselClasses.dots, {
            [carouselClasses.dotsTop]: dotsPosition === 'top',
            [carouselClasses.dotsBottom]: dotsPosition === 'bottom',
            [carouselClasses.dotsLeft]: dotsPosition === 'left',
            [carouselClasses.dotsRight]: dotsPosition === 'right',
          })}
          dotsPosition={dotsPosition}
          sx={slotProps?.dots}
        >
          {Array.from({ length: dotsCount }, (_, i) => (
            <Dot
              key={i}
              className={cn(carouselClasses.dot, {
                [carouselClasses.dotActive]: Math.floor(currentIndex / activeSettings.slidesToScroll) === i,
              })}
              active={Math.floor(currentIndex / activeSettings.slidesToScroll) === i}
              onClick={() => goTo(i * activeSettings.slidesToScroll)}
              aria-label={`Go to slide ${i + 1}`}
              sx={slotProps?.dot}
            />
          ))}
        </DotsContainer>
      )}
    </CarouselRoot>
  );
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const CarouselRoot = styled(Box)({
  position: 'relative',
  width: '100%',
  overflow: 'hidden',
  outline: 'none',
});

const CarouselContainer = styled(Box)({
  position: 'relative',
  width: '100%',
  overflow: 'hidden',
});

const CarouselTrack = styled(Box)({
  display: 'flex',
  width: '100%',
  willChange: 'transform',
  userSelect: 'none',
});

const CarouselSlide = styled(Box)({
  flexShrink: 0,
  '& > *': {
    width: '100%',
    height: '100%',
  },
});

const ArrowButton = styled(IconButton)<{ isHorizontal: boolean; direction: 'prev' | 'next' }>(
  ({ theme, isHorizontal, direction }) => ({
    position: 'absolute',
    zIndex: 10,
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    boxShadow: theme.shadows[2],
    '&:hover': {
      backgroundColor: theme.palette.background.paper,
    },
    '&.Mui-disabled': {
      backgroundColor: alpha(theme.palette.background.paper, 0.5),
    },
    ...(isHorizontal
      ? {
          top: '50%',
          transform: 'translateY(-50%)',
          ...(direction === 'prev' ? { left: 8 } : { right: 8 }),
        }
      : {
          left: '50%',
          transform: 'translateX(-50%)',
          ...(direction === 'prev' ? { top: 8 } : { bottom: 8 }),
        }),
  })
);

const DotsContainer = styled(Box)<{ dotsPosition: 'bottom' | 'top' | 'left' | 'right' }>(({ theme, dotsPosition }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  position: 'absolute',
  zIndex: 10,
  ...(dotsPosition === 'bottom' && {
    bottom: theme.spacing(2),
    left: '50%',
    transform: 'translateX(-50%)',
    flexDirection: 'row',
  }),
  ...(dotsPosition === 'top' && {
    top: theme.spacing(2),
    left: '50%',
    transform: 'translateX(-50%)',
    flexDirection: 'row',
  }),
  ...(dotsPosition === 'left' && {
    left: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    flexDirection: 'column',
  }),
  ...(dotsPosition === 'right' && {
    right: theme.spacing(2),
    top: '50%',
    transform: 'translateY(-50%)',
    flexDirection: 'column',
  }),
}));

const Dot = styled('button')<{ active: boolean }>(({ theme, active }) => ({
  width: 8,
  height: 8,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  cursor: 'pointer',
  backgroundColor: active ? theme.palette.primary.main : alpha(theme.palette.common.black, 0.3),
  transition: theme.transitions.create(['background-color', 'transform'], {
    duration: theme.transitions.duration.short,
  }),
  '&:hover': {
    backgroundColor: active ? theme.palette.primary.main : alpha(theme.palette.common.black, 0.5),
    transform: 'scale(1.2)',
  },
}));
