import { expect } from 'vitest';

export interface LumenDiagnosticSpec {
  code: string;
  severity?: 'error' | 'warning' | 'info';
  message?: string | RegExp;
  filePath?: string | RegExp;
  line?: number;
  hasSuggestedFix?: boolean;
}

export interface ParityRouteReport {
  sourceRoute: string;
  targetRoute: string;
  status: 'matched' | 'missing' | 'unexpected' | 'redirect';
  sourceAnchors?: string[];
  targetAnchors?: string[];
  missingAnchors?: string[];
}

export interface ParityReport {
  totalRoutes: number;
  matchedRoutes: number;
  missingRoutes: string[];
  unexpectedRoutes: string[];
  parityPercentage: number;
  routes: ParityRouteReport[];
  brokenAnchors: Array<{ route: string; anchor: string }>;
}

export interface AstComparisonOptions {
  ignorePositions?: boolean;
  ignoreTimestamps?: boolean;
  ignoreWhitespace?: boolean;
}

/**
 * Normalizes an AST by removing transient position and timestamp properties.
 */
export function normalizeAstNode(node: unknown, options: AstComparisonOptions = {}): unknown {
  const ignorePos = options.ignorePositions ?? true;
  const ignoreTime = options.ignoreTimestamps ?? true;

  if (node === null || typeof node !== 'object') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => normalizeAstNode(item, options));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (ignorePos && ['loc', 'position', 'start', 'end', 'offset'].includes(key)) {
      continue;
    }
    if (ignoreTime && ['createdAt', 'updatedAt', 'timestamp', 'sha256', 'hash'].includes(key)) {
      continue;
    }
    result[key] = normalizeAstNode(value, options);
  }
  return result;
}

export function expectAstParity(actualAst: unknown, expectedAst: unknown, options?: AstComparisonOptions): void {
  const normalizedActual = normalizeAstNode(actualAst, options);
  const normalizedExpected = normalizeAstNode(expectedAst, options);
  expect(normalizedActual).toEqual(normalizedExpected);
}

export function expectDiagnostics(diagnostics: unknown[], expected: LumenDiagnosticSpec[]): void {
  expect(Array.isArray(diagnostics)).toBe(true);

  for (const spec of expected) {
    const match = diagnostics.find((d: any) => {
      if (!d || typeof d !== 'object') return false;
      if (d.code !== spec.code) return false;
      if (spec.severity && d.severity !== spec.severity) return false;
      if (spec.line !== undefined && d.line !== spec.line) return false;
      if (spec.hasSuggestedFix !== undefined) {
        const hasFix = Boolean(d.suggestedFix || d.fix);
        if (hasFix !== spec.hasSuggestedFix) return false;
      }
      if (spec.message) {
        const msg = String(d.message ?? '');
        if (typeof spec.message === 'string') {
          if (!msg.includes(spec.message)) return false;
        } else if (!spec.message.test(msg)) {
          return false;
        }
      }
      if (spec.filePath) {
        const path = String(d.filePath ?? d.file ?? '');
        if (typeof spec.filePath === 'string') {
          if (!path.includes(spec.filePath)) return false;
        } else if (!spec.filePath.test(path)) {
          return false;
        }
      }
      return true;
    });

    if (!match) {
      throw new Error(
        `Expected diagnostics to contain spec matching ${JSON.stringify(spec)}, but none matched. Received: ${JSON.stringify(diagnostics, null, 2)}`
      );
    }
  }
}

export function expectRouteParity(report: ParityReport, minParityPercentage: number = 100): void {
  expect(report).toBeDefined();
  expect(report.parityPercentage).toBeGreaterThanOrEqual(minParityPercentage);
  if (minParityPercentage >= 100) {
    expect(report.missingRoutes).toEqual([]);
    expect(report.brokenAnchors).toEqual([]);
  }
}

export function normalizeAnchor(anchor: string): string {
  let cleaned = anchor.replace(/^#/, '');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // If not URI encoded, retain raw string
  }
  return cleaned.toLowerCase();
}

export function expectAnchorParity(sourceAnchors: string[], targetAnchors: string[]): void {
  const normalizedSource = sourceAnchors.map(normalizeAnchor).sort();
  const normalizedTarget = targetAnchors.map(normalizeAnchor).sort();
  expect(normalizedTarget).toEqual(normalizedSource);
}

