// @vitest-environment happy-dom

/**
 * What the console does when a page throws.
 *
 * It used to do almost nothing: a local `ErrorBoundary` with no
 * `componentDidCatch`, so a crash produced one sentence on screen and no
 * trace anywhere — no stack, no component path, nothing an operator could
 * attach to a report. For the window an operator watches a platform
 * through, that is the least useful outcome available.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@omnitron-dev/prism';
import '@testing-library/jest-dom/vitest';

import { reportCrash } from '../../webapp/src/utils/report-crash.js';

function Boom(): React.ReactElement {
  const err = new Error('the page exploded');
  err.stack = 'Error: the page exploded\n    at Boom (/app/src/pages/apps/index.tsx:42:15)';
  throw err;
}

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

function quiet() {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  spies.push(spy);
  return spy;
}

describe('console crash reporting', () => {
  it('names the location, the message and the component path', () => {
    const spy = quiet();

    render(
      <ErrorBoundary showDetails onError={reportCrash}>
        <Boom />
      </ErrorBoundary>
    );

    const ours = spy.mock.calls.find((c) => String(c[0]).includes('[omnitron-console]'));
    expect(ours, 'the crash was not reported').toBeDefined();
    expect(String(ours![0])).toContain('src/pages/apps/index.tsx:42');
    expect(String(ours![0])).toContain('the page exploded');
    // The component path is what says WHERE in the tree, which a stack of
    // minified frames often cannot.
    expect(ours![1]).toHaveProperty('componentStack');
  });

  it('shows the operator the failure rather than a bare apology', () => {
    quiet();

    render(
      <ErrorBoundary showDetails onError={reportCrash}>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText('the page exploded')).toBeInTheDocument();
    // `showDetails` is passed explicitly rather than left to the dev-mode
    // default: an operator hitting this in a production build is exactly who
    // needs the stack, and the button that copies it.
    expect(screen.getByRole('button', { name: /copy error details/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show stack trace/i })).toBeInTheDocument();
  });
});
