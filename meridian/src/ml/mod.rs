/// ML module - Local embeddings and reranking using Burn framework
///
/// This module provides:
/// - Local embedding generation (Sentence-BERT, CodeBERT)
/// - Cross-encoder reranking for search result optimization
/// - Model caching and warmup
/// - Batch inference for efficiency

pub mod embeddings;
pub mod reranker;

use anyhow::Result;
use std::path::PathBuf;

/// Get the ML models cache directory
pub fn get_models_cache_dir() -> PathBuf {
    use crate::config::get_meridian_home;
    get_meridian_home().join("models")
}

/// Initialize ML models cache directory
pub fn init_models_cache() -> Result<()> {
    let cache_dir = get_models_cache_dir();
    std::fs::create_dir_all(&cache_dir)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_models_cache_dir() {
        let cache_dir = get_models_cache_dir();
        assert!(cache_dir.to_string_lossy().contains("models"));
    }

    #[test]
    fn test_init_models_cache() {
        init_models_cache().expect("Failed to initialize models cache");
        let cache_dir = get_models_cache_dir();
        assert!(cache_dir.exists());
    }
}
