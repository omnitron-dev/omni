/**
 * Critical CSS Extraction
 * Extracts and inlines critical CSS for above-the-fold content
 */

export interface CriticalCSSOptions {
  /**
   * HTML content to analyze
   */
  html: string;

  /**
   * CSS content to extract from
   */
  css: string;

  /**
   * Viewport dimensions for above-the-fold detection
   * @default { width: 1300, height: 900 }
   */
  dimensions?: {
    width: number;
    height: number;
  };

  /**
   * Inline critical CSS in HTML
   * @default true
   */
  inline?: boolean;

  /**
   * Defer non-critical CSS loading
   * @default true
   */
  deferNonCritical?: boolean;

  /**
   * Minimum CSS coverage percentage to include a rule
   * @default 0
   */
  minCoverage?: number;

  /**
   * Include CSS for these selectors regardless of coverage
   */
  forceInclude?: string[];

  /**
   * Exclude CSS for these selectors
   */
  exclude?: string[];

  /**
   * Base path for CSS file references
   */
  basePath?: string;
}

export interface CriticalCSSResult {
  /**
   * Critical CSS content
   */
  critical: string;

  /**
   * Non-critical CSS content
   */
  nonCritical: string;

  /**
   * HTML with inlined critical CSS
   */
  html: string;

  /**
   * Coverage statistics
   */
  coverage: {
    total: number;
    used: number;
    unused: number;
    percentage: number;
  };

  /**
   * Per-selector analysis
   */
  selectors: Array<{
    selector: string;
    critical: boolean;
    reason: string;
  }>;
}

/**
 * Extract critical CSS from HTML and CSS
 */
export class CriticalCSSExtractor {
  private options: Required<CriticalCSSOptions>;

  constructor(options: CriticalCSSOptions) {
    this.options = {
      dimensions: { width: 1300, height: 900 },
      inline: true,
      deferNonCritical: true,
      minCoverage: 0,
      forceInclude: [],
      exclude: [],
      basePath: '/',
      ...options,
    };
  }

  /**
   * Extract critical CSS
   */
  async extract(): Promise<CriticalCSSResult> {
    const { html, css } = this.options;

    // Parse CSS into rules
    const rules = this.parseCSS(css);

    // Analyze which rules are critical
    const analysis = this.analyzeRules(rules, html);

    // Split into critical and non-critical
    const critical = analysis.critical.join('\n');
    const nonCritical = analysis.nonCritical.join('\n');

    // Generate modified HTML
    const modifiedHtml = this.generateHTML(critical, nonCritical);

    return {
      critical,
      nonCritical,
      html: modifiedHtml,
      coverage: analysis.coverage,
      selectors: analysis.selectors,
    };
  }

  /**
   * Parse CSS into rules
   */
  private parseCSS(css: string): CSSRule[] {
    const rules: CSSRule[] = [];
    const ruleRegex = /([^{]+)\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = ruleRegex.exec(css)) !== null) {
      const selector = match[1]?.trim();
      const content = match[2]?.trim();

      // Skip comments or undefined matches
      if (!selector || !content || selector.startsWith('/*')) continue;

      rules.push({
        selector,
        content,
        raw: match[0],
      });
    }

