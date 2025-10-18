/// Embeddings module - Local embedding generation using Burn
///
/// Provides:
/// - Sentence-BERT embeddings for general text
/// - CodeBERT embeddings for code-specific text
/// - Batch processing for efficiency
/// - Model caching and reuse

pub mod sentence_bert;
pub mod code_bert;

use anyhow::Result;
use async_trait::async_trait;

/// Embedding model trait
#[async_trait]
pub trait EmbeddingModel: Send + Sync {
    /// Generate embedding for a single text
    fn embed(&self, text: &str) -> Result<Vec<f32>>;

    /// Generate embeddings for multiple texts in batch
    fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>>;

    /// Get the embedding dimension
    fn dimension(&self) -> usize;

    /// Get the model name
    fn model_name(&self) -> &str;

    /// Warm up the model (load and run a dummy inference)
    fn warmup(&mut self) -> Result<()>;
}

/// Embedding engine that manages multiple models
pub struct EmbeddingEngine {
    /// Active model
    model: Box<dyn EmbeddingModel>,
}

impl EmbeddingEngine {
    /// Create a new embedding engine with Sentence-BERT model
    pub fn new() -> Result<Self> {
        let model = Box::new(sentence_bert::SentenceBertModel::new()?);
        Ok(Self { model })
    }

    /// Create embedding engine with CodeBERT model
    pub fn with_code_bert() -> Result<Self> {
        let model = Box::new(code_bert::CodeBertModel::new()?);
        Ok(Self { model })
    }

    /// Generate embedding for a single text
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        self.model.embed(text)
    }

    /// Generate embeddings for multiple texts in batch
    pub fn batch_embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        self.model.batch_embed(texts)
    }

    /// Get the embedding dimension
    pub fn dimension(&self) -> usize {
        self.model.dimension()
    }

    /// Get the model name
    pub fn model_name(&self) -> &str {
        self.model.model_name()
    }

    /// Warm up the model
    pub fn warmup(&mut self) -> Result<()> {
        self.model.warmup()
    }
}

impl Default for EmbeddingEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create default embedding engine")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_creation() {
        let engine = EmbeddingEngine::new();
        assert!(engine.is_ok());
    }

    #[test]
    fn test_dimension() {
        let engine = EmbeddingEngine::new().unwrap();
        assert_eq!(engine.dimension(), 384); // Sentence-BERT dimension
    }
}
