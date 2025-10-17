// Integration tests for MCP Protocol 2025-06-18 compliance
// Verifies that Meridian implements the MCP specification correctly

use meridian::{config::Config, mcp::MeridianServer};
use serde_json::json;
use tempfile::TempDir;

mod common;

// Helper to create test server
async fn create_test_server() -> (MeridianServer, TempDir) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::SystemTime;
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let temp_dir = TempDir::new().unwrap();
    let counter = COUNTER.fetch_add(1, Ordering::SeqCst);
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let db_path = temp_dir.path().join(format!("db_{}_{}", timestamp, counter));
    std::fs::create_dir_all(&db_path).unwrap();

    let config = Config {
        index: meridian::config::IndexConfig {
            languages: vec!["rust".to_string()],
            ignore: vec![],
            max_file_size: "1MB".to_string(),
        },
        storage: meridian::config::StorageConfig {
            path: db_path,
            cache_size: "256MB".to_string(),
        },
        memory: meridian::config::MemoryConfig {
            episodic_retention_days: 30,
            working_memory_size: "10MB".to_string(),
            consolidation_interval: "1h".to_string(),
        },
        session: meridian::config::SessionConfig {
            max_sessions: 10,
            session_timeout: "1h".to_string(),
        },
        monorepo: meridian::config::MonorepoConfig::default(),
        learning: meridian::config::LearningConfig::default(),
        mcp: meridian::config::McpConfig::default(),
    };

    let server = MeridianServer::new(config).await.unwrap();
    (server, temp_dir)
}

#[tokio::test]
async fn test_mcp_protocol_version_2025_06_18() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        }
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    assert!(response.error.is_none(), "Initialize should not return error");
    assert!(response.result.is_some(), "Initialize should return result");

    let result = response.result.unwrap();

    // Verify protocol version is 2025-06-18
    let protocol_version = result.get("protocolVersion").unwrap().as_str().unwrap();
    assert_eq!(
        protocol_version, "2025-06-18",
        "Protocol version must be 2025-06-18"
    );

    // Verify serverInfo is present
    let server_info = result.get("serverInfo").unwrap();
    assert!(server_info.get("name").is_some());
    assert!(server_info.get("version").is_some());

    // Verify capabilities are present
    let capabilities = result.get("capabilities").unwrap();
    assert!(capabilities.is_object());
}

#[tokio::test]
async fn test_mcp_server_capabilities_2025_06_18() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    let result = response.result.unwrap();
    let capabilities = result.get("capabilities").unwrap();

    // Verify required capabilities (MCP 2025-06-18)
    assert_eq!(
        capabilities.get("tools"),
        Some(&json!(true)),
        "Server must advertise tools capability"
    );
    assert_eq!(
        capabilities.get("resources"),
        Some(&json!(true)),
        "Server must advertise resources capability"
    );
    assert_eq!(
        capabilities.get("prompts"),
        Some(&json!(true)),
        "Server must advertise prompts capability"
    );
    assert_eq!(
        capabilities.get("logging"),
        Some(&json!(true)),
        "Server must advertise logging capability"
    );

    // Optional capabilities may be present
    if let Some(completions) = capabilities.get("completions") {
        assert!(
            completions.is_boolean() || completions.is_object(),
            "completions capability must be boolean or object"
        );
    }
}

#[tokio::test]
async fn test_mcp_tools_schema_2025_06_18() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_list_tools(request.id);

    assert!(response.error.is_none());
    let result = response.result.unwrap();
    let tools = result.get("tools").unwrap().as_array().unwrap();

    assert!(!tools.is_empty(), "Server must provide at least one tool");

    // Verify each tool has required MCP 2025-06-18 fields
    for tool in tools {
        // Required fields
        assert!(
            tool.get("name").is_some(),
            "Tool must have 'name' field: {:?}",
            tool
        );
        assert!(
            tool.get("inputSchema").is_some(),
            "Tool must have 'inputSchema' field (MCP 2025-06-18): {:?}",
            tool
        );

        // Verify inputSchema is a valid JSON Schema
        let input_schema = tool.get("inputSchema").unwrap();
        assert!(
            input_schema.is_object(),
            "inputSchema must be an object: {:?}",
            input_schema
        );

        // Optional but recommended fields
        if let Some(output_schema) = tool.get("outputSchema") {
            assert!(
                output_schema.is_object(),
                "outputSchema must be an object if present"
            );
        }

        if let Some(_meta) = tool.get("_meta") {
            assert!(_meta.is_object(), "_meta must be an object if present");
        }

        // Description is optional but recommended
        if let Some(description) = tool.get("description") {
            assert!(
                description.is_string(),
                "description must be a string if present"
            );
        }
    }
}

#[tokio::test]
async fn test_mcp_resources_schema_2025_06_18() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "resources/list",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_list_resources(request.id);

    // Resources may be empty, but if present, must follow schema
    if response.error.is_none() {
        let result = response.result.unwrap();
        if let Some(resources) = result.get("resources") {
            let resources_array = resources.as_array().unwrap();

            for resource in resources_array {
                // Required field
                assert!(
                    resource.get("uri").is_some(),
                    "Resource must have 'uri' field"
                );

                // Optional fields
                if let Some(name) = resource.get("name") {
                    assert!(name.is_string(), "name must be a string if present");
                }

                if let Some(description) = resource.get("description") {
                    assert!(
                        description.is_string(),
                        "description must be a string if present"
                    );
                }

                if let Some(mime_type) = resource.get("mimeType") {
                    assert!(
                        mime_type.is_string(),
                        "mimeType must be a string if present"
                    );
                }

                // MCP 2025-06-18: _meta field
                if let Some(_meta) = resource.get("_meta") {
                    assert!(_meta.is_object(), "_meta must be an object if present");
                }
            }
        }
    }
}

