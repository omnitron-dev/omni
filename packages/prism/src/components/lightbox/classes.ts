/**
 * Lightbox CSS Classes
 *
 * @module @omnitron/prism/components/lightbox
 */

import { createClasses } from '../../utils/create-classes.js';

/**
 * CSS class names for Lightbox component.
 */
export const lightboxClasses = {
  root: createClasses('lightbox__root'),
  backdrop: createClasses('lightbox__backdrop'),
  container: createClasses('lightbox__container'),
  slide: createClasses('lightbox__slide'),
  slideActive: createClasses('lightbox__slide--active'),
  image: createClasses('lightbox__image'),
  video: createClasses('lightbox__video'),
  caption: createClasses('lightbox__caption'),
  toolbar: createClasses('lightbox__toolbar'),
  toolbarTop: createClasses('lightbox__toolbar--top'),
  toolbarBottom: createClasses('lightbox__toolbar--bottom'),
  toolbarButton: createClasses('lightbox__toolbar__button'),
  navButton: createClasses('lightbox__nav'),
  navPrev: createClasses('lightbox__nav--prev'),
  navNext: createClasses('lightbox__nav--next'),
  counter: createClasses('lightbox__counter'),
  thumbnails: createClasses('lightbox__thumbnails'),
  thumbnail: createClasses('lightbox__thumbnail'),
  thumbnailActive: createClasses('lightbox__thumbnail--active'),
  zoom: createClasses('lightbox__zoom'),
  zoomed: createClasses('lightbox__zoomed'),
  loading: createClasses('lightbox__loading'),
  error: createClasses('lightbox__error'),
};
