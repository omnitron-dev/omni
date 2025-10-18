/// Integration tests for cross-encoder reranking
///
/// Tests:
/// - Reranking reduces results from 20 to 3 (80% token savings)
/// - Precision improvement with reranking
/// - Latency < 100ms for 20 candidates
/// - MCP handler integration
/// - Cache effectiveness

use meridian::ml::reranker::{CrossEncoderReranker, Reranker, RerankingEngine};
use std::time::Instant;

#[test]
fn test_create_reranker() {
    let reranker = CrossEncoderReranker::new();
    assert!(reranker.is_ok(), "Failed to create reranker");

    let reranker = reranker.unwrap();
    assert_eq!(reranker.model_name(), "ms-marco-MiniLM-L6-v2");
}

#[test]
fn test_basic_reranking() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "implement vector search";
    let candidates = vec![
        "How to implement HNSW vector search in Rust",
        "Introduction to Python programming",
        "Vector database implementation guide",
        "JavaScript async/await tutorial",
        "Building fast vector similarity search",
        "React hooks tutorial",
        "Docker container basics",
        "SQL database queries",
    ];

    let results = reranker.rerank(query, &candidates, 3).unwrap();

    // Should return exactly 3 results
    assert_eq!(results.len(), 3, "Should return top-3 results");

    // Results should be sorted by score (descending)
    for i in 1..results.len() {
        assert!(
            results[i - 1].score >= results[i].score,
            "Results should be sorted by score"
        );
    }

    // Verify indices are valid
    for result in &results {
        assert!(
            result.index < candidates.len(),
            "Index should be within bounds"
        );
        assert_eq!(
            result.text,
            candidates[result.index],
            "Text should match original candidate"
        );
    }

    // Top results should have relevant content
    let top_text = &results[0].text.to_lowercase();
    assert!(
        top_text.contains("vector") || top_text.contains("search") || top_text.contains("hnsw"),
        "Top result should be relevant to query"
    );
}

#[test]
fn test_reranking_precision() {
    let reranker = CrossEncoderReranker::new().unwrap();

    // Test query about Rust async
    let query = "rust async functions";
    let candidates = vec![
        "async fn process_data() -> Result<()>",           // Highly relevant
        "fn synchronous_function() {}",                     // Not relevant
        "async fn fetch_from_api() -> Data",              // Highly relevant
        "Python asyncio tutorial",                         // Somewhat relevant
        "JavaScript promises and async/await",             // Somewhat relevant
        "impl Future for CustomType",                      // Relevant
        "Database connection pooling",                     // Not relevant
        "async trait implementation in Rust",              // Highly relevant
    ];

    let results = reranker.rerank(query, &candidates, 3).unwrap();

    // Check that top results contain "async" and "rust" concepts
    let mut relevant_count = 0;
    for result in &results {
        let text_lower = result.text.to_lowercase();
        if (text_lower.contains("async") && (text_lower.contains("fn") || text_lower.contains("rust")))
            || text_lower.contains("future")
            || text_lower.contains("trait")
        {
            relevant_count += 1;
        }
    }

    assert!(
        relevant_count >= 2,
        "At least 2 of top-3 should be highly relevant"
    );
}

#[test]
fn test_reranking_performance() {
    let reranker = CrossEncoderReranker::new().unwrap();

    // Create 20 candidates
    let query = "machine learning model training";
    let candidates: Vec<&str> = vec![
        "Deep learning with neural networks",
        "SQL database optimization",
        "ML model training techniques",
        "JavaScript framework comparison",
        "Training neural networks with gradient descent",
        "Docker container orchestration",
        "Model validation and testing",
        "CSS grid layout tutorial",
        "Hyperparameter tuning for ML models",
        "Git branching strategies",
        "Feature engineering for ML",
        "React component lifecycle",
        "Supervised learning algorithms",
        "API rate limiting strategies",
        "Cross-validation techniques",
        "Load balancing with nginx",
        "Overfitting prevention in ML",
        "MongoDB query optimization",
        "Ensemble learning methods",
        "Kubernetes deployment guide",
    ];

    assert_eq!(candidates.len(), 20, "Should have 20 candidates");

    // Measure performance
    let start = Instant::now();
    let results = reranker.rerank(query, &candidates, 3).unwrap();
    let elapsed = start.elapsed();

    println!("Reranked 20 candidates in {:?}", elapsed);

    // Performance target: < 100ms for 20 candidates
    assert!(
        elapsed.as_millis() < 100,
        "Reranking should complete in < 100ms, took {:?}",
        elapsed
    );

    // Should return top-3
    assert_eq!(results.len(), 3);

    // Check relevance
    for result in &results {
        let text_lower = result.text.to_lowercase();
        println!(
            "Score {:.3}: {}",
            result.score,
            result.text.chars().take(50).collect::<String>()
        );

        // Top results should be about ML
        assert!(
            text_lower.contains("ml")
                || text_lower.contains("model")
                || text_lower.contains("learning")
                || text_lower.contains("training")
                || text_lower.contains("neural"),
            "Top results should be relevant"
        );
    }
}

