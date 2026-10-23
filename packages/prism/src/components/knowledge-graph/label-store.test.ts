import { expect, it, vi } from 'vitest';
import { EdgeLabelStore } from './label-store.js';
it('batches anchors, publishes moves/text edits and removes unmounted occurrences', async () => {
  const store = new EdgeLabelStore(),
    listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const a = { id: 'a', text: 'premise', x: 1, y: 2 },
    b = { ...a, id: 'b' };
  store.set(a);
  store.set(b);
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot()).toEqual([a, b]);
  const previous = store.getSnapshot();
  store.set({ ...a });
  await Promise.resolve();
  expect(store.getSnapshot()).toBe(previous);
  store.remove('a');
  store.set({ ...a, text: 'changed', x: 99 });
  store.remove('b');
  await Promise.resolve();
  expect(store.getSnapshot()).toEqual([{ ...a, text: 'changed', x: 99 }]);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  store.remove('a');
  await Promise.resolve();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toEqual([]);
});
it('does not share anchors between graph instances', async () => {
  const left = new EdgeLabelStore(),
    right = new EdgeLabelStore();
  left.set({ id: 'a', text: 'left', x: 0, y: 0 });
  await Promise.resolve();
  expect(right.getSnapshot()).toEqual([]);
});
