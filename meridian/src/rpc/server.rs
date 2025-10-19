//! RPC server implementation
//!
//! This module provides the server-side RPC implementation for the Meridian daemon.
//! It integrates the tool registry, router, and database connection pool for efficient
//! request handling.

use super::protocol::{RpcRequest, RpcResponse, RpcError, ErrorCode, CompressionType};
use super::codec;
use super::router::RpcRouter;
use super::tool_registry::ToolRegistry;
use super::db_pool::DatabasePool;
use super::streaming::{StreamManager, should_stream};
use anyhow::{Context, Result};
use tokio::net::{UnixListener, UnixStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use std::path::Path;
use tracing::{debug, error, info, warn};

/// RPC server for handling client connections with integrated routing
pub struct RpcServer {
    listener: UnixListener,
    router: Arc<RpcRouter>,
    metrics: Arc<ServerMetrics>,
    stream_manager: Arc<StreamManager>,
}

/// Server metrics
#[derive(Default)]
pub struct ServerMetrics {
    total_requests: std::sync::atomic::AtomicU64,
    failed_requests: std::sync::atomic::AtomicU64,
    active_connections: std::sync::atomic::AtomicU64,
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

/// Trait for handling RPC requests (kept for backward compatibility)
#[async_trait::async_trait]
pub trait RequestHandler: Send + Sync {
    /// Handle an RPC request and return a response
    async fn handle_request(&self, request: RpcRequest) -> Result<RpcResponse>;
}

impl RpcServer {
    /// Bind to Unix socket with integrated router
    ///
    /// # Example
    ///
    /// ```no_run
    /// use meridian::rpc::{RpcServer, ToolRegistry, DatabasePool, RpcRouter};
    /// use std::sync::Arc;
    ///
    /// #[tokio::main]
    /// async fn main() -> anyhow::Result<()> {
    ///     let registry = Arc::new(ToolRegistry::new());
    ///     let pool = Arc::new(DatabasePool::new(
    ///         "/tmp/rocks",
    ///         "/tmp/db.sqlite",
    ///         Default::default()
    ///     )?);
    ///     // router needs mcp_handlers
    ///     let server = RpcServer::bind_with_router(
    ///         "/tmp/test.sock",
    ///         registry,
    ///         pool
    ///     ).await?;
    ///     server.serve().await?;
    ///     Ok(())
    /// }
    /// ```
    pub async fn bind_with_router(
        socket_path: impl AsRef<Path>,
        registry: Arc<ToolRegistry>,
        db_pool: Arc<DatabasePool>,
        mcp_handlers: Arc<crate::mcp::handlers::ToolHandlers>,
    ) -> Result<Self> {
        let socket_path = socket_path.as_ref();

        // Remove existing socket if it exists
        if socket_path.exists() {
            std::fs::remove_file(socket_path)
                .with_context(|| format!("Failed to remove existing socket at {:?}", socket_path))?;
        }

        // Bind to Unix socket
        let listener = UnixListener::bind(socket_path)
            .with_context(|| format!("Failed to bind to {:?}", socket_path))?;

        info!("RPC server listening on {:?}", socket_path);

        // Create router with all components
        let router = Arc::new(RpcRouter::new(registry, db_pool, mcp_handlers));

        Ok(Self {
            listener,
            router,
            metrics: Arc::new(ServerMetrics::default()),
            stream_manager: Arc::new(StreamManager::new()),
        })
    }


    /// Get server statistics
    pub fn get_stats(&self) -> ServerStats {
        self.metrics.get_stats()
    }

    /// Serve incoming connections
    pub async fn serve(&self) -> Result<()> {
        let metrics = Arc::clone(&self.metrics);

        loop {
            match self.listener.accept().await {
                Ok((stream, _addr)) => {
                    let router = Arc::clone(&self.router);
                    let metrics = Arc::clone(&metrics);
                    let stream_manager = Arc::clone(&self.stream_manager);

                    // Increment active connections
                    metrics.active_connections.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, router, metrics.clone(), stream_manager).await {
                            error!("Connection error: {}", e);
                        }

                        // Decrement active connections
                        metrics.active_connections.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    });
                }
                Err(e) => {
                    error!("Accept error: {}", e);
                }
            }
        }
    }
}

/// Handle a single client connection
async fn handle_connection(
    mut stream: UnixStream,
    router: Arc<RpcRouter>,
    metrics: Arc<ServerMetrics>,
    stream_manager: Arc<StreamManager>,
) -> Result<()> {
    debug!("New client connected");

    loop {
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
        const MAX_FRAME_SIZE: usize = 100 * 1024 * 1024; // 100MB
        if length > MAX_FRAME_SIZE {
            error!("Frame too large: {} bytes", length);
            return Err(anyhow::anyhow!("Frame too large: {} bytes", length));
        }

        // Read payload
        let mut payload = vec![0u8; length];
        stream.read_exact(&mut payload)
            .await
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
                continue;
            }
        };

        debug!("Received request: id={} tool={} stream={}", request.id, request.tool, request.stream);

        // Update metrics
        metrics.total_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // Route request through the router
        let response = router.route(request.clone()).await;

        // Update failure metrics if needed
        if response.error.is_some() {
            metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }

        // Handle streaming if requested and response is large
        if request.stream && response.result.is_some() {
            // Serialize result to check size
            let result_json = serde_json::to_vec(response.result.as_ref().unwrap())
                .context("Failed to serialize result")?;

            if should_stream(result_json.len()) {
                debug!("Streaming response: {} bytes", result_json.len());

                // Create streaming response
                let (mut streaming_response, _receiver) = stream_manager.create_stream(
                    Some(result_json.len()),
                    CompressionType::Lz4,
                )?;

                // Send data as chunks
                if let Err(e) = streaming_response.send_all(&result_json).await {
                    error!("Failed to send streaming data: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    continue;
                }

                // Finish streaming
                if let Err(e) = streaming_response.finish().await {
                    error!("Failed to finish streaming: {}", e);
                    metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    continue;
                }

                // Note: In real implementation, we'd send chunks via the stream
                // For now, fallback to non-streaming
                debug!("Streaming complete for request {}", request.id);
            }
        }

        // Encode response (non-streaming or small response)
        let response_bytes = match codec::encode_response(&response) {
            Ok(bytes) => bytes,
            Err(e) => {
                error!("Failed to encode response: {}", e);
                metrics.failed_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                continue;
            }
        };

        // Send response
        if let Err(e) = stream.write_all(&response_bytes).await {
            error!("Failed to send response: {}", e);
            return Err(e).context("Failed to send response");
        }

        debug!("Sent response: id={}", response.id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoHandler;

    #[async_trait::async_trait]
    impl RequestHandler for EchoHandler {
        async fn handle_request(&self, request: RpcRequest) -> Result<RpcResponse> {
            Ok(RpcResponse::success(request.id, request.params))
        }
    }

    // TODO: Add integration tests
}
