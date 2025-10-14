/**
 * Analyzer
 *
 * Static analysis for identifying optimization opportunities
 * Analyzes signals, effects, computed values, and components
 */

import * as ts from 'typescript';
import type {
  AnalysisResult,
  SignalAnalysis,
  EffectAnalysis,
  ComputedAnalysis,
  ComponentAnalysis,
  StaticElementAnalysis,
  OptimizationOpportunity,
  CompilerOptions,
  SourceLocation,
} from './types.js';
import {
  walkAST,
  findNodes,
  isSignalCall,
  isEffectCall,
  isComputedCall,
  isComponentDefinition,
  isAnyJSXElement,
  getNodeLocation,
  getJSXTagName,
} from './parser.js';

/**
 * Analyze source file for optimization opportunities
 *
 * @param sourceFile - TypeScript source file AST
 * @param options - Compiler options
 * @param typeChecker - Optional type checker for semantic analysis
 * @returns Analysis result with detected patterns
 *
 * @example
 * ```typescript
 * const result = analyze(sourceFile, { optimize: 'aggressive' });
 * console.log(result.signals, result.effects);
 * ```
 */
export function analyze(
  sourceFile: ts.SourceFile,
  options: CompilerOptions = {},
  typeChecker?: ts.TypeChecker
): AnalysisResult {
  const context: AnalysisContext = {
    sourceFile,
    options,
    typeChecker,
    signals: [],
    effects: [],
    computed: [],
    components: [],
    staticElements: [],
    optimizations: [],
    scopeStack: [],
  };

  // Run analysis passes
  analyzeSignals(context);
  analyzeEffects(context);
  analyzeComputed(context);
  analyzeComponents(context);
  analyzeStaticElements(context);
  identifyOptimizations(context);

  return {
    signals: context.signals,
    effects: context.effects,
    computed: context.computed,
    components: context.components,
    staticElements: context.staticElements,
    optimizations: context.optimizations,
  };
}

/**
 * Analysis context
 */
interface AnalysisContext {
  sourceFile: ts.SourceFile;
  options: CompilerOptions;
  typeChecker?: ts.TypeChecker;
  signals: SignalAnalysis[];
  effects: EffectAnalysis[];
  computed: ComputedAnalysis[];
  components: ComponentAnalysis[];
  staticElements: StaticElementAnalysis[];
  optimizations: OptimizationOpportunity[];
  scopeStack: string[];
}

/**
 * Analyze signal declarations and usage
 */
function analyzeSignals(context: AnalysisContext): void {
  // Find all signal() calls
  const signalCalls = findNodes<ts.CallExpression>(context.sourceFile, isSignalCall);

  for (const call of signalCalls) {
    // Get signal name from variable declaration
    const parent = call.parent;
    let name = 'anonymous';

    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      name = parent.name.text;
    }

    // Get initial value if it's a literal
    let initialValue: any;
    if (call.arguments.length > 0) {
      const arg = call.arguments[0];
      if (arg) {
        initialValue = extractLiteralValue(arg);
      }
    }

    // Find all accesses and updates
    const accesses: SourceLocation[] = [];
    const updates: SourceLocation[] = [];

    // Search for signal usage in the file
    walkAST(context.sourceFile, (node) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;

        // Check for signal() read
        if (ts.isIdentifier(expression) && expression.text === name) {
          accesses.push(getNodeLocation(node, context.sourceFile));
        }

        // Check for signal.set() write
        if (
          ts.isPropertyAccessExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === name &&
          expression.name.text === 'set'
        ) {
          updates.push(getNodeLocation(node, context.sourceFile));
        }
      }
    });

    const signal: SignalAnalysis = {
      name,
      location: getNodeLocation(call, context.sourceFile),
      initialValue,
      accesses,
      updates,
      optimizable: canOptimizeSignal(call, accesses, updates),
    };

    context.signals.push(signal);
  }
}

/**
 * Analyze effect declarations
 */
function analyzeEffects(context: AnalysisContext): void {
  const effectCalls = findNodes<ts.CallExpression>(context.sourceFile, isEffectCall);

  for (const call of effectCalls) {
    if (call.arguments.length === 0) {
      continue;
    }

    const effectFn = call.arguments[0];
    if (!effectFn) {
      continue;
    }

    // Extract dependencies from effect function
    const dependencies = extractDependencies(effectFn);

    // Check if effect can be batched
    const batchable = canBatchEffect(call, context);

    const effect: EffectAnalysis = {
      location: getNodeLocation(call, context.sourceFile),
      dependencies,
      batchable,
      type: 'effect',
    };

    context.effects.push(effect);
  }
}

/**
 * Analyze computed declarations
 */
