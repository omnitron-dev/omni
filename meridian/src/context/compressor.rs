use crate::types::CompressionStrategy;
use anyhow::Result;
use regex::Regex;

/// Result of compression
#[derive(Debug, Clone)]
pub struct CompressedContent {
    pub content: String,
    pub ratio: f32,
    pub quality_score: f32,
}

/// Multi-level context compressor
pub struct ContextCompressor {
    #[allow(dead_code)]
    quality_threshold: f32,
}

impl ContextCompressor {
    pub fn new(quality_threshold: f32) -> Self {
        Self { quality_threshold }
    }

    /// Compress content using specified strategy
    pub fn compress(
        &self,
        content: &str,
        strategy: CompressionStrategy,
        target_tokens: usize,
    ) -> Result<CompressedContent> {
        let original_tokens = self.count_tokens(content);

        // Apply compression strategy (don't skip even if content is small)
        let compressed = match strategy {
            CompressionStrategy::None => content.to_string(),
            CompressionStrategy::RemoveComments => self.remove_comments(content),
            CompressionStrategy::RemoveWhitespace => self.minimize_whitespace(content),
            CompressionStrategy::AbstractToSignatures | CompressionStrategy::Skeleton => {
                self.extract_signatures(content)
            }
            CompressionStrategy::Summarize | CompressionStrategy::Summary => {
                self.summarize(content)
            }
            CompressionStrategy::ExtractKeyPoints => self.extract_key_points(content),
            CompressionStrategy::TreeShaking => self.tree_shake(content),
            CompressionStrategy::Hybrid => self.hybrid_compress(content, target_tokens),
            CompressionStrategy::UltraCompact => self.ultra_compact(content),
        };

        let compressed_tokens = self.count_tokens(&compressed);
        let ratio = if original_tokens > 0 {
            compressed_tokens as f32 / original_tokens as f32
        } else {
            1.0
        };
        let quality = self.assess_quality(&compressed, content);

        // If still over budget, apply additional compression
        let final_content = if compressed_tokens > target_tokens as u32 {
            self.truncate_to_budget(&compressed, target_tokens)
        } else {
            compressed
        };

        Ok(CompressedContent {
            content: final_content,
            ratio,
            quality_score: quality,
        })
    }

    /// Remove comments from code
    fn remove_comments(&self, content: &str) -> String {
        let mut result = String::new();
        let mut in_block_comment = false;

        for line in content.lines() {
            let trimmed = line.trim();

            // Skip line comments entirely
            if trimmed.starts_with("//") || trimmed.starts_with("#") {
                continue;
            }

            // Handle single-line block comments (/* ... */ on same line)
            if trimmed.contains("/*") && trimmed.contains("*/") {
                let mut clean = line.to_string();
                while let Some(start) = clean.find("/*") {
                    if let Some(end) = clean[start..].find("*/") {
                        clean = clean[..start].to_string() + &clean[start + end + 2..];
                    } else {
                        break;
                    }
                }
                if !clean.trim().is_empty() {
                    result.push_str(&clean);
                    result.push('\n');
                }
                continue;
            }

            // Handle multi-line block comments start
            if trimmed.starts_with("/*") || line.contains("/*") {
                in_block_comment = true;
            }

            if in_block_comment {
                if trimmed.ends_with("*/") || line.contains("*/") {
                    in_block_comment = false;
                }
                continue;
            }

            // Remove inline comments
            let clean_line = if let Some(pos) = line.find("//") {
                &line[..pos]
            } else {
                line
            };

            if !clean_line.trim().is_empty() {
                result.push_str(clean_line);
                result.push('\n');
            }
        }

        result
    }

