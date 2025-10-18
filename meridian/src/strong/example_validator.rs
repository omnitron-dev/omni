//! Example Validator - Validates code examples for syntax and compilation
//!
//! This module provides validation capabilities for code examples,
//! checking syntax and attempting compilation/interpretation validation.

use crate::strong::example_generator::ValidationResult;
use anyhow::Result;

/// Validator for code examples
pub struct ExampleValidator {
    language: String,
}

impl ExampleValidator {
    /// Create a new example validator for the specified language
    pub fn new(language: String) -> Self {
        Self { language }
    }

    /// Validate syntax of code example
    pub fn validate_syntax(&self, code: &str) -> Result<ValidationResult> {
        if code.is_empty() {
            return Ok(ValidationResult::with_error(
                "Code is empty".to_string(),
            ));
        }

        match self.language.as_str() {
            "typescript" | "javascript" => self.validate_js_syntax(code),
            "rust" => self.validate_rust_syntax(code),
            "python" => self.validate_python_syntax(code),
            _ => Ok(ValidationResult::success().with_warning(format!(
                "No syntax validator available for language: {}",
                self.language
            ))),
        }
    }

    /// Validate compilation of code example
    pub fn validate_compilation(&self, code: &str) -> Result<ValidationResult> {
        if code.is_empty() {
            return Ok(ValidationResult::with_error(
                "Code is empty".to_string(),
            ));
        }

        match self.language.as_str() {
            "typescript" | "javascript" => self.validate_js_compilation(code),
            "rust" => self.validate_rust_compilation(code),
            "python" => self.validate_python_compilation(code),
            _ => Ok(ValidationResult::success().with_warning(format!(
                "No compilation validator available for language: {}",
                self.language
            ))),
        }
    }

    // JavaScript/TypeScript validation
    fn validate_js_syntax(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Check balanced braces
        if !self.check_balanced_delimiters(code, '{', '}') {
            result.valid = false;
            result.errors.push("Mismatched curly braces".to_string());
        }

        // Check balanced parentheses
        if !self.check_balanced_delimiters(code, '(', ')') {
            result.valid = false;
            result.errors.push("Mismatched parentheses".to_string());
        }

        // Check balanced brackets
        if !self.check_balanced_delimiters(code, '[', ']') {
            result.valid = false;
            result.errors.push("Mismatched square brackets".to_string());
        }

        // Check for unclosed strings
        if self.has_unclosed_strings(code, '"') || self.has_unclosed_strings(code, '\'') {
            result.valid = false;
            result.errors.push("Unclosed string literal".to_string());
        }

        // Check for common syntax patterns
        if code.contains("function") && !code.contains("(") {
            result = result.with_warning("Function declaration without parentheses".to_string());
        }

        if code.contains("const ") || code.contains("let ") || code.contains("var ") {
            if !code.contains("=") {
                result = result.with_warning("Variable declaration without assignment".to_string());
            }
        }

        Ok(result)
    }

    fn validate_js_compilation(&self, code: &str) -> Result<ValidationResult> {
        // First check syntax
        let syntax_result = self.validate_js_syntax(code)?;
        if !syntax_result.valid {
            return Ok(syntax_result);
        }

        let mut result = ValidationResult::success();

        // Check for obvious compilation issues
        if code.contains("import ") && !code.contains(" from ") {
            result = result.with_warning("Import statement without 'from' clause".to_string());
        }

        // Check for async/await usage
        if code.contains("await ") && !code.contains("async ") {
            result.valid = false;
            result.errors.push("'await' used outside async function".to_string());
        }

        Ok(result)
    }

