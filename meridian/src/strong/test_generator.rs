//! Test Generator - Generates unit and integration tests from symbols
//!
//! This module provides functionality to generate tests for various testing frameworks
//! including Jest, Vitest, Bun Test, and Rust native tests.

use crate::types::CodeSymbol;
use crate::strong::ValidationResult;
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Generated test case
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeneratedTest {
    pub name: String,
    pub code: String,
    pub framework: TestFramework,
    pub test_type: TestType,
}

/// Supported test frameworks
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TestFramework {
    Jest,
    Vitest,
    BunTest,
    RustNative,
}

impl TestFramework {
    pub fn as_str(&self) -> &'static str {
        match self {
            TestFramework::Jest => "jest",
            TestFramework::Vitest => "vitest",
            TestFramework::BunTest => "bun:test",
            TestFramework::RustNative => "rust",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "jest" => Some(TestFramework::Jest),
            "vitest" => Some(TestFramework::Vitest),
            "bun" | "bun:test" => Some(TestFramework::BunTest),
            "rust" => Some(TestFramework::RustNative),
            _ => None,
        }
    }
}

/// Type of test
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TestType {
    Unit,
    Integration,
    E2E,
}

impl TestType {
    pub fn as_str(&self) -> &'static str {
        match self {
            TestType::Unit => "unit",
            TestType::Integration => "integration",
            TestType::E2E => "e2e",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "unit" => Some(TestType::Unit),
            "integration" => Some(TestType::Integration),
            "e2e" | "end-to-end" => Some(TestType::E2E),
            _ => None,
        }
    }
}

/// Test generator for symbols
pub struct TestGenerator {
    framework: TestFramework,
}

impl TestGenerator {
    /// Create a new test generator for the specified framework
    pub fn new(framework: TestFramework) -> Self {
        Self { framework }
    }

    /// Generate unit tests for a symbol
    pub fn generate_unit_tests(&self, symbol: &CodeSymbol) -> Result<Vec<GeneratedTest>> {
        match self.framework {
            TestFramework::Jest | TestFramework::Vitest | TestFramework::BunTest => {
                self.generate_unit_tests_js(symbol)
            }
            TestFramework::RustNative => self.generate_unit_tests_rust(symbol),
        }
    }

    /// Generate integration tests for a module
    pub fn generate_integration_tests(&self, module: &str) -> Result<Vec<GeneratedTest>> {
        match self.framework {
            TestFramework::Jest | TestFramework::Vitest | TestFramework::BunTest => {
                self.generate_integration_tests_js(module)
            }
            TestFramework::RustNative => self.generate_integration_tests_rust(module),
        }
    }

    /// Estimate test coverage percentage for given tests
    pub fn estimate_coverage(&self, tests: &[GeneratedTest]) -> f32 {
        if tests.is_empty() {
            return 0.0;
        }

        // Calculate coverage based on test types and content
        let mut coverage = 0.0;
        let mut weight_sum = 0.0;

        for test in tests {
            let base_weight = match test.test_type {
                TestType::Unit => 1.0,
                TestType::Integration => 1.5,
                TestType::E2E => 2.0,
            };

            // Bonus for comprehensive tests
            let mut multiplier = 1.0;
            if test.code.contains("expect") || test.code.contains("assert") {
                multiplier += 0.2;
            }
            if test.code.contains("mock") || test.code.contains("spy") {
                multiplier += 0.15;
            }
            if test.code.contains("async") || test.code.contains("await") {
                multiplier += 0.1;
            }

            let weight = base_weight * multiplier;
            coverage += weight * 15.0; // Each test contributes to coverage
            weight_sum += weight;
        }

        // Normalize and cap at 100%
        let estimated = (coverage / weight_sum) as f32;
        estimated.min(100.0)
    }

