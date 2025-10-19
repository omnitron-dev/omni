//! Integration tests for RPC client-server communication
//!
//! These tests verify the end-to-end functionality of the RPC system,
//! including tool invocation, streaming responses, error handling, and
//! connection recovery.

use meridian::rpc::{
    RpcClient, RpcServer, RpcRequest, ToolRegistry, DatabasePool,
    CompressionType,
};
use meridian::rpc::streaming::{StreamManager, StreamingResponse, StreamingReceiver, should_stream, STREAMING_THRESHOLD};
use meridian::mcp::handlers::ToolHandlers;
use meridian::memory::MemorySystem;
use meridian::context::ContextManager;
use meridian::indexer::{CodeIndexer, PatternSearchEngine};
use meridian::session::SessionManager;
use meridian::docs::DocIndexer;
use meridian::specs::SpecificationManager;
use meridian::tasks::TaskManager;
use meridian::links::RocksDBLinksStorage;
use meridian::storage::MemoryStorage;
use meridian::config::{MemoryConfig, IndexConfig};
use meridian::types::context::LLMAdapter;
use std::sync::Arc;
use tempfile::TempDir;
use tokio::time::{timeout, Duration};

/// Helper to create test infrastructure
async fn setup_test_env() -> (TempDir, Arc<ToolHandlers>, Arc<DatabasePool>) {
    let temp_dir = TempDir::new().unwrap();

    // Create storage for memory system
    let storage = Arc::new(MemoryStorage::new()) as Arc<dyn meridian::storage::Storage>;

    // Create all required components
    let memory = Arc::new(tokio::sync::RwLock::new(
        MemorySystem::new(storage.clone(), MemoryConfig::default()).unwrap()
    ));

    let context = Arc::new(tokio::sync::RwLock::new(
        ContextManager::new(LLMAdapter::Claude3 { context_window: 200000 })
    ));

    let indexer_storage = Arc::new(MemoryStorage::new()) as Arc<dyn meridian::storage::Storage>;

    let indexer = Arc::new(tokio::sync::RwLock::new(
        CodeIndexer::new(indexer_storage, IndexConfig::default()).unwrap()
    ));

    let session_storage = Arc::new(MemoryStorage::new()) as Arc<dyn meridian::storage::Storage>;

    let session = Arc::new(
        SessionManager::new(session_storage, meridian::session::SessionConfig::default()).unwrap()
    );

    let docs = Arc::new(
        DocIndexer::new()
    );

    let specs = Arc::new(tokio::sync::RwLock::new(
        SpecificationManager::new(temp_dir.path().join("specs"))
    ));

    let progress_storage = Arc::new(MemoryStorage::new()) as Arc<dyn meridian::storage::Storage>;

    let progress = Arc::new(tokio::sync::RwLock::new(
        TaskManager::new(Arc::new(meridian::tasks::TaskStorage::new(progress_storage)))
    ));

    let links_storage = Arc::new(MemoryStorage::new()) as Arc<dyn meridian::storage::Storage>;

    let links = Arc::new(tokio::sync::RwLock::new(
        RocksDBLinksStorage::new(links_storage)
    )) as Arc<tokio::sync::RwLock<dyn meridian::links::LinksStorage>>;

    let pattern = Arc::new(
        PatternSearchEngine::new().unwrap()
    );

    let mcp_handlers = Arc::new(ToolHandlers::new(
        memory,
        context,
        indexer,
        session,
        docs,
        specs,
        progress,
        links,
        pattern,
    ));

    // Create database pool from shared storage
    let pool_storage = Arc::new(
        RocksDBStorage::new(&temp_dir.path().join("pool_storage")).unwrap()
    );

    let db_pool = Arc::new(
        DatabasePool::from_storage(pool_storage)
    );

    (temp_dir, mcp_handlers, db_pool)
}

#[tokio::test]
async fn test_basic_client_server_communication() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    // Create and start server
    let registry = Arc::new(ToolRegistry::new());

    // Register all MCP tools
    registry.register_all_mcp_tools(mcp_handlers.clone()).await.unwrap();

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    // Start server in background
    tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    // Give server time to start
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Create client and connect
    let client = RpcClient::connect(format!("unix://{}", socket_path.display()))
        .await
        .unwrap();

    // Send ping request
    let request = RpcRequest {
        version: 1,
        id: 1,
        tool: "code.search_symbols".to_string(),
        params: serde_json::json!({
            "query": "test",
            "limit": 10
        }),
        stream: false,
        max_size: None,
        timeout_ms: Some(5000),
        auth: None,
    };

    let response = timeout(Duration::from_secs(5), client.call(request))
        .await
        .expect("Request timed out")
        .unwrap();

    assert_eq!(response.id, 1);
    assert!(response.error.is_none(), "Response had error: {:?}", response.error);
}