    // Rust validation
    fn validate_rust_syntax(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Check balanced braces
        if !self.check_balanced_delimiters(code, '{', '}') {
            result.valid = false;
            result.errors.push("Mismatched curly braces".to_string());
        }

        // Check balanced parentheses
        if !self.check_balanced_delimiters(code, '(', ')') {
            result.valid = false;
            result.errors.push("Mismatched parentheses".to_string());
        }

        // Check for unclosed strings
        if self.has_unclosed_strings(code, '"') {
            result.valid = false;
            result.errors.push("Unclosed string literal".to_string());
        }

        // Check for common Rust patterns
        if code.contains("fn ") && !code.contains("{") {
            result = result.with_warning("Function definition without body".to_string());
        }

        // Check for lifetime issues
        if code.contains("'") && code.contains("fn ") {
            let single_quotes = code.matches('\'').count();
            if single_quotes % 2 != 0 && !code.contains("'static") {
                result = result.with_warning("Possible lifetime syntax issue".to_string());
            }
        }

        Ok(result)
    }

    fn validate_rust_compilation(&self, code: &str) -> Result<ValidationResult> {
        // First check syntax
        let syntax_result = self.validate_rust_syntax(code)?;
        if !syntax_result.valid {
            return Ok(syntax_result);
        }

        let mut result = ValidationResult::success();

        // Check for common compilation issues
        if code.contains("unwrap()") {
            result = result.with_warning("Using unwrap() - consider proper error handling".to_string());
        }

        if code.contains("use ") && !code.contains("::") && !code.contains("*") {
            result = result.with_warning("Possible incomplete use statement".to_string());
        }

        // Check for struct definitions
        if code.contains("struct ") && !code.contains("{") {
            result.valid = false;
            result.errors.push("Struct definition without body".to_string());
        }

        Ok(result)
    }

    // Python validation
    fn validate_python_syntax(&self, code: &str) -> Result<ValidationResult> {
        let mut result = ValidationResult::success();

        // Check balanced parentheses
        if !self.check_balanced_delimiters(code, '(', ')') {
            result.valid = false;
            result.errors.push("Mismatched parentheses".to_string());
        }

        // Check balanced brackets
        if !self.check_balanced_delimiters(code, '[', ']') {
            result.valid = false;
            result.errors.push("Mismatched square brackets".to_string());
        }

        // Check for unclosed strings
        if self.has_unclosed_strings(code, '"') || self.has_unclosed_strings(code, '\'') {
            result.valid = false;
            result.errors.push("Unclosed string literal".to_string());
        }

        // Check for indentation issues (basic check)
        let lines: Vec<&str> = code.lines().collect();
        for (i, line) in lines.iter().enumerate() {
            if line.trim_start().starts_with("def ") || line.trim_start().starts_with("class ") {
                if i + 1 < lines.len() {
                    let current_indent = line.len() - line.trim_start().len();
                    let next_indent = lines[i + 1].len() - lines[i + 1].trim_start().len();

                    if !lines[i + 1].trim().is_empty() && next_indent <= current_indent {
                        result = result.with_warning("Possible indentation issue after definition".to_string());
                    }
                }
            }
        }

        Ok(result)
    }

    fn validate_python_compilation(&self, code: &str) -> Result<ValidationResult> {
        // First check syntax
        let syntax_result = self.validate_python_syntax(code)?;
        if !syntax_result.valid {
            return Ok(syntax_result);
        }

        let result = ValidationResult::success();

        // Check for common issues
        if code.contains("import ") && code.contains("from ") {
            // from X import Y - this is fine
        } else if code.contains("import ") {
            // import X - this is also fine
        }

        Ok(result)
    }

    // Helper methods
    fn check_balanced_delimiters(&self, code: &str, open: char, close: char) -> bool {
        let mut count = 0;
        let mut in_string = false;
        let mut string_char = ' ';

        for ch in code.chars() {
            // Track string state
            if (ch == '"' || ch == '\'') && !in_string {
                in_string = true;
                string_char = ch;
            } else if ch == string_char && in_string {
                in_string = false;
            }

            // Count delimiters outside strings
            if !in_string {
                if ch == open {
                    count += 1;
                } else if ch == close {
                    count -= 1;
                    if count < 0 {
                        return false;
                    }
                }
            }
        }

        count == 0
    }

