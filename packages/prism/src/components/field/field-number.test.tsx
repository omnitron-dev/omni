/**
 * Field.Number — controlled numeric input.
 *
 * `Field` is the form primitive the whole design system exposes (48 call
 * sites in the DAOS portal alone) and it had no component tests at all: the
 * suite covered hooks and utilities, so 4.5k lines of form fields shipped
 * unverified.
 *
 * These tests pin the behaviour a numeric field has to get right — typing a
 * decimal, clearing the box, surviving a re-render mid-edit — because each of
 * those was broken.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { FieldNumber } from './field-number.js';

interface HarnessProps {
  defaultValues?: Record<string, unknown>;
  children?: ReactNode;
  onValue?: (value: unknown) => void;
}

/** A form wrapper that reports the live value of `amount` to the test. */
function Harness({ defaultValues = { amount: 0 }, children, onValue }: HarnessProps) {
  const methods = useForm({ defaultValues });
  return (
    <FormProvider {...methods}>
      {children}
      {onValue ? <ValueProbe onValue={onValue} /> : null}
    </FormProvider>
  );
}

function ValueProbe({ onValue }: { onValue: (value: unknown) => void }) {
  const value = useWatch({ name: 'amount' });
  onValue(value);
  return null;
}

/**
 * Forces a parent re-render on demand, the way form validation does.
 *
 * The trigger is exposed through a ref rather than a button on purpose:
 * clicking one would blur the input, and blur legitimately reformats the
 * value — which would test the wrong thing.
 */
function RerenderHarness({ children, trigger }: { children: ReactNode; trigger: { current?: () => void } }) {
  const methods = useForm({ defaultValues: { amount: 0 } });
  const [, setTick] = useState(0);
  trigger.current = () => setTick((t) => t + 1);
  return <FormProvider {...methods}>{children}</FormProvider>;
}

describe('Field.Number', () => {
  it('accepts a decimal point while typing', async () => {
    // The display value used to be overwritten from the form value on every
    // render. Mid-entry, "1." parses to 1 and formats back to "1", so the
    // separator the user had just typed disappeared and a decimal could never
    // be entered.
    const user = userEvent.setup();
    render(
      <Harness>
        <FieldNumber name="amount" label="Amount" decimals={2} />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '1.5');

    expect(input).toHaveValue('1.5');
  });

  it('keeps the typed text across an unrelated re-render', async () => {
    const user = userEvent.setup();
    const trigger: { current?: () => void } = {};
    render(
      <RerenderHarness trigger={trigger}>
        <FieldNumber name="amount" label="Amount" decimals={2} />
      </RerenderHarness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '2.');

    // Re-render the tree without touching focus.
    act(() => trigger.current?.());

    // The half-typed value must survive; it used to be reformatted to "2".
    expect(input).toHaveValue('2.');
  });

  it('lets the field be emptied', async () => {
    // Clearing used to push `defaultValue` (0) into the form immediately and
    // then repaint the box as "0", so the field could not be left blank — and
    // a `required` rule could never fire.
    const user = userEvent.setup();
    render(
      <Harness>
        <FieldNumber name="amount" label="Amount" />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);

    expect(input).toHaveValue('');
  });

  it('commits a number to the form as a number, not a string', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness onValue={onValue}>
        <FieldNumber name="amount" label="Amount" />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '42');

    await waitFor(() => {
      expect(onValue).toHaveBeenLastCalledWith(42);
    });
  });

  it('normalises the display on blur', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <FieldNumber name="amount" label="Amount" decimals={2} />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '3.');
    await user.tab();

    expect(input).toHaveValue('3.00');
  });

  it('clamps to max on blur', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness onValue={onValue}>
        <FieldNumber name="amount" label="Amount" max={10} />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '99');
    await user.tab();

    await waitFor(() => {
      expect(onValue).toHaveBeenLastCalledWith(10);
    });
  });

  it('rejects a negative sign when allowNegative is false', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <FieldNumber name="amount" label="Amount" allowNegative={false} />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    await user.clear(input);
    await user.type(input, '-5');

    expect(input).toHaveValue('5');
  });

  it('exposes range and validity to assistive technology', () => {
    render(
      <Harness>
        <FieldNumber name="amount" label="Amount" min={1} max={10} />
      </Harness>
    );

    const input = screen.getByLabelText(/amount/i);
    expect(input).toHaveAttribute('aria-valuemin', '1');
    expect(input).toHaveAttribute('aria-valuemax', '10');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });

  it('keeps its accessibility attributes when the caller passes slotProps', () => {
    // `slotProps` was spread AFTER the component's own `htmlInput`, so any
    // caller-supplied slotProps replaced the aria wiring wholesale.
    render(
      <Harness>
        <FieldNumber
          name="amount"
          label="Amount"
          min={1}
          max={10}
          slotProps={{ htmlInput: { 'data-testid': 'custom' } as never }}
        />
      </Harness>
    );

    const input = screen.getByTestId('custom');
    expect(input).toHaveAttribute('aria-valuemin', '1');
    expect(input).toHaveAttribute('aria-valuemax', '10');
  });
});