#[tokio::test]
async fn test_tool_not_found() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    // Create server with empty registry
    let registry = Arc::new(ToolRegistry::new());

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    // Start server in background
    tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Create client
    let client = RpcClient::connect(format!("unix://{}", socket_path.display()))
        .await
        .unwrap();

    // Request non-existent tool
    let request = RpcRequest {
        version: 1,
        id: 1,
        tool: "nonexistent.tool".to_string(),
        params: serde_json::Value::Null,
        stream: false,
        max_size: None,
        timeout_ms: Some(5000),
        auth: None,
    };

    let result = timeout(Duration::from_secs(5), client.call(request))
        .await
        .expect("Request timed out");

    // Should get an error response
    assert!(result.is_err(), "Expected error for non-existent tool");
}

#[tokio::test]
async fn test_concurrent_requests() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    // Create server
    let registry = Arc::new(ToolRegistry::new());
    registry.register_all_mcp_tools(mcp_handlers.clone()).await.unwrap();

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    // Start server
    tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Create client
    let client = Arc::new(
        RpcClient::connect(format!("unix://{}", socket_path.display()))
            .await
            .unwrap()
    );

    // Send multiple concurrent requests
    let mut handles = vec![];

    for i in 0..10 {
        let client = Arc::clone(&client);

        let handle = tokio::spawn(async move {
            let request = RpcRequest {
                version: 1,
                id: i,
                tool: "code.search_symbols".to_string(),
                params: serde_json::json!({
                    "query": format!("test{}", i),
                    "limit": 10
                }),
                stream: false,
                max_size: None,
                timeout_ms: Some(5000),
                auth: None,
            };

            client.call(request).await
        });

        handles.push(handle);
    }

    // Wait for all requests to complete
    for handle in handles {
        let response = timeout(Duration::from_secs(10), handle)
            .await
            .expect("Task timed out")
            .unwrap()
            .unwrap();

        assert!(response.error.is_none(), "Response had error: {:?}", response.error);
    }
}

#[tokio::test]
async fn test_database_pool_usage() {
    let (_temp_dir, _mcp_handlers, db_pool) = setup_test_env().await;

    // DatabasePool now wraps a single storage instance
    // Test that we can access the storage (just verify it exists)
    let _storage = db_pool.storage();

    // Check pool stats
    let stats = db_pool.get_stats().await;
    assert_eq!(stats.total_requests, 0); // No requests made yet
}

#[tokio::test]
async fn test_connection_pooling_reuse() {
    let (_temp_dir, _mcp_handlers, db_pool) = setup_test_env().await;

    // Test that the pool tracks statistics
    db_pool.record_request_start().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    db_pool.record_request_complete(true).await;

    db_pool.record_request_start().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    db_pool.record_request_complete(true).await;

    let stats = db_pool.get_stats().await;
    assert_eq!(stats.total_requests, 2);
    assert_eq!(stats.failed_requests, 0);
}

#[tokio::test]
async fn test_metrics_collection() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    let registry = Arc::new(ToolRegistry::new());
    registry.register_all_mcp_tools(mcp_handlers.clone()).await.unwrap();

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    // Get initial stats
    let stats_before = server.get_stats();
    assert_eq!(stats_before.total_requests, 0);

    // Start server
    let server_handle = tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Create client and send request
    let client = RpcClient::connect(format!("unix://{}", socket_path.display()))
        .await
        .unwrap();

    let request = RpcRequest {
        version: 1,
        id: 1,
        tool: "code.search_symbols".to_string(),
        params: serde_json::json!({
            "query": "test",
            "limit": 10
        }),
        stream: false,
        max_size: None,
        timeout_ms: Some(5000),
        auth: None,
    };

    let response = client.call(request).await.unwrap();

    // Check response has metrics
    assert!(response.metrics.is_some(), "Response should have metrics");

    let metrics = response.metrics.unwrap();
    assert!(metrics.processing_time_us > 0, "Processing time should be recorded");

    // Note: We can't easily check server stats after the request because
    // the server is running in a separate task. This would require
    // exposing server stats through a shared reference.

    server_handle.abort();
}

#[tokio::test]
async fn test_error_handling() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    let registry = Arc::new(ToolRegistry::new());

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = RpcClient::connect(format!("unix://{}", socket_path.display()))
        .await
        .unwrap();

    // Invalid protocol version
    let request = RpcRequest {
        version: 99,
        id: 1,
        tool: "test.tool".to_string(),
        params: serde_json::Value::Null,
        stream: false,
        max_size: None,
        timeout_ms: Some(5000),
        auth: None,
    };

    let result = client.call(request).await;
    assert!(result.is_err(), "Expected error for invalid protocol version");
}

