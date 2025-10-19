//! RPC client implementation
//!
//! This module provides the client-side RPC implementation for connecting
//! to the Meridian server daemon.

use super::protocol::{RpcRequest, RpcResponse, RpcError, ErrorCode, HandshakeRequest, HandshakeResponse, StreamChunk};
use super::codec;
use super::streaming::StreamingClient;
use anyhow::{Context, Result, bail};
use tokio::net::UnixStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::Duration;
use tracing::{debug, warn};

/// RPC client for communicating with Meridian server
pub struct RpcClient {
    connection: Arc<Mutex<UnixStream>>,
    base_url: String,
    next_request_id: Arc<Mutex<u64>>,
}

impl RpcClient {
    /// Connect to server via Unix socket
    ///
    /// # Example
    ///
    /// ```no_run
    /// use meridian::rpc::RpcClient;
    ///
    /// #[tokio::main]
    /// async fn main() -> anyhow::Result<()> {
    ///     let client = RpcClient::connect("unix:///tmp/meridian.sock").await?;
    ///     Ok(())
    /// }
    /// ```
    pub async fn connect(url: impl AsRef<str>) -> Result<Self> {
        let url = url.as_ref();

        // Parse URL
        if !url.starts_with("unix://") {
            bail!("Only unix:// URLs are supported currently");
        }

        let socket_path = url.strip_prefix("unix://")
            .context("Invalid unix:// URL")?;

        // Connect to Unix socket
        let stream = UnixStream::connect(socket_path)
            .await
            .with_context(|| format!("Failed to connect to {}", socket_path))?;

        debug!("Connected to server at {}", socket_path);

        let client = Self {
            connection: Arc::new(Mutex::new(stream)),
            base_url: url.to_string(),
            next_request_id: Arc::new(Mutex::new(1)),
        };

        // Perform handshake
        client.handshake().await?;

        Ok(client)
    }

    /// Perform handshake with server
    async fn handshake(&self) -> Result<HandshakeResponse> {
        let _handshake = HandshakeRequest {
            client_version: env!("CARGO_PKG_VERSION").to_string(),
            protocol_version: super::PROTOCOL_VERSION,
            capabilities: vec!["streaming".to_string(), "compression".to_string()],
            client_id: format!("client-{}", std::process::id()),
        };

        // TODO: Send handshake and receive response
        // For now, return dummy response

        Ok(HandshakeResponse {
            server_version: "0.1.0".to_string(),
            protocol_version: super::PROTOCOL_VERSION,
            capabilities: vec!["streaming".to_string()],
            session_id: uuid::Uuid::new_v4().to_string(),
            max_request_size: 10 * 1024 * 1024,
            max_response_size: 100 * 1024 * 1024,
        })
    }

    /// Generate next request ID
    async fn next_id(&self) -> u64 {
        let mut id = self.next_request_id.lock().await;
        let current = *id;
        *id += 1;
        current
    }

    /// Call a tool on the server
    ///
    /// # Example
    ///
    /// ```no_run
    /// use meridian::rpc::{RpcClient, RpcRequest};
    /// use serde_json::json;
    ///
    /// #[tokio::main]
    /// async fn main() -> anyhow::Result<()> {
    ///     let client = RpcClient::connect("unix:///tmp/meridian.sock").await?;
    ///
    ///     let request = RpcRequest {
    ///         version: 1,
    ///         id: 1,
    ///         tool: "ping".to_string(),
    ///         params: serde_json::json!(null),
    ///         stream: false,
    ///         max_size: None,
    ///         timeout_ms: Some(5000),
    ///         auth: None,
    ///     };
    ///
    ///     let response = client.call(request).await?;
    ///     println!("Response: {:?}", response);
    ///     Ok(())
    /// }
    /// ```
    pub async fn call(&self, mut request: RpcRequest) -> Result<RpcResponse> {
        // Set request ID if not set
        if request.id == 0 {
            request.id = self.next_id().await;
        }

        let is_streaming = request.stream;

        // Encode request
        let request_bytes = codec::encode_request(&request)
            .context("Failed to encode request")?;

        // Send request
        {
            let mut conn = self.connection.lock().await;
            conn.write_all(&request_bytes)
                .await
                .context("Failed to send request")?;

            debug!("Sent request: id={} tool={} stream={}", request.id, request.tool, is_streaming);
        }

        // Handle streaming vs non-streaming response
        if is_streaming {
            self.receive_streaming_response(request.id).await
        } else {
            let response = self.receive_response().await?;

            // Verify response ID matches request
            if response.id != request.id {
                bail!(
                    "Response ID mismatch: expected {}, got {}",
                    request.id,
                    response.id
                );
            }

            // Check for error
            if let Some(error) = response.error {
                bail!("Server returned error: {}", error);
            }

            Ok(response)
        }
    }

