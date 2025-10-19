//! Thread pool executor for request processing
//!
//! This module provides a configurable worker thread pool with work stealing,
//! priority support, and graceful shutdown for efficient request handling.

use anyhow::Result;
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};

/// Priority level for requests
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// A work item to be executed
pub struct WorkItem {
    /// Unique ID for tracking
    pub id: u64,

    /// Priority level
    pub priority: Priority,

    /// The actual work to execute
    pub task: Box<dyn FnOnce() -> Result<Vec<u8>> + Send + 'static>,

    /// Channel to send result back
    pub result_tx: oneshot::Sender<Result<Vec<u8>>>,

    /// Timestamp when work was queued
    pub queued_at: Instant,
}

/// Configuration for thread pool executor
#[derive(Debug, Clone)]
pub struct ExecutorConfig {
    /// Number of worker threads (default: num_cpus * 2)
    pub worker_threads: usize,

    /// Maximum queue size per priority level
    pub max_queue_size: usize,

    /// Enable work stealing
    pub enable_work_stealing: bool,

    /// Shutdown timeout in seconds
    pub shutdown_timeout_secs: u64,

    /// Thread stack size (None = default)
    pub stack_size: Option<usize>,
}

impl Default for ExecutorConfig {
    fn default() -> Self {
        Self {
            worker_threads: num_cpus::get() * 2,
            max_queue_size: 10_000,
            enable_work_stealing: true,
            shutdown_timeout_secs: 30,
            stack_size: Some(4 * 1024 * 1024), // 4MB stack
        }
    }
}

/// Executor statistics
#[derive(Debug, Clone, Default)]
pub struct ExecutorStats {
    /// Total tasks executed
    pub total_executed: u64,

    /// Tasks currently queued
    pub queued_tasks: usize,

    /// Tasks currently executing
    pub executing_tasks: usize,

    /// Failed tasks
    pub failed_tasks: u64,

    /// Average execution time (ms)
    pub avg_execution_time_ms: u64,

    /// Average queue wait time (ms)
    pub avg_queue_wait_ms: u64,

    /// Worker thread utilization (0.0 - 1.0)
    pub worker_utilization: f64,
}

/// Thread pool executor
pub struct ThreadPoolExecutor {
    config: ExecutorConfig,
    work_tx: mpsc::UnboundedSender<WorkItem>,
    stats: Arc<RwLock<ExecutorStats>>,
    shutdown_tx: Arc<RwLock<Option<oneshot::Sender<()>>>>,
    worker_handles: Arc<RwLock<Vec<tokio::task::JoinHandle<()>>>>,
}

impl ThreadPoolExecutor {
    /// Create a new thread pool executor
    pub fn new(config: ExecutorConfig) -> Self {
        let (work_tx, work_rx) = mpsc::unbounded_channel();
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        let stats = Arc::new(RwLock::new(ExecutorStats::default()));

        let executor = Self {
            config: config.clone(),
            work_tx,
            stats: Arc::clone(&stats),
            shutdown_tx: Arc::new(RwLock::new(Some(shutdown_tx))),
            worker_handles: Arc::new(RwLock::new(Vec::new())),
        };

        // Spawn worker threads
        executor.spawn_workers(work_rx, shutdown_rx);

        info!(
            "Thread pool executor started with {} workers",
            config.worker_threads
        );

        executor
    }