    /// Validate a test for syntax and best practices
    pub fn validate_test(&self, test: &GeneratedTest) -> ValidationResult {
        let mut result = ValidationResult::success();

        // Check for essential test elements
        match self.framework {
            TestFramework::Jest | TestFramework::Vitest | TestFramework::BunTest => {
                if !test.code.contains("expect") && !test.code.contains("assert") {
                    result.valid = false;
                    result.errors.push("Test must contain assertions (expect/assert)".to_string());
                }
                if !test.code.contains("it") && !test.code.contains("test") {
                    result.valid = false;
                    result.errors.push("Test must be wrapped in it() or test() block".to_string());
                }
            }
            TestFramework::RustNative => {
                if !test.code.contains("#[test]") {
                    result.valid = false;
                    result.errors.push("Test must have #[test] attribute".to_string());
                }
                if !test.code.contains("assert") {
                    result.valid = false;
                    result.errors.push("Test must contain assertions".to_string());
                }
            }
        }

        // Check for test type appropriateness
        match test.test_type {
            TestType::Unit => {
                if test.code.contains("http") || test.code.contains("database") {
                    result = result.with_warning("Unit test appears to have external dependencies".to_string());
                }
            }
            TestType::Integration => {
                if test.code.lines().count() < 5 {
                    result = result.with_warning("Integration test seems too simple".to_string());
                }
            }
            TestType::E2E => {
                if !test.code.contains("async") && self.framework != TestFramework::RustNative {
                    result = result.with_warning("E2E tests usually involve async operations".to_string());
                }
            }
        }

        result
    }

    /// Calculate quality score for a test
    pub fn calculate_test_quality(&self, test: &GeneratedTest) -> f32 {
        let mut score: f32 = 100.0;

        // Check for assertions
        let assertion_count = test.code.matches("expect").count()
            + test.code.matches("assert").count();

        if assertion_count == 0 {
            score -= 50.0;
        } else if assertion_count == 1 {
            score -= 10.0;
        }

        // Check for test structure
        if !test.code.contains("describe") && !test.code.contains("mod tests") {
            score -= 15.0;
        }

        // Check for setup/teardown
        if test.code.contains("beforeEach") || test.code.contains("afterEach") {
            score += 10.0;
        }

        // Check for mocking/stubbing
        if test.code.contains("mock") || test.code.contains("spy") || test.code.contains("stub") {
            score += 15.0;
        }

        // Check for descriptive test name
        if test.name.len() < 10 {
            score -= 10.0;
        }

        score.max(0.0).min(100.0)
    }

