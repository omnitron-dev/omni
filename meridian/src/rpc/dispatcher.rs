//! Request dispatcher with load balancing and circuit breaker
//!
//! This module routes requests to available worker threads using configurable
//! load balancing strategies with overload protection.

use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, warn, error};

use super::executor::{Priority, ThreadPoolExecutor};
use super::protocol::{RpcRequest, RpcResponse, RpcError, ErrorCode};

/// Load balancing strategy
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadBalancingStrategy {
    /// Round-robin distribution
    RoundRobin,

    /// Route to least loaded worker
    LeastLoaded,

    /// Random distribution
    Random,
}

/// Circuit breaker state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    /// Normal operation
    Closed,

    /// Overload detected, rejecting requests
    Open,

    /// Testing if system recovered
    HalfOpen,
}

/// Configuration for request dispatcher
#[derive(Debug, Clone)]
pub struct DispatcherConfig {
    /// Load balancing strategy
    pub strategy: LoadBalancingStrategy,

    /// Enable circuit breaker
    pub enable_circuit_breaker: bool,

    /// Circuit breaker failure threshold
    pub circuit_failure_threshold: u64,

    /// Circuit breaker timeout (seconds)
    pub circuit_timeout_secs: u64,

    /// Maximum concurrent requests per worker
    pub max_concurrent_per_worker: usize,

    /// Enable request batching
    pub enable_batching: bool,

    /// Batch size
    pub batch_size: usize,

    /// Batch timeout (ms)
    pub batch_timeout_ms: u64,
}

impl Default for DispatcherConfig {
    fn default() -> Self {
        Self {
            strategy: LoadBalancingStrategy::LeastLoaded,
            enable_circuit_breaker: true,
            circuit_failure_threshold: 10,
            circuit_timeout_secs: 30,
            max_concurrent_per_worker: 100,
            enable_batching: false,
            batch_size: 10,
            batch_timeout_ms: 100,
        }
    }
}

/// Dispatcher statistics
#[derive(Debug, Clone)]
pub struct DispatcherStats {
    /// Total requests dispatched
    pub total_dispatched: u64,

    /// Requests rejected by circuit breaker
    pub circuit_breaker_rejects: u64,

    /// Current circuit breaker state
    pub circuit_state: String,

    /// Total batches created
    pub total_batches: u64,

    /// Average batch size
    pub avg_batch_size: f64,

    /// Request distribution by strategy
    pub strategy_hits: u64,
}

impl Default for DispatcherStats {
    fn default() -> Self {
        Self {
            total_dispatched: 0,
            circuit_breaker_rejects: 0,
            circuit_state: "Closed".to_string(),
            total_batches: 0,
            avg_batch_size: 0.0,
            strategy_hits: 0,
        }
    }
}

/// Request dispatcher
pub struct RequestDispatcher {
    executor: Arc<ThreadPoolExecutor>,
    config: DispatcherConfig,
    stats: Arc<RwLock<DispatcherStats>>,
    circuit_state: Arc<RwLock<CircuitState>>,
    circuit_failures: Arc<RwLock<u64>>,
    circuit_last_failure: Arc<RwLock<Option<Instant>>>,
    round_robin_counter: Arc<RwLock<usize>>,
}

impl RequestDispatcher {
    /// Create a new request dispatcher
    pub fn new(executor: Arc<ThreadPoolExecutor>, config: DispatcherConfig) -> Self {
        Self {
            executor,
            config,
            stats: Arc::new(RwLock::new(DispatcherStats::default())),
            circuit_state: Arc::new(RwLock::new(CircuitState::Closed)),
            circuit_failures: Arc::new(RwLock::new(0)),
            circuit_last_failure: Arc::new(RwLock::new(None)),
            round_robin_counter: Arc::new(RwLock::new(0)),
        }
    }

    /// Dispatch a request for processing
    pub async fn dispatch(&self, request: RpcRequest) -> RpcResponse {
        // Check circuit breaker
        if self.config.enable_circuit_breaker && !self.check_circuit_breaker() {
            warn!("Circuit breaker open, rejecting request {}", request.id);

            let mut stats = self.stats.write();
            stats.circuit_breaker_rejects += 1;

            return RpcResponse::error(
                request.id,
                RpcError {
                    code: ErrorCode::ServiceUnavailable,
                    message: "Service overloaded, circuit breaker open".to_string(),
                    data: None,
                    trace: None,
                },
            );
        }

        // Determine priority
        let priority = self.determine_priority(&request);

        // Create task for executor
        let request_clone = request.clone();
        let result_rx = match self.executor.submit(priority, move || {
            // Placeholder: actual request handling would go here
            // For now, return mock response
            Ok(serde_json::json!({
                "status": "success",
                "tool": request_clone.tool,
            }))
        }).await {
            Ok(rx) => rx,
            Err(e) => {
                error!("Failed to submit task: {}", e);
                self.record_failure();

                return RpcResponse::error(
                    request.id,
                    RpcError {
                        code: ErrorCode::InternalError,
                        message: format!("Failed to dispatch request: {}", e),
                        data: None,
                        trace: None,
                    },
                );
            }
        };

        // Update stats
        {
            let mut stats = self.stats.write();
            stats.total_dispatched += 1;
            stats.strategy_hits += 1;
        }

        // Wait for result
        match result_rx.await {
            Ok(Ok(result_bytes)) => {
                // Deserialize result
                match serde_json::from_slice(&result_bytes) {
                    Ok(result) => {
                        self.record_success();
                        RpcResponse::success(request.id, result)
                    }
                    Err(e) => {
                        error!("Failed to deserialize result: {}", e);
                        self.record_failure();

                        RpcResponse::error(
                            request.id,
                            RpcError {
                                code: ErrorCode::InternalError,
                                message: format!("Failed to deserialize result: {}", e),
                                data: None,
                                trace: None,
                            },
                        )
                    }
                }
            }
            Ok(Err(e)) => {
                error!("Task execution failed: {}", e);
                self.record_failure();

                RpcResponse::error(
                    request.id,
                    RpcError {
                        code: ErrorCode::InternalError,
                        message: format!("Task execution failed: {}", e),
                        data: None,
                        trace: None,
                    },
                )
            }
            Err(e) => {
                error!("Failed to receive result: {}", e);
                self.record_failure();

                RpcResponse::error(
                    request.id,
                    RpcError {
                        code: ErrorCode::InternalError,
                        message: format!("Worker communication failed: {}", e),
                        data: None,
                        trace: None,
                    },
                )
            }
        }
    }