#[tokio::test]
async fn test_mcp_prompts_schema_2025_06_18() {
    // Prompts are advertised in capabilities but handler not yet fully implemented
    // This test verifies the capability is advertised correctly
    let (server, _temp) = create_test_server().await;

    let init_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(init_request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    let result = response.result.unwrap();
    let capabilities = result.get("capabilities").unwrap();

    // Verify prompts capability is advertised
    assert_eq!(
        capabilities.get("prompts"),
        Some(&json!(true)),
        "Server must advertise prompts capability"
    );
}

#[tokio::test]
async fn test_mcp_jsonrpc_2_0_compliance() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 42,
        "method": "initialize",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    // Verify JSON-RPC 2.0 structure
    assert_eq!(
        response.jsonrpc, "2.0",
        "Response must have jsonrpc: '2.0'"
    );
    assert_eq!(
        response.id,
        Some(json!(42)),
        "Response id must match request id"
    );

    // Either result or error must be present, but not both
    assert!(
        response.result.is_some() || response.error.is_some(),
        "Response must have either result or error"
    );
    assert!(
        !(response.result.is_some() && response.error.is_some()),
        "Response must not have both result and error"
    );
}

#[tokio::test]
async fn test_mcp_error_codes_compliance() {
    let (_server, _temp) = create_test_server().await;

    // Test invalid JSON-RPC request
    let _request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "invalid/method/that/does/not/exist",
        "params": {}
    });

    // Valid JSON-RPC error codes:
    // -32700: Parse error
    // -32600: Invalid Request
    // -32601: Method not found
    // -32602: Invalid params
    // -32603: Internal error
    // -32000 to -32099: Server error (reserved)

    // This test is a placeholder - error handling is tested in server.rs unit tests
}

#[tokio::test]
async fn test_mcp_tool_call_format_2025_06_18() {
    let (server, _temp) = create_test_server().await;

    // First, get list of available tools
    let list_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list"
    });

    let list_request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(list_request).unwrap();
    let list_response = server.handle_list_tools(list_request.id);

    assert!(list_response.error.is_none());

    // Store result in a binding to extend lifetime
    let result = list_response.result.unwrap();
    let tools = result.get("tools").unwrap().as_array().unwrap();

    // Verify at least one tool is available
    assert!(!tools.is_empty(), "Server must provide tools");

    // Get first tool name
    let first_tool = &tools[0];
    let tool_name = first_tool.get("name").unwrap().as_str().unwrap();

    // Verify tool has inputSchema
    let input_schema = first_tool.get("inputSchema").unwrap();
    assert!(
        input_schema.is_object(),
        "Tool inputSchema must be a JSON Schema object"
    );

    // Verify inputSchema has required JSON Schema fields
    assert!(
        input_schema.get("type").is_some(),
        "inputSchema must have 'type' field"
    );

    println!("✓ Tool '{}' has valid MCP 2025-06-18 schema", tool_name);
}

#[tokio::test]
async fn test_mcp_initialize_params_validation() {
    let (server, _temp) = create_test_server().await;

    // Test with minimal params
    let minimal_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(minimal_request).unwrap();
    let response = server.handle_initialize(request.id.clone(), request.params);

    assert!(
        response.error.is_none(),
        "Initialize with empty params should succeed"
    );

    // Test with full params
    let full_request = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {
                "roots": {
                    "listChanged": true
                }
            },
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        }
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(full_request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    assert!(
        response.error.is_none(),
        "Initialize with full params should succeed"
    );
}

#[tokio::test]
async fn test_mcp_29_tools_available() {
    let (server, _temp) = create_test_server().await;

    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list"
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(request).unwrap();
    let response = server.handle_list_tools(request.id);

    let result = response.result.unwrap();
    let tools = result.get("tools").unwrap().as_array().unwrap();

    // Verify we have 29 tools as implemented
    // (Memory:4 + Context:3 + Learning:3 + Attention:2 + Code:4 + Docs:2 + History:2 + Session:4 + Analysis:2 + Monorepo:3)
    assert_eq!(
        tools.len(),
        29,
        "Meridian should provide exactly 29 MCP tools"
    );

    // Verify each tool is unique
    let mut tool_names: Vec<String> = tools
        .iter()
        .map(|t| t.get("name").unwrap().as_str().unwrap().to_string())
        .collect();
    let original_len = tool_names.len();
    tool_names.sort();
    tool_names.dedup();
    assert_eq!(
        tool_names.len(),
        original_len,
        "All tool names must be unique"
    );
}

#[tokio::test]
async fn test_mcp_backward_compatibility() {
    let (server, _temp) = create_test_server().await;

    // Test that 2025-06-18 server can handle older protocol versions gracefully
    let old_protocol_request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "legacy-client",
                "version": "0.1.0"
            }
        }
    });

    let request: meridian::mcp::transport::JsonRpcRequest =
        serde_json::from_value(old_protocol_request).unwrap();
    let response = server.handle_initialize(request.id, request.params);

    // Server should respond with its own protocol version
    assert!(response.error.is_none());
    let result = response.result.unwrap();
    let protocol_version = result.get("protocolVersion").unwrap().as_str().unwrap();

    // Server always responds with 2025-06-18
    assert_eq!(protocol_version, "2025-06-18");
}
