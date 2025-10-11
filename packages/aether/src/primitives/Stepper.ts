/**
 * Stepper Primitive
 *
 * A multi-step navigation component for forms and wizards.
 * Supports linear and non-linear navigation with validation.
 *
 * @example
 * ```tsx
 * const step = signal(0);
 *
 * <Stepper value={step()} onValueChange={step}>
 *   <Stepper.List>
 *     <Stepper.Item value={0}>
 *       <Stepper.Trigger>Step 1</Stepper.Trigger>
 *       <Stepper.Description>Account details</Stepper.Description>
 *     </Stepper.Item>
 *     <Stepper.Item value={1}>
 *       <Stepper.Trigger>Step 2</Stepper.Trigger>
 *       <Stepper.Description>Personal info</Stepper.Description>
 *     </Stepper.Item>
 *   </Stepper.List>
 *   <Stepper.Content value={0}>Content for step 1</Stepper.Content>
 *   <Stepper.Content value={1}>Content for step 2</Stepper.Content>
 * </Stepper>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import { signal, computed, type WritableSignal, type Signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface StepperProps {
  children?: any;
  /** Current step index */
  value?: number;
  /** Callback when step changes */
  onValueChange?: (step: number) => void;
  /** Default step (uncontrolled) */
  defaultValue?: number;
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Linear navigation (can't skip steps) */
  linear?: boolean;
  [key: string]: any;
}

export interface StepperListProps {
  children?: any;
  [key: string]: any;
}

export interface StepperItemProps {
  children?: any;
  /** Step value/index */
  value: number;
  /** Whether step is completed */
  completed?: boolean;
  /** Whether step is disabled */
  disabled?: boolean;
  [key: string]: any;
}

export interface StepperTriggerProps {
  children?: any;
  [key: string]: any;
}

export interface StepperDescriptionProps {
  children?: any;
  [key: string]: any;
}

export interface StepperContentProps {
  children?: any;
  /** Step value for this content */
  value: number;
  [key: string]: any;
}

export interface StepperSeparatorProps {
  [key: string]: any;
}

interface StepperContextValue {
  currentStep: Signal<number>;
  orientation: 'horizontal' | 'vertical';
  linear: boolean;
  totalSteps: Signal<number>;
  completedSteps: Signal<Set<number>>;
  goToStep: (step: number) => void;
  canGoToStep: (step: number) => boolean;
  isStepActive: (step: number) => boolean;
  isStepCompleted: (step: number) => boolean;
  markStepCompleted: (step: number) => void;
  registerStep: (value: number) => void;
}

interface StepperItemContextValue {
  value: number;
  isActive: () => boolean;
  isCompleted: () => boolean;
  isDisabled: () => boolean;
  goToStep: () => void;
}

// ============================================================================
// Context
// ============================================================================

const StepperContext = createContext<StepperContextValue | undefined>(undefined);
const StepperItemContext = createContext<StepperItemContextValue | undefined>(undefined);

function useStepperContext(): StepperContextValue {
  const context = useContext(StepperContext);
  if (!context) {
    throw new Error('Stepper components must be used within Stepper');
  }
  return context;
}

