//! Enhanced RPC server with multi-threaded request handling
//!
//! This module provides a high-performance RPC server with:
//! - Thread pool executor for concurrent request processing
//! - Connection pool manager for database connections
//! - Request dispatcher with load balancing
//! - Performance monitoring and metrics
//! - Circuit breaker for overload protection

use super::codec;
use super::router::RpcRouter;
use super::tool_registry::ToolRegistry;
use super::connection_pool::{ConnectionPoolManager, ConnectionPoolConfig};
use super::executor::{ThreadPoolExecutor, ExecutorConfig};
use super::dispatcher::{RequestDispatcher, DispatcherConfig};
use super::monitor::{PerformanceMonitor, MonitorConfig};
use super::hot_reload::{HotReloadable, ServerState, ConnectionState, MetricsSnapshot, ConfigSnapshot};
use anyhow::{Context, Result};
use parking_lot::RwLock;
use std::sync::Arc;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::net::{UnixListener, UnixStream, TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Configuration for enhanced RPC server
#[derive(Debug, Clone)]
pub struct EnhancedServerConfig {
    /// Connection pool configuration
    pub pool_config: ConnectionPoolConfig,

    /// Executor configuration
    pub executor_config: ExecutorConfig,

    /// Dispatcher configuration
    pub dispatcher_config: DispatcherConfig,

    /// Monitor configuration
    pub monitor_config: MonitorConfig,

    /// Enable TCP listener (in addition to Unix socket)
    pub enable_tcp: bool,

    /// TCP bind address (if enabled)
    pub tcp_addr: String,

    /// Enable TCP_NODELAY for low latency
    pub tcp_nodelay: bool,

    /// Enable connection keep-alive
    pub tcp_keepalive: bool,

    /// Maximum frame size (bytes)
    pub max_frame_size: usize,
}

impl Default for EnhancedServerConfig {
    fn default() -> Self {
        Self {
            pool_config: ConnectionPoolConfig::default(),
            executor_config: ExecutorConfig::default(),
            dispatcher_config: DispatcherConfig::default(),
            monitor_config: MonitorConfig::default(),
            enable_tcp: false,
            tcp_addr: "127.0.0.1:9090".to_string(),
            tcp_nodelay: true,
            tcp_keepalive: true,
            max_frame_size: 100 * 1024 * 1024, // 100MB
        }
    }
}

/// Enhanced RPC server with multi-threaded processing
pub struct EnhancedRpcServer {
    config: EnhancedServerConfig,
    unix_listener: Option<UnixListener>,
    tcp_listener: Option<TcpListener>,
    router: Arc<RpcRouter>,
    pool: Arc<ConnectionPoolManager>,
    executor: Arc<ThreadPoolExecutor>,
    dispatcher: Arc<RequestDispatcher>,
    monitor: Arc<PerformanceMonitor>,
    metrics: Arc<ServerMetrics>,
    /// Active connections tracking
    active_connections: Arc<RwLock<std::collections::HashMap<Uuid, ActiveConnection>>>,
    /// Accept new connections flag
    accepting: Arc<AtomicBool>,
    /// Server start time
    start_time: std::time::Instant,
}

/// Server metrics
#[derive(Default)]
pub struct ServerMetrics {
    total_requests: std::sync::atomic::AtomicU64,
    failed_requests: std::sync::atomic::AtomicU64,
    active_connections: std::sync::atomic::AtomicU64,
}

/// Active connection tracking
#[derive(Debug, Clone)]
struct ActiveConnection {
    id: Uuid,
    remote_addr: Option<String>,
    established_at: chrono::DateTime<chrono::Utc>,
    requests_processed: u64,
    last_activity: chrono::DateTime<chrono::Utc>,
    pending_requests: Vec<u64>,
}

impl ServerMetrics {
    pub fn get_stats(&self) -> ServerStats {
        ServerStats {
            total_requests: self.total_requests.load(std::sync::atomic::Ordering::Relaxed),
            failed_requests: self.failed_requests.load(std::sync::atomic::Ordering::Relaxed),
            active_connections: self.active_connections.load(std::sync::atomic::Ordering::Relaxed),
        }
    }
}

/// Server statistics
#[derive(Debug, Clone)]
pub struct ServerStats {
    pub total_requests: u64,
    pub failed_requests: u64,
    pub active_connections: u64,
}

impl EnhancedRpcServer {
    /// Create and bind enhanced RPC server
    pub async fn bind(
        socket_path: impl AsRef<Path>,
        config: EnhancedServerConfig,
        registry: Arc<ToolRegistry>,
        storage: Arc<dyn crate::storage::Storage>,
        mcp_handlers: Arc<crate::mcp::handlers::ToolHandlers>,
    ) -> Result<Self> {
        let socket_path = socket_path.as_ref();

        // Remove existing socket if it exists
        if socket_path.exists() {
            std::fs::remove_file(socket_path)
                .with_context(|| format!("Failed to remove existing socket at {:?}", socket_path))?;
        }

        // Bind to Unix socket
        let unix_listener = UnixListener::bind(socket_path)
            .with_context(|| format!("Failed to bind to {:?}", socket_path))?;

        info!("Enhanced RPC server listening on {:?}", socket_path);

        // Optionally bind TCP listener
        let tcp_listener = if config.enable_tcp {
            let listener = TcpListener::bind(&config.tcp_addr).await
                .with_context(|| format!("Failed to bind TCP to {}", config.tcp_addr))?;

            info!("Enhanced RPC server also listening on TCP {}", config.tcp_addr);
            Some(listener)
        } else {
            None
        };

        // Create connection pool
        let pool = Arc::new(ConnectionPoolManager::new(
            Arc::clone(&storage),
            config.pool_config.clone(),
        )?);

        // Spawn health check task
        Arc::clone(&pool).spawn_health_check_task();

        // Create thread pool executor
        let executor = Arc::new(ThreadPoolExecutor::new(config.executor_config.clone()));

        // Create request dispatcher
        let dispatcher = Arc::new(RequestDispatcher::new(
            Arc::clone(&executor),
            config.dispatcher_config.clone(),
        ));

        // Create performance monitor
        let monitor = Arc::new(PerformanceMonitor::new(config.monitor_config.clone()));

        // Spawn auto-report task
        Arc::clone(&monitor).spawn_auto_report_task();

        // Create router
        let router = Arc::new(RpcRouter::new(registry,
            Arc::new(crate::rpc::DatabasePool::from_storage(storage)),
            mcp_handlers));

        Ok(Self {
            config,
            unix_listener: Some(unix_listener),
            tcp_listener,
            router,
            pool,
            executor,
            dispatcher,
            monitor,
            metrics: Arc::new(ServerMetrics::default()),
            active_connections: Arc::new(RwLock::new(std::collections::HashMap::new())),
            accepting: Arc::new(AtomicBool::new(true)),
            start_time: std::time::Instant::now(),
        })
    }

    /// Get server statistics
    pub fn get_stats(&self) -> ServerStats {
        self.metrics.get_stats()
    }

    /// Get connection pool statistics
    pub fn get_pool_stats(&self) -> super::connection_pool::PoolStatistics {
        self.pool.get_stats()
    }

    /// Get executor statistics
    pub fn get_executor_stats(&self) -> super::executor::ExecutorStats {
        self.executor.get_stats()
    }

    /// Get dispatcher statistics
    pub fn get_dispatcher_stats(&self) -> super::dispatcher::DispatcherStats {
        self.dispatcher.get_stats()
    }

    /// Get performance metrics
    pub fn get_performance_metrics(&self) -> super::monitor::PerformanceMetrics {
        self.monitor.collect_metrics()
    }

    /// Print comprehensive performance report
    pub fn print_performance_report(&self) {
        info!("\n{}", self.generate_performance_report());
    }

    /// Generate comprehensive performance report
    pub fn generate_performance_report(&self) -> String {
        let server_stats = self.get_stats();
        let pool_stats = self.get_pool_stats();
        let executor_stats = self.get_executor_stats();
        let dispatcher_stats = self.get_dispatcher_stats();
        let perf_metrics = self.get_performance_metrics();

        format!(
            r#"
═══════════════════════════════════════════════════════════
           ENHANCED RPC SERVER REPORT
═══════════════════════════════════════════════════════════

SERVER
  Total requests:      {}
  Failed requests:     {}
  Active connections:  {}
  Success rate:        {:.2}%

CONNECTION POOL
  Total connections:   {}
  Active:              {}
  Idle:                {}
  Created:             {}
  Recycled:            {}
  Avg wait time:       {}ms

THREAD POOL EXECUTOR
  Worker threads:      {}
  Queued tasks:        {}
  Executing tasks:     {}
  Total executed:      {}
  Failed tasks:        {}
  Avg exec time:       {}ms
  Worker utilization:  {:.2}%

REQUEST DISPATCHER
  Total dispatched:    {}
  Circuit breaker:     {}
  CB rejects:          {}

PERFORMANCE METRICS
  Requests/sec:        {:.2}
  Errors/sec:          {:.2}

  Latency (ms)
    Min:               {}
    Avg:               {}
    P50:               {}
    P95:               {}
    P99:               {}
    Max:               {}

  Memory
    RSS (MB):          {:.2}
    Usage:             {:.2}%

═══════════════════════════════════════════════════════════
"#,
            server_stats.total_requests,
            server_stats.failed_requests,
            server_stats.active_connections,
            if server_stats.total_requests > 0 {
                ((server_stats.total_requests - server_stats.failed_requests) as f64
                    / server_stats.total_requests as f64)
                    * 100.0
            } else {
                0.0
            },
            pool_stats.total_connections,
            pool_stats.active_connections,
            pool_stats.idle_connections,
            pool_stats.total_created,
            pool_stats.total_recycled,
            pool_stats.avg_wait_time_ms,
            self.config.executor_config.worker_threads,
            executor_stats.queued_tasks,
            executor_stats.executing_tasks,
            executor_stats.total_executed,
            executor_stats.failed_tasks,
            executor_stats.avg_execution_time_ms,
            executor_stats.worker_utilization * 100.0,
            dispatcher_stats.total_dispatched,
            dispatcher_stats.circuit_state,
            dispatcher_stats.circuit_breaker_rejects,
            perf_metrics.requests_per_sec,
            perf_metrics.errors_per_sec,
            perf_metrics.latency.min,
            perf_metrics.latency.avg,
            perf_metrics.latency.p50,
            perf_metrics.latency.p95,
            perf_metrics.latency.p99,
            perf_metrics.latency.max,
            perf_metrics.memory.rss_mb,
            perf_metrics.memory.usage_pct,
        )
    }

    /// Serve incoming connections
    pub async fn serve(&mut self) -> Result<()> {
        let metrics = Arc::clone(&self.metrics);

        // Spawn Unix socket listener
        if let Some(unix_listener) = self.unix_listener.take() {
            let router = Arc::clone(&self.router);
            let dispatcher = Arc::clone(&self.dispatcher);
            let monitor = Arc::clone(&self.monitor);
            let metrics = Arc::clone(&metrics);
            let max_frame_size = self.config.max_frame_size;

            tokio::spawn(async move {
                Self::serve_unix(unix_listener, router, dispatcher, monitor, metrics, max_frame_size).await;
            });
        }

        // Spawn TCP listener if enabled
        if let Some(tcp_listener) = self.tcp_listener.take() {
            let router = Arc::clone(&self.router);
            let dispatcher = Arc::clone(&self.dispatcher);
            let monitor = Arc::clone(&self.monitor);
            let metrics = Arc::clone(&metrics);
            let max_frame_size = self.config.max_frame_size;
            let tcp_nodelay = self.config.tcp_nodelay;
            let tcp_keepalive = self.config.tcp_keepalive;

            tokio::spawn(async move {
                Self::serve_tcp(tcp_listener, router, dispatcher, monitor, metrics, max_frame_size, tcp_nodelay, tcp_keepalive).await;
            });
        }

        // Keep server alive
        tokio::signal::ctrl_c().await?;
        info!("Shutting down enhanced RPC server...");

        Ok(())
    }

    /// Serve Unix socket connections
    async fn serve_unix(
        listener: UnixListener,
        router: Arc<RpcRouter>,
        dispatcher: Arc<RequestDispatcher>,
        monitor: Arc<PerformanceMonitor>,
        metrics: Arc<ServerMetrics>,
        max_frame_size: usize,
    ) {
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let router = Arc::clone(&router);
                    let dispatcher = Arc::clone(&dispatcher);
                    let monitor = Arc::clone(&monitor);
                    let metrics = Arc::clone(&metrics);

                    metrics.active_connections.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_unix_connection(stream, router, dispatcher, monitor, metrics.clone(), max_frame_size).await {
                            error!("Unix connection error: {}", e);
                        }

                        metrics.active_connections.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    });
                }
                Err(e) => {
                    error!("Unix accept error: {}", e);
                }
            }
        }
    }

    /// Serve TCP connections
    async fn serve_tcp(
        listener: TcpListener,
        router: Arc<RpcRouter>,
        dispatcher: Arc<RequestDispatcher>,
        monitor: Arc<PerformanceMonitor>,
        metrics: Arc<ServerMetrics>,
        max_frame_size: usize,
        tcp_nodelay: bool,
        tcp_keepalive: bool,
    ) {
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    // Configure TCP socket
                    if tcp_nodelay {
                        let _ = stream.set_nodelay(true);
                    }

                    debug!("TCP connection from {}", addr);

                    let router = Arc::clone(&router);
                    let dispatcher = Arc::clone(&dispatcher);
                    let monitor = Arc::clone(&monitor);
                    let metrics = Arc::clone(&metrics);

                    metrics.active_connections.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_tcp_connection(stream, router, dispatcher, monitor, metrics.clone(), max_frame_size).await {
                            error!("TCP connection error: {}", e);
                        }

                        metrics.active_connections.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    });
                }
                Err(e) => {
                    error!("TCP accept error: {}", e);
                }
            }
        }
    }

    /// Handle a Unix socket connection
    async fn handle_unix_connection(
        mut stream: UnixStream,
        router: Arc<RpcRouter>,
        dispatcher: Arc<RequestDispatcher>,
        monitor: Arc<PerformanceMonitor>,
        metrics: Arc<ServerMetrics>,
        max_frame_size: usize,
    ) -> Result<()> {
        debug!("New Unix client connected");

        loop {
            let start = std::time::Instant::now();

            // Read frame header
            let mut header = [0u8; codec::FRAME_HEADER_SIZE];
            match stream.read_exact(&mut header).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    debug!("Client disconnected");
                    break;
                }
                Err(e) => {
                    return Err(e).context("Failed to read request header");
                }
            }

            // Parse length
            let length = u32::from_le_bytes(header) as usize;

            // Validate frame size
            if length > max_frame_size {
                error!("Frame too large: {} bytes", length);
                return Err(anyhow::anyhow!("Frame too large: {} bytes", length));
            }

            // Read payload
            let mut payload = vec![0u8; length];
            stream.read_exact(&mut payload).await
                .context("Failed to read request payload")?;

            // Decode request
            let mut frame = Vec::with_capacity(codec::FRAME_HEADER_SIZE + length);
            frame.extend_from_slice(&header);
            frame.extend_from_slice(&payload);

            let request = match codec::decode_request(&frame) {
                Ok(req) => req,
                Err(e) => {
                    error!("Failed to decode request: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    monitor.record_error();
                    continue;
                }
            };

            debug!("Received request: id={} tool={}", request.id, request.tool);

            // Update metrics
            metrics.total_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            // Dispatch request through multi-threaded dispatcher
            let response = dispatcher.dispatch(request).await;

            // Record latency
            let latency_ms = start.elapsed().as_millis() as u64;
            monitor.record_latency(latency_ms);

            // Update failure metrics if needed
            if response.error.is_some() {
                metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                monitor.record_error();
            }

            // Encode response
            let response_bytes = match codec::encode_response(&response) {
                Ok(bytes) => bytes,
                Err(e) => {
                    error!("Failed to encode response: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    monitor.record_error();
                    continue;
                }
            };

            // Send response
            if let Err(e) = stream.write_all(&response_bytes).await {
                error!("Failed to send response: {}", e);
                return Err(e).context("Failed to send response");
            }

            debug!("Sent response: id={} ({}ms)", response.id, latency_ms);
        }

        Ok(())
    }

    /// Handle a TCP connection
    async fn handle_tcp_connection(
        mut stream: TcpStream,
        router: Arc<RpcRouter>,
        dispatcher: Arc<RequestDispatcher>,
        monitor: Arc<PerformanceMonitor>,
        metrics: Arc<ServerMetrics>,
        max_frame_size: usize,
    ) -> Result<()> {
        debug!("New TCP client connected");

        loop {
            let start = std::time::Instant::now();

            // Read frame header
            let mut header = [0u8; codec::FRAME_HEADER_SIZE];
            match stream.read_exact(&mut header).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    debug!("TCP client disconnected");
                    break;
                }
                Err(e) => {
                    return Err(e).context("Failed to read request header");
                }
            }

            // Parse length
            let length = u32::from_le_bytes(header) as usize;

            // Validate frame size
            if length > max_frame_size {
                error!("Frame too large: {} bytes", length);
                return Err(anyhow::anyhow!("Frame too large: {} bytes", length));
            }

            // Read payload
            let mut payload = vec![0u8; length];
            stream.read_exact(&mut payload).await
                .context("Failed to read request payload")?;

            // Decode request
            let mut frame = Vec::with_capacity(codec::FRAME_HEADER_SIZE + length);
            frame.extend_from_slice(&header);
            frame.extend_from_slice(&payload);

            let request = match codec::decode_request(&frame) {
                Ok(req) => req,
                Err(e) => {
                    error!("Failed to decode request: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    monitor.record_error();
                    continue;
                }
            };

            debug!("Received TCP request: id={} tool={}", request.id, request.tool);

            // Update metrics
            metrics.total_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            // Dispatch request
            let response = dispatcher.dispatch(request).await;

            // Record latency
            let latency_ms = start.elapsed().as_millis() as u64;
            monitor.record_latency(latency_ms);

            // Update failure metrics if needed
            if response.error.is_some() {
                metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                monitor.record_error();
            }

            // Encode response
            let response_bytes = match codec::encode_response(&response) {
                Ok(bytes) => bytes,
                Err(e) => {
                    error!("Failed to encode response: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    monitor.record_error();
                    continue;
                }
            };

            // Send response
            if let Err(e) = stream.write_all(&response_bytes).await {
                error!("Failed to send response: {}", e);
                return Err(e).context("Failed to send response");
            }

            debug!("Sent TCP response: id={} ({}ms)", response.id, latency_ms);
        }

        Ok(())
    }

    /// Shutdown server gracefully
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down enhanced RPC server...");

        // Shutdown executor
        self.executor.shutdown().await?;

        // Print final report
        self.print_performance_report();

        info!("Enhanced RPC server shutdown complete");
        Ok(())
    }
}