function analyzeComputed(context: AnalysisContext): void {
  const computedCalls = findNodes<ts.CallExpression>(context.sourceFile, isComputedCall);

  for (const call of computedCalls) {
    const parent = call.parent;
    let name = 'anonymous';

    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      name = parent.name.text;
    }

    if (call.arguments.length === 0) {
      continue;
    }

    const computedFn = call.arguments[0];
    if (!computedFn) {
      continue;
    }

    // Extract dependencies
    const dependencies = extractDependencies(computedFn);

    // Check if pure
    const pure = isPureFunction(computedFn);

    const computed: ComputedAnalysis = {
      name,
      location: getNodeLocation(call, context.sourceFile),
      dependencies,
      memoizable: true,
      pure,
    };

    context.computed.push(computed);
  }
}

/**
 * Analyze component declarations
 */
function analyzeComponents(context: AnalysisContext): void {
  walkAST(context.sourceFile, (node) => {
    if (!isComponentDefinition(node)) {
      return;
    }

    let name = 'AnonymousComponent';
    let type: 'function' | 'class' = 'function';

    // Extract component name
    if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
    } else if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      name = node.parent.name.text;
    } else if (ts.isClassDeclaration(node) && node.name) {
      name = node.name.text;
      type = 'class';
    }

    // Check for static JSX
    const hasStaticJSX = containsStaticJSX(node);

    // Check for reactive dependencies
    const hasReactiveDeps = containsReactiveDependencies(node);

    // Check if inlinable (small component with no state)
    const inlinable = isInlinableComponent(node);

    // Check markers for server/island components
    const isServerComponent = hasServerOnlyMarker(node);
    const isIsland = hasIslandMarker(node);

    const component: ComponentAnalysis = {
      name,
      location: getNodeLocation(node, context.sourceFile),
      type,
      hasStaticJSX,
      hasReactiveDeps,
      inlinable,
      isServerComponent,
      isIsland,
    };

    context.components.push(component);
  });
}

/**
 * Analyze static elements that can be hoisted
 */
function analyzeStaticElements(context: AnalysisContext): void {
  walkAST(context.sourceFile, (node) => {
    if (!isAnyJSXElement(node)) {
      return;
    }

    // Skip if not static
    if (!isStaticJSXElement(node)) {
      return;
    }

    let tag = '';
    if (ts.isJsxElement(node)) {
      tag = getJSXTagName(node);
    } else if (ts.isJsxSelfClosingElement(node)) {
      tag = getJSXTagName(node);
    }

    const staticElement: StaticElementAnalysis = {
      location: getNodeLocation(node, context.sourceFile),
      tag,
      hoistable: canHoistElement(node),
      cloneable: canUseTemplateCloning(node),
    };

    context.staticElements.push(staticElement);
  });
}

/**
 * Identify optimization opportunities
 */
function identifyOptimizations(context: AnalysisContext): void {
  const { options } = context;

  if (options.optimize === 'none') {
    return;
  }

  // Optimize signals
  for (const signal of context.signals) {
    if (signal.optimizable) {
      if (signal.accesses.length === 0) {
        context.optimizations.push({
          type: 'eliminate-unused',
          location: signal.location,
          description: `Eliminate unused signal '${signal.name}'`,
          impact: 'low',
        });
      } else if (signal.updates.length === 0) {
        context.optimizations.push({
          type: 'inline-constant',
          location: signal.location,
          description: `Convert signal '${signal.name}' to constant (never updated)`,
          impact: 'medium',
        });
      }
    }
  }

  // Hoist static elements
  for (const element of context.staticElements) {
    if (element.hoistable) {
      context.optimizations.push({
        type: 'hoist-static',
        location: element.location,
        description: `Hoist static <${element.tag}> element`,
        impact: 'medium',
      });
    }
  }

  // Inline components
  for (const component of context.components) {
    if (component.inlinable) {
      context.optimizations.push({
        type: 'inline-component',
        location: component.location,
        description: `Inline ${component.name} component`,
        impact: 'low',
      });
    }
  }

  // Batch effects
  const batchableEffects = context.effects.filter((e) => e.batchable);
  if (batchableEffects.length > 1) {
    context.optimizations.push({
      type: 'batch-effects',
      location: batchableEffects[0]!.location,
      description: `Batch ${batchableEffects.length} effects`,
      impact: 'medium',
    });
  }

  // Memoize computed values
  for (const computed of context.computed) {
    if (computed.pure && computed.dependencies.length > 0) {
      context.optimizations.push({
        type: 'memoize-computed',
        location: computed.location,
        description: `Memoize ${computed.name} computed value`,
        impact: 'low',
      });
    }
  }
}

/**
 * Extract literal value from expression
 */
function extractLiteralValue(node: ts.Node): any {
  if (ts.isStringLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  return undefined;
}

/**
 * Extract dependencies from function
 */
function extractDependencies(node: ts.Node): string[] {
  const dependencies = new Set<string>();
  const excludedIdentifiers = new Set(['console', 'Math', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean']);

  walkAST(node, (child) => {
    // Look for signal reads (function calls)
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const name = child.expression.text;
      // Exclude built-in objects and console
      if (!excludedIdentifiers.has(name)) {
        dependencies.add(name);
      }
    }

    // Look for property accesses
    if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.expression)) {
      const name = child.expression.text;
      // Exclude built-in objects and console
      if (!excludedIdentifiers.has(name)) {
        dependencies.add(name);
      }
    }
  });

  return Array.from(dependencies);
}

