//! Thin MCP client that forwards all requests to the global RPC server
//!
//! This is a lightweight MCP server implementation (<20MB memory) that acts as a proxy,
//! forwarding all tool calls to the global server daemon via RPC protocol.
//!
//! # Architecture
//!
//! ```text
//! Claude <--stdio--> Thin Client <--RPC--> Global Server
//!   |                   |                      |
//!   |                   |                      +-- Tool Registry
//!   |                   |                      +-- Database Pool
//!   |                   |                      +-- MCP Handlers
//!   |                   +-- Auto-reconnect
//!   +-- JSON-RPC
//! ```

use crate::rpc::{RpcClient, RpcRequest};
use crate::mcp::transport::{JsonRpcRequest, JsonRpcResponse, JsonRpcError, StdioTransport};
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn, error};

/// Thin MCP client configuration
#[derive(Debug, Clone)]
pub struct ThinClientConfig {
    /// Path to RPC Unix socket
    pub rpc_socket_path: PathBuf,

    /// Project path (for context identification)
    pub project_path: PathBuf,

    /// Auto-reconnect on connection loss
    pub auto_reconnect: bool,

    /// Maximum reconnection attempts
    pub max_reconnect_attempts: u32,

    /// Reconnection delay (milliseconds)
    pub reconnect_delay_ms: u64,
}

impl Default for ThinClientConfig {
    fn default() -> Self {
        use crate::config::get_meridian_home;
        Self {
            rpc_socket_path: get_meridian_home().join("global").join("meridian.sock"),
            project_path: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            auto_reconnect: true,
            max_reconnect_attempts: 5,
            reconnect_delay_ms: 1000,
        }
    }
}

/// Thin MCP client that forwards to RPC server
pub struct ThinMcpClient {
    config: ThinClientConfig,
    rpc_client: Arc<Mutex<Option<RpcClient>>>,
    request_counter: Arc<Mutex<u64>>,
}

impl ThinMcpClient {
    /// Create a new thin MCP client
    pub fn new(config: ThinClientConfig) -> Self {
        Self {
            config,
            rpc_client: Arc::new(Mutex::new(None)),
            request_counter: Arc::new(Mutex::new(1)),
        }
    }

    /// Initialize connection to RPC server
    pub async fn connect(&self) -> Result<()> {
        info!("Connecting to RPC server at {:?}", self.config.rpc_socket_path);

        let socket_url = format!("unix://{}", self.config.rpc_socket_path.display());
        let client = RpcClient::connect(&socket_url)
            .await
            .context("Failed to connect to RPC server")?;

        info!("Connected to RPC server");

        // Store the client
        let mut rpc_client = self.rpc_client.lock().await;
        *rpc_client = Some(client);

        Ok(())
    }

    /// Ensure connection is established (with auto-reconnect)
    async fn ensure_connected(&self) -> Result<()> {
        let rpc_client = self.rpc_client.lock().await;

        if rpc_client.is_none() {
            drop(rpc_client);

            // Try to connect with retries
            let mut attempts = 0;
            loop {
                match self.connect_internal().await {
                    Ok(client) => {
                        let mut rpc_client = self.rpc_client.lock().await;
                        *rpc_client = Some(client);
                        return Ok(());
                    }
                    Err(e) => {
                        attempts += 1;
                        if attempts >= self.config.max_reconnect_attempts {
                            return Err(e).context("Failed to connect after maximum retry attempts");
                        }

                        warn!("Connection attempt {} failed: {}", attempts, e);
                        tokio::time::sleep(tokio::time::Duration::from_millis(
                            self.config.reconnect_delay_ms
                        )).await;
                    }
                }
            }
        }

        Ok(())
    }

    /// Internal connection helper
    async fn connect_internal(&self) -> Result<RpcClient> {
        let socket_url = format!("unix://{}", self.config.rpc_socket_path.display());
        RpcClient::connect(&socket_url).await
    }

    /// Get next request ID
    async fn next_request_id(&self) -> u64 {
        let mut counter = self.request_counter.lock().await;
        let id = *counter;
        *counter += 1;
        id
    }