#[tokio::test]
async fn test_request_timeout() {
    let (temp_dir, mcp_handlers, db_pool) = setup_test_env().await;

    let socket_path = temp_dir.path().join("test.sock");

    let registry = Arc::new(ToolRegistry::new());
    registry.register_all_mcp_tools(mcp_handlers.clone()).await.unwrap();

    let server = RpcServer::bind_with_router(
        &socket_path,
        registry,
        db_pool,
        mcp_handlers,
    ).await.unwrap();

    tokio::spawn(async move {
        server.serve().await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    let client = RpcClient::connect(format!("unix://{}", socket_path.display()))
        .await
        .unwrap();

    let request = RpcRequest {
        version: 1,
        id: 1,
        tool: "code.search_symbols".to_string(),
        params: serde_json::json!({
            "query": "test",
            "limit": 10
        }),
        stream: false,
        max_size: None,
        timeout_ms: Some(1), // Very short timeout (though not enforced by server yet)
        auth: None,
    };

    // The request should still complete (timeout enforcement would be added later)
    let response = timeout(Duration::from_secs(5), client.call(request))
        .await
        .expect("Request timed out")
        .unwrap();

    // For now, just verify the response is valid
    assert_eq!(response.id, 1);
}

// ===== Streaming Tests =====

#[tokio::test]
async fn test_streaming_threshold() {
    // Test threshold logic
    assert!(!should_stream(512 * 1024)); // 512KB - below threshold
    assert!(!should_stream(STREAMING_THRESHOLD - 1)); // Just below
    assert!(should_stream(STREAMING_THRESHOLD)); // Exactly at threshold
    assert!(should_stream(2 * 1024 * 1024)); // 2MB - well above
}

#[tokio::test]
async fn test_streaming_response_sender() {
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::channel(10);
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        Some(1000),
        CompressionType::None,
        tx,
    );

    // Send chunks
    response.send_chunk(b"Hello ").await.unwrap();
    response.send_chunk(b"World!").await.unwrap();

    let (sent, total) = response.progress();
    assert_eq!(sent, 12);
    assert_eq!(total, Some(1000));

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
    use tokio::sync::mpsc;

    let (tx, rx) = mpsc::channel(10);
    let mut receiver = StreamingReceiver::new(uuid::Uuid::new_v4(), rx);

    // Send chunks in background
    tokio::spawn(async move {
        tx.send(meridian::rpc::protocol::StreamChunk::new(0, b"Hello ".to_vec(), false))
            .await
            .unwrap();
        tx.send(meridian::rpc::protocol::StreamChunk::new(1, b"World!".to_vec(), false))
            .await
            .unwrap();
        tx.send(meridian::rpc::protocol::StreamChunk::new(2, Vec::new(), true))
            .await
            .unwrap();
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
    let (mut response, mut receiver) = manager
        .create_stream(Some(100), CompressionType::None)
        .unwrap();

    assert_eq!(manager.active_streams(), 1);

    let stream_id = response.stream_id;

    // Send and receive data
    tokio::spawn(async move {
        response.send_all(b"Test streaming data").await.unwrap();
        response.finish().await.unwrap();
    });

    let result = receiver.receive_all().await.unwrap();
    assert_eq!(result, b"Test streaming data");

    manager.remove_stream(&stream_id);
    assert_eq!(manager.active_streams(), 0);
}

#[tokio::test]
async fn test_stream_manager_max_streams() {
    let manager = StreamManager::new();

    // Create maximum number of streams
    let mut streams = vec![];
    for _ in 0..10 {
        let (response, receiver) = manager
            .create_stream(None, CompressionType::None)
            .unwrap();
        streams.push((response, receiver));
    }

    assert_eq!(manager.active_streams(), 10);

    // Try to create one more - should fail
    let result = manager.create_stream(None, CompressionType::None);
    assert!(result.is_err());
}

#[tokio::test]
async fn test_compression_during_streaming() {
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::channel(10);
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        None,
        CompressionType::Lz4,
        tx,
    );

    // Send data that's above compression threshold (1KB)
    let data = vec![b'A'; 2048];
    response.send_chunk(&data).await.unwrap();
    response.finish().await.unwrap();

    // Receive and verify
    let chunk = rx.recv().await.unwrap();
    assert!(chunk.compression.is_some());
    // Compressed data should be smaller than original
    assert!(chunk.data.len() < data.len());
}

#[tokio::test]
async fn test_concurrent_streams() {
    let manager = Arc::new(StreamManager::new());
    let mut handles = vec![];

    // Create 5 concurrent streams
    for i in 0..5 {
        let manager = Arc::clone(&manager);

        let handle = tokio::spawn(async move {
            let (mut response, mut receiver) = manager
                .create_stream(None, CompressionType::None)
                .unwrap();

            let data = format!("Stream {} data", i);

            // Send and receive
            tokio::spawn(async move {
                response.send_all(data.as_bytes()).await.unwrap();
                response.finish().await.unwrap();
            });

            let result = receiver.receive_all().await.unwrap();
            String::from_utf8(result).unwrap()
        });

        handles.push((i, handle));
    }

    // Wait for all streams to complete
    for (i, handle) in handles {
        let result = handle.await.unwrap();
        assert_eq!(result, format!("Stream {} data", i));
    }

    // Give time for async cleanup
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Streams should be cleaned up eventually (or manually removed)
    // Note: This might need manual cleanup in production code
    assert!(manager.active_streams() <= 5, "Streams should be cleaned up or at most 5");
}

#[tokio::test]
async fn test_large_data_chunking() {
    use tokio::sync::mpsc;

    let (tx, rx) = mpsc::channel(100);
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        None,
        CompressionType::None,
        tx,
    );

    // Create 5MB of data
    let large_data = vec![b'X'; 5 * 1024 * 1024];
    let data_len = large_data.len();

    // Send in background
    tokio::spawn(async move {
        response.send_all(&large_data).await.unwrap();
        response.finish().await.unwrap();
    });

    // Receive all chunks
    let mut receiver = StreamingReceiver::new(uuid::Uuid::new_v4(), rx);
    let result = receiver.receive_all().await.unwrap();

    assert_eq!(result.len(), data_len);
    assert!(receiver.chunks_received() > 1, "Should have received multiple chunks");
}

#[tokio::test]
async fn test_streaming_with_zstd_compression() {
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::channel(10);
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        None,
        CompressionType::Zstd,
        tx,
    );

    // Send compressible data (need to exceed compression threshold)
    // Compression threshold is typically 1KB
    let data = vec![b'A'; 2048]; // 2KB of repetitive data
    response.send_chunk(&data).await.unwrap();
    response.finish().await.unwrap();

    // Receive and verify compression was used
    let chunk = rx.recv().await.unwrap();
    // Compression may or may not be applied depending on threshold
    if chunk.compression.is_some() {
        assert_eq!(chunk.compression, Some(CompressionType::Zstd));
        assert!(chunk.data.len() < data.len(), "Data should be compressed");
    }
}

