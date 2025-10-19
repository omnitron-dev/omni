//! Performance monitoring and metrics collection
//!
//! This module provides real-time performance metrics, latency tracking,
//! and automatic performance reporting for the RPC server.

use parking_lot::RwLock;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::System;
use tracing::{debug, info};

/// Latency percentiles
#[derive(Debug, Clone, Default)]
pub struct LatencyHistogram {
    /// Minimum latency (ms)
    pub min: u64,

    /// Maximum latency (ms)
    pub max: u64,

    /// Average latency (ms)
    pub avg: u64,

    /// P50 (median) latency (ms)
    pub p50: u64,

    /// P95 latency (ms)
    pub p95: u64,

    /// P99 latency (ms)
    pub p99: u64,

    /// P999 latency (ms)
    pub p999: u64,

    /// Total samples
    pub samples: usize,
}

/// Thread utilization metrics
#[derive(Debug, Clone, Default)]
pub struct ThreadMetrics {
    /// Total worker threads
    pub total_threads: usize,

    /// Active (busy) threads
    pub active_threads: usize,

    /// Thread utilization percentage (0-100)
    pub utilization_pct: f64,

    /// Average tasks per thread
    pub avg_tasks_per_thread: f64,
}

/// Database query performance
#[derive(Debug, Clone, Default)]
pub struct QueryMetrics {
    /// Total queries executed
    pub total_queries: u64,

    /// Average query time (ms)
    pub avg_query_time_ms: u64,

    /// Slow queries (>100ms)
    pub slow_queries: u64,

    /// Failed queries
    pub failed_queries: u64,
}

/// Memory usage metrics
#[derive(Debug, Clone, Default)]
pub struct MemoryMetrics {
    /// Total allocated memory (MB)
    pub allocated_mb: f64,

    /// RSS memory (MB)
    pub rss_mb: f64,

    /// Heap memory (MB)
    pub heap_mb: f64,

    /// Memory usage percentage
    pub usage_pct: f64,
}

/// Complete performance metrics
#[derive(Debug, Clone)]
pub struct PerformanceMetrics {
    /// Request latency histogram
    pub latency: LatencyHistogram,

    /// Thread utilization
    pub threads: ThreadMetrics,

    /// Database query performance
    pub queries: QueryMetrics,

    /// Memory usage
    pub memory: MemoryMetrics,

    /// Requests per second
    pub requests_per_sec: f64,

    /// Errors per second
    pub errors_per_sec: f64,

    /// Timestamp when metrics were collected
    pub timestamp: Instant,
}

impl Default for PerformanceMetrics {
    fn default() -> Self {
        Self {
            latency: LatencyHistogram::default(),
            threads: ThreadMetrics::default(),
            queries: QueryMetrics::default(),
            memory: MemoryMetrics::default(),
            requests_per_sec: 0.0,
            errors_per_sec: 0.0,
            timestamp: Instant::now(),
        }
    }
}

/// Performance monitor configuration
#[derive(Debug, Clone)]
pub struct MonitorConfig {
    /// Sample window size for latency tracking
    pub sample_window_size: usize,

    /// Report interval in seconds
    pub report_interval_secs: u64,

    /// Enable automatic reporting
    pub enable_auto_report: bool,

    /// Slow query threshold (ms)
    pub slow_query_threshold_ms: u64,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            sample_window_size: 10_000,
            report_interval_secs: 60,
            enable_auto_report: true,
            slow_query_threshold_ms: 100,
        }
    }
}

/// Performance monitor
pub struct PerformanceMonitor {
    config: MonitorConfig,
    latency_samples: Arc<RwLock<VecDeque<u64>>>,
    request_count: Arc<RwLock<u64>>,
    error_count: Arc<RwLock<u64>>,
    query_times: Arc<RwLock<VecDeque<u64>>>,
    slow_query_count: Arc<RwLock<u64>>,
    failed_query_count: Arc<RwLock<u64>>,
    last_report: Arc<RwLock<Instant>>,
    system: Arc<RwLock<System>>,
}

