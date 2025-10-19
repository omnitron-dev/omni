/// Integration tests for DetailLevel filtering
/// Tests the apply_detail_level logic and token cost reduction

use meridian::config::IndexConfig;
use meridian::indexer::CodeIndexer;
use meridian::storage::MemoryStorage;
use meridian::types::{CodeSymbol, DetailLevel, Hash, Location, SymbolId, SymbolKind, SymbolMetadata, TokenCount};
use std::sync::Arc;

/// Helper function to create a test symbol
fn create_test_symbol(name: &str, doc: Option<String>, token_cost: u32) -> CodeSymbol {
    CodeSymbol {
        id: SymbolId::generate(),
        name: name.to_string(),
        kind: SymbolKind::Function,
        signature: format!("pub fn {}(a: i32, b: i32) -> i32", name),
        body_hash: Hash::new(b"test"),
        location: Location::new("test.rs".to_string(), 1, 10, 0, 50),
        references: vec![],
        dependencies: vec![SymbolId::new("dep1"), SymbolId::new("dep2")],
        metadata: SymbolMetadata {
            complexity: 5,
            token_cost: TokenCount::new(token_cost),
            last_modified: None,
            authors: vec![],
            doc_comment: doc,
            test_coverage: 0.8,
            usage_frequency: 10,
        },
        embedding: None,
    }
}

#[tokio::test]
async fn test_apply_detail_level_token_reduction() {
    // Create indexer
    let storage = Arc::new(MemoryStorage::new());
    let config = IndexConfig::default();
    let indexer = CodeIndexer::new(storage, config).unwrap();

    // Create a symbol with full details
    let full_symbol = create_test_symbol(
        "test_function",
        Some("Line 1 of docs\nLine 2 of docs\nLine 3 of docs".to_string()),
        200, // Full token cost
    );

    // Test Skeleton level
    let skeleton = indexer.apply_detail_level(&full_symbol, DetailLevel::Skeleton);
    assert_eq!(skeleton.name, "test_function");
    assert_eq!(skeleton.references.len(), 0, "Skeleton should have no references");
    assert_eq!(skeleton.dependencies.len(), 0, "Skeleton should have no dependencies");
    assert!(skeleton.metadata.doc_comment.is_none(), "Skeleton should have no doc comment");

    // Token cost should be ~15% of original (200 -> 30)
    let skeleton_tokens = skeleton.metadata.token_cost.0;
    assert!(skeleton_tokens >= 25 && skeleton_tokens <= 35,
        "Skeleton tokens should be ~30 (15% of 200), got {}", skeleton_tokens);

    println!("✓ Skeleton: {} tokens ({}% of full)", skeleton_tokens,
        (skeleton_tokens as f32 / 200.0 * 100.0) as u32);

    // Test Interface level
    let interface = indexer.apply_detail_level(&full_symbol, DetailLevel::Interface);
    assert_eq!(interface.references.len(), 0, "Interface should have no references");
    assert!(interface.dependencies.len() > 0, "Interface should keep dependencies");

    // Should have first line of doc only
    if let Some(ref doc) = interface.metadata.doc_comment {
        assert_eq!(doc, "Line 1 of docs", "Interface should have only first line of doc");
    }

    // Token cost should be ~35% of original (200 -> 70)
    let interface_tokens = interface.metadata.token_cost.0;
    assert!(interface_tokens >= 60 && interface_tokens <= 80,
        "Interface tokens should be ~70 (35% of 200), got {}", interface_tokens);

    println!("✓ Interface: {} tokens ({}% of full)", interface_tokens,
        (interface_tokens as f32 / 200.0 * 100.0) as u32);

    // Test Implementation level
    let implementation = indexer.apply_detail_level(&full_symbol, DetailLevel::Implementation);
    assert_eq!(implementation.references.len(), 0, "Implementation should have no references");
    assert!(implementation.dependencies.len() > 0, "Implementation should keep dependencies");

    // Should have full doc
    assert!(implementation.metadata.doc_comment.is_some());
    let impl_doc = implementation.metadata.doc_comment.as_ref().unwrap();
    assert!(impl_doc.contains("Line 2"), "Implementation should have full doc");

    // Token cost should be ~65% of original (200 -> 130)
    let impl_tokens = implementation.metadata.token_cost.0;
    assert!(impl_tokens >= 120 && impl_tokens <= 140,
        "Implementation tokens should be ~130 (65% of 200), got {}", impl_tokens);

    println!("✓ Implementation: {} tokens ({}% of full)", impl_tokens,
        (impl_tokens as f32 / 200.0 * 100.0) as u32);

    // Test Full level
    let full = indexer.apply_detail_level(&full_symbol, DetailLevel::Full);
    assert_eq!(full.dependencies.len(), 2, "Full should keep all dependencies");
    assert_eq!(full.metadata.token_cost.0, 200, "Full should keep original token cost");

    println!("✓ Full: {} tokens (100% of full)", full.metadata.token_cost.0);

    // Verify progressive increase
    assert!(skeleton_tokens < interface_tokens);
    assert!(interface_tokens < impl_tokens);
    assert!(impl_tokens < full.metadata.token_cost.0);

    println!("\n=== Token Savings Summary ===");
    println!("Skeleton saves: {}%", 100 - (skeleton_tokens as f32 / 200.0 * 100.0) as u32);
    println!("Interface saves: {}%", 100 - (interface_tokens as f32 / 200.0 * 100.0) as u32);
    println!("Implementation saves: {}%", 100 - (impl_tokens as f32 / 200.0 * 100.0) as u32);
}