    fn has_unclosed_strings(&self, code: &str, quote: char) -> bool {
        let mut in_string = false;
        let mut escape_next = false;

        for ch in code.chars() {
            if escape_next {
                escape_next = false;
                continue;
            }

            if ch == '\\' {
                escape_next = true;
                continue;
            }

            if ch == quote {
                in_string = !in_string;
            }
        }

        in_string
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_empty_code() {
        let validator = ExampleValidator::new("typescript".to_string());
        let result = validator.validate_syntax("").unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("empty")));
    }

    #[test]
    fn test_validate_js_syntax_success() {
        let validator = ExampleValidator::new("typescript".to_string());
        let code = "const x = { test: 1 };";
        let result = validator.validate_syntax(code).unwrap();

        assert!(result.valid);
    }

    #[test]
    fn test_validate_js_mismatched_braces() {
        let validator = ExampleValidator::new("typescript".to_string());
        let code = "const x = { test: 1;";
        let result = validator.validate_syntax(code).unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("braces")));
    }

    #[test]
    fn test_validate_js_mismatched_parens() {
        let validator = ExampleValidator::new("typescript".to_string());
        let code = "function test((x) { }";
        let result = validator.validate_syntax(code).unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("parentheses")));
    }

    #[test]
    fn test_validate_js_unclosed_string() {
        let validator = ExampleValidator::new("typescript".to_string());
        let code = "const x = \"unclosed;";
        let result = validator.validate_syntax(code).unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("string")));
    }

    #[test]
    fn test_validate_js_await_outside_async() {
        let validator = ExampleValidator::new("typescript".to_string());
        let code = "const x = await fetch();";
        let result = validator.validate_compilation(code).unwrap();

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("await")));
    }

    #[test]
    fn test_validate_rust_syntax_success() {
        let validator = ExampleValidator::new("rust".to_string());
        let code = "fn test() { let x = 1; }";
        let result = validator.validate_syntax(code).unwrap();

        assert!(result.valid);
    }

    #[test]
    fn test_validate_rust_unclosed_string() {
        let validator = ExampleValidator::new("rust".to_string());
        let code = "let x = \"unclosed;";
        let result = validator.validate_syntax(code).unwrap();

        assert!(!result.valid);
    }

    #[test]
    fn test_validate_rust_unwrap_warning() {
        let validator = ExampleValidator::new("rust".to_string());
        let code = "let x = some_func().unwrap();";
        let result = validator.validate_compilation(code).unwrap();

        assert!(result.valid);
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn test_validate_python_syntax_success() {
        let validator = ExampleValidator::new("python".to_string());
        let code = "def test():\n    return 1";
        let result = validator.validate_syntax(code).unwrap();

        assert!(result.valid);
    }

    #[test]
    fn test_validate_python_mismatched_parens() {
        let validator = ExampleValidator::new("python".to_string());
        let code = "def test((x):\n    pass";
        let result = validator.validate_syntax(code).unwrap();

        assert!(!result.valid);
    }

    #[test]
    fn test_validate_unsupported_language() {
        let validator = ExampleValidator::new("cobol".to_string());
        let code = "some code";
        let result = validator.validate_syntax(code).unwrap();

        assert!(result.valid);
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn test_balanced_delimiters() {
        let validator = ExampleValidator::new("typescript".to_string());

        assert!(validator.check_balanced_delimiters("{ { } }", '{', '}'));
        assert!(!validator.check_balanced_delimiters("{ { }", '{', '}'));
        assert!(!validator.check_balanced_delimiters("} {", '{', '}'));
    }

    #[test]
    fn test_balanced_delimiters_in_strings() {
        let validator = ExampleValidator::new("typescript".to_string());

        // Braces in strings should be ignored
        assert!(validator.check_balanced_delimiters("{ const x = \"{\" }", '{', '}'));
    }
}
