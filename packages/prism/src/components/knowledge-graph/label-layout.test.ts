import { describe, expect, it } from 'vitest';
import { placeEdgeLabels, enclosingRect, type LabelRect, type MeasuredLabel } from './label-layout.js';

// Independent geometric oracle: separation on at least one axis, not a copy of
// the interval-union implementation. World-space guarantees imply separation
// under every positive uniform viewport scale and translation.
function separated(a: LabelRect, b: LabelRect, gap: number) {
  return (
    a.x + a.width + gap <= b.x + 1e-8 ||
    b.x + b.width + gap <= a.x + 1e-8 ||
    a.y + a.height + gap <= b.y + 1e-8 ||
    b.y + b.height + gap <= a.y + 1e-8
  );
}
function audit(labels: readonly MeasuredLabel[], nodes: readonly LabelRect[], gap: number) {
  const placed = placeEdgeLabels(labels, nodes, gap);
  expect(placed.map((l) => l.id).sort()).toEqual(labels.map((l) => l.id).sort());
  for (let i = 0; i < placed.length; i++) {
    expect(placed[i].text).toBe(labels.find((l) => l.id === placed[i].id)!.text);
    for (const obstacle of [...nodes, ...placed.slice(0, i).map((l) => l.box)])
      expect(separated(placed[i].box, obstacle, gap), JSON.stringify({ label: placed[i], obstacle })).toBe(true);
  }
  return placed;
}
describe('measured edge-label geometry', () => {
  it('keeps all repeated occurrences at a shared anchor and avoids a node covering that anchor', () => {
    const labels = Array.from({ length: 32 }, (_, i) => ({
      id: `role${i}`,
      text: `Repeated role ${i}`,
      x: 50,
      y: 50,
      width: 240,
      height: 24 + (i % 3) * 16,
    }));
    audit(labels, [{ x: 0, y: 0, width: 220, height: 180 }], 8);
  });
  it('leaves a noncolliding label exactly on its path midpoint', () => {
    expect(placeEdgeLabels([{ id: 'a', text: 'A', x: -10, y: 12, width: 40, height: 20 }], [])[0].box).toEqual({
      x: -30,
      y: 2,
      width: 40,
      height: 20,
    });
  });
  it('checks generated sparse and dense graphs, long multiline labels, resizing and node movement', () => {
    let seed = 0x9e3779b9;
    const random = (max: number) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % max;
    };
    for (let run = 0; run < 160; run++) {
      const nodes = Array.from({ length: random(18) }, () => ({
        x: random(600) - 300,
        y: random(600) - 300,
        width: 30 + random(200),
        height: 25 + random(250),
      }));
      const labels = Array.from({ length: 1 + random(65) }, (_, i) => ({
        id: String(i),
        text: 'Обоснование / assumption',
        x: random(500) - 250,
        y: random(500) - 250,
        width: 8 + random(300),
        height: 12 + random(180),
      }));
      const gap = random(17);
      const original = structuredClone({ labels, nodes });
      const placed = audit(labels, nodes, gap);
      expect(placeEdgeLabels([...labels].reverse(), [...nodes].reverse(), gap)).toEqual(placed);
      expect({ labels, nodes }).toEqual(original);
      const shifted = placeEdgeLabels(
        labels.map((l) => ({ ...l, x: l.x + 41, y: l.y - 71 })),
        nodes.map((n) => ({ ...n, x: n.x + 41, y: n.y - 71 })),
        gap
      );
      expect(shifted.map((l) => ({ ...l.box, x: l.box.x - 41, y: l.box.y + 71 }))).toEqual(placed.map((l) => l.box));
      audit(
        labels.map((l) => ({ ...l, width: l.width * 2, height: l.height * 1.5 })),
        nodes.map((n) => ({ ...n, x: n.x + 93, height: n.height * 2 })),
        gap
      );
      for (const scale of [0.1, 0.67, 2]) {
        const boxes = placed.map((l) => ({
          x: l.box.x * scale + 100,
          y: l.box.y * scale - 100,
          width: l.box.width * scale,
          height: l.box.height * scale,
        }));
        for (let i = 0; i < boxes.length; i++)
          for (let j = 0; j < i; j++) expect(separated(boxes[i], boxes[j], gap * scale)).toBe(true);
      }
    }
  });
  it('fits labels outside node bounds and handles empty graphs', () => {
    expect(enclosingRect([])).toBeUndefined();
    expect(
      enclosingRect([
        { x: 0, y: 0, width: 20, height: 20 },
        { x: -50, y: -10, width: 10, height: 90 },
      ])
    ).toEqual({ x: -50, y: -10, width: 70, height: 90 });
  });
  it('rejects nonfinite geometry and duplicate identities', () => {
    const label = { id: 'a', text: 'A', x: 0, y: 0, width: 10, height: 10 };
    expect(() => placeEdgeLabels([label], [], -1)).toThrow('invalid_label_gap');
    expect(() => placeEdgeLabels([{ ...label, x: NaN }], [])).toThrow('invalid_label_geometry');
    expect(() => placeEdgeLabels([label], [{ x: 0, y: 0, width: Infinity, height: 20 }])).toThrow(
      'invalid_label_geometry'
    );
    expect(() => placeEdgeLabels([label, label], [])).toThrow('duplicate_label');
  });
  it('retains 1000 separate roles at the bounded graph scale', () => {
    audit(
      Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        text: String(i),
        x: (i % 17) * 90,
        y: (i % 13) * 70,
        width: 120,
        height: 22,
      })),
      [],
      8
    );
  });
});
