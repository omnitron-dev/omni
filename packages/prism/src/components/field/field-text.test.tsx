/**
 * Field.Text and Field.Select — the two fields every form starts with.
 *
 * Both shipped with no component tests. These pin the parts that are easy to
 * break silently: the react-hook-form wiring, the null-safety of the value,
 * and the accessibility attributes — which a caller-supplied `slotProps` used
 * to wipe out entirely.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import type { ReactNode } from 'react';

import { FieldText } from './field-text.js';
import { FieldSelect } from './field-select.js';

function Harness({
  defaultValues = {},
  children,
  onValue,
  name = 'value',
  mode,
}: {
  defaultValues?: Record<string, unknown>;
  children: ReactNode;
  onValue?: (value: unknown) => void;
  name?: string;
  mode?: 'onBlur' | 'onChange' | 'onSubmit';
}) {
  const methods = useForm({ defaultValues, ...(mode ? { mode } : {}) });
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(() => undefined)}>
        {children}
        <button type="submit">submit</button>
      </form>
      {onValue ? <Probe name={name} onValue={onValue} /> : null}
    </FormProvider>
  );
}

function Probe({ name, onValue }: { name: string; onValue: (value: unknown) => void }) {
  onValue(useWatch({ name }));
  return null;
}

describe('Field.Text', () => {
  it('renders an empty box for an undefined form value', () => {
    // Without the `?? ''`, React would flip the input from uncontrolled to
    // controlled on first keystroke and warn.
    render(
      <Harness defaultValues={{}}>
        <FieldText name="value" label="Name" />
      </Harness>
    );

    expect(screen.getByLabelText(/name/i)).toHaveValue('');
  });

  it('writes what is typed into the form', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness defaultValues={{ value: '' }} onValue={onValue}>
        <FieldText name="value" label="Name" />
      </Harness>
    );

    await user.type(screen.getByLabelText(/name/i), 'omnitron');

    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('omnitron'));
  });

  it('marks the input invalid and points at the message when validation fails', async () => {
    const user = userEvent.setup();
    render(
      <Harness defaultValues={{ value: '' }} mode="onBlur">
        <FieldText name="value" label="Name" required rules={{ required: 'Name is required' }} />
      </Harness>
    );

    const input = screen.getByLabelText(/name/i);
    expect(input).toHaveAttribute('aria-required', 'true');

    // `mode: 'onBlur'` runs the rule when focus leaves the empty field.
    await user.click(input);
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('Name is required');
  });

  it('keeps its accessibility attributes when the caller passes slotProps', () => {
    // The caller's `slotProps` was spread last, replacing `htmlInput` — and
    // with it aria-invalid, aria-required and aria-describedby.
    render(
      <Harness defaultValues={{ value: '' }}>
        <FieldText
          name="value"
          label="Name"
          required
          slotProps={{ htmlInput: { 'data-testid': 'custom', maxLength: 5 } as never }}
        />
      </Harness>
    );

    const input = screen.getByTestId('custom');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('maxlength', '5');
  });
});

describe('Field.Select', () => {
  const options = [
    { value: 'metric', label: 'Metric' },
    { value: 'log', label: 'Log' },
  ];

  it('selects an option into the form', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(
      <Harness defaultValues={{ value: '' }} onValue={onValue}>
        <FieldSelect name="value" label="Type" options={options} />
      </Harness>
    );

    await user.click(screen.getByLabelText(/type/i));
    await user.click(await screen.findByRole('option', { name: 'Log' }));

    await waitFor(() => expect(onValue).toHaveBeenLastCalledWith('log'));
  });

  it('exposes required state to assistive technology', () => {
    render(
      <Harness defaultValues={{ value: '' }}>
        <FieldSelect name="value" label="Type" required options={options} />
      </Harness>
    );

    expect(screen.getByLabelText(/type/i)).toHaveAttribute('aria-required', 'true');
  });
});