    return rules;
  }

  /**
   * Analyze which rules are critical
   */
  private analyzeRules(
    rules: CSSRule[],
    html: string,
  ): {
    critical: string[];
    nonCritical: string[];
    coverage: {
      total: number;
      used: number;
      unused: number;
      percentage: number;
    };
    selectors: Array<{
      selector: string;
      critical: boolean;
      reason: string;
    }>;
  } {
    const critical: string[] = [];
    const nonCritical: string[] = [];
    const selectorAnalysis: Array<{
      selector: string;
      critical: boolean;
      reason: string;
    }> = [];

    let usedCount = 0;

    for (const rule of rules) {
      const isCritical = this.isCriticalRule(rule, html);

      if (isCritical.critical) {
        critical.push(rule.raw);
        usedCount++;
      } else {
        nonCritical.push(rule.raw);
      }

      selectorAnalysis.push({
        selector: rule.selector,
        critical: isCritical.critical,
        reason: isCritical.reason,
      });
    }

    const total = rules.length;
    const unused = total - usedCount;
    const percentage = total > 0 ? (usedCount / total) * 100 : 0;

    return {
      critical,
      nonCritical,
      coverage: {
        total,
        used: usedCount,
        unused,
        percentage,
      },
      selectors: selectorAnalysis,
    };
  }

  /**
   * Determine if a rule is critical
   */
  private isCriticalRule(
    rule: CSSRule,
    html: string,
  ): { critical: boolean; reason: string } {
    const { selector } = rule;

    // Check force include patterns
    if (this.matchesPatterns(selector, this.options.forceInclude)) {
      return { critical: true, reason: 'force-included' };
    }

    // Check exclude patterns
    if (this.matchesPatterns(selector, this.options.exclude)) {
      return { critical: false, reason: 'excluded' };
    }

    // Check if selector exists in HTML
    if (!this.selectorExistsInHTML(selector, html)) {
      return { critical: false, reason: 'not-found-in-html' };
    }

    // Check for critical patterns (html, body, font-face, etc.)
    if (this.isCriticalPattern(selector)) {
      return { critical: true, reason: 'critical-pattern' };
    }

    // Check if selector is for above-the-fold content
    if (this.isAboveFoldSelector(selector)) {
      return { critical: true, reason: 'above-the-fold' };
    }

    // If selector exists in HTML and hasn't been excluded, it's critical
    // This ensures all used CSS is initially critical
    return { critical: true, reason: 'found-in-html' };
  }

  /**
   * Check if selector matches any pattern
   */
  private matchesPatterns(selector: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(selector);
      }
      return selector.includes(pattern);
    });
  }

  /**
   * Check if selector exists in HTML
   */
  private selectorExistsInHTML(selector: string, html: string): boolean {
    // Extract simple selectors (class, id, tag)
    const simpleSelectors = selector.match(/[.#]?[\w-]+/g) || [];

    return simpleSelectors.some((s) => {
      if (s.startsWith('.')) {
        const className = s.slice(1);
        return html.includes(`class="${className}"`) || html.includes(`class='${className}'`);
      } else if (s.startsWith('#')) {
        const id = s.slice(1);
        return html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
      } else {
        return html.includes(`<${s}`);
      }
    });
  }

  /**
   * Check if selector is for above-the-fold content
   */
  private isAboveFoldSelector(selector: string): boolean {
    const aboveFoldPatterns = [
      'header',
      'nav',
      'hero',
      'banner',
      'fold',
      'top',
      'main',
    ];

    return aboveFoldPatterns.some((pattern) =>
      selector.toLowerCase().includes(pattern),
    );
  }

  /**
   * Check if selector matches critical patterns
   */
  private isCriticalPattern(selector: string): boolean {
    const criticalPatterns = [
      /^html/i,
      /^body/i,
      /^@font-face/i,
      /^:root/i,
      /^\*/,
      /^@keyframes/i,
    ];

    return criticalPatterns.some((pattern) => pattern.test(selector));
  }

  /**
   * Generate HTML with inlined critical CSS
   */
  private generateHTML(critical: string, nonCritical: string): string {
    let html = this.options.html;

    if (this.options.inline && critical) {
      // Inline critical CSS
      const styleTag = `<style>${critical}</style>`;

      // Insert before closing head tag
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${styleTag}\n</head>`);
      } else if (html.includes('<body')) {
        html = html.replace('<body', `${styleTag}\n<body`);
      } else {
        html = styleTag + html;
      }
    }

    if (this.options.deferNonCritical && nonCritical) {
      // Add deferred non-critical CSS
      const deferredLink = `
<link rel="preload" href="${this.options.basePath}non-critical.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="${this.options.basePath}non-critical.css"></noscript>
      `.trim();

      if (html.includes('</head>')) {
        html = html.replace('</head>', `${deferredLink}\n</head>`);
      } else if (html.includes('</body>')) {
        html = html.replace('</body>', `${deferredLink}\n</body>`);
      } else {
        html = html + deferredLink;
      }
    }

    return html;
  }
}

interface CSSRule {
  selector: string;
  content: string;
  raw: string;
}

/**
 * Extract critical CSS for a route
 */
export async function extractCriticalCSS(
  options: CriticalCSSOptions,
): Promise<CriticalCSSResult> {
  const extractor = new CriticalCSSExtractor(options);
  return extractor.extract();
}

/**
 * Generate per-route critical CSS
 */
export class RouteBasedCriticalCSS {
  private routes: Map<string, CriticalCSSResult> = new Map();

  /**
   * Add route critical CSS
   */
  async addRoute(
    route: string,
    options: CriticalCSSOptions,
  ): Promise<CriticalCSSResult> {
    const result = await extractCriticalCSS(options);
    this.routes.set(route, result);
    return result;
  }

  /**
   * Get critical CSS for route
   */
  getRoute(route: string): CriticalCSSResult | undefined {
    return this.routes.get(route);
  }

  /**
   * Get all routes
   */
  getAllRoutes(): Map<string, CriticalCSSResult> {
    return new Map(this.routes);
  }

  /**
   * Get common critical CSS across all routes
   */
  getCommonCriticalCSS(): string {
    const allCriticalCSS = Array.from(this.routes.values()).map(
      (r) => r.critical,
    );

    if (allCriticalCSS.length === 0) return '';

    // Find CSS rules that appear in all routes
    const firstRoute = allCriticalCSS[0];
    if (!firstRoute) return '';

    const firstRouteRules = new Set(firstRoute.split('\n'));
    const commonRules = new Set(firstRouteRules);

    for (let i = 1; i < allCriticalCSS.length; i++) {
      const currentRoute = allCriticalCSS[i];
      if (!currentRoute) continue;

      const routeRules = new Set(currentRoute.split('\n'));
      for (const rule of commonRules) {
        if (!routeRules.has(rule)) {
          commonRules.delete(rule);
        }
      }
    }

    return Array.from(commonRules).join('\n');
  }

  /**
   * Generate coverage report
   */
  getCoverageReport(): {
    routes: number;
    totalRules: number;
    criticalRules: number;
    nonCriticalRules: number;
    averageCoverage: number;
  } {
    const routes = Array.from(this.routes.values());

    if (routes.length === 0) {
      return {
        routes: 0,
        totalRules: 0,
        criticalRules: 0,
        nonCriticalRules: 0,
        averageCoverage: 0,
      };
    }

    const totalRules = routes.reduce((sum, r) => sum + r.coverage.total, 0);
    const criticalRules = routes.reduce((sum, r) => sum + r.coverage.used, 0);
    const nonCriticalRules = routes.reduce(
      (sum, r) => sum + r.coverage.unused,
      0,
    );
    const averageCoverage =
      routes.reduce((sum, r) => sum + r.coverage.percentage, 0) / routes.length;

    return {
      routes: routes.length,
      totalRules,
      criticalRules,
      nonCriticalRules,
      averageCoverage,
    };
  }
}
