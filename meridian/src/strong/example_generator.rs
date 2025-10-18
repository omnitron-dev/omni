//! Example Generator - Generates code examples from symbols
//!
//! This module provides functionality to generate basic and advanced code examples
//! from CodeSymbol definitions, supporting multiple languages.

use crate::types::CodeSymbol;
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Generated code example with metadata
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Example {
    pub code: String,
    pub description: String,
    pub language: String,
    pub complexity: ExampleComplexity,
}

/// Complexity level of generated examples
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExampleComplexity {
    Basic,
    Intermediate,
    Advanced,
}

impl ExampleComplexity {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExampleComplexity::Basic => "basic",
            ExampleComplexity::Intermediate => "intermediate",
            ExampleComplexity::Advanced => "advanced",
        }
    }
}

/// Validation result for examples
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl ValidationResult {
    pub fn success() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn with_warning(mut self, warning: String) -> Self {
        self.warnings.push(warning);
        self
    }

    pub fn with_error(error: String) -> Self {
        Self {
            valid: false,
            errors: vec![error],
            warnings: Vec::new(),
        }
    }
}

/// Example generator for code symbols
pub struct ExampleGenerator {
    language: String,
}

impl ExampleGenerator {
    /// Create a new example generator for the specified language
    pub fn new(language: String) -> Self {
        Self { language }
    }

    /// Generate a basic usage example for a symbol
    pub fn generate_basic(&self, symbol: &CodeSymbol) -> Result<Example> {
        let code = match self.language.as_str() {
            "typescript" | "javascript" => self.generate_basic_typescript(symbol)?,
            "rust" => self.generate_basic_rust(symbol)?,
            "python" => self.generate_basic_python(symbol)?,
            _ => anyhow::bail!("Unsupported language: {}", self.language),
        };

        Ok(Example {
            code,
            description: format!("Basic usage example for {}", symbol.name),
            language: self.language.clone(),
            complexity: ExampleComplexity::Basic,
        })
    }

    /// Generate multiple advanced examples for a symbol
    pub fn generate_advanced(&self, symbol: &CodeSymbol) -> Result<Vec<Example>> {
        let mut examples = Vec::new();

        match self.language.as_str() {
            "typescript" | "javascript" => {
                examples.extend(self.generate_advanced_typescript(symbol)?);
            }
            "rust" => {
                examples.extend(self.generate_advanced_rust(symbol)?);
            }
            "python" => {
                examples.extend(self.generate_advanced_python(symbol)?);
            }
            _ => anyhow::bail!("Unsupported language: {}", self.language),
        }

        Ok(examples)
    }

    /// Validate an example (syntax and structure check)
    pub fn validate(&self, example: &Example) -> Result<ValidationResult> {
        // Check language matches
        if example.language != self.language {
            return Ok(ValidationResult::with_error(format!(
                "Language mismatch: expected {}, got {}",
                self.language, example.language
            )));
        }

        // Basic validation checks
        if example.code.is_empty() {
            return Ok(ValidationResult::with_error(
                "Example code is empty".to_string(),
            ));
        }

        // Language-specific validation
        match self.language.as_str() {
            "typescript" | "javascript" => self.validate_typescript(&example.code),
            "rust" => self.validate_rust(&example.code),
            "python" => self.validate_python(&example.code),
            _ => Ok(ValidationResult::success().with_warning(format!(
                "No validator available for language: {}",
                self.language
            ))),
        }
    }