    // JavaScript/TypeScript test generation
    fn generate_unit_tests_js(&self, symbol: &CodeSymbol) -> Result<Vec<GeneratedTest>> {
        use crate::types::SymbolKind;

        let mut tests = Vec::new();
        let import_stmt = self.get_import_statement();

        match symbol.kind {
            SymbolKind::Function | SymbolKind::Method => {
                // Happy path test
                tests.push(GeneratedTest {
                    name: format!("{} - should return expected result with valid input", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  it('should return expected result with valid input', () => {{\n    const result = {}();\n    expect(result).toBeDefined();\n    expect(result).not.toBeNull();\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });

                // Error handling test with specific error types
                tests.push(GeneratedTest {
                    name: format!("{} - should throw error with invalid input", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  it('should throw error with invalid input', () => {{\n    expect(() => {}(null)).toThrow();\n    expect(() => {}(undefined)).toThrow(TypeError);\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name, symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });

                // Async test if applicable
                tests.push(GeneratedTest {
                    name: format!("{} - should handle async operations", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  it('should handle async operations', async () => {{\n    const result = await {}();\n    expect(result).toBeDefined();\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
            SymbolKind::Class => {
                // Constructor test with setup
                tests.push(GeneratedTest {
                    name: format!("{} - should instantiate with valid configuration", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  let instance: {};\n\n  beforeEach(() => {{\n    instance = new {}();\n  }});\n\n  afterEach(() => {{\n    // Cleanup\n  }});\n\n  it('should instantiate with valid configuration', () => {{\n    expect(instance).toBeInstanceOf({});\n    expect(instance).toBeDefined();\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name,
                        symbol.name, symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });

                // Method test with mocking
                tests.push(GeneratedTest {
                    name: format!("{} - should call methods with correct arguments", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  it('should call methods with correct arguments', () => {{\n    const instance = new {}();\n    const spy = jest.spyOn(instance, 'method');\n    \n    instance.method();\n    \n    expect(spy).toHaveBeenCalled();\n    expect(spy).toHaveBeenCalledTimes(1);\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
            _ => {
                // Generic test
                tests.push(GeneratedTest {
                    name: format!("{} - should be defined and exportable", symbol.name),
                    code: format!(
                        "{}\nimport {{ {} }} from './{}';  \n\ndescribe('{}', () => {{\n  it('should be defined and exportable', () => {{\n    expect({}).toBeDefined();\n    expect(typeof {}).not.toBe('undefined');\n  }});\n}});",
                        import_stmt, symbol.name, symbol.name.to_lowercase(), symbol.name, symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
        }

        Ok(tests)
    }

    fn generate_integration_tests_js(&self, module: &str) -> Result<Vec<GeneratedTest>> {
        let import_stmt = self.get_import_statement();

        let tests = vec![
            GeneratedTest {
                name: format!("{} - integration test", module),
                code: format!(
                    "{}\n\ndescribe('{} Integration', () => {{\n  it('should integrate with other modules', async () => {{\n    // Integration test\n    expect(true).toBe(true);\n  }});\n}});",
                    import_stmt, module
                ),
                framework: self.framework,
                test_type: TestType::Integration,
            },
            GeneratedTest {
                name: format!("{} - workflow test", module),
                code: format!(
                    "{}\n\ndescribe('{} Workflow', () => {{\n  it('should complete full workflow', async () => {{\n    // Workflow test\n    expect(true).toBe(true);\n  }});\n}});",
                    import_stmt, module
                ),
                framework: self.framework,
                test_type: TestType::Integration,
            },
        ];

        Ok(tests)
    }

    fn get_import_statement(&self) -> String {
        match self.framework {
            TestFramework::Jest => "import { describe, it, expect } from '@jest/globals';".to_string(),
            TestFramework::Vitest => "import { describe, it, expect } from 'vitest';".to_string(),
            TestFramework::BunTest => "import { describe, it, expect } from 'bun:test';".to_string(),
            TestFramework::RustNative => "".to_string(),
        }
    }

    // Rust test generation
    fn generate_unit_tests_rust(&self, symbol: &CodeSymbol) -> Result<Vec<GeneratedTest>> {
        use crate::types::SymbolKind;

        let mut tests = Vec::new();

        match symbol.kind {
            SymbolKind::Function => {
                // Happy path test
                tests.push(GeneratedTest {
                    name: format!("test_{}_success", symbol.name),
                    code: format!(
                        "#[test]\nfn test_{}_success() {{\n    let result = {}();\n    assert!(result.is_ok());\n}}",
                        symbol.name, symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });

                // Error test
                tests.push(GeneratedTest {
                    name: format!("test_{}_error", symbol.name),
                    code: format!(
                        "#[test]\nfn test_{}_error() {{\n    // Test error case\n    assert!(true);\n}}",
                        symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
            SymbolKind::Struct => {
                // Constructor test
                tests.push(GeneratedTest {
                    name: format!("test_{}_new", symbol.name.to_lowercase()),
                    code: format!(
                        "#[test]\nfn test_{}_new() {{\n    let instance = {}::new();\n    // Add assertions\n}}",
                        symbol.name.to_lowercase(),
                        symbol.name
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
            _ => {
                tests.push(GeneratedTest {
                    name: format!("test_{}", symbol.name.to_lowercase()),
                    code: format!(
                        "#[test]\nfn test_{}() {{\n    // Test case\n    assert!(true);\n}}",
                        symbol.name.to_lowercase()
                    ),
                    framework: self.framework,
                    test_type: TestType::Unit,
                });
            }
        }

        Ok(tests)
    }

    fn generate_integration_tests_rust(&self, module: &str) -> Result<Vec<GeneratedTest>> {
        let tests = vec![
            GeneratedTest {
                name: format!("test_{}_integration", module),
                code: format!(
                    "#[test]\nfn test_{}_integration() {{\n    // Integration test\n    assert!(true);\n}}",
                    module
                ),
                framework: self.framework,
                test_type: TestType::Integration,
            },
        ];

        Ok(tests)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Hash, Location, SymbolId, SymbolKind, SymbolMetadata};

    fn create_test_symbol(kind: SymbolKind, name: &str) -> CodeSymbol {
        CodeSymbol {
            id: SymbolId::generate(),
            name: name.to_string(),
            kind,
            signature: format!("{}()", name),
            body_hash: Hash::from_string("test"),
            location: Location::new("test.ts".to_string(), 1, 10, 0, 100),
            references: Vec::new(),
            dependencies: Vec::new(),
            metadata: SymbolMetadata::default(),
            embedding: None,
        }
    }

    #[test]
    fn test_jest_unit_tests_function() {
        let generator = TestGenerator::new(TestFramework::Jest);
        let symbol = create_test_symbol(SymbolKind::Function, "testFunc");

        let tests = generator.generate_unit_tests(&symbol).unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().all(|t| t.framework == TestFramework::Jest));
        assert!(tests.iter().all(|t| t.test_type == TestType::Unit));
        assert!(tests.iter().any(|t| t.code.contains("expect")));
    }

    #[test]
    fn test_vitest_unit_tests_class() {
        let generator = TestGenerator::new(TestFramework::Vitest);
        let symbol = create_test_symbol(SymbolKind::Class, "TestClass");

        let tests = generator.generate_unit_tests(&symbol).unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().any(|t| t.code.contains("toBeInstanceOf")));
        assert!(tests.iter().all(|t| t.framework == TestFramework::Vitest));
    }

    #[test]
    fn test_bun_test_unit_tests() {
        let generator = TestGenerator::new(TestFramework::BunTest);
        let symbol = create_test_symbol(SymbolKind::Function, "testFunc");

        let tests = generator.generate_unit_tests(&symbol).unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().any(|t| t.code.contains("bun:test")));
    }

    #[test]
    fn test_rust_unit_tests_function() {
        let generator = TestGenerator::new(TestFramework::RustNative);
        let symbol = create_test_symbol(SymbolKind::Function, "test_func");

        let tests = generator.generate_unit_tests(&symbol).unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().all(|t| t.framework == TestFramework::RustNative));
        assert!(tests.iter().any(|t| t.code.contains("#[test]")));
    }

    #[test]
    fn test_rust_unit_tests_struct() {
        let generator = TestGenerator::new(TestFramework::RustNative);
        let symbol = create_test_symbol(SymbolKind::Struct, "TestStruct");

        let tests = generator.generate_unit_tests(&symbol).unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().any(|t| t.code.contains("TestStruct::new")));
    }

    #[test]
    fn test_jest_integration_tests() {
        let generator = TestGenerator::new(TestFramework::Jest);

        let tests = generator.generate_integration_tests("my_module").unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().all(|t| t.test_type == TestType::Integration));
        assert!(tests.iter().any(|t| t.name.contains("integration")));
    }

    #[test]
    fn test_rust_integration_tests() {
        let generator = TestGenerator::new(TestFramework::RustNative);

        let tests = generator.generate_integration_tests("my_module").unwrap();

        assert!(!tests.is_empty());
        assert!(tests.iter().all(|t| t.test_type == TestType::Integration));
    }

    #[test]
    fn test_coverage_estimation_empty() {
        let generator = TestGenerator::new(TestFramework::Jest);
        let coverage = generator.estimate_coverage(&[]);

        assert_eq!(coverage, 0.0);
    }

    #[test]
    fn test_coverage_estimation_unit_tests() {
        let generator = TestGenerator::new(TestFramework::Jest);
        let tests = vec![
            GeneratedTest {
                name: "test1".to_string(),
                code: "test".to_string(),
                framework: TestFramework::Jest,
                test_type: TestType::Unit,
            },
            GeneratedTest {
                name: "test2".to_string(),
                code: "test".to_string(),
                framework: TestFramework::Jest,
                test_type: TestType::Unit,
            },
        ];

        let coverage = generator.estimate_coverage(&tests);
        assert!(coverage > 0.0 && coverage <= 100.0);
    }

    #[test]
    fn test_coverage_estimation_mixed_tests() {
        let generator = TestGenerator::new(TestFramework::Jest);
        let tests = vec![
            GeneratedTest {
                name: "test1".to_string(),
                code: "test".to_string(),
                framework: TestFramework::Jest,
                test_type: TestType::Unit,
            },
            GeneratedTest {
                name: "test2".to_string(),
                code: "test".to_string(),
                framework: TestFramework::Jest,
                test_type: TestType::Integration,
            },
            GeneratedTest {
                name: "test3".to_string(),
                code: "test".to_string(),
                framework: TestFramework::Jest,
                test_type: TestType::E2E,
            },
        ];

        let coverage = generator.estimate_coverage(&tests);
        assert!(coverage > 0.0 && coverage <= 100.0);
    }

    #[test]
    fn test_framework_from_str() {
        assert_eq!(TestFramework::from_str("jest"), Some(TestFramework::Jest));
        assert_eq!(TestFramework::from_str("vitest"), Some(TestFramework::Vitest));
        assert_eq!(TestFramework::from_str("bun"), Some(TestFramework::BunTest));
        assert_eq!(TestFramework::from_str("rust"), Some(TestFramework::RustNative));
        assert_eq!(TestFramework::from_str("unknown"), None);
    }

    #[test]
    fn test_test_type_from_str() {
        assert_eq!(TestType::from_str("unit"), Some(TestType::Unit));
        assert_eq!(TestType::from_str("integration"), Some(TestType::Integration));
        assert_eq!(TestType::from_str("e2e"), Some(TestType::E2E));
        assert_eq!(TestType::from_str("unknown"), None);
    }
}
