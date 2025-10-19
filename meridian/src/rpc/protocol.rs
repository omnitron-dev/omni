//! RPC protocol message types and error codes
//!
//! This module defines the wire protocol for Meridian RPC communication.
//! All messages are encoded using MessagePack for efficiency.

use serde::{Deserialize, Serialize};
use std::fmt;

/// RPC request message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    /// Protocol version (current: 1)
    #[serde(rename = "v")]
    pub version: u8,

    /// Unique request ID for correlation
    #[serde(rename = "id")]
    pub id: u64,

    /// Tool name (e.g., "code.search_symbols")
    #[serde(rename = "t")]
    pub tool: String,

    /// JSON-encoded parameters
    #[serde(rename = "p")]
    pub params: serde_json::Value,

    /// Enable streaming response?
    #[serde(rename = "s", default)]
    pub stream: bool,

    /// Maximum result size (bytes), None = unlimited
    #[serde(rename = "m", skip_serializing_if = "Option::is_none")]
    pub max_size: Option<usize>,

    /// Request timeout (milliseconds), None = server default
    #[serde(rename = "timeout", skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,

    /// Optional authentication token
    #[serde(rename = "auth", skip_serializing_if = "Option::is_none")]
    pub auth: Option<String>,
}

/// RPC response message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    /// Protocol version
    #[serde(rename = "v")]
    pub version: u8,

    /// Request ID (matches RpcRequest.id)
    #[serde(rename = "id")]
    pub id: u64,

    /// Result (if successful)
    #[serde(rename = "r", skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,

    /// Error (if failed)
    #[serde(rename = "e", skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,

    /// Streaming chunk (if request.stream = true)
    #[serde(rename = "c", skip_serializing_if = "Option::is_none")]
    pub chunk: Option<StreamChunk>,

    /// Server performance metrics
    #[serde(rename = "metrics", skip_serializing_if = "Option::is_none")]
    pub metrics: Option<ResponseMetrics>,
}

impl RpcResponse {
    /// Create success response
    pub fn success(id: u64, result: serde_json::Value) -> Self {
        Self {
            version: super::PROTOCOL_VERSION,
            id,
            result: Some(result),
            error: None,
            chunk: None,
            metrics: None,
        }
    }

    /// Create error response
    pub fn error(id: u64, error: RpcError) -> Self {
        Self {
            version: super::PROTOCOL_VERSION,
            id,
            result: None,
            error: Some(error),
            chunk: None,
            metrics: None,
        }
    }

    /// Create streaming chunk response
    pub fn stream_chunk(id: u64, chunk: StreamChunk) -> Self {
        Self {
            version: super::PROTOCOL_VERSION,
            id,
            result: None,
            error: None,
            chunk: Some(chunk),
            metrics: None,
        }
    }

    /// Add metrics to response
    pub fn with_metrics(mut self, metrics: ResponseMetrics) -> Self {
        self.metrics = Some(metrics);
        self
    }
}

/// RPC error message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    /// Error code
    pub code: ErrorCode,

    /// Human-readable message
    pub message: String,

    /// Additional error data
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,

    /// Stack trace (debug builds only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace: Option<Vec<String>>,
}

impl RpcError {
    /// Create error from code and message
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
            trace: None,
        }
    }

    /// Create error with additional data
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = Some(data);
        self
    }

    /// Add stack trace (debug builds only)
    #[cfg(debug_assertions)]
    pub fn with_trace(mut self, trace: Vec<String>) -> Self {
        self.trace = Some(trace);
        self
    }

    #[cfg(not(debug_assertions))]
    pub fn with_trace(self, _trace: Vec<String>) -> Self {
        self // No trace in release builds
    }

    // Convenience constructors for common errors
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidRequest, message)
    }

    pub fn internal_error(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InternalError, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Timeout, message)
    }

    pub fn resource_exhausted(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ResourceExhausted, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unauthorized, message)
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::RateLimited, message)
    }
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

/// Error codes for RPC protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u16)]
pub enum ErrorCode {
    // Protocol errors (1000-1999)
    InvalidRequest = 1000,
    UnsupportedVersion = 1001,
    MalformedParams = 1002,
    RequestTooLarge = 1003,
    ResponseTooLarge = 1004,

    // Server errors (2000-2999)
    InternalError = 2000,
    NotFound = 2001,
    Timeout = 2002,
    ResourceExhausted = 2003,
    ServiceUnavailable = 2004,
    DatabaseError = 2005,

    // Business logic errors (3000-3999)
    SymbolNotFound = 3000,
    ProjectNotFound = 3001,
    InvalidQuery = 3002,
    PermissionDenied = 3003,
    SpecNotFound = 3004,
    TaskNotFound = 3005,

    // Client errors (4000-4999)
    Unauthorized = 4000,
    RateLimited = 4001,
    QuotaExceeded = 4002,
}

impl ErrorCode {
    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ErrorCode::Timeout
                | ErrorCode::ResourceExhausted
                | ErrorCode::ServiceUnavailable
                | ErrorCode::DatabaseError
        )
    }
}

