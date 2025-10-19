//! RPC router for handling requests
//!
//! This module provides request routing to appropriate tool handlers,
//! parameter validation, request context management, and middleware support.

use super::protocol::{RpcRequest, RpcResponse, RpcError, ErrorCode, ResponseMetrics};
use super::tool_registry::{ToolRegistry, ToolContext, AuthInfo};
use super::db_pool::DatabasePool;
use anyhow::Result;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, warn, error};

/// Request middleware trait
#[async_trait::async_trait]
pub trait Middleware: Send + Sync {
    /// Process request before routing
    async fn before_request(&self, request: &mut RpcRequest) -> Result<()>;

    /// Process response after routing
    async fn after_request(&self, request: &RpcRequest, response: &mut RpcResponse) -> Result<()>;
}

/// Logging middleware
pub struct LoggingMiddleware;

#[async_trait::async_trait]
impl Middleware for LoggingMiddleware {
    async fn before_request(&self, request: &mut RpcRequest) -> Result<()> {
        debug!(
            "Incoming request: id={} tool={} stream={}",
            request.id, request.tool, request.stream
        );
        Ok(())
    }

    async fn after_request(&self, request: &RpcRequest, response: &mut RpcResponse) -> Result<()> {
        let status = if response.error.is_some() { "error" } else { "success" };
        debug!(
            "Completed request: id={} tool={} status={}",
            request.id, request.tool, status
        );
        Ok(())
    }
}

/// Authentication middleware
pub struct AuthMiddleware {
    required_tokens: Arc<tokio::sync::RwLock<Vec<String>>>,
}

impl Default for AuthMiddleware {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthMiddleware {
    pub fn new() -> Self {
        Self {
            required_tokens: Arc::new(tokio::sync::RwLock::new(Vec::new())),
        }
    }

    pub async fn add_token(&self, token: String) {
        self.required_tokens.write().await.push(token);
    }
}

#[async_trait::async_trait]
impl Middleware for AuthMiddleware {
    async fn before_request(&self, request: &mut RpcRequest) -> Result<()> {
        let tokens = self.required_tokens.read().await;

        // If no tokens configured, allow all requests
        if tokens.is_empty() {
            return Ok(());
        }

        // Check if request has valid auth token
        if let Some(auth_token) = &request.auth {
            if tokens.contains(auth_token) {
                return Ok(());
            }
        }

        anyhow::bail!("Unauthorized: invalid or missing authentication token");
    }

    async fn after_request(&self, _request: &RpcRequest, _response: &mut RpcResponse) -> Result<()> {
        Ok(())
    }
}

/// Rate limiting middleware
pub struct RateLimitMiddleware {
    max_requests_per_second: u32,
    request_counts: Arc<tokio::sync::RwLock<std::collections::HashMap<String, (u32, Instant)>>>,
}

impl RateLimitMiddleware {
    pub fn new(max_requests_per_second: u32) -> Self {
        Self {
            max_requests_per_second,
            request_counts: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        }
    }
}

#[async_trait::async_trait]
impl Middleware for RateLimitMiddleware {
    async fn before_request(&self, request: &mut RpcRequest) -> Result<()> {
        let client_id = request.auth.clone().unwrap_or_else(|| "anonymous".to_string());
        let now = Instant::now();

        let mut counts = self.request_counts.write().await;

        // Get or create entry for this client
        let (count, last_reset) = counts.entry(client_id.clone())
            .or_insert((0, now));

        // Reset counter if more than 1 second has passed
        if now.duration_since(*last_reset).as_secs() >= 1 {
            *count = 0;
            *last_reset = now;
        }

        // Check rate limit
        if *count >= self.max_requests_per_second {
            anyhow::bail!("Rate limit exceeded: {} requests per second", self.max_requests_per_second);
        }

        *count += 1;

        Ok(())
    }

    async fn after_request(&self, _request: &RpcRequest, _response: &mut RpcResponse) -> Result<()> {
        Ok(())
    }
}

/// RPC router
pub struct RpcRouter {
    registry: Arc<ToolRegistry>,
    db_pool: Arc<DatabasePool>,
    middlewares: Vec<Arc<dyn Middleware>>,
    mcp_handlers: Arc<crate::mcp::handlers::ToolHandlers>,
}

impl RpcRouter {
    /// Create a new router
    pub fn new(
        registry: Arc<ToolRegistry>,
        db_pool: Arc<DatabasePool>,
        mcp_handlers: Arc<crate::mcp::handlers::ToolHandlers>,
    ) -> Self {
        Self {
            registry,
            db_pool,
            middlewares: Vec::new(),
            mcp_handlers,
        }
    }

    /// Add middleware to the router
    pub fn add_middleware(&mut self, middleware: Arc<dyn Middleware>) {
        self.middlewares.push(middleware);
    }