export function expectCriticalEmotionCss(html: string): void {
  expect(html).toMatch(/<style data-emotion=[^>]*>[\s\S]*?<\/style>/i);
}

export function expectPortalIsland(
  html: string,
  expectedProps: {
    component?: string;
    hydrate?: 'load' | 'visible' | 'interaction' | 'idle';
  }
): void {
  expect(html).toContain('data-lumen-island');
  if (expectedProps.hydrate) {
    expect(html).toContain(`data-hydrate="${expectedProps.hydrate}"`);
  }
  if (expectedProps.component) {
    expect(html).toMatch(new RegExp(`data-(lumen-)?component="${expectedProps.component}"`));
  }
}

export function expectValidLlmsTxt(content: string): void {
  expect(content).toBeDefined();
  expect(content.trim().length).toBeGreaterThan(0);
  expect(content).toMatch(/^#\s+/m);
}

// Extend Vitest's expect with custom matchers
expect.extend({
  toMatchAst(received: unknown, expected: unknown, options?: AstComparisonOptions) {
    const normalizedActual = normalizeAstNode(received, options);
    const normalizedExpected = normalizeAstNode(expected, options);
    const pass = this.equals(normalizedActual, normalizedExpected);
    return {
      pass,
      message: () =>
        pass
          ? 'Expected AST not to match expected AST structure'
          : `Expected AST to match expected AST.\nDiff:\n${this.utils.diff(normalizedExpected, normalizedActual)}`,
    };
  },

  toContainDiagnostic(received: unknown[], spec: LumenDiagnosticSpec) {
    if (!Array.isArray(received)) {
      return {
        pass: false,
        message: () => `Expected array of diagnostics, received ${typeof received}`,
      };
    }

    const match = received.find((d: any) => {
      if (!d || typeof d !== 'object') return false;
      if (d.code !== spec.code) return false;
      if (spec.severity && d.severity !== spec.severity) return false;
      if (spec.message) {
        const msg = String(d.message ?? '');
        if (typeof spec.message === 'string') {
          if (!msg.includes(spec.message)) return false;
        } else if (!spec.message.test(msg)) {
          return false;
        }
      }
      return true;
    });

    const pass = Boolean(match);
    return {
      pass,
      message: () =>
        pass
          ? `Expected diagnostics not to contain code [${spec.code}]`
          : `Expected diagnostics to contain spec ${JSON.stringify(spec)}, but none matched. Received:\n${JSON.stringify(received, null, 2)}`,
    };
  },

  toHaveRouteParity(received: ParityReport, expectedPercentage: number = 100) {
    const pass = Boolean(
      received &&
      received.parityPercentage >= expectedPercentage &&
      (expectedPercentage < 100 || received.missingRoutes.length === 0)
    );
    return {
      pass,
      message: () =>
        pass
          ? `Expected parity report to have less than ${expectedPercentage}% parity`
          : `Expected ${expectedPercentage}% route parity. Actual: ${received?.parityPercentage}%. Missing routes: ${received?.missingRoutes?.join(', ')}`,
    };
  },

  toEqualAnchors(received: string[], expected: string[]) {
    const normReceived = received.map(normalizeAnchor).sort();
    const normExpected = expected.map(normalizeAnchor).sort();
    const pass = this.equals(normReceived, normExpected);
    return {
      pass,
      message: () =>
        pass
          ? 'Expected anchors not to match'
          : `Anchor mismatch.\nExpected: ${JSON.stringify(normExpected)}\nReceived: ${JSON.stringify(normReceived)}`,
    };
  },
});

declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    toMatchAst(expectedAst: unknown, options?: AstComparisonOptions): R;
    toContainDiagnostic(spec: LumenDiagnosticSpec): R;
    toHaveRouteParity(expectedPercentage?: number): R;
    toEqualAnchors(expectedAnchors: string[]): R;
  }
  interface AsymmetricMatchersContaining {
    toMatchAst(expectedAst: unknown, options?: AstComparisonOptions): void;
    toContainDiagnostic(spec: LumenDiagnosticSpec): void;
    toHaveRouteParity(expectedPercentage?: number): void;
    toEqualAnchors(expectedAnchors: string[]): void;
  }
}
