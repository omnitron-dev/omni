use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use meridian::memory::episodic::EpisodicMemory;
use meridian::storage::rocksdb_storage::RocksDBStorage;
use meridian::types::{ContextSnapshot, EpisodeId, Outcome, TaskEpisode, TokenCount};
use std::sync::Arc;
use tempfile::TempDir;
use chrono::Utc;

/// Create a test episode with given index
fn create_test_episode(idx: usize, task_variant: usize) -> TaskEpisode {
    let tasks = vec![
        "Implement authentication middleware with JWT tokens",
        "Add database migration for user profiles",
        "Fix bug in payment processing pipeline",
        "Refactor API endpoints for better performance",
        "Add unit tests for authentication module",
        "Implement caching layer with Redis",
        "Optimize database queries in user service",
        "Add logging and monitoring to background jobs",
        "Fix memory leak in worker process",
        "Implement rate limiting for API endpoints",
    ];

    let task_description = format!("{} (variant {})", tasks[task_variant % tasks.len()], idx);

    TaskEpisode {
        schema_version: 1,
        id: EpisodeId::new(),
        timestamp: Utc::now(),
        task_description,
        initial_context: ContextSnapshot::default(),
        queries_made: vec![
            format!("search for middleware {}", idx),
            format!("find authentication {}", idx),
        ],
        files_touched: vec![
            format!("src/middleware/auth_{}.ts", idx),
            format!("tests/auth_{}_test.ts", idx),
        ],
        solution_path: format!("Implemented solution {} using pattern X", idx),
        outcome: Outcome::Success,
        tokens_used: TokenCount::new(1000 + (idx % 500) as u32),
        access_count: 0,
        pattern_value: 0.8 + (idx % 20) as f32 / 100.0,
    }
}

/// Benchmark episodic memory search with different dataset sizes
fn bench_episodic_search_scalability(c: &mut Criterion) {
    let mut group = c.benchmark_group("episodic_search_scalability");

    // Test with different dataset sizes
    for size in [100, 1_000, 5_000, 10_000].iter() {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

        // Create memory instance with HNSW index path
        let hnsw_path = temp_dir.path().join("hnsw_index");
        let mut memory = EpisodicMemory::with_index_path(
            storage.clone(),
            30,
            Some(hnsw_path),
        ).unwrap();

        // Populate with episodes
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            for i in 0..*size {
                let episode = create_test_episode(i, i % 10);
                memory.record_episode(episode).await.unwrap();
            }
        });

        group.throughput(Throughput::Elements(1));
        group.bench_with_input(
            BenchmarkId::new("hnsw_search", size),
            size,
            |b, _size| {
                let rt = tokio::runtime::Runtime::new().unwrap();
                b.iter(|| {
                    rt.block_on(async {
                        let results = memory.find_similar(
                            black_box("Implement authentication middleware"),
                            black_box(5),
                        ).await;
                        black_box(results);
                    });
                });
            },
        );
    }

    group.finish();
}

/// Benchmark comparison: HNSW vs keyword-only search
fn bench_hnsw_vs_keyword(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_vs_keyword");

    let size = 10_000;
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    // Create memory WITH HNSW
    let hnsw_path = temp_dir.path().join("hnsw_index");
    let mut memory_with_hnsw = EpisodicMemory::with_index_path(
        storage.clone(),
        30,
        Some(hnsw_path),
    ).unwrap();

    // Create memory WITHOUT HNSW (by not initializing embedding engine)
    // This will fall back to keyword search
    let no_hnsw_path = temp_dir.path().join("no_hnsw");
    let storage2 = Arc::new(RocksDBStorage::new(&no_hnsw_path).unwrap());
    let mut memory_keyword_only = EpisodicMemory::new(storage2, 30).unwrap();

    // Populate both with same episodes
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        for i in 0..size {
            let episode = create_test_episode(i, i % 10);
            memory_with_hnsw.record_episode(episode.clone()).await.unwrap();
            memory_keyword_only.record_episode(episode).await.unwrap();
        }
    });

    // Benchmark HNSW search
    group.throughput(Throughput::Elements(1));
    group.bench_function("with_hnsw", |b| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        b.iter(|| {
            rt.block_on(async {
                let results = memory_with_hnsw.find_similar(
                    black_box("Implement authentication middleware"),
                    black_box(5),
                ).await;
                black_box(results);
            });
        });
    });

    // Benchmark keyword-only search (for comparison if HNSW fails)
    group.bench_function("keyword_fallback", |b| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        b.iter(|| {
            rt.block_on(async {
                let results = memory_keyword_only.find_similar(
                    black_box("Implement authentication middleware"),
                    black_box(5),
                ).await;
                black_box(results);
            });
        });
    });

    group.finish();
}

/// Benchmark episode recording with HNSW indexing
fn bench_episode_recording(c: &mut Criterion) {
    let mut group = c.benchmark_group("episode_recording");

    for with_hnsw in [false, true].iter() {
        let label = if *with_hnsw { "with_hnsw" } else { "without_hnsw" };

        group.bench_function(label, |b| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let mut idx = 0;

            b.iter(|| {
                // Create fresh storage and memory for each iteration
                let temp_dir = TempDir::new().unwrap();
                let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

                let mut memory = if *with_hnsw {
                    let hnsw_path = temp_dir.path().join("hnsw_index");
                    EpisodicMemory::with_index_path(storage, 30, Some(hnsw_path)).unwrap()
                } else {
                    EpisodicMemory::new(storage, 30).unwrap()
                };

                let episode = create_test_episode(idx, idx % 10);
                idx += 1;

                rt.block_on(async {
                    memory.record_episode(black_box(episode)).await.unwrap();
                });
            });
        });
    }

    group.finish();
}

/// Benchmark HNSW index persistence
fn bench_hnsw_persistence(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_persistence");

    let size = 10_000;
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());
    let hnsw_path = temp_dir.path().join("hnsw_index");

    let mut memory = EpisodicMemory::with_index_path(
        storage.clone(),
        30,
        Some(hnsw_path.clone()),
    ).unwrap();

    // Populate episodes
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        for i in 0..size {
            let episode = create_test_episode(i, i % 10);
            memory.record_episode(episode).await.unwrap();
        }
    });

    // Benchmark save
    group.bench_function("save_index", |b| {
        b.iter(|| {
            memory.save_index().unwrap();
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_episodic_search_scalability,
    bench_hnsw_vs_keyword,
    bench_episode_recording,
    bench_hnsw_persistence,
);
criterion_main!(benches);
