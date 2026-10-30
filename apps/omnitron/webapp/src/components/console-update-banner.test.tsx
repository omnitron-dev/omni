// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { ConsoleUpdateBanner } from './console-update-banner';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.head.querySelector('meta[name="omnitron-console-build"]')?.remove(); });
function current() {
  const meta = document.createElement('meta'); meta.name = 'omnitron-console-build'; meta.content = 'a'.repeat(64); document.head.appendChild(meta);
}
describe('Console deployment notice', () => {
  it('offers an explicit update without reloading an open workspace', async () => {
    current();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: 'b'.repeat(64) }) })));
    render(<ConsoleUpdateBanner />);
    await waitFor(() => expect(screen.getByText(/Console update available/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/console-version.json', expect.objectContaining({ cache: 'no-store' }));
  });
  it('does not mistake an unavailable version probe for a deployment', async () => {
    current(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<ConsoleUpdateBanner />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button')).toBeNull();
    act(() => window.dispatchEvent(new Event('vite:preloadError')));
    expect(screen.getByText(/This page could not load/)).toBeTruthy();
    expect(screen.queryByText(/Console update available/)).toBeNull();
  });
});
