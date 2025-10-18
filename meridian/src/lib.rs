pub mod codegen;
pub mod config;
pub mod context;
pub mod daemon;
pub mod docs;
pub mod embeddings;
pub mod git;
pub mod global;
pub mod indexer;
pub mod links;
pub mod mcp;
pub mod memory;
pub mod ml;
pub mod progress;
pub mod project;
pub mod session;
pub mod specs;
pub mod storage;
pub mod types;

pub use config::Config;
pub use mcp::MeridianServer;
pub use types::*;


/// Statistics about the index
#[derive(Debug, Clone)]
pub struct IndexStats {
    pub total_symbols: usize,
    pub total_files: usize,
    pub total_projects: usize,
    pub index_size_mb: f64,
    pub episodes_count: usize,
    pub working_memory_size: usize,
    pub semantic_patterns: usize,
    pub procedures_count: usize,
}

impl IndexStats {
    pub fn empty() -> Self {
        Self {
            total_symbols: 0,
            total_files: 0,
            total_projects: 0,
            index_size_mb: 0.0,
            episodes_count: 0,
            working_memory_size: 0,
            semantic_patterns: 0,
            procedures_count: 0,
        }
    }
}
