//! Project registry for managing all projects across monorepos
//!
//! The registry maintains metadata about all registered projects,
//! tracks their locations (with history for relocations), and
//! provides search and query capabilities.

use super::identity::ProjectIdentity;
use super::storage::GlobalStorage;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Status of a project
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    /// Project is active and at current path
    Active,
    /// Project has been moved (path changed)
    Moved,
    /// Project has been deleted
    Deleted,
    /// Project metadata is stale (needs refresh)
    Stale,
}

/// Entry in the path history
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathHistoryEntry {
    /// Previous path
    pub path: String,

    /// When the change occurred
    pub timestamp: DateTime<Utc>,

    /// Reason for the path change
    pub reason: String,

    /// Who/what initiated the change
    pub initiated_by: Option<String>,
}

/// Monorepo context information
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonorepoContext {
    /// Monorepo ID
    pub id: String,

    /// Path to monorepo root
    pub path: String,

    /// Relative path within monorepo
    pub relative_path: String,
}

/// Indexing state
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexingState {
    /// Last indexed timestamp
    pub last_indexed: Option<DateTime<Utc>>,

    /// Version of indexer used
    pub index_version: String,

    /// Current status
    pub status: IndexingStatus,

    /// Error message if status is Error
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexingStatus {
    Indexed,
    Indexing,
    Error,
    Pending,
}

/// Complete project registry entry
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRegistry {
    /// Project identity
    pub identity: ProjectIdentity,

    /// Current absolute path
    pub current_path: PathBuf,

    /// History of path changes
    pub path_history: Vec<PathHistoryEntry>,

    /// Monorepo context (if part of a monorepo)
    pub monorepo: Option<MonorepoContext>,

    /// Indexing state
    pub indexing: IndexingState,

    /// Project status
    pub status: ProjectStatus,

    /// When the registry entry was created
    pub created_at: DateTime<Utc>,

    /// When it was last updated
    pub updated_at: DateTime<Utc>,

    /// Last access time (for cache management)
    pub last_accessed_at: DateTime<Utc>,
}

impl ProjectRegistry {
    /// Create a new registry entry for a project
    pub fn new(identity: ProjectIdentity, path: PathBuf) -> Self {
        let now = Utc::now();
        let path_str = path.display().to_string();

        Self {
            identity,
            current_path: path,
            path_history: vec![PathHistoryEntry {
                path: path_str,
                timestamp: now,
                reason: "discovered".to_string(),
                initiated_by: None,
            }],
            monorepo: None,
            indexing: IndexingState {
                last_indexed: None,
                index_version: env!("CARGO_PKG_VERSION").to_string(),
                status: IndexingStatus::Pending,
                error_message: None,
            },
            status: ProjectStatus::Active,
            created_at: now,
            updated_at: now,
            last_accessed_at: now,
        }
    }

    /// Update the path and add to history
    pub fn relocate(&mut self, new_path: PathBuf, reason: String) {
        let old_path = self.current_path.display().to_string();
        self.current_path = new_path;
        self.path_history.push(PathHistoryEntry {
            path: old_path,
            timestamp: Utc::now(),
            reason,
            initiated_by: Some("user".to_string()),
        });
        self.updated_at = Utc::now();
    }

    /// Mark project as accessed
    pub fn touch(&mut self) {
        self.last_accessed_at = Utc::now();
    }
}

/// Manager for the project registry
pub struct ProjectRegistryManager {
    storage: Arc<GlobalStorage>,
}

impl ProjectRegistryManager {
    /// Create a new registry manager
    pub fn new(storage: Arc<GlobalStorage>) -> Self {
        Self { storage }
    }

    /// Register a new project
    pub async fn register(&self, path: PathBuf) -> Result<ProjectRegistry> {
        // Generate identity
        let identity = ProjectIdentity::from_path(&path)
            .with_context(|| format!("Failed to create identity for path {:?}", path))?;

        // Check if already exists
        if let Some(existing) = self.get(&identity.full_id).await? {
            // Update path if different
            if existing.current_path != path {
                let mut updated = existing;
                updated.relocate(path, "auto-detected".to_string());
                self.update(updated.clone()).await?;
                return Ok(updated);
            }
            return Ok(existing);
        }

        // Create new registry entry
        let registry = ProjectRegistry::new(identity, path);
        self.update(registry.clone()).await?;

        Ok(registry)
    }

    /// Get a project by its full ID
    pub async fn get(&self, project_id: &str) -> Result<Option<ProjectRegistry>> {
        self.storage.get_project(project_id).await
    }

    /// Update a project registry entry
    pub async fn update(&self, mut registry: ProjectRegistry) -> Result<()> {
        registry.updated_at = Utc::now();
        self.storage.put_project(&registry).await
    }

    /// Delete a project from the registry
    pub async fn delete(&self, project_id: &str) -> Result<()> {
        // Mark as deleted rather than actually removing
        if let Some(mut registry) = self.get(project_id).await? {
            registry.status = ProjectStatus::Deleted;
            registry.updated_at = Utc::now();
            self.update(registry).await?;
        }
        Ok(())
    }

    /// Find project by path
    pub async fn find_by_path(&self, path: &Path) -> Result<Option<ProjectRegistry>> {
        self.storage.find_project_by_path(path).await
    }

    /// Find projects by name (supports partial matching)
    pub async fn find_by_name(&self, name: &str) -> Result<Vec<ProjectRegistry>> {
        let all_projects = self.list_all().await?;
        Ok(all_projects
            .into_iter()
            .filter(|p| p.identity.id.contains(name))
            .collect())
    }

    /// List all active projects
    pub async fn list_all(&self) -> Result<Vec<ProjectRegistry>> {
        self.storage.list_all_projects().await
    }

    /// Relocate a project to a new path
    pub async fn relocate_project(
        &self,
        project_id: &str,
        new_path: PathBuf,
        reason: String,
    ) -> Result<()> {
        let mut registry = self
            .get(project_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Project not found: {}", project_id))?;

        registry.relocate(new_path, reason);
        self.update(registry).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_storage() -> Arc<GlobalStorage> {
        let temp_dir = TempDir::new().unwrap();
        Arc::new(GlobalStorage::new(temp_dir.path()).await.unwrap())
    }

    #[tokio::test]
    async fn test_register_project() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir = TempDir::new().unwrap();
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"name": "test-project", "version": "1.0.0"}"#,
        )
        .unwrap();

        let registry = manager.register(temp_dir.path().to_path_buf()).await.unwrap();

        assert_eq!(registry.identity.id, "test-project");
        assert_eq!(registry.status, ProjectStatus::Active);
        assert_eq!(registry.path_history.len(), 1);
    }

    #[tokio::test]
    async fn test_get_project() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir = TempDir::new().unwrap();
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"name": "test-get", "version": "1.0.0"}"#,
        )
        .unwrap();

        let registry = manager.register(temp_dir.path().to_path_buf()).await.unwrap();
        let retrieved = manager.get(&registry.identity.full_id).await.unwrap();

        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().identity.id, "test-get");
    }

    #[tokio::test]
    async fn test_relocate_project() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir1 = TempDir::new().unwrap();
        std::fs::write(
            temp_dir1.path().join("package.json"),
            r#"{"name": "test-relocate", "version": "1.0.0"}"#,
        )
        .unwrap();

        let registry = manager.register(temp_dir1.path().to_path_buf()).await.unwrap();
        let project_id = registry.identity.full_id.clone();

        let temp_dir2 = TempDir::new().unwrap();
        manager
            .relocate_project(&project_id, temp_dir2.path().to_path_buf(), "testing".to_string())
            .await
            .unwrap();

        let updated = manager.get(&project_id).await.unwrap().unwrap();
        assert_eq!(updated.current_path, temp_dir2.path());
        assert_eq!(updated.path_history.len(), 2);
        assert_eq!(updated.path_history[1].reason, "testing");
    }

    #[tokio::test]
    async fn test_find_by_name() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir1 = TempDir::new().unwrap();
        std::fs::write(
            temp_dir1.path().join("package.json"),
            r#"{"name": "my-awesome-project", "version": "1.0.0"}"#,
        )
        .unwrap();

        let temp_dir2 = TempDir::new().unwrap();
        std::fs::write(
            temp_dir2.path().join("package.json"),
            r#"{"name": "other-project", "version": "1.0.0"}"#,
        )
        .unwrap();

        manager.register(temp_dir1.path().to_path_buf()).await.unwrap();
        manager.register(temp_dir2.path().to_path_buf()).await.unwrap();

        let results = manager.find_by_name("awesome").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].identity.id, "my-awesome-project");
    }

    #[tokio::test]
    async fn test_list_all() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir1 = TempDir::new().unwrap();
        std::fs::write(
            temp_dir1.path().join("package.json"),
            r#"{"name": "project1", "version": "1.0.0"}"#,
        )
        .unwrap();

        let temp_dir2 = TempDir::new().unwrap();
        std::fs::write(
            temp_dir2.path().join("package.json"),
            r#"{"name": "project2", "version": "1.0.0"}"#,
        )
        .unwrap();

        manager.register(temp_dir1.path().to_path_buf()).await.unwrap();
        manager.register(temp_dir2.path().to_path_buf()).await.unwrap();

        let all = manager.list_all().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_delete_project() {
        let storage = create_test_storage().await;
        let manager = ProjectRegistryManager::new(storage);

        let temp_dir = TempDir::new().unwrap();
        std::fs::write(
            temp_dir.path().join("package.json"),
            r#"{"name": "test-delete", "version": "1.0.0"}"#,
        )
        .unwrap();

        let registry = manager.register(temp_dir.path().to_path_buf()).await.unwrap();
        let project_id = registry.identity.full_id.clone();

        manager.delete(&project_id).await.unwrap();

        let deleted = manager.get(&project_id).await.unwrap().unwrap();
        assert_eq!(deleted.status, ProjectStatus::Deleted);
    }
}
