//! Hot reload infrastructure for zero-downtime server updates
//!
//! This module provides the core infrastructure for hot-reloading the Meridian server
//! without disrupting connected MCP clients. It supports:
//!
//! - Signal-based reload triggers (SIGHUP)
//! - State preservation across reloads
//! - Connection migration
//! - Graceful handover between old and new processes
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────┐  SIGHUP   ┌──────────────┐
//! │ Old Server  │◄──────────│ Signal/File  │
//! │             │           │  Watcher     │
//! └──────┬──────┘           └──────────────┘
//!        │
//!        │ 1. Export State
//!        ▼
//! ┌─────────────────────┐
//! │ State Serialization │
//! │ - Connections       │
//! │ - Streams           │
//! │ - Metrics           │
//! └──────────┬──────────┘
//!            │
//!            │ 2. Unix Socket Transfer
//!            ▼
//! ┌─────────────────────┐
//! │   New Server        │
//! │ 1. Import State     │
//! │ 2. Health Check     │
//! │ 3. Take Over        │
//! └─────────────────────┘
//! ```

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, Notify, mpsc};
use tracing::{error, info};
use uuid::Uuid;

/// Server state snapshot for hot reload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerState {
    /// Snapshot timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,

    /// Server process ID
    pub pid: u32,

    /// Server version/build hash
    pub version: String,

    /// Active connections state
    pub connections: Vec<ConnectionState>,

    /// Active streaming requests
    pub streams: HashMap<Uuid, StreamState>,

    /// Performance metrics snapshot
    pub metrics: MetricsSnapshot,

    /// Configuration snapshot
    pub config: ConfigSnapshot,
}

/// State of a single connection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionState {
    /// Connection ID
    pub id: Uuid,

    /// Remote address (if TCP)
    pub remote_addr: Option<String>,

    /// Connection established timestamp
    pub established_at: chrono::DateTime<chrono::Utc>,

    /// Number of requests processed
    pub requests_processed: u64,

    /// Last activity timestamp
    pub last_activity: chrono::DateTime<chrono::Utc>,

    /// Pending request IDs
    pub pending_requests: Vec<u64>,
}

/// State of a streaming request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamState {
    /// Stream ID
    pub id: Uuid,

    /// Associated connection ID
    pub connection_id: Uuid,

    /// Request ID
    pub request_id: u64,

    /// Tool name being streamed
    pub tool: String,

    /// Started timestamp
    pub started_at: chrono::DateTime<chrono::Utc>,

    /// Chunks sent so far
    pub chunks_sent: u64,

    /// Total bytes sent
    pub bytes_sent: u64,

    /// Stream cursor/position (for resumption)
    pub cursor: Option<Vec<u8>>,
}

/// Snapshot of performance metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    /// Total requests processed
    pub total_requests: u64,

    /// Failed requests
    pub failed_requests: u64,

    /// Active connections count
    pub active_connections: u64,

    /// Server uptime in seconds
    pub uptime_secs: u64,

    /// Average latency in milliseconds
    pub avg_latency_ms: f64,

    /// P99 latency in milliseconds
    pub p99_latency_ms: u64,
}

/// Configuration snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigSnapshot {
    /// Unix socket path
    pub socket_path: Option<PathBuf>,

    /// TCP address
    pub tcp_addr: Option<String>,

    /// TCP enabled
    pub tcp_enabled: bool,

    /// Max frame size
    pub max_frame_size: usize,
}

/// Trait for hot-reloadable components
pub trait HotReloadable: Send + Sync {
    /// Export current state
    fn export_state(&self) -> Result<ServerState>;

    /// Import state from previous instance
    fn import_state(&mut self, state: ServerState) -> Result<()>;

    /// Check if ready to accept new connections
    fn is_ready(&self) -> bool;

    /// Gracefully stop accepting new connections
    fn stop_accepting(&self) -> Result<()>;

    /// Drain existing connections with timeout
    fn drain_connections(&self, timeout: Duration) -> Result<()>;
}

