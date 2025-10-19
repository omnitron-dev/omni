use meridian::embeddings::EmbeddingEngine;
use meridian::indexer::vector::{HnswIndex, VectorIndex};
use meridian::memory::EpisodicMemory;
use meridian::storage::MemoryStorage;
use meridian::types::{ContextSnapshot, EpisodeId, Outcome, TaskEpisode, TokenCount};
use std::sync::Arc;
use std::time::Instant;
use chrono::Utc;

/// Performance test: Compare linear vs HNSW search
#[tokio::test]
async fn test_hnsw_vs_linear_performance() {
    // Skip test if embedding model not available
    let engine = match EmbeddingEngine::new() {
        Ok(e) => e,
        Err(_) => {
            println!("Skipping test: embedding model not available");
            return;
        }
    };

    let test_sizes = vec![100, 500, 1000, 2000];

    for size in test_sizes {
        println!("\n=== Testing with {} episodes ===", size);

        // Generate test episodes
        let episodes = generate_test_episodes(size);

        // Test 1: Linear search (baseline)
        let linear_time = measure_linear_search(&engine, &episodes);
        println!("Linear search:     {:.3}ms", linear_time);

        // Test 2: HNSW search (returns build_time, search_time)
        let (build_time, search_time) = measure_hnsw_search(&engine, &episodes);
        println!("HNSW build time:   {:.3}ms (one-time cost)", build_time);
        println!("HNSW search time:  {:.3}ms", search_time);

        // Calculate speedup for search only (fair comparison)
        let speedup = linear_time / search_time;
        println!("Search speedup:    {:.1}x faster", speedup);

        // Calculate amortized cost (build + 10 searches)
        let amortized_time = (build_time + search_time * 10.0) / 10.0;
        let amortized_speedup = linear_time / amortized_time;
        println!("Amortized (10 searches): {:.1}x faster", amortized_speedup);

        // Assert we get meaningful speedup for larger datasets
        // For 500+ episodes, pure search should be 2x+ faster
        // Amortized over 10 searches should still be faster
        if size >= 500 {
            assert!(
                speedup >= 2.0,
                "HNSW search should be at least 2x faster for {} episodes (got {:.1}x)",
                size, speedup
            );
            println!("✓ Performance target met: {:.1}x speedup", speedup);
        }
    }
}

/// Test episodic memory end-to-end with HNSW
#[tokio::test]
async fn test_episodic_memory_with_hnsw() {
    let storage = Arc::new(MemoryStorage::new());
    let mut memory = match EpisodicMemory::new(storage, 30) {
        Ok(m) => m,
        Err(_) => {
            println!("Skipping test: embedding engine not available");
            return;
        }
    };

    // Add test episodes
    let episodes = generate_test_episodes(100);
    for episode in episodes {
        memory.record_episode(episode).await.unwrap();
    }

    // Measure search performance
    let start = Instant::now();
    let results = memory.find_similar("Implement authentication middleware", 5).await;
    let elapsed = start.elapsed();

    println!("Episodic memory search: {:.2}ms", elapsed.as_secs_f64() * 1000.0);
    println!("Found {} similar episodes", results.len());

    assert!(!results.is_empty(), "Should find similar episodes");
}

// Helper functions

fn generate_test_episodes(count: usize) -> Vec<TaskEpisode> {
    let templates = vec![
        "Implement authentication middleware with JWT",
        "Fix memory leak in event handler",
        "Optimize database query performance",
        "Add unit tests for API endpoints",
        "Refactor service architecture",
    ];

    (0..count)
        .map(|i| TaskEpisode {
            schema_version: 1,
            id: EpisodeId::new(),
            timestamp: Utc::now(),
            task_description: format!("{} (variant {})", templates[i % templates.len()], i),
            initial_context: ContextSnapshot::default(),
            queries_made: vec![format!("query_{}", i)],
            files_touched: vec![format!("src/file_{}.rs", i)],
            solution_path: format!("Solution for task {}", i),
            outcome: Outcome::Success,
            tokens_used: TokenCount::new(1000),
            access_count: 0,
            pattern_value: 0.8,
        })
        .collect()
}

fn measure_linear_search(engine: &EmbeddingEngine, episodes: &[TaskEpisode]) -> f64 {
    // Pre-generate embeddings
    let embeddings: Vec<Vec<f32>> = episodes
        .iter()
        .map(|e| engine.generate_embedding(&e.task_description).unwrap())
        .collect();

    let query = "Implement authentication with JWT tokens";
    let query_emb = engine.generate_embedding(query).unwrap();

    // Measure linear search
    let start = Instant::now();
    let mut scores: Vec<(usize, f32)> = embeddings
        .iter()
        .enumerate()
        .map(|(i, emb)| {
            let similarity = EmbeddingEngine::cosine_similarity(&query_emb, emb);
            (i, similarity)
        })
        .collect();

    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let _top_5 = &scores[..5.min(scores.len())];

    start.elapsed().as_secs_f64() * 1000.0
}

fn measure_hnsw_search(engine: &EmbeddingEngine, episodes: &[TaskEpisode]) -> (f64, f64) {
    // Pre-generate embeddings (fair comparison with linear search)
    let embeddings: Vec<(String, Vec<f32>)> = episodes
        .iter()
        .map(|e| (e.id.0.clone(), engine.generate_embedding(&e.task_description).unwrap()))
        .collect();

    // Build HNSW index (this is one-time overhead)
    let build_start = Instant::now();
    let mut index = HnswIndex::new(engine.dimension(), episodes.len());
    for (id, emb) in &embeddings {
        index.add_vector(id, emb).unwrap();
    }
    let build_time = build_start.elapsed().as_secs_f64() * 1000.0;

    let query = "Implement authentication with JWT tokens";
    let query_emb = engine.generate_embedding(query).unwrap();

    // Measure HNSW search multiple times for accuracy
    let mut search_times = Vec::new();
    for _ in 0..5 {
        let search_start = Instant::now();
        let _results = index.search(&query_emb, 5).unwrap();
        search_times.push(search_start.elapsed().as_secs_f64() * 1000.0);
    }

    // Use median search time (more stable than average)
    search_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let search_time = search_times[search_times.len() / 2];

    // Return (build_time, search_time) separately
    (build_time, search_time)
}
