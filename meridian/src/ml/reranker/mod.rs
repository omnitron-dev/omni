/// Reranker module - Cross-encoder for search result optimization
///
/// Key feature: Reduces 20 "maybe relevant" chunks to 3 "highly relevant" chunks
/// Token savings: >80% by returning only top-3 results
/// Performance target: <100ms for 20 candidates

pub mod cross_encoder;

use anyhow::Result;

pub use cross_encoder::CrossEncoderReranker;

/// Reranking result with score
#[derive(Debug, Clone)]
pub struct RerankedResult {
    /// Original index in the input list
    pub index: usize,
    /// Text content
    pub text: String,
    /// Relevance score (0.0 to 1.0, higher = more relevant)
    pub score: f32,
}

/// Reranker trait for different reranking strategies
pub trait Reranker: Send + Sync {
    /// Rerank a list of candidates based on a query
    ///
    /// # Arguments
    /// * `query` - The search query
    /// * `candidates` - List of candidate texts to rerank
    /// * `top_k` - Number of top results to return
    ///
    /// # Returns
    /// Top-k reranked results sorted by relevance (highest first)
    fn rerank(&self, query: &str, candidates: &[&str], top_k: usize) -> Result<Vec<RerankedResult>>;

    /// Get the model name
    fn model_name(&self) -> &str;

    /// Warm up the model
    fn warmup(&mut self) -> Result<()>;
}

/// Reranking engine that manages the reranker
pub struct RerankingEngine {
    reranker: Box<dyn Reranker>,
}

impl RerankingEngine {
    /// Create a new reranking engine with cross-encoder
    pub fn new() -> Result<Self> {
        let reranker = Box::new(CrossEncoderReranker::new()?);
        Ok(Self { reranker })
    }

    /// Rerank candidates and return top-k results
    pub fn rerank(&self, query: &str, candidates: &[&str], top_k: usize) -> Result<Vec<RerankedResult>> {
        self.reranker.rerank(query, candidates, top_k)
    }

    /// Get the model name
    pub fn model_name(&self) -> &str {
        self.reranker.model_name()
    }

    /// Warm up the model
    pub fn warmup(&mut self) -> Result<()> {
        self.reranker.warmup()
    }
}

impl Default for RerankingEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create default reranking engine")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = RerankingEngine::new();
        assert!(engine.is_ok());
    }

    #[test]
    fn test_rerank_basic() {
        let engine = RerankingEngine::new().unwrap();
        let query = "rust async functions";
        let candidates = vec![
            "async fn process_data() -> Result<()>",
            "fn synchronous_function() {}",
            "async fn fetch_from_api() -> Data",
        ];

        let results = engine.rerank(query, &candidates, 2).unwrap();
        assert_eq!(results.len(), 2);

        // Check that results are sorted by score
        for i in 1..results.len() {
            assert!(results[i - 1].score >= results[i].score);
        }
    }
}