function useStepperItemContext(): StepperItemContextValue {
  const context = useContext(StepperItemContext);
  if (!context) {
    throw new Error('Stepper.Item components must be used within Stepper.Item');
  }
  return context;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Stepper Root
 */
export const Stepper = defineComponent<StepperProps>((props) => {
  const internalValue: WritableSignal<number> = signal<number>(props.defaultValue ?? 0);
  const completedSteps: WritableSignal<Set<number>> = signal<Set<number>>(new Set());
  const registeredSteps: WritableSignal<Set<number>> = signal<Set<number>>(new Set());

  const isControlled = () => props.value !== undefined;
  const currentStep = () => (isControlled() ? props.value ?? 0 : internalValue());

  const goToStep = (step: number) => {
    if (!isControlled()) {
      internalValue.set(step);
    }
    props.onValueChange?.(step);
  };

  const canGoToStep = (step: number) => {
    if (props.linear) {
      // In linear mode, can only go to next uncompleted step
      // or any completed step
      return step <= currentStep() || completedSteps().has(step);
    }
    return true; // Non-linear: can go anywhere
  };

  const isStepActive = (step: number) => currentStep() === step;

  const isStepCompleted = (step: number) => completedSteps().has(step);

  const markStepCompleted = (step: number) => {
    const newCompleted = new Set(completedSteps());
    newCompleted.add(step);
    completedSteps.set(newCompleted);
  };

  const registerStep = (value: number) => {
    const steps = registeredSteps();
    if (!steps.has(value)) {
      const newSteps = new Set(steps);
      newSteps.add(value);
      registeredSteps.set(newSteps);
    }
  };

  const contextValue: StepperContextValue = {
    currentStep: computed(() => currentStep()),
    orientation: props.orientation ?? 'horizontal',
    linear: props.linear ?? false,
    totalSteps: computed(() => registeredSteps().size),
    completedSteps: computed(() => completedSteps()),
    goToStep,
    canGoToStep,
    isStepActive,
    isStepCompleted,
    markStepCompleted,
    registerStep,
  };

  // CRITICAL: Provide context in setup phase
  provideContext(StepperContext, contextValue);

  return () => {
    const { children: childrenProp, orientation = 'horizontal' } = props;

    // Evaluate function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Return children directly - context already provided via provideContext
    return jsx('div', {
      'data-stepper': '',
      'data-orientation': orientation,
      'aria-label': 'Progress',
      children,
    });
  };
});

/**
 * Stepper List
 * Container for step items
 */
export const StepperList = defineComponent<StepperListProps>((props) => () => {
  const context = useStepperContext();
  const { children: childrenProp, ...restProps } = props;

  // Evaluate function children
  const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

  return jsx('ol', {
    ...restProps,
    'data-stepper-list': '',
    'data-orientation': context.orientation,
    'aria-label': 'Steps',
    children,
  });
});

/**
 * Stepper Item
 * Individual step in the list
 */
export const StepperItem = defineComponent<StepperItemProps>((props) => {
  const context = useStepperContext();

  // Register this step
  context.registerStep(props.value);

  const goToStep = () => {
    if (!props.disabled && context.canGoToStep(props.value)) {
      context.goToStep(props.value);
    }
  };

  const itemContextValue: StepperItemContextValue = {
    value: props.value,
    isActive: () => context.isStepActive(props.value),
    isCompleted: () => props.completed ?? context.isStepCompleted(props.value),
    isDisabled: () => props.disabled ?? false,
    goToStep,
  };

  // CRITICAL: Provide item context in setup phase
  provideContext(StepperItemContext, itemContextValue);

  return () => {
    const { children: childrenProp, value } = props;

    // Evaluate function children
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Evaluate reactive values in render function
    const isActive = itemContextValue.isActive();
    const isCompleted = itemContextValue.isCompleted();
    const isDisabled = itemContextValue.isDisabled();

    // Return children directly - context already provided via provideContext
    return jsx('li', {
      'data-stepper-item': '',
      'data-value': value,
      'data-active': isActive ? '' : undefined,
      'data-completed': isCompleted ? '' : undefined,
      'data-disabled': isDisabled ? '' : undefined,
      'aria-current': isActive ? 'step' : undefined,
      children,
    });
  };
});

/**
 * Stepper Trigger
 * Button to navigate to a step
 */
export const StepperTrigger = defineComponent<StepperTriggerProps>((props) => {
  const itemContext = useStepperItemContext();

  const handleClick = (e: MouseEvent) => {
    itemContext.goToStep();
    props.onClick?.(e);
  };

  return () => {
    const { children, ...restProps } = props;

    // Evaluate reactive context values
    const isActive = itemContext.isActive();
    const isCompleted = itemContext.isCompleted();
    const isDisabled = itemContext.isDisabled();

    return jsx('button', {
      ...restProps,
      type: 'button',
      'data-stepper-trigger': '',
      'data-state': isActive ? 'active' : isCompleted ? 'completed' : 'inactive',
      disabled: isDisabled,
      onClick: handleClick,
      children,
    });
  };
});

/**
 * Stepper Description
 * Optional description for a step
 */
export const StepperDescription = defineComponent<StepperDescriptionProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('span', {
    ...restProps,
    'data-stepper-description': '',
    children,
  });
});

/**
 * Stepper Content
 * Content panel for each step
 */
export const StepperContent = defineComponent<StepperContentProps>((props) => () => {
  const context = useStepperContext();
  const { children, value, ...restProps } = props;

  const isActive = context.isStepActive(value);

  if (!isActive) {
    return null;
  }

  return jsx('div', {
    ...restProps,
    'data-stepper-content': '',
    'data-value': value,
    'data-state': 'active',
    role: 'tabpanel',
    'aria-labelledby': `step-${value}`,
    children,
  });
});

/**
 * Stepper Separator
 * Visual separator between steps
 */
export const StepperSeparator = defineComponent<StepperSeparatorProps>((props) => () => jsx('div', {
    ...props,
    'data-stepper-separator': '',
    'aria-hidden': 'true',
  }));

// ============================================================================
// Attach sub-components
// ============================================================================

(Stepper as any).List = StepperList;
(Stepper as any).Item = StepperItem;
(Stepper as any).Trigger = StepperTrigger;
(Stepper as any).Description = StepperDescription;
(Stepper as any).Content = StepperContent;
(Stepper as any).Separator = StepperSeparator;

// ============================================================================
// Type augmentation
// ============================================================================

export interface StepperComponent {
  (props: StepperProps): any;
  List: typeof StepperList;
  Item: typeof StepperItem;
  Trigger: typeof StepperTrigger;
  Description: typeof StepperDescription;
  Content: typeof StepperContent;
  Separator: typeof StepperSeparator;
}