/// Hot reload coordinator
pub struct HotReloadCoordinator {
    /// Reload state
    state: Arc<RwLock<ReloadState>>,

    /// Notification for reload events
    notify: Arc<Notify>,

    /// Control channel for reload commands
    control_tx: mpsc::Sender<ReloadCommand>,
    control_rx: Arc<RwLock<mpsc::Receiver<ReloadCommand>>>,

    /// Reload configuration
    config: HotReloadConfig,
}

/// Hot reload configuration
#[derive(Debug, Clone)]
pub struct HotReloadConfig {
    /// State transfer socket path
    pub state_socket_path: PathBuf,

    /// Health check timeout
    pub health_check_timeout: Duration,

    /// Handover timeout
    pub handover_timeout: Duration,

    /// Connection drain timeout
    pub drain_timeout: Duration,

    /// Enable binary change watching
    pub watch_binary: bool,

    /// Binary path to watch (if enabled)
    pub binary_path: Option<PathBuf>,
}

impl Default for HotReloadConfig {
    fn default() -> Self {
        Self {
            state_socket_path: PathBuf::from("/tmp/meridian-reload.sock"),
            health_check_timeout: Duration::from_secs(10),
            handover_timeout: Duration::from_secs(30),
            drain_timeout: Duration::from_secs(30),
            watch_binary: false,
            binary_path: None,
        }
    }
}

/// Current reload state
#[derive(Debug, Clone, PartialEq)]
enum ReloadState {
    /// Normal operation
    Running,

    /// Reload triggered, preparing to export state
    ReloadPending,

    /// Exporting state
    Exporting,

    /// Waiting for new server to import
    WaitingForHandover,

    /// Draining connections
    Draining,

    /// Shutdown complete
    Shutdown,
}

/// Reload command
enum ReloadCommand {
    /// Trigger reload
    Trigger,

    /// Cancel ongoing reload
    Cancel,

    /// Force shutdown
    ForceShutdown,
}

impl HotReloadCoordinator {
    /// Create new hot reload coordinator
    pub fn new(config: HotReloadConfig) -> Self {
        let (control_tx, control_rx) = mpsc::channel(10);

        Self {
            state: Arc::new(RwLock::new(ReloadState::Running)),
            notify: Arc::new(Notify::new()),
            control_tx,
            control_rx: Arc::new(RwLock::new(control_rx)),
            config,
        }
    }

    /// Get control channel sender
    pub fn get_control_sender(&self) -> mpsc::Sender<ReloadCommand> {
        self.control_tx.clone()
    }

    /// Trigger a reload
    pub async fn trigger_reload(&self) -> Result<()> {
        let mut state = self.state.write().await;

        if *state != ReloadState::Running {
            bail!("Cannot trigger reload: server is in state {:?}", *state);
        }

        info!("Hot reload triggered");
        *state = ReloadState::ReloadPending;
        self.notify.notify_one();

        Ok(())
    }

    /// Check if reload is in progress
    pub async fn is_reloading(&self) -> bool {
        let state = self.state.read().await;
        *state != ReloadState::Running
    }

    /// Get current state
    pub async fn get_state(&self) -> ReloadState {
        self.state.read().await.clone()
    }

    /// Set state
    async fn set_state(&self, new_state: ReloadState) {
        let mut state = self.state.write().await;
        info!("Reload state transition: {:?} -> {:?}", *state, new_state);
        *state = new_state;
    }

