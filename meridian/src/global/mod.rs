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

pub use identity::{ProjectIdentity, ProjectType};
pub use registry::{ProjectRegistry, ProjectRegistryManager, ProjectStatus, PathHistoryEntry};
pub use storage::GlobalStorage;
pub use server::{GlobalServer, GlobalServerConfig};
pub use ipc::IpcServer;
pub use dependencies::{DependencyGraph, DependencyGraphManager, DependencyType, DependencyEdge, ProjectNode};
