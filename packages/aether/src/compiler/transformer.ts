/**
 * Transformer
 *
 * AST transformation pipeline that applies various optimization passes
 */

import * as ts from 'typescript';
import type { AnalysisResult, CompilerOptions, TransformPass } from './types.js';
import { getNodeLocation, isAnyJSXElement, getJSXTagName } from './parser.js';

/**
 * Transform AST with optimization passes
 *
 * @param sourceFile - Source file AST
 * @param analysis - Analysis result
 * @param options - Compiler options
 * @returns Transformed source file
 *
 * @example
 * ```typescript
 * const transformed = transform(sourceFile, analysis, {
 *   optimize: 'aggressive'
 * });
 * ```
 */
export function transform(
  sourceFile: ts.SourceFile,
  analysis: AnalysisResult,
  options: CompilerOptions = {}
): ts.SourceFile {
  // Build transformation passes based on options
  const passes = buildTransformPasses(options);

  // Apply each pass sequentially
  let transformed = sourceFile;
  for (const pass of passes) {
    transformed = pass.transform(transformed, analysis, options);
  }

  return transformed;
}

/**
 * Build transformation passes based on options
 */
function buildTransformPasses(options: CompilerOptions): TransformPass[] {
  const passes: TransformPass[] = [];

  // Always apply JSX transform
  passes.push(jsxTransformPass);

  if (options.optimize === 'none') {
    return passes;
  }

  // Basic optimizations
  passes.push(hoistStaticElementsPass);
  passes.push(optimizeSignalsPass);

  if (options.optimize === 'aggressive') {
    // Aggressive optimizations
    passes.push(inlineComponentsPass);
    passes.push(batchEffectsPass);
    passes.push(eliminateDeadCodePass);
    passes.push(constantFoldingPass);
  }

  return passes;
}

/**
 * JSX Transform Pass
 *
 * Transforms JSX elements to optimized DOM operations
 */
const jsxTransformPass: TransformPass = {
  name: 'jsx-transform',
  description: 'Transform JSX to optimized DOM operations',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node => {
        // Transform JSX elements
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          return transformJSXElement(node, factory, options);
        }

        // Transform JSX fragments
        if (ts.isJsxFragment(node)) {
          return transformJSXFragment(node, factory);
        }

        return ts.visitEachChild(node, visit, context);
      };

      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    return result.transformed[0] as ts.SourceFile;
  },
};

/**
 * Hoist Static Elements Pass
 *
 * Hoists static elements outside component functions
 */
const hoistStaticElementsPass: TransformPass = {
  name: 'hoist-static',
  description: 'Hoist static elements',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;
    const hoistedTemplates: ts.Statement[] = [];

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node => {
        // Look for static JSX elements
        if (isAnyJSXElement(node)) {
          const location = getNodeLocation(node, sourceFile);
          const staticElement = analysis.staticElements.find((e) => e.location.line === location.line && e.hoistable);

          if (staticElement && staticElement.cloneable) {
            // Create template variable
            const templateName = `_template_${hoistedTemplates.length}`;

            // Create template declaration
            const templateDecl = createTemplateDeclaration(templateName, node, factory);
            hoistedTemplates.push(templateDecl);

            // Replace with template clone
            return createTemplateClone(templateName, factory);
          }
        }

        return ts.visitEachChild(node, visit, context);
      };

      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    let transformed = result.transformed[0] as ts.SourceFile;

    // Add hoisted templates at the top
    if (hoistedTemplates.length > 0) {
      transformed = factory.updateSourceFile(transformed, [...hoistedTemplates, ...transformed.statements]);
    }

    return transformed;
  },
};

/**
 * Optimize Signals Pass
 *
 * Optimizes signal declarations and usage
 */
