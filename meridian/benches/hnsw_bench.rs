use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use meridian::indexer::vector::{HnswConfig, HnswIndex, VectorIndex, VECTOR_DIM};

fn bench_hnsw_insertion(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_insertion");

    for size in [1000, 10_000, 100_000].iter() {
        group.throughput(Throughput::Elements(*size as u64));
        group.bench_with_input(BenchmarkId::from_parameter(size), size, |b, &size| {
            b.iter(|| {
                let mut index = HnswIndex::new(VECTOR_DIM, size + 1000);
                for i in 0..size {
                    let mut vec = vec![0.0; VECTOR_DIM];
                    vec[0] = i as f32;
                    index.add_vector(&format!("vec_{}", i), &vec).unwrap();
                }
                black_box(index);
            });
        });
    }

    group.finish();
}

fn bench_hnsw_search(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_search");

    // Build index with 100k vectors
    let index_size = 100_000;
    let mut index = HnswIndex::new(VECTOR_DIM, index_size + 1000);

    for i in 0..index_size {
        let mut vec = vec![0.0; VECTOR_DIM];
        for j in 0..VECTOR_DIM.min(10) {
            vec[j] = ((i * j) as f32).sin();
        }
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();
    }

    let query = vec![0.5; VECTOR_DIM];

    for k in [1, 10, 50, 100].iter() {
        group.throughput(Throughput::Elements(1));
        group.bench_with_input(BenchmarkId::new("k", k), k, |b, &k| {
            b.iter(|| {
                let results = index.search(black_box(&query), black_box(k)).unwrap();
                black_box(results);
            });
        });
    }

    group.finish();
}

fn bench_hnsw_config_impact(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_config");

    let configs = vec![
        ("low_quality", HnswConfig {
            max_connections: 8,
            ef_construction: 100,
            ef_search: 50,
            max_elements: 100_000,
        }),
        ("default", HnswConfig::default()),
        ("high_quality", HnswConfig {
            max_connections: 32,
            ef_construction: 400,
            ef_search: 200,
            max_elements: 100_000,
        }),
    ];

    for (name, config) in configs {
        group.bench_function(BenchmarkId::new("build", name), |b| {
            b.iter(|| {
                let mut index = HnswIndex::with_config(VECTOR_DIM, config.clone());
                for i in 0..10_000 {
                    let mut vec = vec![0.0; VECTOR_DIM];
                    vec[0] = i as f32;
                    index.add_vector(&format!("vec_{}", i), &vec).unwrap();
                }
                black_box(index);
            });
        });

        // Build index for search benchmark
        let mut index = HnswIndex::with_config(VECTOR_DIM, config.clone());
        for i in 0..10_000 {
            let mut vec = vec![0.0; VECTOR_DIM];
            vec[0] = i as f32;
            index.add_vector(&format!("vec_{}", i), &vec).unwrap();
        }

        let query = vec![5000.0; VECTOR_DIM];

        group.bench_function(BenchmarkId::new("search", name), |b| {
            b.iter(|| {
                let results = index.search(black_box(&query), black_box(10)).unwrap();
                black_box(results);
            });
        });
    }

    group.finish();
}

fn bench_hnsw_update(c: &mut Criterion) {
    let mut group = c.benchmark_group("hnsw_update");

    // Pre-populate index
    let mut index = HnswIndex::new(VECTOR_DIM, 100_000);
    for i in 0..10_000 {
        let vec = vec![i as f32; VECTOR_DIM];
        index.add_vector(&format!("vec_{}", i), &vec).unwrap();
    }

    group.bench_function("update_existing", |b| {
        let mut idx = 0;
        b.iter(|| {
            let vec = vec![(10_000 + idx) as f32; VECTOR_DIM];
            index.add_vector(&format!("vec_{}", idx % 1000), &vec).unwrap();
            idx += 1;
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_hnsw_insertion,
    bench_hnsw_search,
    bench_hnsw_config_impact,
    bench_hnsw_update
);
criterion_main!(benches);
