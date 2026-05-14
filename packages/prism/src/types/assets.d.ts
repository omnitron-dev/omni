/**
 * Ambient type declarations for non-code asset imports.
 *
 * TS 6.0 + `moduleResolution: 'bundler'` requires every side-effect
 * import (CSS, images, etc.) to carry a type declaration. These
 * opaque module declarations satisfy the type checker; the actual
 * file loading is handled by the consuming app's bundler.
 */

declare module '*.css';
declare module '*.scss';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.svg';
declare module '*.webp';
