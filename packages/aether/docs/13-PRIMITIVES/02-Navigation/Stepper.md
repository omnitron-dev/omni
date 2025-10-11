### Stepper

A multi-step wizard navigation component with support for linear and non-linear navigation modes, step completion tracking, and validation.

#### Features

- Linear and non-linear navigation modes
- Step completion tracking
- Disabled step support
- Keyboard navigation
- Current step indicator
- Step descriptions
- Validation support
- Horizontal and vertical orientation
- ARIA step navigation pattern

#### Basic Usage

```typescript
import { defineComponent, signal } from 'aether';
import { Stepper } from 'aether/primitives';

const Example = defineComponent(() => {
  const currentStep = signal(0);

  return () => (
    <Stepper value={currentStep()} onValueChange={currentStep} linear>
      <Stepper.List class="stepper-list">
        <Stepper.Item value={0} class="stepper-item">
          <Stepper.Trigger class="stepper-trigger">
            <span class="step-number">1</span>
            <span class="step-title">Account</span>
          </Stepper.Trigger>
          <Stepper.Description class="step-description">
            Create your account
          </Stepper.Description>
        </Stepper.Item>

        <Stepper.Separator class="stepper-separator" />

        <Stepper.Item value={1} class="stepper-item">
          <Stepper.Trigger class="stepper-trigger">
            <span class="step-number">2</span>
            <span class="step-title">Profile</span>
          </Stepper.Trigger>
          <Stepper.Description class="step-description">
            Complete your profile
          </Stepper.Description>
        </Stepper.Item>

        <Stepper.Separator class="stepper-separator" />

        <Stepper.Item value={2} class="stepper-item">
          <Stepper.Trigger class="stepper-trigger">
            <span class="step-number">3</span>
            <span class="step-title">Confirm</span>
          </Stepper.Trigger>
          <Stepper.Description class="step-description">
            Review and confirm
          </Stepper.Description>
        </Stepper.Item>
      </Stepper.List>

      <Stepper.Content value={0} class="step-content">
        <h3>Step 1: Account Details</h3>
        <input type="email" placeholder="Email" />
        <input type="password" placeholder="Password" />
      </Stepper.Content>

      <Stepper.Content value={1} class="step-content">
        <h3>Step 2: Profile Information</h3>
        <input type="text" placeholder="Full Name" />
        <input type="tel" placeholder="Phone" />
      </Stepper.Content>

      <Stepper.Content value={2} class="step-content">
        <h3>Step 3: Confirmation</h3>
        <p>Please review your information...</p>
      </Stepper.Content>

      <div class="stepper-actions">
        <button
          onClick={() => currentStep.set(currentStep() - 1)}
          disabled={currentStep() === 0}
        >
          Back
        </button>
        <button
          onClick={() => currentStep.set(currentStep() + 1)}
          disabled={currentStep() === 2}
        >
          Next
        </button>
      </div>
    </Stepper>
  );
});
```

#### With Completion Tracking

```typescript
const Example = defineComponent(() => {
  const currentStep = signal(0);
  const completedSteps = signal<Set<number>>(new Set());

  const markStepCompleted = (step: number) => {
    const newCompleted = new Set(completedSteps());
    newCompleted.add(step);
    completedSteps.set(newCompleted);
  };

  const handleNext = () => {
    markStepCompleted(currentStep());
    currentStep.set(currentStep() + 1);
  };

  return () => (
    <Stepper value={currentStep()} onValueChange={currentStep} linear>
      <Stepper.List>
        <Stepper.Item
          value={0}
          completed={completedSteps().has(0)}
        >
          <Stepper.Trigger>Step 1</Stepper.Trigger>
        </Stepper.Item>

        <Stepper.Item
          value={1}
          completed={completedSteps().has(1)}
        >
          <Stepper.Trigger>Step 2</Stepper.Trigger>
        </Stepper.Item>

        <Stepper.Item
          value={2}
          completed={completedSteps().has(2)}
        >
          <Stepper.Trigger>Step 3</Stepper.Trigger>
        </Stepper.Item>
      </Stepper.List>

      <Stepper.Content value={0}>
        Content for step 1
        <button onClick={handleNext}>Next</button>
      </Stepper.Content>

      <Stepper.Content value={1}>
        Content for step 2
        <button onClick={handleNext}>Next</button>
      </Stepper.Content>

      <Stepper.Content value={2}>
        Content for step 3
        <button onClick={() => console.log('Complete!')}>Finish</button>
      </Stepper.Content>
    </Stepper>
  );
});
```

#### API

**`<Stepper>`** - Root component
- `value?: number` - Controlled current step
- `onValueChange?: (step: number) => void` - Step change callback
- `defaultValue?: number` - Default current step (uncontrolled)
- `orientation?: 'horizontal' | 'vertical'` - Orientation (default: 'horizontal')
- `linear?: boolean` - Linear navigation mode (default: false)

**`<Stepper.List>`** - Container for step items

**`<Stepper.Item>`** - Individual step in the list
- `value: number` - Step index
- `completed?: boolean` - Whether step is completed
- `disabled?: boolean` - Whether step is disabled

**`<Stepper.Trigger>`** - Button to navigate to a step

**`<Stepper.Description>`** - Optional description for a step

**`<Stepper.Content>`** - Content panel for each step
- `value: number` - Step index for this content

**`<Stepper.Separator>`** - Visual separator between steps

---