impl PerformanceMonitor {
    /// Create a new performance monitor
    pub fn new(config: MonitorConfig) -> Self {
        

        Self {
            config,
            latency_samples: Arc::new(RwLock::new(VecDeque::new())),
            request_count: Arc::new(RwLock::new(0)),
            error_count: Arc::new(RwLock::new(0)),
            query_times: Arc::new(RwLock::new(VecDeque::new())),
            slow_query_count: Arc::new(RwLock::new(0)),
            failed_query_count: Arc::new(RwLock::new(0)),
            last_report: Arc::new(RwLock::new(Instant::now())),
            system: Arc::new(RwLock::new(System::new_all())),
        }
    }

    /// Record request latency
    pub fn record_latency(&self, latency_ms: u64) {
        let mut samples = self.latency_samples.write();

        // Add new sample
        samples.push_back(latency_ms);

        // Keep window size
        while samples.len() > self.config.sample_window_size {
            samples.pop_front();
        }

        // Increment request count
        *self.request_count.write() += 1;
    }

    /// Record request error
    pub fn record_error(&self) {
        *self.error_count.write() += 1;
    }

    /// Record database query
    pub fn record_query(&self, duration_ms: u64, success: bool) {
        let mut query_times = self.query_times.write();
        query_times.push_back(duration_ms);

        // Keep window size
        while query_times.len() > self.config.sample_window_size {
            query_times.pop_front();
        }

        if duration_ms > self.config.slow_query_threshold_ms {
            *self.slow_query_count.write() += 1;
        }

        if !success {
            *self.failed_query_count.write() += 1;
        }
    }

    /// Calculate latency histogram from samples
    fn calculate_histogram(&self, samples: &[u64]) -> LatencyHistogram {
        if samples.is_empty() {
            return LatencyHistogram::default();
        }

        let mut sorted = samples.to_vec();
        sorted.sort_unstable();

        let min = *sorted.first().unwrap();
        let max = *sorted.last().unwrap();
        let avg = sorted.iter().sum::<u64>() / sorted.len() as u64;

        let p50 = sorted[sorted.len() * 50 / 100];
        let p95 = sorted[sorted.len() * 95 / 100];
        let p99 = sorted[sorted.len() * 99 / 100];
        let p999 = sorted[sorted.len() * 999 / 1000];

        LatencyHistogram {
            min,
            max,
            avg,
            p50,
            p95,
            p99,
            p999,
            samples: sorted.len(),
        }
    }

    /// Get memory metrics
    fn get_memory_metrics(&self) -> MemoryMetrics {
        let mut system = self.system.write();
        system.refresh_memory();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

        let current_pid = sysinfo::Pid::from_u32(std::process::id());
        let process = system.process(current_pid);

        if let Some(process) = process {
            let rss_mb = process.memory() as f64 / 1024.0 / 1024.0;
            let total_mb = system.total_memory() as f64 / 1024.0 / 1024.0;
            let usage_pct = (rss_mb / total_mb) * 100.0;

            MemoryMetrics {
                allocated_mb: rss_mb,
                rss_mb,
                heap_mb: rss_mb * 0.8, // Approximation
                usage_pct,
            }
        } else {
            MemoryMetrics::default()
        }
    }

    /// Collect current performance metrics
    pub fn collect_metrics(&self) -> PerformanceMetrics {
        let latency_samples = self.latency_samples.read();
        let latency = self.calculate_histogram(&latency_samples.iter().copied().collect::<Vec<_>>());

        let query_times = self.query_times.read();
        let total_queries = query_times.len() as u64;
        let avg_query_time_ms = if total_queries > 0 {
            query_times.iter().sum::<u64>() / total_queries
        } else {
            0
        };

        let slow_queries = *self.slow_query_count.read();
        let failed_queries = *self.failed_query_count.read();

        let queries = QueryMetrics {
            total_queries,
            avg_query_time_ms,
            slow_queries,
            failed_queries,
        };

        let memory = self.get_memory_metrics();

        let last_report = *self.last_report.read();
        let elapsed = last_report.elapsed().as_secs_f64();

        let total_requests = *self.request_count.read();
        let total_errors = *self.error_count.read();

        let requests_per_sec = if elapsed > 0.0 {
            total_requests as f64 / elapsed
        } else {
            0.0
        };

        let errors_per_sec = if elapsed > 0.0 {
            total_errors as f64 / elapsed
        } else {
            0.0
        };

        PerformanceMetrics {
            latency,
            threads: ThreadMetrics::default(), // Will be populated by caller
            queries,
            memory,
            requests_per_sec,
            errors_per_sec,
            timestamp: Instant::now(),
        }
    }

