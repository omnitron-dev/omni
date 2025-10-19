//! RPC module for client-server communication
//!
//! This module implements a binary RPC protocol using MessagePack for efficient
//! communication between thin MCP clients and the global server daemon.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────┐         ┌─────────────┐
//! │ Thin Client │◄───────►│   Server    │
//! │             │  RPC    │   Daemon    │
//! │ (20MB RAM)  │Protocol │ (800MB RAM) │
//! └─────────────┘         └─────────────┘
//! ```
//!
//! # Features
//!
//! - **Binary protocol**: MessagePack encoding (~40% smaller than JSON)
//! - **Streaming support**: Handle large result sets efficiently
//! - **Multiplexing**: Multiple concurrent requests on single connection
//! - **Compression**: LZ4/Zstd for large payloads
//! - **Hot-reload**: Server can reload without client disconnection
//!
//! # Example
//!
//! ```rust,no_run
//! use meridian::rpc::{RpcClient, RpcRequest};
//! use serde_json::json;
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Connect to server
//!     let client = RpcClient::connect("unix:///tmp/meridian.sock").await?;
//!
//!     // Send request
//!     let response = client.call(RpcRequest {
//!         version: 1,
//!         id: 1,
//!         tool: "code.search_symbols".to_string(),
//!         params: rmpv::ext::to_value(&json!({
//!             "query": "async fn",
//!             "limit": 10
//!         }))?,
//!         stream: false,
//!         max_size: None,
//!         timeout_ms: Some(5000),
//!         auth: None,
//!     }).await?;
//!
//!     println!("Result: {:?}", response.result);
//!     Ok(())
//! }
//! ```

pub mod protocol;
pub mod codec;
pub mod client;
pub mod server;
pub mod streaming;
pub mod connection;
pub mod tool_registry;
pub mod router;
pub mod db_pool;
pub mod handshake;
pub mod connection_pool;
pub mod executor;
pub mod dispatcher;
pub mod monitor;
pub mod enhanced_server;
pub mod hot_reload;
pub mod state_transfer;

// Re-exports
pub use protocol::{
    RpcRequest, RpcResponse, RpcError, ErrorCode,
    StreamChunk, CompressionType, ResponseMetrics,
    HandshakeRequest, HandshakeResponse,
};
pub use client::RpcClient;
pub use server::{RpcServer, ServerStats, RequestHandler};
pub use streaming::StreamingClient;
pub use connection::{Connection, ConnectionPool};
pub use tool_registry::{ToolRegistry, ToolMetadata, ToolContext};
pub use router::{RpcRouter, Middleware, LoggingMiddleware, AuthMiddleware, RateLimitMiddleware};
pub use db_pool::{DatabasePool, PoolConfig, PoolStats};
pub use handshake::{HandshakeManager, HandshakeClient};
pub use connection_pool::{ConnectionPoolManager, ConnectionPoolConfig, PoolStatistics, PooledConnectionGuard};
pub use executor::{ThreadPoolExecutor, ExecutorConfig, ExecutorStats, Priority};
pub use dispatcher::{RequestDispatcher, DispatcherConfig, DispatcherStats, LoadBalancingStrategy};
pub use monitor::{PerformanceMonitor, MonitorConfig, PerformanceMetrics, LatencyHistogram};
pub use enhanced_server::{EnhancedRpcServer, EnhancedServerConfig, ServerStats as EnhancedServerStats};
pub use hot_reload::{
    HotReloadCoordinator, HotReloadConfig, HotReloadable, ServerState,
    ConnectionState, StreamState, MetricsSnapshot, ConfigSnapshot,
    install_sighup_handler, watch_binary_for_changes, ReloadMetrics,
};
pub use state_transfer::{StateTransferClient, StateTransferServer, CompressionType as StateCompressionType};

/// RPC protocol version
pub const PROTOCOL_VERSION: u8 = 1;

/// Default Unix socket path
pub fn default_socket_path() -> std::path::PathBuf {
    std::path::PathBuf::from("/tmp/meridian.sock")
}
