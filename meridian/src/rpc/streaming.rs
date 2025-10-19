//! Streaming support for large RPC responses
//!
//! This module provides efficient streaming for large RPC responses with:
//! - Automatic chunking for responses >1MB
//! - LZ4/Zstd compression per chunk
//! - Progress tracking and callbacks
//! - Backpressure mechanism
//! - Concurrent stream management

use super::protocol::{StreamChunk, CompressionType};
use super::codec;
use anyhow::{Context, Result, bail};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;
use std::collections::HashMap;
use parking_lot::RwLock;
use tracing::{debug, warn};

/// Default chunk size (64KB)
pub const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;

/// Compression threshold per chunk (1KB)
pub const COMPRESSION_THRESHOLD: usize = 1024;

/// Maximum concurrent streams per connection
pub const MAX_CONCURRENT_STREAMS: usize = 10;

/// Progress update interval (chunks)
pub const PROGRESS_UPDATE_INTERVAL: u64 = 10;

/// Progress update interval (milliseconds)
pub const PROGRESS_UPDATE_INTERVAL_MS: u64 = 500;

/// Response size threshold for streaming (1MB)
pub const STREAMING_THRESHOLD: usize = 1024 * 1024;

/// Streaming response sender for large responses
pub struct StreamingResponse {
    /// Unique stream ID
    pub stream_id: Uuid,

    /// Total size (if known)
    pub total_size: Option<usize>,

    /// Chunk size
    pub chunk_size: usize,

    /// Compression type
    pub compression: CompressionType,

    /// Current chunk sequence number
    sequence: u64,

    /// Bytes sent so far
    bytes_sent: usize,

    /// Channel for sending chunks
    sender: mpsc::Sender<StreamChunk>,

    /// Last progress update time
    last_progress_time: std::time::Instant,
}

impl StreamingResponse {
    /// Create new streaming response
    pub fn new(
        stream_id: Uuid,
        total_size: Option<usize>,
        compression: CompressionType,
        sender: mpsc::Sender<StreamChunk>,
    ) -> Self {
        Self {
            stream_id,
            total_size,
            chunk_size: DEFAULT_CHUNK_SIZE,
            compression,
            sequence: 0,
            bytes_sent: 0,
            sender,
            last_progress_time: std::time::Instant::now(),
        }
    }

    /// Send a chunk of data
    pub async fn send_chunk(&mut self, data: &[u8]) -> Result<()> {
        if data.is_empty() {
            return Ok(());
        }

        // Compress if above threshold
        let (chunk_data, actual_compression) = if data.len() >= COMPRESSION_THRESHOLD {
            match codec::compress(data, self.compression) {
                Ok(compressed) if compressed.len() < data.len() => {
                    (compressed, Some(self.compression))
                }
                _ => (data.to_vec(), None),
            }
        } else {
            (data.to_vec(), None)
        };

        // Calculate total chunks if known
        let total_chunks = self.total_size.map(|total| {
            total.div_ceil(self.chunk_size) as u64
        });

        // Create chunk
        let mut chunk = StreamChunk::new(self.sequence, chunk_data, false);
        if let Some(total) = total_chunks {
            chunk = chunk.with_total(total);
        }
        if let Some(comp) = actual_compression {
            chunk = chunk.with_compression(comp);
        }

        // Send chunk
        self.sender.send(chunk)
            .await
            .context("Failed to send chunk")?;

        // Update state
        self.sequence += 1;
        self.bytes_sent += data.len();

        // Check if we should send progress update
        let elapsed = self.last_progress_time.elapsed();
        if self.sequence.is_multiple_of(PROGRESS_UPDATE_INTERVAL)
            || elapsed.as_millis() as u64 >= PROGRESS_UPDATE_INTERVAL_MS {
            self.last_progress_time = std::time::Instant::now();
            debug!(
                "Stream progress: {}/{:?} bytes ({} chunks)",
                self.bytes_sent,
                self.total_size,
                self.sequence
            );
        }

        Ok(())
    }

    /// Send complete data by splitting into chunks
    pub async fn send_all(&mut self, data: &[u8]) -> Result<()> {
        // Update total size if not set
        if self.total_size.is_none() {
            self.total_size = Some(data.len());
        }

        // Split into chunks and send
        for chunk in data.chunks(self.chunk_size) {
            self.send_chunk(chunk).await?;
        }

        Ok(())
    }

    /// Finish streaming and send final chunk
    pub async fn finish(self) -> Result<()> {
        // Send final empty chunk to signal completion
        let total_chunks = self.total_size.map(|total| {
            total.div_ceil(self.chunk_size) as u64
        });

        let mut final_chunk = StreamChunk::new(self.sequence, Vec::new(), true);
        if let Some(total) = total_chunks {
            final_chunk = final_chunk.with_total(total);
        }

        self.sender.send(final_chunk)
            .await
            .context("Failed to send final chunk")?;

        debug!(
            "Stream completed: {} bytes in {} chunks",
            self.bytes_sent,
            self.sequence
        );

        Ok(())
    }