    /// Route a request to the appropriate handler
    pub async fn route(&self, mut request: RpcRequest) -> RpcResponse {
        let start_time = Instant::now();

        // Run before middlewares
        for middleware in &self.middlewares {
            if let Err(e) = middleware.before_request(&mut request).await {
                error!("Middleware error: {}", e);
                return RpcResponse::error(
                    request.id,
                    RpcError::new(ErrorCode::Unauthorized, e.to_string()),
                );
            }
        }

        // Validate request
        if let Err(e) = self.validate_request(&request).await {
            warn!("Invalid request: {}", e);
            return RpcResponse::error(
                request.id,
                RpcError::invalid_request(e.to_string()),
            );
        }

        // Check if tool exists
        let handler = match self.registry.get_handler(&request.tool).await {
            Some(h) => h,
            None => {
                warn!("Tool not found: {}", request.tool);
                return RpcResponse::error(
                    request.id,
                    RpcError::not_found(format!("Tool '{}' not found", request.tool)),
                );
            }
        };

        // Create tool context
        let context = Arc::new(ToolContext {
            db_pool: Arc::clone(&self.db_pool),
            mcp_handlers: Arc::clone(&self.mcp_handlers),
            auth_info: self.extract_auth_info(&request),
            project_context: None,
        });

        // Call handler
        let mut response = match handler(request.clone(), context).await {
            Ok(resp) => resp,
            Err(e) => {
                error!("Handler error for tool '{}': {}", request.tool, e);
                RpcResponse::error(
                    request.id,
                    RpcError::internal_error(e.to_string()),
                )
            }
        };

        // Add metrics
        let processing_time = start_time.elapsed();
        let metrics = ResponseMetrics::new()
            .with_processing_time(processing_time);

        response = response.with_metrics(metrics);

        // Run after middlewares
        for middleware in &self.middlewares {
            if let Err(e) = middleware.after_request(&request, &mut response).await {
                error!("Middleware error in after_request: {}", e);
            }
        }

        response
    }

    /// Validate request parameters
    async fn validate_request(&self, request: &RpcRequest) -> Result<()> {
        // Check protocol version
        if request.version != super::PROTOCOL_VERSION {
            anyhow::bail!(
                "Unsupported protocol version: expected {}, got {}",
                super::PROTOCOL_VERSION,
                request.version
            );
        }

        // Check tool name format
        if request.tool.is_empty() {
            anyhow::bail!("Tool name cannot be empty");
        }

        // Check max size if specified
        if let Some(max_size) = request.max_size {
            if max_size > 100 * 1024 * 1024 {
                // 100MB limit
                anyhow::bail!("Max size too large: {} bytes", max_size);
            }
        }

        // Check timeout if specified
        if let Some(timeout) = request.timeout_ms {
            if timeout == 0 || timeout > 60_000 {
                // Max 60 seconds
                anyhow::bail!("Invalid timeout: {} ms", timeout);
            }
        }

        Ok(())
    }

    /// Extract authentication info from request
    fn extract_auth_info(&self, request: &RpcRequest) -> Option<AuthInfo> {
        request.auth.as_ref().map(|token| {
            AuthInfo {
                token: token.clone(),
                user_id: format!("user_{}", request.id), // Placeholder
                permissions: vec!["read".to_string(), "write".to_string()], // Placeholder
            }
        })
    }

    /// Get router statistics
    pub async fn get_stats(&self) -> RouterStats {
        RouterStats {
            registered_tools: self.registry.list_tools().await.len(),
            middleware_count: self.middlewares.len(),
        }
    }
}

/// Router statistics
#[derive(Debug, Clone)]
pub struct RouterStats {
    pub registered_tools: usize,
    pub middleware_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rpc::tool_registry::ToolMetadata;
    use tempfile::TempDir;

    fn create_test_pool() -> Arc<DatabasePool> {
        let temp_dir = TempDir::new().unwrap();
        let rocks_path = temp_dir.path().join("rocks");
        let sqlite_path = temp_dir.path().join("test.db");

        Arc::new(DatabasePool::new(
            rocks_path,
            sqlite_path,
            super::super::db_pool::PoolConfig::default(),
        ).unwrap())
    }

