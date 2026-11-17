import React, { createContext, lazy, memo, Suspense, useContext, useId } from 'react';
import { ClassNames } from '@emotion/react';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { renderDocumentHtml } from './render-html.js';
import { buildStaticSite } from './ssg-engine.js';
import { defineLumenConfig } from '../config/define.js';
import type { LumenUserConfig } from '../config/schema.js';
import { expandEnvVariables } from '../config/env.js';
import { CorpusGraph } from '../corpus/graph.js';
import { useLumen } from '@omnitron-dev/lumen-ui';

afterEach(() => vi.useRealTimers());

function suspendedLayout() {
  let finish!: (value: { default: React.ComponentType }) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const component = new Promise<{ default: React.ComponentType }>(resolve => { finish = resolve; });
  const Deferred = lazy(() => { began(); return component; });
  return {
    started,
    finish,
    render: (children: React.ReactNode) => React.createElement(Suspense,
      { fallback: React.createElement('p', null, 'TEMPORARY FALLBACK') },
      React.createElement(Deferred), children),
  };
}

describe('complete static React rendering', () => {
  it('publishes the server resource closure below the base path and rejects conflicting client bytes', async () => {
    const graph = new CorpusGraph();
    graph.addDocument({ id: 'guide', path: 'guide.md', title: 'Guide', hash: 'guide', anchors: [],
      mathObjects: [], backlinks: [], ast: await parseDocument('# Guide') });
    const config = defineLumenConfig({ title: 'Resources', baseUrl: '/manual/' });
    const css = '.probe{color:blue}';
    const serverAssets = new Map([['assets/shared.css', css]]);
    const result = await buildStaticSite(graph, config, {
      clientAssets: new Map([['assets/shared.css', Buffer.from(css)]]),
      serverAssets, serverStyles: ['assets/shared.css'], clientStyles: ['assets/shared.css'],
    });
    expect(result.pages.get('/guide')?.match(/href="\/manual\/assets\/shared.css"/g)).toHaveLength(1);
    expect(result.assets.get('assets/shared.css')).toBe(css);
    await expect(buildStaticSite(graph, config, {
      clientAssets: new Map([['assets/shared.css', 'DIFFERENT BYTES']]), serverAssets,
    })).rejects.toThrow('Conflicting server and client asset: assets/shared.css');
  });

  it('renders registered Markdown widgets inside the original layout and Lumen contexts', async () => {
    const Context = createContext('MISSING CONTEXT');
    function Counter({ initial }: { initial: number }) {
      const label = useContext(Context);
      const { currentPath } = useLumen();
      return React.createElement('output', { id: useId(), 'data-context': label, 'data-path': currentPath }, initial);
    }
    const ast = await parseDocument('<Counter initial={2} hydrate="visible" />\n\n<Counter initial={3} />');
    const html = await renderDocumentHtml(ast, {
      currentPath: '/guide', islands: { Counter },
      renderLayout: children => React.createElement(Context.Provider, { value: 'SITE CONTEXT' }, children),
    });
    expect(html.match(/data-context="SITE CONTEXT"/g)).toHaveLength(2);
    expect(html.match(/data-path="\/guide"/g)).toHaveLength(2);
    expect(html).toContain('>2</output>');
    expect(html).toContain('>3</output>');
    const ids = [...html.matchAll(/<output id="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(2);
    expect(html.match(/data-component="Counter"/g)).toHaveLength(2);
  });

  it('waits for lazy registered widgets rather than emitting an empty preview', async () => {
    const Counter = lazy(async () => ({ default: () => React.createElement('output', null, 'READY ON FIRST PAINT') }));
    const ast = await parseDocument('<Counter hydrate="visible" />');
    const html = await renderDocumentHtml(ast, { islands: { Counter } });
    expect(html).toContain('READY ON FIRST PAINT');
  });

  it('inlines large nested Suspense previews without a browser completion script or a second render', async () => {
    const renderPreview = vi.fn(() => React.createElement('pre', { 'data-large-preview': true }, 'Complete static preview. '.repeat(2000)));
    const loadPreview = vi.fn(async () => ({ default: renderPreview }));
    const Preview = lazy(loadPreview);
    const Inner = () => React.createElement('section', null,
      React.createElement(Suspense, { fallback: 'INCOMPLETE LARGE PREVIEW' }, React.createElement(Preview)));
    const Outer = lazy(async () => ({ default: Inner }));
    const Widget = () => React.createElement('div', null,
      React.createElement(Suspense, { fallback: 'INCOMPLETE OUTER PREVIEW' }, React.createElement(Outer)));
    const ast = await parseDocument('<Widget hydrate="visible" />');
    const html = await renderDocumentHtml(ast, { islands: { Widget } });
    expect(html).toContain('data-large-preview="true"');
    expect(html).not.toContain('INCOMPLETE LARGE PREVIEW');
    expect(html).not.toContain('INCOMPLETE OUTER PREVIEW');
    expect(html).not.toContain('<!--$?-->');
    expect(html).not.toContain('hidden id="S:');
    expect(html).not.toContain('<script');
    expect(loadPreview).toHaveBeenCalledTimes(1);
    expect(renderPreview).toHaveBeenCalledTimes(1);
  });

  it('projects access before invoking a registered server component', async () => {
    const Secret = vi.fn(() => React.createElement('p', null, 'PRIVATE WIDGET'));
    const ast = await parseDocument('# Public\n\n<Secret access="internal" />\n\n## Hidden {access=internal}\n\n<Secret />');
    const html = await renderDocumentHtml(ast, { islands: { Secret } });
    expect(Secret).not.toHaveBeenCalled();
    expect(html).not.toContain('PRIVATE WIDGET');
    expect(html).not.toContain('data-component="Secret"');
  });

  it('does not turn authored HTML attributes into a trusted server component', async () => {
    const Secret = vi.fn(() => React.createElement('p', null, 'EXECUTED'));
    const ast = await parseDocument('<div data-lumen-island="spoof" data-component="Secret" data-props="{}">Static fallback</div>');
    const html = await renderDocumentHtml(ast, { islands: { Secret } });
    expect(Secret).not.toHaveBeenCalled();
    expect(html).toContain('Static fallback');
    expect(html).not.toContain('EXECUTED');
  });

  it('validates trusted component registration while preserving React lazy and memo identity', () => {
    const View = () => null;
    const Memo = memo(View);
    const Lazy = lazy(async () => ({ default: View }));
    const config = defineLumenConfig(expandEnvVariables({ title: 'Registry', islands: { View, Memo, Lazy } }));
    expect(config.islands).toEqual({ View, Memo, Lazy });
    expect(config.islands?.['Memo']).toBe(Memo);
    expect(config.islands?.['Lazy']).toBe(Lazy);
    for (const invalid of ['script', 42, null, {}, { render: View }]) {
      expect(() => defineLumenConfig({ title: 'Registry', islands: { Invalid: invalid } } as unknown as LumenUserConfig))
        .toThrow('islands.Invalid');
    }
  });

  it('expands configuration values without changing prototypes or recursing through cycles', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true}}');
    const expanded = expandEnvVariables(input);
    expect(Object.getPrototypeOf(expanded)).toBe(Object.prototype);
    expect(Object.hasOwn(expanded, '__proto__')).toBe(true);
    expect(expanded.polluted).toBeUndefined();
    const cycle: { child?: unknown } = {};
    cycle.child = cycle;
    expect(() => expandEnvVariables(cycle)).toThrow('configuration contains a cycle');
  });
  it('waits for suspended content and extracts its CSS before publishing HTML', async () => {
    const ast = await parseDocument('# Permanent article');
    const deferred = suspendedLayout();
    let settled = false;
    const result = Promise.resolve(renderDocumentHtml(ast, { renderLayout: deferred.render }))
      .finally(() => { settled = true; });
    await deferred.started;
    await Promise.resolve();
    const finishedBeforeContent = settled;
    deferred.finish({ default: () => React.createElement(ClassNames, {
      children: ({ css }) => React.createElement('section', {
        className: css({ color: 'rgb(101,22,33)' }),
      }, 'COMPLETE PREVIEW'),
    }) });
    const html = await result;
    expect(finishedBeforeContent).toBe(false);
    expect(html).toContain('COMPLETE PREVIEW');
    expect(html).toContain('Permanent article');
    expect(html).not.toContain('TEMPORARY FALLBACK');
    expect(html).not.toContain('Switched to client rendering');
    expect(html.split('</head>')[0]).toContain('color:rgb(101,22,33)');
    expect(html.split('</head>')[1]).not.toContain('<style data-emotion=');
  });

  it('rejects a failed lazy component instead of publishing its client fallback', async () => {
    const ast = await parseDocument('# Guide');
    const failure = new Error('Preview module could not load');
    const Broken = lazy(() => Promise.reject(failure));
    await expect(renderDocumentHtml(ast, {
      renderLayout: () => React.createElement(Suspense,
        { fallback: React.createElement('p', null, 'THIS IS NOT A COMPLETE PAGE') },
        React.createElement(Broken)),
    })).rejects.toMatchObject({ cause: failure });
  });

  it('does not invoke a layout after the caller has cancelled', async () => {
    const ast = await parseDocument('# Guide');
    const reason = new Error('Build cancelled by caller');
    const renderLayout = vi.fn((children: React.ReactNode) => children);
    await expect(renderDocumentHtml(ast, {
      signal: AbortSignal.abort(reason), renderLayout,
    })).rejects.toBe(reason);
    expect(renderLayout).not.toHaveBeenCalled();
  });

  it('cancels suspended work without returning a partial page', async () => {
    const ast = await parseDocument('# Guide');
    const deferred = suspendedLayout();
    const controller = new AbortController();
    const reason = new Error('Build replaced by a newer generation');
    const result = renderDocumentHtml(ast, { signal: controller.signal, renderLayout: deferred.render });
    const rejected = expect(result).rejects.toBe(reason);
    await deferred.started;
    controller.abort(reason);
    await rejected;
  });

  it('bounds a component that never resolves and clears the deadline', async () => {
    const ast = await parseDocument('# Guide');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const deferred = suspendedLayout();
    const result = renderDocumentHtml(ast, { renderTimeoutMs: 100, renderLayout: deferred.render });
    const rejected = expect(result).rejects.toThrow('Static rendering exceeded 100 ms');
    await deferred.started;
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])('rejects an invalid render deadline %s before invoking the layout', async renderTimeoutMs => {
    const ast = await parseDocument('# Guide');
    const renderLayout = vi.fn((children: React.ReactNode) => children);
    await expect(renderDocumentHtml(ast, { renderTimeoutMs, renderLayout })).rejects.toThrow('renderTimeoutMs');
    expect(renderLayout).not.toHaveBeenCalled();
  });

  it('keeps concurrent document styles and cancellation independent', async () => {
    const ast = await parseDocument('# Guide');
    const first = suspendedLayout();
    const second = suspendedLayout();
    const controller = new AbortController();
    const failed = renderDocumentHtml(ast, { signal: controller.signal, renderLayout: first.render });
    const rejected = expect(failed).rejects.toThrow('First document cancelled');
    const completed = renderDocumentHtml(ast, { renderLayout: second.render });
    await Promise.all([first.started, second.started]);
    controller.abort(new Error('First document cancelled'));
    second.finish({ default: () => React.createElement('p', null, 'SECOND DOCUMENT') });
    await rejected;
    expect(await completed).toContain('SECOND DOCUMENT');
  });

  it('limits active pages and preserves corpus order when later pages finish first', async () => {
    const graph = new CorpusGraph();
    const layouts = new Map(['first', 'second', 'third'].map(id => [id, suspendedLayout()]));
    for (const id of layouts.keys()) {
      graph.addDocument({ id, path: `${id}.md`, title: id, hash: id,
        anchors: [], mathObjects: [], backlinks: [], ast: await parseDocument(`# ${id}`) });
    }
    const entered = new Set<string>();
    const config = defineLumenConfig({ title: 'Schedules', renderConcurrency: 2, theme: {
      layout: ({ document, children }) => {
        entered.add(document.id);
        return layouts.get(document.id)!.render(children);
      },
    } });
    const build = buildStaticSite(graph, config, { clientAssets: new Map() });
    await Promise.all([layouts.get('first')!.started, layouts.get('second')!.started]);
    expect([...entered]).toEqual(['first', 'second']);
    layouts.get('second')!.finish({ default: () => null });
    await layouts.get('third')!.started;
    layouts.get('third')!.finish({ default: () => null });
    layouts.get('first')!.finish({ default: () => null });
    const { pages, manifest } = await build;
    expect([...pages.keys()]).toEqual(['/first', '/second', '/third']);
    expect(Object.keys(manifest).filter(key => key.startsWith('routes/'))).toEqual([
      'routes/first.html', 'routes/second.html', 'routes/third.html',
    ]);
  });

  it.each([0, 1.5, Infinity])('rejects invalid render concurrency %s in site configuration', value => {
    expect(() => defineLumenConfig({ title: 'Limits', renderConcurrency: value })).toThrow('renderConcurrency');
  });

  it('cancels sibling renders, skips queued pages and keeps the previous generation when one page fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-static-failure-'));
    writeFileSync(join(root, 'index.html'), 'PREVIOUS VERIFIED GENERATION');
    const graph = new CorpusGraph();
    for (const id of ['slow', 'broken', 'queued']) {
      graph.addDocument({ id, path: `${id}.md`, title: id, hash: id,
        anchors: [], mathObjects: [], backlinks: [], ast: await parseDocument(`# ${id}`) });
    }
    const deferred = suspendedLayout();
    const Broken = lazy(async () => {
      await deferred.started;
      throw new Error('Invalid page');
    });
    const queued = vi.fn(() => null);
    const config = defineLumenConfig({ title: 'Atomic generation', renderConcurrency: 2, theme: {
      layout: ({ document, children }) => {
        if (document.id === 'queued') return queued();
        return document.id === 'slow' ? deferred.render(children)
          : React.createElement(Suspense, { fallback: 'Incomplete' }, React.createElement(Broken));
      },
    } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await expect(buildStaticSite(graph, config, {
        clientAssets: new Map(), writeToDisk: true, outDir: root,
      })).rejects.toMatchObject({ cause: new Error('Invalid page') });
      expect(queued).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(readdirSync(root)).toEqual(['index.html']);
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('PREVIOUS VERIFIED GENERATION');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