const optimizeSignalsPass: TransformPass = {
  name: 'optimize-signals',
  description: 'Optimize signal declarations',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node => {
        // Optimize signals that are never updated (convert to constants)
        if (ts.isVariableDeclaration(node) && ts.isCallExpression(node.initializer!)) {
          const call = node.initializer;
          if (ts.isIdentifier(call.expression) && call.expression.text === 'signal' && ts.isIdentifier(node.name)) {
            const signalName = node.name.text;
            const signalAnalysis = analysis.signals.find((s) => s.name === signalName);

            if (signalAnalysis && signalAnalysis.updates.length === 0 && signalAnalysis.initialValue !== undefined) {
              // Convert to constant
              return factory.createVariableDeclaration(
                node.name,
                node.exclamationToken,
                node.type,
                factory.createIdentifier(JSON.stringify(signalAnalysis.initialValue))
              );
            }
          }
        }

        return ts.visitEachChild(node, visit, context);
      };

      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    return result.transformed[0] as ts.SourceFile;
  },
};

/**
 * Inline Components Pass
 *
 * Inlines small components
 */
const inlineComponentsPass: TransformPass = {
  name: 'inline-components',
  description: 'Inline small components',

  transform(sourceFile, analysis, options) {
    // Component inlining is complex and requires careful handling
    // For now, just return the source file unchanged
    // TODO: Implement component inlining
    return sourceFile;
  },
};

/**
 * Batch Effects Pass
 *
 * Batches multiple effects together
 */
const batchEffectsPass: TransformPass = {
  name: 'batch-effects',
  description: 'Batch effects together',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;

    // Find consecutive effects that can be batched
    const batchableEffects = analysis.effects.filter((e) => e.batchable);

    if (batchableEffects.length < 2) {
      return sourceFile;
    }

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node =>
        // TODO: Implement effect batching logic
        ts.visitEachChild(node, visit, context);
      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    return result.transformed[0] as ts.SourceFile;
  },
};

/**
 * Eliminate Dead Code Pass
 *
 * Removes unreachable code
 */
const eliminateDeadCodePass: TransformPass = {
  name: 'eliminate-dead-code',
  description: 'Remove unreachable code',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node | undefined => {
        // Remove code after return
        if (ts.isBlock(node)) {
          const statements: ts.Statement[] = [];
          let reachedReturn = false;

          for (const statement of node.statements) {
            if (reachedReturn) {
              // Skip statements after return
              continue;
            }

            statements.push(statement);

            if (ts.isReturnStatement(statement)) {
              reachedReturn = true;
            }
          }

          if (statements.length !== node.statements.length) {
            return factory.updateBlock(node, statements);
          }
        }

        // Remove if (false) branches
        if (ts.isIfStatement(node)) {
          const condition = node.expression;
          if (condition.kind === ts.SyntaxKind.FalseKeyword) {
            // Remove entire if statement or keep else branch
            return node.elseStatement ? node.elseStatement : undefined;
          }
          if (condition.kind === ts.SyntaxKind.TrueKeyword) {
            // Keep only then branch
            return node.thenStatement;
          }
        }

        return ts.visitEachChild(node, visit, context);
      };

      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    return result.transformed[0] as ts.SourceFile;
  },
};

/**
 * Constant Folding Pass
 *
 * Evaluates constant expressions at compile time
 */
const constantFoldingPass: TransformPass = {
  name: 'constant-folding',
  description: 'Fold constant expressions',

  transform(sourceFile, analysis, options) {
    const factory = ts.factory;

    const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
      const visit: ts.Visitor = (node): ts.Node => {
        // Fold binary expressions with literals
        if (ts.isBinaryExpression(node)) {
          const left = node.left;
          const right = node.right;

          if (ts.isNumericLiteral(left) && ts.isNumericLiteral(right)) {
            const leftVal = Number(left.text);
            const rightVal = Number(right.text);
            let result: number | undefined;

            switch (node.operatorToken.kind) {
              case ts.SyntaxKind.PlusToken:
                result = leftVal + rightVal;
                break;
              case ts.SyntaxKind.MinusToken:
                result = leftVal - rightVal;
                break;
              case ts.SyntaxKind.AsteriskToken:
                result = leftVal * rightVal;
                break;
              case ts.SyntaxKind.SlashToken:
                result = leftVal / rightVal;
                break;
            }

            if (result !== undefined) {
              return factory.createNumericLiteral(result);
            }
          }
        }

        return ts.visitEachChild(node, visit, context);
      };

      return (node: T) => ts.visitNode(node, visit) as T;
    };

    const result = ts.transform(sourceFile, [transformer]);
    return result.transformed[0] as ts.SourceFile;
  },
};

