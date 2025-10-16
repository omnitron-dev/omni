import { describe, it, expect } from 'vitest';
import { VariablesLayer } from '../../../src/variables/variables-layer.js';
import { detectCircularDependencies } from '../../../src/variables/interpolation.js';

describe('VariablesLayer', () => {
  it('should define and get variables', () => {
    const layer = new VariablesLayer();

    layer.define('app_name', 'MyApp');
    layer.define('app_version', '1.0.0');

    expect(layer.get('app_name')).toBe('MyApp');
    expect(layer.get('app_version')).toBe('1.0.0');
  });

  it('should check if variable exists', () => {
    const layer = new VariablesLayer();

    layer.define('existing', 'value');

    expect(layer.has('existing')).toBe(true);
    expect(layer.has('nonexistent')).toBe(false);
  });

  it('should delete variables', () => {
    const layer = new VariablesLayer();

    layer.define('temp', 'value');
    expect(layer.has('temp')).toBe(true);

    layer.delete('temp');
    expect(layer.has('temp')).toBe(false);
  });

  it('should define computed variables', () => {
    const layer = new VariablesLayer();

    layer.define('price', 100);
    layer.define('quantity', 5);
    layer.defineComputed('total', () => {
      return layer.get('price') * layer.get('quantity');
    });

    expect(layer.get('total')).toBe(500);
  });

  it('should interpolate variables synchronously', () => {
    const layer = new VariablesLayer();

    layer.define('name', 'John');
    layer.define('age', 30);

    const result = layer.interpolate('Hello ${name}, you are ${age} years old');
    expect(result).toBe('Hello John, you are 30 years old');
  });

  it('should interpolate environment variables', () => {
    const layer = new VariablesLayer();
    process.env.TEST_VAR = 'test-value';

    const result = layer.interpolate('Value: ${env.TEST_VAR}');
    expect(result).toBe('Value: test-value');

    delete process.env.TEST_VAR;
  });

  it('should list all variables', () => {
    const layer = new VariablesLayer();

    layer.define('var1', 'value1');
    layer.define('var2', 'value2');
    layer.defineComputed('var3', () => 'value3');

    const list = layer.list();

    expect(list).toContain('var1');
    expect(list).toContain('var2');
    expect(list).toContain('var3');
  });

  it('should export and import variables', () => {
    const layer = new VariablesLayer();

    layer.define('key1', 'value1');
    layer.define('key2', 'value2');

    const exported = layer.export();

    expect(exported).toEqual({
      key1: 'value1',
      key2: 'value2',
    });

    const layer2 = new VariablesLayer();
    layer2.import(exported);

    expect(layer2.get('key1')).toBe('value1');
    expect(layer2.get('key2')).toBe('value2');
  });

  describe('circular dependency detection', () => {
    it('should detect circular dependencies', () => {
      const variables = {
        a: '${b}',
        b: '${c}',
        c: '${a}',
      };

      const result = detectCircularDependencies(variables);

      expect(result.circular).toBe(true);
      expect(result.cycles.length).toBeGreaterThan(0);
    });

    it('should not detect circular dependencies in valid graph', () => {
      const variables = {
        a: 'value',
        b: '${a}',
        c: '${b}',
      };

      const result = detectCircularDependencies(variables);

      expect(result.circular).toBe(false);
    });
  });
});