    #[tokio::test]
    async fn test_router_creation() {
        let registry = Arc::new(ToolRegistry::new());
        let pool = create_test_pool();

        // Create mock MCP handlers
        use crate::memory::MemorySystem;
        use crate::context::ContextManager;
        use crate::indexer::CodeIndexer;
        use crate::session::SessionManager;
        use crate::docs::DocIndexer;
        use crate::specs::SpecificationManager;
        use crate::tasks::TaskManager;
        use crate::indexer::PatternSearchEngine;

        let temp_dir = TempDir::new().unwrap();

        let memory = Arc::new(tokio::sync::RwLock::new(
            MemorySystem::new(temp_dir.path().join("memory.db")).unwrap()
        ));
        let context = Arc::new(tokio::sync::RwLock::new(
            ContextManager::new()
        ));
        let indexer = Arc::new(tokio::sync::RwLock::new(
            CodeIndexer::new(temp_dir.path().join("rocks")).unwrap()
        ));
        let session = Arc::new(
            SessionManager::new(temp_dir.path().join("sessions")).unwrap()
        );
        let docs = Arc::new(
            DocIndexer::new(temp_dir.path())
        );
        let specs = Arc::new(tokio::sync::RwLock::new(
            SpecificationManager::new(temp_dir.path().join("specs"))
        ));
        let progress = Arc::new(tokio::sync::RwLock::new(
            TaskManager::new(temp_dir.path().join("progress.db")).unwrap()
        ));
        let links = Arc::new(tokio::sync::RwLock::new(
            crate::links::RocksDBLinksStorage::new(temp_dir.path().join("links")).unwrap()
        ) as Arc<tokio::sync::RwLock<dyn crate::links::LinksStorage>>);
        let pattern = Arc::new(
            PatternSearchEngine::new()
        );

        let mcp_handlers = Arc::new(crate::mcp::handlers::ToolHandlers::new(
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

        let router = RpcRouter::new(registry, pool, mcp_handlers);

        let stats = router.get_stats().await;
        assert_eq!(stats.registered_tools, 0);
        assert_eq!(stats.middleware_count, 0);
    }

    #[tokio::test]
    async fn test_add_middleware() {
        let registry = Arc::new(ToolRegistry::new());
        let pool = create_test_pool();

        let temp_dir = TempDir::new().unwrap();
        let memory = Arc::new(tokio::sync::RwLock::new(
            crate::memory::MemorySystem::new(temp_dir.path().join("memory.db")).unwrap()
        ));
        let context = Arc::new(tokio::sync::RwLock::new(
            crate::context::ContextManager::new()
        ));
        let indexer = Arc::new(tokio::sync::RwLock::new(
            crate::indexer::CodeIndexer::new(temp_dir.path().join("rocks")).unwrap()
        ));
        let session = Arc::new(
            crate::session::SessionManager::new(temp_dir.path().join("sessions")).unwrap()
        );
        let docs = Arc::new(
            crate::docs::DocIndexer::new(temp_dir.path())
        );
        let specs = Arc::new(tokio::sync::RwLock::new(
            crate::specs::SpecificationManager::new(temp_dir.path().join("specs"))
        ));
        let progress = Arc::new(tokio::sync::RwLock::new(
            crate::tasks::TaskManager::new(temp_dir.path().join("progress.db")).unwrap()
        ));
        let links = Arc::new(tokio::sync::RwLock::new(
            crate::links::RocksDBLinksStorage::new(temp_dir.path().join("links")).unwrap()
        ) as Arc<tokio::sync::RwLock<dyn crate::links::LinksStorage>>);
        let pattern = Arc::new(
            crate::indexer::PatternSearchEngine::new()
        );

        let mcp_handlers = Arc::new(crate::mcp::handlers::ToolHandlers::new(
            memory, context, indexer, session, docs, specs, progress, links, pattern,
        ));

        let mut router = RpcRouter::new(registry, pool, mcp_handlers);

        router.add_middleware(Arc::new(LoggingMiddleware));

        let stats = router.get_stats().await;
        assert_eq!(stats.middleware_count, 1);
    }

    #[tokio::test]
    async fn test_validate_request() {
        let registry = Arc::new(ToolRegistry::new());
        let pool = create_test_pool();

        let temp_dir = TempDir::new().unwrap();
        let memory = Arc::new(tokio::sync::RwLock::new(
            crate::memory::MemorySystem::new(temp_dir.path().join("memory.db")).unwrap()
        ));
        let context = Arc::new(tokio::sync::RwLock::new(
            crate::context::ContextManager::new()
        ));
        let indexer = Arc::new(tokio::sync::RwLock::new(
            crate::indexer::CodeIndexer::new(temp_dir.path().join("rocks")).unwrap()
        ));
        let session = Arc::new(
            crate::session::SessionManager::new(temp_dir.path().join("sessions")).unwrap()
        );
        let docs = Arc::new(
            crate::docs::DocIndexer::new(temp_dir.path())
        );
        let specs = Arc::new(tokio::sync::RwLock::new(
            crate::specs::SpecificationManager::new(temp_dir.path().join("specs"))
        ));
        let progress = Arc::new(tokio::sync::RwLock::new(
            crate::tasks::TaskManager::new(temp_dir.path().join("progress.db")).unwrap()
        ));
        let links = Arc::new(tokio::sync::RwLock::new(
            crate::links::RocksDBLinksStorage::new(temp_dir.path().join("links")).unwrap()
        ) as Arc<tokio::sync::RwLock<dyn crate::links::LinksStorage>>);
        let pattern = Arc::new(
            crate::indexer::PatternSearchEngine::new()
        );

        let mcp_handlers = Arc::new(crate::mcp::handlers::ToolHandlers::new(
            memory, context, indexer, session, docs, specs, progress, links, pattern,
        ));

        let router = RpcRouter::new(registry, pool, mcp_handlers);

        // Valid request
        let valid_request = RpcRequest {
            version: super::super::PROTOCOL_VERSION,
            id: 1,
            tool: "test.tool".to_string(),
            params: rmpv::Value::Nil,
            stream: false,
            max_size: None,
            timeout_ms: Some(5000),
            auth: None,
        };

        assert!(router.validate_request(&valid_request).await.is_ok());

        // Invalid version
        let invalid_request = RpcRequest {
            version: 99,
            ..valid_request.clone()
        };

        assert!(router.validate_request(&invalid_request).await.is_err());
    }
}
