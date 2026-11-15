import React, { lazy, Suspense } from 'react';
import { ClassNames } from '@emotion/react';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from '@omnitron-dev/lumen-ast';
import { renderDocumentHtml } from './render-html.js';
import { buildStaticSite } from './ssg-engine.js';
import { defineLumenConfig } from '../config/define.js';
import { CorpusGraph } from '../corpus/graph.js';

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

  it('cancels sibling renders and keeps the previous generation when one page fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-static-failure-'));
    writeFileSync(join(root, 'index.html'), 'PREVIOUS VERIFIED GENERATION');
    const graph = new CorpusGraph();
    for (const id of ['slow', 'broken']) {
      graph.addDocument({ id, path: `${id}.md`, title: id, hash: id,
        anchors: [], mathObjects: [], backlinks: [], ast: await parseDocument(`# ${id}`) });
    }
    const deferred = suspendedLayout();
    const Broken = lazy(async () => {
      await deferred.started;
      throw new Error('Invalid page');
    });
    const config = defineLumenConfig({ title: 'Atomic generation', theme: {
      layout: ({ document, children }) => document.id === 'slow' ? deferred.render(children)
        : React.createElement(Suspense, { fallback: 'Incomplete' }, React.createElement(Broken)),
    } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await expect(buildStaticSite(graph, config, {
        clientAssets: new Map(), writeToDisk: true, outDir: root,
      })).rejects.toMatchObject({ cause: new Error('Invalid page') });
      expect(vi.getTimerCount()).toBe(0);
      expect(readdirSync(root)).toEqual(['index.html']);
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('PREVIOUS VERIFIED GENERATION');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
