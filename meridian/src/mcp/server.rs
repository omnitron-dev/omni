use super::handlers::ToolHandlers;
use super::tools::{get_all_resources, get_all_tools, ServerCapabilities};
use super::transport::{JsonRpcError, JsonRpcRequest, JsonRpcResponse, StdioTransport};
use crate::config::Config;
use crate::context::ContextManager;
use crate::indexer::{CodeIndexer, Indexer};
use crate::memory::MemorySystem;
use crate::session::SessionManager;
use crate::storage::RocksDBStorage;
use crate::types::{LLMAdapter, Query};
use crate::IndexStats;
use anyhow::Result;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};

/// Main Meridian MCP server
pub struct MeridianServer {
    #[allow(dead_code)]
    memory_system: MemorySystem,
    #[allow(dead_code)]
    context_manager: ContextManager,
    indexer: CodeIndexer,
    session_manager: SessionManager,
    config: Config,
    handlers: Option<Arc<ToolHandlers>>,
}

impl MeridianServer {
    /// Create a new Meridian server instance
    pub async fn new(config: Config) -> Result<Self> {
        info!("Initializing Meridian server");

        // Initialize storage
        let storage = Arc::new(RocksDBStorage::new(&config.storage.path)?);

        // Initialize memory system
        let mut memory_system = MemorySystem::new(storage.clone(), config.memory.clone())?;
        memory_system.init().await?;

        // Initialize context manager
        let context_manager = ContextManager::new(LLMAdapter::claude3());

        // Initialize indexer
        let mut indexer = CodeIndexer::new(storage.clone(), config.index.clone())?;
        indexer.load().await?;

        // Initialize session manager
        let session_config = crate::session::SessionConfig {
            max_sessions: config.session.max_sessions,
            timeout: chrono::Duration::hours(1),
            auto_cleanup: true,
        };
        let session_manager = SessionManager::new(storage.clone(), session_config);

        Ok(Self {
            memory_system,
            context_manager,
            indexer,
            session_manager,
            config,
            handlers: None,
        })
    }

    /// Initialize tool handlers
    fn init_handlers(&mut self) -> Arc<ToolHandlers> {
        if let Some(handlers) = &self.handlers {
            return handlers.clone();
        }

        // Move components to create handlers
        // We need to clone the config first
        let storage = Arc::new(
            RocksDBStorage::new(&self.config.storage.path)
                .expect("Failed to create storage"),
        );

        let memory_system = MemorySystem::new(storage.clone(), self.config.memory.clone())
            .expect("Failed to create memory system");

        let context_manager = ContextManager::new(LLMAdapter::claude3());

        let indexer = CodeIndexer::new(storage.clone(), self.config.index.clone())
            .expect("Failed to create indexer");

        let session_config = crate::session::SessionConfig {
            max_sessions: self.config.session.max_sessions,
            timeout: chrono::Duration::hours(1),
            auto_cleanup: true,
        };
        let session_manager = SessionManager::new(storage, session_config);

        let handlers = Arc::new(ToolHandlers::new(
            memory_system,
            context_manager,
            indexer,
            session_manager,
        ));

        self.handlers = Some(handlers.clone());
        handlers
    }

    /// Serve via stdio transport
    pub async fn serve_stdio(&mut self) -> Result<()> {
        info!("Starting MCP server with stdio transport");

        let handlers = self.init_handlers();
        let mut transport = StdioTransport::new();

        info!("Meridian MCP server ready on stdio");

        // Main event loop
        while let Some(request) = transport.recv().await {
            let response = self.handle_request(request.clone(), &handlers).await;
            if let Err(e) = transport.send(response) {
                error!("Failed to send response: {}", e);
                break;
            }
        }

        info!("Stdio transport closed");
        Ok(())
    }

    /// Serve via Unix socket (placeholder)
    pub async fn serve_socket(&self, socket_path: PathBuf) -> Result<()> {
        info!("Starting MCP server with socket transport at {:?}", socket_path);
        warn!("Socket transport not yet implemented");
        Ok(())
    }

