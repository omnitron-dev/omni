/**
 * Prism Accessibility Module
 *
 * Tools and utilities for building accessible applications.
 *
 * Features:
 * - Vision Mode: Color blindness simulation for testing
 * - More accessibility features coming soon
 *
 * @module @omnitron/prism/accessibility
 */

export {
  // Provider
  VisionModeProvider,
  // Hook
  useVisionMode,
  // Helper
  getVisionModeStyles,
  // Constants
  VISION_MODE_OPTIONS,
  // Types
  type VisionMode,
  type VisionModeOption,
  type VisionModeContextValue,
  type VisionModeProviderProps,
} from './vision-mode.js';
