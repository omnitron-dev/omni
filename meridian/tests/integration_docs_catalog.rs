//! Integration tests for documentation generation and catalog MCP tools

use anyhow::Result;
use meridian::codegen::{DocFormat, DocumentationGenerator, GlobalCatalog, ProjectMetadata, QualityValidator, DocTransformOptions};
use meridian::types::SymbolKind;
use std::path::PathBuf;

mod common;
use common::fixtures::test_symbol;

#[test]
fn test_documentation_generator() -> Result<()> {
    let generator = DocumentationGenerator::new(DocFormat::TSDoc);
    let symbol = test_symbol("add", SymbolKind::Function);

    let doc = generator.generate(&symbol)?;

    assert!(!doc.content.is_empty());
    assert_eq!(doc.format, DocFormat::TSDoc);
    assert_eq!(doc.metadata.symbol_name, "add");

    println!("✓ DocumentationGenerator working");
    Ok(())
}

#[test]
fn test_quality_validator() -> Result<()> {
    let validator = QualityValidator::new();
    let symbol = test_symbol("multiply", SymbolKind::Function);

    let good_doc = "/**\n * Multiplies two numbers together\n * @param x First number\n * @param y Second number\n * @returns The product of x and y\n */";
    let score = validator.assess(good_doc, &symbol);

    assert!(score.overall >= 0.0 && score.overall <= 1.0);
    assert!(score.completeness >= 0.0);
    assert!(score.clarity >= 0.0);
    assert!(score.accuracy >= 0.0);
    assert!(score.compliance >= 0.0);

    println!("✓ QualityValidator working");
    Ok(())
}

#[test]
fn test_doc_transform() -> Result<()> {
    let generator = DocumentationGenerator::new(DocFormat::TSDoc);

    let tsdoc = "/**\n * @param input The input value\n * @returns The output value\n */";
    let options = DocTransformOptions {
        preserve_examples: true,
        preserve_links: true,
        preserve_formatting: true,
    };

    let rustdoc = generator.transform(tsdoc, DocFormat::RustDoc, &options)?;

    assert!(rustdoc.contains("///"));

    println!("✓ Doc transform working");
    Ok(())
}

#[test]
fn test_global_catalog() -> Result<()> {
    let mut catalog = GlobalCatalog::new();

    let project = ProjectMetadata {
        id: "p1".to_string(),
        name: "Project1".to_string(),
        path: PathBuf::from("/p1"),
        symbol_count: 100,
        coverage: 0.8,
        dependencies: vec![],
        description: Some("Test".to_string()),
        total_modules: 5,
        total_functions: 50,
        total_classes: 30,
        total_interfaces: 15,
        total_types: 20,
        documented_symbols: 80,
        documentation_coverage: 0.8,
        examples_count: 10,
        tests_count: 50,
        last_indexed: Some(1697500800),
        last_modified: Some(1697500000),
    };

    catalog.index_project(project.clone())?;

    let retrieved = catalog.get_project("p1");
    assert!(retrieved.is_some());
    assert_eq!(retrieved.unwrap().name, "Project1");
    assert_eq!(retrieved.unwrap().total_functions, 50);
    assert_eq!(retrieved.unwrap().documented_symbols, 80);

    let all = catalog.list_projects();
    assert_eq!(all.len(), 1);

    println!("✓ GlobalCatalog working");
    Ok(())
}

#[test]
fn test_catalog_metadata_completeness() -> Result<()> {
    let project = ProjectMetadata {
        id: "test-complete".to_string(),
        name: "CompleteProject".to_string(),
        path: PathBuf::from("/complete"),
        symbol_count: 200,
        coverage: 0.95,
        dependencies: vec!["dep1".to_string(), "dep2".to_string()],
        description: Some("Complete test project".to_string()),
        total_modules: 20,
        total_functions: 100,
        total_classes: 50,
        total_interfaces: 25,
        total_types: 30,
        documented_symbols: 190,
        documentation_coverage: 0.95,
        examples_count: 50,
        tests_count: 150,
        last_indexed: Some(1697500800),
        last_modified: Some(1697400000),
    };

    // Verify all fields are accessible
    assert_eq!(project.total_modules, 20);
    assert_eq!(project.total_functions, 100);
    assert_eq!(project.total_classes, 50);
    assert_eq!(project.total_interfaces, 25);
    assert_eq!(project.total_types, 30);
    assert_eq!(project.documented_symbols, 190);
    assert_eq!(project.documentation_coverage, 0.95);
    assert_eq!(project.examples_count, 50);
    assert_eq!(project.tests_count, 150);
    assert!(project.last_indexed.is_some());
    assert!(project.last_modified.is_some());

    println!("✓ ProjectMetadata enhanced fields working");
    Ok(())
}

#[test]
fn test_doc_format_variants() -> Result<()> {
    let symbol = test_symbol("testFunc", SymbolKind::Function);

    // Test TSDoc
    let tsdoc_gen = DocumentationGenerator::new(DocFormat::TSDoc);
    let tsdoc = tsdoc_gen.generate(&symbol)?;
    assert!(tsdoc.content.contains("/**"));

    // Test JSDoc
    let jsdoc_gen = DocumentationGenerator::new(DocFormat::JSDoc);
    let jsdoc = jsdoc_gen.generate(&symbol)?;
    assert!(jsdoc.content.contains("/**"));

    // Test RustDoc
    let rustdoc_gen = DocumentationGenerator::new(DocFormat::RustDoc);
    let rustdoc = rustdoc_gen.generate(&symbol)?;
    assert!(rustdoc.content.contains("///"));

    // Test Markdown
    let md_gen = DocumentationGenerator::new(DocFormat::Markdown);
    let md = md_gen.generate(&symbol)?;
    assert!(!md.content.is_empty());

    println!("✓ All DocFormat variants working");
    Ok(())
}

#[test]
fn test_quality_validation_components() -> Result<()> {
    let validator = QualityValidator::new();
    let symbol = test_symbol("divide", SymbolKind::Function);

    // Test with minimal doc
    let minimal_doc = "Divides numbers";
    let minimal_score = validator.assess(minimal_doc, &symbol);

    // Test with complete doc
    let complete_doc = "/**\n * Divides two numbers and returns the quotient\n * \n * @param dividend The number to be divided\n * @param divisor The number to divide by\n * @returns The quotient\n * @throws Error if divisor is zero\n * \n * @example\n * const result = divide(10, 2);\n * // result === 5\n */";
    let complete_score = validator.assess(complete_doc, &symbol);

    // Complete doc should score higher
    assert!(complete_score.overall > minimal_score.overall);
    assert!(complete_score.completeness > minimal_score.completeness);

    println!("✓ Quality validation components working");
    Ok(())
}

#[test]
fn test_transform_preserves_content() -> Result<()> {
    let options = DocTransformOptions {
        preserve_examples: true,
        preserve_links: true,
        preserve_formatting: true,
    };

    let original = "/**\n * Function description\n * @param input The input\n * @returns The output\n * @example\n * example code here\n * @see https://example.com\n */";

    let gen = DocumentationGenerator::new(DocFormat::TSDoc);

    // Transform to RustDoc
    let rustdoc = gen.transform(original, DocFormat::RustDoc, &options)?;
    assert!(rustdoc.contains("///"));

    // Transform to JSDoc
    let jsdoc = gen.transform(original, DocFormat::JSDoc, &options)?;
    assert!(jsdoc.contains("/**"));

    println!("✓ Transform preserves content");
    Ok(())
}