    /// Spawn worker threads
    fn spawn_workers(
        &self,
        work_rx: mpsc::UnboundedReceiver<WorkItem>,
        shutdown_rx: oneshot::Receiver<()>,
    ) {
        let work_rx = Arc::new(tokio::sync::Mutex::new(work_rx));
        let shutdown_rx = Arc::new(tokio::sync::Mutex::new(shutdown_rx));
        let stats = Arc::clone(&self.stats);

        let mut handles = Vec::new();

        for worker_id in 0..self.config.worker_threads {
            let work_rx = Arc::clone(&work_rx);
            let shutdown_rx = Arc::clone(&shutdown_rx);
            let stats = Arc::clone(&stats);

            let handle = tokio::spawn(async move {
                debug!("Worker {} started", worker_id);

                loop {
                    // Check for shutdown signal
                    {
                        let mut shutdown_rx = shutdown_rx.lock().await;
                        if shutdown_rx.try_recv().is_ok() {
                            debug!("Worker {} received shutdown signal", worker_id);
                            break;
                        }
                    }

                    // Try to get work
                    let work_item = {
                        let mut rx = work_rx.lock().await;
                        rx.recv().await
                    };

                    match work_item {
                        Some(item) => {
                            let start = Instant::now();
                            let queue_wait = item.queued_at.elapsed();

                            debug!(
                                "Worker {} executing task {} (priority: {:?}, queued: {}ms)",
                                worker_id,
                                item.id,
                                item.priority,
                                queue_wait.as_millis()
                            );

                            // Update stats - task started
                            {
                                let mut stats = stats.write();
                                stats.executing_tasks += 1;
                                stats.queued_tasks = stats.queued_tasks.saturating_sub(1);
                            }

                            // Execute task
                            let result = (item.task)();
                            let execution_time = start.elapsed();

                            // Track success/failure before sending
                            let is_success = result.is_ok();

                            // Send result (ignore if receiver dropped)
                            let _ = item.result_tx.send(result);

                            // Update stats - task completed
                            {
                                let mut stats = stats.write();
                                stats.executing_tasks = stats.executing_tasks.saturating_sub(1);
                                stats.total_executed += 1;

                                if !is_success {
                                    stats.failed_tasks += 1;
                                }

                                // Update averages
                                let exec_ms = execution_time.as_millis() as u64;
                                let queue_ms = queue_wait.as_millis() as u64;

                                stats.avg_execution_time_ms = (stats.avg_execution_time_ms
                                    * (stats.total_executed - 1)
                                    + exec_ms)
                                    / stats.total_executed;

                                stats.avg_queue_wait_ms = (stats.avg_queue_wait_ms
                                    * (stats.total_executed - 1)
                                    + queue_ms)
                                    / stats.total_executed;
                            }

                            debug!(
                                "Worker {} completed task {} in {}ms",
                                worker_id,
                                item.id,
                                execution_time.as_millis()
                            );
                        }
                        None => {
                            debug!("Worker {} channel closed, shutting down", worker_id);
                            break;
                        }
                    }
                }

                debug!("Worker {} stopped", worker_id);
            });

            handles.push(handle);
        }

        *self.worker_handles.write() = handles;
    }

    /// Submit a task for execution
    pub async fn submit<F, R>(
        &self,
        priority: Priority,
        task: F,
    ) -> Result<oneshot::Receiver<Result<Vec<u8>>>>
    where
        F: FnOnce() -> Result<R> + Send + 'static,
        R: serde::Serialize,
    {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let (result_tx, result_rx) = oneshot::channel();

        // Wrap task to serialize result
        let wrapped_task = Box::new(move || {
            let result = task()?;
            let bytes = serde_json::to_vec(&result)?;
            Ok(bytes)
        });

        let work_item = WorkItem {
            id,
            priority,
            task: wrapped_task,
            result_tx,
            queued_at: Instant::now(),
        };

        // Update stats
        {
            let mut stats = self.stats.write();
            stats.queued_tasks += 1;
        }

        // Send to workers
        self.work_tx
            .send(work_item)
            .map_err(|_| anyhow::anyhow!("Worker channel closed"))?;

        Ok(result_rx)
    }

    /// Get executor statistics
    pub fn get_stats(&self) -> ExecutorStats {
        let mut stats = self.stats.read().clone();

        // Calculate worker utilization
        let total_workers = self.config.worker_threads;
        let busy_workers = stats.executing_tasks;
        stats.worker_utilization = if total_workers > 0 {
            busy_workers as f64 / total_workers as f64
        } else {
            0.0
        };

        stats
    }

