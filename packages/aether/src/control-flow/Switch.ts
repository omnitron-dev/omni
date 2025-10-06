/**
 * Switch/Match - Multiple Condition Component
 *
 * Renders first matching condition
 */

/**
 * Match component props
 */
export interface MatchProps<T = any> {
  /**
   * Value to match against parent Switch
   */
  when: T;

  /**
   * Children to render if matched
   */
  children: any;
}

/**
 * Match descriptor - internal representation
 */
interface MatchDescriptor {
  type: 'match';
  props: MatchProps;
}

/**
 * Switch component props
 */
export interface SwitchProps {
  /**
   * Fallback to render if no matches
   */
  fallback?: any;

  /**
   * Match components as children
   */
  children: MatchDescriptor | MatchDescriptor[];
}

/**
 * Match component - used inside Switch
 *
 * Returns a descriptor object that Switch inspects.
 * Does not render directly.
 *
 * @example
 * ```tsx
 * <Switch>
 *   <Match when={status() === 'loading'}>
 *     <LoadingSpinner />
 *   </Match>
 *   <Match when={status() === 'error'}>
 *     <ErrorMessage />
 *   </Match>
 *   <Match when={status() === 'success'}>
 *     <Content />
 *   </Match>
 * </Switch>
 * ```
 */
export function Match<T>(props: MatchProps<T>): MatchDescriptor {
  return {
    type: 'match',
    props,
  };
}

/**
 * Switch component - multiple conditions
 *
 * Renders first child Match that has truthy when condition
 *
 * @example
 * ```tsx
 * <Switch fallback={<div>Unknown status</div>}>
 *   <Match when={status() === 'loading'}>
 *     <LoadingSpinner />
 *   </Match>
 *   <Match when={status() === 'success'}>
 *     <Content />
 *   </Match>
 * </Switch>
 * ```
 */
export function Switch(props: SwitchProps): any {
  // Get children array
  const children = Array.isArray(props.children) ? props.children : [props.children];

  // Find first Match with truthy condition
  for (const child of children) {
    // Check if it's a Match descriptor
    if (child && child.type === 'match') {
      if (child.props.when) {
        return child.props.children;
      }
    }
  }

  // No match found, return fallback
  return props.fallback || null;
}