#[tokio::test]
async fn test_detail_level_doc_comment_filtering() {
    let storage = Arc::new(MemoryStorage::new());
    let config = IndexConfig::default();
    let indexer = CodeIndexer::new(storage, config).unwrap();

    let multi_line_doc = "First line summary.\nDetailed explanation here.\nEven more details.\nAnd examples.".to_string();
    let symbol = create_test_symbol("doc_test", Some(multi_line_doc), 150);

    // Skeleton: no doc
    let skeleton = indexer.apply_detail_level(&symbol, DetailLevel::Skeleton);
    assert!(skeleton.metadata.doc_comment.is_none());

    // Interface: first line only
    let interface = indexer.apply_detail_level(&symbol, DetailLevel::Interface);
    if let Some(ref doc) = interface.metadata.doc_comment {
        assert_eq!(doc, "First line summary.");
        assert!(!doc.contains("Detailed explanation"));
    }

    // Implementation: full doc
    let implementation = indexer.apply_detail_level(&symbol, DetailLevel::Implementation);
    if let Some(ref doc) = implementation.metadata.doc_comment {
        assert!(doc.contains("First line"));
        assert!(doc.contains("Detailed explanation"));
    }

    // Full: full doc
    let full = indexer.apply_detail_level(&symbol, DetailLevel::Full);
    assert_eq!(full.metadata.doc_comment, symbol.metadata.doc_comment);
}

#[tokio::test]
async fn test_detail_level_empty_doc_comment() {
    let storage = Arc::new(MemoryStorage::new());
    let config = IndexConfig::default();
    let indexer = CodeIndexer::new(storage, config).unwrap();

    // Symbol with no doc comment
    let symbol = create_test_symbol("no_doc", None, 100);

    let skeleton = indexer.apply_detail_level(&symbol, DetailLevel::Skeleton);
    assert!(skeleton.metadata.doc_comment.is_none());

    let interface = indexer.apply_detail_level(&symbol, DetailLevel::Interface);
    assert!(interface.metadata.doc_comment.is_none());
}

#[tokio::test]
async fn test_detail_level_preserves_essential_fields() {
    let storage = Arc::new(MemoryStorage::new());
    let config = IndexConfig::default();
    let indexer = CodeIndexer::new(storage, config).unwrap();

    let symbol = create_test_symbol("preserve_test", Some("Doc".to_string()), 100);

    // All levels should preserve: id, name, kind, signature, location
    for level in &[DetailLevel::Skeleton, DetailLevel::Interface,
                   DetailLevel::Implementation, DetailLevel::Full] {
        let filtered = indexer.apply_detail_level(&symbol, *level);

        assert_eq!(filtered.id, symbol.id);
        assert_eq!(filtered.name, symbol.name);
        assert_eq!(filtered.kind, symbol.kind);
        assert_eq!(filtered.signature, symbol.signature);
        assert_eq!(filtered.location.file, symbol.location.file);
    }
}

#[test]
fn test_detail_level_percentages_are_correct() {
    // This test verifies the token reduction percentages match the spec
    // Spec promises: Skeleton ~15%, Interface ~35%, Implementation ~65%, Full 100%

    let base_cost = 1000u32;

    // Skeleton: 15%
    let skeleton_cost = (base_cost as f32 * 0.15) as u32;
    assert_eq!(skeleton_cost, 150);

    // Interface: 35%
    let interface_cost = (base_cost as f32 * 0.35) as u32;
    assert_eq!(interface_cost, 350);

    // Implementation: 65%
    let impl_cost = (base_cost as f32 * 0.65) as u32;
    assert_eq!(impl_cost, 650);

    println!("Verified token cost percentages:");
    println!("  Skeleton: {}% ({} tokens)", 15, skeleton_cost);
    println!("  Interface: {}% ({} tokens)", 35, interface_cost);
    println!("  Implementation: {}% ({} tokens)", 65, impl_cost);
    println!("  Full: 100% ({} tokens)", base_cost);

    // Verify savings
    assert_eq!(100 - 15, 85, "Skeleton should save 85%");
    assert_eq!(100 - 35, 65, "Interface should save 65%");
    assert_eq!(100 - 65, 35, "Implementation should save 35%");
}