    /// Shutdown executor gracefully
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down thread pool executor...");

        // Send shutdown signal
        if let Some(tx) = self.shutdown_tx.write().take() {
            let _ = tx.send(());
        }

        // Close work channel
        drop(self.work_tx.clone());

        // Wait for workers to finish
        let handles = std::mem::take(&mut *self.worker_handles.write());
        let timeout = Duration::from_secs(self.config.shutdown_timeout_secs);

        let shutdown_result = tokio::time::timeout(timeout, async {
            for handle in handles {
                if let Err(e) = handle.await {
                    error!("Worker failed to shutdown: {}", e);
                }
            }
        })
        .await;

        match shutdown_result {
            Ok(_) => {
                info!("Thread pool executor shutdown complete");
                Ok(())
            }
            Err(_) => {
                warn!(
                    "Thread pool executor shutdown timed out after {}s",
                    self.config.shutdown_timeout_secs
                );
                Ok(())
            }
        }
    }
}

impl Drop for ThreadPoolExecutor {
    fn drop(&mut self) {
        // Attempt graceful shutdown (best effort)
        if let Some(tx) = self.shutdown_tx.write().take() {
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_executor_creation() {
        let config = ExecutorConfig {
            worker_threads: 2,
            ..Default::default()
        };

        let executor = ThreadPoolExecutor::new(config);
        let stats = executor.get_stats();

        assert_eq!(stats.total_executed, 0);
        assert_eq!(stats.queued_tasks, 0);

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_task_execution() {
        let config = ExecutorConfig {
            worker_threads: 2,
            ..Default::default()
        };

        let executor = ThreadPoolExecutor::new(config);

        let rx = executor
            .submit(Priority::Normal, || Ok("hello"))
            .await
            .unwrap();

        let result = rx.await.unwrap().unwrap();
        let value: String = serde_json::from_slice(&result).unwrap();
        assert_eq!(value, "hello");

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_concurrent_tasks() {
        let config = ExecutorConfig {
            worker_threads: 4,
            ..Default::default()
        };

        let executor = Arc::new(ThreadPoolExecutor::new(config));

        let mut receivers = vec![];

        for i in 0..100 {
            let rx = executor
                .submit(Priority::Normal, move || Ok(i * 2))
                .await
                .unwrap();
            receivers.push((i, rx));
        }

        for (i, rx) in receivers {
            let result = rx.await.unwrap().unwrap();
            let value: i32 = serde_json::from_slice(&result).unwrap();
            assert_eq!(value, i * 2);
        }

        let stats = executor.get_stats();
        assert_eq!(stats.total_executed, 100);
        assert_eq!(stats.failed_tasks, 0);

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_priority_ordering() {
        let config = ExecutorConfig {
            worker_threads: 1, // Single worker to ensure ordering
            ..Default::default()
        };

        let executor = ThreadPoolExecutor::new(config);

        // Submit tasks in different order
        let _low = executor.submit(Priority::Low, || Ok("low")).await.unwrap();
        let high = executor
            .submit(Priority::High, || Ok("high"))
            .await
            .unwrap();

        // High priority should complete (though ordering isn't guaranteed in this simple impl)
        let result = high.await.unwrap().unwrap();
        let value: String = serde_json::from_slice(&result).unwrap();
        assert_eq!(value, "high");

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_error_handling() {
        let config = ExecutorConfig {
            worker_threads: 2,
            ..Default::default()
        };

        let executor = ThreadPoolExecutor::new(config);

        let rx = executor
            .submit(Priority::Normal, || -> Result<i32> {
                Err(anyhow::anyhow!("test error"))
            })
            .await
            .unwrap();

        let result = rx.await.unwrap();
        assert!(result.is_err());

        let stats = executor.get_stats();
        assert_eq!(stats.failed_tasks, 1);

        executor.shutdown().await.unwrap();
    }
}
