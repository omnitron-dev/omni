/** World-coordinate rectangles. Viewport pan/zoom never changes label placement. */
export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelAnchor {
  id: string;
  text: string;
  x: number;
  y: number;
}
export interface MeasuredLabel extends LabelAnchor {
  width: number;
  height: number;
}
export interface PlacedLabel extends MeasuredLabel {
  box: LabelRect;
}

/** Nearest free coordinate outside the union of open forbidden intervals.
 * Endpoints are admissible: touching the expanded boundary preserves the gap. */
function nearestFree(origin: number, intervals: [number, number][]): number {
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const union: [number, number][] = [];
  for (const interval of intervals) {
    const last = union[union.length - 1];
    if (last && interval[0] < last[1]) last[1] = Math.max(last[1], interval[1]);
    else union.push([...interval]);
  }
  const hit = union.find(([lo, hi]) => lo < origin && origin < hi);
  return hit ? (origin - hit[0] <= hit[1] - origin ? hit[0] : hit[1]) : origin;
}

/** Deterministic greedy placement, not a global minimum of displacement.
 * For each label, solve the horizontal and vertical interval complements and
 * choose the nearer free position. Each step avoids all nodes and prior labels,
 * so induction gives pairwise disjoint boxes with the requested gap. A finite
 * obstacle set always leaves space on the unbounded canvas. O(L(N+L) log(N+L)). */
export function placeEdgeLabels(labels: readonly MeasuredLabel[], nodes: readonly LabelRect[], gap = 8): PlacedLabel[] {
  if (!Number.isFinite(gap) || gap < 0) throw Error('invalid_label_gap');
  const occupied = [...nodes];
  for (const rect of [...nodes, ...labels]) {
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
      throw Error('invalid_label_geometry');
  }
  if (new Set(labels.map((l) => l.id)).size !== labels.length) throw Error('duplicate_label');
  // No locale-dependent sorting: the same graph has the same geometry in every host.
  const ordered = [...labels].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ordered.map((label) => {
    const x = label.x - label.width / 2,
      y = label.y - label.height / 2;
    const vertical: [number, number][] = [],
      horizontal: [number, number][] = [];
    for (const r of occupied) {
      if (x < r.x + r.width + gap && x + label.width > r.x - gap)
        vertical.push([r.y - gap - label.height, r.y + r.height + gap]);
      if (y < r.y + r.height + gap && y + label.height > r.y - gap)
        horizontal.push([r.x - gap - label.width, r.x + r.width + gap]);
    }
    const vx = nearestFree(x, horizontal),
      vy = nearestFree(y, vertical);
    const box =
      Math.abs(vy - y) <= Math.abs(vx - x)
        ? { x, y: vy, width: label.width, height: label.height }
        : { x: vx, y, width: label.width, height: label.height };
    occupied.push(box);
    return { ...label, box };
  });
}

export function enclosingRect(rects: readonly LabelRect[]): LabelRect | undefined {
  if (!rects.length) return undefined;
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const r of rects) {
    x = Math.min(x, r.x);
    y = Math.min(y, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}