    /// Handle a single MCP tool call by forwarding to RPC server
    pub async fn handle_tool_call(&self, tool_name: &str, params: Value) -> Result<Value> {
        // Ensure we're connected
        self.ensure_connected().await?;

        debug!("Forwarding tool call: {} with params: {:?}", tool_name, params);

        // Create RPC request
        let request = RpcRequest {
            version: crate::rpc::PROTOCOL_VERSION,
            id: self.next_request_id().await,
            tool: tool_name.to_string(),
            params,
            stream: false,
            max_size: None,
            timeout_ms: Some(30000), // 30 second timeout
            auth: None,
        };

        // Send via RPC
        let response = {
            let rpc_client = self.rpc_client.lock().await;
            if let Some(ref client) = *rpc_client {
                match client.call(request.clone()).await {
                    Ok(response) => response,
                    Err(e) => {
                        // Connection might be lost, try to reconnect
                        if self.config.auto_reconnect {
                            warn!("RPC call failed, attempting to reconnect: {}", e);
                            drop(rpc_client);

                            // Clear connection
                            {
                                let mut rpc_client = self.rpc_client.lock().await;
                                *rpc_client = None;
                            }

                            // Reconnect and retry once
                            self.ensure_connected().await?;

                            let rpc_client = self.rpc_client.lock().await;
                            if let Some(ref client) = *rpc_client {
                                client.call(request).await?
                            } else {
                                bail!("Failed to reconnect to RPC server");
                            }
                        } else {
                            return Err(e).context("RPC call failed");
                        }
                    }
                }
            } else {
                bail!("Not connected to RPC server");
            }
        };

        // Check for error in response
        if let Some(error) = response.error {
            bail!("RPC error: {}", error);
        }

        // Extract result
        response.result
            .ok_or_else(|| anyhow::anyhow!("No result in RPC response"))
    }

    /// Run the thin client as an MCP server (stdio transport)
    pub async fn serve_stdio(&self) -> Result<()> {
        info!("Starting thin MCP client in stdio mode");
        info!("Forwarding all requests to RPC server at {:?}", self.config.rpc_socket_path);

        // Connect to RPC server
        self.connect().await?;

        // Create stdio transport
        let mut transport = StdioTransport::new();

        // Send server capabilities
        let _capabilities = serde_json::json!({
            "capabilities": {
                "tools": {},
                "resources": {},
            },
            "serverInfo": {
                "name": "meridian-thin-client",
                "version": env!("CARGO_PKG_VERSION"),
                "mode": "thin",
            }
        });

        info!("Thin MCP client ready");

        // Main request loop
        loop {
            match transport.recv().await {
                Some(request) => {
                    debug!("Received MCP request: {:?}", request);

                    let response = match self.handle_mcp_request(request.clone()).await {
                        Ok(result) => JsonRpcResponse {
                            jsonrpc: "2.0".to_string(),
                            id: request.id.clone(),
                            result: Some(result),
                            error: None,
                        },
                        Err(e) => {
                            error!("Error handling request: {}", e);
                            JsonRpcResponse {
                                jsonrpc: "2.0".to_string(),
                                id: request.id.clone(),
                                result: None,
                                error: Some(JsonRpcError {
                                    code: -32603,
                                    message: e.to_string(),
                                    data: None,
                                }),
                            }
                        }
                    };

                    if let Err(e) = transport.send(response) {
                        error!("Failed to write response: {}", e);
                        break;
                    }
                }
                None => {
                    debug!("Client closed connection");
                    break;
                }
            }
        }

        info!("Thin MCP client stopped");
        Ok(())
    }

    /// Handle an MCP JSON-RPC request
    async fn handle_mcp_request(&self, request: JsonRpcRequest) -> Result<Value> {
        match request.method.as_str() {
            "initialize" => {
                // Return capabilities
                Ok(serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {},
                        "resources": {},
                    },
                    "serverInfo": {
                        "name": "meridian-thin-client",
                        "version": env!("CARGO_PKG_VERSION"),
                        "mode": "thin",
                    }
                }))
            }
            "tools/list" => {
                // Forward to RPC server to get available tools
                self.handle_tool_call("system.list_tools", serde_json::json!({}))
                    .await
            }
            "tools/call" => {
                // Extract tool name and params
                let params = request.params
                    .ok_or_else(|| anyhow::anyhow!("Missing params for tools/call"))?;

                let tool_name = params.get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("Missing tool name"))?;

                let tool_params = params.get("arguments")
                    .cloned()
                    .unwrap_or(Value::Null);

                // Forward to RPC server
                let result = self.handle_tool_call(tool_name, tool_params).await?;

                Ok(serde_json::json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result)?
                    }]
                }))
            }
            "resources/list" => {
                // Forward to RPC server
                self.handle_tool_call("system.list_resources", serde_json::json!({}))
                    .await
            }
            "ping" => {
                // Quick health check
                Ok(serde_json::json!({}))
            }
            _ => {
                bail!("Unknown method: {}", request.method)
            }
        }
    }

    /// Check if connected to RPC server
    pub async fn is_connected(&self) -> bool {
        let rpc_client = self.rpc_client.lock().await;
        rpc_client.is_some()
    }

    /// Close the connection
    pub async fn close(&self) {
        let mut rpc_client = self.rpc_client.lock().await;
        *rpc_client = None;
        info!("Thin MCP client connection closed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thin_client_config_default() {
        let config = ThinClientConfig::default();
        assert!(config.auto_reconnect);
        assert_eq!(config.max_reconnect_attempts, 5);
    }

    #[tokio::test]
    async fn test_request_id_increment() {
        let config = ThinClientConfig::default();
        let client = ThinMcpClient::new(config);

        let id1 = client.next_request_id().await;
        let id2 = client.next_request_id().await;

        assert_eq!(id2, id1 + 1);
    }
}
