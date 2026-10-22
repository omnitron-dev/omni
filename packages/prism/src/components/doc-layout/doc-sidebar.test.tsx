import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DocSidebar } from './doc-sidebar.js';
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});
it('preserves native links, active identity and modified navigation', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onItemClick = vi.fn();
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () =>
    root.render(
      <DocSidebar
        items={[{ id: 'doc', label: 'Document', href: '/corpus?revision=frozen' }]}
        activeId="doc"
        onItemClick={onItemClick}
      />
    )
  );
  const link = host.querySelector('a')!;
  expect(link.getAttribute('href')).toBe('/corpus?revision=frozen');
  expect(link.getAttribute('aria-current')).toBe('page');
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  await act(async () => {
    link.dispatchEvent(modified);
  });
  expect(modified.defaultPrevented).toBe(false);
  expect(onItemClick).not.toHaveBeenCalled();
  const normal = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    link.dispatchEvent(normal);
  });
  expect(normal.defaultPrevented).toBe(true);
  expect(onItemClick).toHaveBeenCalledTimes(1);
});
it('announces a category toggle and removes collapsed children from keyboard navigation', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  await act(async () =>
    root.render(
      <DocSidebar
        items={[{ id: 'group', label: 'Chapter', children: [{ id: 'child', label: 'Child', href: '/child' }] }]}
      />
    )
  );
  const button = host.querySelector('button')!;
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(button.getAttribute('aria-controls')).toBeTruthy();
  await act(async () => button.click());
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await vi.waitFor(() => expect(host.querySelector('a')).toBeNull());
});

it('compact navigation keeps destinations and active identity while retaining expanded tree state', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    onItemClick = vi.fn();
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const items = [
    {
      id: 'group',
      label: 'Analysis',
      children: [
        { id: 'limit', label: 'Limits', shortLabel: 'Li', href: '/limits' },
        { id: 'series', label: 'Series', href: '/series' },
      ],
    },
  ];
  const draw = (compact: boolean) => (
    <DocSidebar items={items} activeId="limit" compact={compact} onItemClick={onItemClick} />
  );
  await act(async () => root.render(draw(false)));
  await act(async () => host.querySelector('button')!.click());
  await vi.waitFor(() => expect(host.querySelector('a')).toBeNull());
  await act(async () => root.render(draw(true)));
  const compactLink = host.querySelector<HTMLAnchorElement>('a[aria-label="Limits"]')!;
  expect(compactLink.getAttribute('href')).toBe('/limits');
  expect(compactLink.getAttribute('aria-current')).toBe('page');
  await act(async () => compactLink.click());
  expect(onItemClick).toHaveBeenLastCalledWith(items[0]!.children[0]);
  await act(async () => root.render(draw(false)));
  expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
});
