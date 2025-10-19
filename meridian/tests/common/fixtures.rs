use chrono::Utc;
use meridian::types::{
    ChangeType, CodeSymbol, ContextFragment, Delta, Hash, Location, Query, SymbolId, SymbolKind, SymbolMetadata, TokenCount,
};
use uuid::Uuid;

/// Create a test code symbol
pub fn test_symbol(name: &str, kind: SymbolKind) -> CodeSymbol {
    CodeSymbol {
        id: SymbolId::new(Uuid::new_v4().to_string()),
        name: name.to_string(),
        kind,
        signature: format!("fn {}() -> Result<()>", name),
        body_hash: Hash::new(b"test_body"),
        location: test_location("test.rs"),
        references: Vec::new(),
        dependencies: Vec::new(),
        metadata: test_metadata(),
        embedding: None,
    }
}

/// Create a test location
pub fn test_location(file: &str) -> Location {
    Location {
        file: file.to_string(),
        line_start: 1,
        line_end: 10,
        column_start: 0,
        column_end: 0,
    }
}

/// Create test metadata
pub fn test_metadata() -> SymbolMetadata {
    SymbolMetadata {
        complexity: 5,
        token_cost: TokenCount::new(100),
        last_modified: Some(Utc::now()),
        authors: vec!["Test Author".to_string()],
        doc_comment: Some("Test documentation".to_string()),
        test_coverage: 0.0,
        usage_frequency: 10,
    }
}

/// Create a test query
pub fn test_query(text: &str) -> Query {
    Query::new(text.to_string())
}


/// Create a test delta
#[allow(dead_code)]
pub fn test_delta(change_type: ChangeType) -> Delta {
    Delta {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        change_type,
        affected_symbols: vec![],
    }
}

/// Create test context fragment
pub fn test_context_fragment(content: &str) -> ContextFragment {
    ContextFragment {
        id: Uuid::new_v4().to_string(),
        content: content.to_string(),
        source: "test".to_string(),
        tokens: TokenCount::new((content.len() / 4) as u32),
    }
}

/// Create multiple test symbols
pub fn test_symbols(count: usize) -> Vec<CodeSymbol> {
    (0..count)
        .map(|i| test_symbol(&format!("symbol_{}", i), SymbolKind::Function))
        .collect()
}

/// Create a complex test symbol with dependencies
pub fn test_symbol_with_deps(name: &str, deps: Vec<SymbolId>) -> CodeSymbol {
    let mut symbol = test_symbol(name, SymbolKind::Function);
    symbol.dependencies = deps;
    symbol
}

/// Create test query with filters
pub fn test_query_filtered(text: &str, symbol_types: Vec<SymbolKind>) -> Query {
    Query {
        text: text.to_string(),
        symbol_types: Some(symbol_types),
        scope: None,
        detail_level: meridian::types::DetailLevel::default(),
        max_results: Some(10),
        max_tokens: Some(TokenCount::new(1000)),
        offset: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_test_symbol() {
        let symbol = test_symbol("test_fn", SymbolKind::Function);
        assert_eq!(symbol.name, "test_fn");
        assert_eq!(symbol.kind, SymbolKind::Function);
    }

    #[test]
    fn test_test_symbols() {
        let symbols = test_symbols(5);
        assert_eq!(symbols.len(), 5);
        assert_eq!(symbols[0].name, "symbol_0");
        assert_eq!(symbols[4].name, "symbol_4");
    }

    #[test]
    fn test_test_query() {
        let query = test_query("search term");
        assert_eq!(query.text, "search term");
    }

}
