//! State transfer between old and new server processes
//!
//! This module handles serialization and transfer of server state during hot reload.
//! It uses efficient binary encoding and includes checksums for validation.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::os::unix::net::UnixListener as StdUnixListener;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tracing::{error, info, warn};

use super::hot_reload::ServerState;

/// State transfer protocol version
const STATE_PROTOCOL_VERSION: u8 = 1;

/// State transfer envelope with metadata
#[derive(Debug, Serialize, Deserialize)]
pub struct StateEnvelope {
    /// Protocol version
    pub version: u8,

    /// Checksum of the state data (BLAKE3)
    pub checksum: Vec<u8>,

    /// Compression type used
    pub compression: CompressionType,

    /// Serialized state size (before compression)
    pub uncompressed_size: usize,

    /// Compressed size
    pub compressed_size: usize,

    /// Timestamp of export
    pub timestamp: chrono::DateTime<chrono::Utc>,

    /// The actual state data (compressed)
    pub state: Vec<u8>,
}

/// Compression type for state transfer
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum CompressionType {
    /// No compression
    None,

    /// LZ4 compression (fast)
    Lz4,

    /// Zstd compression (better ratio)
    Zstd,
}

/// State transfer client (used by new server to receive state)
pub struct StateTransferClient {
    socket_path: std::path::PathBuf,
    timeout: Duration,
}

impl StateTransferClient {
    /// Create new state transfer client
    pub fn new(socket_path: impl Into<std::path::PathBuf>, timeout: Duration) -> Self {
        Self {
            socket_path: socket_path.into(),
            timeout,
        }
    }