    /// Handle a JSON-RPC request
    async fn handle_request(
        &self,
        request: JsonRpcRequest,
        handlers: &Arc<ToolHandlers>,
    ) -> JsonRpcResponse {
        let request_id = request.id.clone();

        match request.method.as_str() {
            "initialize" => self.handle_initialize(request_id, request.params),
            "tools/list" => self.handle_list_tools(request_id),
            "tools/call" => self.handle_call_tool(request_id, request.params, handlers).await,
            "resources/list" => self.handle_list_resources(request_id),
            "resources/read" => self.handle_read_resource(request_id, request.params).await,
            "ping" => JsonRpcResponse::success(request_id, json!({"status": "ok"})),
            _ => JsonRpcResponse::error(
                request_id,
                JsonRpcError::method_not_found(format!("Method not found: {}", request.method)),
            ),
        }
    }

    /// Handle initialize request
    fn handle_initialize(&self, id: Option<Value>, _params: Option<Value>) -> JsonRpcResponse {
        info!("Handling initialize request");

        let result = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": ServerCapabilities::default(),
            "serverInfo": {
                "name": "meridian",
                "version": env!("CARGO_PKG_VERSION")
            }
        });

        JsonRpcResponse::success(id, result)
    }

    /// Handle tools/list request
    fn handle_list_tools(&self, id: Option<Value>) -> JsonRpcResponse {
        info!("Handling tools/list request");

        let tools = get_all_tools();
        let result = json!({ "tools": tools });

        JsonRpcResponse::success(id, result)
    }

    /// Handle tools/call request
    async fn handle_call_tool(
        &self,
        id: Option<Value>,
        params: Option<Value>,
        handlers: &Arc<ToolHandlers>,
    ) -> JsonRpcResponse {
        let params = match params {
            Some(p) => p,
            None => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params("Missing parameters".to_string()),
                )
            }
        };

        // Extract tool name and arguments
        let tool_name = match params.get("name").and_then(|v| v.as_str()) {
            Some(name) => name,
            None => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params("Missing tool name".to_string()),
                )
            }
        };

        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

        info!("Calling tool: {}", tool_name);

        // Call the tool handler
        match handlers.handle_tool_call(tool_name, arguments).await {
            Ok(result) => {
                let response = json!({
                    "content": [
                        {
                            "type": "text",
                            "text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
                        }
                    ]
                });
                JsonRpcResponse::success(id, response)
            }
            Err(e) => {
                error!("Tool call failed: {}", e);
                JsonRpcResponse::error(
                    id,
                    JsonRpcError::internal_error(format!("Tool execution failed: {}", e)),
                )
            }
        }
    }

    /// Handle resources/list request
    fn handle_list_resources(&self, id: Option<Value>) -> JsonRpcResponse {
        info!("Handling resources/list request");

        let resources = get_all_resources();
        let result = json!({ "resources": resources });

        JsonRpcResponse::success(id, result)
    }

    /// Handle resources/read request
    async fn handle_read_resource(
        &self,
        id: Option<Value>,
        params: Option<Value>,
    ) -> JsonRpcResponse {
        let params = match params {
            Some(p) => p,
            None => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params("Missing parameters".to_string()),
                )
            }
        };

        let uri = match params.get("uri").and_then(|v| v.as_str()) {
            Some(uri) => uri,
            None => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params("Missing resource URI".to_string()),
                )
            }
        };

        info!("Reading resource: {}", uri);

        // Handle different resource URIs
        let content = match uri {
            "meridian://index/current" => {
                json!({
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json!({
                        "status": "active",
                        "total_symbols": 0,
                        "total_files": 0
                    }).to_string()
                })
            }
            "meridian://memory/episodes" => {
                json!({
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json!({
                        "episodes": []
                    }).to_string()
                })
            }
            "meridian://memory/working" => {
                json!({
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json!({
                        "active_symbols": [],
                        "token_count": 0
                    }).to_string()
                })
            }
            "meridian://sessions/active" => {
                let sessions = self.session_manager.list_sessions();
                json!({
                    "uri": uri,
                    "mimeType": "application/json",
                    "text": json!({
                        "sessions": sessions.iter().map(|s| {
                            json!({
                                "id": s.id.0,
                                "task": s.task_description,
                                "started_at": s.started_at.to_rfc3339()
                            })
                        }).collect::<Vec<_>>()
                    }).to_string()
                })
            }
            _ => {
                return JsonRpcResponse::error(
                    id,
                    JsonRpcError::invalid_params(format!("Unknown resource: {}", uri)),
                )
            }
        };

        JsonRpcResponse::success(id, json!({ "contents": [content] }))
    }

    // === Non-MCP utility methods ===

    /// Index a project
    pub async fn index_project(&mut self, path: PathBuf, force: bool) -> Result<()> {
        self.indexer.index_project(&path, force).await
    }

    /// Query the index
    pub async fn query(&self, query_text: &str, limit: usize) -> Result<Vec<String>> {
        let query = Query::new(query_text.to_string());
        let results = self.indexer.search_symbols(&query).await?;

        Ok(results
            .symbols
            .iter()
            .take(limit)
            .map(|s| format!("{} ({})", s.name, s.kind.as_str()))
            .collect())
    }

    /// Get statistics
    pub async fn get_stats(&self) -> Result<IndexStats> {
        // TODO: Collect actual statistics from components
        Ok(IndexStats::empty())
    }

    /// Initialize a new index
    pub async fn initialize(&self, _path: PathBuf) -> Result<()> {
        info!("Initializing new index");
        // TODO: Create index structure
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

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
            index: crate::config::IndexConfig {
                languages: vec!["rust".to_string()],
                ignore: vec![],
                max_file_size: "1MB".to_string(),
            },
            storage: crate::config::StorageConfig {
                path: db_path,
                cache_size: "256MB".to_string(),
            },
            memory: crate::config::MemoryConfig {
                episodic_retention_days: 30,
                working_memory_size: "10MB".to_string(),
                consolidation_interval: "1h".to_string(),
            },
            session: crate::config::SessionConfig {
                max_sessions: 10,
                session_timeout: "1h".to_string(),
            },
            monorepo: crate::config::MonorepoConfig::default(),
            learning: crate::config::LearningConfig::default(),
            mcp: crate::config::McpConfig::default(),
        };

        let server = MeridianServer::new(config).await.unwrap();
        (server, temp_dir)
    }

    #[tokio::test]
    async fn test_server_initialization() {
        let (_server, _temp) = create_test_server().await;
        // Server should initialize without errors
    }

    #[tokio::test]
    async fn test_initialize_request() {
        let (server, _temp) = create_test_server().await;

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "initialize".to_string(),
            params: Some(json!({})),
        };

        // Test initialize request directly - no handlers needed
        let response = server.handle_initialize(request.id, request.params);

        assert!(response.result.is_some());
        assert!(response.error.is_none());
    }

    #[tokio::test]
    async fn test_list_tools_request() {
        let (server, _temp) = create_test_server().await;

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "tools/list".to_string(),
            params: None,
        };

        // Test list_tools request directly - no handlers needed
        let response = server.handle_list_tools(request.id);

        assert!(response.result.is_some());

        let result = response.result.unwrap();
        let tools = result.get("tools").unwrap().as_array().unwrap();
        assert!(tools.len() > 0);
    }

    #[tokio::test]
    async fn test_unknown_method() {
        let (server, _temp) = create_test_server().await;

        // Create a dummy handler just for testing unknown method
        // We use a minimal config with a different path to avoid RocksDB conflicts
        let temp_handlers_dir = _temp.path().join("handlers");
        std::fs::create_dir_all(&temp_handlers_dir).unwrap();

        let storage = Arc::new(RocksDBStorage::new(&temp_handlers_dir).unwrap());
        let memory_system = MemorySystem::new(storage.clone(), server.config.memory.clone()).unwrap();
        let context_manager = ContextManager::new(LLMAdapter::claude3());
        let indexer = CodeIndexer::new(storage.clone(), server.config.index.clone()).unwrap();
        let session_config = crate::session::SessionConfig {
            max_sessions: 10,
            timeout: chrono::Duration::hours(1),
            auto_cleanup: true,
        };
        let session_manager = SessionManager::new(storage, session_config);
        let handlers = Arc::new(ToolHandlers::new(
            memory_system,
            context_manager,
            indexer,
            session_manager,
        ));

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: "unknown/method".to_string(),
            params: None,
        };

        let response = server.handle_request(request, &handlers).await;

        assert!(response.error.is_some());
        let error = response.error.unwrap();
        assert_eq!(error.code, -32601); // Method not found
    }
}