    /// Minimize whitespace
    fn minimize_whitespace(&self, content: &str) -> String {
        let re = Regex::new(r"\s+").unwrap();
        let mut result = String::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let minimized = re.replace_all(trimmed, " ");
                result.push_str(&minimized);
                result.push('\n');
            }
        }

        result
    }

    /// Extract only function/method signatures
    fn extract_signatures(&self, content: &str) -> String {
        let mut signatures = Vec::new();
        let mut current_signature = String::new();
        let mut brace_count = 0;
        let mut in_signature = false;

        for line in content.lines() {
            let trimmed = line.trim();

            // Detect start of function/method/struct/class
            if (trimmed.starts_with("fn ")
                || trimmed.starts_with("pub fn ")
                || trimmed.starts_with("async fn ")
                || trimmed.starts_with("pub async fn ")
                || trimmed.starts_with("struct ")
                || trimmed.starts_with("pub struct ")
                || trimmed.starts_with("enum ")
                || trimmed.starts_with("pub enum ")
                || trimmed.starts_with("trait ")
                || trimmed.starts_with("pub trait ")
                || trimmed.starts_with("impl ")
                || trimmed.starts_with("class ")
                || trimmed.starts_with("interface ")
                || trimmed.starts_with("function "))
                && !in_signature
            {
                in_signature = true;
                current_signature.clear();
            }

            if in_signature {
                current_signature.push_str(trimmed);
                current_signature.push(' ');

                // Count braces to find end of signature
                for ch in trimmed.chars() {
                    match ch {
                        '{' => {
                            brace_count += 1;
                            if brace_count == 1 {
                                // End of signature
                                signatures.push(current_signature.clone());
                                in_signature = false;
                                current_signature.clear();
                                break;
                            }
                        }
                        ';' if brace_count == 0 => {
                            // Trait method or declaration
                            signatures.push(current_signature.clone());
                            in_signature = false;
                            current_signature.clear();
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        signatures.join("\n")
    }

    /// Generate natural language summary
    fn summarize(&self, content: &str) -> String {
        let mut summary = Vec::new();

        // Extract main structures
        let mut structures = Vec::new();
        let mut functions = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with("struct ") || trimmed.starts_with("pub struct ") {
                if let Some(name) = Self::extract_name(trimmed, "struct") {
                    structures.push(name);
                }
            } else if trimmed.starts_with("fn ") || trimmed.starts_with("pub fn ") {
                if let Some(name) = Self::extract_name(trimmed, "fn") {
                    functions.push(name);
                }
            }
        }

        if !structures.is_empty() {
            summary.push(format!("Structures: {}", structures.join(", ")));
        }

        if !functions.is_empty() {
            summary.push(format!("Functions: {}", functions.join(", ")));
        }

        summary.join("\n")
    }

    /// Extract key points (important lines)
    fn extract_key_points(&self, content: &str) -> String {
        let keywords = [
            "struct", "enum", "trait", "impl", "fn", "pub", "class", "interface", "function",
        ];

        let mut key_lines = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if keywords.iter().any(|&kw| trimmed.starts_with(kw)) {
                key_lines.push(line.to_string());
            }
        }

        key_lines.join("\n")
    }

    /// Remove unused code paths
    fn tree_shake(&self, content: &str) -> String {
        // Simple tree shaking: remove obviously dead code
        let mut result = Vec::new();
        let mut skip_block = false;
        let mut brace_depth = 0;

        for line in content.lines() {
            let trimmed = line.trim();

            // Skip clearly dead code blocks
            if trimmed.starts_with("if false") || trimmed.starts_with("if (false)") {
                skip_block = true;
                brace_depth = 0;
            }

            if skip_block {
                for ch in trimmed.chars() {
                    match ch {
                        '{' => brace_depth += 1,
                        '}' => {
                            brace_depth -= 1;
                            if brace_depth == 0 {
                                skip_block = false;
                            }
                        }
                        _ => {}
                    }
                }
                continue;
            }

            result.push(line.to_string());
        }

        result.join("\n")
    }

    /// Hybrid compression using multiple strategies
    fn hybrid_compress(&self, content: &str, target_tokens: usize) -> String {
        // Apply strategies in order until target is met
        let mut result = content.to_string();

        // 1. Remove comments
        result = self.remove_comments(&result);
        if self.count_tokens(&result) <= target_tokens as u32 {
            return result;
        }

        // 2. Minimize whitespace
        result = self.minimize_whitespace(&result);
        if self.count_tokens(&result) <= target_tokens as u32 {
            return result;
        }

        // 3. Tree shaking
        result = self.tree_shake(&result);
        if self.count_tokens(&result) <= target_tokens as u32 {
            return result;
        }

        // 4. Extract signatures only
        result = self.extract_signatures(&result);

        result
    }

    /// Ultra compact compression
    fn ultra_compact(&self, content: &str) -> String {
        let summary = self.summarize(content);
        if summary.is_empty() {
            self.extract_key_points(content)
        } else {
            summary
        }
    }

    /// Truncate content to fit token budget
    fn truncate_to_budget(&self, content: &str, target_tokens: usize) -> String {
        let chars_per_token = 4;
        let target_chars = target_tokens * chars_per_token;

        if content.len() <= target_chars {
            return content.to_string();
        }

        let truncated = &content[..target_chars];
        let mut result = String::from(truncated);
        result.push_str("\n... [truncated]");
        result
    }

    /// Assess quality of compression
    fn assess_quality(&self, compressed: &str, original: &str) -> f32 {
        let original_len = original.len() as f32;
        let compressed_len = compressed.len() as f32;

        if original_len == 0.0 {
            return 1.0;
        }

        // Quality based on ratio and preserved key elements
        let ratio = compressed_len / original_len;

        // Check for preserved key elements
        let mut preserved_score = 0.0;
        let keywords = ["fn", "struct", "impl", "pub", "trait"];

        for keyword in &keywords {
            let original_count = original.matches(keyword).count() as f32;
            let compressed_count = compressed.matches(keyword).count() as f32;

            if original_count > 0.0 {
                preserved_score += compressed_count / original_count;
            }
        }

        let preservation = (preserved_score / keywords.len() as f32).min(1.0);

        // Weighted combination
        0.3 * ratio + 0.7 * preservation
    }

    /// Count tokens (rough estimation)
    fn count_tokens(&self, content: &str) -> u32 {
        // Rough estimation: ~4 chars per token
        (content.len() / 4) as u32
    }

    fn extract_name(line: &str, keyword: &str) -> Option<String> {
        let parts: Vec<&str> = line.split_whitespace().collect();
        for (i, part) in parts.iter().enumerate() {
            if *part == keyword && i + 1 < parts.len() {
                let name = parts[i + 1].trim_end_matches(['{', '(', '<']);
                return Some(name.to_string());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remove_comments() {
        let compressor = ContextCompressor::new(0.7);
        let code = r#"
// This is a comment
fn main() {
    // Another comment
    println!("Hello"); // Inline comment
}
"#;
        let result = compressor.remove_comments(code);
        assert!(!result.contains("// This is a comment"));
        assert!(!result.contains("// Another comment"));
        assert!(!result.contains("// Inline comment"));
        assert!(result.contains("fn main()"));
    }

    #[test]
    fn test_minimize_whitespace() {
        let compressor = ContextCompressor::new(0.7);
        let code = "fn    main()   {\n    println!(\"Hello\");\n}";
        let result = compressor.minimize_whitespace(code);
        assert!(result.len() < code.len());
        assert!(result.contains("fn main()"));
    }

    #[test]
    fn test_extract_signatures() {
        let compressor = ContextCompressor::new(0.7);
        let code = r#"
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub struct Point {
    x: i32,
    y: i32,
}
"#;
        let result = compressor.extract_signatures(code);
        // Check that we extracted something meaningful
        assert!(!result.is_empty(), "Signature extraction should produce output");
        // The body should not be included
        assert!(!result.contains("a + b"), "Implementation details should not be in signatures");
    }

    #[test]
    fn test_summarize() {
        let compressor = ContextCompressor::new(0.7);
        let code = r#"
struct Point { x: i32 }
fn add(a: i32) -> i32 { a }
fn sub(a: i32) -> i32 { a }
"#;
        let result = compressor.summarize(code);
        // Check that the summary contains key information
        assert!(
            result.contains("Point") || result.contains("add") || result.contains("sub"),
            "Summary should contain at least one symbol"
        );
    }

    #[test]
    fn test_compress_with_target() {
        let compressor = ContextCompressor::new(0.7);
        let code = "fn main() {\n    // Comment\n    println!(\"Hello\");\n}";
        let result = compressor
            .compress(code, CompressionStrategy::RemoveComments, 100)
            .unwrap();
        // Verify compression produced valid output
        assert!(result.quality_score >= 0.0);
        assert!(!result.content.is_empty());
    }

    #[test]
    fn test_hybrid_compress() {
        let compressor = ContextCompressor::new(0.7);
        let code = r#"
// Comment
fn main() {
    // Another comment
    let x   =   5;
    println!("{}", x);
}
"#;
        let result = compressor.hybrid_compress(code, 20);
        assert!(result.len() < code.len());
    }

    #[test]
    fn test_quality_assessment() {
        let compressor = ContextCompressor::new(0.7);
        let original = "fn main() { println!(\"Hello\"); }";
        let compressed = "fn main()";

        let quality = compressor.assess_quality(compressed, original);
        assert!(quality > 0.0 && quality <= 1.0);
    }
}
