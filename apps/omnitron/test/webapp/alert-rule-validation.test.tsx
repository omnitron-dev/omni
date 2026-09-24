// @vitest-environment happy-dom

/**
 * Rejecting an alert expression before the rule exists.
 *
 * The evaluator answers an expression it cannot read with `firing: false` —
 * the same answer a healthy platform gives — so a rule outside the grammar
 * is created successfully, shows enabled and green, and catches nothing.
 * There is no later moment at which anybody finds out.
 *
 * The form's own placeholder used to read `cpu_percent > 90`, which is not a
 * supported form: the interface was suggesting an expression that could
 * never fire.
 */

import type { ReactNode } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { SnackbarProvider } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';

import type { AlertRule } from '../../src/shared/dto/alerts.js';

const createRule = vi.fn();
const updateRule = vi.fn();
let listed: AlertRule[] = [];

// The client's own method names. This mock used to offer `listRules`,
// `listEvents`, `acknowledgeEvent` and `resolveEvent`, none of which the
// client has: the page's first read threw, and every case here ran against
// a page in its error state.
vi.mock('src/netron/client', () => ({
  alerts: {
    getRules: vi.fn(async () => listed),
    getActiveAlerts: vi.fn(async () => []),
    createRule: (...a: unknown[]) => createRule(...a),
    updateRule: (...a: unknown[]) => updateRule(...a),
    deleteRule: vi.fn(),
    acknowledgeAlert: vi.fn(),
  },
  daemon: {},
  logs: {},
}));

const theme = createTheme();
const render = (ui: ReactNode) =>
  rtlRender(
    <ThemeProvider theme={theme}>
      <SnackbarProvider>{ui}</SnackbarProvider>
    </ThemeProvider>
  );

beforeEach(() => {
  createRule.mockReset();
  updateRule.mockReset();
  listed = [];
});

async function openForm() {
  const { default: AlertsPage } = await import('../../webapp/src/pages/alerts.js');
  const user = userEvent.setup();
  render(<AlertsPage />);
  await user.click(await screen.findByRole('button', { name: /new rule|add rule|new alert/i }));
  return user;
}

describe('the new-rule form', () => {
  it('refuses an expression the evaluator cannot read, and says what it accepts', async () => {
    const user = await openForm();

    await user.type(screen.getByLabelText(/name/i), 'Disk pressure');
    await user.type(screen.getByLabelText(/expression/i), 'disk.usage > 90');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    // In the daemon's words: the form runs the same check (`readAlertRuleFields`).
    expect(await screen.findByText(/not one the evaluator reads/i)).toBeInTheDocument();
    // And nothing was stored. A rejected rule that still reaches the daemon
    // is the same defect one layer down.
    expect(createRule).not.toHaveBeenCalled();
  });

  it('accepts a supported expression', async () => {
    createRule.mockResolvedValue({ id: 'r1', name: 'App down', expression: 'app.main.status != online' });
    const user = await openForm();

    await user.type(screen.getByLabelText(/name/i), 'App down');
    await user.type(screen.getByLabelText(/expression/i), 'app.main.status != online');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
    expect(createRule.mock.calls[0]![0]).toMatchObject({ expression: 'app.main.status != online' });
    // What a rule watches is read off its expression, never sent.
    expect(createRule.mock.calls[0]![0]).not.toHaveProperty('type');
  });

  it('sends the wait and the summary, and refuses a wait that is not whole seconds', async () => {
    createRule.mockResolvedValue({ id: 'r2' });
    const user = await openForm();

    await user.type(screen.getByLabelText(/name/i), 'CPU hot');
    await user.type(screen.getByLabelText(/expression/i), 'app.*.cpu > 90');
    await user.type(screen.getByLabelText(/fire after/i), '1.5');
    await user.click(screen.getByRole('button', { name: /create|save/i }));
    expect(await screen.findByText(/forDuration: whole seconds/i)).toBeInTheDocument();
    expect(createRule).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/fire after/i));
    await user.type(screen.getByLabelText(/fire after/i), '300');
    await user.type(screen.getByLabelText(/summary/i), 'CPU above 90% for five minutes');
    await user.click(screen.getByRole('button', { name: /create|save/i }));

    await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
    expect(createRule.mock.calls[0]![0]).toMatchObject({ forDuration: 300, summary: 'CPU above 90% for five minutes' });
  });

  it('suggests a form that actually works', async () => {
    // The placeholder is the first thing an operator copies. It used to
    // suggest `cpu_percent > 90`, which the evaluator cannot read.
    await openForm();

    const field = screen.getByLabelText(/expression/i);
    const placeholder = field.getAttribute('placeholder') ?? '';
    const { isAlertExpressionParseable } = await import('../../src/shared/alert-expression.js');

    expect(placeholder).not.toBe('');
    expect(isAlertExpressionParseable(placeholder.replace(/^e\.g\.\s*/, ''))).toBe(true);
  });
});

describe('a rule opened for editing', () => {
  it('fills the form with its fields, and saves what the daemon reads', async () => {
    listed = [
      {
        id: 'r9',
        name: 'CPU above 90%',
        expression: 'app.*.cpu > 90',
        type: 'metric',
        severity: 'warning',
        forDuration: 300,
        summary: 'Hot for five minutes',
        enabled: true,
        lastEvaluatedAt: null,
        createdAt: '2026-09-24T10:00:00.000Z',
        updatedAt: '2026-09-24T10:00:00.000Z',
      },
    ];
    updateRule.mockResolvedValue(listed[0]);
    const { default: AlertsPage } = await import('../../webapp/src/pages/alerts.js');
    const user = userEvent.setup();
    render(<AlertsPage />);

    await user.click(await screen.findByRole('button', { name: /edit rule/i }));
    expect(screen.getByLabelText(/fire after/i)).toHaveValue('300');
    expect(screen.getByLabelText(/summary/i)).toHaveValue('Hot for five minutes');

    await user.clear(screen.getByLabelText(/fire after/i));
    await user.type(screen.getByLabelText(/fire after/i), '600');
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() => expect(updateRule).toHaveBeenCalledTimes(1));
    expect(updateRule.mock.calls[0]![0]).toEqual({
      id: 'r9',
      name: 'CPU above 90%',
      expression: 'app.*.cpu > 90',
      severity: 'warning',
      forDuration: 600,
      summary: 'Hot for five minutes',
      enabled: true,
    });
    expect(createRule).not.toHaveBeenCalled();
  });
});