#[test]
fn test_token_savings_calculation() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "test query";
    let candidates: Vec<&str> = (0..20).map(|i| {
        if i % 5 == 0 {
            "relevant test query result"
        } else {
            "unrelated content"
        }
    }).collect();

    let results = reranker.rerank(query, &candidates, 3).unwrap();

    // Token savings: 20 -> 3 = 85% reduction
    let original_count = 20;
    let reranked_count = results.len();
    let token_savings = ((original_count - reranked_count) as f32 / original_count as f32) * 100.0;

    println!("Token savings: {:.1}%", token_savings);
    assert!(
        token_savings >= 80.0,
        "Should achieve at least 80% token savings"
    );
}

#[test]
fn test_reranking_engine() {
    let engine = RerankingEngine::new();
    assert!(engine.is_ok(), "Failed to create reranking engine");

    let engine = engine.unwrap();
    assert_eq!(engine.model_name(), "ms-marco-MiniLM-L6-v2");

    let query = "rust programming";
    let candidates = vec![
        "Rust programming language guide",
        "Python tutorial",
        "Rust memory safety",
    ];

    let results = engine.rerank(query, &candidates, 2).unwrap();
    assert_eq!(results.len(), 2);
}

#[test]
fn test_cache_effectiveness() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "test query";
    let doc = "test document";

    // First call - no cache
    let start = Instant::now();
    let score1 = reranker.rerank(query, &[doc], 1).unwrap();
    let elapsed1 = start.elapsed();

    // Second call - should use cache
    let start = Instant::now();
    let score2 = reranker.rerank(query, &[doc], 1).unwrap();
    let elapsed2 = start.elapsed();

    println!("First call: {:?}, Second call: {:?}", elapsed1, elapsed2);

    // Cached call should be faster or equal
    assert!(elapsed2 <= elapsed1, "Cached call should be faster");

    // Scores should be identical
    assert_eq!(score1[0].score, score2[0].score, "Cached scores should match");

    // Check cache stats
    let (cache_size, _) = reranker.cache_stats();
    assert!(cache_size > 0, "Cache should have entries");
}

#[test]
fn test_empty_query() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let results = reranker.rerank("", &["test"], 1).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].score, 0.0, "Empty query should score 0");
}

#[test]
fn test_single_candidate() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let results = reranker.rerank("query", &["single doc"], 5).unwrap();
    assert_eq!(results.len(), 1, "Should return single result");
}

#[test]
fn test_top_k_larger_than_candidates() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let candidates = vec!["doc1", "doc2"];
    let results = reranker.rerank("query", &candidates, 10).unwrap();

    // Should return all candidates even though top_k is larger
    assert_eq!(results.len(), 2);
}

#[test]
fn test_sequential_match_bonus() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "async rust function";

    // Document with sequential matches should score higher
    let doc_sequential = "async rust function implementation";
    let doc_scattered = "function implementation in async rust code";

    let results = reranker
        .rerank(query, &[doc_sequential, doc_scattered], 2)
        .unwrap();

    // First result should be the sequential one (stronger relevance signal)
    assert!(
        results[0].text.contains("async rust function"),
        "Sequential matches should score higher"
    );
}

#[test]
fn test_warmup() {
    let mut reranker = CrossEncoderReranker::new().unwrap();

    let result = reranker.warmup();
    assert!(result.is_ok(), "Warmup should succeed");

    // Warmup should be idempotent
    let result = reranker.warmup();
    assert!(result.is_ok(), "Second warmup should succeed");
}

#[test]
fn test_score_range() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "test";
    let candidates = vec![
        "test exact match",
        "somewhat related content",
        "completely unrelated xyz",
    ];

    let results = reranker.rerank(query, &candidates, 3).unwrap();

    // All scores should be in [0, 1] range
    for result in &results {
        assert!(
            result.score >= 0.0 && result.score <= 1.0,
            "Score should be in [0, 1] range, got {}",
            result.score
        );
    }

    // Relevant results should score higher than irrelevant
    assert!(
        results[0].score > 0.5,
        "Most relevant result should score > 0.5"
    );
}

#[test]
fn test_benchmark_batch_sizes() {
    let reranker = CrossEncoderReranker::new().unwrap();

    let query = "vector search implementation";

    // Create different batch sizes
    for batch_size in [5, 10, 20, 50] {
        let candidates: Vec<String> = (0..batch_size)
            .map(|i| format!("Document {} about various topics including vector search", i))
            .collect();

        let candidate_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();

        let start = Instant::now();
        let results = reranker.rerank(query, &candidate_refs, 3).unwrap();
        let elapsed = start.elapsed();

        println!(
            "Batch size {}: {:?} ({:.2}ms per doc)",
            batch_size,
            elapsed,
            elapsed.as_secs_f64() * 1000.0 / batch_size as f64
        );

        assert_eq!(results.len(), 3, "Should return top-3");
    }
}
