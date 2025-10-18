use anyhow::Result;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};

/// Markdown document structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkdownDocument {
    pub path: String,
    pub title: String,
    pub sections: Vec<Section>,
    pub metadata: SpecMetadata,
    pub table_of_contents: Vec<TocEntry>,
    pub links: Vec<Link>,
    pub code_blocks: Vec<CodeBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub level: usize,
    pub title: String,
    pub content: String,
    pub line_start: usize,
    pub line_end: usize,
    pub subsections: Vec<Section>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SpecMetadata {
    pub version: Option<String>,
    pub status: Option<String>,
    pub date: Option<String>,
    pub authors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TocEntry {
    pub level: usize,
    pub title: String,
    pub anchor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub text: String,
    pub url: String,
    pub is_internal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeBlock {
    pub language: Option<String>,
    pub code: String,
    pub line_start: usize,
}

pub struct MarkdownAnalyzer;

impl MarkdownAnalyzer {
    /// Parse a markdown file with full structure analysis
    pub fn parse(path: &str, content: &str) -> Result<MarkdownDocument> {
        let mut options = Options::empty();
        options.insert(Options::ENABLE_TABLES);
        options.insert(Options::ENABLE_FOOTNOTES);
        options.insert(Options::ENABLE_STRIKETHROUGH);
        options.insert(Options::ENABLE_TASKLISTS);

        let parser = Parser::new_ext(content, options);

        let mut sections = Vec::new();
        let mut current_section: Option<Section> = None;
        let mut current_level = 0;
        let mut in_code_block = false;
        let mut code_blocks = Vec::new();
        let links = Vec::new();
        let mut current_code_language: Option<String> = None;
        let mut current_code_content = String::new();
        let mut code_block_start = 0;

        for (event, range) in parser.into_offset_iter() {
            // Estimate line number from byte offset
            let current_pos = range.start;
            let line_num = content[..current_pos].lines().count();

            match event {
                Event::Start(Tag::Heading { level, .. }) => {
                    current_level = level as usize;
                }
                Event::Text(text) if current_level > 0 => {
                    let title = text.to_string();

                    // Save previous section
                    if let Some(section) = current_section.take() {
                        sections.push(section);
                    }

                    // Create new section
                    current_section = Some(Section {
                        level: current_level,
                        title: title.clone(),
                        content: String::new(),
                        line_start: line_num,
                        line_end: line_num,
                        subsections: Vec::new(),
                    });

                    current_level = 0; // Reset after processing heading
                }
                Event::Start(Tag::CodeBlock(kind)) => {
                    in_code_block = true;
                    code_block_start = line_num;
                    current_code_language = match kind {
                        pulldown_cmark::CodeBlockKind::Fenced(lang) => Some(lang.to_string()),
                        pulldown_cmark::CodeBlockKind::Indented => None,
                    };
                    current_code_content.clear();
                }
                Event::End(TagEnd::CodeBlock) => {
                    if in_code_block {
                        code_blocks.push(CodeBlock {
                            language: current_code_language.clone(),
                            code: current_code_content.clone(),
                            line_start: code_block_start,
                        });
                        in_code_block = false;
                        current_code_content.clear();
                    }
                }
                Event::Text(text) if in_code_block => {
                    current_code_content.push_str(&text);
                }
                Event::Start(Tag::Link { dest_url, .. }) => {
                    let _url = dest_url.to_string();
                    // We'll get the link text in the next Text event
                    // For now, just store the URL
                    // Link extraction is deferred to future enhancement
                }
                Event::Text(text) => {
                    // Add text to current section content
                    if let Some(ref mut section) = current_section {
                        section.content.push_str(&text);
                        section.content.push('\n');
                        section.line_end = line_num;
                    }
                }
                _ => {}
            }
        }

        // Save last section
        if let Some(section) = current_section {
            sections.push(section);
        }

        // Extract title from first heading level 1
        let title = sections
            .iter()
            .find(|s| s.level == 1)
            .map(|s| s.title.clone())
            .unwrap_or_else(|| "Untitled".to_string());

        // Extract metadata from content if available
        let metadata = Self::extract_metadata(&sections);

        // Build table of contents
        let table_of_contents = sections
            .iter()
            .map(|s| TocEntry {
                level: s.level,
                title: s.title.clone(),
                anchor: Self::title_to_anchor(&s.title),
            })
            .collect();

        Ok(MarkdownDocument {
            path: path.to_string(),
            title,
            sections,
            metadata,
            table_of_contents,
            links,
            code_blocks,
        })
    }

    /// Extract metadata from sections (version, status, date, authors)
    fn extract_metadata(sections: &[Section]) -> SpecMetadata {
        let mut metadata = SpecMetadata::default();

        for section in sections {
            let content_lower = section.content.to_lowercase();

            // Look for version
            if content_lower.contains("version:") {
                if let Some(version_line) = section
                    .content
                    .lines()
                    .find(|line| line.to_lowercase().contains("version:"))
                {
                    metadata.version = Some(
                        version_line
                            .split(':')
                            .nth(1)
                            .unwrap_or("")
                            .trim()
                            .to_string(),
                    );
                }
            }

            // Look for status
            if content_lower.contains("status:") {
                if let Some(status_line) = section
                    .content
                    .lines()
                    .find(|line| line.to_lowercase().contains("status:"))
                {
                    metadata.status = Some(
                        status_line
                            .split(':')
                            .nth(1)
                            .unwrap_or("")
                            .trim()
                            .to_string(),
                    );
                }
            }

            // Look for date
            if content_lower.contains("date:") {
                if let Some(date_line) = section
                    .content
                    .lines()
                    .find(|line| line.to_lowercase().contains("date:"))
                {
                    metadata.date = Some(
                        date_line
                            .split(':')
                            .nth(1)
                            .unwrap_or("")
                            .trim()
                            .to_string(),
                    );
                }
            }

            // Look for authors
            if content_lower.contains("author") {
                for line in section.content.lines() {
                    if line.to_lowercase().contains("author") {
                        if let Some(author) = line.split(':').nth(1) {
                            metadata.authors.push(author.trim().to_string());
                        }
                    }
                }
            }
        }

        metadata
    }

    /// Convert title to anchor (GitHub-style)
    fn title_to_anchor(title: &str) -> String {
        title
            .to_lowercase()
            .replace(' ', "-")
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-')
            .collect()
    }

    /// Extract a specific section by name
    pub fn extract_section<'a>(doc: &'a MarkdownDocument, section_name: &str) -> Option<&'a Section> {
        Self::find_section_recursive(&doc.sections, section_name)
    }

    /// Recursively find a section by name
    fn find_section_recursive<'a>(sections: &'a [Section], name: &str) -> Option<&'a Section> {
        for section in sections {
            if section.title.to_lowercase().contains(&name.to_lowercase()) {
                return Some(section);
            }
            if let Some(found) = Self::find_section_recursive(&section.subsections, name) {
                return Some(found);
            }
        }
        None
    }

    /// Get a structure summary of the document
    pub fn get_structure_summary(doc: &MarkdownDocument) -> String {
        let mut summary = format!("# {}\n\n", doc.title);
        summary.push_str(&format!("**Path:** {}\n", doc.path));

        if let Some(ref version) = doc.metadata.version {
            summary.push_str(&format!("**Version:** {}\n", version));
        }
        if let Some(ref status) = doc.metadata.status {
            summary.push_str(&format!("**Status:** {}\n", status));
        }
        if let Some(ref date) = doc.metadata.date {
            summary.push_str(&format!("**Date:** {}\n", date));
        }

        summary.push_str(&format!("\n**Sections:** {}\n", doc.sections.len()));
        summary.push_str(&format!("**Code Blocks:** {}\n", doc.code_blocks.len()));
        summary.push_str(&format!("**Links:** {}\n\n", doc.links.len()));

        summary.push_str("## Table of Contents:\n\n");
        for entry in &doc.table_of_contents {
            let indent = "  ".repeat(entry.level.saturating_sub(1));
            summary.push_str(&format!("{}{} {}\n", indent, "-", entry.title));
        }

        summary
    }

    /// Search for text within the document
    pub fn search(doc: &MarkdownDocument, query: &str) -> Vec<SearchResult> {
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        for section in &doc.sections {
            if section.title.to_lowercase().contains(&query_lower)
                || section.content.to_lowercase().contains(&query_lower)
            {
                results.push(SearchResult {
                    section_title: section.title.clone(),
                    line_start: section.line_start,
                    line_end: section.line_end,
                    snippet: Self::extract_snippet(&section.content, query, 100),
                });
            }
        }

        results
    }

    /// Extract a snippet around the query match
    fn extract_snippet(content: &str, query: &str, context_chars: usize) -> String {
        let query_lower = query.to_lowercase();
        let content_lower = content.to_lowercase();

        if let Some(pos) = content_lower.find(&query_lower) {
            let start = pos.saturating_sub(context_chars);
            let end = (pos + query.len() + context_chars).min(content.len());
            let snippet = &content[start..end];

            format!("...{}...", snippet.trim())
        } else {
            content.lines().next().unwrap_or("").to_string()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub section_title: String,
    pub line_start: usize,
    pub line_end: usize,
    pub snippet: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown() {
        let content = r#"# Test Document

This is a test.

## Section 1

Content for section 1.

### Subsection 1.1

Nested content.

## Section 2

More content here.

```rust
fn main() {
    println!("Hello");
}
```
"#;

        let doc = MarkdownAnalyzer::parse("test.md", content).unwrap();

        assert_eq!(doc.title, "Test Document");
        assert!(doc.sections.len() >= 3);
        assert_eq!(doc.code_blocks.len(), 1);
        assert_eq!(doc.code_blocks[0].language, Some("rust".to_string()));
    }

    #[test]
    fn test_extract_section() {
        let content = r#"# Main Title

## Introduction

This is the intro.

## Details

Detailed information.
"#;

        let doc = MarkdownAnalyzer::parse("test.md", content).unwrap();
        let section = MarkdownAnalyzer::extract_section(&doc, "introduction");

        assert!(section.is_some());
        assert_eq!(section.unwrap().title, "Introduction");
    }

    #[test]
    fn test_search() {
        let content = r#"# Test

## Section A

Finding this text.

## Section B

Other content.
"#;

        let doc = MarkdownAnalyzer::parse("test.md", content).unwrap();
        let results = MarkdownAnalyzer::search(&doc, "Finding");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].section_title, "Section A");
    }

    #[test]
    fn test_metadata_extraction() {
        let content = r#"# Specification

Version: 1.0.0
Status: Draft
Date: 2025-10-18

## Content

Details here.
"#;

        let doc = MarkdownAnalyzer::parse("test.md", content).unwrap();

        assert_eq!(doc.metadata.version, Some("1.0.0".to_string()));
        assert_eq!(doc.metadata.status, Some("Draft".to_string()));
        assert_eq!(doc.metadata.date, Some("2025-10-18".to_string()));
    }
}
