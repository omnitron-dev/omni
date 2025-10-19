use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use meridian::embeddings::EmbeddingEngine;
use meridian::indexer::vector::{HnswIndex, VectorIndex};
use meridian::memory::EpisodicMemory;
use meridian::storage::MemoryStorage;
use meridian::types::{EpisodeId, Outcome, TaskEpisode, TokenCount, ContextSnapshot};
use std::sync::Arc;
use chrono::Utc;

/// Generate sample episodes for benchmarking
fn generate_test_episodes(count: usize) -> Vec<TaskEpisode> {
    let task_templates = vec![
        "Implement authentication middleware with JWT",
        "Fix memory leak in event handler",
        "Optimize database query performance",
        "Add unit tests for API endpoints",
        "Refactor monolithic service into microservices",
        "Debug race condition in concurrent processing",
        "Implement caching layer with Redis",
        "Add logging and monitoring instrumentation",
        "Update dependencies to latest versions",
        "Fix CSS layout issues on mobile devices",
    ];

    (0..count)
        .map(|i| {
            let template = &task_templates[i % task_templates.len()];
            TaskEpisode {
                schema_version: 1,
                id: EpisodeId::new(),
                timestamp: Utc::now(),
                task_description: format!("{} (variant {})", template, i / task_templates.len()),
                initial_context: ContextSnapshot::default(),
                queries_made: vec![format!("query_{}", i)],
                files_touched: vec![format!("src/file_{}.rs", i)],
                solution_path: format!("Solution for task {}", i),
                outcome: Outcome::Success,
                tokens_used: TokenCount::new(1000),
                access_count: 0,
                pattern_value: 0.8,
            }
        })
        .collect()
}

/// Benchmark linear search (baseline)
fn bench_linear_search(c: &mut Criterion) {
    let mut group = c.benchmark_group("similarity_search");
    
    for size in [100, 500, 1000, 5000].iter() {
        let episodes = generate_test_episodes(*size);
        let engine = EmbeddingEngine::new().unwrap();
        
        // Pre-generate embeddings for fair comparison
        let embeddings: Vec<Vec<f32>> = episodes
            .iter()
            .map(|e| engine.generate_embedding(&e.task_description).unwrap())
            .collect();
        
        let query = "Implement authentication with JWT tokens";
        let query_emb = engine.generate_embedding(query).unwrap();
        
        group.bench_with_input(
            BenchmarkId::new("linear", size),
            size,
            |b, _| {
                b.iter(|| {
                    // Linear O(n) search - compute cosine similarity with all vectors
                    let mut scores: Vec<(usize, f32)> = embeddings
                        .iter()
                        .enumerate()
                        .map(|(i, emb)| {
                            let similarity = EmbeddingEngine::cosine_similarity(&query_emb, emb);
                            (i, similarity)
                        })
                        .collect();
                    
                    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                    black_box(&scores[..5.min(scores.len())]);
                });
            },
        );
    }
    
    group.finish();
}

/// Benchmark HNSW search (optimized)
fn bench_hnsw_search(c: &mut Criterion) {
    let mut group = c.benchmark_group("similarity_search");
    
    for size in [100, 500, 1000, 5000].iter() {
        let episodes = generate_test_episodes(*size);
        let engine = EmbeddingEngine::new().unwrap();
        
        // Build HNSW index
        let mut index = HnswIndex::new(engine.dimension(), *size);
        for episode in &episodes {
            let emb = engine.generate_embedding(&episode.task_description).unwrap();
            index.add_vector(&episode.id.0, &emb).unwrap();
        }
        
        let query = "Implement authentication with JWT tokens";
        let query_emb = engine.generate_embedding(query).unwrap();
        
        group.bench_with_input(
            BenchmarkId::new("hnsw", size),
            size,
            |b, _| {
                b.iter(|| {
                    let results = index.search(&query_emb, 5).unwrap();
                    black_box(&results);
                });
            },
        );
    }
    
    group.finish();
}

/// Benchmark HNSW index construction
fn bench_hnsw_construction(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_construction");
    
    for size in [100, 500, 1000, 5000].iter() {
        let episodes = generate_test_episodes(*size);
        let engine = EmbeddingEngine::new().unwrap();
        
        // Pre-generate embeddings
        let embeddings: Vec<(String, Vec<f32>)> = episodes
            .iter()
            .map(|e| {
                let emb = engine.generate_embedding(&e.task_description).unwrap();
                (e.id.0.clone(), emb)
            })
            .collect();
        
        group.bench_with_input(
            BenchmarkId::new("build_index", size),
            size,
            |b, _| {
                b.iter(|| {
                    let mut index = HnswIndex::new(engine.dimension(), *size);
                    for (id, emb) in &embeddings {
                        index.add_vector(id, emb).unwrap();
                    }
                    black_box(&index);
                });
            },
        );
    }
    
    group.finish();
}

/// End-to-end benchmark with EpisodicMemory
fn bench_episodic_memory_e2e(c: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let mut group = c.benchmark_group("episodic_memory_e2e");
    
    for size in [100, 500, 1000].iter() {
        let episodes = generate_test_episodes(*size);
        let storage = Arc::new(MemoryStorage::new());
        
        // Build memory with HNSW index
        let mut memory = runtime.block_on(async {
            let mut mem = EpisodicMemory::new(storage, 30).unwrap();
            for episode in episodes {
                mem.record_episode(episode).await.unwrap();
            }
            mem
        });
        
        group.bench_with_input(
            BenchmarkId::new("find_similar", size),
            size,
            |b, _| {
                b.to_async(&runtime).iter(|| async {
                    let results = memory.find_similar("Implement authentication middleware", 5).await;
                    black_box(results);
                });
            },
        );
    }
    
    group.finish();
}

criterion_group!(
    benches,
    bench_linear_search,
    bench_hnsw_search,
    bench_hnsw_construction,
    bench_episodic_memory_e2e
);
criterion_main!(benches);
