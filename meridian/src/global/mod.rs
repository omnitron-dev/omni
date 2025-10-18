//! Global architecture components for multi-monorepo support
//!
//! This module implements the global architecture as specified in global-architecture-spec.md,
//! providing:
//! - Identity-based project IDs (not path-based)
//! - Global project registry
//! - Global server daemon
//! - IPC for local MCP servers
//! - Cross-monorepo dependency resolution

pub mod identity;
pub mod registry;
pub mod storage;
pub mod server;
pub mod ipc;
pub mod dependencies;
pub mod watcher;
pub mod daemon;
pub mod sync;

pub use identity::{ProjectIdentity, ProjectType};
pub use registry::{ProjectRegistry, ProjectRegistryManager, ProjectStatus, PathHistoryEntry};
pub use storage::GlobalStorage;
pub use server::{GlobalServer, GlobalServerConfig, ServerStatus};
pub use ipc::IpcServer;
pub use dependencies::{DependencyGraph, DependencyGraphManager, DependencyType, DependencyEdge, ProjectNode};
pub use watcher::{GlobalFileWatcher, WatcherConfig, FileChangeEvent, FileChangeKind, WatcherStats};
pub use daemon::{start_global_daemon, stop_global_daemon, restart_global_daemon, get_global_status, GlobalDaemonStatus};
pub use sync::{SyncManager, SyncResult, SyncDirection, SyncStats};
