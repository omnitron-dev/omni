//! JSON encoding/decoding for RPC protocol
//!
//! This module handles serialization and deserialization of RPC messages
//! using JSON format with optional compression.

use super::protocol::{RpcRequest, RpcResponse, CompressionType};
use anyhow::{Context, Result, bail};
use std::io::{Read, Write};

/// Frame header size (4 bytes for length)
pub const FRAME_HEADER_SIZE: usize = 4;

/// Maximum uncompressed message size (10MB)
pub const MAX_MESSAGE_SIZE: usize = 10 * 1024 * 1024;

/// Encode RPC request to bytes
pub fn encode_request(request: &RpcRequest) -> Result<Vec<u8>> {
    let payload = serde_json::to_vec(request)
        .context("Failed to serialize RPC request")?;

    frame_message(&payload)
}

/// Decode RPC request from bytes
pub fn decode_request(bytes: &[u8]) -> Result<RpcRequest> {
    let payload = unframe_message(bytes)?;

    serde_json::from_slice(&payload)
        .context("Failed to deserialize RPC request")
}

/// Encode RPC response to bytes
pub fn encode_response(response: &RpcResponse) -> Result<Vec<u8>> {
    let payload = serde_json::to_vec(response)
        .context("Failed to serialize RPC response")?;

    frame_message(&payload)
}

/// Decode RPC response from bytes
pub fn decode_response(bytes: &[u8]) -> Result<RpcResponse> {
    let payload = unframe_message(bytes)?;

    serde_json::from_slice(&payload)
        .context("Failed to deserialize RPC response")
}

/// Frame a message with length header
///
/// Format: [length (4 bytes, little-endian)] [payload (N bytes)]
fn frame_message(payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() > MAX_MESSAGE_SIZE {
        bail!("Message too large: {} bytes (max: {})", payload.len(), MAX_MESSAGE_SIZE);
    }

    let mut framed = Vec::with_capacity(FRAME_HEADER_SIZE + payload.len());

    // Write length header (little-endian)
    framed.extend_from_slice(&(payload.len() as u32).to_le_bytes());

    // Write payload
    framed.extend_from_slice(payload);

    Ok(framed)
}

/// Unframe a message (extract payload from frame)
fn unframe_message(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < FRAME_HEADER_SIZE {
        bail!("Invalid frame: too short ({} bytes)", bytes.len());
    }

    // Read length header
    let length = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;

    if length > MAX_MESSAGE_SIZE {
        bail!("Message too large: {} bytes (max: {})", length, MAX_MESSAGE_SIZE);
    }

    if bytes.len() < FRAME_HEADER_SIZE + length {
        bail!(
            "Incomplete frame: expected {} bytes, got {} bytes",
            FRAME_HEADER_SIZE + length,
            bytes.len()
        );
    }

    // Extract payload
    Ok(bytes[FRAME_HEADER_SIZE..FRAME_HEADER_SIZE + length].to_vec())
}

/// Compress data using LZ4
pub fn compress_lz4(data: &[u8]) -> Result<Vec<u8>> {
    let mut compressed = Vec::new();
    let mut encoder = lz4::EncoderBuilder::new()
        .level(1) // Fast compression
        .build(&mut compressed)
        .context("Failed to create LZ4 encoder")?;

    encoder.write_all(data)
        .context("Failed to write to LZ4 encoder")?;

    let (_output, result) = encoder.finish();
    result.context("Failed to finish LZ4 compression")?;

    Ok(compressed)
}

/// Decompress LZ4 data
pub fn decompress_lz4(compressed: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = lz4::Decoder::new(compressed)
        .context("Failed to create LZ4 decoder")?;

    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)
        .context("Failed to decompress LZ4 data")?;

    Ok(decompressed)
}

/// Compress data using Zstd
pub fn compress_zstd(data: &[u8]) -> Result<Vec<u8>> {
    zstd::encode_all(data, 3) // Level 3 for balanced speed/compression
        .context("Failed to compress with Zstd")
}

/// Decompress Zstd data
pub fn decompress_zstd(compressed: &[u8]) -> Result<Vec<u8>> {
    zstd::decode_all(compressed)
        .context("Failed to decompress Zstd data")
}

/// Compress data using specified algorithm
pub fn compress(data: &[u8], compression: CompressionType) -> Result<Vec<u8>> {
    match compression {
        CompressionType::None => Ok(data.to_vec()),
        CompressionType::Lz4 => compress_lz4(data),
        CompressionType::Zstd => compress_zstd(data),
    }
}

