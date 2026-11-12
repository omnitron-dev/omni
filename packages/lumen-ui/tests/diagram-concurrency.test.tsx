// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ResearchDiagram } from '../../prism/src/components/research/diagram.js';
import { renderDiagramSvg } from '../../lumen-ast/src/diagrams/renderer.js';

const engine = vi.hoisted(() => {
  let configuration: unknown;
  const renders: Array<{ configuration: unknown; release: () => void; reject: (error: Error) => void }> = [];
  return {
    renders,
    initialize: vi.fn((value: unknown) => { configuration = value; }),
    render: vi.fn(() => new Promise<{ svg: string }>((resolve, reject) => {
      renders.push({
        configuration,
        release: () => resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text>Evidence</text></svg>' }),
        reject,
      });
    })),
  };
});
vi.mock('mermaid', () => ({ default: engine }));

const labels = {
  metadata: 'Metadata', contents: 'Contents', source: 'Source', unavailable: 'Unavailable',
  invalid: 'Invalid', loading: 'Loading', diagnostics: 'Diagnostics',
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  engine.renders.length = 0;
  engine.initialize.mockClear();
  engine.render.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mountResearch() {
  await act(async () => root.render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
      <ResearchDiagram source="flowchart LR; A-->B" engine="mermaid" labels={labels} />
    </ThemeProvider>
  ));
}

describe('shared Mermaid configuration ownership', () => {
  it('prevents a Prism document from reconfiguring an unfinished Lumen render', async () => {
    const lumen = renderDiagramSvg('flowchart LR; A-->B', 'lumen-first', { theme: 'dark' });
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    await mountResearch();
    expect(engine.initialize).toHaveBeenCalledTimes(1);
    expect(engine.renders[0].configuration).toMatchObject({ theme: 'dark', htmlLabels: true });
    engine.renders[0].release();
    await lumen;
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(2));
    expect(engine.renders[1].configuration).toMatchObject({
      theme: 'base', securityLevel: 'strict', htmlLabels: true,
      dompurifyConfig: { ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false },
    });
    await act(async () => engine.renders[1].release());
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Evidence');
  });

  it('keeps the same boundary in reverse order and recovers after a render error', async () => {
    await mountResearch();
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    const lumen = renderDiagramSvg('flowchart LR; A-->B', 'lumen-second');
    await Promise.resolve();
    expect(engine.initialize).toHaveBeenCalledTimes(1);
    await act(async () => engine.renders[0].reject(new Error('invalid source')));
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(2));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Invalid');
    engine.renders[1].release();
    expect(await lumen).toContain('<svg');
  });

  it('does not initialize the engine for cancelled work waiting behind another consumer', async () => {
    await mountResearch();
    await vi.waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const cancelled = renderDiagramSvg('flowchart LR; A-->B', 'cancelled', { signal: controller.signal });
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await act(async () => engine.renders[0].release());
    await rejection;
    expect(engine.initialize).toHaveBeenCalledTimes(1);
  });
});
