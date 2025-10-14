/**
 * Testing Library Types
 */

/// <reference path="../jsx-types.d.ts" />

export type Matcher = string | RegExp | ((content: string, element: Element) => boolean);

export interface MatcherOptions {
  exact?: boolean;
  trim?: boolean;
  collapseWhitespace?: boolean;
  normalizer?: (text: string) => string;
}

export interface RenderOptions {
  container?: HTMLElement;
  wrapper?: (props: { children: JSX.Element }) => JSX.Element;
  baseElement?: HTMLElement;
  hydrate?: boolean;
}

export interface RenderResult {
  container: HTMLElement;
  baseElement: HTMLElement;
  rerender: (ui: () => JSX.Element) => void;
  unmount: () => void;
  debug: (element?: HTMLElement) => void;
  getByRole: (role: string, options?: any) => HTMLElement;
  getByText: (text: Matcher, options?: MatcherOptions) => HTMLElement;
  getByLabelText: (text: Matcher, options?: MatcherOptions) => HTMLElement;
  getByTestId: (id: Matcher) => HTMLElement;
  queryByRole: (role: string, options?: any) => HTMLElement | null;
  queryByText: (text: Matcher, options?: MatcherOptions) => HTMLElement | null;
  findByRole: (role: string, options?: any) => Promise<HTMLElement>;
  findByText: (text: Matcher, options?: MatcherOptions) => Promise<HTMLElement>;
}

export interface WaitForOptions {
  timeout?: number;
  interval?: number;
  onTimeout?: (error: Error) => Error;
}

export interface RenderHookOptions<TProps> {
  initialProps?: TProps;
  wrapper?: (props: { children: JSX.Element }) => JSX.Element;
}

export interface RenderHookResult<TResult, TProps> {
  result: { current: TResult; error?: Error };
  rerender: (props?: TProps) => void;
  unmount: () => void;
}

export interface FireEventOptions extends EventInit {
  [key: string]: any;
}

export interface ClickOptions {
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface TypeOptions {
  delay?: number;
  skipClick?: boolean;
  initialSelectionStart?: number;
  initialSelectionEnd?: number;
}
