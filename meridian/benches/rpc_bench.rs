//! RPC server performance benchmarks
//!
//! Benchmarks for multi-threaded request handling, connection pooling,
//! and overall throughput under various load conditions.

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use meridian::rpc::{
    ConnectionPoolManager, ConnectionPoolConfig, ThreadPoolExecutor, ExecutorConfig,
    RequestDispatcher, DispatcherConfig, PerformanceMonitor, MonitorConfig,
    RpcRequest, Priority,
};
use meridian::storage::RocksDBStorage;
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio::runtime::Runtime;

/// Create test storage and connection pool
fn setup_pool() -> (TempDir, Arc<ConnectionPoolManager>) {
    let temp_dir = TempDir::new().unwrap();
    let storage = Arc::new(RocksDBStorage::new(temp_dir.path()).unwrap());

    let config = ConnectionPoolConfig {
        min_size: 4,
        max_size: 32,
        ..Default::default()
    };

    let pool = Arc::new(ConnectionPoolManager::new(storage, config).unwrap());
    (temp_dir, pool)
}

/// Benchmark connection pool acquire/release
fn bench_connection_pool(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let (_temp, pool) = setup_pool();

    let mut group = c.benchmark_group("connection_pool");

    // Sequential access
    group.bench_function("sequential_acquire", |b| {
        b.to_async(&rt).iter(|| async {
            let conn = pool.acquire().await.unwrap();
            black_box(conn);
        });
    });

    // Concurrent access
    for concurrency in [10, 50, 100, 500] {
        group.bench_with_input(
            BenchmarkId::new("concurrent_acquire", concurrency),
            &concurrency,
            |b, &concurrency| {
                b.to_async(&rt).iter(|| async {
                    let mut handles = vec![];

                    for _ in 0..concurrency {
                        let pool = Arc::clone(&pool);
                        handles.push(tokio::spawn(async move {
                            let conn = pool.acquire().await.unwrap();
                            black_box(conn);
                        }));
                    }

                    for handle in handles {
                        handle.await.unwrap();
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark thread pool executor
fn bench_executor(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("executor");

    // Different worker thread counts
    for workers in [2, 4, 8, 16] {
        let config = ExecutorConfig {
            worker_threads: workers,
            ..Default::default()
        };
        let executor = Arc::new(ThreadPoolExecutor::new(config));

        group.bench_with_input(
            BenchmarkId::new("task_execution", workers),
            &workers,
            |b, _| {
                b.to_async(&rt).iter(|| async {
                    let rx = executor
                        .submit(Priority::Normal, || Ok(42))
                        .await
                        .unwrap();

                    let result = rx.await.unwrap().unwrap();
                    black_box(result);
                });
            },
        );
    }

    group.finish();
}

/// Benchmark concurrent task processing
fn bench_concurrent_tasks(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let config = ExecutorConfig {
        worker_threads: num_cpus::get() * 2,
        ..Default::default()
    };
    let executor = Arc::new(ThreadPoolExecutor::new(config));

    let mut group = c.benchmark_group("concurrent_tasks");

    for task_count in [100, 500, 1000, 5000] {
        group.throughput(Throughput::Elements(task_count));
        group.bench_with_input(
            BenchmarkId::new("tasks", task_count),
            &task_count,
            |b, &task_count| {
                b.to_async(&rt).iter(|| async {
                    let mut receivers = vec![];

                    for i in 0..task_count {
                        let rx = executor
                            .submit(Priority::Normal, move || Ok(i * 2))
                            .await
                            .unwrap();
                        receivers.push(rx);
                    }

                    for rx in receivers {
                        let result = rx.await.unwrap().unwrap();
                        black_box(result);
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark request dispatcher
fn bench_dispatcher(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig::default()));
    let dispatcher = Arc::new(RequestDispatcher::new(
        Arc::clone(&executor),
        DispatcherConfig::default(),
    ));

    let mut group = c.benchmark_group("dispatcher");

    // Single request latency
    group.bench_function("single_request", |b| {
        b.to_async(&rt).iter(|| async {
            let request = RpcRequest {
                version: 1,
                id: 1,
                tool: "code.search_symbols".to_string(),
                params: rmpv::Value::Nil,
                stream: false,
                max_size: None,
                timeout_ms: Some(5000),
                auth: None,
            };

            let response = dispatcher.dispatch(request).await;
            black_box(response);
        });
    });

    // Concurrent requests
    for concurrency in [10, 50, 100, 500, 1000] {
        group.throughput(Throughput::Elements(concurrency));
        group.bench_with_input(
            BenchmarkId::new("concurrent_requests", concurrency),
            &concurrency,
            |b, &concurrency| {
                b.to_async(&rt).iter(|| async {
                    let mut handles = vec![];

                    for i in 0..concurrency {
                        let dispatcher = Arc::clone(&dispatcher);
                        handles.push(tokio::spawn(async move {
                            let request = RpcRequest {
                                version: 1,
                                id: i,
                                tool: "code.search_symbols".to_string(),
                                params: rmpv::Value::Nil,
                                stream: false,
                                max_size: None,
                                timeout_ms: Some(5000),
                                auth: None,
                            };

                            let response = dispatcher.dispatch(request).await;
                            black_box(response);
                        }));
                    }

                    for handle in handles {
                        handle.await.unwrap();
                    }
                });
            },
        );
    }

    group.finish();
}

/// Benchmark performance monitoring overhead
fn bench_monitor(c: &mut Criterion) {
    let monitor = Arc::new(PerformanceMonitor::new(MonitorConfig::default()));

    let mut group = c.benchmark_group("monitor");

    group.bench_function("record_latency", |b| {
        b.iter(|| {
            monitor.record_latency(black_box(10));
        });
    });

    group.bench_function("record_query", |b| {
        b.iter(|| {
            monitor.record_query(black_box(5), black_box(true));
        });
    });

    group.bench_function("collect_metrics", |b| {
        b.iter(|| {
            let metrics = monitor.collect_metrics();
            black_box(metrics);
        });
    });

    group.finish();
}

/// Stress test: measure throughput under sustained load
fn bench_stress_test(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig {
        worker_threads: num_cpus::get() * 2,
        ..Default::default()
    }));
    let dispatcher = Arc::new(RequestDispatcher::new(
        Arc::clone(&executor),
        DispatcherConfig::default(),
    ));
    let monitor = Arc::new(PerformanceMonitor::new(MonitorConfig::default()));

    let mut group = c.benchmark_group("stress_test");
    group.measurement_time(Duration::from_secs(10));
    group.sample_size(20);

    group.bench_function("sustained_load_10k", |b| {
        b.to_async(&rt).iter(|| async {
            let mut handles = vec![];

            // 10,000 concurrent requests
            for i in 0..10_000u64 {
                let dispatcher = Arc::clone(&dispatcher);
                let monitor = Arc::clone(&monitor);

                handles.push(tokio::spawn(async move {
                    let start = std::time::Instant::now();

                    let request = RpcRequest {
                        version: 1,
                        id: i,
                        tool: "code.search_symbols".to_string(),
                        params: rmpv::Value::Nil,
                        stream: false,
                        max_size: None,
                        timeout_ms: Some(5000),
                        auth: None,
                    };

                    let response = dispatcher.dispatch(request).await;
                    let latency_ms = start.elapsed().as_millis() as u64;

                    monitor.record_latency(latency_ms);
                    black_box(response);
                }));
            }

            for handle in handles {
                handle.await.unwrap();
            }

            // Print metrics
            let metrics = monitor.collect_metrics();
            println!("\n{}", monitor.generate_report());
            println!("P99 latency: {}ms", metrics.latency.p99);
        });
    });

    group.finish();
}

/// Memory usage benchmark
fn bench_memory_usage(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();
    let (_temp, pool) = setup_pool();

    let mut group = c.benchmark_group("memory");
    group.measurement_time(Duration::from_secs(5));

    group.bench_function("connection_pool_memory", |b| {
        b.to_async(&rt).iter(|| async {
            let mut conns = vec![];

            // Acquire max connections
            for _ in 0..32 {
                if let Ok(conn) = pool.acquire().await {
                    conns.push(conn);
                }
            }

            black_box(conns);
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_connection_pool,
    bench_executor,
    bench_concurrent_tasks,
    bench_dispatcher,
    bench_monitor,
    bench_stress_test,
    bench_memory_usage,
);

criterion_main!(benches);