/**
 * Transform JSX element to DOM operations
 */
function transformJSXElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  factory: ts.NodeFactory,
  options: CompilerOptions
): ts.Expression {
  // For automatic JSX runtime, keep JSX as-is
  // The runtime will handle it
  if (options.jsx?.runtime === 'automatic') {
    return node as any;
  }

  // For classic mode, transform to createElement calls
  const tagName = getJSXTagName(node);

  // Get attributes
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;

  const props = transformJSXAttributes(attributes, factory);

  // Get children
  const children: ts.Expression[] = [];
  if (ts.isJsxElement(node)) {
    for (const child of node.children) {
      if (ts.isJsxText(child)) {
        const text = child.text.trim();
        if (text) {
          children.push(factory.createStringLiteral(text));
        }
      } else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        children.push(transformJSXElement(child, factory, options));
      } else if (ts.isJsxExpression(child) && child.expression) {
        children.push(child.expression);
      }
    }
  }

  // Create jsx() call
  const pragma = options.jsx?.pragma || 'jsx';
  return factory.createCallExpression(factory.createIdentifier(pragma), undefined, [
    factory.createStringLiteral(tagName),
    props,
    ...(children.length > 0 ? children : []),
  ]);
}

/**
 * Transform JSX fragment to DOM operations
 */
function transformJSXFragment(node: ts.JsxFragment, factory: ts.NodeFactory): ts.Expression {
  // Create Fragment identifier
  return factory.createIdentifier('Fragment');
}

/**
 * Transform JSX attributes to props object
 */
function transformJSXAttributes(attributes: ts.JsxAttributes, factory: ts.NodeFactory): ts.Expression {
  const properties: ts.ObjectLiteralElementLike[] = [];

  for (const attr of attributes.properties) {
    if (ts.isJsxAttribute(attr)) {
      const name = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
      let value: ts.Expression = factory.createTrue();

      if (attr.initializer) {
        if (ts.isStringLiteral(attr.initializer)) {
          value = attr.initializer;
        } else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          value = attr.initializer.expression;
        }
      }

      properties.push(factory.createPropertyAssignment(factory.createIdentifier(name), value));
    } else if (ts.isJsxSpreadAttribute(attr)) {
      properties.push(factory.createSpreadAssignment(attr.expression));
    }
  }

  if (properties.length === 0) {
    return factory.createNull();
  }

  return factory.createObjectLiteralExpression(properties, false);
}

/**
 * Create template declaration for hoisting
 */
function createTemplateDeclaration(name: string, node: ts.Node, factory: ts.NodeFactory): ts.Statement {
  // Create: const _template = document.createElement('template');
  const createTemplate = factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createIdentifier(name),
          undefined,
          undefined,
          factory.createCallExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier('document'),
              factory.createIdentifier('createElement')
            ),
            undefined,
            [factory.createStringLiteral('template')]
          )
        ),
      ],
      ts.NodeFlags.Const
    )
  );

  return createTemplate;
}

/**
 * Create template clone expression
 */
function createTemplateClone(templateName: string, factory: ts.NodeFactory): ts.Expression {
  // Return: _template.content.cloneNode(true)
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier(templateName),
        factory.createIdentifier('content')
      ),
      factory.createIdentifier('cloneNode')
    ),
    undefined,
    [factory.createTrue()]
  );
}

/**
 * Create a custom transform pass
 *
 * @param name - Pass name
 * @param transformFn - Transform function
 * @returns Transform pass
 *
 * @example
 * ```typescript
 * const myPass = createTransformPass('my-pass', (sourceFile) => {
 *   // Transform logic
 *   return sourceFile;
 * });
 * ```
 */
export function createTransformPass(
  name: string,
  transformFn: (sourceFile: ts.SourceFile, analysis: AnalysisResult, options: CompilerOptions) => ts.SourceFile
): TransformPass {
  return {
    name,
    transform: transformFn,
  };
}
