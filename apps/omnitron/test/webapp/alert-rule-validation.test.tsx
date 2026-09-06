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

const createRule = vi.fn();

vi.mock('src/netron/client', () => ({
  alerts: {
    listRules: vi.fn(async () => []),
    listEvents: vi.fn(async () => []),
    createRule: (...a: unknown[]) => createRule(...a),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    acknowledgeEvent: vi.fn(),
    resolveEvent: vi.fn(),
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

beforeEach(() => createRule.mockReset());

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

    expect(await screen.findByText(/cannot read this expression/i)).toBeInTheDocument();
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
