//! Global server daemon
//!
//! The global server manages all projects across all monorepos on the machine.
//! It provides:
//! - Project registry management
//! - Global indexing
//! - IPC server for local MCP servers
//! - File watching (future)

use super::ipc::IpcServer;
use super::registry::ProjectRegistryManager;
use super::storage::GlobalStorage;
use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// Server status
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
}

/// Global server configuration
#[derive(Debug, Clone)]
pub struct GlobalServerConfig {
    /// Directory for global data storage
    pub data_dir: PathBuf,

    /// Host for IPC server
    pub host: String,

    /// Port for IPC server
    pub port: u16,

    /// Auto-start on first request
    pub auto_start: bool,
}

impl Default for GlobalServerConfig {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let data_dir = PathBuf::from(home).join(".meridian/data");

        Self {
            data_dir,
            host: "localhost".to_string(),
            port: 7878,
            auto_start: true,
        }
    }
}

/// Global server daemon
pub struct GlobalServer {
    config: GlobalServerConfig,
    storage: Arc<GlobalStorage>,
    registry_manager: Arc<ProjectRegistryManager>,
    ipc_server: Arc<RwLock<Option<IpcServer>>>,
    status: Arc<RwLock<ServerStatus>>,
}

impl GlobalServer {
    /// Create a new global server
    pub async fn new(config: GlobalServerConfig) -> Result<Self> {
        // Ensure data directory exists
        std::fs::create_dir_all(&config.data_dir)
            .with_context(|| format!("Failed to create data directory {:?}", config.data_dir))?;

        // Initialize storage
        let storage = Arc::new(
            GlobalStorage::new(&config.data_dir)
                .await
                .with_context(|| "Failed to initialize global storage")?,
        );

        // Initialize registry manager
        let registry_manager = Arc::new(ProjectRegistryManager::new(Arc::clone(&storage)));

        Ok(Self {
            config,
            storage,
            registry_manager,
            ipc_server: Arc::new(RwLock::new(None)),
            status: Arc::new(RwLock::new(ServerStatus::Stopped)),
        })
    }

    /// Start the global server
    pub async fn start(&self) -> Result<()> {
        let mut status = self.status.write().await;
        if *status == ServerStatus::Running {
            warn!("Global server is already running");
            return Ok(());
        }

        *status = ServerStatus::Starting;
        drop(status);

        info!("Starting global server...");

        // Start IPC server
        let ipc = IpcServer::new(
            self.config.host.clone(),
            self.config.port,
            Arc::clone(&self.registry_manager),
        );

        let ipc_clone = ipc.clone();
        tokio::spawn(async move {
            if let Err(e) = ipc_clone.start().await {
                warn!("IPC server error: {}", e);
            }
        });

        {
            let mut ipc_server = self.ipc_server.write().await;
            *ipc_server = Some(ipc);
        }

        {
            let mut status = self.status.write().await;
            *status = ServerStatus::Running;
        }

        info!(
            "Global server started on {}:{}",
            self.config.host, self.config.port
        );

        Ok(())
    }

    /// Stop the global server
    pub async fn stop(&self) -> Result<()> {
        let mut status = self.status.write().await;
        if *status == ServerStatus::Stopped {
            warn!("Global server is already stopped");
            return Ok(());
        }

        *status = ServerStatus::Stopping;
        drop(status);

        info!("Stopping global server...");

        // Stop IPC server
        if let Some(ipc) = self.ipc_server.write().await.take() {
            ipc.stop().await?;
        }

        {
            let mut status = self.status.write().await;
            *status = ServerStatus::Stopped;
        }

        info!("Global server stopped");

        Ok(())
    }

    /// Get current server status
    pub async fn status(&self) -> ServerStatus {
        *self.status.read().await
    }

    /// Wait for the server to stop
    pub async fn wait(&self) -> Result<()> {
        loop {
            let status = self.status().await;
            if status == ServerStatus::Stopped {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        Ok(())
    }

    /// Get registry manager
    pub fn registry_manager(&self) -> Arc<ProjectRegistryManager> {
        Arc::clone(&self.registry_manager)
    }

    /// Get storage
    pub fn storage(&self) -> Arc<GlobalStorage> {
        Arc::clone(&self.storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_server_lifecycle() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 7879, // Different port for testing
            auto_start: false,
        };

        let server = GlobalServer::new(config).await.unwrap();

        assert_eq!(server.status().await, ServerStatus::Stopped);

        server.start().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Running);

        server.stop().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Stopped);
    }

    #[tokio::test]
    async fn test_double_start() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 7880,
            auto_start: false,
        };

        let server = GlobalServer::new(config).await.unwrap();

        server.start().await.unwrap();
        // Starting again should not error
        server.start().await.unwrap();

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn test_double_stop() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 7881,
            auto_start: false,
        };

        let server = GlobalServer::new(config).await.unwrap();

        server.start().await.unwrap();
        server.stop().await.unwrap();
        // Stopping again should not error
        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn test_registry_manager_access() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let server = GlobalServer::new(config).await.unwrap();
        let manager = server.registry_manager();

        // Should be able to use the manager
        let projects = manager.list_all().await.unwrap();
        assert_eq!(projects.len(), 0);
    }
}
