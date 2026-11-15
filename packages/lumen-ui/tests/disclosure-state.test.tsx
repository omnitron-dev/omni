import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { PortalIslandManager } from '../src/hydration/shell.js';

const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

function disclosure(key: string | null, open = false) {
  return `<details${key === null ? '' : ` data-lumen-disclosure="${key}"`}${open ? ' open' : ''}><summary>Source</summary><pre>Complete source</pre></details>`;
}

async function fixture(server: string, client: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = `<button id="outside">Outside</button><div data-lumen-island="preview" data-component="Preview" data-hydrate="onactivate">${server}</div><div id="runtime"></div>`;
  const root = createRoot(container.querySelector('#runtime')!);
  mounted.push({ root, container });
  const host = container.querySelector<HTMLElement>('[data-lumen-island="preview"]')!;
  await act(async () => root.render(<PortalIslandManager registry={{
    Preview: () => <div dangerouslySetInnerHTML={{ __html: client }} />,
    Nested: () => <span>Nested</span>,
  }} />));
  return {
    container, host,
    activate: () => act(async () => { host.dispatchEvent(new Event('activate')); }),
  };
}

it('preserves independently keyed native disclosures and their focused summary at replacement', async () => {
  const { host, activate } = await fixture(disclosure('first') + disclosure('second', true), disclosure('second') + disclosure('first', true));
  const old = host.querySelector<HTMLDetailsElement>('[data-lumen-disclosure="first"]')!;
  old.open = true;
  host.querySelector<HTMLDetailsElement>('[data-lumen-disclosure="second"]')!.open = false;
  old.querySelector<HTMLElement>('summary')!.focus();
  await activate();
  expect(old.isConnected).toBe(false);
  expect(host.querySelector<HTMLDetailsElement>('[data-lumen-disclosure="first"]')!.open).toBe(true);
  expect(host.querySelector<HTMLDetailsElement>('[data-lumen-disclosure="second"]')!.open).toBe(false);
  expect(document.activeElement).toBe(host.querySelector('[data-lumen-disclosure="first"] > summary'));
});

it('does not move focus back when the reader leaves a pending island', async () => {
  const { container, host, activate } = await fixture(disclosure('source', true), disclosure('source'));
  host.querySelector<HTMLElement>('summary')!.focus();
  const outside = container.querySelector<HTMLButtonElement>('#outside')!;
  outside.focus();
  await activate();
  expect(document.activeElement).toBe(outside);
  expect(host.querySelector<HTMLDetailsElement>('details')!.open).toBe(true);
});

it('does not transfer a nested island disclosure through its parent scope', async () => {
  const nested = (open: boolean) => `<div data-lumen-island="nested" data-component="Nested" data-hydrate="onnever">${disclosure('source', open)}</div>`;
  const { host, activate } = await fixture(disclosure('source', true) + nested(true), disclosure('source') + nested(false));
  await activate();
  const disclosures = [...host.querySelectorAll('details')];
  expect(disclosures.map(item => item.open)).toEqual([true, false]);
});

it.each([
  [disclosure('duplicate', true) + disclosure('duplicate', true), disclosure('duplicate')],
  [disclosure('duplicate', true), disclosure('duplicate') + disclosure('duplicate')],
  [disclosure(null, true), disclosure(null)],
  [disclosure('', true), disclosure('')],
])('does not guess missing or ambiguous disclosure identities (%#)', async (server, client) => {
  const { host, activate } = await fixture(server, client);
  await activate();
  expect([...host.querySelectorAll('details')].some(item => item.open)).toBe(false);
});
