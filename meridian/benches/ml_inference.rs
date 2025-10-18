/// Benchmark for ML inference performance
///
/// Targets:
/// - Embeddings: <50ms per batch (32 texts)
/// - Reranking: <100ms for 20 pairs

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use meridian::ml::embeddings::EmbeddingEngine;
use meridian::ml::reranker::RerankingEngine;

fn benchmark_embeddings(c: &mut Criterion) {
    let mut engine = EmbeddingEngine::new().expect("Failed to create embedding engine");
    engine.warmup().expect("Failed to warmup");

    // Single embedding
    c.bench_function("embedding_single", |b| {
        b.iter(|| {
            engine.embed(black_box("fn add(a: i32, b: i32) -> i32 { a + b }"))
        })
    });

    // Batch of 8
    c.bench_function("embedding_batch_8", |b| {
        let texts: Vec<&str> = vec![
            "async fn process_data() -> Result<Data>",
            "fn calculate_sum(numbers: &[i32]) -> i32",
            "struct User { name: String, email: String }",
            "impl Display for Error { fn fmt() {} }",
            "pub trait Service { fn call(&self) -> Response; }",
            "enum Result<T, E> { Ok(T), Err(E) }",
            "fn main() { println!(\"Hello\"); }",
            "const MAX_SIZE: usize = 1024;",
        ];
        b.iter(|| {
            engine.batch_embed(black_box(&texts))
        })
    });

    // Batch of 32
    c.bench_function("embedding_batch_32", |b| {
        let texts: Vec<&str> = (0..32)
            .map(|i| match i % 4 {
                0 => "async fn process_data() -> Result<Data>",
                1 => "fn calculate_sum(numbers: &[i32]) -> i32",
                2 => "struct User { name: String, email: String }",
                _ => "impl Display for Error { fn fmt() {} }",
            })
            .collect();
        b.iter(|| {
            engine.batch_embed(black_box(&texts))
        })
    });
}

fn benchmark_reranking(c: &mut Criterion) {
    let mut engine = RerankingEngine::new().expect("Failed to create reranking engine");
    engine.warmup().expect("Failed to warmup");

    let query = "implement vector search with HNSW";

    // Rerank 10 candidates
    c.bench_with_input(
        BenchmarkId::new("rerank", 10),
        &10,
        |b, &size| {
            let candidates: Vec<&str> = (0..size)
                .map(|i| match i % 5 {
                    0 => "HNSW algorithm for approximate nearest neighbor search",
                    1 => "Vector database implementation guide",
                    2 => "Introduction to Python programming",
                    3 => "Building fast similarity search with vectors",
                    _ => "JavaScript async/await tutorial",
                })
                .collect();
            b.iter(|| {
                engine.rerank(black_box(query), black_box(&candidates), 3)
            })
        },
    );

    // Rerank 20 candidates (target use case)
    c.bench_with_input(
        BenchmarkId::new("rerank", 20),
        &20,
        |b, &size| {
            let candidates: Vec<&str> = (0..size)
                .map(|i| match i % 5 {
                    0 => "HNSW algorithm for approximate nearest neighbor search",
                    1 => "Vector database implementation guide",
                    2 => "Introduction to Python programming",
                    3 => "Building fast similarity search with vectors",
                    _ => "JavaScript async/await tutorial",
                })
                .collect();
            b.iter(|| {
                engine.rerank(black_box(query), black_box(&candidates), 3)
            })
        },
    );

    // Rerank 50 candidates
    c.bench_with_input(
        BenchmarkId::new("rerank", 50),
        &50,
        |b, &size| {
            let candidates: Vec<&str> = (0..size)
                .map(|i| match i % 5 {
                    0 => "HNSW algorithm for approximate nearest neighbor search",
                    1 => "Vector database implementation guide",
                    2 => "Introduction to Python programming",
                    3 => "Building fast similarity search with vectors",
                    _ => "JavaScript async/await tutorial",
                })
                .collect();
            b.iter(|| {
                engine.rerank(black_box(query), black_box(&candidates), 3)
            })
        },
    );
}

criterion_group!(benches, benchmark_embeddings, benchmark_reranking);
criterion_main!(benches);
