/**
 * Tests for Tree-Shaking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TreeShaker, treeShake, ComponentTreeShaker, RouteTreeShaker } from '../../src/build/tree-shaking.js';

describe('TreeShaker', () => {
  const sampleCode = `
import { useState } from 'react';
import { unusedUtil } from './utils';

export function UsedComponent() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}

export function UnusedComponent() {
  return <div>Unused</div>;
}

function internalHelper() {
  return 42;
}

const result = internalHelper();
console.log(result);
  `;

  it('should analyze code and identify dead code', () => {
    const shaker = new TreeShaker({ code: sampleCode });
    const result = shaker.analyze();

    expect(result.code).toBeTruthy();
    expect(result.removed).toBeDefined();
    expect(result.sideEffects).toBeInstanceOf(Array);
    expect(result.stats).toBeDefined();
  });

  it('should detect side effects', () => {
    const codeWithSideEffects = `
const value = 42;
console.log(value);
window.globalVar = value;
fetch('/api/data');
    `;

    const shaker = new TreeShaker({ code: codeWithSideEffects });
    const result = shaker.analyze();

    expect(result.sideEffects.length).toBeGreaterThan(0);
    expect(result.sideEffects.some((s) => s.type === 'console')).toBe(true);
    expect(result.sideEffects.some((s) => s.type === 'global')).toBe(true);
    expect(result.sideEffects.some((s) => s.type === 'network')).toBe(true);
  });

  it('should detect pure functions', () => {
    const codeWithPure = `
/* @__PURE__ */ function pureFunction() {
  return 42;
}

/* @__PURE__ */ const pureArrow = () => 43;
    `;

    const shaker = new TreeShaker({ code: codeWithPure });
    const result = shaker.analyze();

    expect(result.pureFunctions).toContain('pureFunction');
    expect(result.pureFunctions).toContain('pureArrow');
  });

  it('should remove unused imports', () => {
    const codeWithUnusedImports = `
import { used } from 'module1';
import { unused } from 'module2';

const value = used();
    `;

    const shaker = new TreeShaker({
      code: codeWithUnusedImports,
      removeUnusedImports: true,
    });
    const result = shaker.analyze();

    expect(result.removed.imports.length).toBeGreaterThan(0);
  });

  it('should remove unused exports', () => {
    const codeWithUnusedExports = `
export const used = 42;
export const unused = 43;

console.log(used);
    `;

    const shaker = new TreeShaker({
      code: codeWithUnusedExports,
      removeUnusedExports: true,
    });
    const result = shaker.analyze();

    expect(result.removed.exports.some((e) => e === 'unused')).toBe(true);
  });

  it('should calculate optimization statistics', () => {
    const shaker = new TreeShaker({ code: sampleCode });
    const result = shaker.analyze();

    expect(result.stats.originalSize).toBeGreaterThan(0);
    expect(result.stats.optimizedSize).toBeLessThanOrEqual(result.stats.originalSize);
    expect(result.stats.savingsPercent).toBeGreaterThanOrEqual(0);
  });

  it('should handle aggressive mode', () => {
    const shaker = new TreeShaker({
      code: sampleCode,
      aggressive: true,
    });
    const result = shaker.analyze();

    expect(result.stats.savings).toBeGreaterThanOrEqual(0);
  });
});

describe('treeShake', () => {
  it('should be a convenience wrapper', () => {
    const code = `
export const value = 42;
console.log(value);
    `;

    const result = treeShake({ code });

    expect(result.code).toBeTruthy();
    expect(result.stats).toBeDefined();
  });
});

describe('ComponentTreeShaker', () => {
  let shaker: ComponentTreeShaker;

  beforeEach(() => {
    shaker = new ComponentTreeShaker();
  });

  it('should track component definitions', () => {
    shaker.addComponent('Button', 'function Button() {}');
    shaker.addComponent('Input', 'function Input() {}');

    expect(shaker.getUnusedComponents()).toHaveLength(2);
  });

  it('should track component usage', () => {
    shaker.addComponent('Button', 'function Button() {}');
    shaker.addComponent('Input', 'function Input() {}');

    shaker.markUsed('Button');

    const unused = shaker.getUnusedComponents();

    expect(unused).toHaveLength(1);
    expect(unused).toContain('Input');
  });

  it('should remove unused components from code', () => {
    shaker.addComponent('Button', 'function Button() {}');
    shaker.addComponent('Input', 'function Input() {}');

    shaker.markUsed('Button');

    const code = `
export function Button() { return 'button'; }
export function Input() { return 'input'; }
    `;

    const result = shaker.removeUnused(code);

    expect(result).not.toContain('Input');
  });

  it('should analyze component dependencies', () => {
    shaker.addComponent('Page', 'function Page() { return <Button />; }');
    shaker.addComponent('Button', 'function Button() {}');
    shaker.addComponent('Input', 'function Input() {}');

    const deps = shaker.analyzeDependencies('');

    expect(deps.get('Page')?.has('Button')).toBe(true);
    expect(deps.get('Page')?.has('Input')).toBe(false);
  });
});

describe('RouteTreeShaker', () => {
  let shaker: RouteTreeShaker;

  beforeEach(() => {
    shaker = new RouteTreeShaker();
  });

  it('should track route components', () => {
    shaker.addRoute('/home', ['Header', 'HomeContent', 'Footer']);
    shaker.addRoute('/about', ['Header', 'AboutContent', 'Footer']);

    expect(shaker.getRouteComponents('/home').size).toBe(3);
    expect(shaker.getRouteComponents('/about').size).toBe(3);
  });

  it('should identify common components', () => {
    shaker.addRoute('/home', ['Header', 'HomeContent', 'Footer']);
    shaker.addRoute('/about', ['Header', 'AboutContent', 'Footer']);

    const common = shaker.getCommonComponents();

    expect(common.has('Header')).toBe(true);
    expect(common.has('Footer')).toBe(true);
    expect(common.has('HomeContent')).toBe(false);
  });

  it('should identify route-specific components', () => {
    shaker.addRoute('/home', ['Header', 'HomeContent', 'Footer']);
    shaker.addRoute('/about', ['Header', 'AboutContent', 'Footer']);

    const homeSpecific = shaker.getRouteSpecificComponents('/home');

    expect(homeSpecific.has('HomeContent')).toBe(true);
    expect(homeSpecific.has('Header')).toBe(false);
    expect(homeSpecific.has('Footer')).toBe(false);
  });

  it('should generate bundle splitting strategy', () => {
    shaker.addRoute('/home', ['Header', 'HomeContent', 'Footer']);
    shaker.addRoute('/about', ['Header', 'AboutContent', 'Footer']);

    const strategy = shaker.generateSplitStrategy();

    expect(strategy.common).toContain('Header');
    expect(strategy.common).toContain('Footer');
    expect(strategy.routes.get('/home')).toContain('HomeContent');
    expect(strategy.routes.get('/about')).toContain('AboutContent');
  });

  it('should handle empty routes', () => {
    const common = shaker.getCommonComponents();

    expect(common.size).toBe(0);
  });

  it('should handle single route', () => {
    shaker.addRoute('/home', ['Header', 'Content', 'Footer']);

    const common = shaker.getCommonComponents();

    expect(common.size).toBe(3);
  });
});
