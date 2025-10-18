# Meridian Documentation Tools Specification
# Structured Documentation & Knowledge Management System

**Version**: 1.0.0
**Creation Date**: October 18, 2025
**Status**: Design Specification
**Compatibility**: Meridian MCP Server v1.0.0+

**Language**: 🇬🇧 English | [🇷🇺 Русский](./documentation-tools-spec.md)

> **⚠️ IMPORTANT: Architecture Update**
>
> This specification describes Documentation Tools functionality (documentation generation, examples, tests, agent integration).
>
> For the complete system picture, **please review the [Global Architecture Specification](./global-architecture-spec-en.md)**, which describes:
> - Global two-tier architecture (global server + local MCP servers)
> - Cross-monorepo documentation
> - Movement-resistant ID system
> - Project Registry for all monorepos on the developer's machine
>
> **Documentation Tools** (this document) operates **on top of** Global Architecture and uses its capabilities for documentation generation and management.

---

## Table of Contents

1. [Overview and Philosophy](#overview-and-philosophy)
2. [Architectural Principles](#architectural-principles)
3. [Context7 Analysis](#context7-analysis)
4. [Global Documentation Catalog](#global-documentation-catalog)
5. [Documentation Generation System](#documentation-generation-system)
6. [Code Example Generation](#code-example-generation)
7. [Test Generation](#test-generation)
8. [Agent Integration](#agent-integration)
9. [Auto-Update System](#auto-update-system)
10. [MCP Tools Specification](#mcp-tools-specification)
11. [Data Structures](#data-structures)
12. [Implementation Plan](#implementation-plan)
13. [Compatibility with spec.md](#compatibility-with-specmd)

---

## Overview and Philosophy

### Related Specifications

- **[Core Specification](./spec-en.md)**: Base Meridian system (v2.0.0)
- **[Global Architecture](./global-architecture-spec-en.md)**: Multiple monorepo support (v2.0.0)
- **[Roadmap](./roadmap.md)**: Implementation status and planning
- **[INDEX](./INDEX.md)**: Complete specification index

### Vision

Meridian Strong Tools transforms Meridian from a code indexing system into a **comprehensive knowledge management system** with capabilities for:

1. **Automatic generation** of high-quality structured documentation
2. **Creating practical examples** based on type and signature analysis
3. **Generating tests** (unit/integration/e2e) for TypeScript and Rust projects
4. **Global catalog** of documentation for all projects in monorepo
5. **Cross-platform access** to documentation between projects
6. **Automatic updates** when code changes
7. **Agent architecture support** (architect, developer, tester)

### Differences from Context7

**Context7** is a **proxy server** to an external API (context7.com):
- Relays requests to centralized service
- Does not store documentation locally
- Does not generate content, only retrieves pre-made
- Depends on external infrastructure

**Meridian Strong Tools** is a **self-sufficient system**:
- Generates documentation from source code locally
- Stores all data in RocksDB
- Creates examples and tests based on code analysis
- Works completely offline
- Integrated with tree-sitter for deep analysis

### Target Audience

1. **AI agents** (Architect, Developer, Tester) - primary consumers
2. **Developers** - through Claude Code and other MCP clients
3. **CI/CD systems** - automatic documentation generation
4. **Quality systems** - documentation and test validation

---

## Architectural Principles

### 1. Local-First Architecture

All generation and storage happens locally:
```
Source Code → Tree-sitter AST → Analysis → Generation → RocksDB Storage
```

### 2. Multi-Language Support

**TypeScript**:
- Runtimes: Node.js 22+, Bun 1.2+, Deno 2.0+
- Test frameworks: Jest, Vitest, Bun Test, Deno Test
- E2E frameworks: Playwright, Puppeteer, Cypress
- Doc format: TSDoc/JSDoc

**Rust**:
- Build tool: Cargo
- Test types: unit tests, integration tests, doc tests, e2e tests
- Doc format: rustdoc

### 3. Quality Standards

All generated documentation must comply with:
- **TypeScript**: TSDoc/JSDoc standards, TypeScript ESLint rules
- **Rust**: rustdoc conventions, clippy documentation lints
- **Examples**: Compile and pass type checking
- **Tests**: Execute successfully (or marked as TODO)

### 4. Cross-Reference Graph

Documentation forms a knowledge graph:
```
Project A (Package) → Exports Interface I
  ↓
Project B (Package) → Imports Interface I → Uses in Function F
  ↓
Documentation → Cross-references both locations
```

### 5. Incremental Updates

When code changes:
1. Change detection through file watching
2. Incremental re-indexing of changed files only
3. Update cross-references
4. Invalidate documentation cache
5. Regenerate affected examples and tests

---

## Context7 Analysis

### Context7 Architecture

**Components**:
```typescript
// Two main functions
searchLibraries(query, clientIp?, apiKey?) → SearchResponse
fetchLibraryDocumentation(libraryId, {tokens, topic}, clientIp?, apiKey?) → string

// Data types
interface SearchResult {
  id: string;              // "/mongodb/docs"
  title: string;           // "MongoDB Node.js Driver"
  description: string;     // Brief description
  totalSnippets: number;   // Number of code examples
  trustScore: number;      // 0-10, authority
  versions: string[];      // Available versions
}
```

**MCP Tools**:
1. `resolve-library-id`: Search library → get ID
2. `get-library-docs`: Get documentation by ID

**Transport**:
- STDIO: for local use (Claude Code)
- HTTP/SSE: for remote server (multi-client)

**Authentication**:
- API keys (format: `ctx7sk*`)
- Header-based auth
- Client IP tracking for rate limiting

### Applicable Patterns for Meridian

✅ **Use**:
1. Two-step approach: resolve → fetch
2. Token-based chunking for large documents
3. Topic filtering for focused output
4. Error handling (404, 429, 401)
5. Metadata in SearchResult (scores, versions, counts)

❌ **Don't use**:
1. External API dependency
2. Centralized storage
3. Proxy architecture
4. Remote rate limiting (replace with local quotas)

### Adaptation for Meridian

```
Context7                          Meridian Strong Tools
───────────────────────────────────────────────────────────
External API (context7.com)   →   Local RocksDB storage
Search remote libraries       →   Query local projects
Fetch pre-generated docs      →   Generate docs from AST
Return plain text             →   Return structured data
No versioning                 →   Git-based versioning
No auto-update                →   File watching + re-index
```

---

## Global Documentation Catalog

> **📖 See also:** [Global Architecture Specification](./global-architecture-spec-en.md) for detailed description of global architecture, cross-monorepo documentation, and Project Registry.

### Concept

**In Strong Tools context:** Global catalog provides structured access to documentation for all projects.

**Two levels:**
1. **Within monorepo** - fast access to this monorepo's project documentation
2. **Cross-monorepo** - access to documentation from other monorepos (see [Global Architecture](./global-architecture-spec-en.md))

This section describes the **metadata structure** and **API for accessing documentation**, regardless of whether the project is local or external.

### Catalog Structure

```typescript
interface GlobalCatalog {
  projects: Map<string, ProjectMetadata>;
  crossReferences: Map<string, CrossReference[]>;
  lastUpdated: Date;
}

interface ProjectMetadata {
  id: string;                    // "@omnitron-dev/titan"
  name: string;                  // "Titan"
  type: "typescript" | "rust";
  runtime?: "node" | "bun" | "deno" | "browser";
  version: string;               // "1.0.0"
  path: string;                  // "packages/titan"

  // Documentation stats
  totalModules: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  totalTypes: number;

  // Quality metrics
  documentedSymbols: number;     // Symbols with documentation
  documentationCoverage: number; // 0-100%
  examplesCount: number;
  testsCount: number;

  // Cross-references
  dependencies: string[];        // IDs of other projects
  dependents: string[];          // Who depends on this project

  // Timestamps
  lastIndexed: Date;
  lastModified: Date;
}

interface CrossReference {
  sourceProject: string;         // "@omnitron-dev/titan"
  sourceSymbol: string;          // "Application"
  targetProject: string;         // "@omnitron-dev/common"
  targetSymbol: string;          // "Deferred"
  referenceType: "import" | "extends" | "implements" | "uses" | "calls";
  location: {
    file: string;
    line: number;
    column: number;
  };
}
```

### Storage Schema in RocksDB

> **📋 See also:** See [schemas/rocksdb-schema.md](./schemas/rocksdb-schema.md) for RocksDB schema details

```
Prefixes:
catalog:projects:{projectId} → ProjectMetadata (JSON)
catalog:xref:{sourceProject}:{targetProject} → CrossReference[] (JSON)
catalog:index:name:{projectName} → projectId
catalog:index:path:{projectPath} → projectId
catalog:metadata → GlobalCatalog metadata (JSON)

Examples:
catalog:projects:@omnitron-dev/titan → {...}
catalog:xref:@omnitron-dev/titan:@omnitron-dev/common → [...]
catalog:index:name:titan → "@omnitron-dev/titan"
catalog:index:path:packages/titan → "@omnitron-dev/titan"
```

### Project Indexing

**Automatic discovery**:
1. Scan workspace to find:
   - TypeScript: `package.json` with `name` field
   - Rust: `Cargo.toml` with `[package]` section
2. Extract metadata from manifests
3. Analyze dependency graph
4. Build cross-reference map

**Monorepo Support**:
- Detect workspace root (presence of `pnpm-workspace.yaml`, `lerna.json`, or workspace in `Cargo.toml`)
- Recursive scan of packages/apps directories
- Respect `.gitignore` and custom ignore patterns

---

## Documentation Generation System

### Code Analysis

**TypeScript AST Analysis**:
```typescript
// Extract information from tree-sitter AST
interface ExtractedSymbol {
  kind: "function" | "class" | "interface" | "type" | "variable" | "enum";
  name: string;
  location: SourceLocation;

  // Type information
  signature?: string;           // Full signature
  parameters?: Parameter[];
  returnType?: string;
  typeParameters?: string[];

  // Documentation
  jsDocComment?: string;        // Existing JSDoc
  visibility: "public" | "private" | "protected";
  isExported: boolean;

  // Relationships
  extends?: string[];
  implements?: string[];
  decorators?: string[];

  // Source
  sourceCode: string;           // Complete source code of symbol
}
```

**Rust AST Analysis**:
```rust
// Similar for Rust
struct ExtractedSymbol {
    kind: SymbolKind,              // Fn, Struct, Trait, Enum, etc.
    name: String,
    location: SourceLocation,

    // Type information
    signature: Option<String>,
    parameters: Vec<Parameter>,
    return_type: Option<String>,
    generics: Vec<String>,

    // Documentation
    doc_comment: Option<String>,   // Existing /// doc comment
    visibility: Visibility,        // pub, pub(crate), private

    // Traits
    traits: Vec<String>,           // implemented traits
    derives: Vec<String>,          // #[derive(...)]

    // Source
    source_code: String,
}
```

### Documentation Generation

**Process**:
1. **Extraction**: AST → ExtractedSymbol
2. **Analysis**: Analyze types, relationships, patterns
3. **Generation**: Create structured documentation
4. **Validation**: Check compliance with standards
5. **Enhancement**: Augment with examples and cross-links

**TypeScript Doc Generation**:
```typescript
/**
 * Generates a Deferred promise that can be resolved or rejected externally.
 *
 * @typeParam T - The type of value the promise will resolve to
 * @returns A Deferred object containing promise, resolve, and reject functions
 *
 * @example
 * Basic usage with timeout
 * ```typescript
 * import { defer } from '@omnitron-dev/common';
 *
 * const deferred = defer<string>();
 *
 * setTimeout(() => {
 *   deferred.resolve('Hello!');
 * }, 1000);
 *
 * const result = await deferred.promise; // 'Hello!' after 1 second
 * ```
 *
 * @example
 * Error handling
 * ```typescript
 * const deferred = defer<number>();
 * deferred.reject(new Error('Failed'));
 *
 * try {
 *   await deferred.promise;
 * } catch (error) {
 *   console.error(error.message); // 'Failed'
 * }
 * ```
 *
 * @see {@link Deferred} for the return type interface
 * @see {@link delay} for simple promise delays
 *
 * @category Promise Utilities
 * @since 1.0.0
 */
export function defer<T>(): Deferred<T>
```

**Rust Doc Generation**:
```rust
/// Creates a new HTTP client with the specified configuration.
///
/// # Arguments
///
/// * `config` - Client configuration including timeout, proxy settings
///
/// # Returns
///
/// A configured `HttpClient` instance ready to make requests
///
/// # Examples
///
/// Basic usage:
/// ```rust
/// use mylib::HttpClient;
///
/// let client = HttpClient::new(Default::default());
/// let response = client.get("https://example.com").await?;
/// ```
///
/// With custom timeout:
/// ```rust
/// use mylib::{HttpClient, Config};
/// use std::time::Duration;
///
/// let config = Config {
///     timeout: Duration::from_secs(30),
///     ..Default::default()
/// };
/// let client = HttpClient::new(config);
/// ```
///
/// # Errors
///
/// Returns `Error::InvalidConfig` if configuration is invalid
///
/// # Panics
///
/// This function does not panic
///
/// # Safety
///
/// This function is safe to call from any context
///
/// # See Also
///
/// * [`Config`] - Configuration options
/// * [`Response`] - HTTP response type
pub fn new(config: Config) -> Result<Self, Error>
```

### Quality Validation

**Quality criteria**:
1. **Completeness**:
   - Description present
   - Parameters documented
   - Return value documented
   - Errors/Exceptions documented
   - Examples provided

2. **Clarity**:
   - Description starts with verb (TypeScript) or noun phrase (Rust)
   - Specific details, not generic phrases
   - Correct grammar and punctuation

3. **Accuracy**:
   - Type information matches signature
   - Examples compile
   - Cross-references correct

4. **Standards Compliance**:
   - TypeScript: TSDoc tags (@param, @returns, @example, etc.)
   - Rust: rustdoc sections (# Arguments, # Examples, # Errors, etc.)

**Scoring System**:
```typescript
interface DocumentationQuality {
  score: number;              // 0-100
  completeness: number;       // 0-100
  clarity: number;            // 0-100
  accuracy: number;           // 0-100
  compliance: number;         // 0-100

  issues: QualityIssue[];
  suggestions: string[];
}

interface QualityIssue {
  severity: "error" | "warning" | "info";
  category: "completeness" | "clarity" | "accuracy" | "compliance";
  message: string;
  location?: SourceLocation;
  suggestion?: string;
}
```

### Documentation Transformation

**Goal**: Transform existing unstructured documentation into standardized format.

**Process**:
1. **Parse existing docs**: Extract current documentation
2. **Analyze content**: Identify description, parameters, examples
3. **Restructure**: Distribute into standard sections
4. **Enhance**: Add missing elements
5. **Validate**: Check quality

**Example Transformation**:
```typescript
// BEFORE (unstructured)
/**
 * Creates a deferred promise. You can resolve it later.
 */
export function defer<T>(): Deferred<T>

// AFTER (structured, enhanced)
/**
 * Generates a Deferred promise that can be resolved or rejected externally.
 *
 * Unlike a standard Promise constructor, this allows you to control resolution
 * timing from outside the promise initialization, useful for event-driven
 * or callback-based APIs.
 *
 * @typeParam T - The type of value the promise will resolve to
 * @returns A Deferred object containing:
 *   - `promise`: The Promise instance
 *   - `resolve`: Function to resolve the promise with a value
 *   - `reject`: Function to reject the promise with an error
 *
 * @example
 * Basic deferred resolution
 * ```typescript
 * import { defer } from '@omnitron-dev/common';
 *
 * const deferred = defer<string>();
 *
 * // Resolve after some async operation
 * fetchData().then(data => deferred.resolve(data));
 *
 * // Wait for resolution
 * const result = await deferred.promise;
 * ```
 *
 * @category Promise Utilities
 * @since 1.0.0
 */
export function defer<T>(): Deferred<T>
```

---

## Code Example Generation

### Signature Analysis

**TypeScript Example Generation**:
```typescript
interface ExampleGenerationInput {
  symbol: ExtractedSymbol;
  imports: ImportInfo[];
  types: TypeInfo[];
  relatedSymbols: ExtractedSymbol[];
}

interface GeneratedExample {
  title: string;                    // "Basic usage"
  description?: string;              // Optional context
  code: string;                      // Executable code
  language: "typescript" | "rust";

  // Validation
  compiles: boolean;                 // Can it compile?
  typeChecks: boolean;               // Type-safe?
  runnable: boolean;                 // Can be executed?

  // Metadata
  complexity: "basic" | "intermediate" | "advanced";
  runtime?: "node" | "bun" | "deno" | "browser";
  dependencies: string[];            // Required imports
}
```

**Generation Strategy**:

1. **Basic Example** (always generated):
   - Minimal code to demonstrate main use case
   - All necessary imports
   - Type-safe usage
   - Expected output in comments

2. **Advanced Examples** (optional):
   - Error handling
   - Edge cases
   - Complex scenarios
   - Integration patterns

**TypeScript Example Templates**:

```typescript
// For simple functions
import { functionName } from 'package-name';

const result = functionName(arg1, arg2);
console.log(result); // Expected output

// For classes
import { ClassName } from 'package-name';

const instance = new ClassName(config);
await instance.method();

// For async functions
import { asyncFunction } from 'package-name';

try {
  const result = await asyncFunction(input);
  console.log('Success:', result);
} catch (error) {
  console.error('Error:', error);
}

// For React/UI components (if applicable)
import { Component } from 'package-name';

function App() {
  return (
    <Component
      prop1="value"
      prop2={42}
      onEvent={(data) => console.log(data)}
    />
  );
}
```

**Rust Example Templates**:

```rust
// For simple functions
use crate_name::function_name;

fn main() {
    let result = function_name(arg1, arg2);
    println!("{:?}", result); // Expected output
}

// For structs and methods
use crate_name::StructName;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let instance = StructName::new(config);
    let result = instance.method()?;
    Ok(())
}

// For async functions (tokio)
use crate_name::async_function;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let result = async_function(input).await?;
    println!("Success: {:?}", result);
    Ok(())
}

// For traits
use crate_name::MyTrait;

struct MyType;

impl MyTrait for MyType {
    fn method(&self) -> ReturnType {
        // Implementation
    }
}
```

### Context-Aware Generation

**Type-Based Example Creation**:
```typescript
// Analyze function signature
function defer<T>(): Deferred<T>

// Determine:
// - Generic type T → provide concrete example (T = string)
// - Return type Deferred<T> → show how to use promise, resolve, reject
// - No parameters → simple invocation

// Generate example:
const deferred = defer<string>();
setTimeout(() => deferred.resolve('Done'), 1000);
const result = await deferred.promise;
```

**Dependency Analysis**:
- Detect required imports from usage
- Include transitive type imports
- Handle re-exports correctly
- Minimize import footprint

**Runtime Detection**:
- Node.js: use node: protocol for built-ins
- Bun: can use both node: and bun: APIs
- Deno: use https://deno.land/ imports or npm: specifier
- Browser: use DOM APIs, no Node APIs

---

## Test Generation

### TypeScript Test Generation

**Supported Frameworks**:
1. **Jest** (Node.js default)
2. **Vitest** (Modern alternative)
3. **Bun Test** (Native Bun testing)
4. **Deno Test** (Native Deno testing)

**Test Types**:

```typescript
interface TestGenerationInput {
  symbol: ExtractedSymbol;
  testType: "unit" | "integration" | "e2e";
  framework: "jest" | "vitest" | "bun" | "deno";
  runtime: "node" | "bun" | "deno" | "browser";
}

interface GeneratedTest {
  filePath: string;              // "src/__tests__/defer.test.ts"
  framework: string;
  content: string;               // Full test file content

  // Test coverage
  totalTests: number;
  scenarios: TestScenario[];

  // Validation
  compiles: boolean;
  passes: boolean;               // Does it pass when executed?
  coverage?: number;             // Code coverage %
}

interface TestScenario {
  description: string;           // "should resolve with value"
  type: "success" | "error" | "edge-case";
  code: string;
}
```

**Unit Test Template (Jest/Vitest)**:

```typescript
import { describe, it, expect } from '@jest/globals'; // or 'vitest'
import { functionName } from '../function-name';

describe('functionName', () => {
  it('should handle basic case', () => {
    const result = functionName(input);
    expect(result).toBe(expectedOutput);
  });

  it('should handle edge case', () => {
    const result = functionName(edgeInput);
    expect(result).toBe(edgeOutput);
  });

  it('should throw error for invalid input', () => {
    expect(() => functionName(invalidInput)).toThrow(ErrorType);
  });
});

describe('asyncFunction', () => {
  it('should resolve with value', async () => {
    const result = await asyncFunction(input);
    expect(result).toEqual(expectedValue);
  });

  it('should reject with error', async () => {
    await expect(asyncFunction(badInput)).rejects.toThrow(ErrorType);
  });
});
```

**Integration Test Template**:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Application } from '@omnitron-dev/titan';
import { MyModule } from '../my-module';

describe('MyModule Integration', () => {
  let app: Application;

  beforeAll(async () => {
    app = await Application.create(MyModule);
    await app.start();
  });

  afterAll(async () => {
    await app.stop();
  });

  it('should integrate with other modules', async () => {
    const service = app.get(MyService);
    const result = await service.doSomething();
    expect(result).toBeDefined();
  });
});
```

**E2E Test Template (Playwright)**:

```typescript
import { test, expect } from '@playwright/test';

test.describe('User Flow', () => {
  test('should complete user registration', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.fill('#email', 'user@example.com');
    await page.fill('#password', 'secure-password');
    await page.click('button[type="submit"]');

    await expect(page.locator('.success-message')).toBeVisible();
  });
});
```

### Rust Test Generation

**Test Types**:

1. **Unit Tests** (in-module `#[cfg(test)]`)
2. **Integration Tests** (`tests/` directory)
3. **Doc Tests** (in `///` comments)
4. **Bench Tests** (`benches/` directory)

**Unit Test Template**:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        let result = function_name(input);
        assert_eq!(result, expected_output);
    }

    #[test]
    fn test_error_handling() {
        let result = function_name(invalid_input);
        assert!(result.is_err());
    }

    #[test]
    #[should_panic(expected = "error message")]
    fn test_panic_case() {
        function_that_panics(bad_input);
    }
}
```

**Integration Test Template**:

```rust
// tests/integration_test.rs
use my_crate::{ModuleA, ModuleB};

#[test]
fn test_modules_integration() {
    let module_a = ModuleA::new();
    let module_b = ModuleB::new();

    let result = module_a.process(module_b.data());
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_async_integration() {
    let service = Service::connect("localhost:8080").await.unwrap();
    let response = service.request().await.unwrap();
    assert_eq!(response.status, 200);
}
```

**Doc Test (automatically extracted)**:

```rust
/// Calculates the sum of two numbers.
///
/// # Examples
///
/// ```
/// use my_crate::add;
///
/// let result = add(2, 3);
/// assert_eq!(result, 5);
/// ```
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

### Test Generation Strategy

**Code analysis to determine test cases**:

1. **Function signature analysis**:
   - Parameters → test different input combinations
   - Return type → verify expected outputs
   - Generic types → test with multiple concrete types
   - Option/Result → test Some/None, Ok/Err cases

2. **Branch coverage**:
   - if/else branches → test both paths
   - match arms → test each pattern
   - loops → test empty, single, multiple iterations

3. **Error paths**:
   - Functions returning Result → test error cases
   - Functions with panic! → test panic scenarios
   - Validation logic → test invalid inputs

4. **Edge cases**:
   - Boundary values (0, -1, MAX, MIN)
   - Empty collections
   - null/undefined/None values
   - Concurrent access (for async code)

---

## Agent Integration

### Agent Architecture

**Specialized agents** (defined in `.claude/agents/`):

1. **Architect Agent** - creates specifications and architectural solutions
2. **Developer Agent** - implements functionality according to specifications
3. **Tester Agent** - writes documentation, examples, and tests

### Architect Agent Tools

**Goal**: Creating structured specifications for development.

**MCP Tool: `architect.create_specification`**

```typescript
{
  name: "architect.create_specification",
  description: "Creates a structured specification document for a feature or module",
  inputSchema: {
    title: string;                    // "User Authentication Module"
    scope: string;                     // "backend" | "frontend" | "fullstack"
    requirements: string[];            // List of functional requirements
    technicalContext: {
      language: "typescript" | "rust";
      framework?: string;              // "titan", "aether", etc.
      dependencies?: string[];         // Required packages
    };
    constraints?: string[];            // Technical/business constraints
  },
  output: {
    specificationId: string;
    filePath: string;                  // Where spec was saved
    sections: {
      overview: string;
      architecture: string;
      apiDesign: string;               // Function signatures, interfaces
      dataModels: string;              // Types, structs, schemas
      errorHandling: string;
      testing: string;                 // Test strategy
      implementation: string;          // Step-by-step plan
    };
    estimatedComplexity: "low" | "medium" | "high";
    suggestedTests: string[];          // Test scenarios to implement
  }
}
```

**Specification Format**:

```markdown
# Specification: [Title]

**ID**: spec-[uuid]
**Created**: [timestamp]
**Scope**: [backend/frontend/fullstack]
**Language**: [TypeScript/Rust]
**Status**: draft

## Overview

[High-level description of what needs to be built]

## Requirements

### Functional Requirements
1. [Requirement 1]
2. [Requirement 2]

### Non-Functional Requirements
1. [Performance, security, etc.]

## Architecture

### Components
- Component A: [description]
- Component B: [description]

### Data Flow
```
[ASCII diagram or description]
```

## API Design

### TypeScript Interfaces
```typescript
interface UserAuth {
  login(email: string, password: string): Promise<AuthToken>;
  logout(token: string): Promise<void>;
  verify(token: string): Promise<User>;
}
```

### Rust Traits
```rust
trait UserAuth {
    async fn login(email: &str, password: &str) -> Result<AuthToken, AuthError>;
    async fn logout(token: &str) -> Result<(), AuthError>;
}
```

## Error Handling

### Error Types
```typescript
enum AuthError {
  InvalidCredentials,
  TokenExpired,
  RateLimitExceeded,
}
```

## Testing Strategy

### Unit Tests
- Test login with valid credentials
- Test login with invalid credentials
- Test token expiration

### Integration Tests
- Test full authentication flow
- Test with database

### E2E Tests
- Test UI login flow (if frontend)

## Implementation Plan

1. **Phase 1**: Data models and types
2. **Phase 2**: Core authentication logic
3. **Phase 3**: Token management
4. **Phase 4**: Error handling
5. **Phase 5**: Testing
6. **Phase 6**: Documentation

## Dependencies

- @omnitron-dev/common
- jsonwebtoken
- bcrypt

## Estimated Effort

- Complexity: Medium
- Estimated time: 4-6 hours
```

**MCP Tool: `architect.validate_implementation`**

```typescript
{
  name: "architect.validate_implementation",
  description: "Validates that implementation matches specification",
  inputSchema: {
    specificationId: string;
    implementationPath: string;        // Path to implemented code
  },
  output: {
    isValid: boolean;
    compliance: number;                // 0-100%
    missingFeatures: string[];
    deviations: {
      section: string;
      expected: string;
      actual: string;
      severity: "critical" | "major" | "minor";
    }[];
    recommendations: string[];
  }
}
```

### Developer Agent Tools

**Goal**: Implementing functionality according to specifications.

**MCP Tool: `developer.get_implementation_context`**

```typescript
{
  name: "developer.get_implementation_context",
  description: "Retrieves all context needed to implement a specification",
  inputSchema: {
    specificationId: string;
  },
  output: {
    specification: SpecificationDocument;
    relatedCode: {
      interfaces: ExtractedSymbol[];   // Existing interfaces to implement
      examples: GeneratedExample[];    // Similar implementations
      dependencies: ProjectMetadata[]; // Required packages
    };
    scaffolding: {
      files: {
        path: string;
        content: string;               // Pre-generated template
      }[];
    };
    checklist: string[];               // Implementation checklist
  }
}
```

**MCP Tool: `developer.generate_boilerplate`**

```typescript
{
  name: "developer.generate_boilerplate",
  description: "Generates boilerplate code from specification",
  inputSchema: {
    specificationId: string;
    language: "typescript" | "rust";
    style: "class" | "functional" | "trait";
  },
  output: {
    files: {
      path: string;
      content: string;
    }[];
    nextSteps: string[];
  }
}
```

### Tester Agent Tools

**Goal**: Creating documentation, examples, and tests.

**MCP Tool: `tester.generate_comprehensive_tests`**

```typescript
{
  name: "tester.generate_comprehensive_tests",
  description: "Generates complete test suite for a symbol or module",
  inputSchema: {
    targetPath: string;                // File or directory to test
    testTypes: ("unit" | "integration" | "e2e")[];
    framework: "jest" | "vitest" | "bun" | "deno" | "cargo";
    coverageTarget?: number;           // Desired coverage % (default: 80)
  },
  output: {
    tests: GeneratedTest[];
    coverage: {
      lines: number;
      branches: number;
      functions: number;
      statements: number;
    };
    recommendations: string[];
  }
}
```

**MCP Tool: `tester.validate_examples`**

```typescript
{
  name: "tester.validate_examples",
  description: "Validates that all code examples compile and run",
  inputSchema: {
    documentationPath: string;         // Path to doc file or symbol
  },
  output: {
    totalExamples: number;
    validExamples: number;
    invalidExamples: {
      exampleCode: string;
      error: string;
      suggestion: string;
    }[];
    coverage: number;                  // % of symbols with valid examples
  }
}
```

**MCP Tool: `tester.enhance_documentation`**

```typescript
{
  name: "tester.enhance_documentation",
  description: "Enhances existing documentation with examples and better descriptions",
  inputSchema: {
    symbolPath: string;                // Path to symbol (file:line:column)
    addExamples: boolean;
    improveDescription: boolean;
    addCrossReferences: boolean;
  },
  output: {
    originalDoc: string;
    enhancedDoc: string;
    changes: {
      type: "added_example" | "improved_description" | "added_xref";
      content: string;
    }[];
    qualityScore: {
      before: number;
      after: number;
    };
  }
}
```

### Agent Workflow Example

**Scenario: Creating a new module**

```mermaid
sequenceDiagram
    participant User
    participant Architect
    participant Developer
    participant Tester
    participant Meridian

    User->>Architect: Create auth module
    Architect->>Meridian: architect.create_specification
    Meridian-->>Architect: spec-uuid-123
    Architect-->>User: Specification created

    User->>Developer: Implement spec-uuid-123
    Developer->>Meridian: developer.get_implementation_context
    Meridian-->>Developer: Context + scaffolding
    Developer->>Developer: Implement code
    Developer->>Meridian: Write files

    User->>Tester: Document and test auth module
    Tester->>Meridian: tester.generate_comprehensive_tests
    Meridian-->>Tester: Test suite
    Tester->>Meridian: tester.enhance_documentation
    Meridian-->>Tester: Enhanced docs
    Tester-->>User: Tests and docs ready

    User->>Architect: Validate implementation
    Architect->>Meridian: architect.validate_implementation
    Meridian-->>Architect: Compliance report
    Architect-->>User: ✓ Spec compliance: 98%
```

---

## Auto-Update System

### File Watching

**Mechanism**:
```typescript
import { watch } from 'fs/promises';

interface FileWatcher {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: 'change' | 'add' | 'delete', handler: FileChangeHandler): void;
}

interface FileChangeEvent {
  type: 'change' | 'add' | 'delete';
  path: string;
  timestamp: Date;
  affectedProjects: string[];          // Projects that contain this file
}

type FileChangeHandler = (event: FileChangeEvent) => Promise<void>;
```

**Watch Strategy**:
1. **Project-Level Watching**:
   - Watch all indexed projects
   - Respect `.gitignore` patterns
   - Ignore `node_modules/`, `target/`, `dist/`
   - Watch source files only (`.ts`, `.tsx`, `.rs`)

2. **Debouncing**:
   - Buffer changes for 500ms
   - Batch multiple changes to same file
   - Aggregate changes across files for bulk re-index

### Incremental Re-Indexing

**Process**:

```typescript
async function handleFileChange(event: FileChangeEvent) {
  // 1. Determine what needs re-indexing
  const affectedSymbols = await findAffectedSymbols(event.path);

  // 2. Re-parse changed file
  const newAST = await parseFile(event.path);
  const newSymbols = await extractSymbols(newAST);

  // 3. Compute diff
  const diff = computeSymbolDiff(affectedSymbols, newSymbols);

  // 4. Update RocksDB
  await updateSymbols(diff.added);
  await updateSymbols(diff.modified);
  await deleteSymbols(diff.removed);

  // 5. Update cross-references
  await updateCrossReferences(event.path, newSymbols);

  // 6. Invalidate affected documentation cache
  await invalidateDocCache(affectedSymbols);

  // 7. Re-generate affected examples and tests (optional, can be lazy)
  if (shouldRegenerateExamples(diff)) {
    await regenerateExamples(affectedSymbols);
  }
}
```

**Diff Algorithm**:

```typescript
interface SymbolDiff {
  added: ExtractedSymbol[];            // New symbols
  modified: {
    old: ExtractedSymbol;
    new: ExtractedSymbol;
    changes: SymbolChange[];
  }[];
  removed: ExtractedSymbol[];          // Deleted symbols
  unchanged: ExtractedSymbol[];        // No changes
}

interface SymbolChange {
  field: "signature" | "documentation" | "visibility" | "source";
  oldValue: any;
  newValue: any;
}

function computeSymbolDiff(
  oldSymbols: ExtractedSymbol[],
  newSymbols: ExtractedSymbol[]
): SymbolDiff {
  // Match symbols by name and location
  // Compare signatures, docs, etc.
  // Return structured diff
}
```

### Cross-Reference Updates

**Challenge**: When a symbol changes, all references to it need updating.

**Solution**:

```typescript
// 1. Find all cross-references TO this symbol
const incomingRefs = await findIncomingReferences(symbolId);

// 2. For each reference, check if it's still valid
for (const ref of incomingRefs) {
  const isStillValid = await validateReference(ref, newSymbol);
  if (!isStillValid) {
    await markReferenceStale(ref);
    // Optionally: notify dependent projects
  }
}

// 3. Find all cross-references FROM this file
const outgoingRefs = await extractReferences(newAST);

// 4. Update outgoing reference index
await updateReferenceIndex(filePath, outgoingRefs);
```

**Stale Reference Handling**:
- Mark as stale but don't delete immediately
- Background task to clean up stale refs after grace period
- Provide warnings in tools when using stale references

### Cache Invalidation

**Multi-Level Caching**:

```typescript
interface CacheManager {
  // L1: In-memory cache (LRU)
  memoryCache: LRUCache<string, CachedItem>;

  // L2: RocksDB cache (persistent)
  diskCache: RocksDB;

  // Invalidation
  invalidate(key: string): Promise<void>;
  invalidatePattern(pattern: string): Promise<void>;
  invalidateProject(projectId: string): Promise<void>;
}

// Cache keys:
// doc:{projectId}:{symbolId} → Generated documentation
// examples:{symbolId} → Generated examples
// tests:{symbolId} → Generated tests
// xref:{symbolId}:incoming → Incoming cross-references
// xref:{symbolId}:outgoing → Outgoing cross-references
```

**Invalidation Strategy**:

1. **On Symbol Change**:
   ```typescript
   await cache.invalidate(`doc:${projectId}:${symbolId}`);
   await cache.invalidate(`examples:${symbolId}`);
   await cache.invalidate(`tests:${symbolId}`);
   ```

2. **On Project Re-Index**:
   ```typescript
   await cache.invalidateProject(projectId);
   ```

3. **On Cross-Reference Change**:
   ```typescript
   await cache.invalidatePattern(`xref:${symbolId}:*`);
   ```

### Lazy Regeneration

**Strategy**: Don't regenerate everything immediately, do it on-demand.

```typescript
async function getDocumentation(symbolId: string): Promise<string> {
  // 1. Check cache
  const cached = await cache.get(`doc:${symbolId}`);
  if (cached && !cached.isStale) {
    return cached.value;
  }

  // 2. Cache miss or stale → regenerate
  const symbol = await getSymbol(symbolId);
  const doc = await generateDocumentation(symbol);

  // 3. Store in cache
  await cache.set(`doc:${symbolId}`, doc, { ttl: 3600 });

  return doc;
}
```

**Benefits**:
- Lower latency for file changes (don't regenerate everything)
- Regenerate only what's actually used
- Spread load over time

---

## MCP Tools Specification

> **📋 See also:** See [schemas/mcp-tools-catalog.md](./schemas/mcp-tools-catalog.md) for complete MCP tools catalog

### Global Catalog Tools

#### `catalog.list_projects`

**Description**: Returns list of all projects in global catalog.

**Input**: None

**Output**:
```typescript
{
  projects: ProjectMetadata[];
  totalProjects: number;
  totalDocumented: number;           // Projects with docs
  averageCoverage: number;           // Average doc coverage %
  lastUpdated: Date;
}
```

**Example**:
```json
{
  "projects": [
    {
      "id": "@omnitron-dev/titan",
      "name": "Titan",
      "type": "typescript",
      "runtime": "node",
      "version": "1.0.0",
      "documentationCoverage": 85.5,
      "lastIndexed": "2025-10-18T10:30:00Z"
    }
  ],
  "totalProjects": 12,
  "totalDocumented": 10,
  "averageCoverage": 72.3
}
```

---

#### `catalog.get_project`

**Description**: Gets detailed information about a project.

**Input**:
```typescript
{
  projectId: string;                 // "@omnitron-dev/titan" or "packages/titan"
}
```

**Output**:
```typescript
{
  project: ProjectMetadata;
  modules: {
    name: string;
    path: string;
    exports: number;
    documented: number;
  }[];
  dependencies: ProjectMetadata[];   // Resolved dependencies
  dependents: ProjectMetadata[];     // Projects depending on this
  recentChanges: {
    file: string;
    timestamp: Date;
    changeType: "added" | "modified" | "deleted";
  }[];
}
```

---

#### `catalog.search_documentation`

**Description**: Search documentation across all projects.

**Input**:
```typescript
{
  query: string;                     // Search query
  projectId?: string;                // Filter by project
  symbolType?: "function" | "class" | "interface" | "type";
  minQuality?: number;               // Minimum quality score (0-100)
  limit?: number;                    // Max results (default: 20)
}
```

**Output**:
```typescript
{
  results: {
    symbolId: string;
    projectId: string;
    name: string;
    type: "function" | "class" | "interface" | "type";
    documentation: string;           // First paragraph
    qualityScore: number;
    location: SourceLocation;
    relevance: number;               // Search relevance score
  }[];
  totalResults: number;
}
```

---

### Documentation Generation Tools

#### `docs.generate`

**Description**: Generates documentation for a symbol or file.

**Input**:
```typescript
{
  targetPath: string;                // File path or "file:line:col"
  symbolName?: string;               // Specific symbol in file
  format: "tsdoc" | "jsdoc" | "rustdoc";
  includeExamples: boolean;          // Add examples
  enhanceExisting: boolean;          // Improve existing docs
}
```

**Output**:
```typescript
{
  documentation: string;             // Generated doc comment
  quality: DocumentationQuality;
  examples: GeneratedExample[];
  changes: {
    type: "created" | "enhanced";
    before?: string;
    after: string;
  };
}
```

---

#### `docs.validate`

**Description**: Validates documentation quality.

**Input**:
```typescript
{
  targetPath: string;                // File or symbol path
  standards: "strict" | "recommended" | "minimal";
}
```

**Output**:
```typescript
{
  overallScore: number;              // 0-100
  symbolScores: {
    symbolId: string;
    score: number;
    issues: QualityIssue[];
    suggestions: string[];
  }[];
  compliance: {
    standard: string;
    percentage: number;
  };
}
```

---

#### `docs.transform`

**Description**: Transforms unstructured documentation into standardized format.

**Input**:
```typescript
{
  targetPath: string;
  targetFormat: "tsdoc" | "jsdoc" | "rustdoc";
  preserveCustomSections: boolean;   // Keep non-standard sections
}
```

**Output**:
```typescript
{
  transformedDocs: {
    symbolId: string;
    before: string;
    after: string;
    improvements: string[];
  }[];
  totalTransformed: number;
  qualityImprovement: number;        // Delta in quality score
}
```

---

### Example Generation Tools

#### `examples.generate`

**Description**: Generates code examples for a symbol.

**Input**:
```typescript
{
  symbolPath: string;                // Path to symbol
  exampleTypes: ("basic" | "advanced" | "error-handling" | "async")[];
  runtime?: "node" | "bun" | "deno" | "browser";
  validate: boolean;                 // Compile/type-check examples
}
```

**Output**:
```typescript
{
  examples: GeneratedExample[];
  validation: {
    totalExamples: number;
    validExamples: number;
    errors: {
      exampleCode: string;
      error: string;
    }[];
  };
}
```

---

#### `examples.validate`

**Description**: Validates existing examples (compilation, type-checking).

**Input**:
```typescript
{
  documentationPath: string;         // Path to file with examples
  runtime?: "node" | "bun" | "deno";
}
```

**Output**:
```typescript
{
  totalExamples: number;
  validExamples: number;
  invalidExamples: {
    location: SourceLocation;
    code: string;
    error: string;
    suggestion?: string;
  }[];
  coverage: number;                  // % of symbols with valid examples
}
```

---

### Test Generation Tools

#### `tests.generate`

**Description**: Generates tests for a symbol or module.

**Input**:
```typescript
{
  targetPath: string;                // File or directory
  testTypes: ("unit" | "integration" | "e2e")[];
  framework: "jest" | "vitest" | "bun" | "deno" | "cargo";
  coverageTarget?: number;           // Desired coverage % (default: 80)
  includeEdgeCases: boolean;
}
```

**Output**:
```typescript
{
  tests: GeneratedTest[];
  estimatedCoverage: number;
  recommendations: string[];         // Additional test scenarios
}
```

---

#### `tests.validate`

**Description**: Runs generated tests and validates results.

**Input**:
```typescript
{
  testPath: string;                  // Path to test file
  framework: "jest" | "vitest" | "bun" | "deno" | "cargo";
}
```

**Output**:
```typescript
{
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: {
    name: string;
    error: string;
    stack?: string;
  }[];
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
  };
  duration: number;                  // Test run time in ms
}
```

---

### Agent Tools

#### `strong.architect.create_specification`

(Described in [Architect Agent Tools](#architect-agent-tools) section)

---

#### `strong.architect.validate_implementation`

(Described in [Architect Agent Tools](#architect-agent-tools) section)

---

#### `strong.developer.get_implementation_context`

(Described in [Developer Agent Tools](#developer-agent-tools) section)

---

#### `strong.developer.generate_boilerplate`

(Described in [Developer Agent Tools](#developer-agent-tools) section)

---

#### `strong.tester.generate_comprehensive_tests`

(Described in [Tester Agent Tools](#tester-agent-tools) section)

---

#### `strong.tester.validate_examples`

(Described in [Tester Agent Tools](#tester-agent-tools) section)

---

#### `strong.tester.enhance_documentation`

(Described in [Tester Agent Tools](#tester-agent-tools) section)

---

### Cross-Project Tools

#### `strong.xref.find_usages`

**Description**: Finds all usages of a symbol across all projects.

**Input**:
```typescript
{
  symbolId: string;                  // Symbol to find usages of
  includeTests: boolean;             // Include test files
  includeExamples: boolean;          // Include example code
}
```

**Output**:
```typescript
{
  totalUsages: number;
  usages: {
    projectId: string;
    file: string;
    line: number;
    column: number;
    context: string;                 // Surrounding code
    usageType: "import" | "call" | "extend" | "implement";
  }[];
  dependentProjects: string[];       // Projects that depend on this symbol
}
```

---

#### `strong.xref.get_dependency_graph`

**Description**: Returns dependency graph for a project or symbol.

**Input**:
```typescript
{
  targetId: string;                  // Project ID or symbol ID
  depth?: number;                    // Max depth (default: 3)
  direction: "incoming" | "outgoing" | "both";
}
```

**Output**:
```typescript
{
  graph: {
    nodes: {
      id: string;
      type: "project" | "module" | "symbol";
      label: string;
    }[];
    edges: {
      from: string;
      to: string;
      type: "depends" | "imports" | "uses";
    }[];
  };
  visualization: string;             // Mermaid diagram
}
```

---

### Auto-Update Tools

#### `strong.watch.start`

**Description**: Starts file watching for a project.

**Input**:
```typescript
{
  projectId?: string;                // Watch specific project (or all)
  autoReindex: boolean;              // Auto re-index on changes
  autoRegenerate: boolean;           // Auto regenerate docs/examples
}
```

**Output**:
```typescript
{
  watchId: string;
  watching: string[];                // Paths being watched
  status: "active";
}
```

---

#### `strong.watch.stop`

**Description**: Stops file watching.

**Input**:
```typescript
{
  watchId: string;
}
```

**Output**:
```typescript
{
  stopped: boolean;
  statistics: {
    filesWatched: number;
    changesDetected: number;
    reindexCount: number;
  };
}
```

---

#### `strong.watch.status`

**Description**: Gets file watching status.

**Input**: None

**Output**:
```typescript
{
  active: boolean;
  watchers: {
    watchId: string;
    projectId?: string;
    startedAt: Date;
    changesDetected: number;
  }[];
}
```

---

## Data Structures

> **📋 See also:** See [schemas/type-definitions.md](./schemas/type-definitions.md) for type definitions

### RocksDB Schema

> **📋 See also:** See [schemas/rocksdb-schema.md](./schemas/rocksdb-schema.md) for RocksDB schema details

**Prefixes Summary**:

```
# Global Catalog
catalog:projects:{projectId}              → ProjectMetadata
catalog:xref:{sourceProject}:{targetProject} → CrossReference[]
catalog:index:name:{projectName}          → projectId
catalog:index:path:{projectPath}          → projectId
catalog:metadata                          → GlobalCatalog

# Documentation
docs:{projectId}:{symbolId}               → GeneratedDocumentation
docs:quality:{symbolId}                   → DocumentationQuality
docs:cache:{symbolId}                     → CachedDocumentation

# Examples
examples:{symbolId}                       → GeneratedExample[]
examples:validation:{symbolId}            → ExampleValidation

# Tests
tests:{symbolId}                          → GeneratedTest[]
tests:validation:{symbolId}               → TestValidation

# Cross-References (extended)
xref:{symbolId}:incoming                  → IncomingReference[]
xref:{symbolId}:outgoing                  → OutgoingReference[]
xref:stale:{symbolId}                     → StaleReference[]

# Specifications (for Architect Agent)
spec:{specId}                             → SpecificationDocument
spec:index:project:{projectId}            → specId[]
spec:validation:{specId}                  → ValidationReport

# Watch State
watch:active                              → WatchState
watch:changes:{projectId}                 → FileChange[]
```

### TypeScript Type Definitions

**Full type definitions** (for use in code):

```typescript
// meridian/src/strong-tools/types.ts

export interface ProjectMetadata {
  id: string;
  name: string;
  type: "typescript" | "rust";
  runtime?: "node" | "bun" | "deno" | "browser";
  version: string;
  path: string;

  totalModules: number;
  totalFunctions: number;
  totalClasses: number;
  totalInterfaces: number;
  totalTypes: number;

  documentedSymbols: number;
  documentationCoverage: number;
  examplesCount: number;
  testsCount: number;

  dependencies: string[];
  dependents: string[];

  lastIndexed: Date;
  lastModified: Date;
}

export interface ExtractedSymbol {
  kind: SymbolKind;
  name: string;
  location: SourceLocation;
  signature?: string;
  parameters?: Parameter[];
  returnType?: string;
  typeParameters?: string[];
  jsDocComment?: string;
  visibility: Visibility;
  isExported: boolean;
  extends?: string[];
  implements?: string[];
  decorators?: string[];
  sourceCode: string;
}

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "enum"
  | "module"
  | "namespace";

export interface SourceLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  description?: string;
}

export type Visibility = "public" | "private" | "protected";

export interface DocumentationQuality {
  score: number;
  completeness: number;
  clarity: number;
  accuracy: number;
  compliance: number;
  issues: QualityIssue[];
  suggestions: string[];
}

export interface QualityIssue {
  severity: "error" | "warning" | "info";
  category: "completeness" | "clarity" | "accuracy" | "compliance";
  message: string;
  location?: SourceLocation;
  suggestion?: string;
}

export interface GeneratedExample {
  title: string;
  description?: string;
  code: string;
  language: "typescript" | "rust";
  compiles: boolean;
  typeChecks: boolean;
  runnable: boolean;
  complexity: "basic" | "intermediate" | "advanced";
  runtime?: "node" | "bun" | "deno" | "browser";
  dependencies: string[];
}

export interface GeneratedTest {
  filePath: string;
  framework: "jest" | "vitest" | "bun" | "deno" | "cargo";
  content: string;
  totalTests: number;
  scenarios: TestScenario[];
  compiles: boolean;
  passes: boolean;
  coverage?: number;
}

export interface TestScenario {
  description: string;
  type: "success" | "error" | "edge-case";
  code: string;
}

export interface CrossReference {
  sourceProject: string;
  sourceSymbol: string;
  targetProject: string;
  targetSymbol: string;
  referenceType: "import" | "extends" | "implements" | "uses" | "calls";
  location: SourceLocation;
}

export interface SpecificationDocument {
  id: string;
  title: string;
  scope: "backend" | "frontend" | "fullstack";
  language: "typescript" | "rust";
  status: "draft" | "approved" | "implemented";

  sections: {
    overview: string;
    requirements: string[];
    architecture: string;
    apiDesign: string;
    dataModels: string;
    errorHandling: string;
    testing: string;
    implementation: string;
  };

  estimatedComplexity: "low" | "medium" | "high";
  suggestedTests: string[];

  createdAt: Date;
  updatedAt: Date;
}

export interface FileChangeEvent {
  type: "change" | "add" | "delete";
  path: string;
  timestamp: Date;
  affectedProjects: string[];
}
```

---

## Implementation Plan

### Phase 1: Infrastructure (Week 1-2)

**Tasks**:
1. ✅ **RocksDB Schema Design** (Done in this spec)
2. **Storage Layer Implementation**:
   - Implement catalog storage operations
   - Implement docs/examples/tests storage
   - Implement cross-reference storage
3. **Project Discovery**:
   - Monorepo scanner (package.json, Cargo.toml)
   - Dependency graph builder
   - Metadata extraction
4. **Basic MCP Tools**:
   - `catalog.list_projects`
   - `catalog.get_project`
   - `catalog.search_documentation`

**Deliverables**:
- Global catalog functional
- Can list and query projects
- Basic cross-project documentation access

---

### Phase 2: Documentation Generation (Week 3-4)

**Tasks**:
1. **Documentation Generator**:
   - Extend tree-sitter extractors for richer symbol info
   - Implement TSDoc/JSDoc generator
   - Implement rustdoc generator
   - Quality validation engine
2. **Documentation Transformer**:
   - Parse existing docs
   - Restructure to standard format
   - Enhancement logic
3. **MCP Tools**:
   - `docs.generate`
   - `docs.validate`
   - `docs.transform`

**Deliverables**:
- Can generate high-quality documentation
- Can transform existing docs
- Quality scoring functional

---

### Phase 3: Example & Test Generation (Week 5-6)

**Tasks**:
1. **Example Generator**:
   - Type analysis for smart examples
   - Context-aware code generation
   - Compilation validation
2. **Test Generator**:
   - Test template system
   - Framework adapters (Jest/Vitest/Bun/Cargo)
   - Coverage estimation
3. **MCP Tools**:
   - `examples.generate`
   - `examples.validate`
   - `tests.generate`
   - `tests.validate`

**Deliverables**:
- Can generate working examples
- Can generate passing tests
- Multi-framework support

---

### Phase 4: Agent Integration (Week 7-8)

**Tasks**:
1. **Architect Agent**:
   - Specification template system
   - Validation engine
   - Implementation compliance checker
2. **Developer Agent**:
   - Context retrieval
   - Boilerplate generation
3. **Tester Agent**:
   - Comprehensive test generation
   - Documentation enhancement
4. **MCP Tools**:
   - All agent tools (7 tools total)

**Deliverables**:
- Agent workflows functional
- Specification-driven development enabled
- Complete agent toolchain

---

### Phase 5: Auto-Update System (Week 9-10)

**Tasks**:
1. **File Watching**:
   - Watch implementation
   - Debouncing and batching
   - Project-level watching
2. **Incremental Re-Indexing**:
   - Symbol diff algorithm
   - Selective re-parsing
   - Cross-reference updates
3. **Cache Management**:
   - Multi-level caching
   - Invalidation strategies
   - Lazy regeneration
4. **MCP Tools**:
   - `strong.watch.start`
   - `strong.watch.stop`
   - `strong.watch.status`

**Deliverables**:
- Auto-update functional
- Documentation stays fresh
- Low-latency updates

---

### Phase 6: Cross-Project Features (Week 11-12)

**Tasks**:
1. **Cross-Reference Engine**:
   - Enhanced reference tracking
   - Usage analysis
   - Dependency graphing
2. **Global Search**:
   - Cross-project search
   - Relevance ranking
   - Filtering and facets
3. **MCP Tools**:
   - `strong.xref.find_usages`
   - `strong.xref.get_dependency_graph`
4. **Integration Testing**:
   - End-to-end workflows
   - Multi-project scenarios
   - Performance testing

**Deliverables**:
- Full cross-project functionality
- Complete MCP tool suite (23 tools total)
- Production-ready system

---

### Phase 7: Testing & Documentation (Week 13-14)

**Tasks**:
1. **Comprehensive Testing**:
   - Unit tests for all components
   - Integration tests for workflows
   - MCP tool tests (all 23 tools)
   - Performance benchmarks
2. **Documentation**:
   - User guide for MCP tools
   - Agent workflow examples
   - Best practices guide
   - API documentation
3. **Examples**:
   - Example projects using strong tools
   - Agent workflow demonstrations
   - Common scenarios

**Deliverables**:
- 100% test coverage for core features
- Complete documentation
- Ready for production use

---

## Compatibility with spec.md

### Integration with Existing Architecture

**Meridian Strong Tools** is an **extension** of the existing Meridian system, not a replacement.

### Using Existing Components

1. **Tree-sitter Integration** (spec.md: lines 308-409):
   - ✅ Use existing parsers (TypeScript, Rust, Go, Python, Java)
   - ✅ Extend extractors for more detailed analysis
   - ✅ Add extraction of documentation comments

2. **RocksDB Storage** (spec.md: lines 169-237):
   - ✅ Use existing RocksDB infrastructure
   - ✅ Add new prefixes for strong tools
   - ✅ Maintain compatibility with existing prefixes

3. **Code Navigation Tools** (spec.md: lines 986-1055):
   - ✅ `code.search_symbols` → used in strong tools for search
   - ✅ `code.get_definition` → used for extracting symbols
   - ✅ `code.find_references` → foundation for cross-reference tracking
   - ✅ `code.get_dependencies` → used for dependency graph

4. **Documentation Tools** (spec.md: lines 1056-1091):
   - ✅ Existing `docs.search` and `docs.get_for_symbol` remain
   - ✅ Strong tools **extend** them with generation capabilities
   - ✅ Full backward compatibility maintained

5. **Session Management** (spec.md: lines 1130-1215):
   - ✅ Strong tools use session isolation
   - ✅ Copy-on-write semantics for safety
   - ✅ Documentation regeneration within session

6. **Monorepo Support** (spec.md: lines 1253-1335):
   - ✅ `monorepo.list_projects` → foundation for global catalog
   - ✅ `monorepo.set_context` → used by strong tools
   - ✅ `monorepo.find_cross_references` → extended in strong tools

### New Components

**Strong Tools adds**:

1. **Global Documentation Catalog**:
   - Built on top of `monorepo.list_projects`
   - Adds documentation metadata
   - Adds quality metrics

2. **Generation Engines**:
   - Documentation generator
   - Example generator
   - Test generator
   - Completely new functionality

3. **Agent Integration**:
   - Architect/Developer/Tester workflows
   - Specification management
   - Completely new functionality

4. **Auto-Update System**:
   - File watching
   - Incremental re-indexing
   - Cache invalidation
   - Extension of existing session management

### Mapping: Existing Tools → Strong Tools

| Existing Tool | Strong Tool Enhancement |
|--------------|-------------------------|
| `code.search_symbols` | Used internally by `strong.catalog.search_documentation` |
| `code.get_definition` | Enhanced with `strong.docs.generate` |
| `docs.search` | Extended by `strong.catalog.search_documentation` (cross-project) |
| `docs.get_for_symbol` | Enhanced by `strong.docs.generate` (with generation) |
| `monorepo.list_projects` | Foundation for `strong.catalog.list_projects` |
| `monorepo.find_cross_references` | Extended by `strong.xref.*` tools |

### Versioning

**MCP Protocol Version**: 2025-03-26 (compatible with spec.md)

**Strong Tools Version**: 1.0.0

**Compatibility Matrix**:
```
Meridian Core: v1.0.0+
Strong Tools: v1.0.0+
MCP Protocol: 2025-03-26 (with 2024-11-05 backward compat)
Claude CLI: ✅ Compatible
MCP Clients: ✅ Compatible (all supporting MCP 2025-03-26)
```

### Migration Path

**Existing installations** update seamlessly:

1. **Phase 1**: Install strong tools (additional 23 MCP tools)
2. **Phase 2**: Index projects (background task)
3. **Phase 3**: Generate documentation (lazy, on-demand)
4. **Phase 4**: Enable auto-update (optional)

**No Breaking Changes**:
- Existing 29 MCP tools work as before
- New 23 strong tools added without conflicts
- RocksDB schema extended, not broken
- Backward compatibility guaranteed

---

## Conclusion

**Meridian Strong Tools** transforms Meridian into a comprehensive **knowledge management system**:

✅ **Documentation generation** of high quality
✅ **Creating practical examples** based on code analysis
✅ **Test generation** for TypeScript and Rust
✅ **Global catalog** for all monorepo projects
✅ **Cross-platform access** to documentation
✅ **Automatic updates** on code changes
✅ **Agent architecture integration** (architect, developer, tester)
✅ **Full compatibility** with existing specification

**Total MCP Tools**: 29 (existing) + 23 (strong tools) = **52 tools**

**Ready for implementation**: Specification is complete, detailed, internally consistent.

---

**Next Steps**: Begin implementation according to [implementation plan](#implementation-plan) →