    /// Get current progress (bytes sent, total bytes)
    pub fn progress(&self) -> (usize, Option<usize>) {
        (self.bytes_sent, self.total_size)
    }
}

/// Streaming receiver for receiving chunked responses
pub struct StreamingReceiver {
    /// Stream ID
    pub stream_id: Uuid,

    /// Received chunks
    chunks: Vec<StreamChunk>,

    /// Total chunks expected (if known)
    total_chunks: Option<u64>,

    /// Bytes received so far
    bytes_received: usize,

    /// Total bytes expected (if known)
    total_bytes: Option<usize>,

    /// Is stream complete?
    is_complete: bool,

    /// Channel for receiving chunks
    receiver: Arc<Mutex<mpsc::Receiver<StreamChunk>>>,
}

impl StreamingReceiver {
    /// Create new streaming receiver
    pub fn new(
        stream_id: Uuid,
        receiver: mpsc::Receiver<StreamChunk>,
    ) -> Self {
        Self {
            stream_id,
            chunks: Vec::new(),
            total_chunks: None,
            bytes_received: 0,
            total_bytes: None,
            is_complete: false,
            receiver: Arc::new(Mutex::new(receiver)),
        }
    }

    /// Receive next chunk
    pub async fn receive_chunk(&mut self) -> Result<Option<Vec<u8>>> {
        if self.is_complete {
            return Ok(None);
        }

        let mut rx = self.receiver.lock().await;
        match rx.recv().await {
            Some(chunk) => {
                // Update total chunks if provided
                if let Some(total) = chunk.total_chunks {
                    self.total_chunks = Some(total);
                }

                // Check if final chunk
                if chunk.is_final {
                    self.is_complete = true;
                    debug!("Stream complete: received {} chunks", self.chunks.len());
                    return Ok(None);
                }

                // Decompress if needed
                let data = if let Some(compression) = chunk.compression {
                    codec::decompress(&chunk.data, compression)
                        .context("Failed to decompress chunk")?
                } else {
                    chunk.data.clone()
                };

                self.bytes_received += data.len();
                self.chunks.push(chunk);

                Ok(Some(data))
            }
            None => {
                warn!("Stream channel closed unexpectedly");
                self.is_complete = true;
                Ok(None)
            }
        }
    }

    /// Receive all remaining chunks and reassemble
    pub async fn receive_all(&mut self) -> Result<Vec<u8>> {
        let mut result = Vec::new();

        while let Some(data) = self.receive_chunk().await? {
            result.extend_from_slice(&data);
        }

        Ok(result)
    }

    /// Get current progress (bytes received, total bytes)
    pub fn progress(&self) -> (usize, Option<usize>) {
        (self.bytes_received, self.total_bytes)
    }

    /// Get progress percentage (0-100) if total is known
    pub fn progress_percent(&self) -> Option<f32> {
        self.total_bytes.map(|total| {
            if total == 0 {
                100.0
            } else {
                (self.bytes_received as f32 / total as f32) * 100.0
            }
        })
    }

    /// Is stream complete?
    pub fn is_complete(&self) -> bool {
        self.is_complete
    }

    /// Number of chunks received
    pub fn chunks_received(&self) -> usize {
        self.chunks.len()
    }
}

/// Stream manager for handling multiple concurrent streams
pub struct StreamManager {
    /// Active streams
    streams: Arc<RwLock<HashMap<Uuid, mpsc::Sender<StreamChunk>>>>,

    /// Maximum concurrent streams
    max_streams: usize,
}

impl StreamManager {
    /// Create new stream manager
    pub fn new() -> Self {
        Self {
            streams: Arc::new(RwLock::new(HashMap::new())),
            max_streams: MAX_CONCURRENT_STREAMS,
        }
    }

    /// Create new stream
    pub fn create_stream(
        &self,
        total_size: Option<usize>,
        compression: CompressionType,
    ) -> Result<(StreamingResponse, StreamingReceiver)> {
        let mut streams = self.streams.write();

        // Check if at capacity
        if streams.len() >= self.max_streams {
            bail!("Maximum concurrent streams ({}) reached", self.max_streams);
        }

        let stream_id = Uuid::new_v4();

        // Create channel with buffering
        let (tx, rx) = mpsc::channel(100);

        // Register stream
        streams.insert(stream_id, tx.clone());

        let response = StreamingResponse::new(stream_id, total_size, compression, tx);
        let receiver = StreamingReceiver::new(stream_id, rx);

        debug!("Created stream: {} (active: {})", stream_id, streams.len());

        Ok((response, receiver))
    }

    /// Remove stream
    pub fn remove_stream(&self, stream_id: &Uuid) {
        let mut streams = self.streams.write();
        streams.remove(stream_id);
        debug!("Removed stream: {} (active: {})", stream_id, streams.len());
    }

    /// Get number of active streams
    pub fn active_streams(&self) -> usize {
        self.streams.read().len()
    }

