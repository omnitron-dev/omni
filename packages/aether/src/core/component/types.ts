/**
 * Component System Types
 *
 * Type definitions for Aether component system
 */

/**
 * Component setup function that returns a render function
 */
export type ComponentSetup<P = {}> = (props: P) => RenderFunction;

/**
 * Render function that returns JSX or primitives
 */
export type RenderFunction = () => JSX.Element | string | number | null | undefined;

/**
 * Component instance
 */
export interface Component<P = {}> {
  (props: P): JSX.Element;
  displayName?: string;
}

/**
 * Lifecycle hook cleanup function
 */
export type CleanupFunction = () => void;

/**
 * Mount callback type
 */
export type MountCallback = () => CleanupFunction | void;

/**
 * Error callback type
 */
export type ErrorCallback = (error: Error) => void;

/**
 * Component context value
 */
export interface ComponentContext {
  /** Component display name */
  name?: string;
  /** Mount callbacks */
  mountCallbacks: MountCallback[];
  /** Error callbacks */
  errorCallbacks: ErrorCallback[];
  /** Whether component is mounted */
  isMounted: boolean;
}

/**
 * JSX Element types
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- Required for JSX type definitions
export namespace JSX {
  export type Element = any;
  export interface IntrinsicElements {
    // SVG animation elements
    animate?: any;
    animateMotion?: any;
    animateTransform?: any;
    animateColor?: any;
    set?: any;
    // Allow any other elements
    [elemName: string]: any;
  }

  // Re-export SVG and CSS types from global JSX namespace
  export type SVGAttributes<T = SVGElement> = globalThis.JSX.SVGAttributes<T>;
  export type CSSProperties = globalThis.JSX.CSSProperties;
}
