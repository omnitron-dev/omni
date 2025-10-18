//! Global architecture components for multi-monorepo support
//!
//! This module implements the global architecture as specified in global-architecture-spec.md,
//! providing:
//! - Identity-based project IDs (not path-based)
//! - Global project registry
//! - Global server daemon
//! - IPC for local MCP servers

pub mod identity;
pub mod registry;
pub mod storage;
pub mod server;
pub mod ipc;

pub use identity::{ProjectIdentity, ProjectType};
pub use registry::{ProjectRegistry, ProjectRegistryManager, ProjectStatus, PathHistoryEntry};
pub use storage::GlobalStorage;
pub use server::{GlobalServer, GlobalServerConfig};
pub use ipc::IpcServer;
