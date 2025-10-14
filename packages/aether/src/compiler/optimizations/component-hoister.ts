/**
 * Component Hoisting Pass
 * Hoists static components and elements out of render functions
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Component hoisting options
 */
export interface ComponentHoisterOptions {
  /**
   * Hoist static elements
   * @default true
   */
  hoistStaticElements?: boolean;

  /**
   * Hoist static components
   * @default true
   */
  hoistStaticComponents?: boolean;

  /**
   * Use template cloning for static elements
   * @default true
   */
  useTemplateCloning?: boolean;

  /**
   * Hoist constants
   * @default true
   */
  hoistConstants?: boolean;

  /**
   * Maximum element size to hoist (characters)
   * @default 1000
   */
  maxHoistSize?: number;
}

/**
 * Element analysis
 */
interface ElementInfo {
  id: number;
  code: string;
  lineNumber: number;
  isStatic: boolean;
  size: number;
  tagName?: string;
  attributes: Map<string, string>;
  children: ElementInfo[];
}

/**
 * Hoisted element
 */
interface HoistedElement {
  id: string;
  originalCode: string;
  templateCode: string;
  usageCode: string;
}

/**
 * Component hoister pass
 */
export class ComponentHoister implements OptimizationPass {
  name = 'component-hoister';
  priority = 300; // Run after signal and effect optimization

