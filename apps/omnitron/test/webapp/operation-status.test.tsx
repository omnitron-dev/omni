// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { OperationStatus } from '../../webapp/src/components/operation-status.js';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('shows elapsed waiting without inventing progress, resets on a new operation and stops its timer', () => {
  vi.useFakeTimers();
  const view = render(<OperationStatus active label="Connecting" />);
  expect(screen.getByRole('status')).toHaveTextContent('Connecting');
  act(() => vi.advanceTimersByTime(11000));
  expect(screen.getByText('Still waiting for confirmation…')).toBeInTheDocument();
  expect(screen.getByText('11s')).toHaveAttribute('aria-hidden', 'true');
  view.rerender(<OperationStatus active label="Reading policy" />);
  expect(screen.getByText('0s')).toBeInTheDocument();
  view.rerender(<OperationStatus active={false} label="Reading policy" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(vi.getTimerCount()).toBe(0);
});
