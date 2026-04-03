'use client';

/**
 * Lightbox Component
 *
 * Premium modal image/video viewer with smooth crossfade transitions,
 * glassmorphism UI, zoom, pan, touch gestures, and keyboard navigation.
 *
 * @module @omnitron/prism/components/lightbox
 */

import type { LightboxProps, LightboxSlide } from './types.js';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { styled, alpha, useTheme } from '@mui/material/styles';

// MUI Icons (standard for design system components)
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import DownloadIcon from '@mui/icons-material/Download';
import ShareIcon from '@mui/icons-material/Share';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';

import { cn } from '../../utils/cn.js';
import { lightboxClasses } from './classes.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
const SWIPE_THRESHOLD = 60;
const TRANSITION_DURATION = 400;

// =============================================================================
// LIGHTBOX COMPONENT
// =============================================================================

/**
 * Full-screen modal image/video viewer with smooth crossfade transitions.
 *
 * @example
 * ```tsx
 * import { Lightbox, useLightbox } from '@omnitron/prism/components';
 *
 * function Gallery() {
 *   const lightbox = useLightbox({ totalSlides: images.length });
 *
 *   return (
 *     <>
 *       <ImageList>
 *         {images.map((img, i) => (
 *           <ImageListItem key={i} onClick={() => lightbox.onOpen(i)}>
 *             <img src={img.thumbnail} />
 *           </ImageListItem>
 *         ))}
 *       </ImageList>
 *
 *       <Lightbox
 *         slides={images}
 *         thumbnails
 *         zoom
 *         {...lightbox.getLightboxProps()}
 *       />
 *     </>
 *   );
 * }
 * ```
 */