    /// Determine request priority based on characteristics
    fn determine_priority(&self, request: &RpcRequest) -> Priority {
        // Interactive tools get higher priority
        let interactive_tools = [
            "code.search_symbols",
            "code.get_definition",
            "specs.get_section",
        ];

        if interactive_tools.iter().any(|t| request.tool.starts_with(t)) {
            Priority::High
        } else if request.tool.contains("batch") || request.tool.contains("index") {
            Priority::Low
        } else {
            Priority::Normal
        }
    }

    /// Check circuit breaker state
    fn check_circuit_breaker(&self) -> bool {
        let state = *self.circuit_state.read();

        match state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                // Check if timeout expired
                if let Some(last_failure) = *self.circuit_last_failure.read() {
                    let timeout = Duration::from_secs(self.config.circuit_timeout_secs);
                    if last_failure.elapsed() > timeout {
                        // Try half-open state
                        *self.circuit_state.write() = CircuitState::HalfOpen;
                        self.stats.write().circuit_state = "HalfOpen".to_string();
                        debug!("Circuit breaker entering half-open state");
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => true,
        }
    }

    /// Record successful request
    fn record_success(&self) {
        let state = *self.circuit_state.read();

        if state == CircuitState::HalfOpen {
            // Reset circuit breaker
            *self.circuit_state.write() = CircuitState::Closed;
            *self.circuit_failures.write() = 0;
            self.stats.write().circuit_state = "Closed".to_string();
            debug!("Circuit breaker closed");
        }
    }

    /// Record failed request
    fn record_failure(&self) {
        let mut failures = self.circuit_failures.write();
        *failures += 1;

        if *failures >= self.config.circuit_failure_threshold {
            *self.circuit_state.write() = CircuitState::Open;
            *self.circuit_last_failure.write() = Some(Instant::now());
            self.stats.write().circuit_state = "Open".to_string();
            warn!(
                "Circuit breaker opened after {} failures",
                failures
            );
        }
    }

    /// Get dispatcher statistics
    pub fn get_stats(&self) -> DispatcherStats {
        self.stats.read().clone()
    }

    /// Reset circuit breaker manually
    pub fn reset_circuit_breaker(&self) {
        *self.circuit_state.write() = CircuitState::Closed;
        *self.circuit_failures.write() = 0;
        *self.circuit_last_failure.write() = None;
        self.stats.write().circuit_state = "Closed".to_string();
        debug!("Circuit breaker manually reset");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::executor::ExecutorConfig;

    #[tokio::test]
    async fn test_dispatcher_creation() {
        let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig::default()));
        let dispatcher = RequestDispatcher::new(executor, DispatcherConfig::default());

        let stats = dispatcher.get_stats();
        assert_eq!(stats.total_dispatched, 0);
        assert_eq!(stats.circuit_state, "Closed");
    }

    #[tokio::test]
    async fn test_dispatch_request() {
        let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig::default()));
        let dispatcher = RequestDispatcher::new(executor.clone(), DispatcherConfig::default());

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
        assert!(response.error.is_none());

        let stats = dispatcher.get_stats();
        assert_eq!(stats.total_dispatched, 1);

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_circuit_breaker() {
        let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig::default()));
        let config = DispatcherConfig {
            circuit_failure_threshold: 3,
            ..Default::default()
        };
        let dispatcher = RequestDispatcher::new(executor.clone(), config);

        // Trigger failures
        for _ in 0..3 {
            dispatcher.record_failure();
        }

        // Circuit should be open
        assert!(!dispatcher.check_circuit_breaker());

        let stats = dispatcher.get_stats();
        assert_eq!(stats.circuit_state, "Open");

        // Reset
        dispatcher.reset_circuit_breaker();
        assert!(dispatcher.check_circuit_breaker());

        executor.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn test_priority_determination() {
        let executor = Arc::new(ThreadPoolExecutor::new(ExecutorConfig::default()));
        let dispatcher = RequestDispatcher::new(executor.clone(), DispatcherConfig::default());

        let interactive_req = RpcRequest {
            version: 1,
            id: 1,
            tool: "code.search_symbols".to_string(),
            params: rmpv::Value::Nil,
            stream: false,
            max_size: None,
            timeout_ms: Some(5000),
            auth: None,
        };

        let batch_req = RpcRequest {
            version: 1,
            id: 2,
            tool: "indexer.batch_index".to_string(),
            params: rmpv::Value::Nil,
            stream: false,
            max_size: None,
            timeout_ms: Some(5000),
            auth: None,
        };

        assert_eq!(dispatcher.determine_priority(&interactive_req), Priority::High);
        assert_eq!(dispatcher.determine_priority(&batch_req), Priority::Low);

        executor.shutdown().await.unwrap();
    }
}