    /// Check if stream exists
    pub fn has_stream(&self, stream_id: &Uuid) -> bool {
        self.streams.read().contains_key(stream_id)
    }
}

impl Default for StreamManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Determine if response should be streamed based on size
pub fn should_stream(response_size: usize) -> bool {
    response_size >= STREAMING_THRESHOLD
}

/// Streaming client for receiving chunked responses (backward compatible)
pub struct StreamingClient {
    chunks: Vec<StreamChunk>,
}

impl StreamingClient {
    /// Create new streaming client
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
        }
    }

    /// Add chunk to stream
    pub fn add_chunk(&mut self, chunk: StreamChunk) -> Result<bool> {
        self.chunks.push(chunk.clone());
        Ok(chunk.is_final)
    }

    /// Reassemble all chunks into single result
    pub fn reassemble(&self) -> Result<Vec<u8>> {
        let mut result = Vec::new();

        for chunk in &self.chunks {
            // Decompress if needed
            let data = if let Some(compression) = chunk.compression {
                codec::decompress(&chunk.data, compression)?
            } else {
                chunk.data.clone()
            };

            result.extend_from_slice(&data);
        }

        Ok(result)
    }
}

impl Default for StreamingClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_stream() {
        assert!(!should_stream(512 * 1024)); // 512KB - no streaming
        assert!(should_stream(2 * 1024 * 1024)); // 2MB - streaming
    }

    #[tokio::test]
    async fn test_streaming_response() {
        let (tx, mut rx) = mpsc::channel(10);
        let mut response = StreamingResponse::new(
            Uuid::new_v4(),
            Some(1000),
            CompressionType::None,
            tx,
        );

        // Send chunks
        response.send_chunk(b"Hello ").await.unwrap();
        response.send_chunk(b"World!").await.unwrap();
        response.finish().await.unwrap();

        // Receive chunks
        let chunk1 = rx.recv().await.unwrap();
        assert_eq!(chunk1.sequence, 0);
        assert_eq!(chunk1.data, b"Hello ");
        assert!(!chunk1.is_final);

        let chunk2 = rx.recv().await.unwrap();
        assert_eq!(chunk2.sequence, 1);
        assert_eq!(chunk2.data, b"World!");
        assert!(!chunk2.is_final);

        let final_chunk = rx.recv().await.unwrap();
        assert!(final_chunk.is_final);
    }

    #[tokio::test]
    async fn test_streaming_receiver() {
        let (tx, rx) = mpsc::channel(10);
        let mut receiver = StreamingReceiver::new(Uuid::new_v4(), rx);

        // Send chunks in background
        tokio::spawn(async move {
            tx.send(StreamChunk::new(0, b"Hello ".to_vec(), false)).await.unwrap();
            tx.send(StreamChunk::new(1, b"World!".to_vec(), false)).await.unwrap();
            tx.send(StreamChunk::new(2, Vec::new(), true)).await.unwrap();
        });

        // Receive all
        let result = receiver.receive_all().await.unwrap();
        assert_eq!(result, b"Hello World!");
        assert!(receiver.is_complete());
        assert_eq!(receiver.chunks_received(), 2);
    }

    #[tokio::test]
    async fn test_stream_manager() {
        let manager = StreamManager::new();

        // Create stream
        let (mut response, mut receiver) = manager.create_stream(
            Some(100),
            CompressionType::None,
        ).unwrap();

        assert_eq!(manager.active_streams(), 1);

        // Send and receive data
        tokio::spawn(async move {
            response.send_all(b"Test data").await.unwrap();
            response.finish().await.unwrap();
        });

        let result = receiver.receive_all().await.unwrap();
        assert_eq!(result, b"Test data");

        manager.remove_stream(&receiver.stream_id);
        assert_eq!(manager.active_streams(), 0);
    }

    #[test]
    fn test_streaming_client_backward_compat() {
        let mut client = StreamingClient::new();

        // Add chunks
        client.add_chunk(StreamChunk::new(0, vec![1, 2, 3], false)).unwrap();
        client.add_chunk(StreamChunk::new(1, vec![4, 5, 6], false)).unwrap();
        let is_final = client.add_chunk(StreamChunk::new(2, vec![7, 8, 9], true)).unwrap();

        assert!(is_final);

        // Reassemble
        let result = client.reassemble().unwrap();
        assert_eq!(result, vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    #[tokio::test]
    async fn test_compression_during_streaming() {
        let (tx, mut rx) = mpsc::channel(10);
        let mut response = StreamingResponse::new(
            Uuid::new_v4(),
            None,
            CompressionType::Lz4,
            tx,
        );

        // Send data that's above compression threshold
        let data = vec![b'A'; COMPRESSION_THRESHOLD + 100];
        response.send_chunk(&data).await.unwrap();
        response.finish().await.unwrap();

        // Receive and verify
        let chunk = rx.recv().await.unwrap();
        assert!(chunk.compression.is_some());
        assert!(chunk.data.len() < data.len()); // Should be compressed
    }
}