/// Implement HotReloadable trait for EnhancedRpcServer
impl HotReloadable for EnhancedRpcServer {
    fn export_state(&self) -> Result<ServerState> {
        info!("Exporting server state for hot reload");

        let connections = self.active_connections.read();
        let connection_states: Vec<ConnectionState> = connections
            .values()
            .map(|conn| ConnectionState {
                id: conn.id,
                remote_addr: conn.remote_addr.clone(),
                established_at: conn.established_at,
                requests_processed: conn.requests_processed,
                last_activity: conn.last_activity,
                pending_requests: conn.pending_requests.clone(),
            })
            .collect();

        let metrics = self.get_stats();
        let perf_metrics = self.get_performance_metrics();

        let state = ServerState {
            timestamp: chrono::Utc::now(),
            pid: std::process::id(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            connections: connection_states,
            streams: std::collections::HashMap::new(), // TODO: Implement stream tracking
            metrics: MetricsSnapshot {
                total_requests: metrics.total_requests,
                failed_requests: metrics.failed_requests,
                active_connections: metrics.active_connections,
                uptime_secs: self.start_time.elapsed().as_secs(),
                avg_latency_ms: perf_metrics.latency.avg as f64,
                p99_latency_ms: perf_metrics.latency.p99,
            },
            config: ConfigSnapshot {
                socket_path: None, // Will be filled by caller
                tcp_addr: if self.config.enable_tcp {
                    Some(self.config.tcp_addr.clone())
                } else {
                    None
                },
                tcp_enabled: self.config.enable_tcp,
                max_frame_size: self.config.max_frame_size,
            },
        };

        info!(
            "State exported: {} connections, {} streams",
            state.connections.len(),
            state.streams.len()
        );

        Ok(state)
    }

    fn import_state(&mut self, state: ServerState) -> Result<()> {
        info!(
            "Importing server state from PID {} (version {})",
            state.pid, state.version
        );

        // Import connections
        let mut connections = self.active_connections.write();
        for conn_state in state.connections {
            let conn = ActiveConnection {
                id: conn_state.id,
                remote_addr: conn_state.remote_addr,
                established_at: conn_state.established_at,
                requests_processed: conn_state.requests_processed,
                last_activity: conn_state.last_activity,
                pending_requests: conn_state.pending_requests,
            };
            connections.insert(conn.id, conn);
        }

        // Update metrics
        self.metrics.total_requests.store(
            state.metrics.total_requests,
            Ordering::Relaxed,
        );
        self.metrics.failed_requests.store(
            state.metrics.failed_requests,
            Ordering::Relaxed,
        );
        self.metrics.active_connections.store(
            state.metrics.active_connections,
            Ordering::Relaxed,
        );

        info!(
            "State imported: {} connections restored",
            connections.len()
        );

        Ok(())
    }

    fn is_ready(&self) -> bool {
        // Server is ready if executor is running and not shutting down
        self.accepting.load(Ordering::Relaxed)
    }

    fn stop_accepting(&self) -> Result<()> {
        info!("Stopping acceptance of new connections");
        self.accepting.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn drain_connections(&self, timeout: Duration) -> Result<()> {
        info!("Draining connections with timeout: {:?}", timeout);

        let start = std::time::Instant::now();

        loop {
            let active = self.metrics.active_connections.load(Ordering::Relaxed);

            if active == 0 {
                info!("All connections drained");
                return Ok(());
            }

            if start.elapsed() > timeout {
                warn!(
                    "Drain timeout reached with {} active connections remaining",
                    active
                );
                return Ok(());
            }

            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // TODO: Add integration tests
}
