/**
 * Lightbox Component Types
 *
 * Type definitions for the Lightbox component - a modal image viewer
 * with zoom, pan, and navigation capabilities.
 *
 * @module @omnitron/prism/components/lightbox
 */

import type { Theme, SxProps } from '@mui/material/styles';
import type { DialogProps } from '@mui/material/Dialog';

// =============================================================================
// LIGHTBOX SLIDE TYPES
// =============================================================================

/**
 * Individual slide/image in the lightbox.
 */
export interface LightboxSlide {
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt?: string;
  /** Optional title displayed below image */
  title?: string;
  /** Optional description/caption */
  description?: string;
  /** Video source (if slide is a video) */
  video?: {
    /** Video sources with type */
    sources: Array<{ src: string; type: string }>;
    /** Autoplay video */
    autoPlay?: boolean;
    /** Loop video */
    loop?: boolean;
    /** Muted by default */
    muted?: boolean;
    /** Poster image */
    poster?: string;
  };
  /** Thumbnail URL (defaults to src) */
  thumbnail?: string;
  /** Width for sizing calculations */
  width?: number;
  /** Height for sizing calculations */
  height?: number;
  /** Additional slide data */
  [key: string]: unknown;
}

// =============================================================================
// LIGHTBOX PROPS
// =============================================================================

/**
 * Lightbox component props.
 */
export interface LightboxProps extends Omit<DialogProps, 'open' | 'onClose' | 'children' | 'slotProps'> {
  /** Whether the lightbox is open */
  open: boolean;
  /** Callback when lightbox should close */
  onClose: () => void;
  /** Array of slides to display */
  slides: LightboxSlide[];
  /** Initial slide index (default: 0) */
  index?: number;
  /** Callback when slide changes */
  onIndexChange?: (index: number) => void;
  /** Show thumbnails strip */
  thumbnails?: boolean;
  /** Show zoom controls */
  zoom?: boolean;
  /** Enable fullscreen mode */
  fullscreen?: boolean;
  /** Show slide counter */
  counter?: boolean;
  /** Show download button */
  download?: boolean;
  /** Show share button */
  share?: boolean;
  /** Enable infinite loop navigation */
  loop?: boolean;
  /** Enable keyboard navigation */
  keyboard?: boolean;
  /** Enable swipe gestures */
  swipe?: boolean;
  /** Animation duration in ms */
  animation?: number;
  /** Close on backdrop click */
  closeOnBackdropClick?: boolean;
  /** Close on escape key */
  closeOnEsc?: boolean;
  /** Custom toolbar actions */
  toolbar?: {
    /** Show toolbar */
    show?: boolean;
    /** Toolbar position */
    position?: 'top' | 'bottom';
    /** Custom buttons */
    buttons?: React.ReactNode[];
  };
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Slot props for internal components */
  slotProps?: {
    /** Root container styles */
    root?: SxProps<Theme>;
    /** Backdrop styles */
    backdrop?: SxProps<Theme>;
    /** Image container styles */
    imageContainer?: SxProps<Theme>;
    /** Toolbar styles */
    toolbar?: SxProps<Theme>;
    /** Thumbnails container styles */
    thumbnails?: SxProps<Theme>;
    /** Navigation button styles */
    navButton?: SxProps<Theme>;
    /** Counter styles */
    counter?: SxProps<Theme>;
  };
}

// =============================================================================
// LIGHTBOX TOOLBAR PROPS
// =============================================================================

/**
 * Lightbox toolbar props.
 */
export interface LightboxToolbarProps {
  /** Current slide index */
  index: number;
  /** Total number of slides */
  total: number;
  /** Current zoom level */
  zoomLevel: number;
  /** Whether fullscreen is active */
  isFullscreen: boolean;
  /** Zoom in handler */
  onZoomIn?: () => void;
  /** Zoom out handler */
  onZoomOut?: () => void;
  /** Reset zoom handler */
  onZoomReset?: () => void;
  /** Toggle fullscreen handler */
  onFullscreen?: () => void;
  /** Download handler */
  onDownload?: () => void;
  /** Share handler */
  onShare?: () => void;
  /** Close handler */
  onClose: () => void;
  /** Show zoom controls */
  showZoom?: boolean;
  /** Show fullscreen button */
  showFullscreen?: boolean;
  /** Show download button */
  showDownload?: boolean;
  /** Show share button */
  showShare?: boolean;
  /** Show counter */
  showCounter?: boolean;
  /** Custom buttons */
  customButtons?: React.ReactNode[];
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// LIGHTBOX THUMBNAILS PROPS
// =============================================================================

/**
 * Lightbox thumbnails strip props.
 */
export interface LightboxThumbnailsProps {
  /** Slides to show thumbnails for */
  slides: LightboxSlide[];
  /** Currently active index */
  activeIndex: number;
  /** Thumbnail click handler */
  onSelect: (index: number) => void;
  /** Thumbnail size */
  size?: 'small' | 'medium' | 'large';
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// LIGHTBOX HOOK RETURN TYPE
// =============================================================================

/**
 * Return type for useLightbox hook.
 */
export interface UseLightboxReturn {
  /** Whether lightbox is open */
  open: boolean;
  /** Current slide index */
  index: number;
  /** Open lightbox at specific index */
  onOpen: (index?: number) => void;
  /** Close lightbox */
  onClose: () => void;
  /** Go to specific slide */
  goTo: (index: number) => void;
  /** Go to next slide */
  next: () => void;
  /** Go to previous slide */
  prev: () => void;
  /** Current zoom level */
  zoomLevel: number;
  /** Zoom in */
  zoomIn: () => void;
  /** Zoom out */
  zoomOut: () => void;
  /** Reset zoom */
  zoomReset: () => void;
  /** Props to spread on Lightbox component */
  getLightboxProps: () => Pick<LightboxProps, 'open' | 'onClose' | 'index' | 'onIndexChange'>;
}
