use super::{CodeSymbol, DetailLevel, SymbolKind, TokenCount};
use serde::{Deserialize, Serialize};

/// Search query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Query {
    pub text: String,
    pub symbol_types: Option<Vec<SymbolKind>>,
    pub scope: Option<String>,
    pub detail_level: DetailLevel,
    pub max_results: Option<usize>,
    pub max_tokens: Option<TokenCount>,
}

impl Query {
    pub fn new(text: String) -> Self {
        Self {
            text,
            symbol_types: None,
            scope: None,
            detail_level: DetailLevel::default(),
            max_results: Some(10),
            max_tokens: None,
        }
    }

    pub fn with_max_tokens(mut self, max_tokens: TokenCount) -> Self {
        self.max_tokens = Some(max_tokens);
        self
    }

    pub fn with_types(mut self, types: Vec<SymbolKind>) -> Self {
        self.symbol_types = Some(types);
        self
    }
}

/// Query result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub symbols: Vec<CodeSymbol>,
    pub total_tokens: TokenCount,
    pub truncated: bool,
}

impl QueryResult {
    pub fn empty() -> Self {
        Self {
            symbols: Vec::new(),
            total_tokens: TokenCount::zero(),
            truncated: false,
        }
    }
}

/// Search strategy
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearchStrategy {
    ExactMatch { name: String },
    Semantic { query: String, max_tokens: u32 },
    Hybrid { keywords: Vec<String> },
}
