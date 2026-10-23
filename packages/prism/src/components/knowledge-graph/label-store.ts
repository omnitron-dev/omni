import type { LabelAnchor } from './label-layout.js';

/** Edge components report path anchors; one microtask publishes the whole frame.
 * Registration is per mounted graph, never global, and removes culled edges. */
export class EdgeLabelStore {
  private anchors = new Map<string, LabelAnchor>();
  private snapshot: readonly LabelAnchor[] = [];
  private listeners = new Set<() => void>();
  private pending = false;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(anchor: LabelAnchor) {
    const prior = this.anchors.get(anchor.id);
    if (prior?.x === anchor.x && prior.y === anchor.y && prior.text === anchor.text) return;
    this.anchors.set(anchor.id, anchor);
    this.publish();
  }
  remove(id: string) {
    if (this.anchors.delete(id)) this.publish();
  }
  private publish() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.snapshot = [...this.anchors.values()];
      this.listeners.forEach((listener) => listener());
    });
  }
}
