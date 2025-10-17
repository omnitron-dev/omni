use anyhow::{Context, Result};
use dashmap::DashMap;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::sync::Arc;

/// Embedding engine for generating vector embeddings of code symbols
pub struct EmbeddingEngine {
    model: TextEmbedding,
    cache: Arc<DashMap<String, Vec<f32>>>,
}

impl EmbeddingEngine {
    /// Create a new embedding engine with default model
    pub fn new() -> Result<Self> {
        Self::with_model(EmbeddingModel::AllMiniLML6V2)
    }

    /// Create embedding engine with specific model
    pub fn with_model(model: EmbeddingModel) -> Result<Self> {
        let init_options = InitOptions::new(model);
        let embedding_model = TextEmbedding::try_new(init_options)
            .context("Failed to initialize embedding model")?;

        Ok(Self {
            model: embedding_model,
            cache: Arc::new(DashMap::new()),
        })
    }

    /// Generate embedding for a single text
    pub fn generate_embedding(&mut self, text: &str) -> Result<Vec<f32>> {
        // Check cache first
        if let Some(cached) = self.cache.get(text) {
            return Ok(cached.clone());
        }

        // Generate embedding
        let embeddings = self
            .model
            .embed(vec![text.to_string()], None)
            .context("Failed to generate embedding")?;

        let embedding = embeddings
            .into_iter()
            .next()
            .context("No embedding returned")?;

        // Cache it
        self.cache.insert(text.to_string(), embedding.clone());

        Ok(embedding)
    }

    /// Generate embeddings for multiple texts in batch
    pub fn batch_generate(&mut self, texts: Vec<&str>) -> Result<Vec<Vec<f32>>> {
        let mut results = Vec::with_capacity(texts.len());
        let mut uncached_texts = Vec::new();
        let mut uncached_indices = Vec::new();

        // Check cache for each text
        for (idx, text) in texts.iter().enumerate() {
            if let Some(cached) = self.cache.get(*text) {
                results.push(Some(cached.clone()));
            } else {
                results.push(None);
                uncached_texts.push(text.to_string());
                uncached_indices.push(idx);
            }
        }

        // Generate embeddings for uncached texts
        if !uncached_texts.is_empty() {
            let embeddings = self
                .model
                .embed(uncached_texts.clone(), None)
                .context("Failed to generate batch embeddings")?;

            // Fill in the results and cache them
            for (embedding, idx) in embeddings.into_iter().zip(uncached_indices.iter()) {
                results[*idx] = Some(embedding.clone());
                self.cache.insert(uncached_texts[*idx].clone(), embedding);
            }
        }

        // Unwrap all results (they should all be Some now)
        Ok(results.into_iter().filter_map(|r| r).collect())
    }

    /// Clear the cache
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    /// Get cache size
    pub fn cache_size(&self) -> usize {
        self.cache.len()
    }

    /// Compute cosine similarity between two embeddings
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
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
    fn test_generate_embedding() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");
        let embedding = engine
            .generate_embedding("fn test() { println!(\"hello\"); }")
            .expect("Failed to generate embedding");

        assert!(!embedding.is_empty());
        assert_eq!(embedding.len(), 384); // AllMiniLML6V2 produces 384-dim vectors
    }

    #[test]
    fn test_embedding_cache() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");
        let text = "pub struct TestStruct { field: i32 }";

        // First call - should generate
        let embedding1 = engine
            .generate_embedding(text)
            .expect("Failed to generate embedding");
        assert_eq!(engine.cache_size(), 1);

        // Second call - should use cache
        let embedding2 = engine
            .generate_embedding(text)
            .expect("Failed to generate embedding");
        assert_eq!(engine.cache_size(), 1);

        // Should be identical
        assert_eq!(embedding1, embedding2);
    }

    #[test]
    fn test_batch_generate() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");
        let texts = vec![
            "fn add(a: i32, b: i32) -> i32 { a + b }",
            "fn subtract(a: i32, b: i32) -> i32 { a - b }",
            "fn multiply(a: i32, b: i32) -> i32 { a * b }",
        ];

        let embeddings = engine
            .batch_generate(texts.clone())
            .expect("Failed to generate batch embeddings");

        assert_eq!(embeddings.len(), 3);
        for embedding in &embeddings {
            assert_eq!(embedding.len(), 384);
        }

        // Cache should have all three
        assert_eq!(engine.cache_size(), 3);
    }

    #[test]
    fn test_cosine_similarity() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");

        let text1 = "fn add(a: i32, b: i32) -> i32 { a + b }";
        let text2 = "fn sum(x: i32, y: i32) -> i32 { x + y }"; // Similar function
        let text3 = "struct User { name: String, email: String }"; // Different concept

        let emb1 = engine.generate_embedding(text1).unwrap();
        let emb2 = engine.generate_embedding(text2).unwrap();
        let emb3 = engine.generate_embedding(text3).unwrap();

        let sim_12 = EmbeddingEngine::cosine_similarity(&emb1, &emb2);
        let sim_13 = EmbeddingEngine::cosine_similarity(&emb1, &emb3);

        // Similar functions should have higher similarity
        assert!(sim_12 > sim_13);
        assert!(sim_12 > 0.5); // Should be reasonably similar
        assert!(sim_12 <= 1.0); // Maximum similarity is 1.0
    }

    #[test]
    fn test_clear_cache() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");
        engine
            .generate_embedding("test text")
            .expect("Failed to generate embedding");
        assert_eq!(engine.cache_size(), 1);

        engine.clear_cache();
        assert_eq!(engine.cache_size(), 0);
    }

    #[test]
    fn test_identical_vectors_similarity() {
        let mut engine = EmbeddingEngine::new().expect("Failed to create engine");
        let text = "fn test() {}";
        let emb = engine.generate_embedding(text).unwrap();

        let similarity = EmbeddingEngine::cosine_similarity(&emb, &emb);
        assert!((similarity - 1.0).abs() < 0.001); // Should be very close to 1.0
    }

    #[test]
    fn test_zero_vector_similarity() {
        let zero_vec = vec![0.0; 384];
        let normal_vec = vec![1.0; 384];

        let similarity = EmbeddingEngine::cosine_similarity(&zero_vec, &normal_vec);
        assert_eq!(similarity, 0.0);
    }

    #[test]
    fn test_different_length_vectors() {
        let vec1 = vec![1.0, 2.0, 3.0];
        let vec2 = vec![1.0, 2.0];

        let similarity = EmbeddingEngine::cosine_similarity(&vec1, &vec2);
        assert_eq!(similarity, 0.0);
    }
}