    /// Wait for reload completion
    pub async fn wait_for_reload(&self, timeout: Duration) -> Result<()> {
        let start = Instant::now();

        loop {
            let state = self.get_state().await;

            match state {
                ReloadState::Running => return Ok(()),
                ReloadState::Shutdown => bail!("Server shutdown during reload"),
                _ => {
                    if start.elapsed() > timeout {
                        bail!("Reload timeout after {:?}", timeout);
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }
    }
}

/// Signal handler for SIGHUP
pub async fn install_sighup_handler(coordinator: Arc<HotReloadCoordinator>) -> Result<()> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sighup = signal(SignalKind::hangup())
        .context("Failed to install SIGHUP handler")?;

    tokio::spawn(async move {
        loop {
            sighup.recv().await;
            info!("Received SIGHUP signal, triggering hot reload");

            if let Err(e) = coordinator.trigger_reload().await {
                error!("Failed to trigger reload: {}", e);
            }
        }
    });

    info!("SIGHUP handler installed");
    Ok(())
}

/// File watcher for binary changes
pub async fn watch_binary_for_changes(
    binary_path: PathBuf,
    coordinator: Arc<HotReloadCoordinator>,
) -> Result<()> {
    use notify::{Watcher, RecursiveMode, Event, event::ModifyKind};
    use tokio::sync::mpsc;

    info!("Watching binary for changes: {:?}", binary_path);

    let (tx, mut rx) = mpsc::channel(10);

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if matches!(event.kind, notify::EventKind::Modify(ModifyKind::Data(_))) {
                let _ = tx.blocking_send(());
            }
        }
    })?;

    watcher.watch(&binary_path, RecursiveMode::NonRecursive)?;

    tokio::spawn(async move {
        while let Some(_) = rx.recv().await {
            info!("Binary changed, triggering hot reload");

            if let Err(e) = coordinator.trigger_reload().await {
                error!("Failed to trigger reload on binary change: {}", e);
            }

            // Debounce - wait before accepting another change
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        // Keep watcher alive
        drop(watcher);
    });

    Ok(())
}

/// Reload metrics
#[derive(Debug, Default, Clone)]
pub struct ReloadMetrics {
    /// Total reload attempts
    pub total_attempts: u64,

    /// Successful reloads
    pub successful_reloads: u64,

    /// Failed reloads
    pub failed_reloads: u64,

    /// Average reload duration
    pub avg_duration_ms: f64,

    /// Last reload timestamp
    pub last_reload: Option<chrono::DateTime<chrono::Utc>>,

    /// Last reload duration
    pub last_duration_ms: Option<u64>,

    /// Connections transferred in last reload
    pub last_connections_transferred: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_coordinator_creation() {
        let config = HotReloadConfig::default();
        let coordinator = HotReloadCoordinator::new(config);

        assert_eq!(coordinator.get_state().await, ReloadState::Running);
        assert!(!coordinator.is_reloading().await);
    }

    #[tokio::test]
    async fn test_trigger_reload() {
        let config = HotReloadConfig::default();
        let coordinator = HotReloadCoordinator::new(config);

        coordinator.trigger_reload().await.unwrap();

        assert_eq!(coordinator.get_state().await, ReloadState::ReloadPending);
        assert!(coordinator.is_reloading().await);
    }

    #[tokio::test]
    async fn test_double_trigger_fails() {
        let config = HotReloadConfig::default();
        let coordinator = HotReloadCoordinator::new(config);

        coordinator.trigger_reload().await.unwrap();
        let result = coordinator.trigger_reload().await;

        assert!(result.is_err());
    }

    #[test]
    fn test_server_state_serialization() {
        let state = ServerState {
            timestamp: chrono::Utc::now(),
            pid: 12345,
            version: "1.0.0".to_string(),
            connections: vec![],
            streams: HashMap::new(),
            metrics: MetricsSnapshot {
                total_requests: 100,
                failed_requests: 5,
                active_connections: 10,
                uptime_secs: 3600,
                avg_latency_ms: 50.5,
                p99_latency_ms: 200,
            },
            config: ConfigSnapshot {
                socket_path: Some(PathBuf::from("/tmp/test.sock")),
                tcp_addr: None,
                tcp_enabled: false,
                max_frame_size: 1024 * 1024,
            },
        };

        // Test serialization
        let json = serde_json::to_string(&state).unwrap();
        let decoded: ServerState = serde_json::from_str(&json).unwrap();

        assert_eq!(decoded.pid, 12345);
        assert_eq!(decoded.version, "1.0.0");
        assert_eq!(decoded.metrics.total_requests, 100);
    }
}
