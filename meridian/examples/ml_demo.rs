/// Demonstration of ML module capabilities
///
/// Shows:
/// 1. Local embedding generation
/// 2. Cross-encoder reranking
/// 3. Token savings from 20 → 3 results

use meridian::ml::embeddings::EmbeddingEngine;
use meridian::ml::reranker::RerankingEngine;

fn main() -> anyhow::Result<()> {
    println!("=== Meridian ML Module Demo ===\n");

    // 1. Embeddings Demo
    println!("1. EMBEDDING GENERATION");
    println!("-----------------------");

    let mut embedding_engine = EmbeddingEngine::new()?;
    embedding_engine.warmup()?;

    println!("Model: {}", embedding_engine.model_name());
    println!("Dimension: {}", embedding_engine.dimension());

    let code_samples = vec![
        "async fn process_data() -> Result<Data>",
        "fn calculate_sum(numbers: &[i32]) -> i32",
        "struct User { name: String, email: String }",
    ];

    println!("\nGenerating embeddings for {} code samples...", code_samples.len());
    let embeddings = embedding_engine.batch_embed(&code_samples)?;

    for (i, (code, embedding)) in code_samples.iter().zip(embeddings.iter()).enumerate() {
        println!("  Sample {}: \"{}\" → {}-dim vector", i + 1, code, embedding.len());
    }

    // Calculate similarity between first two
    let similarity = cosine_similarity(&embeddings[0], &embeddings[1]);
    println!("\nSimilarity between sample 1 and 2: {:.3}", similarity);

    // 2. Reranking Demo
    println!("\n2. RERANKING DEMONSTRATION");
    println!("--------------------------");

    let mut reranker = RerankingEngine::new()?;
    reranker.warmup()?;

    println!("Model: {}", reranker.model_name());

    let query = "implement async vector search in rust";

    // Simulate 20 search results from semantic search
    let candidates = vec![
        "HNSW algorithm for approximate nearest neighbor search in Rust",
        "Introduction to Python programming basics",
        "Async/await patterns in Rust for concurrent processing",
        "Building fast vector similarity search with HNSW",
        "JavaScript event loop and async operations",
        "Rust async runtime comparison: Tokio vs async-std",
        "Vector database implementation guide for production",
        "C++ STL containers and algorithms",
        "Asynchronous vector indexing in distributed systems",
        "Go concurrency patterns with goroutines",
        "Implementing efficient vector search with Faiss",
        "Java multithreading best practices",
        "Rust ownership and borrowing explained",
        "Vector embeddings for semantic search",
        "Async task scheduling in Rust applications",
        "Python NumPy array operations",
        "Building scalable vector search infrastructure",
        "TypeScript async/await syntax",
        "Rust performance optimization techniques",
        "Vector quantization for memory efficiency",
    ];

    println!("\nQuery: \"{}\"", query);
    println!("Candidates: {} results from semantic search", candidates.len());

    // Rerank to get top-3
    let top_k = 3;
    let results = reranker.rerank(query, &candidates, top_k)?;

    println!("\n🎯 TOP-{} RERANKED RESULTS:", top_k);
    for (i, result) in results.iter().enumerate() {
        println!(
            "  {}. [Score: {:.3}] {}",
            i + 1,
            result.score,
            result.text
        );
    }

    // 3. Token Savings Calculation
    println!("\n3. TOKEN SAVINGS ANALYSIS");
    println!("-------------------------");

    let avg_tokens_per_chunk = 200; // Typical code chunk size
    let original_tokens = candidates.len() * avg_tokens_per_chunk;
    let reranked_tokens = top_k * avg_tokens_per_chunk;
    let savings = original_tokens - reranked_tokens;
    let savings_percent = (savings as f32 / original_tokens as f32) * 100.0;

    println!("Original (20 chunks): {} tokens", original_tokens);
    println!("Reranked (3 chunks):  {} tokens", reranked_tokens);
    println!("Savings:              {} tokens ({:.1}%)", savings, savings_percent);

    println!("\n💡 By using reranking, we reduced context size by {:.0}%!", savings_percent);
    println!("This means:");
    println!("  - Faster LLM response times");
    println!("  - Lower API costs");
    println!("  - Better precision (only highly relevant results)");

    Ok(())
}

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
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
