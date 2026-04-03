'use client';

/**
 * Stepper Component
 *
 * Multi-step wizard/stepper with custom styling.
 *
 * @module @omnitron-dev/prism/components/stepper
 */

import { useState, useCallback, type ReactNode } from 'react';
import MuiStepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import StepContent from '@mui/material/StepContent';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { StepperProps as MuiStepperProps } from '@mui/material/Stepper';

/**
 * Step definition.
 */
export interface StepItem {
  /** Step label */
  label: string;
  /** Step description */
  description?: string;
  /** Step content */
  content?: ReactNode;
  /** Optional step (can be skipped) */
  optional?: boolean;
  /** Step icon */
  icon?: ReactNode;
  /** Step is completed */
  completed?: boolean;
  /** Step has error */
  error?: boolean;
}

/**
 * Props for Stepper component.
 */
export interface StepperProps extends Omit<MuiStepperProps, 'children'> {
  /** Steps to display */
  steps: StepItem[];
  /** Active step index */
  activeStep?: number;
  /** On step change */
  onStepChange?: (step: number) => void;
  /** Stepper orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Allow non-linear navigation */
  nonLinear?: boolean;
  /** Alternative label placement (horizontal only) */
  alternativeLabel?: boolean;
  /** Show step content (vertical only) */
  showContent?: boolean;
}

/**
 * Stepper - Multi-step wizard/stepper.
 *
 * @example
 * ```tsx
 * <Stepper
 *   steps={[
 *     { label: 'Account', description: 'Create account' },
 *     { label: 'Profile', description: 'Complete profile', optional: true },
 *     { label: 'Verify', description: 'Verify email' },
 *   ]}
 *   activeStep={1}
 *   onStepChange={(step) => setActiveStep(step)}
 * />
 * ```
 */
export function Stepper({
  steps,
  activeStep = 0,
  onStepChange,
  orientation = 'horizontal',
  nonLinear = false,
  alternativeLabel = false,
  showContent = false,
  ...other
}: StepperProps): ReactNode {
  const handleStepClick = (index: number) => {
    if (nonLinear && onStepChange) {
      onStepChange(index);
    }
  };

  return (
    <MuiStepper
      activeStep={activeStep}
      orientation={orientation}
      nonLinear={nonLinear}
      alternativeLabel={alternativeLabel}
      {...other}
    >
      {steps.map((step, index) => (
        <Step key={index} completed={step.completed ?? index < activeStep}>
          <StepLabel
            optional={
              step.optional ? (
                <span style={{ fontSize: '0.75rem', color: 'text.secondary' }}>Optional</span>
              ) : step.description ? (
                <span style={{ fontSize: '0.75rem', color: 'text.secondary' }}>{step.description}</span>
              ) : undefined
            }
            error={step.error}
            icon={step.icon}
            sx={{
              cursor: nonLinear ? 'pointer' : 'default',
            }}
            onClick={() => handleStepClick(index)}
          >
            {step.label}
          </StepLabel>
          {orientation === 'vertical' && showContent && step.content && <StepContent>{step.content}</StepContent>}
        </Step>
      ))}
    </MuiStepper>
  );
}

/**
 * Return type for useStepper hook.
 */
export interface UseStepperReturn {
  /** Current active step */
  activeStep: number;
  /** Go to next step */
  nextStep: () => void;
  /** Go to previous step */
  prevStep: () => void;
  /** Go to specific step */
  goToStep: (step: number) => void;
  /** Reset to first step */
  reset: () => void;
  /** Is first step */
  isFirstStep: boolean;
  /** Is last step */
  isLastStep: boolean;
  /** Step is completed */
  isCompleted: boolean;
}

/**
 * Options for useStepper hook.
 */
export interface UseStepperOptions {
  /** Initial step */
  initialStep?: number;
  /** Total steps */
  totalSteps: number;
  /** On step change callback */
  onStepChange?: (step: number) => void;
  /** On complete callback */
  onComplete?: () => void;
}

/**
 * useStepper - Hook for managing stepper state.
 *
 * @example
 * ```tsx
 * const stepper = useStepper({
 *   totalSteps: 3,
 *   onComplete: () => console.log('Done!'),
 * });
 *
 * <Stepper steps={steps} activeStep={stepper.activeStep} />
 * <Button onClick={stepper.prevStep} disabled={stepper.isFirstStep}>
 *   Back
 * </Button>
 * <Button onClick={stepper.nextStep}>
 *   {stepper.isLastStep ? 'Finish' : 'Next'}
 * </Button>
 * ```
 */
export function useStepper({
  initialStep = 0,
  totalSteps,
  onStepChange,
  onComplete,
}: UseStepperOptions): UseStepperReturn {
  const [activeStep, setActiveStep] = useState(initialStep);
  const [isCompleted, setIsCompleted] = useState(false);

  const goToStep = useCallback(
    (step: number) => {
      if (step >= 0 && step < totalSteps) {
        setActiveStep(step);
        onStepChange?.(step);
      }
    },
    [totalSteps, onStepChange]
  );

  const nextStep = useCallback(() => {
    if (activeStep === totalSteps - 1) {
      setIsCompleted(true);
      onComplete?.();
    } else {
      goToStep(activeStep + 1);
    }
  }, [activeStep, totalSteps, goToStep, onComplete]);

  const prevStep = useCallback(() => {
    goToStep(activeStep - 1);
  }, [activeStep, goToStep]);

  const reset = useCallback(() => {
    setActiveStep(0);
    setIsCompleted(false);
    onStepChange?.(0);
  }, [onStepChange]);

  return {
    activeStep,
    nextStep,
    prevStep,
    goToStep,
    reset,
    isFirstStep: activeStep === 0,
    isLastStep: activeStep === totalSteps - 1,
    isCompleted,
  };
}

/**
 * Props for StepperActions component.
 */
export interface StepperActionsProps {
  /** Stepper hook return */
  stepper: UseStepperReturn;
  /** Back button label */
  backLabel?: string;
  /** Next button label */
  nextLabel?: string;
  /** Finish button label */
  finishLabel?: string;
  /** Disable next button */
  disableNext?: boolean;
  /** Custom actions */
  actions?: ReactNode;
}

/**
 * StepperActions - Common action buttons for stepper.
 *
 * @example
 * ```tsx
 * <StepperActions stepper={stepper} />
 * ```
 */
export function StepperActions({
  stepper,
  backLabel = 'Back',
  nextLabel = 'Next',
  finishLabel = 'Finish',
  disableNext = false,
  actions,
}: StepperActionsProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
      <Button variant="outlined" onClick={stepper.prevStep} disabled={stepper.isFirstStep}>
        {backLabel}
      </Button>
      <Box sx={{ flex: 1 }} />
      {actions}
      <Button variant="contained" onClick={stepper.nextStep} disabled={disableNext}>
        {stepper.isLastStep ? finishLabel : nextLabel}
      </Button>
    </Box>
  );
}