    /// Receive state from old server
    pub async fn receive_state(&self) -> Result<ServerState> {
        info!("Connecting to state transfer socket: {:?}", self.socket_path);

        // Wait for socket to be available
        let start = std::time::Instant::now();
        while !self.socket_path.exists() {
            if start.elapsed() > self.timeout {
                bail!("State transfer socket not found after timeout");
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Connect to socket
        let mut stream = tokio::time::timeout(
            self.timeout,
            UnixStream::connect(&self.socket_path),
        )
        .await
        .context("Connection timeout")??;

        info!("Connected to state transfer socket");

        // Read envelope
        let envelope = Self::read_envelope(&mut stream).await?;

        // Validate and decompress
        let state = Self::validate_and_decompress(&envelope)?;

        info!(
            "State received: {} connections, {} streams",
            state.connections.len(),
            state.streams.len()
        );

        Ok(state)
    }

    /// Read state envelope from stream
    async fn read_envelope(stream: &mut UnixStream) -> Result<StateEnvelope> {
        // Read length prefix (4 bytes)
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await
            .context("Failed to read envelope length")?;

        let len = u32::from_le_bytes(len_buf) as usize;

        if len > 100 * 1024 * 1024 {
            // 100MB max
            bail!("Envelope too large: {} bytes", len);
        }

        // Read envelope data
        let mut data = vec![0u8; len];
        stream.read_exact(&mut data).await
            .context("Failed to read envelope data")?;

        // Deserialize envelope using serde
        let envelope: StateEnvelope = serde_json::from_slice(&data)
            .context("Failed to deserialize envelope")?;

        Ok(envelope)
    }

    /// Validate checksum and decompress state
    fn validate_and_decompress(envelope: &StateEnvelope) -> Result<ServerState> {
        // Verify protocol version
        if envelope.version != STATE_PROTOCOL_VERSION {
            bail!(
                "Protocol version mismatch: expected {}, got {}",
                STATE_PROTOCOL_VERSION,
                envelope.version
            );
        }

        // Decompress state data
        let decompressed = match envelope.compression {
            CompressionType::None => envelope.state.clone(),
            CompressionType::Lz4 => {
                lz4::block::decompress(&envelope.state, Some(envelope.uncompressed_size as i32))
                    .context("LZ4 decompression failed")?
            }
            CompressionType::Zstd => {
                zstd::decode_all(&envelope.state[..])
                    .context("Zstd decompression failed")?
            }
        };

        // Verify checksum
        let checksum = blake3::hash(&decompressed);
        if checksum.as_bytes() != envelope.checksum.as_slice() {
            bail!("State checksum mismatch - data corruption detected");
        }

        // Deserialize state using serde
        let state: ServerState = serde_json::from_slice(&decompressed)
            .context("Failed to deserialize state")?;

        Ok(state)
    }
}

/// State transfer server (used by old server to send state)
pub struct StateTransferServer {
    socket_path: std::path::PathBuf,
    listener: Option<StdUnixListener>,
}

impl StateTransferServer {
    /// Create new state transfer server
    pub fn new(socket_path: impl Into<std::path::PathBuf>) -> Result<Self> {
        let socket_path = socket_path.into();

        // Remove existing socket
        if socket_path.exists() {
            std::fs::remove_file(&socket_path)
                .with_context(|| format!("Failed to remove existing socket: {:?}", socket_path))?;
        }

        // Create listener
        let listener = StdUnixListener::bind(&socket_path)
            .with_context(|| format!("Failed to bind state transfer socket: {:?}", socket_path))?;

        // Set non-blocking
        listener.set_nonblocking(true)?;

        info!("State transfer server listening on {:?}", socket_path);

        Ok(Self {
            socket_path,
            listener: Some(listener),
        })
    }

    /// Send state to new server
    pub async fn send_state(&mut self, state: &ServerState, compression: CompressionType) -> Result<()> {
        info!("Waiting for new server to connect...");

        // Accept connection (with timeout)
        let stream = tokio::time::timeout(
            Duration::from_secs(30),
            self.accept_connection(),
        )
        .await
        .context("Timeout waiting for new server connection")??;

        info!("New server connected, sending state");

        // Serialize state using serde_json
        let serialized = serde_json::to_vec(state)
            .context("Failed to serialize state")?;

        let uncompressed_size = serialized.len();

        // Compress state
        let (compressed, compression_type) = match compression {
            CompressionType::None => (serialized.clone(), CompressionType::None),
            CompressionType::Lz4 => {
                let compressed = lz4::block::compress(&serialized, None, true)
                    .context("LZ4 compression failed")?;
                (compressed, CompressionType::Lz4)
            }
            CompressionType::Zstd => {
                let compressed = zstd::encode_all(&serialized[..], 3)
                    .context("Zstd compression failed")?;
                (compressed, CompressionType::Zstd)
            }
        };

        let compressed_size = compressed.len();

        info!(
            "State compressed: {} -> {} bytes ({:.1}% reduction)",
            uncompressed_size,
            compressed_size,
            (1.0 - (compressed_size as f64 / uncompressed_size as f64)) * 100.0
        );

        // Calculate checksum of uncompressed data
        let checksum = blake3::hash(&serialized);

        // Create envelope
        let envelope = StateEnvelope {
            version: STATE_PROTOCOL_VERSION,
            checksum: checksum.as_bytes().to_vec(),
            compression: compression_type,
            uncompressed_size,
            compressed_size,
            timestamp: chrono::Utc::now(),
            state: compressed,
        };

        // Send envelope
        Self::send_envelope(stream, &envelope).await?;

        info!("State sent successfully");

        Ok(())
    }

    /// Accept incoming connection
    async fn accept_connection(&mut self) -> Result<UnixStream> {
        let listener = self.listener.take()
            .ok_or_else(|| anyhow::anyhow!("Listener already closed"))?;

        // Convert to tokio listener
        let tokio_listener = UnixListener::from_std(listener)?;

        // Accept connection
        let (stream, _) = tokio_listener.accept().await
            .context("Failed to accept connection")?;

        Ok(stream)
    }

    /// Send envelope to stream
    async fn send_envelope(mut stream: UnixStream, envelope: &StateEnvelope) -> Result<()> {
        // Serialize envelope using serde_json
        let data = serde_json::to_vec(envelope)
            .context("Failed to serialize envelope")?;

        // Send length prefix
        let len = data.len() as u32;
        stream.write_all(&len.to_le_bytes()).await
            .context("Failed to write envelope length")?;

        // Send data
        stream.write_all(&data).await
            .context("Failed to write envelope data")?;

        stream.flush().await
            .context("Failed to flush stream")?;

        Ok(())
    }
}

impl Drop for StateTransferServer {
    fn drop(&mut self) {
        // Clean up socket file
        if self.socket_path.exists() {
            let _ = std::fs::remove_file(&self.socket_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn create_test_state() -> ServerState {
        use super::super::hot_reload::{MetricsSnapshot, ConfigSnapshot};

        ServerState {
            timestamp: chrono::Utc::now(),
            pid: 12345,
            version: "1.0.0".to_string(),
            connections: vec![],
            streams: HashMap::new(),
            metrics: MetricsSnapshot {
                total_requests: 1000,
                failed_requests: 10,
                active_connections: 5,
                uptime_secs: 3600,
                avg_latency_ms: 25.5,
                p99_latency_ms: 150,
            },
            config: ConfigSnapshot {
                socket_path: Some(std::path::PathBuf::from("/tmp/test.sock")),
                tcp_addr: None,
                tcp_enabled: false,
                max_frame_size: 1024 * 1024,
            },
        }
    }

    #[tokio::test]
    async fn test_state_transfer_no_compression() {
        let temp_dir = TempDir::new().unwrap();
        let socket_path = temp_dir.path().join("state.sock");

        let state = create_test_state();

        // Spawn server
        let socket_path_clone = socket_path.clone();
        let state_clone = state.clone();
        let server_task = tokio::spawn(async move {
            let mut server = StateTransferServer::new(socket_path_clone).unwrap();
            server.send_state(&state_clone, CompressionType::None).await
        });

        // Give server time to start
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Create client and receive
        let client = StateTransferClient::new(socket_path, Duration::from_secs(5));
        let received_state = client.receive_state().await.unwrap();

        // Wait for server
        server_task.await.unwrap().unwrap();

        // Verify
        assert_eq!(received_state.pid, state.pid);
        assert_eq!(received_state.version, state.version);
        assert_eq!(received_state.metrics.total_requests, state.metrics.total_requests);
    }

    #[tokio::test]
    async fn test_state_transfer_lz4_compression() {
        let temp_dir = TempDir::new().unwrap();
        let socket_path = temp_dir.path().join("state.sock");

        let state = create_test_state();

        let socket_path_clone = socket_path.clone();
        let state_clone = state.clone();
        let server_task = tokio::spawn(async move {
            let mut server = StateTransferServer::new(socket_path_clone).unwrap();
            server.send_state(&state_clone, CompressionType::Lz4).await
        });

        tokio::time::sleep(Duration::from_millis(100)).await;

        let client = StateTransferClient::new(socket_path, Duration::from_secs(5));
        let received_state = client.receive_state().await.unwrap();

        server_task.await.unwrap().unwrap();

        assert_eq!(received_state.pid, state.pid);
        assert_eq!(received_state.metrics.total_requests, state.metrics.total_requests);
    }

    #[tokio::test]
    async fn test_state_transfer_zstd_compression() {
        let temp_dir = TempDir::new().unwrap();
        let socket_path = temp_dir.path().join("state.sock");

        let state = create_test_state();

        let socket_path_clone = socket_path.clone();
        let state_clone = state.clone();
        let server_task = tokio::spawn(async move {
            let mut server = StateTransferServer::new(socket_path_clone).unwrap();
            server.send_state(&state_clone, CompressionType::Zstd).await
        });

        tokio::time::sleep(Duration::from_millis(100)).await;

        let client = StateTransferClient::new(socket_path, Duration::from_secs(5));
        let received_state = client.receive_state().await.unwrap();

        server_task.await.unwrap().unwrap();

        assert_eq!(received_state.pid, state.pid);
        assert_eq!(received_state.metrics.total_requests, state.metrics.total_requests);
    }

    #[tokio::test]
    async fn test_client_timeout() {
        let temp_dir = TempDir::new().unwrap();
        let socket_path = temp_dir.path().join("nonexistent.sock");

        let client = StateTransferClient::new(socket_path, Duration::from_millis(100));
        let result = client.receive_state().await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("timeout"));
    }
}