/// Decompress data using specified algorithm
pub fn decompress(compressed: &[u8], compression: CompressionType) -> Result<Vec<u8>> {
    match compression {
        CompressionType::None => Ok(compressed.to_vec()),
        CompressionType::Lz4 => decompress_lz4(compressed),
        CompressionType::Zstd => decompress_zstd(compressed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::protocol::RpcError;

    #[test]
    fn test_frame_unframe() {
        let payload = b"Hello, World!";
        let framed = frame_message(payload).unwrap();

        // Check framed format
        assert_eq!(framed.len(), FRAME_HEADER_SIZE + payload.len());

        // Check length header
        let length = u32::from_le_bytes([framed[0], framed[1], framed[2], framed[3]]);
        assert_eq!(length as usize, payload.len());

        // Unframe and verify
        let unframed = unframe_message(&framed).unwrap();
        assert_eq!(&unframed[..], payload);
    }

    #[test]
    fn test_encode_decode_request() {
        let request = RpcRequest {
            version: 1,
            id: 123,
            tool: "test.tool".to_string(),
            params: serde_json::json!(null),
            stream: false,
            max_size: None,
            timeout_ms: Some(5000),
            auth: None,
        };

        let encoded = encode_request(&request).unwrap();
        let decoded = decode_request(&encoded).unwrap();

        assert_eq!(decoded.version, request.version);
        assert_eq!(decoded.id, request.id);
        assert_eq!(decoded.tool, request.tool);
        assert_eq!(decoded.stream, request.stream);
    }

    #[test]
    fn test_encode_decode_response() {
        let response = RpcResponse::success(456, serde_json::json!("test result"));

        let encoded = encode_response(&response).unwrap();
        let decoded = decode_response(&encoded).unwrap();

        assert_eq!(decoded.id, 456);
        assert!(decoded.result.is_some());
        assert!(decoded.error.is_none());
    }

    #[test]
    fn test_encode_decode_error_response() {
        let error = RpcError::not_found("Test not found");
        let response = RpcResponse::error(789, error);

        let encoded = encode_response(&response).unwrap();
        let decoded = decode_response(&encoded).unwrap();

        assert_eq!(decoded.id, 789);
        assert!(decoded.result.is_none());
        assert!(decoded.error.is_some());
    }

    #[test]
    fn test_compress_decompress_lz4() {
        let data = b"This is a test message that should compress well because it has repetition repetition repetition";

        let compressed = compress_lz4(data).unwrap();
        assert!(compressed.len() < data.len()); // Should be smaller

        let decompressed = decompress_lz4(&compressed).unwrap();
        assert_eq!(&decompressed[..], data);
    }

    #[test]
    fn test_message_too_large() {
        let large_payload = vec![0u8; MAX_MESSAGE_SIZE + 1];
        let result = frame_message(&large_payload);
        assert!(result.is_err());
    }

    #[test]
    fn test_incomplete_frame() {
        let incomplete = vec![10, 0, 0, 0, 1, 2]; // Says 10 bytes, only has 2
        let result = unframe_message(&incomplete);
        assert!(result.is_err());
    }

    #[test]
    fn test_compress_decompress_zstd() {
        let data = b"This is a test message for Zstd compression with repetition repetition repetition";

        let compressed = compress_zstd(data).unwrap();
        assert!(compressed.len() < data.len()); // Should be smaller

        let decompressed = decompress_zstd(&compressed).unwrap();
        assert_eq!(&decompressed[..], data);
    }

    #[test]
    fn test_compress_decompress_with_type() {
        let data = b"Test data for compression";

        // Test LZ4
        let compressed_lz4 = compress(data, CompressionType::Lz4).unwrap();
        let decompressed_lz4 = decompress(&compressed_lz4, CompressionType::Lz4).unwrap();
        assert_eq!(&decompressed_lz4[..], data);

        // Test Zstd
        let compressed_zstd = compress(data, CompressionType::Zstd).unwrap();
        let decompressed_zstd = decompress(&compressed_zstd, CompressionType::Zstd).unwrap();
        assert_eq!(&decompressed_zstd[..], data);

        // Test None
        let uncompressed = compress(data, CompressionType::None).unwrap();
        assert_eq!(&uncompressed[..], data);
    }
}