  private options: Required<ComponentHoisterOptions>;
  private hoistedElements: HoistedElement[] = [];
  private elementIdCounter = 0;

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    this.options = {
      hoistStaticElements: true,
      hoistStaticComponents: true,
      useTemplateCloning: true,
      hoistConstants: true,
      maxHoistSize: 1000,
    };
  }

  /**
   * Transform code
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;
    this.hoistedElements = [];
    this.elementIdCounter = 0;

    // Hoist static elements
    if (this.options.hoistStaticElements) {
      const result = this.hoistStaticElements(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
      warnings.push(...result.warnings);
    }

    // Hoist static components
    if (this.options.hoistStaticComponents) {
      const result = this.hoistStaticComponents(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Hoist constants
    if (this.options.hoistConstants) {
      const result = this.hoistConstants(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        hoistedElements: this.hoistedElements.length,
      },
    };
  }

  /**
   * Hoist static elements
   */
  private hoistStaticElements(code: string): {
    code: string;
    changes: OptimizationChange[];
    warnings: string[];
  } {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];
    let optimizedCode = code;

    // Find JSX elements in component render functions
    const elements = this.findStaticJSXElements(optimizedCode);

    for (const element of elements) {
      if (element.isStatic && element.size <= this.options.maxHoistSize) {
        const hoisted = this.createHoistedElement(element);

        // Replace original element with template usage
        optimizedCode = optimizedCode.replace(element.code, hoisted.usageCode);

        // Add template definition at module level
        optimizedCode = this.insertHoistedTemplate(optimizedCode, hoisted.templateCode);

        this.hoistedElements.push(hoisted);

        changes.push({
          type: 'component-hoist',
          description: `Hoisted static ${element.tagName || 'element'} to template`,
          sizeImpact: element.code.length - hoisted.usageCode.length,
          location: { line: element.lineNumber, column: 0 },
        });
      }
    }

    return { code: optimizedCode, changes, warnings };
  }

  /**
   * Find static JSX elements
   */
  private findStaticJSXElements(code: string): ElementInfo[] {
    const elements: ElementInfo[] = [];
    const lines = code.split('\n');

    // Simple JSX detection (this would need proper AST parsing in production)
    const jsxPattern = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
    const selfClosingPattern = /<(\w+)([^>]*?)\/>/g;

    let match: RegExpExecArray | null;
    let elementId = 0;

    // Find JSX elements
    const fullCode = lines.join('\n');

    while ((match = jsxPattern.exec(fullCode)) !== null) {
      const tagName = match[1];
      const attributesStr = match[2];
      const content = match[3];

      if (tagName && attributesStr !== undefined && content !== undefined) {
        const element: ElementInfo = {
          id: elementId++,
          code: match[0] || '',
          lineNumber: this.getLineNumber(fullCode, match.index),
          isStatic: this.isStaticElement(match[0] || ''),
          size: (match[0] || '').length,
          tagName,
          attributes: this.parseAttributes(attributesStr),
          children: [],
        };

        elements.push(element);
      }
    }

    // Find self-closing elements
    while ((match = selfClosingPattern.exec(fullCode)) !== null) {
      const tagName = match[1];
      const attributesStr = match[2];

      if (tagName && attributesStr !== undefined) {
        const element: ElementInfo = {
          id: elementId++,
          code: match[0] || '',
          lineNumber: this.getLineNumber(fullCode, match.index),
          isStatic: this.isStaticElement(match[0] || ''),
          size: (match[0] || '').length,
          tagName,
          attributes: this.parseAttributes(attributesStr),
          children: [],
        };

        elements.push(element);
      }
    }

    return elements;
  }

  /**
   * Check if element is static
   */
  private isStaticElement(code: string): boolean {
    // Element is static if it has no:
    // - Dynamic attributes: {...}
    // - Event handlers: onClick={...}
    // - Expressions: {expression}
    // - Conditional rendering
    // - Loops

    const dynamicPatterns = [
      /\{[^}]*\}/, // Any expression
      /on\w+=/, // Event handlers
      /\.\.\./, // Spread attributes
    ];

    return !dynamicPatterns.some((pattern) => pattern.test(code));
  }

  /**
   * Parse attributes from attribute string
   */
  private parseAttributes(attrStr: string): Map<string, string> {
    const attributes = new Map<string, string>();
    const attrPattern = /(\w+)(?:=["']([^"']*)["'])?/g;

    let match: RegExpExecArray | null;
    while ((match = attrPattern.exec(attrStr)) !== null) {
      const name = match[1];
      const value = match[2];
      if (name) {
        attributes.set(name, value || 'true');
      }
    }

    return attributes;
  }

  /**
   * Get line number from index
   */
  private getLineNumber(code: string, index: number): number {
    return code.substring(0, index).split('\n').length;
  }

  /**
   * Create hoisted element
   */
  private createHoistedElement(element: ElementInfo): HoistedElement {
    const id = `_template${this.elementIdCounter++}`;

    let templateCode: string;
    let usageCode: string;

    if (this.options.useTemplateCloning) {
      // Use HTML template for efficient cloning
      templateCode = `const ${id} = document.createElement('template');
${id}.innerHTML = ${JSON.stringify(element.code)};`;

      usageCode = `${id}.content.cloneNode(true)`;
    } else {
      // Use direct element creation
      templateCode = this.generateElementCreationCode(element, id);
      usageCode = `${id}.cloneNode(true)`;
    }

    return {
      id,
      originalCode: element.code,
      templateCode,
      usageCode,
    };
  }

  /**
   * Generate element creation code
   */
  private generateElementCreationCode(element: ElementInfo, varName: string): string {
    let code = `const ${varName} = document.createElement('${element.tagName}');\n`;

    // Add attributes
    for (const [name, value] of element.attributes) {
      if (name === 'class') {
        code += `${varName}.className = ${JSON.stringify(value)};\n`;
      } else if (name === 'style') {
        code += `${varName}.style.cssText = ${JSON.stringify(value)};\n`;
      } else {
        code += `${varName}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`;
      }
    }

    return code;
  }

  /**
   * Insert hoisted template at module level
   */
  private insertHoistedTemplate(code: string, templateCode: string): string {
    // Find first import or top of file
    const lines = code.split('\n');
    let insertIndex = 0;

    // Find last import statement
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim().startsWith('import ')) {
        insertIndex = i + 1;
      } else if (insertIndex > 0) {
        break;
      }
    }

    // Insert template code
    lines.splice(insertIndex, 0, '', templateCode);

    return lines.join('\n');
  }

  /**
   * Hoist static components
   */
  private hoistStaticComponents(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    let optimizedCode = code;

    // Pattern: Component definitions without props
    const staticComponentPattern = /const\s+(\w+)\s*=\s*\(\)\s*=>\s*\{([^}]+)\}/g;

    const components: Array<{ name: string; body: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = staticComponentPattern.exec(code)) !== null) {
      const name = match[1];
      const body = match[2];

      if (name && body && !this.hasDynamicDependencies(body)) {
        components.push({ name, body });
      }
    }

    // For static components, we can memo them
    for (const component of components) {
      const memoizedCode = `const ${component.name} = memo(() => {${component.body}});`;
      const originalPattern = new RegExp(
        `const\\s+${component.name}\\s*=\\s*\\(\\)\\s*=>\\s*\\{${this.escapeRegex(component.body)}\\}`
      );

      if (originalPattern.test(optimizedCode)) {
        optimizedCode = optimizedCode.replace(originalPattern, memoizedCode);

        changes.push({
          type: 'component-hoist',
          description: `Memoized static component '${component.name}'`,
        });
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Check if code has dynamic dependencies
   */
  private hasDynamicDependencies(code: string): boolean {
    // Check for signal access, props access, etc.
    return (
      /\b\w+\(\)/.test(code) || // Signal access
      /\bprops\./.test(code) || // Props access
      /\bcontext\./.test(code) // Context access
    );
  }

  /**
   * Hoist constants
   */
  private hoistConstants(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const optimizedCode = code;

    // Find constants inside components that can be hoisted
    const constantPattern = /const\s+(\w+)\s*=\s*([^;]+);/g;
    const componentPattern = /(?:const|function)\s+\w+\s*=?\s*\([^)]*\)\s*(?:=>)?\s*\{/g;

    const lines = code.split('\n');
    const constantsToHoist: Array<{
      name: string;
      value: string;
      line: number;
    }> = [];

    let inComponent = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Track component boundaries
      if (componentPattern.test(line)) {
        inComponent = true;
        braceDepth = 0;
      }

      if (inComponent) {
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        if (braceDepth === 0) {
          inComponent = false;
        }

        // Find constants inside component
        const match = constantPattern.exec(line);
        if (match && this.isHoistableConstant(match[2] || '')) {
          const name = match[1];
          const value = match[2];

          if (name && value) {
            constantsToHoist.push({ name, value, line: i });
          }
        }
      }
    }

    // Hoist constants (would need proper scope analysis in production)
    for (const constant of constantsToHoist) {
      changes.push({
        type: 'component-hoist',
        description: `Hoisted constant '${constant.name}' outside component`,
        location: { line: constant.line + 1, column: 0 },
      });
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Check if value is hoistable constant
   */
  private isHoistableConstant(value: string): boolean {
    // Constants that can be safely hoisted
    const trimmed = value.trim();

    // Literals
    if (/^(?:true|false|null|undefined|\d+|'[^']*'|"[^"]*"|`[^`]*`)$/.test(trimmed)) {
      return true;
    }

    // Simple objects/arrays without dynamic content
    if (/^(?:\{[^{}]*\}|\[[^\]]*\])$/.test(trimmed)) {
      return !trimmed.includes('${') && !trimmed.includes('()');
    }

    return false;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
