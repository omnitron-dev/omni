/**
 * ErrorBoundary — stack parsing, and when the boundary lets go of an error.
 *
 * The parsing half is what the fallback shows an operator: a file, a line
 * and a function name. All three were scrambled for anonymous frames, which
 * is most of a minified production stack — the build where this component is
 * the only thing standing between a user and a blank page. So the anonymous
 * shape is pinned first, and the named one beside it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ErrorBoundary, parseStackTrace, getErrorLocation } from './error-boundary.js';

describe('parseStackTrace', () => {
  it('reads a named frame', () => {
    const { primary } = parseStackTrace('Error: boom\n    at Component (/app/src/Button.tsx:42:15)');

    expect(primary).toMatchObject({
      functionName: 'Component',
      filePath: 'src/Button.tsx',
      lineNumber: 42,
      columnNumber: 15,
      isAppCode: true,
    });
  });

  it('reads an anonymous frame without shuffling its fields', () => {
    // The bug this replaces: the path became the function name, the line
    // number became the path, the column became the line, and the column
    // came back null. Every assertion below failed before the fix.
    const { primary } = parseStackTrace('Error: boom\n    at /app/src/Button.tsx:42:15');

    expect(primary).toMatchObject({
      functionName: null,
      filePath: 'src/Button.tsx',
      lineNumber: 42,
      columnNumber: 15,
      isAppCode: true,
    });
  });

  it('reads a frame the bundler rewrote with a query string', () => {
    const { primary } = parseStackTrace('    at Module.render (/app/src/Button.tsx?v=a1b2:42:15)');

    expect(primary).toMatchObject({ filePath: 'src/Button.tsx', lineNumber: 42, columnNumber: 15 });
  });

  it('does not call a dependency app code because it ships its own src/', () => {
    // `node_modules/pkg/src/index.js` contains `/src/`. Treating it as app
    // code made it the primary location, so the error pointed at the library
    // instead of at the caller that misused it.
    const { primary, frames } = parseStackTrace(
      [
        'Error: boom',
        '    at inner (/app/node_modules/some-pkg/src/index.js:9:1)',
        '    at Caller (/app/src/Page.tsx:12:3)',
      ].join('\n')
    );

    expect(frames[0]!.isAppCode).toBe(false);
    expect(primary?.filePath).toBe('src/Page.tsx');
  });

  it('falls back to the first frame when nothing is app code', () => {
    const { primary } = parseStackTrace('Error: boom\n    at x (/app/node_modules/p/dist/i.js:1:2)');

    expect(primary?.filePath).toContain('i.js');
  });

  it('returns an empty result for a missing stack rather than throwing', () => {
    expect(parseStackTrace(undefined)).toEqual({ primary: null, frames: [], raw: '' });
  });
});

describe('getErrorLocation', () => {
  it('names the function and the place', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at Component (/app/src/Button.tsx:42:15)';

    expect(getErrorLocation(err)).toBe('in Component (src/Button.tsx:42)');
  });

  it('omits the function for an anonymous frame instead of printing the path twice', () => {
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at /app/src/Button.tsx:42:15';

    expect(getErrorLocation(err)).toBe('(src/Button.tsx:42)');
  });
});

// A child that throws on demand, so the boundary is exercised for real.
function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('child exploded');
  return <div>all good</div>;
}

/** React logs caught errors; silence it so the run stays readable. */
function quietly<T>(fn: () => T): T {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

describe('ErrorBoundary', () => {
  it('renders children while nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('shows the fallback and reports the error once', () => {
    const onError = vi.fn();

    quietly(() =>
      render(
        <ErrorBoundary onError={onError}>
          <Boom explode />
        </ErrorBoundary>
      )
    );

    expect(screen.getByText('child exploded')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    // The parsed stack goes to the handler too — the point of the callback
    // is that a logging service receives the location, not just the message.
    expect(onError.mock.calls[0]![2]).toHaveProperty('frames');
  });

  it('recovers when a reset key changes', () => {
    let view!: ReturnType<typeof render>;
    quietly(() => {
      view = render(
        <ErrorBoundary resetKeys={['a']}>
          <Boom explode />
        </ErrorBoundary>
      );
    });

    expect(screen.getByText('child exploded')).toBeInTheDocument();

    view.rerender(
      <ErrorBoundary resetKeys={['b']}>
        <Boom explode={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('recovers when the reset keys SHRINK', () => {
    // `some` walks the current array, so a list that loses a key compares
    // only the survivors, finds them equal and never resets. Growing the
    // list worked, which is what hid it.
    let view!: ReturnType<typeof render>;
    quietly(() => {
      view = render(
        <ErrorBoundary resetKeys={['a', 'b']}>
          <Boom explode />
        </ErrorBoundary>
      );
    });

    expect(screen.getByText('child exploded')).toBeInTheDocument();

    view.rerender(
      <ErrorBoundary resetKeys={['a']}>
        <Boom explode={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('stays in the error state while the reset keys are unchanged', () => {
    let view!: ReturnType<typeof render>;
    quietly(() => {
      view = render(
        <ErrorBoundary resetKeys={['a']}>
          <Boom explode />
        </ErrorBoundary>
      );
    });

    view.rerender(
      <ErrorBoundary resetKeys={['a']}>
        <Boom explode={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('child exploded')).toBeInTheDocument();
  });

  it('recovers through the Try Again button, and calls onReset', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    let view!: ReturnType<typeof render>;
    quietly(() => {
      view = render(
        <ErrorBoundary onReset={onReset}>
          <Boom explode />
        </ErrorBoundary>
      );
    });

    view.rerender(
      <ErrorBoundary onReset={onReset}>
        <Boom explode={false} />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('renders a custom fallback element', () => {
    quietly(() =>
      render(
        <ErrorBoundary fallback={<div>custom</div>}>
          <Boom explode />
        </ErrorBoundary>
      )
    );

    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('gives a render-prop fallback the error and a way out', async () => {
    const user = userEvent.setup();

    let view!: ReturnType<typeof render>;
    quietly(() => {
      view = render(
        <ErrorBoundary
          fallback={({ error, resetErrorBoundary }) => (
            <button onClick={resetErrorBoundary}>retry {error.message}</button>
          )}
        >
          <Boom explode />
        </ErrorBoundary>
      );
    });

    expect(screen.getByRole('button', { name: /retry child exploded/i })).toBeInTheDocument();

    view.rerender(
      <ErrorBoundary
        fallback={({ error, resetErrorBoundary }) => (
          <button onClick={resetErrorBoundary}>retry {error.message}</button>
        )}
      >
        <Boom explode={false} />
      </ErrorBoundary>
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(screen.getByText('all good')).toBeInTheDocument();
  });
});
