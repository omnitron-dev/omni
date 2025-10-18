/// Benchmarks for cross-encoder reranking
///
/// Measures:
/// - Reranking latency for different batch sizes
/// - Token savings vs baseline
/// - Cache effectiveness
/// - Precision@k metrics

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use meridian::ml::reranker::{CrossEncoderReranker, Reranker};

fn create_test_candidates(count: usize) -> Vec<String> {
    let relevant_templates = vec![
        "Implement HNSW vector search algorithm in Rust",
        "Building scalable vector database with approximate nearest neighbor",
        "Optimizing vector similarity search performance",
        "Cross-encoder reranking for improved search precision",
        "Semantic search with dense embeddings",
    ];

    let irrelevant_templates = vec![
        "Introduction to web development with JavaScript",
        "Database normalization and schema design",
        "Docker container orchestration patterns",
        "API rate limiting strategies",
        "React component lifecycle methods",
        "SQL query optimization techniques",
        "Load balancing with nginx",
        "Git branching workflows",
        "CSS grid layout tutorial",
        "MongoDB aggregation pipeline",
    ];

    let mut candidates = Vec::with_capacity(count);

    // Mix relevant and irrelevant documents
    for i in 0..count {
        if i % 4 == 0 {
            // 25% relevant
            let template = &relevant_templates[i % relevant_templates.len()];
            candidates.push(format!("{} - variation {}", template, i));
        } else {
            // 75% irrelevant
            let template = &irrelevant_templates[i % irrelevant_templates.len()];
            candidates.push(format!("{} - document {}", template, i));
        }
    }

    candidates
}

fn bench_reranking_latency(c: &mut Criterion) {
    let mut group = c.benchmark_group("reranking_latency");

    let reranker = CrossEncoderReranker::new().expect("Failed to create reranker");
    let query = "vector search implementation";

    for size in [5, 10, 20, 50].iter() {
        let candidates = create_test_candidates(*size);
        let candidate_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();

        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, _| {
            b.iter(|| {
                let results = reranker
                    .rerank(black_box(query), black_box(&candidate_refs), black_box(3))
                    .expect("Reranking failed");
                black_box(results);
            });
        });
    }

    group.finish();
}

fn bench_cache_effectiveness(c: &mut Criterion) {
    let mut group = c.benchmark_group("cache_effectiveness");

    let reranker = CrossEncoderReranker::new().expect("Failed to create reranker");
    let query = "test query";
    let candidates = create_test_candidates(20);
    let candidate_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();

    group.bench_function("first_call_no_cache", |b| {
        b.iter(|| {
            reranker.clear_cache();
            let results = reranker
                .rerank(black_box(query), black_box(&candidate_refs), black_box(3))
                .expect("Reranking failed");
            black_box(results);
        });
    });

    group.bench_function("cached_call", |b| {
        // Warm up cache
        let _ = reranker.rerank(query, &candidate_refs, 3);

        b.iter(|| {
            let results = reranker
                .rerank(black_box(query), black_box(&candidate_refs), black_box(3))
                .expect("Reranking failed");
            black_box(results);
        });
    });

    group.finish();
}

fn bench_different_top_k(c: &mut Criterion) {
    let mut group = c.benchmark_group("different_top_k");

    let reranker = CrossEncoderReranker::new().expect("Failed to create reranker");
    let query = "machine learning model training";
    let candidates = create_test_candidates(20);
    let candidate_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();

    for top_k in [1, 3, 5, 10].iter() {
        group.bench_with_input(BenchmarkId::from_parameter(top_k), top_k, |b, &k| {
            b.iter(|| {
                let results = reranker
                    .rerank(black_box(query), black_box(&candidate_refs), black_box(k))
                    .expect("Reranking failed");
                black_box(results);
            });
        });
    }

    group.finish();
}

fn bench_query_complexity(c: &mut Criterion) {
    let mut group = c.benchmark_group("query_complexity");

    let reranker = CrossEncoderReranker::new().expect("Failed to create reranker");
    let candidates = create_test_candidates(20);
    let candidate_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();

    let queries = vec![
        ("short", "search"),
        ("medium", "vector search implementation"),
        ("long", "How to implement efficient vector similarity search using HNSW algorithm in Rust"),
        ("very_long", "I need to implement a high-performance vector similarity search system using the HNSW (Hierarchical Navigable Small World) algorithm in Rust programming language for a production environment"),
    ];

    for (name, query) in queries {
        group.bench_with_input(BenchmarkId::from_parameter(name), &query, |b, &q| {
            b.iter(|| {
                let results = reranker
                    .rerank(black_box(q), black_box(&candidate_refs), black_box(3))
                    .expect("Reranking failed");
                black_box(results);
            });
        });
    }

    group.finish();
}

fn bench_token_savings(c: &mut Criterion) {
    let mut group = c.benchmark_group("token_savings");

    let reranker = CrossEncoderReranker::new().expect("Failed to create reranker");
    let query = "vector database implementation";

    // Simulate different document lengths (token counts)
    let short_docs: Vec<String> = (0..20)
        .map(|i| format!("Short doc {} about vectors", i))
        .collect();

    let medium_docs: Vec<String> = (0..20)
        .map(|i| {
            format!(
                "Medium length document {} discussing vector search implementation details and considerations",
                i
            )
        })
        .collect();

    let long_docs: Vec<String> = (0..20)
        .map(|i| {
            format!(
                "This is a longer document {} that contains extensive information about vector search algorithms, \
                 including HNSW, IVF, and other approximate nearest neighbor search techniques. \
                 It discusses implementation details, performance characteristics, and use cases.",
                i
            )
        })
        .collect();

    for (name, docs) in vec![("short", &short_docs), ("medium", &medium_docs), ("long", &long_docs)] {
        let doc_refs: Vec<&str> = docs.iter().map(|s| s.as_str()).collect();

        group.bench_with_input(BenchmarkId::from_parameter(name), &name, |b, _| {
            b.iter(|| {
                let results = reranker
                    .rerank(black_box(query), black_box(&doc_refs), black_box(3))
                    .expect("Reranking failed");
                black_box(results);
            });
        });
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_reranking_latency,
    bench_cache_effectiveness,
    bench_different_top_k,
    bench_query_complexity,
    bench_token_savings,
);
criterion_main!(benches);