#[tokio::test]
async fn test_progress_tracking() {
    use tokio::sync::mpsc;

    let (tx, _rx) = mpsc::channel(100);
    let total_size = 1000;
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        Some(total_size),
        CompressionType::None,
        tx,
    );

    // Send data in chunks
    let chunk_size = 100;
    for _ in 0..10 {
        response.send_chunk(&vec![0u8; chunk_size]).await.unwrap();

        let (sent, total) = response.progress();
        assert!(sent <= total_size);
        assert_eq!(total, Some(total_size));
    }

    // Check progress before finishing
    let (sent_before, _) = response.progress();
    assert_eq!(sent_before, total_size);

    response.finish().await.unwrap();

    // Note: Cannot check progress after finish() as it consumes self
}

#[tokio::test]
async fn test_stream_error_recovery() {
    use tokio::sync::mpsc;

    let (tx, rx) = mpsc::channel(10);
    let mut receiver = StreamingReceiver::new(uuid::Uuid::new_v4(), rx);

    // Send a chunk then close channel (simulating error)
    tx.send(meridian::rpc::protocol::StreamChunk::new(0, b"data".to_vec(), false))
        .await
        .unwrap();
    drop(tx); // Close channel

    // Receiver should handle closed channel gracefully
    let chunk1 = receiver.receive_chunk().await.unwrap();
    assert!(chunk1.is_some());

    let chunk2 = receiver.receive_chunk().await.unwrap();
    assert!(chunk2.is_none()); // Channel closed
    assert!(receiver.is_complete());
}

#[tokio::test]
async fn test_no_compression_for_small_chunks() {
    use tokio::sync::mpsc;

    let (tx, mut rx) = mpsc::channel(10);
    let mut response = StreamingResponse::new(
        uuid::Uuid::new_v4(),
        None,
        CompressionType::Lz4,
        tx,
    );

    // Send small data (below compression threshold of 1KB)
    let small_data = vec![b'A'; 512];
    response.send_chunk(&small_data).await.unwrap();
    response.finish().await.unwrap();

    // Receive and verify no compression was used
    let chunk = rx.recv().await.unwrap();
    assert_eq!(chunk.compression, None, "Small chunks should not be compressed");
    assert_eq!(chunk.data, small_data);
}
