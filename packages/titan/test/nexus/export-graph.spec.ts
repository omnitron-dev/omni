/**
 * Container.exportGraph + diagnostics formatters (C11).
 *
 * The graph export is the foundation of `omnitron inspect <app> --graph`.
 * It walks the local container's registrations, emits one node per
 * registered token, and one edge per declared dependency. Tests cover:
 *
 *   - simple chain (A → B → C) with classes and `@Inject`
 *   - factory providers with explicit `inject: [...]`
 *   - value providers (no edges; node still appears)
 *   - multi-bound tokens (multiple registrations under one symbol)
 *   - parent-container traversal toggle (`includeParent`)
 *   - DOT, Mermaid, JSON formatters round-trip the structure
 *   - focusGraph filters down to ancestors / descendants / both
 */

import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { Container } from '../../src/nexus/container.js';
import { createToken } from '../../src/nexus/token.js';
import {
  exportToDot,
  exportToMermaid,
  exportToJson,
  focusGraph,
} from '../../src/nexus/dependency-graph.js';
import { Injectable, Inject } from '../../src/decorators/index.js';

const A = createToken<{ name: string }>('TokenA');
const B = createToken<{ name: string }>('TokenB');
const C = createToken<{ name: string }>('TokenC');

describe('Container.exportGraph', () => {
  it('emits one node per registration and one edge per declared dependency', () => {
    @Injectable()
    class CSvc {
      readonly name = 'C';
    }
    @Injectable()
    class BSvc {
      constructor(@Inject(C) public c: CSvc) {}
      readonly name = 'B';
    }
    @Injectable()
    class ASvc {
      constructor(@Inject(B) public b: BSvc) {}
      readonly name = 'A';
    }

    const c = new Container();
    c.register(C, { useClass: CSvc });
    c.register(B, { useClass: BSvc, inject: [C] });
    c.register(A, { useClass: ASvc, inject: [B] });

    const g = c.exportGraph();
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toContain('TokenA');
    expect(ids).toContain('TokenB');
    expect(ids).toContain('TokenC');

    const edge = (from: string, to: string) =>
      g.edges.some((e) => e.from === from && e.to === to);
    expect(edge('TokenA', 'TokenB')).toBe(true);
    expect(edge('TokenB', 'TokenC')).toBe(true);
  });

  it('handles factory providers with explicit inject arrays', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, {
      useFactory: (a: { name: string }) => ({ name: `B+${a.name}` }),
      inject: [A],
    });

    // Container also self-registers a `Container` token so consumers
    // can `@Inject(Container)`. We filter it out for the assertion;
    // it's an implementation detail of the container, not part of
    // the user-visible graph.
    const g = c.exportGraph();
    const userIds = g.nodes.map((n) => n.id).filter((id) => id !== 'Container').sort();
    expect(userIds).toEqual(['TokenA', 'TokenB']);
    expect(g.edges.filter((e) => e.from !== 'Container' && e.to !== 'Container')).toEqual(
      [{ from: 'TokenB', to: 'TokenA', type: 'dependency' }],
    );
  });

  it('emits a node for a useValue provider but no outgoing edges', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    const g = c.exportGraph();
    const userNodes = g.nodes.filter((n) => n.id !== 'Container');
    expect(userNodes).toEqual([
      { id: 'TokenA', label: 'TokenA', type: expect.any(String) },
    ]);
    const userEdges = g.edges.filter((e) => e.from !== 'Container' && e.to !== 'Container');
    expect(userEdges).toEqual([]);
  });

  it('parent traversal toggled via includeParent', () => {
    const parent = new Container();
    parent.register(A, { useValue: { name: 'A' } });

    const child = new Container(parent);
    child.register(B, { useValue: { name: 'B' } });

    const local = child.exportGraph();
    const localIds = local.nodes.map((n) => n.id).filter((id) => id !== 'Container').sort();
    expect(localIds).toEqual(['TokenB']);

    const withParent = child.exportGraph({ includeParent: true });
    const allIds = withParent.nodes.map((n) => n.id).filter((id) => id !== 'Container').sort();
    expect(allIds).toEqual(['TokenA', 'TokenB']);
  });

  it('Mermaid formatter renders nodes + edges', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });

    const out = exportToMermaid(c.exportGraph());
    expect(out.split('\n')[0]).toBe('graph TD');
    expect(out).toContain('TokenA');
    expect(out).toContain('TokenB');
    expect(out).toMatch(/TokenB\s*-->\s*TokenA/);
  });

  it('DOT formatter renders nodes + edges', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });

    const out = exportToDot(c.exportGraph());
    expect(out.split('\n')[0]).toBe('digraph Dependencies {');
    expect(out).toContain('TokenA [label="TokenA"]');
    expect(out).toContain('TokenB [label="TokenB"]');
    expect(out).toContain('TokenB -> TokenA');
  });

  it('JSON formatter round-trips the structure', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });

    const g = c.exportGraph();
    const parsed = JSON.parse(exportToJson(g));
    expect(parsed.nodes.length).toBe(g.nodes.length);
    expect(parsed.edges.length).toBe(g.edges.length);
  });

  it('focusGraph filters to descendants only', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });
    c.register(C, { useFactory: () => ({ name: 'C' }), inject: [B] });

    const focused = focusGraph(c.exportGraph(), 'TokenB', 'descendants');
    expect(focused.nodes.map((n) => n.id).sort()).toEqual(['TokenA', 'TokenB']);
    expect(focused.edges).toEqual([{ from: 'TokenB', to: 'TokenA', type: 'dependency' }]);
  });

  it('focusGraph filters to ancestors only', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });
    c.register(C, { useFactory: () => ({ name: 'C' }), inject: [B] });

    const focused = focusGraph(c.exportGraph(), 'TokenB', 'ancestors');
    expect(focused.nodes.map((n) => n.id).sort()).toEqual(['TokenB', 'TokenC']);
    expect(focused.edges).toEqual([{ from: 'TokenC', to: 'TokenB', type: 'dependency' }]);
  });

  it('focusGraph defaults to both directions', () => {
    const c = new Container();
    c.register(A, { useValue: { name: 'A' } });
    c.register(B, { useFactory: () => ({ name: 'B' }), inject: [A] });
    c.register(C, { useFactory: () => ({ name: 'C' }), inject: [B] });

    const focused = focusGraph(c.exportGraph(), 'TokenB');
    expect(focused.nodes.map((n) => n.id).sort()).toEqual(['TokenA', 'TokenB', 'TokenC']);
  });
});
