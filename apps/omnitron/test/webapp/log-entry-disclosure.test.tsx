// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import '@testing-library/jest-dom/vitest';
import { LogEntryRowView } from '../../webapp/src/components/log-entry-row.js';
import type { LogEntryRow } from '../../src/shared/dto/logs.js';
const clipboard = vi.hoisted(() => ({ state: 'ready', copy: vi.fn() }));
vi.mock('@omnitron-dev/prism/core', () => ({ useCopyToClipboard: () => clipboard }));
const log: LogEntryRow = {
  id: 'event-1',
  timestamp: new Date('2026-10-31T19:48:16.123Z'),
  app: 'sample/local/worker',
  nodeId: 'node-1',
  level: 'error',
  message: 'Startup failed\n  at start (worker.ts:42)\n  caused by: connection refused',
  labels: { deployment: 'release-1' },
  traceId: 'trace-1',
  spanId: null,
  metadata: {
    retries: 3,
    _omnitron: { capturedAt: '2026-10-31T19:48:16.125Z', stream: 'stderr', timeBasis: 'reported', sequence: 35 },
    _omnitronPayloadSha256: 'receipt-digest',
  },
};
afterEach(cleanup);
it('preserves multiline text and complete raw evidence in a keyboard-accessible disclosure', () => {
  render(
    <ThemeProvider theme={createTheme()}>
      <LogEntryRowView log={log} nodeNames={{ 'node-1': 'Worker node' }} />
    </ThemeProvider>
  );
  const toggle = screen.getByRole('button', { name: /Startup failed/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Worker node')).toBeInTheDocument();
  expect(screen.getByText('2026-10-31T19:48:16.125Z')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Raw event' }));
  const raw = screen.getByLabelText('Raw log event');
  expect(JSON.parse(raw.textContent!)).toEqual(JSON.parse(JSON.stringify(log)));
  fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
  expect(clipboard.copy).toHaveBeenCalledWith(JSON.stringify(log, null, 2));
  fireEvent.keyDown(raw, { key: 'Escape' });
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
