// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RuntimeDiagnosticDetails } from '../../webapp/src/components/runtime-diagnostic-details';
afterEach(cleanup);

it('shows evidence and recovery on demand and preserves the node when opening logs', () => {
  render(<MemoryRouter><RuntimeDiagnosticDetails nodeName="node east" active={[{ event: {
    id: 'runtime.job.alerts', title: 'Alert evaluation failed', evidence: ['connection refused'], remedy: 'Restore the database connection',
  }, occurrences: 3 }]} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Runtime diagnostic evidence' }));
  expect(screen.getByText('connection refused')).toBeTruthy();
  expect(screen.getByText('Restore the database connection')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open daemon logs' }).getAttribute('href')).toBe('/logs?app=omnitron&node=node+east');
});

it('ignores absent and malformed remote evidence', () => {
  const result = render(<RuntimeDiagnosticDetails active={[null, { event: { title: {} } }]} />);
  expect(result.container.textContent).toBe('');
});
