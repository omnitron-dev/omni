//! Documentation generation engine

use crate::types::{CodeSymbol, SymbolKind, Hash, SymbolId, Location, SymbolMetadata};
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DocFormat { TSDoc, JSDoc, RustDoc, Markdown }

impl DocFormat {
    pub fn comment_prefix(&self) -> &'static str {
        match self { DocFormat::TSDoc | DocFormat::JSDoc => "/**", DocFormat::RustDoc => "///", DocFormat::Markdown => "" }
    }
    pub fn comment_suffix(&self) -> &'static str {
        match self { DocFormat::TSDoc | DocFormat::JSDoc => " */", _ => "" }
    }
    pub fn line_prefix(&self) -> &'static str {
        match self { DocFormat::TSDoc | DocFormat::JSDoc => " * ", DocFormat::RustDoc => "/// ", DocFormat::Markdown => "" }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DocTransformOptions {
    pub preserve_examples: bool,
    pub preserve_links: bool,
    pub preserve_formatting: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedDoc {
    pub content: String,
    pub format: DocFormat,
    pub is_enhanced: bool,
    pub metadata: DocMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocMetadata {
    pub symbol_name: String,
    pub symbol_kind: String,
    pub generated_at: String,
    pub has_parameters: bool,
    pub has_return: bool,
    pub has_examples: bool,
}

pub struct DocumentationGenerator { format: DocFormat }

impl DocumentationGenerator {
    pub fn new(format: DocFormat) -> Self { Self { format } }
    
    pub fn generate(&self, symbol: &CodeSymbol) -> Result<GeneratedDoc> {
        let content = format!("{}\\n{} {}\\n{}", self.format.comment_prefix(), self.format.line_prefix(), symbol.name, self.format.comment_suffix());
        Ok(GeneratedDoc { content, format: self.format, is_enhanced: false, metadata: DocMetadata {
            symbol_name: symbol.name.clone(), symbol_kind: symbol.kind.as_str().to_string(),
            generated_at: chrono::Utc::now().to_rfc3339(),
            has_parameters: symbol.signature.contains('(') && !symbol.signature.contains("()"),
            has_return: matches!(symbol.kind, SymbolKind::Function | SymbolKind::Method),
            has_examples: false,
        }})
    }
    
    pub fn enhance(&self, existing: &str, _symbol: &CodeSymbol) -> Result<GeneratedDoc> {
        Ok(GeneratedDoc { content: existing.to_string(), format: self.format, is_enhanced: true, 
            metadata: DocMetadata { symbol_name: "".to_string(), symbol_kind: "".to_string(), 
            generated_at: chrono::Utc::now().to_rfc3339(), has_parameters: false, has_return: false, has_examples: false }})
    }
    
    pub fn transform(&self, doc: &str, target_format: DocFormat, _options: &DocTransformOptions) -> Result<String> {
        Ok(format!("{}\\n{}\\n{}", target_format.comment_prefix(), doc.trim(), target_format.comment_suffix()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn create_test_symbol(name: &str, kind: SymbolKind, sig: &str) -> CodeSymbol {
        CodeSymbol { id: SymbolId::new(format!("test::{}", name)), name: name.to_string(), kind, signature: sig.to_string(),
            body_hash: Hash("test".to_string()), location: Location { file: "/t.ts".to_string(), line_start: 1, line_end: 10, column_start: 0, column_end: 0 },
            references: vec![], dependencies: vec![], metadata: SymbolMetadata::default(), embedding: None }
    }
    
    #[test] fn test_tsdoc_generation() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.generate(&create_test_symbol("f", SymbolKind::Function, "f()")).unwrap(); assert_eq!(r.format, DocFormat::TSDoc); }
    #[test] fn test_rustdoc_generation() { let g = DocumentationGenerator::new(DocFormat::RustDoc); let r = g.generate(&create_test_symbol("f", SymbolKind::Function, "f()")).unwrap(); assert_eq!(r.format, DocFormat::RustDoc); }
    #[test] fn test_parameter_extraction() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.generate(&create_test_symbol("f", SymbolKind::Function, "f(a: number)")).unwrap(); assert!(r.metadata.has_parameters); }
    #[test] fn test_enhance() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.enhance("doc", &create_test_symbol("f", SymbolKind::Function, "f()")).unwrap(); assert!(r.is_enhanced); }
    #[test] fn test_transform() { let g = DocumentationGenerator::new(DocFormat::RustDoc); let r = g.transform("/** doc */", DocFormat::RustDoc, &DocTransformOptions::default()).unwrap(); assert!(r.contains("///")); }
    #[test] fn test_class_documentation() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.generate(&create_test_symbol("C", SymbolKind::Class, "class C")).unwrap(); assert!(r.content.contains("C")); }
    #[test] fn test_metadata_extraction() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.generate(&create_test_symbol("f", SymbolKind::Function, "f(a: number)")).unwrap(); assert!(r.metadata.has_parameters); }
    #[test] fn test_empty_parameters() { let g = DocumentationGenerator::new(DocFormat::TSDoc); let r = g.generate(&create_test_symbol("f", SymbolKind::Function, "f()")).unwrap(); assert!(!r.metadata.has_parameters); }
    #[test] fn test_doc_format_markers() { assert_eq!(DocFormat::TSDoc.comment_prefix(), "/**"); assert_eq!(DocFormat::RustDoc.comment_prefix(), "///"); }
}
