pub mod code_indexer;
pub mod tree_sitter_parser;
pub mod search;
pub mod parser;

use crate::types::{CodeSymbol, Query, QueryResult};
use anyhow::Result;
use std::path::Path;

pub use code_indexer::{CodeIndexer, DependencyDirection, DependencyGraph};
pub use tree_sitter_parser::TreeSitterParser;
pub use search::SearchEngine;
pub use parser::MonorepoParser;

/// Main indexer interface
#[async_trait::async_trait]
pub trait Indexer: Send + Sync {
    /// Index a project
    async fn index_project(&mut self, path: &Path, force: bool) -> Result<()>;

    /// Search symbols
    async fn search_symbols(&self, query: &Query) -> Result<QueryResult>;

    /// Get symbol by ID
    async fn get_symbol(&self, id: &str) -> Result<Option<CodeSymbol>>;

    /// Update a file in the index
    async fn update_file(&mut self, path: &Path) -> Result<()>;
}
