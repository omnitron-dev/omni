/**
 * Carousel CSS Classes
 *
 * @module @omnitron/prism/components/carousel
 */

import { createClasses } from '../../utils/create-classes.js';

/**
 * CSS class names for Carousel component.
 */
export const carouselClasses = {
  root: createClasses('carousel__root'),
  container: createClasses('carousel__container'),
  track: createClasses('carousel__track'),
  slide: createClasses('carousel__slide'),
  slideActive: createClasses('carousel__slide--active'),
  slidePrev: createClasses('carousel__slide--prev'),
  slideNext: createClasses('carousel__slide--next'),
  arrow: createClasses('carousel__arrow'),
  arrowPrev: createClasses('carousel__arrow--prev'),
  arrowNext: createClasses('carousel__arrow--next'),
  arrowInside: createClasses('carousel__arrow--inside'),
  arrowOutside: createClasses('carousel__arrow--outside'),
  arrowDisabled: createClasses('carousel__arrow--disabled'),
  dots: createClasses('carousel__dots'),
  dotsTop: createClasses('carousel__dots--top'),
  dotsBottom: createClasses('carousel__dots--bottom'),
  dotsLeft: createClasses('carousel__dots--left'),
  dotsRight: createClasses('carousel__dots--right'),
  dot: createClasses('carousel__dot'),
  dotActive: createClasses('carousel__dot--active'),
  horizontal: createClasses('carousel__horizontal'),
  vertical: createClasses('carousel__vertical'),
  dragging: createClasses('carousel__dragging'),
  fade: createClasses('carousel__fade'),
};
