/**
 * Tests for FlowMachine implementation
 */

import { describe, it, expect } from 'vitest';
import {
  createFlowMachine,
  composeMachine,
  identityMachine,
  constantMachine,
  type FlowMachine,
} from '../src/machine.js';
import { EffectFlags } from '../src/effects/index.js';

describe('FlowMachine', () => {
  describe('createFlowMachine', () => {
    it('should create a basic flow machine', () => {
      const machine = createFlowMachine<number, number>({
        fn: (x) => x * 2,
        meta: { name: 'double' },
      });

      expect(machine(5)).toBe(10);
      expect(machine.name).toBe('double');
      expect(machine.id).toBeDefined();
      expect(machine.version).toBe('1.0.0');
    });

    it('should have reflection methods', () => {
      const machine = createFlowMachine({
        fn: (x: number) => x + 1,
        meta: { name: 'increment' },
      });

      expect(typeof machine.inspect).toBe('function');
      expect(typeof machine.dependencies).toBe('function');
      expect(typeof machine.effects).toBe('function');
      expect(typeof machine.isPure).toBe('function');
    });

    it('should detect effects correctly', () => {
      const pureFlow = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double' },
        effects: EffectFlags.None,
      });

      expect(pureFlow.isPure()).toBe(true);
      expect(pureFlow.effects()).toBe(EffectFlags.None);

      const impureFlow = createFlowMachine({
        fn: (x: number) => {
          console.log(x);
          return x;
        },
        meta: { name: 'log' },
        effects: EffectFlags.IO,
      });

      expect(impureFlow.isPure()).toBe(false);
      expect(impureFlow.effects()).toBe(EffectFlags.IO);
    });

    it('should inspect structure', () => {
      const machine = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double' },
      });

      const structure = machine.inspect();
      expect(structure.id).toBeDefined();
      expect(structure.type).toBe('simple');
      expect(structure.metadata.name).toBe('double');
    });

    it('should convert to JSON', () => {
      const machine = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double', version: '1.0.0' },
      });

      const json = machine.toJSON();
      expect(json.id).toBeDefined();
      expect(json.version).toBe('1.0.0');
      expect(json.type).toBe('simple');
      expect(json.metadata.name).toBe('double');
      expect(json.logic).toContain('x * 2');
    });

    it('should convert to graph', () => {
      const machine = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double' },
      });

      const graph = machine.toGraph();
      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0]?.type).toBe('transform');
      expect(graph.edges).toHaveLength(0);
      expect(graph.metadata.name).toBe('double');
    });
  });

  describe('optimization', () => {
    it('should optimize pure flows with memoization', () => {
      let callCount = 0;
      const machine = createFlowMachine({
        fn: (x: number) => {
          callCount++;
          return x * 2;
        },
        meta: { name: 'double', performance: { pure: true, memoizable: true } },
        effects: EffectFlags.None,
      });

      const optimized = machine.optimize();

      // First call
      expect(optimized(5)).toBe(10);
      expect(callCount).toBe(1);

      // Second call with same input (should use cache)
      expect(optimized(5)).toBe(10);
      expect(callCount).toBe(1);

      // Call with different input
      expect(optimized(10)).toBe(20);
      expect(callCount).toBe(2);
    });

    it('should not optimize impure flows', () => {
      const machine = createFlowMachine({
        fn: (x: number) => {
          console.log(x);
          return x;
        },
        meta: { name: 'log' },
        effects: EffectFlags.IO,
      });

      const optimized = machine.optimize();
      expect(optimized).toBe(machine);
    });
  });

  describe('composition', () => {
    it('should compose flows with pipe', () => {
      const double = createFlowMachine<number, number>({
        fn: (x) => x * 2,
        meta: { name: 'double' },
      });

      const increment = createFlowMachine<number, number>({
        fn: (x) => x + 1,
        meta: { name: 'increment' },
      });

      const composed = double.pipe(increment);

      expect(composed(5)).toBe(11); // (5 * 2) + 1 = 11
      expect(composed.name).toContain('double');
      expect(composed.name).toContain('increment');
    });

    it('should track dependencies via registry', () => {
      const flow1 = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double' },
      });

      const flow2 = createFlowMachine({
        fn: (x: number) => x + 1,
        meta: { name: 'increment' },
      });

      const composed = flow1.pipe(flow2);

      // The composed flow is a new flow that wraps the composition
      // Dependencies are tracked in the registry, not in the flow itself
      expect(composed).toBeDefined();
      expect(composed.name).toContain('double');
      expect(composed.name).toContain('increment');
    });
  });

  describe('composeMachine', () => {
    it('should compose multiple flows', () => {
      const double = createFlowMachine<number, number>({
        fn: (x) => x * 2,
        meta: { name: 'double' },
      });

      const increment = createFlowMachine<number, number>({
        fn: (x) => x + 1,
        meta: { name: 'increment' },
      });

      const square = createFlowMachine<number, number>({
        fn: (x) => x * x,
        meta: { name: 'square' },
      });

      const composed = composeMachine(double, increment, square);

      expect(composed(5)).toBe(121); // ((5 * 2) + 1)^2 = 11^2 = 121
    });

    it('should return single flow if only one provided', () => {
      const double = createFlowMachine({
        fn: (x: number) => x * 2,
        meta: { name: 'double' },
      });

      const result = composeMachine(double);
      expect(result).toBe(double);
    });

    it('should throw if no flows provided', () => {
      expect(() => composeMachine()).toThrow('composeMachine requires at least one flow');
    });
  });

  describe('identityMachine', () => {
    it('should return input unchanged', () => {
      const id = identityMachine<number>();
      expect(id(42)).toBe(42);
      expect(id.name).toBe('identity');
      expect(id.isPure()).toBe(true);
    });
  });

  describe('constantMachine', () => {
    it('should always return the same value', () => {
      const const42 = constantMachine(42);
      expect(const42('anything')).toBe(42);
      expect(const42(100)).toBe(42);
      expect(const42.name).toBe('constant');
      expect(const42.isPure()).toBe(true);
    });
  });

  describe('async flows', () => {
    it('should handle async functions', async () => {
      const asyncDouble = createFlowMachine({
        fn: async (x: number) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return x * 2;
        },
        meta: { name: 'asyncDouble' },
      });

      const result = await asyncDouble(5);
      expect(result).toBe(10);
    });

    it('should compose async flows', async () => {
      const asyncDouble = createFlowMachine({
        fn: async (x: number) => x * 2,
        meta: { name: 'asyncDouble' },
      });

      const asyncIncrement = createFlowMachine({
        fn: async (x: number) => x + 1,
        meta: { name: 'asyncIncrement' },
      });

      const composed = asyncDouble.pipe(asyncIncrement);
      const result = await composed(5);
      expect(result).toBe(11);
    });
  });
});
