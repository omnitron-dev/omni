import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrollSpyProvider, useScrollSpy } from './scroll-spy-provider.js';

function Current() {
  const { activeId } = useScrollSpy();
  return <output>{activeId ?? 'none'}</output>;
}

describe('ScrollSpyProvider lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let resized: ResizeObserverCallback;
  let disconnect: ReturnType<typeof vi.fn>;
  const frame = async () => {
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  };
  const heading = (id: string, top: number) => {
    const element = document.createElement('h2'); element.id = id;
    const rect = { top, bottom: top + 30, left: 0, right: 200, width: 200, height: 30, x: 0, y: top, toJSON() {} };
    element.getBoundingClientRect = () => rect;
    element.getClientRects = () => [rect] as unknown as DOMRectList;
    document.body.append(element);
    return element;
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe = vi.fn();
      disconnect = disconnect;
    });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('rescans changed IDs and replacement elements instead of retaining detached entries', async () => {
    const first = heading('first', -300); const second = heading('second', 40);
    await act(async () => root.render(<ScrollSpyProvider headingIds={['first', 'second']} offset={80}><Current /></ScrollSpyProvider>));
    await frame(); expect(host.textContent).toBe('second');
    second.remove(); await frame(); await frame(); expect(host.textContent).toBe('first');
    heading('second', 40); await frame(); await frame(); expect(host.textContent).toBe('second');
    first.id = 'renamed';
    document.getElementById('second')!.id = 'also-renamed';
    await frame(); await frame(); expect(host.textContent).toBe('none');
  });

  it('reacts to layout resize without requiring a scroll event', async () => {
    heading('first', -300); const second = heading('second', 40);
    await act(async () => root.render(<ScrollSpyProvider headingIds={['first', 'second']} offset={80}><Current /></ScrollSpyProvider>));
    await frame(); expect(host.textContent).toBe('second');
    second.getBoundingClientRect = () => ({ top: 400 }) as DOMRect;
    await act(async () => resized([], {} as ResizeObserver));
    await frame(); expect(host.textContent).toBe('first');
  });

  it('disconnects observers, listeners and the queued frame on unmount', async () => {
    const removedWindow = vi.spyOn(window, 'removeEventListener');
    const removedDocument = vi.spyOn(document, 'removeEventListener');
    const requested = vi.spyOn(window, 'requestAnimationFrame');
    const cancelled = vi.spyOn(window, 'cancelAnimationFrame');
    heading('first', 40);
    await act(async () => root.render(<ScrollSpyProvider headingIds={['first']}><Current /></ScrollSpyProvider>));
    await frame();
    let scheduled: number | undefined;
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      scheduled = requested.mock.results.at(-1)?.value;
      root.render(null);
    });
    expect(disconnect).toHaveBeenCalled();
    expect(scheduled).toBeDefined();
    expect(cancelled).toHaveBeenCalledWith(scheduled);
    for (const name of ['scroll', 'resize', 'hashchange', 'popstate', 'wheel', 'touchstart']) {
      expect(removedWindow.mock.calls.some(([type]) => type === name)).toBe(true);
    }
    for (const name of ['click', 'keydown']) expect(removedDocument.mock.calls.some(([type]) => type === name)).toBe(true);
  });
});
