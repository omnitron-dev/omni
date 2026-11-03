// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { StackStartNotice } from '../../webapp/src/components/stack-start-notice.js';
afterEach(cleanup);
const notUp = ['api (errored): module "dependency.js" is unavailable; verify dependency installation and the active runtime compiler',
  'worker (stopped): dependency api did not start'];
describe('durable stack launch evidence', () => {
  it('renders backend evidence without requiring a start operation in this browser and clears after recovery', () => {
    const view = render(<StackStartNotice stack={{ status: 'error', notUp }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Not up · 2');
    for (const issue of notUp) expect(screen.getByText(issue)).toBeInTheDocument();
    view.rerender(<StackStartNotice stack={{ status: 'running' }} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps the first actionable reason visible on a compact card with an explicit remainder', () => {
    render(<StackStartNotice stack={{ status: 'degraded', notUp }} compact />);
    expect(screen.getByText(notUp[0]!)).toBeInTheDocument();
    expect(screen.getByText('1 more · Open stack for details')).toBeInTheDocument();
  });
});
