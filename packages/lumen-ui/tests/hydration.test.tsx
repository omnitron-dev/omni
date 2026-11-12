import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { vi, it, expect, describe, beforeEach } from 'vitest';
import { toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { parseIslandProps } from '@omnitron-dev/lumen-ast/islands';

import {
  useLumen,
  LumenShell,
  setupTrigger,
  PortalIslandHost,
  setupIdleTrigger,
  setupEventTrigger,
  PortalIslandManager,
  setupInteractionTrigger,
} from '../src/hydration/index.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Hydration Runtime & Triggers', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    return () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    };
  });

  it('triggers interaction on pointerenter event once', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    const callback = vi.fn();

    const cleanup = setupInteractionTrigger(el, callback);
    expect(callback).not.toHaveBeenCalled();

    el.dispatchEvent(new Event('pointerenter'));
    expect(callback).toHaveBeenCalledTimes(1);

    el.dispatchEvent(new Event('pointerenter'));
    expect(callback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('triggers custom event handler', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    const callback = vi.fn();

    const cleanup = setupEventTrigger(el, 'custom-action', callback);
    expect(callback).not.toHaveBeenCalled();

    el.dispatchEvent(new CustomEvent('custom-action'));
    expect(callback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('sets up idle trigger using requestIdleCallback or fallback', async () => {
    const callback = vi.fn();
    const cleanup = setupIdleTrigger(callback, { timeout: 50 });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(callback).toHaveBeenCalled();
    cleanup();
  });

  it('setupTrigger routes load, visible, interaction, idle and custom events correctly', () => {
    const el = document.createElement('div');
    container.appendChild(el);

    const onTrigger = vi.fn();
    const cleanup = setupTrigger(el, 'interaction', onTrigger);
    el.dispatchEvent(new Event('click'));
    expect(onTrigger).toHaveBeenCalledTimes(1);
    cleanup();

    const onCustom = vi.fn();
    const cleanupCustom = setupTrigger(el, 'onMyCustomEvent', onCustom);
    el.dispatchEvent(new CustomEvent('mycustomevent'));
    expect(onCustom).toHaveBeenCalledTimes(1);
    cleanupCustom();
  });

  it('renders PortalIslandHost with serialized props and custom styles', () => {
    const el = PortalIslandHost({
      islandId: 'test-widget',
      component: 'Counter',
      hydrate: 'interaction',
      props: { step: 5, initial: 10 },
      className: 'custom-island-class',
    });

    expect(el.props.className).toBe('custom-island-class');
    expect(el.props['data-lumen-island']).toBe('test-widget');
    expect(el.props['data-component']).toBe('Counter');
    expect(el.props['data-hydrate']).toBe('interaction');
    expect(JSON.parse(el.props['data-props'])).toEqual({ step: 5, initial: 10 });
  });

  it('uses the same strict metadata contract for React hosts and AST SSR widgets', () => {
    const shared = { value: 'same' };
    const props = { left: shared, right: shared, text: '"><script>invalid()</script>' };
    const host = PortalIslandHost({ islandId: 'roundtrip', props });
    const html = toHtmlSsr({ frontmatter: { title: 'Test' }, children: [{ type: 'jsxWidget', name: 'Widget', props }], toc: [], diagnostics: [] });
    const wrapper = document.createElement('div'); wrapper.innerHTML = html;
    expect(parseIslandProps(wrapper.querySelector('[data-props]')!.getAttribute('data-props')!)).toEqual(props);
    expect(parseIslandProps(host.props['data-props'])).toEqual(props);
    expect(wrapper.querySelector('script')).toBeNull();
    expect(() => PortalIslandHost({ islandId: 'invalid', props: { value: 1n } })).toThrow();
    expect(() => toHtmlSsr({ frontmatter: {}, children: [{ type: 'jsxWidget', name: 'Widget', props: { hydrate: 'wrong' } }], toc: [], diagnostics: [] })).toThrow('trigger');
  });

  it('updates active props on the same element and replaces a pending trigger immediately', async () => {
    function Label({ text }: { text: string }) { return <button>{text}</button>; }
    const island = document.createElement('div');
    island.setAttribute('data-lumen-island', 'changing'); island.setAttribute('data-component', 'Label');
    island.setAttribute('data-hydrate', 'interaction'); island.setAttribute('data-props', '{"text":"first"}');
    container.appendChild(island);
    const mount = document.createElement('div'); container.appendChild(mount);
    const root = createRoot(mount);
    await act(async () => { root.render(<PortalIslandManager registry={{ Label }} />); });
    await act(async () => {
      island.setAttribute('data-hydrate', 'onready');
      island.dispatchEvent(new Event('click'));
    });
    expect(island.querySelector('button')).toBeNull();
    await act(async () => { island.dispatchEvent(new Event('ready')); });
    expect(island.querySelector('button')?.textContent).toBe('first');
    await act(async () => {
      island.setAttribute('data-props', '{"text":"updated"}');
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(island.querySelector('button')?.textContent).toBe('updated');
    await act(async () => { root.unmount(); });
  });

  it('isolates malformed metadata, removes stale live content and recovers after correction', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Mounted = vi.fn(({ text }: { text: string }) => <button>{text}</button>);
    const bad = document.createElement('div');
    bad.setAttribute('data-lumen-island', 'bad'); bad.setAttribute('data-component', 'Mounted');
    bad.setAttribute('data-hydrate', 'interaction'); bad.setAttribute('data-props', '{bad');
    const good = document.createElement('div');
    good.setAttribute('data-lumen-island', 'good'); good.setAttribute('data-component', 'Mounted');
    good.setAttribute('data-hydrate', 'interaction'); good.setAttribute('data-props', '{"text":"healthy"}');
    container.append(bad, good);
    const mount = document.createElement('div'); container.appendChild(mount);
    const root = createRoot(mount);
    try {
      await act(async () => { root.render(<PortalIslandManager registry={{ Mounted }} />); });
      expect(bad.querySelector('[role="alert"]')).not.toBeNull();
      expect(Mounted).not.toHaveBeenCalled();
      await act(async () => { good.dispatchEvent(new Event('click')); });
      expect(good.querySelector('button')?.textContent).toBe('healthy');
      await act(async () => {
        bad.setAttribute('data-props', '{"text":"recovered"}');
        await new Promise(resolve => setTimeout(resolve, 10));
        bad.dispatchEvent(new Event('click'));
      });
      expect(bad.querySelector('button')?.textContent).toBe('recovered');
      expect(bad.hasAttribute('data-lumen-error')).toBe(false);
      await act(async () => {
        bad.setAttribute('data-props', 'null');
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      expect(bad.querySelector('button')).toBeNull();
      expect(bad.querySelector('[role="alert"]')).not.toBeNull();
      expect(good.querySelector('button')?.textContent).toBe('healthy');
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => { root.unmount(); });
      errors.mockRestore();
    }
  });

  it('allows calling LumenShell as a pure function without hook error', () => {
    const result = LumenShell({
      theme: 'dark',
      locale: 'fr',
      currentPath: '/fr/overview',
      children: 'French Documentation',
      disablePrismProvider: true,
    });

    expect(result).toBeDefined();
    expect(result.type).toBeDefined();
  });

  it('provides LumenContext to children', async () => {
    let observedTheme = '';
    let observedLocale = '';
    let observedPath = '';

    function Consumer() {
      const ctx = useLumen();
      observedTheme = ctx.theme;
      observedLocale = ctx.locale;
      observedPath = ctx.currentPath;
      return <div>Consumer</div>;
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(LumenShell, {
          theme: 'light',
          locale: 'ja',
          currentPath: '/ja/guide',
          children: React.createElement(Consumer),
          disablePrismProvider: true,
        })
      );
    });

    expect(observedTheme).toBe('light');
    expect(observedLocale).toBe('ja');
    expect(observedPath).toBe('/ja/guide');

    await act(async () => {
      root.unmount();
    });
  });

  it('activates individual island without thrashing or recreating triggers for sibling islands', async () => {
    const island1 = document.createElement('div');
    island1.className = 'lumen-portal-island';
    island1.setAttribute('data-lumen-island', 'island-alpha');
    island1.setAttribute('data-hydrate', 'interaction');
    island1.setAttribute('data-component', 'WidgetAlpha');
    document.body.appendChild(island1);

    const island2 = document.createElement('div');
    island2.className = 'lumen-portal-island';
    island2.setAttribute('data-lumen-island', 'island-beta');
    island2.setAttribute('data-hydrate', 'interaction');
    island2.setAttribute('data-component', 'WidgetBeta');
    document.body.appendChild(island2);

    const removeSpy1 = vi.spyOn(island1, 'removeEventListener');
    const addSpy2 = vi.spyOn(island2, 'addEventListener');
    const removeSpy2 = vi.spyOn(island2, 'removeEventListener');

    const managerMount = document.createElement('div');
    document.body.appendChild(managerMount);

    const root = createRoot(managerMount);
    await act(async () => {
      root.render(React.createElement(PortalIslandManager, { registry: {} }));
    });

    const initialAddCount2 = addSpy2.mock.calls.length;
    const initialRemoveCount2 = removeSpy2.mock.calls.length;

    await act(async () => {
      island1.dispatchEvent(new Event('click'));
    });

    expect(removeSpy1).toHaveBeenCalled();
    expect(removeSpy2).toHaveBeenCalledTimes(initialRemoveCount2);
    expect(addSpy2).toHaveBeenCalledTimes(initialAddCount2);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(island1);
    document.body.removeChild(island2);
    document.body.removeChild(managerMount);
  });

  it('UI-01 & UI-02: discovers [data-widget] islands and replaces static SSR children with single live control on activation', async () => {
    function Counter({ initial = 0 }: { initial?: number }) {
      const [count, setCount] = useState(initial);
      return (
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          Count {count}
        </button>
      );
    }

    const ssrWidget = document.createElement('div');
    ssrWidget.setAttribute('data-widget', 'Counter');
    ssrWidget.setAttribute('data-hydrate', 'interaction');
    ssrWidget.setAttribute('data-props', JSON.stringify({ initial: 0 }));
    ssrWidget.innerHTML = '<button type="button">Count 0</button>';
    container.appendChild(ssrWidget);

    const managerMount = document.createElement('div');
    container.appendChild(managerMount);
    const root = createRoot(managerMount);

    await act(async () => {
      root.render(React.createElement(PortalIslandManager, { registry: { Counter } }));
    });

    expect(ssrWidget.getAttribute('data-lumen-island')).toBeTruthy();
    expect(ssrWidget.querySelectorAll('button')).toHaveLength(1);

    await act(async () => {
      ssrWidget.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const buttonsAfterHydration = ssrWidget.querySelectorAll('button');
    expect(buttonsAfterHydration).toHaveLength(1);

    await act(async () => {
      buttonsAfterHydration[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(ssrWidget.querySelectorAll('button')).toHaveLength(1);
    expect(ssrWidget.querySelector('button')?.textContent).toBe('Count 1');

    await act(async () => {
      root.unmount();
    });
  });

  it('UI-03 & UI-04: keys island lifecycle by DOM element identity so replaced nodes with identical islandId await their own trigger', async () => {
    function Badge() {
      return <span className="hydrated-badge">Live</span>;
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="lumen-portal-island" data-lumen-island="shared-counter" data-component="Badge" data-hydrate="interaction"><span class="ssr-only">Static</span></div>';
    container.appendChild(wrapper);

    const firstEl = wrapper.querySelector('[data-lumen-island="shared-counter"]') as HTMLElement;
    const managerMount = document.createElement('div');
    container.appendChild(managerMount);
    const root = createRoot(managerMount);

    await act(async () => {
      root.render(React.createElement(PortalIslandManager, { registry: { Badge } }));
    });

    await act(async () => {
      firstEl.dispatchEvent(new Event('click'));
    });

    expect(firstEl.querySelector('.hydrated-badge')?.textContent).toBe('Live');

    await act(async () => {
      firstEl.outerHTML =
        '<div class="lumen-portal-island" data-lumen-island="shared-counter" data-component="Badge" data-hydrate="interaction"><span class="ssr-only">Replacement Static</span></div>';
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const replacementEl = wrapper.querySelector('[data-lumen-island="shared-counter"]') as HTMLElement;
    expect(replacementEl).not.toBe(firstEl);
    // Replacement node must NOT auto-hydrate just because the old detached element had the same islandId
    expect(replacementEl.querySelector('.hydrated-badge')).toBeNull();
    expect(replacementEl.querySelector('.ssr-only')?.textContent).toBe('Replacement Static');

    await act(async () => {
      replacementEl.dispatchEvent(new Event('click'));
    });

    expect(replacementEl.querySelector('.hydrated-badge')?.textContent).toBe('Live');
    expect(replacementEl.querySelector('.ssr-only')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('UI-05: supports imperative registerIsland, getIsland, activeIslands, and hydrateIsland via useLumen()', async () => {
    function DynamicChart() {
      return <div className="dynamic-chart-mounted">Chart Ready</div>;
    }

    let capturedCtx: ReturnType<typeof useLumen> | null = null;
    function ContextInspector() {
      capturedCtx = useLumen();
      return (
        <div>
          <div
            className="lumen-portal-island"
            data-lumen-island="imperative-chart"
            data-component="DynamicChart"
            data-hydrate="interaction"
          >
            <span>Placeholder</span>
          </div>
        </div>
      );
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(LumenShell, {
          theme: 'dark',
          locale: 'en',
          currentPath: '/docs/charts',
          disablePrismProvider: true,
          children: React.createElement(ContextInspector),
        })
      );
    });

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.activeIslands.has('imperative-chart')).toBe(false);

    await act(async () => {
      capturedCtx!.registerIsland('DynamicChart', DynamicChart);
    });

    expect(capturedCtx!.getIsland('DynamicChart')).toBe(DynamicChart);

    await act(async () => {
      capturedCtx!.hydrateIsland('imperative-chart');
    });

    expect(capturedCtx!.activeIslands.has('imperative-chart')).toBe(true);
    expect(container.querySelector('.dynamic-chart-mounted')?.textContent).toBe('Chart Ready');

    await act(async () => {
      root.unmount();
    });
  });
});
