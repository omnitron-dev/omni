/**
 * Tests for graph visualization
 */

import { describe, it, expect } from 'vitest';
import { visualizeFlow } from '../../src/viz/graph.js';
import { flow } from '@holon/flow';

describe('Graph Visualization', () => {
  it('should generate mermaid diagram', () => {
    const testFlow = flow((x: number) => x + 1);
    const diagram = visualizeFlow(testFlow, { format: 'mermaid' });

    expect(diagram).toContain('```mermaid');
    expect(diagram).toContain('graph LR');
    expect(diagram).toContain('input');
    expect(diagram).toContain('output');
  });

  it('should generate DOT format', () => {
    const testFlow = flow((x: number) => x + 1);
    const dot = visualizeFlow(testFlow, { format: 'dot' });

    expect(dot).toContain('digraph Flow');
    expect(dot).toContain('rankdir=LR');
    expect(dot).toContain('->');
  });

  it('should generate JSON format', () => {
    const testFlow = flow((x: number) => x + 1);
    const json = visualizeFlow(testFlow, { format: 'json' });

    const parsed = JSON.parse(json);
    expect(parsed.nodes).toBeDefined();
    expect(parsed.edges).toBeDefined();
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it('should generate D3 data structure', () => {
    const testFlow = flow((x: number) => x + 1);
    const d3Json = visualizeFlow(testFlow, { format: 'd3' });

    const parsed = JSON.parse(d3Json);
    expect(parsed.nodes).toBeDefined();
    expect(parsed.links).toBeDefined();
  });

  it('should include metadata', () => {
    const testFlow = flow((x: number) => x + 1);
    const json = visualizeFlow(testFlow, {
      format: 'json',
      includeMetadata: true,
    });

    const parsed = JSON.parse(json);
    expect(parsed.metadata).toBeDefined();
  });
});