/// Streaming chunk for large responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    /// Chunk sequence number (0-indexed)
    pub sequence: u64,

    /// Chunk data (partial result)
    pub data: Vec<u8>,

    /// Is this the final chunk?
    pub is_final: bool,

    /// Total chunks (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_chunks: Option<u64>,

    /// Compression used (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compression: Option<CompressionType>,
}

impl StreamChunk {
    /// Create a new stream chunk
    pub fn new(sequence: u64, data: Vec<u8>, is_final: bool) -> Self {
        Self {
            sequence,
            data,
            is_final,
            total_chunks: None,
            compression: None,
        }
    }

    /// Set total chunks
    pub fn with_total(mut self, total: u64) -> Self {
        self.total_chunks = Some(total);
        self
    }

    /// Set compression type
    pub fn with_compression(mut self, compression: CompressionType) -> Self {
        self.compression = Some(compression);
        self
    }
}

/// Compression type for stream chunks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompressionType {
    /// No compression
    None,
    /// LZ4 compression (fast)
    Lz4,
    /// Zstd compression (better ratio)
    Zstd,
}

/// Response metrics for monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMetrics {
    /// Server processing time (microseconds)
    pub processing_time_us: u64,

    /// Database query time (microseconds)
    pub db_time_us: u64,

    /// Cache hit?
    pub cache_hit: bool,

    /// Number of results
    pub result_count: usize,

    /// Response size (bytes, uncompressed)
    pub response_size: usize,
}

impl ResponseMetrics {
    /// Create new metrics
    pub fn new() -> Self {
        Self {
            processing_time_us: 0,
            db_time_us: 0,
            cache_hit: false,
            result_count: 0,
            response_size: 0,
        }
    }

    /// Set processing time from duration
    pub fn with_processing_time(mut self, duration: std::time::Duration) -> Self {
        self.processing_time_us = duration.as_micros() as u64;
        self
    }

    /// Set database time from duration
    pub fn with_db_time(mut self, duration: std::time::Duration) -> Self {
        self.db_time_us = duration.as_micros() as u64;
        self
    }

    /// Mark as cache hit
    pub fn with_cache_hit(mut self) -> Self {
        self.cache_hit = true;
        self
    }

    /// Set result count
    pub fn with_result_count(mut self, count: usize) -> Self {
        self.result_count = count;
        self
    }

    /// Set response size
    pub fn with_response_size(mut self, size: usize) -> Self {
        self.response_size = size;
        self
    }
}

impl Default for ResponseMetrics {
    fn default() -> Self {
        Self::new()
    }
}

/// Handshake request (connection initialization)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeRequest {
    /// Client version
    pub client_version: String,

    /// Protocol version
    pub protocol_version: u8,

    /// Client capabilities
    pub capabilities: Vec<String>,

    /// Client identifier
    pub client_id: String,
}

/// Handshake response (connection acknowledgment)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeResponse {
    /// Server version
    pub server_version: String,

    /// Negotiated protocol version
    pub protocol_version: u8,

    /// Server capabilities
    pub capabilities: Vec<String>,

    /// Session ID
    pub session_id: String,

    /// Maximum request size (bytes)
    pub max_request_size: usize,

    /// Maximum response size (bytes)
    pub max_response_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_code_retryable() {
        assert!(ErrorCode::Timeout.is_retryable());
        assert!(ErrorCode::ResourceExhausted.is_retryable());
        assert!(ErrorCode::ServiceUnavailable.is_retryable());
        assert!(!ErrorCode::InvalidRequest.is_retryable());
        assert!(!ErrorCode::Unauthorized.is_retryable());
    }

    #[test]
    fn test_rpc_error_display() {
        let error = RpcError::not_found("Symbol not found");
        assert_eq!(error.to_string(), "[NotFound] Symbol not found");
    }

    #[test]
    fn test_stream_chunk_builder() {
        let chunk = StreamChunk::new(0, vec![1, 2, 3], false)
            .with_total(10)
            .with_compression(CompressionType::Lz4);

        assert_eq!(chunk.sequence, 0);
        assert_eq!(chunk.data, vec![1, 2, 3]);
        assert!(!chunk.is_final);
        assert_eq!(chunk.total_chunks, Some(10));
        assert_eq!(chunk.compression, Some(CompressionType::Lz4));
    }

    #[test]
    fn test_response_metrics_builder() {
        let metrics = ResponseMetrics::new()
            .with_processing_time(std::time::Duration::from_millis(100))
            .with_db_time(std::time::Duration::from_millis(50))
            .with_cache_hit()
            .with_result_count(42)
            .with_response_size(1024);

        assert_eq!(metrics.processing_time_us, 100_000);
        assert_eq!(metrics.db_time_us, 50_000);
        assert!(metrics.cache_hit);
        assert_eq!(metrics.result_count, 42);
        assert_eq!(metrics.response_size, 1024);
    }
}
