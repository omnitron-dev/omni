use criterion::{criterion_group, criterion_main, Criterion};
use meridian::storage::RocksDBStorage;
use std::sync::Arc;
use tempfile::TempDir;

fn benchmark_storage_operations(c: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();

    c.bench_function("storage_put", |b| {
        b.iter(|| {
            runtime.block_on(async {
                let temp_dir = TempDir::new().unwrap();
                let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

                for i in 0..100 {
                    let key = format!("key_{}", i);
                    let value = format!("value_{}", i);
                    storage.put(key.as_bytes(), value.as_bytes()).await.unwrap();
                }
            })
        })
    });

    c.bench_function("storage_get", |b| {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

        runtime.block_on(async {
            for i in 0..100 {
                let key = format!("key_{}", i);
                let value = format!("value_{}", i);
                storage.put(key.as_bytes(), value.as_bytes()).await.unwrap();
            }
        });

        b.iter(|| {
            runtime.block_on(async {
                for i in 0..100 {
                    let key = format!("key_{}", i);
                    let _ = std::hint::black_box(storage.get(key.as_bytes()).await.unwrap());
                }
            })
        })
    });
}

criterion_group!(benches, benchmark_storage_operations);
criterion_main!(benches);