/**
 * Check if function is pure (no side effects)
 */
function isPureFunction(node: ts.Node): boolean {
  let hasSideEffects = false;

  walkAST(node, (child) => {
    // Assignment = side effect
    if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      hasSideEffects = true;
    }

    // Console.log = side effect
    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === 'console'
    ) {
      hasSideEffects = true;
    }
  });

  return !hasSideEffects;
}

/**
 * Check if signal can be optimized
 */
function canOptimizeSignal(call: ts.CallExpression, accesses: SourceLocation[], updates: SourceLocation[]): boolean {
  // If signal has no accesses, it can be eliminated
  if (accesses.length === 0) {
    return true;
  }

  // If signal is never updated AND has initial value, it can be converted to constant
  if (updates.length === 0 && call.arguments.length > 0) {
    const arg = call.arguments[0];
    // If the initial value is a literal, it's definitely optimizable
    if (
      arg &&
      (ts.isStringLiteral(arg) ||
        ts.isNumericLiteral(arg) ||
        arg.kind === ts.SyntaxKind.TrueKeyword ||
        arg.kind === ts.SyntaxKind.FalseKeyword ||
        arg.kind === ts.SyntaxKind.NullKeyword)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if effect can be batched
 */
function canBatchEffect(call: ts.CallExpression, context: AnalysisContext): boolean {
  // Effects without dependencies can't be batched effectively
  const effectFn = call.arguments[0];
  if (!effectFn) {
    return false;
  }

  const deps = extractDependencies(effectFn);
  return deps.length > 0;
}

/**
 * Check if component contains static JSX
 */
function containsStaticJSX(node: ts.Node): boolean {
  let hasJSX = false;
  let hasStatic = false;

  walkAST(node, (child) => {
    if (isAnyJSXElement(child)) {
      hasJSX = true;
      if (isStaticJSXElement(child)) {
        hasStatic = true;
      }
    }
  });

  return hasJSX && hasStatic;
}

/**
 * Check if component has reactive dependencies
 */
function containsReactiveDependencies(node: ts.Node): boolean {
  let hasReactive = false;

  walkAST(node, (child) => {
    if (isSignalCall(child) || isEffectCall(child) || isComputedCall(child)) {
      hasReactive = true;
    }
  });

  return hasReactive;
}

/**
 * Check if component is inlinable
 */
function isInlinableComponent(node: ts.Node): boolean {
  // Count statements/expressions
  let statementCount = 0;

  walkAST(node, (child) => {
    if (ts.isExpressionStatement(child) || ts.isVariableStatement(child)) {
      statementCount++;
    }
  });

  // Only inline very small components
  return statementCount <= 3 && !containsReactiveDependencies(node);
}

/**
 * Check if JSX element is static (no reactive expressions)
 */
function isStaticJSXElement(node: ts.Node): boolean {
  let hasReactive = false;

  walkAST(node, (child) => {
    // JSX expression container = potentially reactive
    if (ts.isJsxExpression(child) && child.expression) {
      // Check if expression contains function calls (signals)
      if (ts.isCallExpression(child.expression)) {
        hasReactive = true;
      }
    }
  });

  return !hasReactive;
}

/**
 * Check if element can be hoisted
 */
function canHoistElement(node: ts.Node): boolean {
  // Must be static
  if (!isStaticJSXElement(node)) {
    return false;
  }

  // Must not be inside a loop
  let parent = node.parent;
  while (parent) {
    if (
      ts.isForStatement(parent) ||
      ts.isForInStatement(parent) ||
      ts.isForOfStatement(parent) ||
      ts.isWhileStatement(parent)
    ) {
      return false;
    }
    parent = parent.parent;
  }

  return true;
}

/**
 * Check if element can use template cloning
 */
function canUseTemplateCloning(node: ts.Node): boolean {
  return isStaticJSXElement(node);
}

/**
 * Check for 'use server' directive
 */
function hasServerOnlyMarker(node: ts.Node): boolean {
  // Look for 'use server' directive in leading comments
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const nodeStart = node.getFullStart();
  const leadingText = fullText.substring(Math.max(0, nodeStart - 100), nodeStart);

  return leadingText.includes("'use server'") || leadingText.includes('"use server"');
}

/**
 * Check for island marker
 */
function hasIslandMarker(node: ts.Node): boolean {
  // Look for island() wrapper or decorator
  if (ts.isCallExpression(node.parent)) {
    const expression = node.parent.expression;
    if (ts.isIdentifier(expression) && expression.text === 'island') {
      return true;
    }
  }

  return false;
}