    /// Generate performance report
    pub fn generate_report(&self) -> String {
        let metrics = self.collect_metrics();

        format!(
            r#"
═══════════════════════════════════════════════════════════
                 PERFORMANCE REPORT
═══════════════════════════════════════════════════════════

THROUGHPUT
  Requests/sec:    {:.2}
  Errors/sec:      {:.2}

LATENCY (ms)
  Min:             {}
  Avg:             {}
  P50:             {}
  P95:             {}
  P99:             {}
  P999:            {}
  Max:             {}
  Samples:         {}

DATABASE QUERIES
  Total:           {}
  Avg time (ms):   {}
  Slow queries:    {}
  Failed:          {}

MEMORY
  RSS (MB):        {:.2}
  Heap (MB):       {:.2}
  Usage:           {:.2}%

═══════════════════════════════════════════════════════════
"#,
            metrics.requests_per_sec,
            metrics.errors_per_sec,
            metrics.latency.min,
            metrics.latency.avg,
            metrics.latency.p50,
            metrics.latency.p95,
            metrics.latency.p99,
            metrics.latency.p999,
            metrics.latency.max,
            metrics.latency.samples,
            metrics.queries.total_queries,
            metrics.queries.avg_query_time_ms,
            metrics.queries.slow_queries,
            metrics.queries.failed_queries,
            metrics.memory.rss_mb,
            metrics.memory.heap_mb,
            metrics.memory.usage_pct,
        )
    }

    /// Print performance report
    pub fn print_report(&self) {
        let report = self.generate_report();
        info!("{}", report);

        // Reset counters
        *self.last_report.write() = Instant::now();
        *self.request_count.write() = 0;
        *self.error_count.write() = 0;
    }

    /// Spawn automatic reporting task
    pub fn spawn_auto_report_task(self: Arc<Self>) {
        if !self.config.enable_auto_report {
            return;
        }

        let interval = Duration::from_secs(self.config.report_interval_secs);
        let report_interval_secs = self.config.report_interval_secs;

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(interval);

            loop {
                interval.tick().await;
                self.print_report();
            }
        });

        debug!("Auto-report task started (interval: {}s)", report_interval_secs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_monitor_creation() {
        let monitor = PerformanceMonitor::new(MonitorConfig::default());
        let metrics = monitor.collect_metrics();

        assert_eq!(metrics.latency.samples, 0);
        assert_eq!(metrics.requests_per_sec, 0.0);
    }

    #[test]
    fn test_latency_recording() {
        let monitor = PerformanceMonitor::new(MonitorConfig::default());

        monitor.record_latency(10);
        monitor.record_latency(20);
        monitor.record_latency(30);

        let metrics = monitor.collect_metrics();
        assert_eq!(metrics.latency.samples, 3);
        assert_eq!(metrics.latency.min, 10);
        assert_eq!(metrics.latency.max, 30);
    }

    #[test]
    fn test_histogram_calculation() {
        let monitor = PerformanceMonitor::new(MonitorConfig::default());

        for i in 1..=100 {
            monitor.record_latency(i);
        }

        let metrics = monitor.collect_metrics();
        assert_eq!(metrics.latency.samples, 100);
        assert_eq!(metrics.latency.min, 1);
        assert_eq!(metrics.latency.max, 100);
        assert!(metrics.latency.p50 >= 40 && metrics.latency.p50 <= 60);
        assert!(metrics.latency.p95 >= 90);
    }

    #[test]
    fn test_query_tracking() {
        let config = MonitorConfig {
            slow_query_threshold_ms: 50,
            ..Default::default()
        };
        let monitor = PerformanceMonitor::new(config);

        monitor.record_query(10, true);
        monitor.record_query(60, true); // Slow
        monitor.record_query(100, false); // Slow + failed

        let metrics = monitor.collect_metrics();
        assert_eq!(metrics.queries.total_queries, 3);
        assert_eq!(metrics.queries.slow_queries, 2);
        assert_eq!(metrics.queries.failed_queries, 1);
    }

    #[test]
    fn test_report_generation() {
        let monitor = PerformanceMonitor::new(MonitorConfig::default());

        monitor.record_latency(10);
        monitor.record_latency(20);

        let report = monitor.generate_report();
        assert!(report.contains("PERFORMANCE REPORT"));
        assert!(report.contains("LATENCY"));
        assert!(report.contains("MEMORY"));
    }
}
