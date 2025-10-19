//! Tool registry for mapping tool names to handlers
//!
//! This module provides a registry system that maps tool names to handler functions,
//! supporting dynamic registration, versioning, and capability metadata.

use super::protocol::{RpcRequest, RpcResponse, RpcError, ErrorCode, ResponseMetrics};
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// Tool handler function signature
pub type ToolHandler = Arc<
    dyn Fn(RpcRequest, Arc<ToolContext>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<RpcResponse>> + Send>>
        + Send
        + Sync,
>;

/// Context passed to tool handlers
#[derive(Clone)]
pub struct ToolContext {
    /// Database connection pool
    pub db_pool: Arc<super::db_pool::DatabasePool>,

    /// MCP tool handlers (existing implementation)
    pub mcp_handlers: Arc<crate::mcp::handlers::ToolHandlers>,

    /// Request authentication info
    pub auth_info: Option<AuthInfo>,

    /// Project context (for multi-project support)
    pub project_context: Option<String>,
}

/// Authentication information
#[derive(Debug, Clone)]
pub struct AuthInfo {
    pub token: String,
    pub user_id: String,
    pub permissions: Vec<String>,
}

/// Tool metadata and capabilities
#[derive(Debug, Clone)]
pub struct ToolMetadata {
    /// Tool name (e.g., "code.search_symbols")
    pub name: String,

    /// Tool version (semver)
    pub version: String,

    /// Human-readable description
    pub description: String,

    /// Required capabilities
    pub required_capabilities: Vec<String>,

    /// Optional capabilities
    pub optional_capabilities: Vec<String>,

    /// Supports streaming?
    pub supports_streaming: bool,

    /// Average execution time (milliseconds)
    pub avg_execution_time_ms: u64,

    /// Maximum result size (bytes)
    pub max_result_size: Option<usize>,
}

/// Tool registry for managing handler functions
pub struct ToolRegistry {
    handlers: Arc<RwLock<HashMap<String, ToolHandler>>>,
    metadata: Arc<RwLock<HashMap<String, ToolMetadata>>>,
}

impl ToolRegistry {
    /// Create a new tool registry
    pub fn new() -> Self {
        Self {
            handlers: Arc::new(RwLock::new(HashMap::new())),
            metadata: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a tool handler
    pub async fn register(
        &self,
        name: impl Into<String>,
        metadata: ToolMetadata,
        handler: ToolHandler,
    ) -> Result<()> {
        let name = name.into();

        debug!("Registering tool: {} v{}", name, metadata.version);

        // Validate tool name format
        if !Self::is_valid_tool_name(&name) {
            anyhow::bail!("Invalid tool name: {}", name);
        }

        // Store handler and metadata
        self.handlers.write().await.insert(name.clone(), handler);
        self.metadata.write().await.insert(name.clone(), metadata);

        Ok(())
    }

    /// Unregister a tool handler
    pub async fn unregister(&self, name: &str) -> Result<()> {
        debug!("Unregistering tool: {}", name);

        self.handlers.write().await.remove(name);
        self.metadata.write().await.remove(name);

        Ok(())
    }

    /// Get a tool handler
    pub async fn get_handler(&self, name: &str) -> Option<ToolHandler> {
        self.handlers.read().await.get(name).cloned()
    }

    /// Get tool metadata
    pub async fn get_metadata(&self, name: &str) -> Option<ToolMetadata> {
        self.metadata.read().await.get(name).cloned()
    }

    /// List all registered tools
    pub async fn list_tools(&self) -> Vec<String> {
        self.handlers.read().await.keys().cloned().collect()
    }

    /// Get all tool metadata
    pub async fn list_metadata(&self) -> Vec<ToolMetadata> {
        self.metadata.read().await.values().cloned().collect()
    }

    /// Check if tool exists
    pub async fn has_tool(&self, name: &str) -> bool {
        self.handlers.read().await.contains_key(name)
    }

    /// Validate tool name format (e.g., "code.search_symbols")
    fn is_valid_tool_name(name: &str) -> bool {
        // Must contain at least one dot
        if !name.contains('.') {
            return false;
        }

        // Must only contain alphanumeric, dots, and underscores
        name.chars().all(|c| c.is_alphanumeric() || c == '.' || c == '_')
    }

    /// Register all MCP tools from the existing handlers
    pub async fn register_all_mcp_tools(&self, handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        debug!("Registering all MCP tools...");

        // Code analysis tools
        self.register_code_tools(handlers.clone()).await?;

        // Memory tools
        self.register_memory_tools(handlers.clone()).await?;

        // Progress tracking tools
        self.register_progress_tools(handlers.clone()).await?;

        // Specs tools
        self.register_specs_tools(handlers.clone()).await?;

        // Session tools
        self.register_session_tools(handlers.clone()).await?;

        // Context tools
        self.register_context_tools(handlers.clone()).await?;

        // Documentation tools
        self.register_docs_tools(handlers.clone()).await?;

        // Links tools
        self.register_links_tools(handlers.clone()).await?;

        // Backup tools
        self.register_backup_tools(handlers.clone()).await?;

        // System tools
        self.register_system_tools(handlers.clone()).await?;

        debug!("Registered {} tools", self.list_tools().await.len());

        Ok(())
    }

    // Helper methods to register different tool categories
    async fn register_code_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // code.search_symbols
        self.register(
            "code.search_symbols",
            ToolMetadata {
                name: "code.search_symbols".to_string(),
                version: "1.0.0".to_string(),
                description: "Search for code symbols with semantic understanding".to_string(),
                required_capabilities: vec![],
                optional_capabilities: vec!["streaming".to_string()],
                supports_streaming: false,
                avg_execution_time_ms: 50,
                max_result_size: Some(10 * 1024 * 1024), // 10MB
            },
            Arc::new(move |req, ctx| {
                Box::pin(async move {
                    // Delegate to MCP handler
                    let handlers = &ctx.mcp_handlers;
                    let result = handlers.handle_tool_call(&req.tool, req.params.clone()).await?;

                    Ok(RpcResponse::success(req.id, result))
                })
            }),
        ).await?;

        // code.get_definition
        self.register(
            "code.get_definition",
            ToolMetadata {
                name: "code.get_definition".to_string(),
                version: "1.0.0".to_string(),
                description: "Get full definition of a code symbol".to_string(),
                required_capabilities: vec![],
                optional_capabilities: vec![],
                supports_streaming: false,
                avg_execution_time_ms: 30,
                max_result_size: Some(1 * 1024 * 1024), // 1MB
            },
            Arc::new(move |req, ctx| {
                Box::pin(async move {
                    let result = ctx.mcp_handlers.handle_tool_call(&req.tool, req.params.clone()).await?;
                    Ok(RpcResponse::success(req.id, result))
                })
            }),
        ).await?;

        // More code tools can be registered here...

        Ok(())
    }

    async fn register_memory_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // memory.find_similar_episodes
        self.register(
            "memory.find_similar_episodes",
            ToolMetadata {
                name: "memory.find_similar_episodes".to_string(),
                version: "1.0.0".to_string(),
                description: "Find similar past episodes for learning".to_string(),
                required_capabilities: vec![],
                optional_capabilities: vec![],
                supports_streaming: false,
                avg_execution_time_ms: 100,
                max_result_size: Some(5 * 1024 * 1024), // 5MB
            },
            Arc::new(move |req, ctx| {
                Box::pin(async move {
                    let result = ctx.mcp_handlers.handle_tool_call(&req.tool, req.params.clone()).await?;
                    Ok(RpcResponse::success(req.id, result))
                })
            }),
        ).await?;

        Ok(())
    }

    async fn register_progress_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // progress.create_task
        self.register(
            "progress.create_task",
            ToolMetadata {
                name: "progress.create_task".to_string(),
                version: "1.0.0".to_string(),
                description: "Create a new progress tracking task".to_string(),
                required_capabilities: vec![],
                optional_capabilities: vec![],
                supports_streaming: false,
                avg_execution_time_ms: 20,
                max_result_size: Some(1024), // 1KB
            },
            Arc::new(move |req, ctx| {
                Box::pin(async move {
                    let result = ctx.mcp_handlers.handle_tool_call(&req.tool, req.params.clone()).await?;
                    Ok(RpcResponse::success(req.id, result))
                })
            }),
        ).await?;

        // More progress tools...

        Ok(())
    }

    async fn register_specs_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Specs tools registration
        Ok(())
    }

    async fn register_session_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Session tools registration
        Ok(())
    }

    async fn register_context_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Context tools registration
        Ok(())
    }

    async fn register_docs_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Docs tools registration
        Ok(())
    }

    async fn register_links_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Links tools registration
        Ok(())
    }

    async fn register_backup_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // Backup tools registration
        Ok(())
    }

    async fn register_system_tools(&self, _handlers: Arc<crate::mcp::handlers::ToolHandlers>) -> Result<()> {
        // System tools registration
        Ok(())
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_tool_names() {
        assert!(ToolRegistry::is_valid_tool_name("code.search_symbols"));
        assert!(ToolRegistry::is_valid_tool_name("memory.find_similar_episodes"));
        assert!(ToolRegistry::is_valid_tool_name("progress.create_task"));

        assert!(!ToolRegistry::is_valid_tool_name("invalid"));
        assert!(!ToolRegistry::is_valid_tool_name("invalid-name"));
        assert!(!ToolRegistry::is_valid_tool_name("invalid name"));
    }

    #[tokio::test]
    async fn test_register_and_get_tool() {
        let registry = ToolRegistry::new();

        let metadata = ToolMetadata {
            name: "test.tool".to_string(),
            version: "1.0.0".to_string(),
            description: "Test tool".to_string(),
            required_capabilities: vec![],
            optional_capabilities: vec![],
            supports_streaming: false,
            avg_execution_time_ms: 10,
            max_result_size: None,
        };

        let handler: ToolHandler = Arc::new(move |req, _ctx| {
            Box::pin(async move {
                Ok(RpcResponse::success(req.id, rmpv::Value::Nil))
            })
        });

        registry.register("test.tool", metadata.clone(), handler).await.unwrap();

        assert!(registry.has_tool("test.tool").await);
        assert!(registry.get_handler("test.tool").await.is_some());
        assert!(registry.get_metadata("test.tool").await.is_some());
    }

    #[tokio::test]
    async fn test_list_tools() {
        let registry = ToolRegistry::new();

        let metadata = ToolMetadata {
            name: "test.tool1".to_string(),
            version: "1.0.0".to_string(),
            description: "Test tool 1".to_string(),
            required_capabilities: vec![],
            optional_capabilities: vec![],
            supports_streaming: false,
            avg_execution_time_ms: 10,
            max_result_size: None,
        };

        let handler: ToolHandler = Arc::new(move |req, _ctx| {
            Box::pin(async move {
                Ok(RpcResponse::success(req.id, rmpv::Value::Nil))
            })
        });

        registry.register("test.tool1", metadata.clone(), handler.clone()).await.unwrap();
        registry.register("test.tool2", metadata.clone(), handler).await.unwrap();

        let tools = registry.list_tools().await;
        assert_eq!(tools.len(), 2);
        assert!(tools.contains(&"test.tool1".to_string()));
        assert!(tools.contains(&"test.tool2".to_string()));
    }
}