export function Lightbox({
  open,
  onClose,
  slides,
  index: controlledIndex = 0,
  onIndexChange,
  thumbnails = false,
  zoom = true,
  fullscreen = true,
  counter = true,
  download = false,
  share = false,
  loop = false,
  keyboard = true,
  swipe = true,
  animation = TRANSITION_DURATION,
  closeOnBackdropClick = true,
  closeOnEsc = true,
  toolbar = { show: true, position: 'top' },
  sx,
  slotProps,
  className,
  ...dialogProps
}: LightboxProps) {
  const theme = useTheme();

  // State
  const [currentIndex, setCurrentIndex] = useState(controlledIndex);
  const [zoomLevel, setZoomLevel] = useState(MIN_ZOOM);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Transition state: track previous index for crossfade direction
  const [transitionState, setTransitionState] = useState<'idle' | 'transitioning'>('idle');
  const [prevIndex, setPrevIndex] = useState(controlledIndex);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | 'none'>('none');

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const touchStart = useRef({ x: 0, y: 0 });
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  // Sync with controlled index
  useEffect(() => {
    if (controlledIndex !== currentIndex) {
      navigateToSlide(controlledIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledIndex]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setZoomLevel(MIN_ZOOM);
      setPosition({ x: 0, y: 0 });
      setIsLoading(true);
      setTransitionState('idle');
      setSlideDirection('none');
    }
  }, [open]);

  // Current slide
  const currentSlide = slides[currentIndex] as LightboxSlide | undefined;
  const totalSlides = slides.length;
  const hasNext = loop || currentIndex < totalSlides - 1;
  const hasPrev = loop || currentIndex > 0;
  const isZoomed = zoomLevel > MIN_ZOOM;

  // Navigation with crossfade transition
  const navigateToSlide = useCallback(
    (newIndex: number) => {
      const targetIndex = loop
        ? (newIndex + totalSlides) % totalSlides
        : Math.max(0, Math.min(newIndex, totalSlides - 1));

      if (targetIndex === currentIndex) return;

      // Determine direction
      const direction = targetIndex > currentIndex ? 'left' : 'right';

      setPrevIndex(currentIndex);
      setSlideDirection(direction);
      setTransitionState('transitioning');
      setCurrentIndex(targetIndex);
      onIndexChange?.(targetIndex);
      setZoomLevel(MIN_ZOOM);
      setPosition({ x: 0, y: 0 });
      setIsLoading(true);

      // End transition after animation
      setTimeout(() => {
        setTransitionState('idle');
        setSlideDirection('none');
      }, animation);
    },
    [loop, totalSlides, currentIndex, onIndexChange, animation]
  );

  const next = useCallback(() => {
    if (hasNext) navigateToSlide(currentIndex + 1);
  }, [hasNext, currentIndex, navigateToSlide]);

  const prev = useCallback(() => {
    if (hasPrev) navigateToSlide(currentIndex - 1);
  }, [hasPrev, currentIndex, navigateToSlide]);

  // Direct navigation (from thumbnails — no directional slide)
  const goTo = useCallback(
    (newIndex: number) => {
      navigateToSlide(newIndex);
    },
    [navigateToSlide]
  );

  // Zoom handlers
  const zoomIn = useCallback(() => {
    setZoomLevel((prevZoom) => Math.min(prevZoom + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel((prevZoom) => {
      const newZoom = Math.max(prevZoom - ZOOM_STEP, MIN_ZOOM);
      if (newZoom === MIN_ZOOM) {
        setPosition({ x: 0, y: 0 });
      }
      return newZoom;
    });
  }, []);

  const zoomReset = useCallback(() => {
    setZoomLevel(MIN_ZOOM);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Download
  const handleDownload = useCallback(async () => {
    if (!currentSlide?.src) return;
    try {
      const response = await fetch(currentSlide.src);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = currentSlide.title || `image-${currentIndex + 1}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
    }
  }, [currentSlide, currentIndex]);

  // Share
  const handleShare = useCallback(async () => {
    if (!currentSlide?.src) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: currentSlide.title || 'Image',
          url: currentSlide.src,
        });
      } else {
        await navigator.clipboard.writeText(currentSlide.src);
      }
    } catch (error) {
      console.error('Share failed:', error);
    }
  }, [currentSlide]);

  // Keyboard navigation
  useEffect(() => {
    if (!open || !keyboard) return undefined;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          prev();
          break;
        case 'ArrowRight':
          next();
          break;
        case 'Escape':
          if (closeOnEsc) onClose();
          break;
        case '+':
        case '=':
          if (zoom) zoomIn();
          break;
        case '-':
          if (zoom) zoomOut();
          break;
        case '0':
          if (zoom) zoomReset();
          break;
        case 'f':
          if (fullscreen) toggleFullscreen();
          break;
        // no default
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, keyboard, zoom, fullscreen, closeOnEsc, prev, next, zoomIn, zoomOut, zoomReset, toggleFullscreen, onClose]);

  // Mouse drag for panning when zoomed
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isZoomed) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    },
    [isZoomed, position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !isZoomed) return;
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    },
    [isDragging, isZoomed]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch swipe for navigation and panning
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      touchStart.current = { x: touch.clientX, y: touch.clientY };
      if (isZoomed) {
        setIsDragging(true);
        dragStart.current = { x: touch.clientX - position.x, y: touch.clientY - position.y };
      }
    },
    [isZoomed, position]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (isDragging && isZoomed) {
        setPosition({
          x: touch.clientX - dragStart.current.x,
          y: touch.clientY - dragStart.current.y,
        });
      }
    },
    [isDragging, isZoomed]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isDragging) {
        setIsDragging(false);
        return;
      }

      if (!swipe || isZoomed) return;

      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - touchStart.current.x;
      const deltaY = touch.clientY - touchStart.current.y;

      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
        if (deltaX > 0) {
          prev();
        } else {
          next();
        }
      }
    },
    [swipe, isZoomed, isDragging, prev, next]
  );

  // Image load handler
  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  // Backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnBackdropClick && e.target === e.currentTarget && !isZoomed) {
        onClose();
      }
    },
    [closeOnBackdropClick, isZoomed, onClose]
  );

  // Double click to zoom
  const handleDoubleClick = useCallback(() => {
    if (!zoom) return;
    if (isZoomed) {
      zoomReset();
    } else {
      setZoomLevel(2);
    }
  }, [zoom, isZoomed, zoomReset]);

  // Scroll active thumbnail into view
  useEffect(() => {
    if (!thumbnails || !thumbnailsRef.current) return;
    const container = thumbnailsRef.current;
    const activeThumb = container.children[currentIndex] as HTMLElement | undefined;
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex, thumbnails]);

  // Previous slide data (for crossfade)
  const prevSlide = slides[prevIndex] as LightboxSlide | undefined;

  // Zoom percentage text
  const zoomPercent = useMemo(() => Math.round(zoomLevel * 100), [zoomLevel]);

  if (!currentSlide) return null;

  const isVideo = Boolean(currentSlide.video);
  const isPrevVideo = Boolean(prevSlide?.video);
  const transitionMs = animation;

  return (
    <StyledDialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      className={cn(lightboxClasses.root, className)}
      sx={sx}
      {...dialogProps}
    >
      <LightboxContainer ref={containerRef} className={lightboxClasses.container} sx={slotProps?.root}>
        {/* Toolbar - Top */}
        {toolbar?.show && toolbar?.position === 'top' && (
          <GlassToolbar
            className={cn(lightboxClasses.toolbar, lightboxClasses.toolbarTop)}
            placement="top"
            sx={slotProps?.toolbar}
          >
            {counter && (
              <CounterChip className={lightboxClasses.counter} sx={slotProps?.counter}>
                {currentIndex + 1}
                <Typography component="span" sx={{ mx: 0.5, opacity: 0.5 }}>
                  /
                </Typography>
                {totalSlides}
              </CounterChip>
            )}

            <Box sx={{ flex: 1 }} />

            {/* Zoom controls with level indicator */}
            {zoom && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <GlassButton
                  onClick={zoomOut}
                  disabled={zoomLevel <= MIN_ZOOM}
                  aria-label="Zoom out"
                  className={lightboxClasses.toolbarButton}
                  size="small"
                >
                  <ZoomOutIcon fontSize="small" />
                </GlassButton>

                {isZoomed && (
                  <Typography
                    sx={{
                      color: 'common.white',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      minWidth: 36,
                      textAlign: 'center',
                      opacity: 0.8,
                    }}
                  >
                    {zoomPercent}%
                  </Typography>
                )}

                <GlassButton
                  onClick={zoomIn}
                  disabled={zoomLevel >= MAX_ZOOM}
                  aria-label="Zoom in"
                  className={lightboxClasses.toolbarButton}
                  size="small"
                >
                  <ZoomInIcon fontSize="small" />
                </GlassButton>
              </Box>
            )}

            {fullscreen && (
              <GlassButton
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className={lightboxClasses.toolbarButton}
                size="small"
              >
                {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
              </GlassButton>
            )}

            {download && (
              <GlassButton
                onClick={handleDownload}
                aria-label="Download"
                className={lightboxClasses.toolbarButton}
                size="small"
              >
                <DownloadIcon fontSize="small" />
              </GlassButton>
            )}

            {share && (
              <GlassButton
                onClick={handleShare}
                aria-label="Share"
                className={lightboxClasses.toolbarButton}
                size="small"
              >
                <ShareIcon fontSize="small" />
              </GlassButton>
            )}

            {toolbar?.buttons}

            <GlassButton onClick={onClose} aria-label="Close" className={lightboxClasses.toolbarButton} size="small">
              <CloseIcon fontSize="small" />
            </GlassButton>
          </GlassToolbar>
        )}

        {/* Main content area — layered slides for crossfade */}
        <SlideContainer
          className={cn(lightboxClasses.slide, lightboxClasses.slideActive, {
            [lightboxClasses.zoomed]: isZoomed,
          })}
          onClick={handleBackdropClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
          sx={{
            ...slotProps?.imageContainer,
            cursor: isZoomed ? (isDragging ? 'grabbing' : 'grab') : 'default',
          }}
        >
          {/* === Outgoing (previous) slide — fades out with directional shift === */}
          {transitionState === 'transitioning' && prevSlide && prevIndex !== currentIndex && (
            <SlideLayer
              sx={{
                opacity: 0,
                transform:
                  slideDirection === 'left'
                    ? 'translateX(-8%) scale(0.95)'
                    : slideDirection === 'right'
                      ? 'translateX(8%) scale(0.95)'
                      : 'scale(0.95)',
                transition: `opacity ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`,
                zIndex: 1,
              }}
            >
              {isPrevVideo && prevSlide.video ? (
                <StyledVideo poster={prevSlide.video.poster}>
                  {prevSlide.video.sources.map((source, i) => (
                    <source key={i} src={source.src} type={source.type} />
                  ))}
                </StyledVideo>
              ) : (
                <StyledImage src={prevSlide.src} alt="" draggable={false} />
              )}
            </SlideLayer>
          )}

          {/* === Current (incoming) slide — fades in with directional entrance === */}
          <SlideLayer
            sx={{
              opacity: transitionState === 'transitioning' ? 0 : 1,
              transform:
                transitionState === 'transitioning'
                  ? slideDirection === 'left'
                    ? 'translateX(8%) scale(0.95)'
                    : slideDirection === 'right'
                      ? 'translateX(-8%) scale(0.95)'
                      : 'scale(0.95)'
                  : 'translateX(0) scale(1)',
              transition:
                transitionState === 'idle'
                  ? `opacity ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${transitionMs}ms cubic-bezier(0.4, 0, 0.2, 1)`
                  : 'none',
              zIndex: 2,
              // Force repaint trick: on next tick the idle state kicks in with transition
              animation:
                transitionState === 'transitioning'
                  ? `lightboxSlideIn ${transitionMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`
                  : undefined,
              '@keyframes lightboxSlideIn': {
                from: {
                  opacity: 0,
                  transform:
                    slideDirection === 'left'
                      ? 'translateX(5%) scale(0.97)'
                      : slideDirection === 'right'
                        ? 'translateX(-5%) scale(0.97)'
                        : 'scale(0.97)',
                },
                to: {
                  opacity: 1,
                  transform: 'translateX(0) scale(1)',
                },
              },
            }}
          >
            {/* Loading indicator */}
            {isLoading && !isVideo && (
              <LoadingOverlay className={lightboxClasses.loading}>
                <CircularProgress
                  size={40}
                  thickness={2.5}
                  sx={{
                    color: alpha(theme.palette.primary.main, 0.8),
                  }}
                />
              </LoadingOverlay>
            )}

            {/* Image/Video content */}
            {isVideo && currentSlide.video ? (
              <VideoWrapper>
                <StyledVideo
                  className={lightboxClasses.video}
                  controls
                  autoPlay={currentSlide.video.autoPlay}
                  loop={currentSlide.video.loop}
                  muted={currentSlide.video.muted}
                  poster={currentSlide.video.poster}
                  onLoadedData={handleImageLoad}
                  style={{
                    transform: `scale(${zoomLevel}) translate(${position.x / zoomLevel}px, ${position.y / zoomLevel}px)`,
                    transition: isDragging ? 'none' : `transform ${animation}ms ease`,
                  }}
                />
              </VideoWrapper>
            ) : (
              <StyledImage
                className={lightboxClasses.image}
                src={currentSlide.src}
                alt={currentSlide.alt || `Slide ${currentIndex + 1}`}
                onLoad={handleImageLoad}
                draggable={false}
                style={{
                  transform: `scale(${zoomLevel}) translate(${position.x / zoomLevel}px, ${position.y / zoomLevel}px)`,
                  transition: isDragging ? 'none' : `transform ${animation}ms ease`,
                  opacity: isLoading ? 0 : 1,
                }}
              />
            )}
          </SlideLayer>

          {/* Caption */}
          {(currentSlide.title || currentSlide.description) && !isZoomed && (
            <GlassCaption className={lightboxClasses.caption}>
              {currentSlide.title && (
                <Typography variant="subtitle1" component="div" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                  {currentSlide.title}
                </Typography>
              )}
              {currentSlide.description && (
                <Typography variant="body2" sx={{ opacity: 0.7, mt: 0.25 }}>
                  {currentSlide.description}
                </Typography>
              )}
            </GlassCaption>
          )}
        </SlideContainer>

        {/* Navigation arrows */}
        {hasPrev && !isZoomed && (
          <NavArrow
            className={cn(lightboxClasses.navButton, lightboxClasses.navPrev)}
            side="left"
            onClick={prev}
            aria-label="Previous"
            sx={slotProps?.navButton}
          >
            <ChevronLeftIcon sx={{ fontSize: 28 }} />
          </NavArrow>
        )}

        {hasNext && !isZoomed && (
          <NavArrow
            className={cn(lightboxClasses.navButton, lightboxClasses.navNext)}
            side="right"
            onClick={next}
            aria-label="Next"
            sx={slotProps?.navButton}
          >
            <ChevronRightIcon sx={{ fontSize: 28 }} />
          </NavArrow>
        )}

        {/* Thumbnails */}
        {thumbnails && !isZoomed && (
          <ThumbnailStrip ref={thumbnailsRef} className={lightboxClasses.thumbnails} sx={slotProps?.thumbnails}>
            {slides.map((slide, i) => {
              const isThumbVideo = Boolean(slide.video);

              return (
                <ThumbItem
                  key={i}
                  className={cn(lightboxClasses.thumbnail, {
                    [lightboxClasses.thumbnailActive]: i === currentIndex,
                  })}
                  active={i === currentIndex}
                  onClick={() => goTo(i)}
                >
                  <img
                    src={slide.thumbnail || slide.video?.poster || slide.src}
                    alt={slide.alt || `Thumbnail ${i + 1}`}
                    draggable={false}
                  />
                  {/* Video indicator on thumbnail */}
                  {isThumbVideo && (
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: alpha(theme.palette.common.black, 0.35),
                      }}
                    >
                      <PlayArrowIcon sx={{ fontSize: 18, color: 'common.white', opacity: 0.9 }} />
                    </Box>
                  )}
                </ThumbItem>
              );
            })}
          </ThumbnailStrip>
        )}

        {/* Toolbar - Bottom */}
        {toolbar?.show && toolbar?.position === 'bottom' && (
          <GlassToolbar
            className={cn(lightboxClasses.toolbar, lightboxClasses.toolbarBottom)}
            placement="bottom"
            sx={slotProps?.toolbar}
          >
            {counter && (
              <CounterChip className={lightboxClasses.counter} sx={slotProps?.counter}>
                {currentIndex + 1}
                <Typography component="span" sx={{ mx: 0.5, opacity: 0.5 }}>
                  /
                </Typography>
                {totalSlides}
              </CounterChip>
            )}
            <Box sx={{ flex: 1 }} />
            <GlassButton onClick={onClose} aria-label="Close" size="small">
              <CloseIcon fontSize="small" />
            </GlassButton>
          </GlassToolbar>
        )}
      </LightboxContainer>
    </StyledDialog>
  );
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor: 'transparent',
    boxShadow: 'none',
    margin: 0,
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 0,
  },
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.92),
    backdropFilter: 'blur(8px)',
  },
}));

const LightboxContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  width: '100vw',
  height: '100vh',
  position: 'relative',
  overflow: 'hidden',
  userSelect: 'none',
});

// --- Glassmorphism Toolbar ---

const GlassToolbar = styled(Box)<{ placement: 'top' | 'bottom' }>(({ theme, placement }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  padding: theme.spacing(1, 1.5),
  position: 'absolute',
  left: 0,
  right: 0,
  zIndex: 10,
  ...(placement === 'top' && { top: 0 }),
  ...(placement === 'bottom' && { bottom: 0 }),
  background: `linear-gradient(${placement === 'top' ? 'to bottom' : 'to top'}, ${alpha(theme.palette.common.black, 0.55)} 0%, ${alpha(theme.palette.common.black, 0.2)} 60%, transparent 100%)`,
  transition: 'opacity 0.3s ease',
}));

const GlassButton = styled(IconButton)(({ theme }) => ({
  color: alpha(theme.palette.common.white, 0.85),
  borderRadius: Number(theme.shape.borderRadius) * 1.5,
  padding: 6,
  transition: theme.transitions.create(['background-color', 'color', 'transform'], {
    duration: 200,
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.12),
    color: theme.palette.common.white,
    transform: 'scale(1.05)',
  },
  '&:active': {
    transform: 'scale(0.95)',
  },
  '&.Mui-disabled': {
    color: alpha(theme.palette.common.white, 0.2),
  },
}));

const CounterChip = styled(Typography)(({ theme }) => ({
  color: alpha(theme.palette.common.white, 0.9),
  fontSize: '0.75rem',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  padding: theme.spacing(0.375, 1),
  borderRadius: Number(theme.shape.borderRadius) * 2,
  backgroundColor: alpha(theme.palette.common.white, 0.1),
  backdropFilter: 'blur(12px)',
  border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
  display: 'flex',
  alignItems: 'center',
  letterSpacing: '0.02em',
}));

// --- Slide Area ---

const SlideContainer = styled(Box)({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  overflow: 'hidden',
});

/** Absolute layer for crossfade transitions */
const SlideLayer = styled(Box)({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  willChange: 'opacity, transform',
});

const LoadingOverlay = styled(Box)({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 5,
});

const StyledImage = styled('img')({
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  willChange: 'transform, opacity',
  borderRadius: 2,
});

const VideoWrapper = styled(Box)({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  maxWidth: '100%',
  maxHeight: '100%',
});

const StyledVideo = styled('video')(({ theme }) => ({
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  willChange: 'transform',
  borderRadius: 4,
  // Custom video controls styling
  '&::-webkit-media-controls-panel': {
    backgroundColor: alpha(theme.palette.common.black, 0.6),
    backdropFilter: 'blur(8px)',
  },
  '&::-webkit-media-controls-current-time-display, &::-webkit-media-controls-time-remaining-display': {
    color: theme.palette.common.white,
    fontSize: 12,
  },
}));

// --- Caption ---

const GlassCaption = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: theme.spacing(2.5),
  left: '50%',
  transform: 'translateX(-50%)',
  textAlign: 'center',
  color: theme.palette.common.white,
  padding: theme.spacing(1, 2.5),
  borderRadius: Number(theme.shape.borderRadius) * 2,
  backgroundColor: alpha(theme.palette.common.black, 0.45),
  backdropFilter: 'blur(16px)',
  border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
  maxWidth: '70%',
  zIndex: 5,
  animation: 'lightboxCaptionIn 0.3s ease-out',
  '@keyframes lightboxCaptionIn': {
    from: { opacity: 0, transform: 'translateX(-50%) translateY(8px)' },
    to: { opacity: 1, transform: 'translateX(-50%) translateY(0)' },
  },
}));

// --- Navigation Arrows ---

const NavArrow = styled(IconButton)<{ side: 'left' | 'right' }>(({ theme, side }) => ({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  color: alpha(theme.palette.common.white, 0.85),
  zIndex: 10,
  width: 44,
  height: 44,
  borderRadius: '50%',
  backgroundColor: alpha(theme.palette.common.white, 0.08),
  backdropFilter: 'blur(12px)',
  border: `1px solid ${alpha(theme.palette.common.white, 0.06)}`,
  ...(side === 'left' && { left: theme.spacing(2) }),
  ...(side === 'right' && { right: theme.spacing(2) }),
  transition: theme.transitions.create(['background-color', 'color', 'transform', 'box-shadow'], {
    duration: 200,
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.16),
    color: theme.palette.common.white,
    transform: 'translateY(-50%) scale(1.08)',
    boxShadow: `0 0 20px ${alpha(theme.palette.primary.main, 0.15)}`,
  },
  '&:active': {
    transform: 'translateY(-50%) scale(0.95)',
  },
}));

// --- Thumbnails ---

const ThumbnailStrip = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.75),
  padding: theme.spacing(1, 2),
  justifyContent: 'center',
  overflowX: 'auto',
  backgroundColor: alpha(theme.palette.common.black, 0.5),
  backdropFilter: 'blur(12px)',
  borderTop: `1px solid ${alpha(theme.palette.common.white, 0.06)}`,
  // Hide scrollbar
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
}));

const ThumbItem = styled(Box)<{ active: boolean }>(({ theme, active }) => ({
  flexShrink: 0,
  width: 56,
  height: 56,
  borderRadius: Number(theme.shape.borderRadius) * 1.5,
  overflow: 'hidden',
  cursor: 'pointer',
  position: 'relative',
  border: `2px solid ${active ? theme.palette.primary.main : alpha(theme.palette.common.white, 0.08)}`,
  opacity: active ? 1 : 0.55,
  transform: active ? 'scale(1)' : 'scale(0.92)',
  transition: theme.transitions.create(['border-color', 'opacity', 'transform', 'box-shadow'], {
    duration: 200,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }),
  ...(active && {
    boxShadow: `0 0 12px ${alpha(theme.palette.primary.main, 0.3)}`,
  }),
  '& img': {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  '&:hover': {
    opacity: 1,
    transform: 'scale(1)',
    borderColor: active ? theme.palette.primary.main : alpha(theme.palette.common.white, 0.25),
  },
}));
