//! IPC server for communication with local MCP servers
//!
//! Provides HTTP-based RPC interface for local MCP servers to communicate
//! with the global server.

use super::registry::ProjectRegistryManager;
use anyhow::Result;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// IPC request/response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetProjectRequest {
    pub project_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterProjectRequest {
    pub path: String,
}

/// IPC server state
#[derive(Clone)]
struct IpcState {
    registry_manager: Arc<ProjectRegistryManager>,
}

/// IPC server
#[derive(Clone)]
pub struct IpcServer {
    host: String,
    port: u16,
    registry_manager: Arc<ProjectRegistryManager>,
    shutdown_tx: Arc<RwLock<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl IpcServer {
    /// Create a new IPC server
    pub fn new(host: String, port: u16, registry_manager: Arc<ProjectRegistryManager>) -> Self {
        Self {
            host,
            port,
            registry_manager,
            shutdown_tx: Arc::new(RwLock::new(None)),
        }
    }

    /// Start the IPC server
    pub async fn start(&self) -> Result<()> {
        let state = IpcState {
            registry_manager: Arc::clone(&self.registry_manager),
        };

        let app = Router::new()
            .route("/health", get(health_check))
            .route("/projects", get(list_projects))
            .route("/projects/register", post(register_project))
            .route("/projects/{id}", get(get_project))
            .route("/projects/{id}/relocate", post(relocate_project))
            .with_state(state);

        let addr: SocketAddr = format!("{}:{}", self.host, self.port).parse()?;
        info!("IPC server listening on {}", addr);

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut shutdown_tx = self.shutdown_tx.write().await;
            *shutdown_tx = Some(tx);
        }

        let listener = tokio::net::TcpListener::bind(addr).await?;

        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                rx.await.ok();
            })
            .await?;

        Ok(())
    }

    /// Stop the IPC server
    pub async fn stop(&self) -> Result<()> {
        let mut shutdown_tx = self.shutdown_tx.write().await;
        if let Some(tx) = shutdown_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    }
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "meridian-global-server"
    }))
}

/// List all projects
async fn list_projects(State(state): State<IpcState>) -> impl IntoResponse {
    match state.registry_manager.list_all().await {
        Ok(projects) => (StatusCode::OK, Json(projects)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": e.to_string()
            })),
        )
            .into_response(),
    }
}

/// Get a specific project
async fn get_project(
    State(state): State<IpcState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.registry_manager.get(&id).await {
        Ok(Some(project)) => (StatusCode::OK, Json(project)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": "Project not found"
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": e.to_string()
            })),
        )
            .into_response(),
    }
}

/// Register a new project
async fn register_project(
    State(state): State<IpcState>,
    Json(req): Json<RegisterProjectRequest>,
) -> impl IntoResponse {
    let path = std::path::PathBuf::from(req.path);

    match state.registry_manager.register(path).await {
        Ok(registry) => (StatusCode::CREATED, Json(registry)).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": e.to_string()
            })),
        )
            .into_response(),
    }
}

/// Relocate a project
#[derive(Debug, Deserialize)]
struct RelocateRequest {
    new_path: String,
    reason: Option<String>,
}

async fn relocate_project(
    State(state): State<IpcState>,
    Path(id): Path<String>,
    Json(req): Json<RelocateRequest>,
) -> impl IntoResponse {
    let new_path = std::path::PathBuf::from(req.new_path);
    let reason = req.reason.unwrap_or_else(|| "relocated".to_string());

    match state
        .registry_manager
        .relocate_project(&id, new_path, reason)
        .await
    {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ok"
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": e.to_string()
            })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::global::storage::GlobalStorage;
    use tempfile::TempDir;

    async fn create_test_server() -> (IpcServer, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let storage = Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap());
        let manager = Arc::new(ProjectRegistryManager::new(storage));

        let server = IpcServer::new("127.0.0.1".to_string(), 0, manager); // Port 0 = random
        (server, temp_dir)
    }

    #[tokio::test]
    async fn test_health_check() {
        let response = health_check().await.into_response();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_server_lifecycle() {
        let (server, _temp_dir) = create_test_server().await;

        // Start server in background
        let server_clone = server.clone();
        let handle = tokio::spawn(async move {
            server_clone.start().await
        });

        // Give it time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Stop the server
        server.stop().await.unwrap();

        // Wait for start task to complete
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(1),
            handle
        ).await;

        assert!(result.is_ok());
    }
}
