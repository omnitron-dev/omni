//! Global server daemon
//!
//! The global server manages all projects across all monorepos on the machine.
//! It provides:
//! - Project registry management
//! - Global indexing
//! - IPC server for local MCP servers
//! - File watching for auto-reindexing

use super::ipc::IpcServer;
use super::registry::ProjectRegistryManager;
use super::storage::GlobalStorage;
use super::sync::SyncManager;
use super::watcher::{GlobalFileWatcher, WatcherConfig};
use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

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

    /// Enable file watching
    pub watch_enabled: bool,

    /// File watcher configuration (optional)
    pub watcher_config: Option<WatcherConfig>,
}

impl Default for GlobalServerConfig {
    fn default() -> Self {
        use crate::config::get_meridian_home;
        let data_dir = get_meridian_home().join("data");

        Self {
            data_dir,
            host: "localhost".to_string(),
            port: 7878,
            auto_start: true,
            watch_enabled: true,
            watcher_config: Some(WatcherConfig::default()),
        }
    }
}

/// Global server daemon
pub struct GlobalServer {
    config: GlobalServerConfig,
    storage: Arc<GlobalStorage>,
    registry_manager: Arc<ProjectRegistryManager>,
    ipc_server: Arc<RwLock<Option<IpcServer>>>,
    file_watcher: Arc<RwLock<Option<Arc<GlobalFileWatcher>>>>,
    sync_manager: Arc<RwLock<Option<Arc<SyncManager>>>>,
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
            file_watcher: Arc::new(RwLock::new(None)),
            sync_manager: Arc::new(RwLock::new(None)),
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

        // Start file watcher and sync manager if enabled
        if self.config.watch_enabled {
            let watcher_config = self.config.watcher_config.clone()
                .unwrap_or_default();

            info!("Starting file watcher...");
            let watcher = Arc::new(GlobalFileWatcher::new(
                watcher_config,
                Arc::clone(&self.registry_manager),
            ));

            // Initialize sync manager
            let sync_manager = Arc::new(SyncManager::new(
                Arc::clone(&self.registry_manager),
                Arc::clone(&self.storage),
                Arc::clone(&watcher),
            ));

            // Set up change callback to sync manager
            let sync_manager_clone = Arc::clone(&sync_manager);
            watcher
                .set_change_callback(Arc::new(move |event| {
                    debug!(
                        "File changed: {:?} (kind: {:?})",
                        event.path, event.kind
                    );

                    // Handle the file change asynchronously
                    let sync_manager = Arc::clone(&sync_manager_clone);
                    tokio::spawn(async move {
                        if let Err(e) = sync_manager.handle_file_change(event).await {
                            warn!("Failed to handle file change: {}", e);
                        }
                    });
                }))
                .await;

            // Start watching
            if let Err(e) = watcher.start().await {
                warn!("Failed to start file watcher: {}", e);
            } else {
                info!("File watcher started");
            }

            // Start periodic sync
            if let Err(e) = sync_manager.start_periodic_sync().await {
                warn!("Failed to start periodic sync: {}", e);
            } else {
                info!("Periodic sync started");
            }

            // Store references to watcher and sync manager
            {
                let mut file_watcher = self.file_watcher.write().await;
                *file_watcher = Some(watcher);
            }
            {
                let mut sync = self.sync_manager.write().await;
                *sync = Some(sync_manager);
            }
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

        // Stop sync manager
        if let Some(sync) = self.sync_manager.write().await.take() {
            info!("Stopping sync manager...");
            sync.stop().await?;
        }

        // Stop file watcher
        if let Some(watcher) = self.file_watcher.write().await.take() {
            info!("Stopping file watcher...");
            watcher.stop().await?;
        }

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

    /// Get file watcher statistics
    pub async fn get_watcher_stats(&self) -> Option<super::watcher::WatcherStats> {
        let watcher = self.file_watcher.read().await;
        if let Some(ref w) = *watcher {
            Some(w.get_stats().await)
        } else {
            None
        }
    }

    /// Get sync manager statistics
    pub async fn get_sync_stats(&self) -> Option<super::sync::SyncStats> {
        let sync = self.sync_manager.read().await;
        if let Some(ref s) = *sync {
            Some(s.get_stats().await)
        } else {
            None
        }
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
            watch_enabled: false,
            watcher_config: None,
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
            watch_enabled: false,
            watcher_config: None,
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
            watch_enabled: false,
            watcher_config: None,
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

    // Comprehensive global server daemon tests
    #[tokio::test]
    async fn test_server_start_stop_multiple_times() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 17882,
            auto_start: false,
            watch_enabled: false,
            watcher_config: None,
        };

        let server = GlobalServer::new(config).await.unwrap();

        // Start-stop cycle 1
        server.start().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Running);
        server.stop().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Stopped);

        // Start-stop cycle 2
        server.start().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Running);
        server.stop().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Stopped);
    }

    #[tokio::test]
    async fn test_server_with_file_watcher_enabled() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 17883,
            auto_start: false,
            watch_enabled: true,
            watcher_config: Some(WatcherConfig::default()),
        };

        let server = GlobalServer::new(config).await.unwrap();
        server.start().await.unwrap();

        // Give watcher time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let stats = server.get_watcher_stats().await;
        assert!(stats.is_some());

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn test_server_graceful_shutdown() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 17884,
            auto_start: false,
            watch_enabled: true,
            watcher_config: Some(WatcherConfig::default()),
        };

        let server = GlobalServer::new(config).await.unwrap();
        server.start().await.unwrap();

        // Give systems time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Graceful stop should clean up everything
        server.stop().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Stopped);
    }

    #[tokio::test]
    async fn test_server_wait_for_stop() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 17885,
            auto_start: false,
            watch_enabled: false,
            watcher_config: None,
        };

        let server = Arc::new(GlobalServer::new(config).await.unwrap());

        // Start server
        server.start().await.unwrap();

        // Spawn task to wait
        let server_clone = Arc::clone(&server);
        let wait_handle = tokio::spawn(async move {
            server_clone.wait().await
        });

        // Stop server from another task
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        server.stop().await.unwrap();

        // Wait should complete
        let result = tokio::time::timeout(
            tokio::time::Duration::from_secs(1),
            wait_handle
        ).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_server_status_transitions() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            host: "127.0.0.1".to_string(),
            port: 17886,
            auto_start: false,
            watch_enabled: false,
            watcher_config: None,
        };

        let server = GlobalServer::new(config).await.unwrap();

        // Initial state
        assert_eq!(server.status().await, ServerStatus::Stopped);

        // Start
        server.start().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Running);

        // Stop
        server.stop().await.unwrap();
        assert_eq!(server.status().await, ServerStatus::Stopped);
    }

    #[tokio::test]
    async fn test_server_storage_access() {
        let temp_dir = TempDir::new().unwrap();
        let config = GlobalServerConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let server = GlobalServer::new(config).await.unwrap();
        let storage = server.storage();

        // Storage should be usable
        let result = storage.put_raw("test_key", b"test_value").await;
        assert!(result.is_ok());

        let value = storage.get_raw("test_key").await.unwrap();
        assert!(value.is_some());
        assert_eq!(value.unwrap(), b"test_value");
    }
}
