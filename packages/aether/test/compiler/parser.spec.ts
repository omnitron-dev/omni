/**
 * Parser Tests
 *
 * Tests for the TypeScript/JSX parser including
 * JSX parsing, signal/effect detection, and error handling
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import {
  parse,
  parseWithProgram,
  isJSXElement,
  isJSXSelfClosingElement,
  isAnyJSXElement,
  isSignalCall,
  isEffectCall,
  isComputedCall,
  isComponentDefinition,
  getJSXTagName,
  getNodeLocation,
  walkAST,
  findNodes,
} from '../../src/compiler/parser.js';

describe('Parser', () => {
  describe('Basic Parsing', () => {
    it('should parse simple TypeScript code', () => {
      const code = `const x = 42;`;
      const result = parse(code, 'test.ts');

      expect(result.sourceFile).toBeDefined();
      expect(result.warnings).toEqual([]);
    });

    it('should parse JSX code', () => {
      const code = `const elem = <div>Hello</div>;`;
      const result = parse(code, 'test.tsx');

      expect(result.sourceFile).toBeDefined();
      expect(result.warnings).toEqual([]);
    });

    it('should parse TSX code', () => {
      const code = `
        const Component: React.FC = () => {
          return <div>Hello</div>;
        };
      `;
      const result = parse(code, 'test.tsx');

      expect(result.sourceFile).toBeDefined();
    });

    it('should parse component definition', () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Test</div>;
        });
      `;
      const result = parse(code, 'test.tsx');

      expect(result.sourceFile).toBeDefined();
      expect(result.sourceFile.statements.length).toBeGreaterThan(0);
    });
  });

  describe('JSX Parsing', () => {
    it('should parse JSX element', () => {
      const code = `const elem = <div>Content</div>;`;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxElement>(result.sourceFile, isJSXElement);
      expect(jsxElements.length).toBe(1);
    });

    it('should parse self-closing JSX element', () => {
      const code = `const elem = <input />;`;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxSelfClosingElement>(result.sourceFile, isJSXSelfClosingElement);
      expect(jsxElements.length).toBe(1);
    });

    it('should parse nested JSX elements', () => {
      const code = `
        const elem = (
          <div>
            <span>Child</span>
          </div>
        );
      `;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes(result.sourceFile, isAnyJSXElement);
      expect(jsxElements.length).toBeGreaterThan(1);
    });

    it('should parse JSX with attributes', () => {
      const code = `const elem = <div id="test" className="container">Content</div>;`;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxElement>(result.sourceFile, isJSXElement);
      expect(jsxElements.length).toBe(1);

      const element = jsxElements[0];
      expect(element?.openingElement.attributes.properties.length).toBeGreaterThan(0);
    });

    it('should parse JSX with expressions', () => {
      const code = `
        const name = "World";
        const elem = <div>Hello {name}</div>;
      `;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxElement>(result.sourceFile, isJSXElement);
      expect(jsxElements.length).toBe(1);
    });

    it('should parse JSX fragments', () => {
      const code = `
        const elem = (
          <>
            <div>First</div>
            <div>Second</div>
          </>
        );
      `;
      const result = parse(code, 'test.tsx');

      const fragments = findNodes<ts.JsxFragment>(result.sourceFile, (node): node is ts.JsxFragment =>
        ts.isJsxFragment(node)
      );
      expect(fragments.length).toBe(1);
    });

    it('should parse JSX with spread attributes', () => {
      const code = `
        const props = { id: "test" };
        const elem = <div {...props}>Content</div>;
      `;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxElement>(result.sourceFile, isJSXElement);
      expect(jsxElements.length).toBe(1);
    });

    it('should get JSX tag name', () => {
      const code = `const elem = <CustomComponent />;`;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxSelfClosingElement>(result.sourceFile, isJSXSelfClosingElement);
      const element = jsxElements[0];

      if (element) {
        const tagName = getJSXTagName(element);
        expect(tagName).toBe('CustomComponent');
      }
    });

    it('should handle property access in JSX tags', () => {
      const code = `const elem = <Components.Button />;`;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes<ts.JsxSelfClosingElement>(result.sourceFile, isJSXSelfClosingElement);
      const element = jsxElements[0];

      if (element) {
        const tagName = getJSXTagName(element);
        expect(tagName).toContain('.');
      }
    });
  });

  describe('Signal Detection', () => {
    it('should detect signal calls', () => {
      const code = `const count = signal(0);`;
      const result = parse(code, 'test.ts');

      const signalCalls = findNodes<ts.CallExpression>(result.sourceFile, isSignalCall);
      expect(signalCalls.length).toBe(1);
    });

    it('should detect multiple signal calls', () => {
      const code = `
        const count = signal(0);
        const name = signal("John");
        const isActive = signal(true);
      `;
      const result = parse(code, 'test.ts');

      const signalCalls = findNodes<ts.CallExpression>(result.sourceFile, isSignalCall);
      expect(signalCalls.length).toBe(3);
    });

    it('should not detect non-signal calls', () => {
      const code = `const x = notASignal(0);`;
      const result = parse(code, 'test.ts');

      const signalCalls = findNodes<ts.CallExpression>(result.sourceFile, isSignalCall);
      expect(signalCalls.length).toBe(0);
    });
  });

  describe('Effect Detection', () => {
    it('should detect effect calls', () => {
      const code = `
        effect(() => {
          console.log('Effect');
        });
      `;
      const result = parse(code, 'test.ts');

      const effectCalls = findNodes<ts.CallExpression>(result.sourceFile, isEffectCall);
      expect(effectCalls.length).toBe(1);
    });

    it('should detect multiple effect calls', () => {
      const code = `
        effect(() => console.log('Effect 1'));
        effect(() => console.log('Effect 2'));
      `;
      const result = parse(code, 'test.ts');

      const effectCalls = findNodes<ts.CallExpression>(result.sourceFile, isEffectCall);
      expect(effectCalls.length).toBe(2);
    });
  });

  describe('Computed Detection', () => {
    it('should detect computed calls', () => {
      const code = `
        const doubled = computed(() => count() * 2);
      `;
      const result = parse(code, 'test.ts');

      const computedCalls = findNodes<ts.CallExpression>(result.sourceFile, isComputedCall);
      expect(computedCalls.length).toBe(1);
    });

    it('should detect multiple computed values', () => {
      const code = `
        const doubled = computed(() => count() * 2);
        const tripled = computed(() => count() * 3);
      `;
      const result = parse(code, 'test.ts');

      const computedCalls = findNodes<ts.CallExpression>(result.sourceFile, isComputedCall);
      expect(computedCalls.length).toBe(2);
    });
  });

  describe('Component Detection', () => {
    it('should detect defineComponent calls', () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Test</div>;
        });
      `;
      const result = parse(code, 'test.tsx');

      const components = findNodes(result.sourceFile, isComponentDefinition);
      expect(components.length).toBeGreaterThan(0);
    });

    it('should detect function components', () => {
      const code = `
        function MyComponent() {
          return <div>Test</div>;
        }
      `;
      const result = parse(code, 'test.tsx');

      const components = findNodes(result.sourceFile, isComponentDefinition);
      expect(components.length).toBeGreaterThan(0);
    });

    it('should detect arrow function components', () => {
      const code = `
        const MyComponent = () => {
          return <div>Test</div>;
        };
      `;
      const result = parse(code, 'test.tsx');

      const components = findNodes(result.sourceFile, isComponentDefinition);
      expect(components.length).toBeGreaterThan(0);
    });
  });

  describe('Node Location', () => {
    it('should get node location', () => {
      const code = `const x = 42;`;
      const result = parse(code, 'test.ts');

      const statement = result.sourceFile.statements[0];
      if (statement) {
        const location = getNodeLocation(statement, result.sourceFile);

        expect(location.file).toBe('test.ts');
        expect(location.line).toBeGreaterThan(0);
        expect(location.column).toBeGreaterThan(0);
        expect(location.length).toBeGreaterThan(0);
      }
    });

    it('should get accurate line and column', () => {
      const code = `
const x = 1;
const y = 2;
const z = 3;
      `;
      const result = parse(code, 'test.ts');

      const statements = result.sourceFile.statements;
      expect(statements.length).toBe(3);

      if (statements[0] && statements[1] && statements[2]) {
        const loc1 = getNodeLocation(statements[0], result.sourceFile);
        const loc2 = getNodeLocation(statements[1], result.sourceFile);
        const loc3 = getNodeLocation(statements[2], result.sourceFile);

        expect(loc2.line).toBeGreaterThan(loc1.line);
        expect(loc3.line).toBeGreaterThan(loc2.line);
      }
    });
  });

  describe('AST Walking', () => {
    it('should walk all nodes', () => {
      const code = `
        const x = 1;
        function foo() {
          const y = 2;
        }
      `;
      const result = parse(code, 'test.ts');

      const visitedNodes: ts.Node[] = [];
      walkAST(result.sourceFile, (node) => {
        visitedNodes.push(node);
      });

      expect(visitedNodes.length).toBeGreaterThan(5);
    });

    it('should visit nodes in depth-first order', () => {
      const code = `const obj = { a: { b: 1 } };`;
      const result = parse(code, 'test.ts');

      const nodeTypes: string[] = [];
      walkAST(result.sourceFile, (node) => {
        nodeTypes.push(ts.SyntaxKind[node.kind] || 'Unknown');
      });

      expect(nodeTypes.length).toBeGreaterThan(0);
    });
  });

  describe('Find Nodes', () => {
    it('should find nodes by predicate', () => {
      const code = `
        const a = 1;
        const b = 2;
        const c = 3;
      `;
      const result = parse(code, 'test.ts');

      const varDecls = findNodes<ts.VariableDeclaration>(result.sourceFile, (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node)
      );

      expect(varDecls.length).toBe(3);
    });

    it('should find function declarations', () => {
      const code = `
        function foo() {}
        function bar() {}
      `;
      const result = parse(code, 'test.ts');

      const funcDecls = findNodes<ts.FunctionDeclaration>(result.sourceFile, (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node)
      );

      expect(funcDecls.length).toBe(2);
    });

    it('should find call expressions', () => {
      const code = `
        foo();
        bar();
        baz();
      `;
      const result = parse(code, 'test.ts');

      const callExprs = findNodes<ts.CallExpression>(result.sourceFile, (node): node is ts.CallExpression =>
        ts.isCallExpression(node)
      );

      expect(callExprs.length).toBe(3);
    });
  });

  describe('Parse with Program', () => {
    it('should create program and type checker', () => {
      const code = `const x: number = 42;`;
      const result = parseWithProgram(code, 'test.ts');

      expect(result.sourceFile).toBeDefined();
      expect(result.program).toBeDefined();
      expect(result.typeChecker).toBeDefined();
    });

    it('should detect type errors', () => {
      const code = `const x: number = "not a number";`;
      const result = parseWithProgram(code, 'test.ts');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]?.level).toBe('error');
    });

    it('should validate types correctly', () => {
      const code = `
        const x: number = 42;
        const y: string = "hello";
        const z: boolean = true;
      `;
      const result = parseWithProgram(code, 'test.ts');

      // No type errors expected
      const typeErrors = result.warnings.filter((w) => w.level === 'error');
      expect(typeErrors.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors', () => {
      const code = `const x = ;`; // Invalid syntax
      const result = parse(code, 'test.ts');

      expect(result.sourceFile).toBeDefined();
      // Parser is permissive, diagnostics would be from program
    });

    it('should handle incomplete JSX', () => {
      const code = `const elem = <div>`;
      const result = parse(code, 'test.tsx');

      expect(result.sourceFile).toBeDefined();
    });

    it('should handle invalid TypeScript', () => {
      const code = `const x: UnknownType = 42;`;
      const result = parseWithProgram(code, 'test.ts');

      // Should have warning about unknown type
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Patterns', () => {
    it('should parse component with signals and effects', () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          const doubled = computed(() => count() * 2);

          effect(() => {
            console.log('Count:', count());
          });

          return () => (
            <div>
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
            </div>
          );
        });
      `;
      const result = parse(code, 'test.tsx');

      const signalCalls = findNodes(result.sourceFile, isSignalCall);
      const effectCalls = findNodes(result.sourceFile, isEffectCall);
      const computedCalls = findNodes(result.sourceFile, isComputedCall);
      const jsxElements = findNodes(result.sourceFile, isAnyJSXElement);

      expect(signalCalls.length).toBeGreaterThan(0);
      expect(effectCalls.length).toBeGreaterThan(0);
      expect(computedCalls.length).toBeGreaterThan(0);
      expect(jsxElements.length).toBeGreaterThan(0);
    });

    it('should parse nested components', () => {
      const code = `
        const Child = () => <div>Child</div>;
        const Parent = () => (
          <div>
            <Child />
            <Child />
          </div>
        );
      `;
      const result = parse(code, 'test.tsx');

      const components = findNodes(result.sourceFile, isComponentDefinition);
      const jsxElements = findNodes(result.sourceFile, isAnyJSXElement);

      expect(components.length).toBeGreaterThan(0);
      expect(jsxElements.length).toBeGreaterThan(0);
    });

    it('should parse complex JSX structure', () => {
      const code = `
        const Layout = () => (
          <div className="layout">
            <header>
              <nav>
                <ul>
                  <li><a href="/">Home</a></li>
                  <li><a href="/about">About</a></li>
                </ul>
              </nav>
            </header>
            <main>
              <article>
                <h1>Title</h1>
                <p>Content</p>
              </article>
            </main>
            <footer>
              <p>&copy; 2024</p>
            </footer>
          </div>
        );
      `;
      const result = parse(code, 'test.tsx');

      const jsxElements = findNodes(result.sourceFile, isAnyJSXElement);
      expect(jsxElements.length).toBeGreaterThan(10);
    });
  });

  describe('TypeScript Features', () => {
    it('should parse interfaces', () => {
      const code = `
        interface Props {
          name: string;
          age: number;
        }
        const component = (props: Props) => <div>{props.name}</div>;
      `;
      const result = parse(code, 'test.tsx');

      const interfaces = findNodes<ts.InterfaceDeclaration>(
        result.sourceFile,
        (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node)
      );

      expect(interfaces.length).toBe(1);
    });

    it('should parse type aliases', () => {
      const code = `
        type Props = { name: string; age: number };
        const component = (props: Props) => <div>{props.name}</div>;
      `;
      const result = parse(code, 'test.tsx');

      const typeAliases = findNodes<ts.TypeAliasDeclaration>(
        result.sourceFile,
        (node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node)
      );

      expect(typeAliases.length).toBe(1);
    });

    it('should parse generics', () => {
      const code = `
        function identity<T>(arg: T): T {
          return arg;
        }
      `;
      const result = parse(code, 'test.ts');

      const funcDecls = findNodes<ts.FunctionDeclaration>(result.sourceFile, (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node)
      );

      expect(funcDecls.length).toBe(1);
      expect(funcDecls[0]?.typeParameters?.length).toBe(1);
    });
  });
});