    /// Receive streaming response and reassemble
    async fn receive_streaming_response(&self, request_id: u64) -> Result<RpcResponse> {
        let mut streaming_client = StreamingClient::new();
        let mut is_final = false;

        while !is_final {
            let response = self.receive_response().await?;

            // Verify response ID
            if response.id != request_id {
                bail!(
                    "Response ID mismatch: expected {}, got {}",
                    request_id,
                    response.id
                );
            }

            // Check for error
            if let Some(error) = response.error {
                bail!("Server returned error: {}", error);
            }

            // Check for chunk
            if let Some(chunk) = response.chunk {
                is_final = streaming_client.add_chunk(chunk)?;

                if !is_final {
                    debug!("Received chunk for request {}", request_id);
                }
            } else if response.result.is_some() {
                // Non-chunked response (backward compatibility)
                return Ok(response);
            } else {
                bail!("Invalid streaming response: no chunk or result");
            }
        }

        debug!("Streaming complete for request {}", request_id);

        // Reassemble chunks
        let data = streaming_client.reassemble()
            .context("Failed to reassemble chunks")?;

        // Deserialize result
        let result: serde_json::Value = serde_json::from_slice(&data)
            .context("Failed to deserialize streaming result")?;

        Ok(RpcResponse::success(request_id, result))
    }

    /// Receive response from server
    async fn receive_response(&self) -> Result<RpcResponse> {
        let mut conn = self.connection.lock().await;

        // Read frame header (4 bytes)
        let mut header = [0u8; codec::FRAME_HEADER_SIZE];
        conn.read_exact(&mut header)
            .await
            .context("Failed to read response header")?;

        // Parse length
        let length = u32::from_le_bytes(header) as usize;

        // Read payload
        let mut payload = vec![0u8; length];
        conn.read_exact(&mut payload)
            .await
            .context("Failed to read response payload")?;

        // Decode response
        let mut frame = Vec::with_capacity(codec::FRAME_HEADER_SIZE + length);
        frame.extend_from_slice(&header);
        frame.extend_from_slice(&payload);

        codec::decode_response(&frame)
            .context("Failed to decode response")
    }

    /// Try to reconnect to server
    pub async fn try_reconnect(&self) -> Result<()> {
        warn!("Attempting to reconnect...");

        // Parse socket path from URL
        let socket_path = self.base_url.strip_prefix("unix://")
            .context("Invalid URL format")?;

        // Try to reconnect
        let stream = UnixStream::connect(socket_path)
            .await
            .context("Failed to reconnect")?;

        // Replace connection
        {
            let mut conn = self.connection.lock().await;
            *conn = stream;
        }

        // Re-handshake
        self.handshake().await?;

        debug!("Reconnected successfully");
        Ok(())
    }

    /// Ping server to check connectivity
    pub async fn ping(&self) -> Result<()> {
        let request = RpcRequest {
            version: super::PROTOCOL_VERSION,
            id: self.next_id().await,
            tool: "ping".to_string(),
            params: serde_json::json!(null),
            stream: false,
            max_size: None,
            timeout_ms: Some(1000),
            auth: None,
        };

        let _ = self.call(request).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TODO: Add tests with mock server

    #[test]
    fn test_url_parsing() {
        assert!("unix:///tmp/test.sock".starts_with("unix://"));
        assert!(!"tcp://localhost:7878".starts_with("unix://"));
    }
}
