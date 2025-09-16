/**
 * Simple Bun test runner to test individual modules
 */

import { describe, test, expect } from 'bun:test';

// Test a simple module first
describe('@omnitron-dev/nexus Bun Runtime', () => {
  test('should detect Bun runtime', () => {
    expect(typeof Bun).toBe('object');
    expect(Bun.version).toBeDefined();
  });

  test('should have Bun-specific APIs', () => {
    expect(typeof Bun.file).toBe('function');
    expect(typeof Bun.write).toBe('function');
  });

  test('should import Container', async () => {
    const { Container } = await import('../../dist/index.js');
    expect(Container).toBeDefined();

    const container = new Container();
    expect(container).toBeDefined();
    await container.dispose();
  });

  test('should import and use token system', async () => {
    const { createToken, Container } = await import('../../dist/index.js');
    expect(createToken).toBeDefined();

    const token = createToken<string>('test');
    const container = new Container();
    container.register(token, { useValue: 'test-value' });

    const result = container.resolve(token);
    expect(result).toBe('test-value');

    await container.dispose();
  });
});