    // Private helper methods for TypeScript/JavaScript
    fn generate_basic_typescript(&self, symbol: &CodeSymbol) -> Result<String> {
        use crate::types::SymbolKind;

        let code = match symbol.kind {
            SymbolKind::Function | SymbolKind::Method => {
                format!(
                    "// Basic usage of {}\nconst result = {}();\nconsole.log(result);",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Class => {
                format!(
                    "// Basic usage of {}\nconst instance = new {}();\nconsole.log(instance);",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Interface => {
                format!(
                    "// Implementing {}\nconst obj: {} = {{\n  // implementation\n}};",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Constant | SymbolKind::Variable => {
                format!("// Using {}\nconsole.log({});", symbol.name, symbol.name)
            }
            _ => {
                format!("// Example for {}\n// Usage example", symbol.name)
            }
        };

        Ok(code)
    }

    fn generate_advanced_typescript(&self, symbol: &CodeSymbol) -> Result<Vec<Example>> {
        use crate::types::SymbolKind;

        let mut examples = Vec::new();

        match symbol.kind {
            SymbolKind::Function | SymbolKind::Method => {
                // Error handling example
                examples.push(Example {
                    code: format!(
                        "// Error handling\ntry {{\n  const result = {}();\n  console.log(result);\n}} catch (error) {{\n  console.error('Error:', error);\n}}",
                        symbol.name
                    ),
                    description: format!("Error handling for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Advanced,
                });

                // Async example
                examples.push(Example {
                    code: format!(
                        "// Async usage\nasync function example() {{\n  const result = await {}();\n  return result;\n}}",
                        symbol.name
                    ),
                    description: format!("Async pattern for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Intermediate,
                });
            }
            SymbolKind::Class => {
                // Inheritance example
                examples.push(Example {
                    code: format!(
                        "// Extending {}\nclass Extended{} extends {} {{\n  constructor() {{\n    super();\n  }}\n}}",
                        symbol.name, symbol.name, symbol.name
                    ),
                    description: format!("Inheritance pattern for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Advanced,
                });
            }
            _ => {}
        }

        Ok(examples)
    }

    fn validate_typescript(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Basic syntax checks
        let open_braces = code.matches('{').count();
        let close_braces = code.matches('}').count();

        if open_braces != close_braces {
            result.valid = false;
            result.errors.push("Mismatched braces".to_string());
        }

        let open_parens = code.matches('(').count();
        let close_parens = code.matches(')').count();

        if open_parens != close_parens {
            result.valid = false;
            result.errors.push("Mismatched parentheses".to_string());
        }

        // Check for common patterns
        if !code.contains("//") && !code.contains("/*") {
            result = result.with_warning("Example has no comments".to_string());
        }

        Ok(result)
    }

    // Private helper methods for Rust
    fn generate_basic_rust(&self, symbol: &CodeSymbol) -> Result<String> {
        use crate::types::SymbolKind;

        let code = match symbol.kind {
            SymbolKind::Function => {
                format!(
                    "// Basic usage of {}\nlet result = {}();\nprintln!(\"{{:?}}\", result);",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Struct => {
                format!(
                    "// Basic usage of {}\nlet instance = {}::new();\nprintln!(\"{{:?}}\", instance);",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Trait => {
                format!(
                    "// Implementing {}\nimpl {} for MyType {{\n  // implementation\n}}",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Enum => {
                format!(
                    "// Using {}\nlet value = {}::Variant;\nmatch value {{\n  // patterns\n  _ => {{}}\n}}",
                    symbol.name, symbol.name
                )
            }
            _ => {
                format!("// Example for {}\n// Usage example", symbol.name)
            }
        };

        Ok(code)
    }

    fn generate_advanced_rust(&self, symbol: &CodeSymbol) -> Result<Vec<Example>> {
        use crate::types::SymbolKind;

        let mut examples = Vec::new();

        match symbol.kind {
            SymbolKind::Function => {
                // Error handling example
                examples.push(Example {
                    code: format!(
                        "// Error handling\nmatch {}() {{\n  Ok(result) => println!(\"Success: {{:?}}\", result),\n  Err(e) => eprintln!(\"Error: {{:?}}\", e),\n}}",
                        symbol.name
                    ),
                    description: format!("Error handling for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Advanced,
                });
            }
            SymbolKind::Struct => {
                // Builder pattern example
                examples.push(Example {
                    code: format!(
                        "// Builder pattern\nlet instance = {}::builder()\n  .field(value)\n  .build()?;",
                        symbol.name
                    ),
                    description: format!("Builder pattern for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Intermediate,
                });
            }
            _ => {}
        }

        Ok(examples)
    }

    fn validate_rust(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Basic syntax checks
        let open_braces = code.matches('{').count();
        let close_braces = code.matches('}').count();

        if open_braces != close_braces {
            result.valid = false;
            result.errors.push("Mismatched braces".to_string());
        }

        // Check for Rust-specific patterns
        if code.contains("unwrap()") {
            result = result.with_warning("Consider using proper error handling instead of unwrap()".to_string());
        }

        Ok(result)
    }

    // Private helper methods for Python
    fn generate_basic_python(&self, symbol: &CodeSymbol) -> Result<String> {
        use crate::types::SymbolKind;

        let code = match symbol.kind {
            SymbolKind::Function | SymbolKind::Method => {
                format!(
                    "# Basic usage of {}\nresult = {}()\nprint(result)",
                    symbol.name, symbol.name
                )
            }
            SymbolKind::Class => {
                format!(
                    "# Basic usage of {}\ninstance = {}()\nprint(instance)",
                    symbol.name, symbol.name
                )
            }
            _ => {
                format!("# Example for {}\n# Usage example", symbol.name)
            }
        };

        Ok(code)
    }

    fn generate_advanced_python(&self, symbol: &CodeSymbol) -> Result<Vec<Example>> {
        use crate::types::SymbolKind;

        let mut examples = Vec::new();

        match symbol.kind {
            SymbolKind::Function | SymbolKind::Method => {
                examples.push(Example {
                    code: format!(
                        "# Error handling\ntry:\n    result = {}()\n    print(result)\nexcept Exception as e:\n    print(f'Error: {{e}}')",
                        symbol.name
                    ),
                    description: format!("Error handling for {}", symbol.name),
                    language: self.language.clone(),
                    complexity: ExampleComplexity::Advanced,
                });
            }
            _ => {}
        }

        Ok(examples)
    }

    fn validate_python(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Check for balanced parentheses
        let open_parens = code.matches('(').count();
        let close_parens = code.matches(')').count();

        if open_parens != close_parens {
            result.valid = false;
            result.errors.push("Mismatched parentheses".to_string());
        }

        Ok(result)
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
    fn test_basic_function_example_typescript() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let symbol = create_test_symbol(SymbolKind::Function, "testFunc");

        let example = generator.generate_basic(&symbol).unwrap();

        assert_eq!(example.language, "typescript");
        assert_eq!(example.complexity, ExampleComplexity::Basic);
        assert!(example.code.contains("testFunc"));
        assert!(example.description.contains("Basic usage"));
    }

    #[test]
    fn test_basic_class_example_typescript() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let symbol = create_test_symbol(SymbolKind::Class, "TestClass");

        let example = generator.generate_basic(&symbol).unwrap();

        assert!(example.code.contains("new TestClass"));
        assert_eq!(example.complexity, ExampleComplexity::Basic);
    }

    #[test]
    fn test_basic_function_example_rust() {
        let generator = ExampleGenerator::new("rust".to_string());
        let symbol = create_test_symbol(SymbolKind::Function, "test_func");

        let example = generator.generate_basic(&symbol).unwrap();

        assert_eq!(example.language, "rust");
        assert!(example.code.contains("test_func"));
        assert!(example.code.contains("println!"));
    }

    #[test]
    fn test_basic_struct_example_rust() {
        let generator = ExampleGenerator::new("rust".to_string());
        let symbol = create_test_symbol(SymbolKind::Struct, "TestStruct");

        let example = generator.generate_basic(&symbol).unwrap();

        assert!(example.code.contains("TestStruct::new"));
    }

    #[test]
    fn test_advanced_function_examples_typescript() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let symbol = create_test_symbol(SymbolKind::Function, "testFunc");

        let examples = generator.generate_advanced(&symbol).unwrap();

        assert!(!examples.is_empty());
        assert!(examples.iter().any(|e| e.description.contains("Error handling")));
        assert!(examples.iter().any(|e| e.description.contains("Async")));
    }

    #[test]
    fn test_advanced_class_examples_typescript() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let symbol = create_test_symbol(SymbolKind::Class, "TestClass");

        let examples = generator.generate_advanced(&symbol).unwrap();

        assert!(!examples.is_empty());
        assert!(examples.iter().any(|e| e.description.contains("Inheritance")));
    }

    #[test]
    fn test_validation_success() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let example = Example {
            code: "const x = { test: 1 };".to_string(),
            description: "Test".to_string(),
            language: "typescript".to_string(),
            complexity: ExampleComplexity::Basic,
        };

        let result = generator.validate(&example).unwrap();
        assert!(result.valid);
    }

    #[test]
    fn test_validation_mismatched_braces() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let example = Example {
            code: "const x = { test: 1;".to_string(),
            description: "Test".to_string(),
            language: "typescript".to_string(),
            complexity: ExampleComplexity::Basic,
        };

        let result = generator.validate(&example).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("braces")));
    }

    #[test]
    fn test_validation_empty_code() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let example = Example {
            code: "".to_string(),
            description: "Test".to_string(),
            language: "typescript".to_string(),
            complexity: ExampleComplexity::Basic,
        };

        let result = generator.validate(&example).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("empty")));
    }

    #[test]
    fn test_validation_language_mismatch() {
        let generator = ExampleGenerator::new("typescript".to_string());
        let example = Example {
            code: "test".to_string(),
            description: "Test".to_string(),
            language: "rust".to_string(),
            complexity: ExampleComplexity::Basic,
        };

        let result = generator.validate(&example).unwrap();
        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("Language mismatch")));
    }

    #[test]
    fn test_unsupported_language() {
        let generator = ExampleGenerator::new("cobol".to_string());
        let symbol = create_test_symbol(SymbolKind::Function, "test");

        let result = generator.generate_basic(&symbol);
        assert!(result.is_err());
    }

    #[test]
    fn test_python_basic_function() {
        let generator = ExampleGenerator::new("python".to_string());
        let symbol = create_test_symbol(SymbolKind::Function, "test_func");

        let example = generator.generate_basic(&symbol).unwrap();

        assert_eq!(example.language, "python");
        assert!(example.code.contains("test_func"));
        assert!(example.code.contains("print"));
    }

    #[test]
    fn test_rust_validation_unwrap_warning() {
        let generator = ExampleGenerator::new("rust".to_string());
        let example = Example {
            code: "let x = some_func().unwrap();".to_string(),
            description: "Test".to_string(),
            language: "rust".to_string(),
            complexity: ExampleComplexity::Basic,
        };

        let result = generator.validate(&example).unwrap();
        assert!(result.valid);
        assert!(!result.warnings.is_empty());
        assert!(result.warnings.iter().any(|w| w.contains("unwrap")));
    }
}
