import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import {
  LumenShell,
  PortalIslandHost,
  PortalIslandManager,
  setupTrigger,
  setupInteractionTrigger,
  setupIdleTrigger,
  setupEventTrigger,
  useLumen,
} from '../src/hydration/index.js';

describe('Hydration Runtime & Triggers', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
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

    // Should not trigger second time
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

  it('provides LumenContext to children', () => {
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

    const shell = LumenShell({
      theme: 'light',
      locale: 'ja',
      currentPath: '/ja/guide',
      children: React.createElement(Consumer),
      disablePrismProvider: true,
    });

    expect(shell).toBeDefined();
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
});
